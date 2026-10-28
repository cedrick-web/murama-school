import { Router, type Response } from 'express'

import { isDatabaseUnavailable, pool, type PoolConnection } from '../config/database.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.js'
import type { UserRole } from '../types/auth.js'
import { listParentChildren, resolvePortalStudentId } from '../services/student-parent-portal.service.js'

const router = Router()
router.use(requireAuth)

type Row = Record<string, unknown>
const attendanceStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const

function parseId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (!/^\d+$/.test(String(value))) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function parseLimit(value: unknown, fallback = 50, maximum = 100): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function respondWithError(res: Response, error: unknown, action: string): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
    return
  }
  console.error(`Portal request failed: ${action}`, error)
  res.status(500).json({ success: false, message: 'Unable to load school portal information' })
}

function audienceFor(role: UserRole): string[] {
  const map: Record<UserRole, string[]> = {
    ADMIN: ['all', 'staff', 'teachers'],
    HEADTEACHER: ['all', 'staff', 'teachers'],
    TEACHER: ['all', 'teachers'],
    STUDENT: ['all', 'students'],
    PARENT: ['all', 'parents'],
    STAFF: ['all', 'staff'],
  }
  return map[role]
}

async function studentIdsFor(req: AuthenticatedRequest): Promise<number[]> {
  const user = req.user!
  if (user.role === 'STUDENT') {
    const id = await resolvePortalStudentId((sql, values) => pool.execute(sql, values), user)
    return id === null ? [] : [id]
  }
  if (user.role === 'PARENT') {
    const children = await listParentChildren((sql, values) => pool.execute(sql, values), user.id)
    return children.map((child) => Number(child.studentId))
  }
  return []
}

async function teacherIdFor(userId: number, connection: Pick<PoolConnection, 'execute'> = pool): Promise<number | null> {
  const [rows] = await connection.execute('SELECT id FROM teachers WHERE user_id = ? LIMIT 1', [userId])
  const teacher = (rows as Row[])[0]
  return teacher ? Number(teacher.id) : null
}

