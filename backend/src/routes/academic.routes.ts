import { Router } from 'express'
import type { Response } from 'express'
import type { PoolConnection } from '../config/database.js'

import { pool } from '../config/database.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

interface AcademicYearInput {
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
}

interface TermInput {
  academicYearId: number
  name: string
  startsOn: string
  endsOn: string
  sequenceNo: number
}

interface ClassInput {
  name: string
  description: string | null
}

interface StreamInput {
  classId: number
  name: string
}

interface SubjectInput {
  code: string
  name: string
  description: string | null
}

async function withTransaction<T>(
  action: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) {
    try {
      await connection.rollback()
    } catch (rollbackError) {
      console.error('Unable to roll back academic transaction', rollbackError)
    }
    throw error
  } finally {
    connection.release()
  }
}

async function audit(
  connection: PoolConnection,
  req: AuthenticatedRequest,
  action: string,
  entityType: string,
  entityId: number,
  details: object,
): Promise<void> {
  await connection.execute(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      req.user!.id,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      req.ip ?? null,
      req.get('user-agent')?.slice(0, 500) ?? null,
    ],
  )
}

function parseId(value: string | string[]): number | null {
  if (typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null
}

function parseText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 && text.length <= maxLength ? text : null
}

function parseOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length <= maxLength ? text || null : undefined
}

function parseAcademicYear(input: Record<string, unknown>): AcademicYearInput | null {
  const name = parseText(input.name, 30)
  const startsOn = parseDate(input.startsOn)
  const endsOn = parseDate(input.endsOn)
  if (!name || !startsOn || !endsOn || startsOn > endsOn || typeof input.isCurrent !== 'boolean') {
    return null
  }
  return { name, startsOn, endsOn, isCurrent: input.isCurrent }
}

function parseTerm(input: Record<string, unknown>): TermInput | null {
  const name = parseText(input.name, 50)
  const startsOn = parseDate(input.startsOn)
  const endsOn = parseDate(input.endsOn)
  const academicYearId = Number(input.academicYearId)
  const sequenceNo = Number(input.sequenceNo)
  if (
    !name
    || !startsOn
    || !endsOn
    || startsOn > endsOn
    || !Number.isSafeInteger(academicYearId)
    || academicYearId < 1
    || !Number.isInteger(sequenceNo)
    || sequenceNo < 1
    || sequenceNo > 12
  ) {
    return null
  }
  return { academicYearId, name, startsOn, endsOn, sequenceNo }
}

function parseClass(input: Record<string, unknown>): ClassInput | null {
  const name = parseText(input.name, 100)
  const description = parseOptionalText(input.description, 255)
  if (!name || description === undefined) return null
  return { name, description }
}

function parseStream(input: Record<string, unknown>): StreamInput | null {
  const classId = Number(input.classId)
  const name = parseText(input.name, 50)
  if (!Number.isSafeInteger(classId) || classId < 1 || !name) return null
  return { classId, name }
}

function parseSubject(input: Record<string, unknown>): SubjectInput | null {
  const code = parseText(input.code, 30)?.toUpperCase()
  const name = parseText(input.name, 150)
  const description = parseOptionalText(input.description, 255)
  if (!code || !name || description === undefined) return null
  return { code, name, description }
}

function reportFailure(
  res: Response,
  action: string,
  error: unknown,
): void {
  const code = (error as { code?: string } | null)?.code
  if (code === 'ER_DUP_ENTRY' || code === '23505') {
    res.status(409).json({ success: false, message: 'A record with those details already exists' })
    return
  }
  if (code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_ROW_IS_REFERENCED' || code === '23503') {
    res.status(409).json({
      success: false,
      message: 'This record is in use and cannot be deleted',
    })
    return
  }
  console.error(`Academic ${action} failed`, error)
  res.status(500).json({ success: false, message: `Unable to ${action}` })
}

