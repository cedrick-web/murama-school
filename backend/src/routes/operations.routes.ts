import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { Response } from 'express'
import type { PoolConnection } from 'mysql2/promise'

import { pool } from '../config/database.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

class OperationError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'OperationError'
  }
}

const attendanceStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const
const assessmentTypes = ['TEST', 'QUIZ', 'ASSIGNMENT', 'MIDTERM', 'FINAL', 'PRACTICAL', 'OTHER'] as const
const paymentMethods = ['CASH', 'BANK', 'MOBILE_MONEY', 'CARD', 'OTHER'] as const
const userRoles = ['ADMIN', 'HEADTEACHER', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF'] as const

type AttendanceStatus = typeof attendanceStatuses[number]
type AssessmentType = typeof assessmentTypes[number]
type PaymentMethod = typeof paymentMethods[number]

function parseId(value: unknown): number | null {
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function parseNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}

function parseText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= maxLength ? text : null
}

function parseOptionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length <= maxLength ? (text || null) : undefined
}

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(value + 'T00:00:00.000Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

function parseTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) return null
  return value.length === 5 ? value + ':00' : value
}

async function withTransaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) {
    try { await connection.rollback() } catch (rollbackError) {
      console.error('Unable to roll back school operation', rollbackError)
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
  entityId: number | null,
  details: Record<string, unknown>,
): Promise<void> {
  await connection.execute(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user!.id, action, entityType, entityId, JSON.stringify(details), req.ip ?? null, req.get('user-agent')?.slice(0, 500) ?? null],
  )
}

function fail(res: Response, action: string, error: unknown): void {
  if (error instanceof OperationError) {
    res.status(error.statusCode).json({ success: false, message: error.message })
    return
  }
  const code = (error as { code?: string } | null)?.code
  if (code === 'ER_DUP_ENTRY') {
    res.status(409).json({ success: false, message: 'A record with those details already exists' })
    return
  }
  if (code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_ROW_IS_REFERENCED') {
    res.status(409).json({ success: false, message: 'This record is still used by other school records' })
    return
  }
  console.error('School operation failed: ' + action, error)
  res.status(500).json({ success: false, message: 'Unable to ' + action })
}

// -----------------------------------------------------------------------------
// Attendance: daily registers are stored in attendance_records, with a unique
// student/date constraint. A missing record is returned as unmarked, never as
// an invented present/absent status.
// -----------------------------------------------------------------------------
router.get('/attendance', async (req, res) => {
  const classId = parseId(req.query.classId)
  const termId = parseId(req.query.termId)
  const attendanceDate = parseDate(req.query.date)
  if (!classId || !termId || !attendanceDate) {
    res.status(400).json({ success: false, message: 'Provide a class, term and valid attendance date (YYYY-MM-DD)' })
    return
  }

  try {
    const [rows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, e.class_id AS classId, c.name AS className, ar.id AS attendanceId, ar.status AS attendanceStatus, ar.note FROM student_enrollments e INNER JOIN terms t ON t.id = ? AND t.academic_year_id = e.academic_year_id INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id INNER JOIN classes c ON c.id = e.class_id LEFT JOIN attendance_records ar ON ar.student_id = s.id AND ar.attendance_date = ? WHERE e.class_id = ? AND (e.term_id = t.id OR e.term_id IS NULL) AND e.enrollment_status = ? AND s.status = ? ORDER BY u.last_name, u.first_name',
      [termId, attendanceDate, classId, 'ACTIVE', 'ACTIVE'],
    )
    res.json({ success: true, date: attendanceDate, classId, termId, records: rows })
  } catch (error) {
    fail(res, 'load attendance register', error)
  }
})

router.post('/attendance', async (req: AuthenticatedRequest, res) => {
  const classId = parseId(req.body?.classId)
  const termId = parseId(req.body?.termId)
  const attendanceDate = parseDate(req.body?.date)
  const input = req.body?.records
  if (!classId || !termId || !attendanceDate || !Array.isArray(input) || input.length < 1 || input.length > 500) {
    res.status(400).json({ success: false, message: 'Provide a class, term, date and between 1 and 500 attendance records' })
    return
  }

  const records: Array<{ studentId: number; status: AttendanceStatus; note: string | null }> = []
  const ids = new Set<number>()
  for (const raw of input as Array<Record<string, unknown>>) {
    const studentId = parseId(raw?.studentId)
    const status = raw?.status
    const note = parseOptionalText(raw?.note, 255)
    if (!studentId || !attendanceStatuses.includes(status as AttendanceStatus) || note === undefined || ids.has(studentId)) {
      res.status(400).json({ success: false, message: 'Each attendance record needs a unique active student, valid status and note up to 255 characters' })
      return
    }
    ids.add(studentId)
    records.push({ studentId, status: status as AttendanceStatus, note: note ?? null })
  }

  try {
    const saved = await withTransaction(async (connection) => {
      const [eligibleRows] = await connection.execute(
        'SELECT s.id FROM student_enrollments e INNER JOIN terms t ON t.id = ? AND t.academic_year_id = e.academic_year_id INNER JOIN students s ON s.id = e.student_id WHERE e.class_id = ? AND (e.term_id = t.id OR e.term_id IS NULL) AND e.enrollment_status = ? AND s.status = ? AND s.id IN (?)',
        [termId, classId, 'ACTIVE', 'ACTIVE', records.map((record) => record.studentId)],
      )
      const eligible = new Set((eligibleRows as Array<{ id: number }>).map((row) => Number(row.id)))
      if (eligible.size !== records.length) throw new OperationError('One or more students are not actively enrolled in this class and term', 409)

      for (const record of records) {
        await connection.execute(
          'INSERT INTO attendance_records (student_id, class_id, term_id, attendance_date, status, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), term_id = VALUES(term_id), status = VALUES(status), note = VALUES(note), recorded_by = VALUES(recorded_by)',
          [record.studentId, classId, termId, attendanceDate, record.status, record.note, req.user!.id],
        )
      }
      await audit(connection, req, 'ATTENDANCE_REGISTER_SAVED', 'attendance', null, {
        classId, termId, date: attendanceDate, recordCount: records.length,
      })
      return records.length
    })
    res.json({ success: true, saved, message: 'Attendance register saved' })
  } catch (error) {
    fail(res, 'save attendance register', error)
  }
})

