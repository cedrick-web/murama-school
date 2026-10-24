/**
 * A deliberately small compatibility bridge for the existing Murama School
 * parameterised MySQL queries while the application moves to PostgreSQL.
 * Keep business rules in the route/service layer; this module only translates
 * dialect details and normalises the result shape expected by the old API.
 */
export interface TranslatedQuery {
  text: string
  values: readonly unknown[]
  kind: 'select' | 'insert' | 'update' | 'delete' | 'other'
  returnsId: boolean
}

const conflictTargets: Record<string, string> = {
  school_settings: '(setting_key)',
  attendance_records: '(student_id, attendance_date)',
  assessment_results: '(assessment_id, student_id)',
  report_cards: '(term_id, student_id)',
}

const idReturningTables = new Set([
  'announcements',
  'academic_years',
  'terms',
  'classes',
  'streams',
  'subjects',
  'users',
  'students',
  'student_enrollments',
  'assessments',
  'timetable_entries',
  'fee_structures',
  'payments',
  'messages',
])

function rewriteDuplicateKeyUpsert(input: string): string {
  const match = input.match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\s+([\s\S]*?)\s*;?\s*$/i)
  if (!match) return input

  const insert = input.match(/\bINSERT\s+INTO\s+([a-z_][\w]*)/i)
  const table = insert?.[1]?.toLowerCase()
  const target = table ? conflictTargets[table] : undefined
  if (!target) {
    throw new Error('Missing PostgreSQL conflict target for a MySQL upsert on ' + (table ?? 'an unknown table'))
  }

  const assignments = match[1].replace(
    /\bVALUES\s*\(\s*([a-z_][\w]*)\s*\)/gi,
    'EXCLUDED.$1',
  )
  return input.slice(0, match.index) + 'ON CONFLICT ' + target + ' DO UPDATE SET ' + assignments
}

function rewriteIfFunctions(input: string): string {
  let output = ''
  let index = 0
  while (index < input.length) {
    const prefix = input.slice(index)
    const match = /\bIF\s*\(/i.exec(prefix)
    if (!match || match.index === undefined) {
      output += input.slice(index)
      break
    }

    const start = index + match.index
    const opening = start + match[0].lastIndexOf('(')
    let quote: "'" | '"' | '`' | null = null
    let depth = 1
    let closing = -1
    for (let cursor = opening + 1; cursor < input.length; cursor += 1) {
      const character = input[cursor]
      if (quote) {
        if (character === quote) {
          if (input[cursor + 1] === quote && quote !== '`') {
            cursor += 1
            continue
          }
          if (input[cursor - 1] !== '\\') quote = null
        }
        continue
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character
        continue
      }
      if (character === '(') depth += 1
      if (character === ')') {
        depth -= 1
        if (depth === 0) {
          closing = cursor
          break
        }
      }
    }
    if (closing < 0) throw new Error('Unable to translate an unterminated MySQL IF() expression')

    const argumentText = input.slice(opening + 1, closing)
    const args: string[] = []
    let argumentStart = 0
    let nesting = 0
    quote = null
    for (let cursor = 0; cursor < argumentText.length; cursor += 1) {
      const character = argumentText[cursor]
      if (quote) {
        if (character === quote) {
          if (argumentText[cursor + 1] === quote && quote !== '`') {
            cursor += 1
            continue
          }
          if (argumentText[cursor - 1] !== '\\') quote = null
        }
        continue
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character
      } else if (character === '(') {
        nesting += 1
      } else if (character === ')') {
        nesting -= 1
      } else if (character === ',' && nesting === 0) {
        args.push(argumentText.slice(argumentStart, cursor).trim())
        argumentStart = cursor + 1
      }
    }
    args.push(argumentText.slice(argumentStart).trim())
    if (args.length !== 3) throw new Error('MySQL IF() translation expects three arguments')

    output += input.slice(index, start)
    output += '(CASE WHEN ' + args[0] + ' THEN ' + args[1] + ' ELSE ' + args[2] + ' END)'
    index = closing + 1
  }
  return output
}

function rewriteMySqlAggregates(input: string): string {
  return input
    .replace(/\bSUM\s*\(\s*([a-z_][\w.]*)\s*=\s*\?\s*\)/gi, 'COUNT(*) FILTER (WHERE $1 = ?)')
    .replace(/\bSUM\s*\(\s*([a-z_][\w.]*)\s+IS\s+NOT\s+NULL\s*\)/gi, 'COUNT($1)')
}

function quoteCaseSensitiveAliases(input: string): string {
  const aliases: string[] = []
  let output = input.replace(/\bAS\s+([a-z_][\w]*)/gi, (statement, alias: string) => {
    if (alias === alias.toLowerCase()) return statement
    aliases.push(alias)
    return 'AS "' + alias + '"'
  })

  // PostgreSQL folds unquoted identifiers to lowercase, including aliases used
  // later in ORDER BY/GROUP BY/HAVING. Quote those references consistently.
  const clauseIndex = output.search(/\b(?:ORDER\s+BY|GROUP\s+BY|HAVING)\b/i)
  if (clauseIndex < 0 || aliases.length === 0) return output

  const head = output.slice(0, clauseIndex)
  let tail = output.slice(clauseIndex)
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    tail = tail.replace(
      new RegExp('(?<![A-Za-z0-9_".])' + escaped + '(?![A-Za-z0-9_"])', 'g'),
      '"' + alias + '"',
    )
  }
  output = head + tail
  return output
}
function numberForNumericField(key: string, value: unknown): unknown {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return value
  const numericKey = /^(id|.*Id|.*Count|.*Score|.*Position|.*Percentage|.*Amount|.*Due|.*Paid|.*Total|.*Outstanding|.*Items|.*No|.*Number|.*Rank)$/i.test(key)
  if (!numericKey) return value
  const number = Number(value)
  return Number.isFinite(number) ? number : value
}

