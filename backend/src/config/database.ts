import dotenv from 'dotenv'
import postgres from 'postgres'
import { normalisePostgresRows, translateMysqlQuery } from './sql-compat.js'

dotenv.config()

const connectionString = process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim()

if (!connectionString) {
  throw new Error(
    'Missing SUPABASE_DB_URL. Configure the Supabase PostgreSQL connection string in backend/.env. ' +
    'Use a server-side database connection string; never put database credentials in frontend environment variables.',
  )
}

const client = postgres(connectionString, {
  max: Number(process.env.DB_POOL_SIZE ?? 5),
  idle_timeout: 20,
  connect_timeout: 10,
  // Compatible with Supabase poolers that do not support persistent prepared statements.
  prepare: false,
})

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
  constructor(private readonly connection: Awaited<ReturnType<typeof client.reserve>>) {}

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
    return run(client as unknown as RawExecutor, query, values)
  },
  async getConnection(): Promise<PoolConnection> {
    return new ReservedConnection(await client.reserve())
  },
  async end(): Promise<void> {
    await client.end({ timeout: 5 })
  },
}

export async function checkDatabaseConnection(): Promise<void> {
  await client.unsafe('SELECT 1 AS connected')
}