// -----------------------------------------------------------------------------
// Assessments and marks.
// -----------------------------------------------------------------------------
router.get('/assessments', async (req, res) => {
  const termId = req.query.termId === undefined ? null : parseId(req.query.termId)
  const classId = req.query.classId === undefined ? null : parseId(req.query.classId)
  if ((req.query.termId !== undefined && !termId) || (req.query.classId !== undefined && !classId)) {
    res.status(400).json({ success: false, message: 'Invalid term or class filter' })
    return
  }
  try {
    const [rows] = await pool.execute(
      'SELECT a.id, a.term_id AS termId, t.name AS termName, t.academic_year_id AS academicYearId, y.name AS academicYearName, a.class_id AS classId, c.name AS className, a.subject_id AS subjectId, s.code AS subjectCode, s.name AS subjectName, a.title, a.assessment_type AS assessmentType, a.max_score AS maxScore, a.assessment_date AS assessmentDate, COUNT(ar.id) AS markedCount FROM assessments a INNER JOIN terms t ON t.id = a.term_id INNER JOIN academic_years y ON y.id = t.academic_year_id INNER JOIN classes c ON c.id = a.class_id INNER JOIN subjects s ON s.id = a.subject_id LEFT JOIN assessment_results ar ON ar.assessment_id = a.id WHERE (? IS NULL OR a.term_id = ?) AND (? IS NULL OR a.class_id = ?) GROUP BY a.id ORDER BY a.assessment_date DESC, a.id DESC',
      [termId, termId, classId, classId],
    )
    res.json({ success: true, assessments: rows })
  } catch (error) {
    fail(res, 'load assessments', error)
  }
})

router.post('/assessments', async (req: AuthenticatedRequest, res) => {
  const termId = parseId(req.body?.termId)
  const classId = parseId(req.body?.classId)
  const subjectId = parseId(req.body?.subjectId)
  const title = parseText(req.body?.title, 150)
  const assessmentType = req.body?.assessmentType
  const maxScore = parseNumber(req.body?.maxScore)
  const assessmentDate = parseDate(req.body?.assessmentDate)
  if (!termId || !classId || !subjectId || !title || !assessmentTypes.includes(assessmentType as AssessmentType) || maxScore === null || maxScore <= 0 || maxScore > 1000000 || !assessmentDate) {
    res.status(400).json({ success: false, message: 'Provide a title, term, class, subject, assessment type, positive maximum score and valid date' })
    return
  }

  try {
    const [validRows] = await pool.execute(
      'SELECT t.id FROM terms t INNER JOIN classes c ON c.id = ? INNER JOIN subjects s ON s.id = ? WHERE t.id = ? LIMIT 1',
      [classId, subjectId, termId],
    )
    if (!(validRows as unknown[]).length) {
      res.status(400).json({ success: false, message: 'The selected term, class or subject does not exist' })
      return
    }
    const assessmentId = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO assessments (term_id, class_id, subject_id, title, assessment_type, max_score, assessment_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [termId, classId, subjectId, title, assessmentType, maxScore, assessmentDate, req.user!.id],
      )
      const id = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'ASSESSMENT_CREATED', 'assessment', id, { title, termId, classId, subjectId, maxScore, assessmentDate })
      return id
    })
    res.status(201).json({ success: true, assessmentId, message: 'Assessment created' })
  } catch (error) {
    fail(res, 'create assessment', error)
  }
})

router.get('/assessments/:assessmentId/results', async (req, res) => {
  const assessmentId = parseId(req.params.assessmentId)
  if (!assessmentId) {
    res.status(400).json({ success: false, message: 'A valid assessment ID is required' })
    return
  }
  try {
    const [assessmentRows] = await pool.execute(
      'SELECT a.id, a.term_id AS termId, t.name AS termName, t.academic_year_id AS academicYearId, a.class_id AS classId, c.name AS className, a.subject_id AS subjectId, s.name AS subjectName, a.title, a.assessment_type AS assessmentType, a.max_score AS maxScore, a.assessment_date AS assessmentDate FROM assessments a INNER JOIN terms t ON t.id = a.term_id INNER JOIN classes c ON c.id = a.class_id INNER JOIN subjects s ON s.id = a.subject_id WHERE a.id = ? LIMIT 1',
      [assessmentId],
    )
    const assessment = (assessmentRows as Record<string, unknown>[])[0]
    if (!assessment) {
      res.status(404).json({ success: false, message: 'Assessment not found' })
      return
    }
    const [recordRows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, ar.score, ar.remarks FROM assessments a INNER JOIN terms t ON t.id = a.term_id INNER JOIN student_enrollments e ON e.class_id = a.class_id AND e.academic_year_id = t.academic_year_id AND (e.term_id = a.term_id OR e.term_id IS NULL) INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN assessment_results ar ON ar.assessment_id = a.id AND ar.student_id = s.id WHERE a.id = ? AND e.enrollment_status = ? AND s.status = ? ORDER BY u.last_name, u.first_name',
      [assessmentId, 'ACTIVE', 'ACTIVE'],
    )
    res.json({ success: true, assessment, records: recordRows })
  } catch (error) {
    fail(res, 'load assessment results', error)
  }
})