router.get('/years', async (_req, res) => {
  try {
    const [years] = await pool.execute(
      'SELECT y.id, y.name, y.starts_on AS startsOn, y.ends_on AS endsOn, y.is_current AS isCurrent, COUNT(t.id) AS termCount FROM academic_years y LEFT JOIN terms t ON t.academic_year_id = y.id GROUP BY y.id ORDER BY y.starts_on DESC',
    )
    res.json({ success: true, years })
  } catch (error) {
    reportFailure(res, 'load academic years', error)
  }
})

router.post('/years', async (req: AuthenticatedRequest, res) => {
  const year = parseAcademicYear(req.body ?? {})
  if (!year) {
    res.status(400).json({
      success: false,
      message: 'Provide a name, valid start/end dates, and current-year status',
    })
    return
  }

  try {
    const id = await withTransaction(async (connection) => {
      if (year.isCurrent) {
        await connection.execute('UPDATE academic_years SET is_current = FALSE WHERE is_current = TRUE')
      }
      const [result] = await connection.execute(
        'INSERT INTO academic_years (name, starts_on, ends_on, is_current) VALUES (?, ?, ?, ?)',
        [year.name, year.startsOn, year.endsOn, year.isCurrent],
      )
      const yearId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'ACADEMIC_YEAR_CREATED', 'academic_year', yearId, year)
      return yearId
    })
    res.status(201).json({ success: true, year: { id, ...year, termCount: 0 } })
  } catch (error) {
    reportFailure(res, 'create academic year', error)
  }
})

router.patch('/years/:yearId', async (req: AuthenticatedRequest, res) => {
  const yearId = parseId(req.params.yearId)
  const year = parseAcademicYear(req.body ?? {})
  if (!yearId || !year) {
    res.status(400).json({ success: false, message: 'A valid year ID and year details are required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute(
        'SELECT id FROM academic_years WHERE id = ? FOR UPDATE',
        [yearId],
      )
      if (!(existing as Record<string, unknown>[]).length) return false
      if (year.isCurrent) {
        await connection.execute(
          'UPDATE academic_years SET is_current = FALSE WHERE is_current = TRUE AND id <> ?',
          [yearId],
        )
      }
      await connection.execute(
        'UPDATE academic_years SET name = ?, starts_on = ?, ends_on = ?, is_current = ? WHERE id = ?',
        [year.name, year.startsOn, year.endsOn, year.isCurrent, yearId],
      )
      await audit(connection, req, 'ACADEMIC_YEAR_UPDATED', 'academic_year', yearId, year)
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Academic year not found' })
      return
    }
    res.json({ success: true, message: 'Academic year updated' })
  } catch (error) {
    reportFailure(res, 'update academic year', error)
  }
})

router.delete('/years/:yearId', async (req: AuthenticatedRequest, res) => {
  const yearId = parseId(req.params.yearId)
  if (!yearId) {
    res.status(400).json({ success: false, message: 'A valid academic year ID is required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute(
        'SELECT id, name FROM academic_years WHERE id = ? FOR UPDATE',
        [yearId],
      )
      const year = (existing as Record<string, unknown>[])[0]
      if (!year) return false
      await audit(connection, req, 'ACADEMIC_YEAR_DELETED', 'academic_year', yearId, {
        name: year.name,
      })
      await connection.execute('DELETE FROM academic_years WHERE id = ?', [yearId])
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Academic year not found' })
      return
    }
    res.json({ success: true, message: 'Academic year deleted' })
  } catch (error) {
    reportFailure(res, 'delete academic year', error)
  }
})

router.get('/terms', async (_req, res) => {
  try {
    const [terms] = await pool.execute(
      'SELECT t.id, t.academic_year_id AS academicYearId, y.name AS academicYearName, t.name, t.starts_on AS startsOn, t.ends_on AS endsOn, t.sequence_no AS sequenceNo FROM terms t INNER JOIN academic_years y ON y.id = t.academic_year_id ORDER BY y.starts_on DESC, t.sequence_no',
    )
    res.json({ success: true, terms })
  } catch (error) {
    reportFailure(res, 'load terms', error)
  }
})

