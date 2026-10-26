import { Router, type Response } from 'express'

import { isDatabaseUnavailable, pool, type PoolConnection } from '../config/database.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.js'
import type { AuthUser } from '../types/auth.js'

const router = Router()
router.use(requireAuth, requireRole('TEACHER'))

type Row = Record<string, unknown>
const assessmentTypes = ['TEST', 'QUIZ', 'ASSIGNMENT', 'MIDTERM', 'FINAL', 'PRACTICAL', 'OTHER'] as const
const attendanceStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const

function parseId(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function reportFailure(res: Response, error: unknown, action: string): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
    return
  }
  const code = (error as { code?: string } | null)?.code
  if (code === '23505' || code === 'ER_DUP_ENTRY') {
    res.status(409).json({ success: false, message: 'A conflicting school record already exists' })
    return
  }
  console.error(`Teacher portal ${action} failed`, error)
  res.status(500).json({ success: false, message: 'Unable to complete this teacher portal request' })
}

async function withTransaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T> {
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
      console.error('Unable to roll back teacher transaction', rollbackError)
    }
    throw error
  } finally {
    connection.release()
  }
}

async function getTeacher(userId: number): Promise<Row | null> {
  const [rows] = await pool.execute(
    'SELECT t.id AS teacherId, t.employee_number AS employeeNumber, t.qualification, t.department, u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone FROM teachers t INNER JOIN users u ON u.id = t.user_id WHERE t.user_id = ? LIMIT 1',
    [userId],
  )
  return (rows as Row[])[0] ?? null
}

async function hasClassAssignment(
  teacherId: number,
  classId: number,
  academicYearId: number,
  subjectId?: number,
  connection: PoolConnection | typeof pool = pool,
): Promise<boolean> {
  const query = subjectId === undefined
    ? 'SELECT ts.id FROM teacher_subjects ts WHERE ts.teacher_id = ? AND ts.class_id = ? AND ts.academic_year_id = ? LIMIT 1'
    : 'SELECT ts.id FROM teacher_subjects ts WHERE ts.teacher_id = ? AND ts.class_id = ? AND ts.academic_year_id = ? AND ts.subject_id = ? LIMIT 1'
  const values = subjectId === undefined
    ? [teacherId, classId, academicYearId]
    : [teacherId, classId, academicYearId, subjectId]
  const [rows] = await connection.execute(query, values)
  return (rows as Row[]).length > 0
}

async function writeTeacherAudit(
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

router.get('/overview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found. Ask the school administrator to link your account.' })
      return
    }
    const [counts] = await pool.execute(
      'SELECT COUNT(DISTINCT ts.class_id) AS assignedClasses, COUNT(DISTINCT ts.subject_id) AS assignedSubjects FROM teacher_subjects ts INNER JOIN academic_years ay ON ay.id = ts.academic_year_id WHERE ts.teacher_id = ? AND ay.is_current = TRUE',
      [Number(teacher.teacherId)],
    )
    const [upcoming] = await pool.execute(
      'SELECT te.id, te.day_of_week AS dayOfWeek, te.starts_at AS startsAt, te.ends_at AS endsAt, c.name AS className, sub.name AS subjectName, te.room FROM timetable_entries te INNER JOIN academic_years ay ON ay.id = te.academic_year_id INNER JOIN classes c ON c.id = te.class_id INNER JOIN subjects sub ON sub.id = te.subject_id WHERE te.teacher_id = ? AND ay.is_current = TRUE ORDER BY te.day_of_week, te.starts_at LIMIT 5',
      [Number(teacher.teacherId)],
    )
    res.json({ success: true, teacher, summary: (counts as Row[])[0] ?? {}, upcoming: upcoming as Row[] })
  } catch (error) {
    reportFailure(res, error, 'overview')
  }
})