router.post('/assessments/:assessmentId/results', async (req: AuthenticatedRequest, res) => {
  const assessmentId = parseId(req.params.assessmentId)
  const input = req.body?.records
  if (!assessmentId || !Array.isArray(input) || input.length < 1 || input.length > 500) {
    res.status(400).json({ success: false, message: 'Provide a valid assessment and between 1 and 500 result rows' })
    return
  }
  try {
    const [assessmentRows] = await pool.execute(
      'SELECT a.id, a.term_id AS termId, a.class_id AS classId, a.max_score AS maxScore FROM assessments a WHERE a.id = ? LIMIT 1',
      [assessmentId],
    )
    const assessment = (assessmentRows as Record<string, unknown>[])[0]
    if (!assessment) {
      res.status(404).json({ success: false, message: 'Assessment not found' })
      return
    }
    const maxScore = Number(assessment.maxScore)
    const records: Array<{ studentId: number; score: number | null; remarks: string | null }> = []
    const ids = new Set<number>()
    for (const raw of input as Array<Record<string, unknown>>) {
      const studentId = parseId(raw?.studentId)
      const score = raw?.score === '' || raw?.score === undefined || raw?.score === null ? null : parseNumber(raw.score)
      const remarks = parseOptionalText(raw?.remarks, 255)
      if (!studentId || (raw?.score !== '' && raw?.score !== undefined && raw?.score !== null && (score === null || score < 0 || score > maxScore)) || remarks === undefined || ids.has(studentId)) {
        res.status(400).json({ success: false, message: 'Scores must be blank or between zero and the assessment maximum; remarks are limited to 255 characters' })
        return
      }
      ids.add(studentId)
      records.push({ studentId, score, remarks: remarks ?? null })
    }

    const saved = await withTransaction(async (connection) => {
      const [eligibleRows] = await connection.execute(
        'SELECT s.id FROM student_enrollments e INNER JOIN terms t ON t.id = ? AND t.academic_year_id = e.academic_year_id INNER JOIN students s ON s.id = e.student_id WHERE e.class_id = ? AND (e.term_id = t.id OR e.term_id IS NULL) AND e.enrollment_status = ? AND s.status = ? AND s.id IN (?)',
        [Number(assessment.termId), Number(assessment.classId), 'ACTIVE', 'ACTIVE', records.map((record) => record.studentId)],
      )
      const eligible = new Set((eligibleRows as Array<{ id: number }>).map((row) => Number(row.id)))
      if (eligible.size !== records.length) throw new OperationError('One or more students are not actively enrolled in this assessment class and term', 409)
      for (const record of records) {
        if (record.score === null) {
          await connection.execute('DELETE FROM assessment_results WHERE assessment_id = ? AND student_id = ?', [assessmentId, record.studentId])
        } else {
          await connection.execute(
            'INSERT INTO assessment_results (assessment_id, student_id, score, remarks) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score), remarks = VALUES(remarks)',
            [assessmentId, record.studentId, record.score, record.remarks],
          )
        }
      }
      await audit(connection, req, 'ASSESSMENT_RESULTS_SAVED', 'assessment', assessmentId, { recordCount: records.length })
      return records.length
    })
    res.json({ success: true, saved, message: 'Assessment results saved' })
  } catch (error) {
    fail(res, 'save assessment results', error)
  }
})

// Report cards are generated from recorded assessment scores and attendance,
// not from client-calculated or fabricated totals.
router.get('/report-cards', async (req, res) => {
  const termId = parseId(req.query.termId)
  const classId = parseId(req.query.classId)
  if (!termId || !classId) {
    res.status(400).json({ success: false, message: 'Select a term and class' })
    return
  }
  try {
    const [rows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, rc.average_score AS averageScore, rc.class_position AS classPosition, rc.attendance_percentage AS attendancePercentage, rc.general_comment AS generalComment, rc.generated_at AS generatedAt FROM student_enrollments e INNER JOIN terms t ON t.id = ? AND t.academic_year_id = e.academic_year_id INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN report_cards rc ON rc.term_id = t.id AND rc.student_id = s.id WHERE e.class_id = ? AND (e.term_id = t.id OR e.term_id IS NULL) AND e.enrollment_status = ? ORDER BY rc.class_position IS NULL, rc.class_position, u.last_name, u.first_name',
      [termId, classId, 'ACTIVE'],
    )
    res.json({ success: true, termId, classId, reportCards: rows })
  } catch (error) {
    fail(res, 'load report cards', error)
  }
})

