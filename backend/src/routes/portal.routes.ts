import { Router } from 'express'
import type { Response } from 'express'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import type { UserRole } from '../types/auth.js'

const router = Router()
router.use(requireAuth)

const attendanceStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const

function fail(res: Response, action: string, error: unknown): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
    return
  }
  console.error(`Portal ${action} failed`, error)
  res.status(500).json({ success: false, message: `Unable to ${action}` })
}

function parseId(value: unknown): number | null {
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
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

async function studentIdsFor(userId: number, role: UserRole): Promise<number[]> {
  if (role === 'STUDENT') {
    const [rows] = await pool.execute('SELECT id FROM students WHERE user_id = ?', [userId])
    return (rows as Array<{ id: number }>).map((row) => Number(row.id))
  }
  if (role === 'PARENT') {
    const [rows] = await pool.execute(
      'SELECT sp.student_id AS id FROM student_parents sp INNER JOIN parents p ON p.id = sp.parent_id WHERE p.user_id = ?',
      [userId],
    )
    return (rows as Array<{ id: number }>).map((row) => Number(row.id))
  }
  return []
}

async function teacherIdFor(userId: number): Promise<number | null> {
  const [rows] = await pool.execute('SELECT id FROM teachers WHERE user_id = ? LIMIT 1', [userId])
  const teacher = (rows as Array<{ id: number }>)[0]
  return teacher ? Number(teacher.id) : null
}

router.get('/overview', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id
    const role = req.user!.role
    const audiences = audienceFor(role)
    const [announcements] = await pool.execute(
      `SELECT id, title, message, audience, published_at AS publishedAt FROM announcements WHERE is_published = TRUE AND audience IN (?) AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 8`,
      [audiences],
    )
    const [notifications] = await pool.execute(
      'SELECT id, title, body, type, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId],
    )
    const [unread] = await pool.execute(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [userId],
    )
    const [inbox] = await pool.execute(
      'SELECT m.id, m.subject, m.body, m.sent_at AS sentAt, CONCAT_WS(" ", u.first_name, u.last_name) AS senderName, mr.read_at AS readAt FROM message_recipients mr INNER JOIN messages m ON m.id = mr.message_id INNER JOIN users u ON u.id = m.sender_user_id WHERE mr.recipient_user_id = ? ORDER BY m.sent_at DESC LIMIT 12',
      [userId],
    )

    const studentIds = await studentIdsFor(userId, role)
    let students: unknown[] = []
    let attendance: unknown[] = []
    let reportCards: unknown[] = []
    let fees: unknown[] = []
    let timetable: unknown[] = []
    let teacher: unknown = null

    if (studentIds.length) {
      const [studentRows] = await pool.execute(
        'SELECT s.id, s.admission_number AS admissionNumber, s.status, u.first_name AS firstName, u.last_name AS lastName, c.name AS className, st.name AS streamName FROM students s INNER JOIN users u ON u.id = s.user_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = (SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1) LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id WHERE s.id IN (?)',
        [studentIds],
      )
      students = studentRows as unknown[]
      const [attendanceRows] = await pool.execute(
        'SELECT a.id, a.student_id AS studentId, a.attendance_date AS attendanceDate, a.status, a.note, c.name AS className FROM attendance_records a LEFT JOIN classes c ON c.id = a.class_id WHERE a.student_id IN (?) ORDER BY a.attendance_date DESC LIMIT 40',
        [studentIds],
      )
      attendance = attendanceRows as unknown[]
      const [reportRows] = await pool.execute(
        'SELECT r.id, r.student_id AS studentId, t.name AS termName, y.name AS academicYearName, r.average_score AS averageScore, r.class_position AS classPosition, r.attendance_percentage AS attendancePercentage, r.generated_at AS generatedAt FROM report_cards r INNER JOIN terms t ON t.id = r.term_id INNER JOIN academic_years y ON y.id = t.academic_year_id WHERE r.student_id IN (?) ORDER BY r.generated_at DESC LIMIT 20',
        [studentIds],
      )
      reportCards = reportRows as unknown[]
      const [feeRows] = await pool.execute(
        'SELECT f.id, f.student_id AS studentId, fs.name AS feeName, y.name AS academicYearName, f.amount_due AS amountDue, f.amount_paid AS amountPaid, f.status, (f.amount_due - f.amount_paid) AS balance FROM fee_items f INNER JOIN fee_structures fs ON fs.id = f.fee_structure_id INNER JOIN academic_years y ON y.id = fs.academic_year_id WHERE f.student_id IN (?) ORDER BY f.id DESC',
        [studentIds],
      )
      fees = feeRows as unknown[]
      const [classRows] = await pool.execute(
        'SELECT DISTINCT e.class_id AS classId FROM student_enrollments e WHERE e.student_id IN (?) AND e.enrollment_status = ?',
        [studentIds, 'ACTIVE'],
      )
      const classIds = (classRows as Array<{ classId: number }>).map((row) => Number(row.classId))
      if (classIds.length) {
        const [entries] = await pool.execute(
          'SELECT e.id, e.class_id AS classId, c.name AS className, e.day_of_week AS dayOfWeek, e.starts_at AS startsAt, e.ends_at AS endsAt, e.room, s.name AS subjectName, CONCAT_WS(" ", u.first_name, u.last_name) AS teacherName FROM timetable_entries e INNER JOIN classes c ON c.id = e.class_id INNER JOIN subjects s ON s.id = e.subject_id LEFT JOIN teachers tr ON tr.id = e.teacher_id LEFT JOIN users u ON u.id = tr.user_id WHERE e.class_id IN (?) AND e.academic_year_id = COALESCE((SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1), e.academic_year_id) ORDER BY e.day_of_week, e.starts_at',
          [classIds],
        )
        timetable = entries as unknown[]
      }
    }

    if (role === 'TEACHER') {
      const teacherId = await teacherIdFor(userId)
      if (teacherId) {
        const [profile] = await pool.execute(
          'SELECT tr.id, tr.employee_number AS employeeNumber, tr.qualification, tr.department FROM teachers tr WHERE tr.id = ?',
          [teacherId],
        )
        teacher = (profile as unknown[])[0] ?? null
        const [entries] = await pool.execute(
          'SELECT e.id, e.class_id AS classId, c.name AS className, e.day_of_week AS dayOfWeek, e.starts_at AS startsAt, e.ends_at AS endsAt, e.room, s.name AS subjectName FROM timetable_entries e INNER JOIN classes c ON c.id = e.class_id INNER JOIN subjects s ON s.id = e.subject_id WHERE e.teacher_id = ? AND e.academic_year_id = COALESCE((SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1), e.academic_year_id) ORDER BY e.day_of_week, e.starts_at',
          [teacherId],
        )
        timetable = entries as unknown[]
      }
    }

    res.json({
      success: true,
      overview: {
        role,
        unreadNotifications: Number((unread as Array<{ count: number }>)[0]?.count ?? 0),
        announcements,
        notifications,
        messages: inbox,
        students,
        attendance,
        reportCards,
        fees,
        timetable,
        teacher,
      },
    })
  } catch (error) {
    fail(res, 'load overview', error)
  }
})