async function validateTermYear(
  connection: PoolConnection,
  term: TermInput,
): Promise<boolean> {
  const [rows] = await connection.execute(
    'SELECT starts_on AS startsOn, ends_on AS endsOn FROM academic_years WHERE id = ?',
    [term.academicYearId],
  )
  const year = (rows as Record<string, unknown>[])[0]
  if (!year) return false
  const yearStart = new Date(String(year.startsOn)).toISOString().slice(0, 10)
  const yearEnd = new Date(String(year.endsOn)).toISOString().slice(0, 10)
  return term.startsOn >= yearStart && term.endsOn <= yearEnd
}

router.post('/terms', async (req: AuthenticatedRequest, res) => {
  const term = parseTerm(req.body ?? {})
  if (!term) {
    res.status(400).json({
      success: false,
      message: 'Provide a term name, academic year, valid dates, and sequence from 1 to 12',
    })
    return
  }

  try {
    const id = await withTransaction(async (connection) => {
      if (!(await validateTermYear(connection, term))) return null
      const [result] = await connection.execute(
        'INSERT INTO terms (academic_year_id, name, starts_on, ends_on, sequence_no) VALUES (?, ?, ?, ?, ?)',
        [term.academicYearId, term.name, term.startsOn, term.endsOn, term.sequenceNo],
      )
      const termId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'TERM_CREATED', 'term', termId, term)
      return termId
    })
    if (!id) {
      res.status(400).json({ success: false, message: 'Term dates must be within an existing academic year' })
      return
    }
    res.status(201).json({ success: true, term: { id, ...term } })
  } catch (error) {
    reportFailure(res, 'create term', error)
  }
})

router.patch('/terms/:termId', async (req: AuthenticatedRequest, res) => {
  const termId = parseId(req.params.termId)
  const term = parseTerm(req.body ?? {})
  if (!termId || !term) {
    res.status(400).json({ success: false, message: 'A valid term ID and term details are required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      if (!(await validateTermYear(connection, term))) return 'invalid-year'
      const [existing] = await connection.execute('SELECT id FROM terms WHERE id = ? FOR UPDATE', [termId])
      if (!(existing as Record<string, unknown>[]).length) return 'missing'
      await connection.execute(
        'UPDATE terms SET academic_year_id = ?, name = ?, starts_on = ?, ends_on = ?, sequence_no = ? WHERE id = ?',
        [term.academicYearId, term.name, term.startsOn, term.endsOn, term.sequenceNo, termId],
      )
      await audit(connection, req, 'TERM_UPDATED', 'term', termId, term)
      return 'updated'
    })
    if (result === 'invalid-year') {
      res.status(400).json({ success: false, message: 'Term dates must be within an existing academic year' })
      return
    }
    if (result === 'missing') {
      res.status(404).json({ success: false, message: 'Term not found' })
      return
    }
    res.json({ success: true, message: 'Term updated' })
  } catch (error) {
    reportFailure(res, 'update term', error)
  }
})

router.delete('/terms/:termId', async (req: AuthenticatedRequest, res) => {
  const termId = parseId(req.params.termId)
  if (!termId) {
    res.status(400).json({ success: false, message: 'A valid term ID is required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id, name FROM terms WHERE id = ? FOR UPDATE', [termId])
      const term = (existing as Record<string, unknown>[])[0]
      if (!term) return false
      await audit(connection, req, 'TERM_DELETED', 'term', termId, { name: term.name })
      await connection.execute('DELETE FROM terms WHERE id = ?', [termId])
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Term not found' })
      return
    }
    res.json({ success: true, message: 'Term deleted' })
  } catch (error) {
    reportFailure(res, 'delete term', error)
  }
})

router.get('/classes', async (_req, res) => {
  try {
    const [classes] = await pool.execute(
      'SELECT c.id, c.name, c.description, COUNT(s.id) AS streamCount FROM classes c LEFT JOIN streams s ON s.class_id = c.id GROUP BY c.id ORDER BY c.name',
    )
    res.json({ success: true, classes })
  } catch (error) {
    reportFailure(res, 'load classes', error)
  }
})