router.post('/report-cards/generate', async (req: AuthenticatedRequest, res) => {
  const termId = parseId(req.body?.termId)
  const classId = parseId(req.body?.classId)
  if (!termId || !classId) {
    res.status(400).json({ success: false, message: 'Select a term and class to generate report cards' })
    return
  }
  try {
    const [rows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, (SELECT ROUND(AVG(ar.score / NULLIF(a.max_score, 0) * 100), 2) FROM assessment_results ar INNER JOIN assessments a ON a.id = ar.assessment_id WHERE ar.student_id = s.id AND a.term_id = ? AND a.class_id = ?) AS averageScore, (SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE ROUND(SUM(CASE WHEN att.status IN (?, ?) THEN 1 ELSE 0 END) * 100 / COUNT(*), 2) END FROM attendance_records att WHERE att.student_id = s.id AND att.term_id = ?) AS attendancePercentage FROM student_enrollments e INNER JOIN terms t ON t.id = ? AND t.academic_year_id = e.academic_year_id INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id WHERE e.class_id = ? AND (e.term_id = t.id OR e.term_id IS NULL) AND e.enrollment_status = ? AND s.status = ? ORDER BY averageScore IS NULL, averageScore DESC, u.last_name, u.first_name',
      [termId, classId, 'PRESENT', 'LATE', termId, termId, classId, 'ACTIVE', 'ACTIVE'],
    )
    const reportRows = rows as Array<Record<string, unknown>>
    if (!reportRows.length) {
      res.status(409).json({ success: false, message: 'No actively enrolled students were found for this class and term' })
      return
    }

    let previousScore: number | null = null
    let currentRank = 0
    const generated: Array<{
      studentId: number
      admissionNumber: string
      firstName: string
      lastName: string
      averageScore: number | null
      classPosition: number | null
      attendancePercentage: number | null
    }> = reportRows.map((row, index) => {
      const avg = row.averageScore === null ? null : Number(row.averageScore)
      if (avg !== null && avg !== previousScore) currentRank = index + 1
      if (avg !== null) previousScore = avg
      return {
        studentId: Number(row.studentId),
        admissionNumber: String(row.admissionNumber),
        firstName: String(row.firstName),
        lastName: String(row.lastName),
        averageScore: avg,
        classPosition: avg === null ? null : currentRank,
        attendancePercentage: row.attendancePercentage === null ? null : Number(row.attendancePercentage),
      }
    })

    await withTransaction(async (connection) => {
      for (const row of generated) {
        await connection.execute(
          'INSERT INTO report_cards (term_id, student_id, average_score, class_position, attendance_percentage, generated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE average_score = VALUES(average_score), class_position = VALUES(class_position), attendance_percentage = VALUES(attendance_percentage), generated_at = CURRENT_TIMESTAMP',
          [termId, Number(row.studentId), row.averageScore, row.classPosition, row.attendancePercentage === null ? null : Number(row.attendancePercentage)],
        )
      }
      await audit(connection, req, 'REPORT_CARDS_GENERATED', 'report_card', null, { termId, classId, studentCount: generated.length })
    })
    res.json({ success: true, reportCards: generated, message: 'Report cards generated from recorded marks and attendance' })
  } catch (error) {
    fail(res, 'generate report cards', error)
  }
})

// -----------------------------------------------------------------------------
// Timetable records with collision detection for the selected class/stream and
// teacher. Day of week uses 1=Monday through 7=Sunday.
// -----------------------------------------------------------------------------
router.get('/timetable/options', async (_req, res) => {
  try {
    const [classes, streams, subjects, years, terms, teachers] = await Promise.all([
      pool.execute('SELECT id, name FROM classes ORDER BY name'),
      pool.execute('SELECT st.id, st.class_id AS classId, c.name AS className, st.name FROM streams st INNER JOIN classes c ON c.id = st.class_id ORDER BY c.name, st.name'),
      pool.execute('SELECT id, code, name FROM subjects ORDER BY name'),
      pool.execute('SELECT id, name, is_current AS isCurrent FROM academic_years ORDER BY starts_on DESC'),
      pool.execute('SELECT t.id, t.academic_year_id AS academicYearId, y.name AS academicYearName, t.name, t.sequence_no AS sequenceNo FROM terms t INNER JOIN academic_years y ON y.id = t.academic_year_id ORDER BY y.starts_on DESC, t.sequence_no'),
      pool.execute('SELECT tr.id, tr.employee_number AS employeeNumber, u.first_name AS firstName, u.last_name AS lastName FROM teachers tr INNER JOIN users u ON u.id = tr.user_id WHERE u.is_active = TRUE ORDER BY u.last_name, u.first_name'),
    ])
    res.json({
      success: true,
      classes: classes[0],
      streams: streams[0],
      subjects: subjects[0],
      years: years[0],
      terms: terms[0],
      teachers: teachers[0],
    })
  } catch (error) {
    fail(res, 'load timetable options', error)
  }
})

router.get('/timetable', async (req, res) => {
  const academicYearId = req.query.academicYearId === undefined ? null : parseId(req.query.academicYearId)
  const classId = req.query.classId === undefined ? null : parseId(req.query.classId)
  const termId = req.query.termId === undefined ? null : parseId(req.query.termId)
  if ((req.query.academicYearId !== undefined && !academicYearId) || (req.query.classId !== undefined && !classId) || (req.query.termId !== undefined && !termId)) {
    res.status(400).json({ success: false, message: 'Invalid timetable filter' })
    return
  }
  try {
    const [rows] = await pool.execute(
      'SELECT e.id, e.class_id AS classId, c.name AS className, e.stream_id AS streamId, st.name AS streamName, e.subject_id AS subjectId, s.code AS subjectCode, s.name AS subjectName, e.teacher_id AS teacherId, CONCAT_WS(" ", u.first_name, u.last_name) AS teacherName, e.day_of_week AS dayOfWeek, e.starts_at AS startsAt, e.ends_at AS endsAt, e.room, e.academic_year_id AS academicYearId, y.name AS academicYearName, e.term_id AS termId, t.name AS termName FROM timetable_entries e INNER JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id INNER JOIN subjects s ON s.id = e.subject_id LEFT JOIN teachers tr ON tr.id = e.teacher_id LEFT JOIN users u ON u.id = tr.user_id INNER JOIN academic_years y ON y.id = e.academic_year_id LEFT JOIN terms t ON t.id = e.term_id WHERE (? IS NULL OR e.academic_year_id = ?) AND (? IS NULL OR e.class_id = ?) AND (? IS NULL OR e.term_id = ?) ORDER BY e.day_of_week, e.starts_at, c.name',
      [academicYearId, academicYearId, classId, classId, termId, termId],
    )
    res.json({ success: true, entries: rows })
  } catch (error) {
    fail(res, 'load timetable', error)
  }
})

