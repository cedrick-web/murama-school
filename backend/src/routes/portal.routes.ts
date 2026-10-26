import { Router, type Response } from 'express'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.js'
import type { AuthUser } from '../types/auth.js'
import { authorizeStudentScope } from '../services/portal-access.js'

const router = Router()
router.use(requireAuth)

type Row = Record<string, unknown>

function parsePositiveId(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function parseLimit(value: unknown, fallback = 50, maximum = 100): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback
}

function respondWithError(res: Response, error: unknown, action: string): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({
      success: false,
      message: 'The school database is not configured or is temporarily unavailable.',
    })
    return
  }

  console.error(`Portal request failed: ${action}`, error)
  res.status(500).json({ success: false, message: 'Unable to load school portal information' })
}

/**
 * Resolve a student exclusively through the authenticated identity or the
 * parent's verified student_parents relationship. Never trust a URL ID alone.
 */
async function resolveStudentId(user: AuthUser, requestedStudentId?: number): Promise<number | null> {
  if (user.role === 'STUDENT') {
    const [rows] = await pool.execute(
      'SELECT id FROM students WHERE user_id = ? LIMIT 1',
      [user.id],
    )
    const student = (rows as Row[])[0]
    if (!student) return null
    return authorizeStudentScope(user.role, Number(student.id), [], requestedStudentId)
  }

  if (user.role === 'PARENT' && requestedStudentId !== undefined) {
    const [rows] = await pool.execute(
      'SELECT s.id FROM parents p INNER JOIN student_parents sp ON sp.parent_id = p.id INNER JOIN students s ON s.id = sp.student_id WHERE p.user_id = ? AND s.id = ? LIMIT 1',
      [user.id, requestedStudentId],
    )
    const student = (rows as Row[])[0]
    return authorizeStudentScope(user.role, null, student ? [Number(student.id)] : [], requestedStudentId)
  }

  return null
}

type StudentAction = (
  req: AuthenticatedRequest,
  res: Response,
  studentId: number,
) => Promise<void>

function studentEndpoint(action: string, handler: StudentAction) {
  return async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const requestedStudentId = req.user?.role === 'PARENT'
      ? parsePositiveId(req.params.studentId)
      : undefined

    if (req.user?.role === 'PARENT' && requestedStudentId === null) {
      res.status(404).json({ success: false, message: 'Linked student not found' })
      return
    }

    try {
      const studentId = req.user
        ? await resolveStudentId(req.user, requestedStudentId ?? undefined)
        : null
      if (studentId === null) {
        res.status(404).json({
          success: false,
          message: req.user?.role === 'PARENT'
            ? 'Linked student not found'
            : 'Student portal profile not found',
        })
        return
      }
      await handler(req, res, studentId)
    } catch (error) {
      respondWithError(res, error, action)
    }
  }
}

const overview: StudentAction = async (_req, res, studentId) => {
  const [rows] = await pool.execute(
    'SELECT s.id AS studentId, s.admission_number AS admissionNumber, s.date_of_birth AS dateOfBirth, s.gender, s.admission_date AS admissionDate, s.status, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone, c.name AS className, st.name AS streamName, ay.name AS academicYear, t.name AS termName FROM students s INNER JOIN users u ON u.id = s.user_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.enrollment_status = ? LEFT JOIN academic_years ay ON ay.id = e.academic_year_id LEFT JOIN terms t ON t.id = e.term_id LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id WHERE s.id = ? ORDER BY ay.is_current DESC NULLS LAST, ay.starts_on DESC NULLS LAST LIMIT 1',
    ['ACTIVE', studentId],
  )
  const student = (rows as Row[])[0]
  if (!student) {
    res.status(404).json({ success: false, message: 'Student record not found' })
    return
  }
  res.json({ success: true, student })
}

