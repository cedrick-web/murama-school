import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import postgres from 'postgres'

dotenv.config()

const destinationUrl = process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim()
if (!destinationUrl) {
  throw new Error('Set SUPABASE_DB_URL in backend/.env before migrating data.')
}

// Parent tables precede their dependants so foreign keys are valid as records are copied.
const tables = [
  'roles', 'users', 'user_roles', 'school_settings',
  'academic_years', 'terms', 'classes', 'streams', 'subjects',
  'teachers', 'students', 'parents', 'staff', 'student_parents',
  'student_enrollments', 'class_subjects', 'teacher_subjects',
  'assessments', 'assessment_results', 'grades', 'report_cards',
  'attendance_records', 'timetable_entries', 'fee_structures', 'fee_items',
  'invoices', 'payments', 'messages', 'message_recipients', 'notifications',
  'news', 'events', 'announcements', 'gallery_items', 'audit_logs',
] as const

const primaryKeys: Record<string, string[]> = {
  roles: ['id'], users: ['id'], user_roles: ['user_id', 'role_id'],
  school_settings: ['id'], academic_years: ['id'], terms: ['id'], classes: ['id'],
  streams: ['id'], subjects: ['id'], teachers: ['id'], students: ['id'],
  parents: ['id'], staff: ['id'], student_parents: ['student_id', 'parent_id'],
  student_enrollments: ['id'], class_subjects: ['id'], teacher_subjects: ['id'],
  assessments: ['id'], assessment_results: ['id'], grades: ['id'], report_cards: ['id'],
  attendance_records: ['id'], timetable_entries: ['id'], fee_structures: ['id'],
  fee_items: ['id'], invoices: ['id'], payments: ['id'], messages: ['id'],
  message_recipients: ['message_id', 'recipient_user_id'], notifications: ['id'],
  news: ['id'], events: ['id'], announcements: ['id'], gallery_items: ['id'], audit_logs: ['id'],
}

const identityTables = tables.filter((table) => primaryKeys[table].length === 1 && primaryKeys[table][0] === 'id')
const booleanColumns = new Set([
  'users.is_active',
  'academic_years.is_current',
  'student_parents.is_primary',
  'news.is_published',
  'events.is_published',
  'announcements.is_published',
  'gallery_items.is_published',
])