interface TimetableInput {
  classId: number
  streamId: number | null
  subjectId: number
  teacherId: number | null
  dayOfWeek: number
  startsAt: string
  endsAt: string
  room: string | null
  academicYearId: number
  termId: number | null
}

function parseTimetable(input: Record<string, unknown>): TimetableInput | null {
  const classId = parseId(input.classId)
  const streamId = input.streamId === '' || input.streamId === null || input.streamId === undefined ? null : parseId(input.streamId)
  const subjectId = parseId(input.subjectId)
  const teacherId = input.teacherId === '' || input.teacherId === null || input.teacherId === undefined ? null : parseId(input.teacherId)
  const dayOfWeek = parseNumber(input.dayOfWeek)
  const startsAt = parseTime(input.startsAt)
  const endsAt = parseTime(input.endsAt)
  const room = parseOptionalText(input.room, 100)
  const academicYearId = parseId(input.academicYearId)
  const termId = input.termId === '' || input.termId === null || input.termId === undefined ? null : parseId(input.termId)
  if (!classId || (input.streamId !== '' && input.streamId !== null && input.streamId !== undefined && !streamId) || !subjectId || (input.teacherId !== '' && input.teacherId !== null && input.teacherId !== undefined && !teacherId) || dayOfWeek === null || !Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7 || !startsAt || !endsAt || endsAt <= startsAt || room === undefined || !academicYearId || (input.termId !== '' && input.termId !== null && input.termId !== undefined && !termId)) return null
  return { classId, streamId, subjectId, teacherId, dayOfWeek, startsAt, endsAt, room: room ?? null, academicYearId, termId }
}

async function assertNoTimetableConflict(
  connection: PoolConnection,
  input: TimetableInput,
  ignoreId: number | null,
): Promise<void> {
  const [rows] = await connection.execute(
    'SELECT e.id FROM timetable_entries e WHERE e.day_of_week = ? AND e.academic_year_id = ? AND (e.term_id = ? OR e.term_id IS NULL OR ? IS NULL) AND e.starts_at < ? AND e.ends_at > ? AND ((e.class_id = ? AND (e.stream_id = ? OR e.stream_id IS NULL OR ? IS NULL)) OR (? IS NOT NULL AND e.teacher_id = ?)) AND (? IS NULL OR e.id <> ?) LIMIT 1',
    [input.dayOfWeek, input.academicYearId, input.termId, input.termId, input.endsAt, input.startsAt, input.classId, input.streamId, input.streamId, input.teacherId, input.teacherId, ignoreId, ignoreId],
  )
  if ((rows as unknown[]).length) throw new OperationError('This timetable entry conflicts with another class or teacher booking', 409)
}

router.post('/timetable', async (req: AuthenticatedRequest, res) => {
  const input = parseTimetable(req.body ?? {})
  if (!input) {
    res.status(400).json({ success: false, message: 'Provide a class, subject, year, day, valid start/end times and optional teacher/stream/room' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      await assertNoTimetableConflict(connection, input, null)
      const [result] = await connection.execute(
        'INSERT INTO timetable_entries (class_id, stream_id, subject_id, teacher_id, day_of_week, starts_at, ends_at, room, academic_year_id, term_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [input.classId, input.streamId, input.subjectId, input.teacherId, input.dayOfWeek, input.startsAt, input.endsAt, input.room, input.academicYearId, input.termId],
      )
      const id = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'TIMETABLE_ENTRY_CREATED', 'timetable_entry', id, { classId: input.classId, dayOfWeek: input.dayOfWeek, startsAt: input.startsAt, endsAt: input.endsAt })
      return id
    })
    res.status(201).json({ success: true, id, message: 'Timetable entry created' })
  } catch (error) {
    fail(res, 'create timetable entry', error)
  }
})

router.patch('/timetable/:entryId', async (req: AuthenticatedRequest, res) => {
  const id = parseId(req.params.entryId)
  const input = parseTimetable(req.body ?? {})
  if (!id || !input) {
    res.status(400).json({ success: false, message: 'A valid entry ID and timetable details are required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM timetable_entries WHERE id = ? FOR UPDATE', [id])
      if (!(existing as unknown[]).length) return false
      await assertNoTimetableConflict(connection, input, id)
      await connection.execute(
        'UPDATE timetable_entries SET class_id = ?, stream_id = ?, subject_id = ?, teacher_id = ?, day_of_week = ?, starts_at = ?, ends_at = ?, room = ?, academic_year_id = ?, term_id = ? WHERE id = ?',
        [input.classId, input.streamId, input.subjectId, input.teacherId, input.dayOfWeek, input.startsAt, input.endsAt, input.room, input.academicYearId, input.termId, id],
      )
      await audit(connection, req, 'TIMETABLE_ENTRY_UPDATED', 'timetable_entry', id, { classId: input.classId, dayOfWeek: input.dayOfWeek, startsAt: input.startsAt, endsAt: input.endsAt })
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Timetable entry not found' })
      return
    }
    res.json({ success: true, message: 'Timetable entry updated' })
  } catch (error) {
    fail(res, 'update timetable entry', error)
  }
})

router.delete('/timetable/:entryId', async (req: AuthenticatedRequest, res) => {
  const id = parseId(req.params.entryId)
  if (!id) {
    res.status(400).json({ success: false, message: 'A valid timetable entry ID is required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM timetable_entries WHERE id = ? FOR UPDATE', [id])
      if (!(existing as unknown[]).length) return false
      await connection.execute('DELETE FROM timetable_entries WHERE id = ?', [id])
      await audit(connection, req, 'TIMETABLE_ENTRY_DELETED', 'timetable_entry', id, {})
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Timetable entry not found' })
      return
    }
    res.json({ success: true, message: 'Timetable entry deleted' })
  } catch (error) {
    fail(res, 'delete timetable entry', error)
  }
})