const results: StudentAction = async (req, res, studentId) => {
  const termId = req.query.termId === undefined ? null : parsePositiveId(String(req.query.termId))
  if (req.query.termId !== undefined && termId === null) {
    res.status(400).json({ success: false, message: 'termId must be a positive integer' })
    return
  }

  const query = termId === null
    ? 'SELECT a.id AS assessmentId, a.title AS assessmentTitle, a.assessment_type AS assessmentType, a.assessment_date AS assessmentDate, a.max_score AS maxScore, ar.score, ar.remarks, sub.code AS subjectCode, sub.name AS subjectName, t.id AS termId, t.name AS termName, ay.name AS academicYear, rc.average_score AS termAverage, rc.class_position AS classPosition, rc.attendance_percentage AS attendancePercentage, rc.general_comment AS generalComment, rc.generated_at AS publishedAt FROM assessment_results ar INNER JOIN assessments a ON a.id = ar.assessment_id INNER JOIN subjects sub ON sub.id = a.subject_id INNER JOIN terms t ON t.id = a.term_id INNER JOIN academic_years ay ON ay.id = t.academic_year_id INNER JOIN report_cards rc ON rc.student_id = ar.student_id AND rc.term_id = a.term_id AND rc.generated_at IS NOT NULL WHERE ar.student_id = ? ORDER BY t.starts_on DESC, a.assessment_date DESC, sub.name'
    : 'SELECT a.id AS assessmentId, a.title AS assessmentTitle, a.assessment_type AS assessmentType, a.assessment_date AS assessmentDate, a.max_score AS maxScore, ar.score, ar.remarks, sub.code AS subjectCode, sub.name AS subjectName, t.id AS termId, t.name AS termName, ay.name AS academicYear, rc.average_score AS termAverage, rc.class_position AS classPosition, rc.attendance_percentage AS attendancePercentage, rc.general_comment AS generalComment, rc.generated_at AS publishedAt FROM assessment_results ar INNER JOIN assessments a ON a.id = ar.assessment_id INNER JOIN subjects sub ON sub.id = a.subject_id INNER JOIN terms t ON t.id = a.term_id INNER JOIN academic_years ay ON ay.id = t.academic_year_id INNER JOIN report_cards rc ON rc.student_id = ar.student_id AND rc.term_id = a.term_id AND rc.generated_at IS NOT NULL WHERE ar.student_id = ? AND t.id = ? ORDER BY t.starts_on DESC, a.assessment_date DESC, sub.name'
  const values = termId === null ? [studentId] : [studentId, termId]
  const [rows] = await pool.execute(query, values)
  res.json({ success: true, results: rows })
}

const attendance: StudentAction = async (req, res, studentId) => {
  const limit = parseLimit(req.query.limit, 50, 100)
  const [rows] = await pool.execute(
    'SELECT ar.id, ar.attendance_date AS attendanceDate, ar.status, ar.note, t.name AS termName, c.name AS className FROM attendance_records ar INNER JOIN terms t ON t.id = ar.term_id INNER JOIN classes c ON c.id = ar.class_id WHERE ar.student_id = ? ORDER BY ar.attendance_date DESC LIMIT ?',
    [studentId, limit],
  )
  const [summaryRows] = await pool.execute(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS present, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS absent, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS late, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS excused FROM attendance_records WHERE student_id = ?',
    ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', studentId],
  )
  res.json({ success: true, attendance: rows, summary: (summaryRows as Row[])[0] ?? {} })
}