router.post('/notifications/:notificationId/read', async (req: AuthenticatedRequest, res) => {
  const notificationId = parseId(req.params.notificationId)
  if (!notificationId) {
    res.status(400).json({ success: false, message: 'A valid notification ID is required' })
    return
  }
  try {
    await pool.execute(
      'UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?',
      [notificationId, req.user!.id],
    )
    res.json({ success: true, message: 'Notification marked as read' })
  } catch (error) {
    fail(res, 'mark notification read', error)
  }
})

router.post('/messages/:messageId/read', async (req: AuthenticatedRequest, res) => {
  const messageId = parseId(req.params.messageId)
  if (!messageId) {
    res.status(400).json({ success: false, message: 'A valid message ID is required' })
    return
  }
  try {
    await pool.execute(
      'UPDATE message_recipients SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE message_id = ? AND recipient_user_id = ?',
      [messageId, req.user!.id],
    )
    res.json({ success: true, message: 'Message marked as read' })
  } catch (error) {
    fail(res, 'mark message read', error)
  }
})

router.get('/attendance', async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== 'TEACHER' && req.user!.role !== 'HEADTEACHER' && req.user!.role !== 'ADMIN') {
    res.status(403).json({ success: false, message: 'Attendance registers are available to teaching staff' })
    return
  }
  const classId = parseId(req.query.classId)
  const termId = parseId(req.query.termId)
  const date = typeof req.query.date === 'string' ? req.query.date : ''
  if (!classId || !termId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ success: false, message: 'Class, term and date are required' })
    return
  }
  try {
    if (req.user!.role === 'TEACHER') {
      const teacherId = await teacherIdFor(req.user!.id)
      const [allowed] = await pool.execute(
        'SELECT id FROM timetable_entries WHERE teacher_id = ? AND class_id = ? LIMIT 1',
        [teacherId, classId],
      )
      if (!teacherId || !(allowed as unknown[]).length) {
        res.status(403).json({ success: false, message: 'You can only mark attendance for classes on your timetable' })
        return
      }
    }
    const [rows] = await pool.execute(
      'SELECT s.id AS studentId, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName, a.id AS attendanceId, a.status AS attendanceStatus, a.note FROM student_enrollments e INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN attendance_records a ON a.student_id = s.id AND a.attendance_date = ? AND a.class_id = ? AND a.term_id = ? WHERE e.class_id = ? AND e.term_id = ? AND e.enrollment_status = ? ORDER BY u.last_name, u.first_name',
      [date, classId, termId, classId, termId, 'ACTIVE'],
    )
    res.json({ success: true, records: rows })
  } catch (error) {
    fail(res, 'load attendance', error)
  }
})

