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
  const batchSize = Math.min(500, Math.max(25, Number(process.env.MIGRATION_BATCH_SIZE ?? 200)))
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
  try {
    await source.query("SET time_zone = '+00:00'")
    await destination.unsafe('SELECT 1')

    console.log('Starting MySQL → Supabase PostgreSQL data transfer.')
    console.log('Keep the source database read-only during the transfer and run against a backed-up, migrated Supabase target.')

    for (const table of tables) {
      const keys = primaryKeys[table]
      const orderBy = keys.map((key) => '`' + key + '`').join(', ')
      const [presenceRows] = await source.query(
        'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table],
      )
      if ((presenceRows as Array<Record<string, unknown>>).length === 0) {
        console.warn(table + ': source table is absent; skipped because the legacy database predates this module')
        continue
      }
      const [countRows] = await source.query('SELECT COUNT(*) AS rowCount FROM `' + table + '`')
      const sourceCount = Number((countRows as Array<Record<string, unknown>>)[0]?.rowCount ?? 0)
      let copied = 0

      for (let offset = 0; offset < sourceCount; offset += batchSize) {
        const [rawRows] = await source.query(
          'SELECT * FROM `' + table + '` ORDER BY ' + orderBy + ' LIMIT ? OFFSET ?',
          [batchSize, offset],
        )
        const rows = rawRows as Array<Record<string, unknown>>
        if (rows.length === 0) break

        const columns = Object.keys(rows[0])
        const quotedColumns = columns.map(quoteIdentifier)
        const rowPlaceholders = rows.map((_row, rowIndex) => {
          const slots = columns.map((_column, columnIndex) => (
            '$' + (rowIndex * columns.length + columnIndex + 1)
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

        await destination.unsafe(sql, parameters as never[])
        copied += rows.length
      }

      totalRows += copied
      console.log(table + ': ' + copied + '/' + sourceCount + ' rows transferred')
    }

    for (const table of identityTables) {
      const sql = "SELECT setval(pg_get_serial_sequence('public." + table + "', 'id'), " +
        'GREATEST(COALESCE(MAX(id), 1), 1), COUNT(*) > 0) FROM public.' + quoteIdentifier(table)
      await destination.unsafe(sql)
    }

    console.log('Data transfer completed. Total rows reconciled: ' + totalRows + '.')
    console.log('Verify record counts and a sample from each module before switching production traffic.')
    console.log('Supabase Auth users/profiles are intentionally not copied from MySQL passwords; configure and test sign-in separately.')
  } finally {
    await source.end()
    await destination.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error('MySQL → Supabase migration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