// -----------------------------------------------------------------------------
// Fee structures, fee assignment, balances and receipt-backed payments.
// Payments are allocated against outstanding fee items in one transaction.
// -----------------------------------------------------------------------------
router.get('/fees/overview', async (_req, res) => {
  try {
    const [summaryRows] = await pool.execute(
      'SELECT COUNT(*) AS itemCount, COALESCE(SUM(amount_due), 0) AS totalDue, COALESCE(SUM(amount_paid), 0) AS totalPaid, COALESCE(SUM(amount_due - amount_paid), 0) AS outstanding, SUM(status = ?) AS unpaidItems, SUM(status = ?) AS partialItems, SUM(status = ?) AS paidItems FROM fee_items',
      ['UNPAID', 'PARTIAL', 'PAID'],
    )
    const [paymentRows] = await pool.execute(
      'SELECT COUNT(*) AS paymentCount, COALESCE(SUM(amount), 0) AS receivedTotal FROM payments',
    )
    res.json({ success: true, summary: (summaryRows as unknown[])[0], payments: (paymentRows as unknown[])[0] })
  } catch (error) {
    fail(res, 'load fee overview', error)
  }
})

router.get('/fees/structures', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT fs.id, fs.academic_year_id AS academicYearId, y.name AS academicYearName, fs.class_id AS classId, c.name AS className, fs.name, fs.amount, fs.due_date AS dueDate, fs.description, COUNT(fi.id) AS assignedCount FROM fee_structures fs INNER JOIN academic_years y ON y.id = fs.academic_year_id LEFT JOIN classes c ON c.id = fs.class_id LEFT JOIN fee_items fi ON fi.fee_structure_id = fs.id GROUP BY fs.id ORDER BY y.starts_on DESC, c.name, fs.name',
    )
    res.json({ success: true, structures: rows })
  } catch (error) {
    fail(res, 'load fee structures', error)
  }
})

router.post('/fees/structures', async (req: AuthenticatedRequest, res) => {
  const academicYearId = parseId(req.body?.academicYearId)
  const classId = req.body?.classId === '' || req.body?.classId === null || req.body?.classId === undefined ? null : parseId(req.body.classId)
  const name = parseText(req.body?.name, 150)
  const amount = parseNumber(req.body?.amount)
  const dueDate = req.body?.dueDate === '' || req.body?.dueDate === null || req.body?.dueDate === undefined ? null : parseDate(req.body.dueDate)
  const description = parseOptionalText(req.body?.description, 255)
  if (!academicYearId || (req.body?.classId !== '' && req.body?.classId !== null && req.body?.classId !== undefined && !classId) || !name || amount === null || amount <= 0 || amount > 100000000000 || (req.body?.dueDate && !dueDate) || description === undefined) {
    res.status(400).json({ success: false, message: 'Provide a year, name, positive amount, optional valid due date and description up to 255 characters' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO fee_structures (academic_year_id, class_id, name, amount, due_date, description) VALUES (?, ?, ?, ?, ?, ?)',
        [academicYearId, classId, name, amount, dueDate, description ?? null],
      )
      const id = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'FEE_STRUCTURE_CREATED', 'fee_structure', id, { academicYearId, classId, name, amount })
      return id
    })
    res.status(201).json({ success: true, id, message: 'Fee structure created' })
  } catch (error) {
    fail(res, 'create fee structure', error)
  }
})

router.patch('/fees/structures/:structureId', async (req: AuthenticatedRequest, res) => {
  const id = parseId(req.params.structureId)
  const academicYearId = parseId(req.body?.academicYearId)
  const classId = req.body?.classId === '' || req.body?.classId === null || req.body?.classId === undefined ? null : parseId(req.body.classId)
  const name = parseText(req.body?.name, 150)
  const amount = parseNumber(req.body?.amount)
  const dueDate = req.body?.dueDate === '' || req.body?.dueDate === null || req.body?.dueDate === undefined ? null : parseDate(req.body.dueDate)
  const description = parseOptionalText(req.body?.description, 255)
  if (!id || !academicYearId || (req.body?.classId !== '' && req.body?.classId !== null && req.body?.classId !== undefined && !classId) || !name || amount === null || amount <= 0 || (req.body?.dueDate && !dueDate) || description === undefined) {
    res.status(400).json({ success: false, message: 'Provide a valid fee structure and details' })
    return
  }
  try {
    const exists = await withTransaction(async (connection) => {
      const [rows] = await connection.execute('SELECT id FROM fee_structures WHERE id = ? FOR UPDATE', [id])
      if (!(rows as unknown[]).length) return false
      await connection.execute(
        'UPDATE fee_structures SET academic_year_id = ?, class_id = ?, name = ?, amount = ?, due_date = ?, description = ? WHERE id = ?',
        [academicYearId, classId, name, amount, dueDate, description ?? null, id],
      )
      await audit(connection, req, 'FEE_STRUCTURE_UPDATED', 'fee_structure', id, { name, amount, academicYearId, classId })
      return true
    })
    if (!exists) {
      res.status(404).json({ success: false, message: 'Fee structure not found' })
      return
    }
    res.json({ success: true, message: 'Fee structure updated' })
  } catch (error) {
    fail(res, 'update fee structure', error)
  }
})