router.post('/attendance', async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== 'TEACHER' && req.user!.role !== 'HEADTEACHER' && req.user!.role !== 'ADMIN') {
    res.status(403).json({ success: false, message: 'Attendance registers are available to teaching staff' })
    return
  }
  const classId = parseId(req.body?.classId)
  const termId = parseId(req.body?.termId)
  const date = typeof req.body?.date === 'string' ? req.body.date : ''
  const records = Array.isArray(req.body?.records) ? req.body.records : []
  if (!classId || !termId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !records.length) {
    res.status(400).json({ success: false, message: 'Class, term, date and at least one marked student are required' })
    return
  }
  try {
    if (req.user!.role === 'TEACHER') {
      const teacherId = await teacherIdFor(req.user!.id)
      const [allowed] = await pool.execute(
        'SELECT id FROM timetable_entries WHERE teacher_id = ? AND class_id = ? LIMIT 1',
        [teacherId, classId],
      )
      if (!teacherId || !(allowed as unknown[]).length) {
        res.status(403).json({ success: false, message: 'You can only mark attendance for classes on your timetable' })
        return
      }
    }
    const connection = await pool.getConnection()
    let saved = 0
    try {
      await connection.beginTransaction()
      for (const record of records as Array<Record<string, unknown>>) {
        const studentId = parseId(record.studentId)
        const status = typeof record.status === 'string' ? record.status : ''
        const note = typeof record.note === 'string' ? record.note.trim().slice(0, 255) : null
        if (!studentId || !attendanceStatuses.includes(status as typeof attendanceStatuses[number])) continue
        await connection.execute(
          'INSERT INTO attendance_records (student_id, class_id, term_id, attendance_date, status, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), recorded_by = VALUES(recorded_by)',
          [studentId, classId, termId, date, status, note, req.user!.id],
        )
        saved += 1
      }
      await connection.execute(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user!.id, 'PORTAL_ATTENDANCE_SAVED', 'attendance', classId, JSON.stringify({ date, saved }), req.ip ?? null, req.get('user-agent')?.slice(0, 500) ?? null],
      )
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
    res.json({ success: true, saved, message: 'Attendance register saved' })
  } catch (error) {
    fail(res, 'save attendance', error)
  }
})

export default router
