import { Router, type Response } from 'express'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth, requireRole('HEADTEACHER', 'STAFF'))

type Row = Record<string, unknown>

function respondWithError(res: Response, action: string, error: unknown): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({
      success: false,
      message: 'The school database is not configured or is temporarily unavailable.',
    })
    return
  }

  console.error('Staff workspace request failed: ' + action, error)
  res.status(500).json({ success: false, message: 'Unable to load staff workspace information' })
}

/**
 * Staff access is intentionally scoped by the authenticated user's database ID.
 * Teacher IDs, class IDs and timetable assignments are never accepted from the client
 * as proof of authorization.
 */
router.get('/overview', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id
    const role = req.user!.role

    const [teacherRows, messageRows, notificationRows] = await Promise.all([
      pool.execute(
        'SELECT id, employee_number AS employeeNumber FROM teachers WHERE user_id = ? LIMIT 1',
        [userId],
      ),
      pool.execute(
        'SELECT COUNT(*) AS unreadCount FROM message_recipients WHERE recipient_user_id = ? AND read_at IS NULL',
        [userId],
      ),
      pool.execute(
        'SELECT COUNT(*) AS unreadCount FROM notifications WHERE user_id = ? AND read_at IS NULL',
        [userId],
      ),
    ])

    const teacher = (teacherRows[0] as Row[])[0] ?? null
    let teaching = {
      assignedClasses: 0,
      timetableEntries: 0,
      assessmentsCreated: 0,
      studentsInAssignedClasses: 0,
    }

    if (teacher && role === 'HEADTEACHER') {
      const teacherId = Number(teacher.id)
      const [scheduleRows, assessmentRows, studentRows, assignmentRows] = await Promise.all([
        pool.execute(
          'SELECT COUNT(*) AS entryCount FROM timetable_entries WHERE teacher_id = ? AND (term_id IS NULL OR term_id IN (SELECT id FROM terms WHERE academic_year_id = timetable_entries.academic_year_id))',
          [teacherId],
        ),
        pool.execute(
          'SELECT COUNT(*) AS assessmentCount FROM assessments WHERE created_by = ?',
          [userId],
        ),
        pool.execute(
          'SELECT COUNT(DISTINCT e.student_id) AS studentCount FROM student_enrollments e INNER JOIN teacher_subjects ts ON ts.class_id = e.class_id AND ts.academic_year_id = e.academic_year_id WHERE e.enrollment_status = ? AND ts.teacher_id = ?',
          ['ACTIVE', teacherId],
        ),
        pool.execute(
          'SELECT COUNT(DISTINCT ts.class_id) AS classCount FROM teacher_subjects ts INNER JOIN academic_years ay ON ay.id = ts.academic_year_id WHERE ts.teacher_id = ? AND ay.is_current = TRUE',
          [teacherId],
        ),
      ])
      const schedule = (scheduleRows[0] as Row[])[0] ?? {}
      teaching = {
        assignedClasses: Number(((assignmentRows[0] as Row[])[0] ?? {}).classCount ?? 0),
        timetableEntries: Number(schedule.entryCount ?? 0),
        assessmentsCreated: Number(((assessmentRows[0] as Row[])[0] ?? {}).assessmentCount ?? 0),
        studentsInAssignedClasses: Number(((studentRows[0] as Row[])[0] ?? {}).studentCount ?? 0),
      }
    }

    res.json({
      success: true,
      profile: {
        id: userId,
        firstName: req.user!.firstName,
        lastName: req.user!.lastName,
        email: req.user!.email,
        role,
        employeeNumber: teacher?.employeeNumber ?? null,
      },
      permissions: {
        canViewTeachingAssignments: Boolean(teacher) && role === 'HEADTEACHER',
        canManageSchoolAdministration: false,
      },
      teaching,
      unreadMessages: Number(((messageRows[0] as Row[])[0] ?? {}).unreadCount ?? 0),
      unreadNotifications: Number(((notificationRows[0] as Row[])[0] ?? {}).unreadCount ?? 0),
    })
  } catch (error) {
    respondWithError(res, 'overview', error)
  }
})

router.get('/timetable', async (req: AuthenticatedRequest, res) => {
  if (req.user!.role !== 'HEADTEACHER') {
    res.status(403).json({
      success: false,
      message: 'Teaching timetable access is available to the headteacher workspace only',
    })
    return
  }

  try {
    const [teacherRows] = await pool.execute(
      'SELECT id FROM teachers WHERE user_id = ? LIMIT 1',
      [req.user!.id],
    )
    const teacher = (teacherRows as Row[])[0]
    if (!teacher) {
      res.json({ success: true, entries: [], message: 'No teacher profile is linked to this account yet' })
      return
    }

    const [rows] = await pool.execute(
      'SELECT te.id, te.day_of_week AS dayOfWeek, te.starts_at AS startsAt, te.ends_at AS endsAt, te.room, te.class_id AS classId, c.name AS className, te.stream_id AS streamId, st.name AS streamName, te.subject_id AS subjectId, sub.code AS subjectCode, sub.name AS subjectName, te.academic_year_id AS academicYearId, ay.name AS academicYearName, te.term_id AS termId, t.name AS termName FROM timetable_entries te INNER JOIN classes c ON c.id = te.class_id LEFT JOIN streams st ON st.id = te.stream_id INNER JOIN subjects sub ON sub.id = te.subject_id INNER JOIN academic_years ay ON ay.id = te.academic_year_id LEFT JOIN terms t ON t.id = te.term_id WHERE te.teacher_id = ? ORDER BY te.day_of_week, te.starts_at, c.name',
      [Number(teacher.id)],
    )

    res.json({ success: true, entries: rows })
  } catch (error) {
    respondWithError(res, 'timetable', error)
  }
})

router.get('/classes', async (req: AuthenticatedRequest, res) => {
  if (!['TEACHER', 'HEADTEACHER'].includes(req.user!.role)) {
    res.status(403).json({
      success: false,
      message: 'Teaching class access is available to the headteacher workspace only',
    })
    return
  }

  try {
    const [rows] = await pool.execute(
      'SELECT ts.class_id AS classId, c.name AS className, ts.subject_id AS subjectId, sub.name AS subjectName, ay.id AS academicYearId, ay.name AS academicYearName, COUNT(DISTINCT e.student_id) AS activeStudents, COUNT(DISTINCT te.id) AS timetableEntries FROM teachers tr INNER JOIN teacher_subjects ts ON ts.teacher_id = tr.id INNER JOIN classes c ON c.id = ts.class_id INNER JOIN subjects sub ON sub.id = ts.subject_id INNER JOIN academic_years ay ON ay.id = ts.academic_year_id LEFT JOIN student_enrollments e ON e.class_id = ts.class_id AND e.academic_year_id = ts.academic_year_id AND e.enrollment_status = ? LEFT JOIN timetable_entries te ON te.teacher_id = tr.id AND te.class_id = ts.class_id AND te.subject_id = ts.subject_id AND te.academic_year_id = ts.academic_year_id WHERE tr.user_id = ? AND ay.is_current = TRUE GROUP BY ts.class_id, c.name, ts.subject_id, sub.name, ay.id, ay.name ORDER BY ay.name DESC, c.name, sub.name',
      ['ACTIVE', req.user!.id],
    )
    res.json({ success: true, classes: rows })
  } catch (error) {
    respondWithError(res, 'classes', error)
  }
})

export default router