router.post('/classes', async (req: AuthenticatedRequest, res) => {
  const input = parseClass(req.body ?? {})
  if (!input) {
    res.status(400).json({ success: false, message: 'Provide a class name and a description up to 255 characters' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO classes (name, description) VALUES (?, ?)',
        [input.name, input.description],
      )
      const classId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'CLASS_CREATED', 'class', classId, input)
      return classId
    })
    res.status(201).json({ success: true, class: { id, ...input, streamCount: 0 } })
  } catch (error) {
    reportFailure(res, 'create class', error)
  }
})

router.patch('/classes/:classId', async (req: AuthenticatedRequest, res) => {
  const classId = parseId(req.params.classId)
  const input = parseClass(req.body ?? {})
  if (!classId || !input) {
    res.status(400).json({ success: false, message: 'A valid class ID and class details are required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM classes WHERE id = ? FOR UPDATE', [classId])
      if (!(existing as Record<string, unknown>[]).length) return false
      await connection.execute(
        'UPDATE classes SET name = ?, description = ? WHERE id = ?',
        [input.name, input.description, classId],
      )
      await audit(connection, req, 'CLASS_UPDATED', 'class', classId, input)
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Class not found' })
      return
    }
    res.json({ success: true, message: 'Class updated' })
  } catch (error) {
    reportFailure(res, 'update class', error)
  }
})

router.delete('/classes/:classId', async (req: AuthenticatedRequest, res) => {
  const classId = parseId(req.params.classId)
  if (!classId) {
    res.status(400).json({ success: false, message: 'A valid class ID is required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id, name FROM classes WHERE id = ? FOR UPDATE', [classId])
      const schoolClass = (existing as Record<string, unknown>[])[0]
      if (!schoolClass) return false
      await audit(connection, req, 'CLASS_DELETED', 'class', classId, { name: schoolClass.name })
      await connection.execute('DELETE FROM classes WHERE id = ?', [classId])
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Class not found' })
      return
    }
    res.json({ success: true, message: 'Class deleted' })
  } catch (error) {
    reportFailure(res, 'delete class', error)
  }
})

router.get('/streams', async (_req, res) => {
  try {
    const [streams] = await pool.execute(
      'SELECT s.id, s.class_id AS classId, c.name AS className, s.name FROM streams s INNER JOIN classes c ON c.id = s.class_id ORDER BY c.name, s.name',
    )
    res.json({ success: true, streams })
  } catch (error) {
    reportFailure(res, 'load streams', error)
  }
})

router.post('/streams', async (req: AuthenticatedRequest, res) => {
  const input = parseStream(req.body ?? {})
  if (!input) {
    res.status(400).json({ success: false, message: 'Provide a class and stream name' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const [classes] = await connection.execute('SELECT id FROM classes WHERE id = ?', [input.classId])
      if (!(classes as Record<string, unknown>[]).length) return null
      const [result] = await connection.execute(
        'INSERT INTO streams (class_id, name) VALUES (?, ?)',
        [input.classId, input.name],
      )
      const streamId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'STREAM_CREATED', 'stream', streamId, input)
      return streamId
    })
    if (!id) {
      res.status(400).json({ success: false, message: 'Selected class does not exist' })
      return
    }
    res.status(201).json({ success: true, stream: { id, ...input } })
  } catch (error) {
    reportFailure(res, 'create stream', error)
  }
})

