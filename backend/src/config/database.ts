import dotenv from 'dotenv'
import postgres from 'postgres'
import { normalisePostgresRows, translateMysqlQuery } from './sql-compat.js'

dotenv.config()

const connectionString = process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim()

type PostgresClient = ReturnType<typeof postgres>
type ReservedSqlConnection = Awaited<ReturnType<PostgresClient['reserve']>>

// Let the API boot without database credentials so health checks can explain the configuration problem.
const client: PostgresClient | null = connectionString
  ? postgres(connectionString, {
      max: Number(process.env.DB_POOL_SIZE ?? (process.env.NETLIFY ? '1' : '5')),
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
      prepare: false,
    })
  : null

function requireClient(): PostgresClient {
  if (!client) {
    throw Object.assign(
      new Error('Database connection is not configured. Set SUPABASE_DB_URL in the server runtime environment.'),
      { code: 'DB_NOT_CONFIGURED' },
    )
  }
  return client
}

type RawExecutor = {
  unsafe(query: string, parameters?: never[]): Promise<Array<Record<string, unknown>>>
}

async function run(
  executor: RawExecutor,
  query: string,
  values: readonly unknown[] = [],
): Promise<[unknown, unknown]> {
  const translated = translateMysqlQuery(query, values)
  const rows = await executor.unsafe(translated.text, [...translated.values] as never[])
  const result = rows as Array<Record<string, unknown>> & { count?: number }

  if (translated.returnsId) {
    const id = result[0]?.id
    return [{ insertId: id === undefined ? 0 : Number(id), affectedRows: result.count ?? result.length }, undefined]
  }

  if (translated.kind === 'insert' || translated.kind === 'update' || translated.kind === 'delete') {
    return [{ affectedRows: result.count ?? result.length }, undefined]
  }

  return [normalisePostgresRows(result), undefined]
}

export interface PoolConnection {
  execute(query: string, values?: readonly unknown[]): Promise<[unknown, unknown]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}

class ReservedConnection implements PoolConnection {
  constructor(private readonly connection: ReservedSqlConnection) {}

  execute(query: string, values: readonly unknown[] = []): Promise<[unknown, unknown]> {
    return run(this.connection as unknown as RawExecutor, query, values)
  }

  async beginTransaction(): Promise<void> {
    await this.connection.unsafe('BEGIN')
  }

  async commit(): Promise<void> {
    await this.connection.unsafe('COMMIT')
  }

  async rollback(): Promise<void> {
    await this.connection.unsafe('ROLLBACK')
  }

  release(): void {
    this.connection.release()
  }
}

/**
 * Compatibility API intentionally mirrors the small mysql2 surface the legacy
 * route handlers use. Every request uses PostgreSQL; mysql2 is only needed by
 * the explicit one-time data migration utility.
 */
export const pool = {
  execute(query: string, values: readonly unknown[] = []): Promise<[unknown, unknown]> {
    return run(requireClient() as unknown as RawExecutor, query, values)
  },
  async getConnection(): Promise<PoolConnection> {
    return new ReservedConnection(await requireClient().reserve())
  },
  async end(): Promise<void> {
    if (client) await client.end({ timeout: 5 })
  },
}

export async function checkDatabaseConnection(): Promise<void> {
  await requireClient().unsafe('SELECT 1 AS connected')
}


/** Identify database configuration/transport failures as retryable service-unavailable errors. */
export function isDatabaseUnavailable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return false
  return code === 'DB_NOT_CONFIGURED'
    || code === 'ECONNREFUSED'
    || code === 'ECONNABORTED'
    || code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || code === 'ENOTFOUND'
    || code === 'EAI_AGAIN'
    || code === 'EHOSTUNREACH'
    || code === 'CONNECT_TIMEOUT'
    || code.startsWith('08')
    || code === '57P01'
    || code === '57P02'
    || code === '57P03'
    || code === '53300'
}