router.delete('/fees/structures/:structureId', async (req: AuthenticatedRequest, res) => {
  const id = parseId(req.params.structureId)
  if (!id) {
    res.status(400).json({ success: false, message: 'A valid fee structure ID is required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [items] = await connection.execute('SELECT id FROM fee_items WHERE fee_structure_id = ? LIMIT 1', [id])
      if ((items as unknown[]).length) throw new OperationError('This fee structure already has assigned student balances and cannot be deleted', 409)
      const [existing] = await connection.execute('SELECT id FROM fee_structures WHERE id = ? FOR UPDATE', [id])
      if (!(existing as unknown[]).length) return false
      await connection.execute('DELETE FROM fee_structures WHERE id = ?', [id])
      await audit(connection, req, 'FEE_STRUCTURE_DELETED', 'fee_structure', id, {})
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Fee structure not found' })
      return
    }
    res.json({ success: true, message: 'Fee structure deleted' })
  } catch (error) {
    fail(res, 'delete fee structure', error)
  }
})

router.get('/fees/items', async (req, res) => {
  const studentId = req.query.studentId === undefined ? null : parseId(req.query.studentId)
  const status = req.query.status === undefined ? null : String(req.query.status)
  if ((req.query.studentId !== undefined && !studentId) || (status !== null && !['UNPAID', 'PARTIAL', 'PAID', 'WAIVED'].includes(status))) {
    res.status(400).json({ success: false, message: 'Invalid fee item filter' })
    return
  }
  try {
    const [rows] = await pool.execute(
      'SELECT fi.id, fi.student_id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, fi.fee_structure_id AS feeStructureId, fs.name AS feeName, fs.academic_year_id AS academicYearId, y.name AS academicYearName, fi.amount_due AS amountDue, fi.amount_paid AS amountPaid, fi.status, (fi.amount_due - fi.amount_paid) AS balance FROM fee_items fi INNER JOIN students s ON s.id = fi.student_id INNER JOIN users u ON u.id = s.user_id INNER JOIN fee_structures fs ON fs.id = fi.fee_structure_id INNER JOIN academic_years y ON y.id = fs.academic_year_id WHERE (? IS NULL OR fi.student_id = ?) AND (? IS NULL OR fi.status = ?) ORDER BY fi.status, u.last_name, u.first_name, fs.name',
      [studentId, studentId, status, status],
    )
    res.json({ success: true, items: rows })
  } catch (error) {
    fail(res, 'load student fee items', error)
  }
})

router.post('/fees/assign', async (req: AuthenticatedRequest, res) => {
  const feeStructureId = parseId(req.body?.feeStructureId)
  const studentIds = req.body?.studentIds
  if (!feeStructureId || !Array.isArray(studentIds) || studentIds.length < 1 || studentIds.length > 1000) {
    res.status(400).json({ success: false, message: 'Select a fee structure and between 1 and 1000 students' })
    return
  }
  const ids = studentIds.map(parseId)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    res.status(400).json({ success: false, message: 'Student IDs must be valid and unique' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [structureRows] = await connection.execute('SELECT id, amount, class_id AS classId FROM fee_structures WHERE id = ? FOR UPDATE', [feeStructureId])
      const structure = (structureRows as Record<string, unknown>[])[0]
      if (!structure) throw new OperationError('Fee structure not found', 404)
      const [studentRows] = await connection.execute('SELECT id FROM students WHERE id IN (?) AND status = ?', [ids, 'ACTIVE'])
      const activeStudentIds = new Set((studentRows as Array<{ id: number }>).map((row) => Number(row.id)))
      if (activeStudentIds.size !== ids.length) throw new OperationError('One or more students are not active', 409)
      let assigned = 0
      let skipped = 0
      for (const studentId of ids as number[]) {
        const [existing] = await connection.execute('SELECT id FROM fee_items WHERE student_id = ? AND fee_structure_id = ? LIMIT 1', [studentId, feeStructureId])
        if ((existing as unknown[]).length) {
          skipped += 1
          continue
        }
        await connection.execute(
          'INSERT INTO fee_items (student_id, fee_structure_id, amount_due, amount_paid, status) VALUES (?, ?, ?, 0, ?)',
          [studentId, feeStructureId, Number(structure.amount), 'UNPAID'],
        )
        assigned += 1
      }
      await audit(connection, req, 'FEES_ASSIGNED', 'fee_structure', feeStructureId, { assigned, skipped, studentIds: ids })
      return { assigned, skipped }
    })
    res.status(201).json({ success: true, ...result, message: 'Fee assignment processed' })
  } catch (error) {
    fail(res, 'assign fees', error)
  }
})

router.get('/fees/payments', async (req, res) => {
  const studentId = req.query.studentId === undefined ? null : parseId(req.query.studentId)
  if (req.query.studentId !== undefined && !studentId) {
    res.status(400).json({ success: false, message: 'Invalid student filter' })
    return
  }
  try {
    const [rows] = await pool.execute(
      'SELECT p.id, p.receipt_number AS receiptNumber, p.student_id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, p.invoice_id AS invoiceId, p.amount, p.payment_method AS paymentMethod, p.reference, p.paid_at AS paidAt, CONCAT_WS(" ", receiver.first_name, receiver.last_name) AS receivedBy FROM payments p INNER JOIN students s ON s.id = p.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN users receiver ON receiver.id = p.received_by WHERE (? IS NULL OR p.student_id = ?) ORDER BY p.paid_at DESC LIMIT 200',
      [studentId, studentId],
    )
    res.json({ success: true, payments: rows })
  } catch (error) {
    fail(res, 'load payment records', error)
  }
})