router.patch('/streams/:streamId', async (req: AuthenticatedRequest, res) => {
  const streamId = parseId(req.params.streamId)
  const input = parseStream(req.body ?? {})
  if (!streamId || !input) {
    res.status(400).json({ success: false, message: 'A valid stream ID and stream details are required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM streams WHERE id = ? FOR UPDATE', [streamId])
      if (!(existing as Record<string, unknown>[]).length) return false
      const [classes] = await connection.execute('SELECT id FROM classes WHERE id = ?', [input.classId])
      if (!(classes as Record<string, unknown>[]).length) return 'missing-class'
      await connection.execute(
        'UPDATE streams SET class_id = ?, name = ? WHERE id = ?',
        [input.classId, input.name, streamId],
      )
      await audit(connection, req, 'STREAM_UPDATED', 'stream', streamId, input)
      return 'updated'
    })
    if (result === false) {
      res.status(404).json({ success: false, message: 'Stream not found' })
      return
    }
    if (result === 'missing-class') {
      res.status(400).json({ success: false, message: 'Selected class does not exist' })
      return
    }
    res.json({ success: true, message: 'Stream updated' })
  } catch (error) {
    reportFailure(res, 'update stream', error)
  }
})

router.delete('/streams/:streamId', async (req: AuthenticatedRequest, res) => {
  const streamId = parseId(req.params.streamId)
  if (!streamId) {
    res.status(400).json({ success: false, message: 'A valid stream ID is required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id, name FROM streams WHERE id = ? FOR UPDATE', [streamId])
      const stream = (existing as Record<string, unknown>[])[0]
      if (!stream) return false
      await audit(connection, req, 'STREAM_DELETED', 'stream', streamId, { name: stream.name })
      await connection.execute('DELETE FROM streams WHERE id = ?', [streamId])
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Stream not found' })
      return
    }
    res.json({ success: true, message: 'Stream deleted' })
  } catch (error) {
    reportFailure(res, 'delete stream', error)
  }
})

router.get('/subjects', async (_req, res) => {
  try {
    const [subjects] = await pool.execute(
      'SELECT id, code, name, description FROM subjects ORDER BY name',
    )
    res.json({ success: true, subjects })
  } catch (error) {
    reportFailure(res, 'load subjects', error)
  }
})

router.post('/subjects', async (req: AuthenticatedRequest, res) => {
  const input = parseSubject(req.body ?? {})
  if (!input) {
    res.status(400).json({ success: false, message: 'Provide a subject code, name, and description up to 255 characters' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO subjects (code, name, description) VALUES (?, ?, ?)',
        [input.code, input.name, input.description],
      )
      const subjectId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'SUBJECT_CREATED', 'subject', subjectId, input)
      return subjectId
    })
    res.status(201).json({ success: true, subject: { id, ...input } })
  } catch (error) {
    reportFailure(res, 'create subject', error)
  }
})

router.patch('/subjects/:subjectId', async (req: AuthenticatedRequest, res) => {
  const subjectId = parseId(req.params.subjectId)
  const input = parseSubject(req.body ?? {})
  if (!subjectId || !input) {
    res.status(400).json({ success: false, message: 'A valid subject ID and subject details are required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM subjects WHERE id = ? FOR UPDATE', [subjectId])
      if (!(existing as Record<string, unknown>[]).length) return false
      await connection.execute(
        'UPDATE subjects SET code = ?, name = ?, description = ? WHERE id = ?',
        [input.code, input.name, input.description, subjectId],
      )
      await audit(connection, req, 'SUBJECT_UPDATED', 'subject', subjectId, input)
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Subject not found' })
      return
    }
    res.json({ success: true, message: 'Subject updated' })
  } catch (error) {
    reportFailure(res, 'update subject', error)
  }
})

router.delete('/subjects/:subjectId', async (req: AuthenticatedRequest, res) => {
  const subjectId = parseId(req.params.subjectId)
  if (!subjectId) {
    res.status(400).json({ success: false, message: 'A valid subject ID is required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id, name FROM subjects WHERE id = ? FOR UPDATE', [subjectId])
      const subject = (existing as Record<string, unknown>[])[0]
      if (!subject) return false
      await audit(connection, req, 'SUBJECT_DELETED', 'subject', subjectId, { name: subject.name })
      await connection.execute('DELETE FROM subjects WHERE id = ?', [subjectId])
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Subject not found' })
      return
    }
    res.json({ success: true, message: 'Subject deleted' })
  } catch (error) {
    reportFailure(res, 'delete subject', error)
  }
})

export default router
