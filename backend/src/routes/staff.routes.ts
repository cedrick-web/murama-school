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
      const [scheduleRows, assessmentRows, studentRows] = await Promise.all([
        pool.execute(
          'SELECT COUNT(*) AS entryCount, COUNT(DISTINCT class_id) AS classCount FROM timetable_entries WHERE teacher_id = ? AND (term_id IS NULL OR term_id IN (SELECT id FROM terms WHERE academic_year_id = timetable_entries.academic_year_id))',
          [teacherId],
        ),
        pool.execute(
          'SELECT COUNT(*) AS assessmentCount FROM assessments WHERE created_by = ?',
          [userId],
        ),
        pool.execute(
          'SELECT COUNT(DISTINCT e.student_id) AS studentCount FROM student_enrollments e WHERE e.enrollment_status = ? AND EXISTS (SELECT 1 FROM timetable_entries te WHERE te.teacher_id = ? AND te.class_id = e.class_id AND (te.stream_id IS NULL OR te.stream_id = e.stream_id) AND te.academic_year_id = e.academic_year_id AND (te.term_id IS NULL OR te.term_id = e.term_id))',
          ['ACTIVE', teacherId],
        ),
      ])
      const schedule = (scheduleRows[0] as Row[])[0] ?? {}
      teaching = {
        assignedClasses: Number(schedule.classCount ?? 0),
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
      'SELECT DISTINCT c.id AS classId, c.name AS className, st.id AS streamId, st.name AS streamName, ay.id AS academicYearId, ay.name AS academicYearName, COUNT(DISTINCT e.student_id) AS activeStudents, COUNT(DISTINCT te.id) AS timetableEntries FROM teachers tr INNER JOIN timetable_entries te ON te.teacher_id = tr.id INNER JOIN classes c ON c.id = te.class_id LEFT JOIN streams st ON st.id = te.stream_id INNER JOIN academic_years ay ON ay.id = te.academic_year_id LEFT JOIN student_enrollments e ON e.class_id = te.class_id AND (te.stream_id IS NULL OR e.stream_id = te.stream_id) AND e.academic_year_id = te.academic_year_id AND (e.term_id = te.term_id OR te.term_id IS NULL) AND e.enrollment_status = ? WHERE tr.user_id = ? GROUP BY c.id, c.name, st.id, st.name, ay.id, ay.name ORDER BY ay.name DESC, c.name, st.name',
      ['ACTIVE', req.user!.id],
    )
    res.json({ success: true, classes: rows })
  } catch (error) {
    respondWithError(res, 'classes', error)
  }
})

export default router