// Retain the aggregated contract used by the /app workspace.
router.get('/overview', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id
    const role = req.user!.role
    const [announcements] = await pool.execute(
      'SELECT id, title, message, audience, published_at AS publishedAt FROM announcements WHERE is_published = TRUE AND audience IN (?) AND published_at IS NOT NULL AND published_at <= CURRENT_TIMESTAMP ORDER BY published_at DESC LIMIT 8',
      [audienceFor(role)],
    )
    const [notifications] = await pool.execute(
      'SELECT id, title, body, type, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId],
    )
    const [unread] = await pool.execute('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId])
    const [inbox] = await pool.execute(
      'SELECT m.id, m.subject, m.body, m.sent_at AS sentAt, CONCAT_WS(" ", u.first_name, u.last_name) AS senderName, mr.read_at AS readAt FROM message_recipients mr INNER JOIN messages m ON m.id = mr.message_id INNER JOIN users u ON u.id = m.sender_user_id WHERE mr.recipient_user_id = ? ORDER BY m.sent_at DESC LIMIT 12',
      [userId],
    )
    const studentIds = await studentIdsFor(req)
    let students: unknown[] = []
    let attendance: unknown[] = []
    let reportCards: unknown[] = []
    let fees: unknown[] = []
    let timetable: unknown[] = []
    let teacher: unknown = null

    if (studentIds.length) {
      const [studentRows] = await pool.execute(
        'SELECT s.id, s.admission_number AS admissionNumber, s.status, u.first_name AS firstName, u.last_name AS lastName, c.name AS className, st.name AS streamName FROM students s INNER JOIN users u ON u.id = s.user_id LEFT JOIN student_enrollments e ON e.id = (SELECT e2.id FROM student_enrollments e2 WHERE e2.student_id = s.id AND e2.enrollment_status = ? ORDER BY e2.academic_year_id DESC, e2.term_id DESC NULLS LAST, e2.id DESC LIMIT 1) LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id WHERE s.id IN (?)',
        ['ACTIVE', studentIds],
      )
      students = studentRows as unknown[]
      const [attendanceRows] = await pool.execute(
        'SELECT a.id, a.student_id AS studentId, a.attendance_date AS attendanceDate, a.status, a.note, c.name AS className FROM attendance_records a LEFT JOIN classes c ON c.id = a.class_id WHERE a.student_id IN (?) ORDER BY a.attendance_date DESC LIMIT 40',
        [studentIds],
      )
      attendance = attendanceRows as unknown[]
      const [reportRows] = await pool.execute(
        'SELECT r.id, r.student_id AS studentId, t.name AS termName, y.name AS academicYearName, r.average_score AS averageScore, r.class_position AS classPosition, r.attendance_percentage AS attendancePercentage, r.generated_at AS generatedAt FROM report_cards r INNER JOIN terms t ON t.id = r.term_id INNER JOIN academic_years y ON y.id = t.academic_year_id WHERE r.student_id IN (?) AND r.generated_at IS NOT NULL ORDER BY r.generated_at DESC LIMIT 20',
        [studentIds],
      )
      reportCards = reportRows as unknown[]
      const [feeRows] = await pool.execute(
        'SELECT f.id, f.student_id AS studentId, fs.name AS feeName, y.name AS academicYearName, f.amount_due AS amountDue, f.amount_paid AS amountPaid, f.status, (f.amount_due - f.amount_paid) AS balance FROM fee_items f INNER JOIN fee_structures fs ON fs.id = f.fee_structure_id INNER JOIN academic_years y ON y.id = fs.academic_year_id WHERE f.student_id IN (?) ORDER BY f.id DESC',
        [studentIds],
      )
      fees = feeRows as unknown[]
      const [entries] = await pool.execute(
        'SELECT DISTINCT te.id, te.class_id AS classId, c.name AS className, te.day_of_week AS dayOfWeek, te.starts_at AS startsAt, te.ends_at AS endsAt, te.room, sub.name AS subjectName, CONCAT_WS(" ", u.first_name, u.last_name) AS teacherName FROM student_enrollments e INNER JOIN timetable_entries te ON te.class_id = e.class_id AND (te.stream_id IS NULL OR te.stream_id = e.stream_id) AND te.academic_year_id = e.academic_year_id AND (te.term_id IS NULL OR te.term_id = e.term_id) INNER JOIN classes c ON c.id = te.class_id INNER JOIN subjects sub ON sub.id = te.subject_id LEFT JOIN teachers tr ON tr.id = te.teacher_id LEFT JOIN users u ON u.id = tr.user_id WHERE e.student_id IN (?) AND e.id = (SELECT e2.id FROM student_enrollments e2 WHERE e2.student_id = e.student_id AND e2.enrollment_status = ? ORDER BY e2.academic_year_id DESC, e2.term_id DESC NULLS LAST, e2.id DESC LIMIT 1) ORDER BY te.day_of_week, te.starts_at',
        [studentIds, 'ACTIVE'],
      )
      timetable = entries as unknown[]
    }
    if (role === 'TEACHER') {
      const teacherId = await teacherIdFor(userId)
      if (teacherId) {
        const [profile] = await pool.execute('SELECT tr.id, tr.employee_number AS employeeNumber, tr.qualification, tr.department FROM teachers tr WHERE tr.id = ?', [teacherId])
        teacher = (profile as unknown[])[0] ?? null
        const [entries] = await pool.execute(
          'SELECT e.id, e.class_id AS classId, c.name AS className, e.day_of_week AS dayOfWeek, e.starts_at AS startsAt, e.ends_at AS endsAt, e.room, s.name AS subjectName FROM timetable_entries e INNER JOIN classes c ON c.id = e.class_id INNER JOIN subjects s ON s.id = e.subject_id WHERE e.teacher_id = ? AND e.academic_year_id = COALESCE((SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1), e.academic_year_id) ORDER BY e.day_of_week, e.starts_at',
          [teacherId],
        )
        timetable = entries as unknown[]
      }
    }
    res.json({ success: true, overview: {
      role, unreadNotifications: Number((unread as Array<{ count: number }>)[0]?.count ?? 0),
      announcements, notifications, messages: inbox, students, attendance, reportCards, fees, timetable, teacher,
    } })
  } catch (error) {
    respondWithError(res, error, 'overview')
  }
})

type StudentAction = (req: AuthenticatedRequest, res: Response, studentId: number) => Promise<void>