const timetable: StudentAction = async (_req, res, studentId) => {
  const [rows] = await pool.execute(
    'SELECT te.id, te.day_of_week AS dayOfWeek, te.starts_at AS startsAt, te.ends_at AS endsAt, te.room, c.name AS className, st.name AS streamName, sub.code AS subjectCode, sub.name AS subjectName, CONCAT_WS(\' \', tu.first_name, tu.last_name) AS teacherName, ay.name AS academicYear, t.name AS termName FROM student_enrollments e INNER JOIN timetable_entries te ON te.class_id = e.class_id AND (te.stream_id IS NULL OR te.stream_id = e.stream_id) AND te.academic_year_id = e.academic_year_id AND (te.term_id IS NULL OR te.term_id = e.term_id) INNER JOIN classes c ON c.id = te.class_id LEFT JOIN streams st ON st.id = te.stream_id INNER JOIN subjects sub ON sub.id = te.subject_id INNER JOIN academic_years ay ON ay.id = te.academic_year_id LEFT JOIN terms t ON t.id = te.term_id LEFT JOIN teachers teacher ON teacher.id = te.teacher_id LEFT JOIN users tu ON tu.id = teacher.user_id WHERE e.id = (SELECT e2.id FROM student_enrollments e2 WHERE e2.student_id = ? AND e2.enrollment_status = ? ORDER BY e2.academic_year_id DESC, e2.term_id DESC NULLS LAST, e2.id DESC LIMIT 1) ORDER BY te.day_of_week, te.starts_at',
    [studentId, 'ACTIVE'],
  )
  res.json({ success: true, timetable: rows })
}

const fees: StudentAction = async (req, res, studentId) => {
  const limit = parseLimit(req.query.limit, 50, 100)
  const [items] = await pool.execute(
    'SELECT fi.id, fi.amount_due AS amountDue, fi.amount_paid AS amountPaid, fi.status, fs.name AS feeName, fs.due_date AS dueDate, ay.name AS academicYear, c.name AS className FROM fee_items fi INNER JOIN fee_structures fs ON fs.id = fi.fee_structure_id INNER JOIN academic_years ay ON ay.id = fs.academic_year_id LEFT JOIN classes c ON c.id = fs.class_id WHERE fi.student_id = ? ORDER BY fs.due_date DESC NULLS LAST, fi.id DESC LIMIT ?',
    [studentId, limit],
  )
  const [payments] = await pool.execute(
    'SELECT p.id, p.receipt_number AS receiptNumber, p.amount, p.payment_method AS paymentMethod, p.reference, p.paid_at AS paidAt, i.invoice_number AS invoiceNumber FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.student_id = ? ORDER BY p.paid_at DESC LIMIT ?',
    [studentId, limit],
  )
  const [summaryRows] = await pool.execute(
    'SELECT COALESCE(SUM(CASE WHEN status <> ? THEN amount_due ELSE 0 END), 0) AS totalDue, COALESCE(SUM(amount_paid), 0) AS totalPaid, COALESCE(SUM(CASE WHEN status <> ? THEN GREATEST(amount_due - amount_paid, 0) ELSE 0 END), 0) AS outstanding FROM fee_items WHERE student_id = ?',
    ['WAIVED', 'WAIVED', studentId],
  )
  res.json({
    success: true,
    feeItems: items,
    payments,
    summary: (summaryRows as Row[])[0] ?? { totalDue: 0, totalPaid: 0, outstanding: 0 },
  })
}

const notifications: StudentAction = async (req, res, studentId) => {
  const userId = req.user!.id
  const limit = parseLimit(req.query.limit, 50, 100)
  const [rows] = await pool.execute(
    'SELECT id, title, body, type, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit],
  )
  res.json({ success: true, notifications: rows })
}

const messages: StudentAction = async (req, res, _studentId) => {
  const limit = parseLimit(req.query.limit, 50, 100)
  const [rows] = await pool.execute(
    'SELECT m.id, m.subject, m.body, m.sent_at AS sentAt, mr.read_at AS readAt, CONCAT_WS(\' \', u.first_name, u.last_name) AS senderName FROM message_recipients mr INNER JOIN messages m ON m.id = mr.message_id INNER JOIN users u ON u.id = m.sender_user_id WHERE mr.recipient_user_id = ? ORDER BY m.sent_at DESC LIMIT ?',
    [req.user!.id, limit],
  )
  res.json({ success: true, messages: rows })
}

const markNotificationRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const notificationId = parsePositiveId(req.params.notificationId)
  if (!notificationId) {
    res.status(400).json({ success: false, message: 'A valid notification ID is required' })
    return
  }
  try {
    const [existing] = await pool.execute(
      'SELECT id FROM notifications WHERE id = ? AND user_id = ? LIMIT 1',
      [notificationId, req.user!.id],
    )
    if (!(existing as Row[]).length) {
      res.status(404).json({ success: false, message: 'Notification not found' })
      return
    }
    await pool.execute(
      'UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?',
      [notificationId, req.user!.id],
    )
    res.json({ success: true, message: 'Notification marked as read' })
  } catch (error) {
    respondWithError(res, error, 'mark notification read')
  }
}

router.get('/student/overview', requireRole('STUDENT'), studentEndpoint('student overview', overview))
router.get('/student/results', requireRole('STUDENT'), studentEndpoint('student results', results))
router.get('/student/attendance', requireRole('STUDENT'), studentEndpoint('student attendance', attendance))
router.get('/student/timetable', requireRole('STUDENT'), studentEndpoint('student timetable', timetable))
router.get('/student/fees', requireRole('STUDENT'), studentEndpoint('student fees', fees))
router.get('/student/notifications', requireRole('STUDENT'), studentEndpoint('student notifications', notifications))
router.get('/student/messages', requireRole('STUDENT'), studentEndpoint('student messages', messages))

router.get('/parent/children', requireRole('PARENT'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [rows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, s.status, sp.relationship, sp.is_primary AS isPrimary, u.first_name AS firstName, u.last_name AS lastName, c.name AS className, st.name AS streamName, ay.name AS academicYear FROM parents p INNER JOIN student_parents sp ON sp.parent_id = p.id INNER JOIN students s ON s.id = sp.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN student_enrollments e ON e.id = (SELECT e2.id FROM student_enrollments e2 WHERE e2.student_id = s.id AND e2.enrollment_status = ? ORDER BY e2.academic_year_id DESC, e2.term_id DESC NULLS LAST, e2.id DESC LIMIT 1) LEFT JOIN academic_years ay ON ay.id = e.academic_year_id LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id WHERE p.user_id = ? ORDER BY sp.is_primary DESC, u.last_name, u.first_name',
      ['ACTIVE', req.user!.id],
    )
    res.json({ success: true, children: rows })
  } catch (error) {
    respondWithError(res, error, 'parent children')
  }
})

router.get('/parent/children/:studentId/overview', requireRole('PARENT'), studentEndpoint('parent child overview', overview))
router.get('/parent/children/:studentId/results', requireRole('PARENT'), studentEndpoint('parent child results', results))
router.get('/parent/children/:studentId/attendance', requireRole('PARENT'), studentEndpoint('parent child attendance', attendance))
router.get('/parent/children/:studentId/timetable', requireRole('PARENT'), studentEndpoint('parent child timetable', timetable))
router.get('/parent/children/:studentId/fees', requireRole('PARENT'), studentEndpoint('parent child fees', fees))

router.get('/notifications', async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseLimit(req.query.limit, 50, 100)
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, body, type, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [req.user!.id, limit],
    )
    res.json({ success: true, notifications: rows })
  } catch (error) {
    respondWithError(res, error, 'notifications')
  }
})

router.patch('/notifications/:notificationId/read', markNotificationRead)

router.get('/messages', async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseLimit(req.query.limit, 50, 100)
  try {
    const [rows] = await pool.execute(
      'SELECT m.id, m.subject, m.body, m.sent_at AS sentAt, mr.read_at AS readAt, CONCAT_WS(\' \', u.first_name, u.last_name) AS senderName FROM message_recipients mr INNER JOIN messages m ON m.id = mr.message_id INNER JOIN users u ON u.id = m.sender_user_id WHERE mr.recipient_user_id = ? ORDER BY m.sent_at DESC LIMIT ?',
      [req.user!.id, limit],
    )
    res.json({ success: true, messages: rows })
  } catch (error) {
    respondWithError(res, error, 'messages')
  }
})

export default router