export function normalisePostgresRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, numberForNumericField(key, value)]),
  ) as T)
}

export function translateMysqlQuery(query: string, values: readonly unknown[] = []): TranslatedQuery {
  let text = query.trim().replace(/;\s*$/, '')
  text = text.replace(/\bCONCAT_WS\s*\(\s*" "\s*,/gi, "CONCAT_WS(' ',")
  text = rewriteMySqlAggregates(text)
  text = text.replace(/\s*<=>\s*/g, ' IS NOT DISTINCT FROM ')
  text = text.replace(/\bIN\s*\(\s*\?\s*\)/gi, '= ANY(?)')
  text = text.replace(/\?\s+IS\s+NULL/gi, 'CAST(? AS TEXT) IS NULL')
  text = text.replace(/\?\s*=\s*\?/g, 'CAST(? AS TEXT) = CAST(? AS TEXT)')
  text = rewriteIfFunctions(text)
  text = rewriteDuplicateKeyUpsert(text)
  text = quoteCaseSensitiveAliases(text)

  const translatedValues: unknown[] = []
  let output = ''
  let quote: "'" | '"' | '`' | null = null
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      output += character
      if (character === quote) {
        if (text[index + 1] === quote && quote !== '`') {
          output += text[index + 1]
          index += 1
          continue
        }
        if (text[index - 1] !== '\\') quote = null
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      output += character === '`' ? '"' : character
      continue
    }
    if (character === '?') {
      translatedValues.push(values[translatedValues.length])
      output += '$' + translatedValues.length
      continue
    }
    output += character
  }

  const insert = output.match(/^INSERT\s+INTO\s+([a-z_][\w]*)/i)
  const table = insert?.[1]?.toLowerCase()
  const kind = /^(SELECT|WITH)\b/i.test(output)
    ? 'select'
    : /^INSERT\b/i.test(output)
      ? 'insert'
      : /^UPDATE\b/i.test(output)
        ? 'update'
        : /^DELETE\b/i.test(output)
          ? 'delete'
          : 'other'
  const returnsId = kind === 'insert'
    && !!table
    && idReturningTables.has(table)
    && !/\bRETURNING\b/i.test(output)

  if (returnsId) output += ' RETURNING id'

  if (translatedValues.length !== values.length) {
    throw new Error('SQL parameter mismatch: query expects ' + translatedValues.length + ' values but received ' + values.length)
  }

  return { text: output, values: translatedValues, kind, returnsId }
}