router.get('/classes', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const [rows] = await pool.execute(
      'SELECT ts.class_id AS classId, c.name AS className, ts.subject_id AS subjectId, sub.code AS subjectCode, sub.name AS subjectName, ay.id AS academicYearId, ay.name AS academicYear, COUNT(DISTINCT e.student_id) AS studentCount FROM teacher_subjects ts INNER JOIN academic_years ay ON ay.id = ts.academic_year_id INNER JOIN classes c ON c.id = ts.class_id INNER JOIN subjects sub ON sub.id = ts.subject_id LEFT JOIN student_enrollments e ON e.class_id = ts.class_id AND e.academic_year_id = ts.academic_year_id AND e.enrollment_status = ? WHERE ts.teacher_id = ? AND ay.is_current = TRUE GROUP BY ts.class_id, c.name, ts.subject_id, sub.code, sub.name, ay.id, ay.name ORDER BY c.name, sub.name',
      ['ACTIVE', Number(teacher.teacherId)],
    )
    res.json({ success: true, assignments: rows })
  } catch (error) {
    reportFailure(res, error, 'classes')
  }
})

router.get('/classes/:classId/students', async (req: AuthenticatedRequest, res: Response) => {
  const classId = parseId(req.params.classId)
  const subjectId = req.query.subjectId === undefined ? undefined : parseId(String(req.query.subjectId))
  if (!classId || (req.query.subjectId !== undefined && !subjectId)) {
    res.status(400).json({ success: false, message: 'A valid class ID and optional subject ID are required' })
    return
  }

  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const [years] = await pool.execute('SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1')
    const academicYear = (years as Row[])[0]
    if (!academicYear) {
      res.json({ success: true, students: [] })
      return
    }
    const assigned = await hasClassAssignment(Number(teacher.teacherId), classId, Number(academicYear.id), subjectId)
    if (!assigned) {
      res.status(403).json({ success: false, message: 'You are not assigned to this class and subject' })
      return
    }
    const [rows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, s.status AS studentStatus, u.first_name AS firstName, u.last_name AS lastName, st.name AS streamName FROM student_enrollments e INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN streams st ON st.id = e.stream_id WHERE e.class_id = ? AND e.academic_year_id = ? AND e.enrollment_status = ? ORDER BY u.last_name, u.first_name',
      [classId, Number(academicYear.id), 'ACTIVE'],
    )
    res.json({ success: true, students: rows })
  } catch (error) {
    reportFailure(res, error, 'class roster')
  }
})

router.get('/timetable', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const [rows] = await pool.execute(
      'SELECT te.id, te.day_of_week AS dayOfWeek, te.starts_at AS startsAt, te.ends_at AS endsAt, te.room, c.name AS className, st.name AS streamName, sub.code AS subjectCode, sub.name AS subjectName, ay.name AS academicYear, t.name AS termName FROM timetable_entries te INNER JOIN academic_years ay ON ay.id = te.academic_year_id INNER JOIN classes c ON c.id = te.class_id LEFT JOIN streams st ON st.id = te.stream_id INNER JOIN subjects sub ON sub.id = te.subject_id LEFT JOIN terms t ON t.id = te.term_id WHERE te.teacher_id = ? AND ay.is_current = TRUE ORDER BY te.day_of_week, te.starts_at',
      [Number(teacher.teacherId)],
    )
    res.json({ success: true, timetable: rows })
  } catch (error) {
    reportFailure(res, error, 'timetable')
  }
})

router.get('/assessments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const [rows] = await pool.execute(
      'SELECT a.id, a.title, a.assessment_type AS assessmentType, a.assessment_date AS assessmentDate, a.max_score AS maxScore, a.class_id AS classId, c.name AS className, a.subject_id AS subjectId, sub.name AS subjectName, a.term_id AS termId, t.name AS termName, COUNT(ar.id) AS markedCount FROM assessments a INNER JOIN terms t ON t.id = a.term_id INNER JOIN academic_years ay ON ay.id = t.academic_year_id INNER JOIN classes c ON c.id = a.class_id INNER JOIN subjects sub ON sub.id = a.subject_id INNER JOIN teacher_subjects ts ON ts.class_id = a.class_id AND ts.subject_id = a.subject_id AND ts.academic_year_id = ay.id LEFT JOIN assessment_results ar ON ar.assessment_id = a.id WHERE ts.teacher_id = ? AND ay.is_current = TRUE GROUP BY a.id, c.name, sub.name, t.name ORDER BY a.assessment_date DESC, a.id DESC',
      [Number(teacher.teacherId)],
    )
    res.json({ success: true, assessments: rows })
  } catch (error) {
    reportFailure(res, error, 'assessments')
  }
})