function quoteIdentifier(identifier: string): string {
  return '"' + identifier.replace(/"/g, '""') + '"'
}

function sourceConfig(): mysql.ConnectionOptions {
  const host = process.env.MYSQL_HOST ?? process.env.DB_HOST
  const database = process.env.MYSQL_DATABASE ?? process.env.DB_NAME
  const user = process.env.MYSQL_USER ?? process.env.DB_USER
  if (!host || !database || !user) {
    throw new Error('Set MYSQL_URL or MYSQL_HOST/MYSQL_DATABASE/MYSQL_USER for the existing XAMPP/MySQL source.')
  }
  return {
    host,
    port: Number(process.env.MYSQL_PORT ?? process.env.DB_PORT ?? 3306),
    database,
    user,
    password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: 'Z',
  }
}

function convertValue(table: string, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (booleanColumns.has(table + '.' + column)) {
    return value === true || value === 1 || value === '1' || value === 'true'
  }
  if (table === 'audit_logs' && column === 'details' && typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }
  return value
}

async function main(): Promise<void> {
  const requestedBatchSize = Number(process.env.MIGRATION_BATCH_SIZE ?? 200)
  const batchSize = Number.isFinite(requestedBatchSize) && Number.isInteger(requestedBatchSize)
    ? Math.min(500, Math.max(25, requestedBatchSize))
    : 200
  const applyChanges = process.argv.includes('--apply')
  if (applyChanges && process.env.MIGRATION_ALLOW_WRITES !== 'true') {
    throw new Error('Write mode requires both --apply and MIGRATION_ALLOW_WRITES=true. The default mode is a read-only preflight.')
  }

  const mysqlUrl = process.env.MYSQL_URL?.trim()
  const source = mysqlUrl
    ? await mysql.createConnection(mysqlUrl)
    : await mysql.createConnection(sourceConfig())
  const destination = postgres(destinationUrl!, {
    max: 1,
    connect_timeout: 10,
    prepare: false,
  })

  let totalRows = 0
  let reconciliationMismatch = false
  const mysqlQuote = String.fromCharCode(96)
  const quoteMysqlIdentifier = (identifier: string) => mysqlQuote + identifier.replace(new RegExp(mysqlQuote, 'g'), mysqlQuote + mysqlQuote) + mysqlQuote

  try {
    await source.query("SET time_zone = '+00:00'")
    await destination.unsafe('SELECT 1')

    console.log(applyChanges
      ? 'APPLY MODE: MySQL → Supabase upserts are enabled.'
      : 'READ-ONLY PREFLIGHT: no destination rows will be written.')
    console.log('Keep the source database read-only, verify the target project, and take a backup before apply mode.')
    if (!applyChanges) {
      console.log('After reviewing every preflight result, use --apply with MIGRATION_ALLOW_WRITES=true to write.')
    }

    for (const table of tables) {
      const keys = primaryKeys[table]
      const sourceTable = quoteMysqlIdentifier(table)
      const [presenceRows] = await source.query(
        'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table],
      )
      if ((presenceRows as Array<Record<string, unknown>>).length === 0) {
        console.warn(table + ': source table is absent; skipped because the legacy database predates this module')
        continue
      }

      const [sourceCountRows] = await source.query('SELECT COUNT(*) AS rowCount FROM ' + sourceTable)
      const sourceCount = Number((sourceCountRows as Array<Record<string, unknown>>)[0]?.rowCount ?? 0)
      const [sourceColumnRows] = await source.query('SHOW COLUMNS FROM ' + sourceTable)
      const sourceColumns = new Set((sourceColumnRows as Array<Record<string, unknown>>).map((column) => String(column.Field)))
      const [targetColumnRows] = await destination.unsafe(
        'SELECT column_name, is_nullable, column_default, is_identity, is_generated FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', table],
      )
      const targetColumns = targetColumnRows as Array<Record<string, unknown>>
      if (!targetColumns.length) {
        throw new Error(table + ': target table is missing in Supabase. Apply schema migrations before importing data.')
      }
      const targetColumnNames = new Set(targetColumns.map((column) => String(column.column_name)))
      const sourceOnlyColumns = [...sourceColumns].filter((column) => !targetColumnNames.has(column))
      if (sourceOnlyColumns.length) {
        throw new Error(table + ': source columns are absent from Supabase schema: ' + sourceOnlyColumns.join(', ') + '. Review a schema mapping before importing.')
      }
      const missingRequiredColumns = targetColumns
        .filter((column) => column.is_nullable === 'NO'
          && column.column_default === null
          && column.is_identity !== 'YES'
          && column.is_generated === 'NEVER'
          && !sourceColumns.has(String(column.column_name)))
        .map((column) => String(column.column_name))
      if (missingRequiredColumns.length) {
        throw new Error(table + ': required target columns are missing from the MySQL source: ' + missingRequiredColumns.join(', ') + '. Review a schema mapping before importing.')
      }

      const [targetCountRows] = await destination.unsafe(
        'SELECT COUNT(*) AS row_count FROM public.' + quoteIdentifier(table),
      )
      const targetCountBefore = Number((targetCountRows as Array<Record<string, unknown>>)[0]?.row_count ?? 0)

      if (!applyChanges) {
        totalRows += sourceCount
        console.log(table + ': preflight OK; source=' + sourceCount + ', target-before=' + targetCountBefore + ', columns=' + sourceColumns.size)
        continue
      }

      let copied = 0
      await destination.begin(async (transaction) => {
        for (let offset = 0; offset < sourceCount; offset += batchSize) {
          const orderBy = keys.map((key) => quoteMysqlIdentifier(key)).join(', ')
          const [rawRows] = await source.query(
            'SELECT * FROM ' + sourceTable + ' ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?',
            [batchSize, offset],
          )
          const rows = rawRows as Array<Record<string, unknown>>
          if (rows.length === 0) break

          const columns = Object.keys(rows[0])
          const quotedColumns = columns.map(quoteIdentifier)
          const rowPlaceholders = rows.map((_row, rowIndex) => {
            const slots = columns.map((_column, columnIndex) => (
              'main().catch((error: unknown) => {
  console.error('MySQL → Supabase migration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
 + (rowIndex * columns.length + columnIndex + 1)
            ))
            return '(' + slots.join(', ') + ')'
          })
          const parameters = rows.flatMap((row) => columns.map((column) => convertValue(table, column, row[column])))
          const conflictColumns = keys.map(quoteIdentifier).join(', ')
          const mutableColumns = columns.filter((column) => !keys.includes(column))
          const conflictAction = mutableColumns.length
            ? 'DO UPDATE SET ' + mutableColumns.map((column) => quoteIdentifier(column) + ' = EXCLUDED.' + quoteIdentifier(column)).join(', ')
            : 'DO NOTHING'
          const sql = 'INSERT INTO public.' + quoteIdentifier(table) +
            ' (' + quotedColumns.join(', ') + ') VALUES ' + rowPlaceholders.join(', ') +
            ' ON CONFLICT (' + conflictColumns + ') ' + conflictAction

          await transaction.unsafe(sql, parameters as never[])
          copied += rows.length
        }
      })

      totalRows += copied
      const [targetAfterRows] = await destination.unsafe(
        'SELECT COUNT(*) AS row_count FROM public.' + quoteIdentifier(table),
      )
      const targetCountAfter = Number((targetAfterRows as Array<Record<string, unknown>>)[0]?.row_count ?? 0)
      const exactMatch = targetCountAfter === sourceCount
      if (!exactMatch) reconciliationMismatch = true
      console.log(table + ': source=' + sourceCount + ', copied=' + copied + ', target-before=' + targetCountBefore + ', target-after=' + targetCountAfter + (exactMatch ? ' [COUNT MATCH]' : ' [RECONCILIATION REQUIRED]'))
    }

    if (applyChanges) {
      for (const table of identityTables) {
        const sql = "SELECT setval(pg_get_serial_sequence('public." + table + "', 'id'), " +
          'GREATEST(COALESCE(MAX(id), 1), 1), COUNT(*) > 0) FROM public.' + quoteIdentifier(table)
        await destination.unsafe(sql)
      }
      console.log('Data transfer wrote/upserted ' + totalRows + ' source rows.')
      if (reconciliationMismatch) {
        throw new Error('One or more destination row counts do not exactly match the source. The upserts completed, but do not switch production traffic until the listed tables are reconciled.')
      }
      console.log('All imported source-table row counts match their destination counts.')
    } else {
      console.log('Preflight completed without writes. Source rows scheduled for import: ' + totalRows + '.')
    }
    console.log('Supabase Auth identities are not created by this script. Verify school JWT login and Google identity linking separately.')
  } finally {
    await source.end()
    await destination.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error('MySQL → Supabase migration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