function studentEndpoint(action: string, handler: StudentAction) {
  return async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const requestedStudentId = req.user?.role === 'PARENT' ? parseId(req.params.studentId) : undefined
    if (req.user?.role === 'PARENT' && requestedStudentId === null) {
      res.status(404).json({ success: false, message: 'Linked student not found' })
      return
    }
    try {
      const studentId = req.user
        ? await resolvePortalStudentId((sql, values) => pool.execute(sql, values), req.user, requestedStudentId ?? undefined)
        : null
      if (studentId === null) {
        res.status(404).json({ success: false, message: req.user?.role === 'PARENT' ? 'Linked student not found' : 'Student portal profile not found' })
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
  const termId = req.query.termId === undefined ? null : parseId(req.query.termId)
  if (req.query.termId !== undefined && termId === null) {
    res.status(400).json({ success: false, message: 'termId must be a positive integer' })
    return
  }
  const query = 'SELECT a.id AS assessmentId, a.title AS assessmentTitle, a.assessment_type AS assessmentType, a.assessment_date AS assessmentDate, a.max_score AS maxScore, ar.score, ar.remarks, sub.code AS subjectCode, sub.name AS subjectName, t.id AS termId, t.name AS termName, ay.name AS academicYear, rc.average_score AS termAverage, rc.class_position AS classPosition, rc.attendance_percentage AS attendancePercentage, rc.general_comment AS generalComment, rc.generated_at AS publishedAt FROM assessment_results ar INNER JOIN assessments a ON a.id = ar.assessment_id INNER JOIN subjects sub ON sub.id = a.subject_id INNER JOIN terms t ON t.id = a.term_id INNER JOIN academic_years ay ON ay.id = t.academic_year_id INNER JOIN report_cards rc ON rc.student_id = ar.student_id AND rc.term_id = a.term_id AND rc.generated_at IS NOT NULL WHERE ar.student_id = ?'
  const [rows] = await pool.execute(
    query + (termId === null ? '' : ' AND t.id = ?') + ' ORDER BY t.starts_on DESC, a.assessment_date DESC, sub.name',
    termId === null ? [studentId] : [studentId, termId],
  )
  res.json({ success: true, results: rows })
}

const attendance: StudentAction = async (req, res, studentId) => {
  const [rows] = await pool.execute(
    'SELECT ar.id, ar.attendance_date AS attendanceDate, ar.status, ar.note, t.name AS termName, c.name AS className FROM attendance_records ar INNER JOIN terms t ON t.id = ar.term_id INNER JOIN classes c ON c.id = ar.class_id WHERE ar.student_id = ? ORDER BY ar.attendance_date DESC LIMIT ?',
    [studentId, parseLimit(req.query.limit)],
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
  const limit = parseLimit(req.query.limit)
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
  res.json({ success: true, feeItems: items, payments, summary: (summaryRows as Row[])[0] ?? { totalDue: 0, totalPaid: 0, outstanding: 0 } })
}

async function notifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  const [rows] = await pool.execute(
    'SELECT id, title, body, type, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [req.user!.id, parseLimit(req.query.limit)],
  )
  res.json({ success: true, notifications: rows })
}

async function messages(req: AuthenticatedRequest, res: Response): Promise<void> {
  const [rows] = await pool.execute(
    'SELECT m.id, m.subject, m.body, m.sent_at AS sentAt, mr.read_at AS readAt, CONCAT_WS(\' \', u.first_name, u.last_name) AS senderName FROM message_recipients mr INNER JOIN messages m ON m.id = mr.message_id INNER JOIN users u ON u.id = m.sender_user_id WHERE mr.recipient_user_id = ? ORDER BY m.sent_at DESC LIMIT ?',
    [req.user!.id, parseLimit(req.query.limit)],
  )
  res.json({ success: true, messages: rows })
}

router.get('/student/overview', requireRole('STUDENT'), studentEndpoint('student overview', overview))
router.get('/student/results', requireRole('STUDENT'), studentEndpoint('student results', results))
router.get('/student/attendance', requireRole('STUDENT'), studentEndpoint('student attendance', attendance))
router.get('/student/timetable', requireRole('STUDENT'), studentEndpoint('student timetable', timetable))
router.get('/student/fees', requireRole('STUDENT'), studentEndpoint('student fees', fees))
router.get('/student/notifications', requireRole('STUDENT'), studentEndpoint('student notifications', notifications))
router.get('/student/messages', requireRole('STUDENT'), studentEndpoint('student messages', messages))

router.get('/parent/children', requireRole('PARENT'), async (req: AuthenticatedRequest, res) => {
  try {
    const children = await listParentChildren((sql, values) => pool.execute(sql, values), req.user!.id)
    res.json({ success: true, children })
  } catch (error) {
    respondWithError(res, error, 'parent children')
  }
})
router.get('/parent/children/:studentId/overview', requireRole('PARENT'), studentEndpoint('parent child overview', overview))
router.get('/parent/children/:studentId/results', requireRole('PARENT'), studentEndpoint('parent child results', results))
router.get('/parent/children/:studentId/attendance', requireRole('PARENT'), studentEndpoint('parent child attendance', attendance))
router.get('/parent/children/:studentId/timetable', requireRole('PARENT'), studentEndpoint('parent child timetable', timetable))
router.get('/parent/children/:studentId/fees', requireRole('PARENT'), studentEndpoint('parent child fees', fees))

router.get('/notifications', async (req: AuthenticatedRequest, res) => {
  try {
    await notifications(req, res)
  } catch (error) {
    respondWithError(res, error, 'notifications')
  }
})
router.get('/messages', async (req: AuthenticatedRequest, res) => {
  try {
    await messages(req, res)
  } catch (error) {
    respondWithError(res, error, 'messages')
  }
})

// Both clients remain supported, with the same ownership check for either verb.
router.route('/notifications/:notificationId/read').post(markNotificationRead).patch(markNotificationRead)
async function markNotificationRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const notificationId = parseId(req.params.notificationId)
  if (!notificationId) {
    res.status(400).json({ success: false, message: 'A valid notification ID is required' })
    return
  }
  try {
    const [existing] = await pool.execute('SELECT id FROM notifications WHERE id = ? AND user_id = ? LIMIT 1', [notificationId, req.user!.id])
    if (!(existing as Row[]).length) {
      res.status(404).json({ success: false, message: 'Notification not found' })
      return
    }
    await pool.execute('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?', [notificationId, req.user!.id])
    res.json({ success: true, message: 'Notification marked as read' })
  } catch (error) {
    respondWithError(res, error, 'mark notification read')
  }
}

router.post('/messages/:messageId/read', async (req: AuthenticatedRequest, res) => {
  const messageId = parseId(req.params.messageId)
  if (!messageId) {
    res.status(400).json({ success: false, message: 'A valid message ID is required' })
    return
  }
  try {
    const [existing] = await pool.execute('SELECT message_id FROM message_recipients WHERE message_id = ? AND recipient_user_id = ? LIMIT 1', [messageId, req.user!.id])
    if (!(existing as Row[]).length) {
      res.status(404).json({ success: false, message: 'Message not found' })
      return
    }
    await pool.execute('UPDATE message_recipients SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE message_id = ? AND recipient_user_id = ?', [messageId, req.user!.id])
    res.json({ success: true, message: 'Message marked as read' })
  } catch (error) {
    respondWithError(res, error, 'mark message read')
  }
})

async function canAccessAttendance(req: AuthenticatedRequest, classId: number, academicYearId: number, connection: Pick<PoolConnection, 'execute'> = pool): Promise<boolean> {
  if (req.user!.role !== 'TEACHER') return true // requireRole restricts managers below.
  const teacherId = await teacherIdFor(req.user!.id, connection)
  if (!teacherId) return false
  const [rows] = await connection.execute(
    'SELECT id FROM teacher_subjects WHERE teacher_id = ? AND class_id = ? AND academic_year_id = ? LIMIT 1',
    [teacherId, classId, academicYearId],
  )
  return (rows as Row[]).length > 0
}

router.get('/attendance', requireRole('TEACHER', 'HEADTEACHER', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  const classId = parseId(req.query.classId)
  const termId = parseId(req.query.termId)
  const date = req.query.date
  if (!classId || !termId || !validDate(date)) {
    res.status(400).json({ success: false, message: 'Class, term and date are required' })
    return
  }
  try {
    const [terms] = await pool.execute('SELECT academic_year_id AS academicYearId FROM terms WHERE id = ? LIMIT 1', [termId])
    const term = (terms as Row[])[0]
    if (!term) {
      res.status(400).json({ success: false, message: 'Choose a valid term' })
      return
    }
    if (!await canAccessAttendance(req, classId, Number(term.academicYearId))) {
      res.status(403).json({ success: false, message: 'You are not assigned to this class in the selected academic year' })
      return
    }
    const [rows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, a.id AS attendanceId, a.status AS attendanceStatus, a.note FROM student_enrollments e INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = ? AND a.class_id = ? AND a.term_id = ? WHERE e.class_id = ? AND e.academic_year_id = ? AND e.enrollment_status = ? AND (e.term_id IS NULL OR e.term_id = ?) ORDER BY u.last_name, u.first_name',
      [date, classId, termId, classId, Number(term.academicYearId), 'ACTIVE', termId],
    )
    res.json({ success: true, records: rows })
  } catch (error) {
    respondWithError(res, error, 'load attendance')
  }
})

router.post('/attendance', requireRole('TEACHER', 'HEADTEACHER', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  const classId = parseId(req.body?.classId)
  const termId = parseId(req.body?.termId)
  const date = req.body?.date
  const input = req.body?.records
  if (!classId || !termId || !validDate(date) || !Array.isArray(input) || !input.length || input.length > 250) {
    res.status(400).json({ success: false, message: 'Class, current term, date and between 1 and 250 attendance records are required' })
    return
  }
  const records: Array<{ studentId: number; status: string; note: string | null }> = []
  const seen = new Set<number>()
  for (const item of input) {
    const studentId = parseId(item?.studentId)
    const status = typeof item?.status === 'string' ? item.status : ''
    if (!studentId || seen.has(studentId) || !attendanceStatuses.includes(status as typeof attendanceStatuses[number])) {
      res.status(400).json({ success: false, message: 'Each attendance record needs a unique student ID and valid attendance status' })
      return
    }
    seen.add(studentId)
    records.push({ studentId, status, note: typeof item?.note === 'string' ? item.note.trim().slice(0, 255) : null })
  }
  try {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [terms] = await connection.execute(
        'SELECT t.academic_year_id AS academicYearId, t.starts_on AS startsOn, t.ends_on AS endsOn FROM terms t INNER JOIN academic_years ay ON ay.id = t.academic_year_id WHERE t.id = ? AND ay.is_current = TRUE LIMIT 1 FOR UPDATE',
        [termId],
      )
      const term = (terms as Row[])[0]
      if (!term || date < String(term.startsOn) || date > String(term.endsOn)) {
        await connection.rollback()
        res.status(400).json({ success: false, message: 'Choose a current-year term and an attendance date inside that term' })
        return
      }
      if (!await canAccessAttendance(req, classId, Number(term.academicYearId), connection)) {
        await connection.rollback()
        res.status(403).json({ success: false, message: 'You are not assigned to this class in the selected academic year' })
        return
      }
      // Validate the entire batch before writing any rows.
      for (const record of records) {
        const [enrolled] = await connection.execute(
          'SELECT id FROM student_enrollments WHERE student_id = ? AND class_id = ? AND academic_year_id = ? AND enrollment_status = ? AND (term_id IS NULL OR term_id = ?) LIMIT 1',
          [record.studentId, classId, Number(term.academicYearId), 'ACTIVE', termId],
        )
        if (!(enrolled as Row[]).length) {
          await connection.rollback()
          res.status(400).json({ success: false, message: 'One or more students are not actively enrolled in this class and term' })
          return
        }
      }
      for (const record of records) {
        await connection.execute(
          'INSERT INTO attendance_records (student_id, class_id, term_id, attendance_date, status, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), term_id = VALUES(term_id), status = VALUES(status), note = VALUES(note), recorded_by = VALUES(recorded_by)',
          [record.studentId, classId, termId, date, record.status, record.note, req.user!.id],
        )
      }
      await connection.execute(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user!.id, 'PORTAL_ATTENDANCE_SAVED', 'attendance', classId, JSON.stringify({ date, saved: records.length }), req.ip ?? null, req.get('user-agent')?.slice(0, 500) ?? null],
      )
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
    res.json({ success: true, saved: records.length, message: 'Attendance register saved' })
  } catch (error) {
    respondWithError(res, error, 'save attendance')
  }
})

export default router