router.post('/assessments', async (req: AuthenticatedRequest, res: Response) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 150) : ''
  const termId = parseId(String(req.body?.termId ?? ''))
  const classId = parseId(String(req.body?.classId ?? ''))
  const subjectId = parseId(String(req.body?.subjectId ?? ''))
  const assessmentType = typeof req.body?.assessmentType === 'string' ? req.body.assessmentType.trim().toUpperCase() : ''
  const maxScore = Number(req.body?.maxScore)
  const assessmentDate = req.body?.assessmentDate

  if (!title || !termId || !classId || !subjectId || !assessmentTypes.includes(assessmentType as typeof assessmentTypes[number]) || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1000 || !validDate(assessmentDate)) {
    res.status(400).json({ success: false, message: 'Provide a title, assigned class/subject, current term, valid assessment type, date and maximum score' })
    return
  }

  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const result = await withTransaction(async (connection) => {
      const [terms] = await connection.execute(
        'SELECT t.id, t.academic_year_id AS academicYearId, t.starts_on AS startsOn, t.ends_on AS endsOn FROM terms t INNER JOIN academic_years ay ON ay.id = t.academic_year_id WHERE t.id = ? AND ay.is_current = TRUE LIMIT 1 FOR UPDATE',
        [termId],
      )
      const term = (terms as Row[])[0]
      if (!term) return { ok: false as const, status: 400, message: 'Choose a term in the current academic year' }
      if (String(assessmentDate) < String(term.startsOn) || String(assessmentDate) > String(term.endsOn)) {
        return { ok: false as const, status: 400, message: 'Assessment date must fall inside the selected term' }
      }
      const assigned = await hasClassAssignment(Number(teacher.teacherId), classId, Number(term.academicYearId), subjectId, connection)
      if (!assigned) return { ok: false as const, status: 403, message: 'You are not assigned to this class and subject' }

      const [insertResult] = await connection.execute(
        'INSERT INTO assessments (term_id, class_id, subject_id, title, assessment_type, max_score, assessment_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [termId, classId, subjectId, title, assessmentType, maxScore, assessmentDate, req.user!.id],
      )
      const assessmentId = Number((insertResult as { insertId: number }).insertId)
      await writeTeacherAudit(connection, req, 'TEACHER_ASSESSMENT_CREATED', 'assessment', assessmentId, {
        classId, subjectId, termId, assessmentType, maxScore,
      })
      return { ok: true as const, assessmentId }
    })
    if (!result.ok) {
      res.status(result.status).json({ success: false, message: result.message })
      return
    }
    res.status(201).json({ success: true, assessmentId: result.assessmentId, message: 'Assessment created' })
  } catch (error) {
    reportFailure(res, error, 'create assessment')
  }
})

router.get('/assessments/:assessmentId/results', async (req: AuthenticatedRequest, res: Response) => {
  const assessmentId = parseId(req.params.assessmentId)
  if (!assessmentId) {
    res.status(400).json({ success: false, message: 'A valid assessment ID is required' })
    return
  }
  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const [assessmentRows] = await pool.execute(
      'SELECT a.id, a.title, a.max_score AS maxScore, a.class_id AS classId, a.subject_id AS subjectId, a.term_id AS termId, t.academic_year_id AS academicYearId, ay.is_current AS isCurrent FROM assessments a INNER JOIN terms t ON t.id = a.term_id INNER JOIN academic_years ay ON ay.id = t.academic_year_id INNER JOIN teacher_subjects ts ON ts.class_id = a.class_id AND ts.subject_id = a.subject_id AND ts.academic_year_id = ay.id WHERE a.id = ? AND ts.teacher_id = ? LIMIT 1',
      [assessmentId, Number(teacher.teacherId)],
    )
    const assessment = (assessmentRows as Row[])[0]
    if (!assessment) {
      res.status(404).json({ success: false, message: 'Assessment not found for your assignments' })
      return
    }
    const [students] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, ar.score, ar.remarks FROM student_enrollments e INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN assessment_results ar ON ar.student_id = s.id AND ar.assessment_id = ? WHERE e.class_id = ? AND e.academic_year_id = ? AND e.enrollment_status = ? ORDER BY u.last_name, u.first_name',
      [assessmentId, Number(assessment.classId), Number(assessment.academicYearId), 'ACTIVE'],
    )
    res.json({ success: true, assessment, students })
  } catch (error) {
    reportFailure(res, error, 'assessment results')
  }
})