router.post('/fees/payments', async (req: AuthenticatedRequest, res) => {
  const studentId = parseId(req.body?.studentId)
  const amount = parseNumber(req.body?.amount)
  const paymentMethod = req.body?.paymentMethod
  const reference = parseOptionalText(req.body?.reference, 100)
  if (!studentId || amount === null || amount <= 0 || amount > 100000000000 || !paymentMethods.includes(paymentMethod as PaymentMethod) || reference === undefined) {
    res.status(400).json({ success: false, message: 'Provide a student, positive amount, valid payment method and optional reference up to 100 characters' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [items] = await connection.execute(
        'SELECT id, amount_due AS amountDue, amount_paid AS amountPaid FROM fee_items WHERE student_id = ? AND status IN (?, ?) ORDER BY id FOR UPDATE',
        [studentId, 'UNPAID', 'PARTIAL'],
      )
      const feeItems = items as Array<{ id: number; amountDue: number | string; amountPaid: number | string }>
      const outstanding = feeItems.reduce((sum, item) => sum + Number(item.amountDue) - Number(item.amountPaid), 0)
      if (!feeItems.length || amount - outstanding > 0.00001) throw new OperationError('Payment exceeds the student’s outstanding assigned fees', 409)

      const receiptNumber = 'ESM-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + randomBytes(3).toString('hex').toUpperCase()
      const [paymentResult] = await connection.execute(
        'INSERT INTO payments (invoice_id, student_id, receipt_number, amount, payment_method, reference, received_by) VALUES (NULL, ?, ?, ?, ?, ?, ?)',
        [studentId, receiptNumber, amount, paymentMethod, reference ?? null, req.user!.id],
      )
      const paymentId = Number((paymentResult as { insertId: number }).insertId)
      let remaining = amount
      for (const item of feeItems) {
        if (remaining <= 0.00001) break
        const due = Number(item.amountDue)
        const paid = Number(item.amountPaid)
        const balance = Math.max(0, due - paid)
        const allocation = Math.min(balance, remaining)
        const nextPaid = paid + allocation
        const nextStatus = nextPaid >= due - 0.00001 ? 'PAID' : 'PARTIAL'
        await connection.execute('UPDATE fee_items SET amount_paid = ?, status = ? WHERE id = ?', [nextPaid, nextStatus, item.id])
        remaining -= allocation
      }
      await audit(connection, req, 'FEE_PAYMENT_RECORDED', 'payment', paymentId, { studentId, amount, paymentMethod, receiptNumber })
      return { paymentId, receiptNumber, studentId, amount, paymentMethod }
    })
    res.status(201).json({ success: true, payment: result, message: 'Payment recorded and allocated against outstanding fees' })
  } catch (error) {
    fail(res, 'record fee payment', error)
  }
})

// -----------------------------------------------------------------------------
// Broadcast messages: recipient rows, user notifications and audit log entries
// are written together so the UI never reports a partial send as successful.
// -----------------------------------------------------------------------------
router.get('/messages', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT m.id, m.subject, m.body, m.sent_at AS sentAt, m.sender_user_id AS senderUserId, CONCAT_WS(" ", sender.first_name, sender.last_name) AS senderName, COUNT(mr.recipient_user_id) AS recipientCount, SUM(mr.read_at IS NOT NULL) AS readCount FROM messages m INNER JOIN users sender ON sender.id = m.sender_user_id LEFT JOIN message_recipients mr ON mr.message_id = m.id GROUP BY m.id ORDER BY m.sent_at DESC LIMIT 100',
    )
    res.json({ success: true, messages: rows })
  } catch (error) {
    fail(res, 'load school messages', error)
  }
})

router.post('/messages', async (req: AuthenticatedRequest, res) => {
  const subject = parseText(req.body?.subject, 200)
  const body = parseText(req.body?.body, 20000)
  const audience = typeof req.body?.audience === 'string' ? req.body.audience : ''
  if (!subject || !body || (audience !== 'ALL' && !userRoles.includes(audience as typeof userRoles[number]))) {
    res.status(400).json({ success: false, message: 'Provide a subject, message body and a valid recipient audience' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [recipientRows] = await connection.execute(
        'SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE u.is_active = TRUE AND (? = ? OR r.name = ?) ORDER BY u.id',
        [audience, 'ALL', audience],
      )
      const recipientIds = (recipientRows as Array<{ id: number }>).map((row) => Number(row.id))
      if (!recipientIds.length) throw new OperationError('No active users match the selected audience', 409)
      const [messageResult] = await connection.execute(
        'INSERT INTO messages (sender_user_id, subject, body) VALUES (?, ?, ?)',
        [req.user!.id, subject, body],
      )
      const messageId = Number((messageResult as { insertId: number }).insertId)
      for (const recipientId of recipientIds) {
        await connection.execute('INSERT INTO message_recipients (message_id, recipient_user_id) VALUES (?, ?)', [messageId, recipientId])
        await connection.execute(
          'INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)',
          [recipientId, subject, body.slice(0, 5000), 'message'],
        )
      }
      await audit(connection, req, 'SCHOOL_MESSAGE_SENT', 'message', messageId, { subject, audience, recipientCount: recipientIds.length })
      return { id: messageId, subject, audience, recipientCount: recipientIds.length }
    })
    res.status(201).json({ success: true, message: result, messageText: 'Message delivered to the active users selected by the audience' })
  } catch (error) {
    fail(res, 'send school message', error)
  }
})

router.get('/messages/:messageId/recipients', async (req, res) => {
  const messageId = parseId(req.params.messageId)
  if (!messageId) {
    res.status(400).json({ success: false, message: 'A valid message ID is required' })
    return
  }
  try {
    const [rows] = await pool.execute(
      'SELECT mr.recipient_user_id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email, r.name AS role, mr.read_at AS readAt FROM message_recipients mr INNER JOIN users u ON u.id = mr.recipient_user_id INNER JOIN roles r ON r.id = u.role_id WHERE mr.message_id = ? ORDER BY u.last_name, u.first_name',
      [messageId],
    )
    res.json({ success: true, recipients: rows })
  } catch (error) {
    fail(res, 'load message recipients', error)
  }
})

export default router