router.post('/assessments/:assessmentId/results', async (req: AuthenticatedRequest, res: Response) => {
  const assessmentId = parseId(req.params.assessmentId)
  const input = req.body?.results
  if (!assessmentId || !Array.isArray(input) || input.length < 1 || input.length > 250) {
    res.status(400).json({ success: false, message: 'Provide a valid assessment ID and between 1 and 250 student results' })
    return
  }

  const results: Array<{ studentId: number; score: number; remarks: string | null }> = []
  const seen = new Set<number>()
  for (const item of input) {
    const studentId = typeof item?.studentId === 'number' ? item.studentId : parseId(String(item?.studentId ?? ''))
    const score = Number(item?.score)
    const remarks = typeof item?.remarks === 'string' ? item.remarks.trim().slice(0, 255) : null
    if (!studentId || !Number.isSafeInteger(studentId) || studentId <= 0 || seen.has(studentId) || !Number.isFinite(score) || score < 0) {
      res.status(400).json({ success: false, message: 'Each result must contain a unique student ID and a non-negative score' })
      return
    }
    seen.add(studentId)
    results.push({ studentId, score, remarks })
  }

  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT a.id, a.title, a.max_score AS maxScore, a.class_id AS classId, a.subject_id AS subjectId, a.term_id AS termId, t.academic_year_id AS academicYearId, ay.is_current AS isCurrent FROM assessments a INNER JOIN terms t ON t.id = a.term_id INNER JOIN academic_years ay ON ay.id = t.academic_year_id INNER JOIN teacher_subjects ts ON ts.class_id = a.class_id AND ts.subject_id = a.subject_id AND ts.academic_year_id = ay.id WHERE a.id = ? AND ts.teacher_id = ? LIMIT 1 FOR UPDATE',
        [assessmentId, Number(teacher.teacherId)],
      )
      const assessment = (rows as Row[])[0]
      if (!assessment) return { ok: false as const, status: 404, message: 'Assessment not found for your assignments' }
      if (!Boolean(assessment.isCurrent)) return { ok: false as const, status: 409, message: 'Results can only be changed for the current academic year' }
      const [publishedRows] = await connection.execute(
        'SELECT id FROM report_cards WHERE term_id = ? AND generated_at IS NOT NULL LIMIT 1',
        [Number(assessment.termId)],
      )
      if ((publishedRows as Row[]).length) return { ok: false as const, status: 409, message: 'Results are locked because report cards have already been generated for this term' }

      for (const item of results) {
        if (item.score > Number(assessment.maxScore)) {
          return { ok: false as const, status: 400, message: 'A score cannot exceed the assessment maximum' }
        }
        const [enrollmentRows] = await connection.execute(
          'SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND academic_year_id = ? AND enrollment_status = ? LIMIT 1',
          [item.studentId, Number(assessment.classId), Number(assessment.academicYearId), 'ACTIVE'],
        )
        if (!(enrollmentRows as Row[]).length) {
          return { ok: false as const, status: 400, message: 'One or more students are not actively enrolled in this class and year' }
        }
      }
      for (const item of results) {
        await connection.execute(
          'INSERT INTO assessment_results (assessment_id, student_id, score, remarks) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score), remarks = VALUES(remarks)',
          [assessmentId, item.studentId, item.score, item.remarks],
        )
      }
      await writeTeacherAudit(connection, req, 'TEACHER_ASSESSMENT_RESULTS_SAVED', 'assessment', assessmentId, {
        resultCount: results.length, classId: Number(assessment.classId), subjectId: Number(assessment.subjectId),
      })
      return { ok: true as const, savedCount: results.length }
    })
    if (!result.ok) {
      res.status(result.status).json({ success: false, message: result.message })
      return
    }
    res.json({ success: true, savedCount: result.savedCount, message: 'Assessment results saved' })
  } catch (error) {
    reportFailure(res, error, 'save assessment results')
  }
})

router.post('/attendance', async (req: AuthenticatedRequest, res: Response) => {
  const classId = parseId(String(req.body?.classId ?? ''))
  const termId = parseId(String(req.body?.termId ?? ''))
  const attendanceDate = req.body?.attendanceDate
  const input = req.body?.records
  if (!classId || !termId || !validDate(attendanceDate) || !Array.isArray(input) || input.length < 1 || input.length > 250) {
    res.status(400).json({ success: false, message: 'Provide a class, current term, date and between 1 and 250 attendance records' })
    return
  }
  const records: Array<{ studentId: number; status: typeof attendanceStatuses[number]; note: string | null }> = []
  const seen = new Set<number>()
  for (const item of input) {
    const studentId = typeof item?.studentId === 'number' ? item.studentId : parseId(String(item?.studentId ?? ''))
    const status = typeof item?.status === 'string' ? item.status.toUpperCase() : ''
    if (!studentId || !Number.isSafeInteger(studentId) || studentId <= 0 || seen.has(studentId) || !attendanceStatuses.includes(status as typeof attendanceStatuses[number])) {
      res.status(400).json({ success: false, message: 'Each attendance record needs a unique student ID and valid attendance status' })
      return
    }
    seen.add(studentId)
    records.push({
      studentId,
      status: status as typeof attendanceStatuses[number],
      note: typeof item?.note === 'string' ? item.note.trim().slice(0, 255) : null,
    })
  }

  try {
    const teacher = await getTeacher(req.user!.id)
    if (!teacher) {
      res.status(404).json({ success: false, message: 'Teacher profile not found' })
      return
    }
    const result = await withTransaction(async (connection) => {
      const [termRows] = await connection.execute(
        'SELECT t.id, t.academic_year_id AS academicYearId, t.starts_on AS startsOn, t.ends_on AS endsOn FROM terms t INNER JOIN academic_years ay ON ay.id = t.academic_year_id WHERE t.id = ? AND ay.is_current = TRUE LIMIT 1 FOR UPDATE',
        [termId],
      )
      const term = (termRows as Row[])[0]
      if (!term) return { ok: false as const, status: 400, message: 'Choose a term in the current academic year' }
      if (String(attendanceDate) < String(term.startsOn) || String(attendanceDate) > String(term.endsOn)) {
        return { ok: false as const, status: 400, message: 'Attendance date must fall inside the selected term' }
      }
      if (!await hasClassAssignment(Number(teacher.teacherId), classId, Number(term.academicYearId), undefined, connection)) {
        return { ok: false as const, status: 403, message: 'You are not assigned to this class in the selected academic year' }
      }
      for (const item of records) {
        const [enrollmentRows] = await connection.execute(
          'SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND academic_year_id = ? AND enrollment_status = ? LIMIT 1',
          [item.studentId, classId, Number(term.academicYearId), 'ACTIVE'],
        )
        if (!(enrollmentRows as Row[]).length) {
          return { ok: false as const, status: 400, message: 'One or more students are not actively enrolled in this class and year' }
        }
      }
      for (const item of records) {
        await connection.execute(
          'INSERT INTO attendance_records (student_id, class_id, term_id, attendance_date, status, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), term_id = VALUES(term_id), status = VALUES(status), note = VALUES(note), recorded_by = VALUES(recorded_by)',
          [item.studentId, classId, termId, attendanceDate, item.status, item.note, req.user!.id],
        )
      }
      await writeTeacherAudit(connection, req, 'TEACHER_ATTENDANCE_SAVED', 'attendance', null, {
        classId, termId, attendanceDate, recordCount: records.length,
      })
      return { ok: true as const, savedCount: records.length }
    })
    if (!result.ok) {
      res.status(result.status).json({ success: false, message: result.message })
      return
    }
    res.json({ success: true, savedCount: result.savedCount, message: 'Attendance saved' })
  } catch (error) {
    reportFailure(res, error, 'save attendance')
  }
})

export default router
