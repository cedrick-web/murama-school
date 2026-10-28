import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { Response } from 'express'
import type { PoolConnection } from '../config/database.js'
import bcrypt from 'bcryptjs'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { parsePassword } from '../services/school-users.js'

const router = Router()
const studentStatuses = ['ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED'] as const
const enrollmentStatuses = ['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN'] as const
type StudentStatus = typeof studentStatuses[number]
type EnrollmentStatus = typeof enrollmentStatuses[number]

interface StudentInput {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  admissionNumber: string
  dateOfBirth: string | null
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null
  admissionDate: string | null
  status: StudentStatus
}

interface EnrollmentInput {
  studentId: number
  academicYearId: number
  termId: number | null
  classId: number
  streamId: number | null
  enrolledOn: string
  status: EnrollmentStatus
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
      console.error('Unable to roll back student transaction', rollbackError)
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

function parseId(value: unknown): number | null {
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
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

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null
}

function parseOptionalDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  return parseDate(value) ?? undefined
}

function parseStudent(input: Record<string, unknown>): StudentInput | null {
  const firstName = parseText(input.firstName, 100)
  const lastName = parseText(input.lastName, 100)
  const email = parseOptionalText(input.email, 190)
  const phone = parseOptionalText(input.phone, 30)
  const admissionNumber = parseText(input.admissionNumber, 50)
  const dateOfBirth = parseOptionalDate(input.dateOfBirth)
  const admissionDate = parseOptionalDate(input.admissionDate)
  const gender = input.gender === '' || input.gender === undefined || input.gender === null
    ? null
    : input.gender
  const status = input.status

  if (
    !firstName
    || !lastName
    || email === undefined
    || phone === undefined
    || !admissionNumber
    || dateOfBirth === undefined
    || admissionDate === undefined
    || (gender !== null && !['MALE', 'FEMALE', 'OTHER'].includes(String(gender)))
    || !studentStatuses.includes(status as StudentStatus)
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    return null
  }

  return {
    firstName,
    lastName,
    email,
    phone,
    admissionNumber,
    dateOfBirth,
    gender: gender as StudentInput['gender'],
    admissionDate,
    status: status as StudentStatus,
  }
}

function parseEnrollment(input: Record<string, unknown>): EnrollmentInput | null {
  const studentId = parseId(input.studentId)
  const academicYearId = parseId(input.academicYearId)
  const classId = parseId(input.classId)
  const termId = input.termId === '' || input.termId === null || input.termId === undefined
    ? null
    : parseId(input.termId)
  const streamId = input.streamId === '' || input.streamId === null || input.streamId === undefined
    ? null
    : parseId(input.streamId)
  const enrolledOn = parseDate(input.enrolledOn)
  const status = input.status

  if (
    !studentId
    || !academicYearId
    || !classId
    || (input.termId !== '' && input.termId !== null && input.termId !== undefined && !termId)
    || (input.streamId !== '' && input.streamId !== null && input.streamId !== undefined && !streamId)
    || !enrolledOn
    || !enrollmentStatuses.includes(status as EnrollmentStatus)
  ) {
    return null
  }
  return { studentId, academicYearId, termId, classId, streamId, enrolledOn, status: status as EnrollmentStatus }
}

function reportFailure(res: Response, action: string, error: unknown): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
    return
  }
  const code = (error as { code?: string } | null)?.code
  if (code === 'ER_DUP_ENTRY' || code === '23505') {
    res.status(409).json({
      success: false,
      message: 'A record with those details already exists',
    })
    return
  }
  if (code === '23503') {
    res.status(409).json({ success: false, message: 'The selected academic or student record is no longer available' })
    return
  }
  console.error(`Student ${action} failed`, error)
  res.status(500).json({ success: false, message: `Unable to ${action}` })
}

router.get('/students', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT s.id, s.admission_number AS admissionNumber, s.date_of_birth AS dateOfBirth, s.gender, s.admission_date AS admissionDate, s.status, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone, u.is_active AS portalActive, e.id AS enrollmentId, e.academic_year_id AS academicYearId, y.name AS academicYearName, e.class_id AS classId, c.name AS className, e.stream_id AS streamId, st.name AS streamName, e.enrollment_status AS enrollmentStatus FROM students s INNER JOIN users u ON u.id = s.user_id LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = (SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1) LEFT JOIN academic_years y ON y.id = e.academic_year_id LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id ORDER BY u.last_name, u.first_name',
    )
    res.json({ success: true, students: rows })
  } catch (error) {
    reportFailure(res, 'load students', error)
  }
})

router.post('/students', async (req: AuthenticatedRequest, res) => {
  const student = parseStudent(req.body ?? {})
  if (!student) {
    res.status(400).json({
      success: false,
      message: 'Provide student names, an admission number, valid contact details, and valid dates',
    })
    return
  }

  try {
    const created = await withTransaction(async (connection) => {
      const [roles] = await connection.execute(
        'SELECT id FROM roles WHERE name = ? LIMIT 1',
        ['STUDENT'],
      )
      const studentRole = (roles as Record<string, unknown>[])[0]
      if (!studentRole) throw new Error('STUDENT role is missing from the database')

      const portalPassword = parsePassword(req.body?.portalPassword)
      const passwordHash = await bcrypt.hash(portalPassword ?? randomBytes(48).toString('base64url'), 12)
      const portalActive = Boolean(portalPassword)
      const [userResult] = await connection.execute(
        'INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          Number(studentRole.id),
          student.firstName,
          student.lastName,
          student.email,
          student.phone,
          passwordHash,
          portalActive,
        ],
      )
      const userId = Number((userResult as { insertId: number }).insertId)
      await connection.execute(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, Number(studentRole.id)],
      )
      const [studentResult] = await connection.execute(
        'INSERT INTO students (user_id, admission_number, date_of_birth, gender, admission_date, status) VALUES (?, ?, ?, ?, ?, ?)',
        [
          userId,
          student.admissionNumber,
          student.dateOfBirth,
          student.gender,
          student.admissionDate,
          student.status,
        ],
      )
      const studentId = Number((studentResult as { insertId: number }).insertId)
      await audit(connection, req, 'STUDENT_CREATED', 'student', studentId, {
        admissionNumber: student.admissionNumber,
        portalAccess: portalActive ? 'enabled' : 'disabled',
      })
      return { studentId, portalActive }
    })
    res.status(201).json({
      success: true,
      student: { id: created.studentId, ...student, portalActive: created.portalActive },
      message: created.portalActive
        ? 'Student record created with portal access enabled.'
        : 'Student record created. Add a portal password later to enable student sign-in.',
    })
  } catch (error) {
    reportFailure(res, 'create student', error)
  }
})

router.patch('/students/:studentId', async (req: AuthenticatedRequest, res) => {
  const studentId = parseId(req.params.studentId)
  const student = parseStudent(req.body ?? {})
  if (!studentId || !student) {
    res.status(400).json({ success: false, message: 'A valid student ID and student details are required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT user_id AS userId FROM students WHERE id = ? FOR UPDATE',
        [studentId],
      )
      const existing = (rows as Record<string, unknown>[])[0]
      if (!existing) return false

      await connection.execute(
        'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE id = ?',
        [student.firstName, student.lastName, student.email, student.phone, Number(existing.userId)],
      )
      await connection.execute(
        'UPDATE students SET admission_number = ?, date_of_birth = ?, gender = ?, admission_date = ?, status = ? WHERE id = ?',
        [
          student.admissionNumber,
          student.dateOfBirth,
          student.gender,
          student.admissionDate,
          student.status,
          studentId,
        ],
      )
      await audit(connection, req, 'STUDENT_UPDATED', 'student', studentId, {
        admissionNumber: student.admissionNumber,
        status: student.status,
      })
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Student not found' })
      return
    }
    res.json({ success: true, message: 'Student record updated' })
  } catch (error) {
    reportFailure(res, 'update student', error)
  }
})

router.get('/enrollments', async (req, res) => {
  const academicYearId = req.query.academicYearId === undefined
    ? null
    : parseId(req.query.academicYearId)
  if (req.query.academicYearId !== undefined && !academicYearId) {
    res.status(400).json({ success: false, message: 'A valid academic year ID is required' })
    return
  }

  try {
    const [rows] = await pool.execute(
      'SELECT e.id, e.student_id AS studentId, CONCAT_WS(" ", u.first_name, u.last_name) AS studentName, s.admission_number AS admissionNumber, e.academic_year_id AS academicYearId, y.name AS academicYearName, e.term_id AS termId, t.name AS termName, e.class_id AS classId, c.name AS className, e.stream_id AS streamId, st.name AS streamName, e.enrolled_on AS enrolledOn, e.enrollment_status AS status FROM student_enrollments e INNER JOIN students s ON s.id = e.student_id INNER JOIN users u ON u.id = s.user_id INNER JOIN academic_years y ON y.id = e.academic_year_id LEFT JOIN terms t ON t.id = e.term_id INNER JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id WHERE (? IS NULL OR e.academic_year_id = ?) ORDER BY y.starts_on DESC, c.name, u.last_name, u.first_name',
      [academicYearId, academicYearId],
    )
    res.json({ success: true, enrollments: rows })
  } catch (error) {
    reportFailure(res, 'load enrollments', error)
  }
})

router.post('/enrollments', async (req: AuthenticatedRequest, res) => {
  const enrollment = parseEnrollment(req.body ?? {})
  if (!enrollment) {
    res.status(400).json({ success: false, message: 'Provide a student, academic year, class, enrollment date, and valid status' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [students] = await connection.execute(
        'SELECT id FROM students WHERE id = ? FOR UPDATE',
        [enrollment.studentId],
      )
      if (!(students as Record<string, unknown>[]).length) return 'student-missing'

      const [years] = await connection.execute(
        'SELECT id FROM academic_years WHERE id = ?',
        [enrollment.academicYearId],
      )
      if (!(years as Record<string, unknown>[]).length) return 'year-missing'

      if (enrollment.termId !== null) {
        const [terms] = await connection.execute(
          'SELECT id FROM terms WHERE id = ? AND academic_year_id = ?',
          [enrollment.termId, enrollment.academicYearId],
        )
        if (!(terms as Record<string, unknown>[]).length) return 'term-invalid'
      }

      const [classes] = await connection.execute(
        'SELECT id FROM classes WHERE id = ?',
        [enrollment.classId],
      )
      if (!(classes as Record<string, unknown>[]).length) return 'class-missing'

      if (enrollment.streamId !== null) {
        const [streams] = await connection.execute(
          'SELECT id FROM streams WHERE id = ? AND class_id = ?',
          [enrollment.streamId, enrollment.classId],
        )
        if (!(streams as Record<string, unknown>[]).length) return 'stream-invalid'
      }

      const [existing] = await connection.execute(
        'SELECT id FROM student_enrollments WHERE student_id = ? AND academic_year_id = ? AND term_id <=> ?',
        [enrollment.studentId, enrollment.academicYearId, enrollment.termId],
      )
      if ((existing as Record<string, unknown>[]).length) return 'duplicate'

      const [insert] = await connection.execute(
        'INSERT INTO student_enrollments (student_id, academic_year_id, term_id, class_id, stream_id, enrollment_status, enrolled_on) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          enrollment.studentId,
          enrollment.academicYearId,
          enrollment.termId,
          enrollment.classId,
          enrollment.streamId,
          enrollment.status,
          enrollment.enrolledOn,
        ],
      )
      const id = Number((insert as { insertId: number }).insertId)
      await audit(connection, req, 'STUDENT_ENROLLED', 'enrollment', id, enrollment)
      return id
    })

    if (typeof result === 'string') {
      const messages: Record<string, string> = {
        'student-missing': 'Student not found',
        'year-missing': 'Academic year not found',
        'term-invalid': 'Term does not belong to the selected academic year',
        'class-missing': 'Class not found',
        'stream-invalid': 'Stream does not belong to the selected class',
        duplicate: 'This student already has an enrollment for that year and term',
      }
      res.status(result === 'duplicate' ? 409 : 400).json({
        success: false,
        message: messages[result] ?? 'Enrollment is invalid',
      })
      return
    }
    res.status(201).json({ success: true, enrollment: { id: result, ...enrollment } })
  } catch (error) {
    reportFailure(res, 'create enrollment', error)
  }
})

router.patch('/enrollments/:enrollmentId/status', async (req: AuthenticatedRequest, res) => {
  const enrollmentId = parseId(req.params.enrollmentId)
  const status = req.body?.status
  if (!enrollmentId || !enrollmentStatuses.includes(status as EnrollmentStatus)) {
    res.status(400).json({ success: false, message: 'A valid enrollment ID and status are required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id FROM student_enrollments WHERE id = ? FOR UPDATE',
        [enrollmentId],
      )
      if (!(rows as Record<string, unknown>[]).length) return false
      await connection.execute(
        'UPDATE student_enrollments SET enrollment_status = ? WHERE id = ?',
        [status, enrollmentId],
      )
      await audit(connection, req, 'ENROLLMENT_STATUS_CHANGED', 'enrollment', enrollmentId, { status })
      return true
    })
    if (!result) {
      res.status(404).json({ success: false, message: 'Enrollment not found' })
      return
    }
    res.json({ success: true, message: 'Enrollment status updated' })
  } catch (error) {
    reportFailure(res, 'update enrollment status', error)
  }
})

router.get('/parents', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT p.id, p.occupation, p.address, u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone, u.is_active AS portalActive, COUNT(DISTINCT sp.student_id) AS linkedStudents FROM parents p INNER JOIN users u ON u.id = p.user_id LEFT JOIN student_parents sp ON sp.parent_id = p.id GROUP BY p.id, p.occupation, p.address, u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active ORDER BY u.last_name, u.first_name',
    )
    res.json({ success: true, parents: rows })
  } catch (error) {
    reportFailure(res, 'load parents', error)
  }
})

router.post('/parents', async (req: AuthenticatedRequest, res) => {
  const firstName = parseText(req.body?.firstName, 100)
  const lastName = parseText(req.body?.lastName, 100)
  const email = parseText(req.body?.email, 190)?.toLowerCase() ?? null
  const phone = parseOptionalText(req.body?.phone, 30)
  const occupation = parseOptionalText(req.body?.occupation, 150)
  const address = parseOptionalText(req.body?.address, 255)
  if (!firstName || !lastName || !email || phone === undefined || occupation === undefined || address === undefined || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, message: 'Provide valid parent names, email and optional contact details' })
    return
  }

  try {
    const parent = await withTransaction(async (connection) => {
      const [roles] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', ['PARENT'])
      const parentRole = (roles as Record<string, unknown>[])[0]
      if (!parentRole) throw new Error('PARENT role is missing from the database')
      const inaccessiblePassword = randomBytes(48).toString('base64url')
      const passwordHash = await bcrypt.hash(inaccessiblePassword, 12)
      const [userResult] = await connection.execute(
        'INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?, FALSE)',
        [Number(parentRole.id), firstName, lastName, email, phone, passwordHash],
      )
      const userId = Number((userResult as { insertId: number }).insertId)
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, Number(parentRole.id)])
      const [parentResult] = await connection.execute(
        'INSERT INTO parents (user_id, occupation, address) VALUES (?, ?, ?)',
        [userId, occupation, address],
      )
      const parentId = Number((parentResult as { insertId: number }).insertId)
      await audit(connection, req, 'PARENT_CREATED', 'parent', parentId, { userId, portalAccess: 'pending_invitation' })
      return { id: parentId, userId, firstName, lastName, email, phone, occupation, address, portalActive: false, portalStatus: 'PENDING_INVITATION' }
    })
    res.status(201).json({ success: true, parent, message: 'Parent record created. Create a secure invitation to link a student and activate portal access.' })
  } catch (error) {
    reportFailure(res, 'create parent', error)
  }
})

router.get('/teachers', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT t.id, t.employee_number AS employeeNumber, t.qualification, t.department, u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone, u.is_active AS portalActive, COUNT(DISTINCT ts.id) AS assignmentsCount FROM teachers t INNER JOIN users u ON u.id = t.user_id LEFT JOIN teacher_subjects ts ON ts.teacher_id = t.id GROUP BY t.id, t.employee_number, t.qualification, t.department, u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active ORDER BY u.last_name, u.first_name',
    )
    res.json({ success: true, teachers: rows })
  } catch (error) {
    reportFailure(res, 'load teachers', error)
  }
})

router.post('/teachers', async (req: AuthenticatedRequest, res) => {
  const firstName = parseText(req.body?.firstName, 100)
  const lastName = parseText(req.body?.lastName, 100)
  const email = parseText(req.body?.email, 190)?.toLowerCase() ?? null
  const phone = parseOptionalText(req.body?.phone, 30)
  const employeeNumber = parseOptionalText(req.body?.employeeNumber, 50)
  const qualification = parseOptionalText(req.body?.qualification, 255)
  const department = parseOptionalText(req.body?.department, 150)
  if (!firstName || !lastName || !email || phone === undefined || employeeNumber === undefined || qualification === undefined || department === undefined || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, message: 'Provide valid teacher names, email and optional professional details' })
    return
  }

  try {
    const teacher = await withTransaction(async (connection) => {
      const [roles] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', ['TEACHER'])
      const teacherRole = (roles as Record<string, unknown>[])[0]
      if (!teacherRole) throw new Error('TEACHER role is missing from the database')
      const inaccessiblePassword = randomBytes(48).toString('base64url')
      const passwordHash = await bcrypt.hash(inaccessiblePassword, 12)
      const [userResult] = await connection.execute(
        'INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?, FALSE)',
        [Number(teacherRole.id), firstName, lastName, email, phone, passwordHash],
      )
      const userId = Number((userResult as { insertId: number }).insertId)
      await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, Number(teacherRole.id)])
      const [teacherResult] = await connection.execute(
        'INSERT INTO teachers (user_id, employee_number, qualification, department) VALUES (?, ?, ?, ?)',
        [userId, employeeNumber, qualification, department],
      )
      const teacherId = Number((teacherResult as { insertId: number }).insertId)
      await audit(connection, req, 'TEACHER_CREATED', 'teacher', teacherId, { userId, portalAccess: 'pending_invitation' })
      return { id: teacherId, userId, firstName, lastName, email, phone, employeeNumber, qualification, department, portalActive: false, portalStatus: 'PENDING_INVITATION', assignmentsCount: 0 }
    })
    res.status(201).json({ success: true, teacher, message: 'Teacher record created. Assign classes and subjects, then create a secure invitation.' })
  } catch (error) {
    reportFailure(res, 'create teacher', error)
  }
})

router.get('/teacher-assignments', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT ts.id, ts.teacher_id AS teacherId, CONCAT_WS(\' \', tu.first_name, tu.last_name) AS teacherName, t.employee_number AS employeeNumber, ts.class_id AS classId, c.name AS className, ts.subject_id AS subjectId, sub.code AS subjectCode, sub.name AS subjectName, ts.academic_year_id AS academicYearId, ay.name AS academicYear FROM teacher_subjects ts INNER JOIN teachers t ON t.id = ts.teacher_id INNER JOIN users tu ON tu.id = t.user_id INNER JOIN classes c ON c.id = ts.class_id INNER JOIN subjects sub ON sub.id = ts.subject_id INNER JOIN academic_years ay ON ay.id = ts.academic_year_id ORDER BY ay.is_current DESC, ay.starts_on DESC, c.name, sub.name, teacherName',
    )
    res.json({ success: true, assignments: rows })
  } catch (error) {
    reportFailure(res, 'load teacher assignments', error)
  }
})

router.post('/teacher-assignments', async (req: AuthenticatedRequest, res) => {
  const teacherId = parseId(req.body?.teacherId)
  const classId = parseId(req.body?.classId)
  const subjectId = parseId(req.body?.subjectId)
  const academicYearId = parseId(req.body?.academicYearId)
  if (!teacherId || !classId || !subjectId || !academicYearId) {
    res.status(400).json({ success: false, message: 'Choose a teacher, class, subject and academic year' })
    return
  }

  try {
    const assignment = await withTransaction(async (connection) => {
      const [teachers] = await connection.execute('SELECT id FROM teachers WHERE id = ? LIMIT 1', [teacherId])
      const [classes] = await connection.execute('SELECT id FROM classes WHERE id = ? LIMIT 1', [classId])
      const [subjects] = await connection.execute('SELECT id FROM subjects WHERE id = ? LIMIT 1', [subjectId])
      const [years] = await connection.execute('SELECT id FROM academic_years WHERE id = ? LIMIT 1', [academicYearId])
      if (!(teachers as Record<string, unknown>[]).length || !(classes as Record<string, unknown>[]).length || !(subjects as Record<string, unknown>[]).length || !(years as Record<string, unknown>[]).length) {
        return { ok: false as const, status: 404, message: 'One or more selected school records were not found' }
      }
      const [existing] = await connection.execute(
        'SELECT id FROM teacher_subjects WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND academic_year_id = ? LIMIT 1',
        [teacherId, classId, subjectId, academicYearId],
      )
      if ((existing as Record<string, unknown>[]).length) {
        return { ok: false as const, status: 409, message: 'This teacher is already assigned to that class, subject and academic year' }
      }
      const [insertResult] = await connection.execute(
        'INSERT INTO teacher_subjects (teacher_id, class_id, subject_id, academic_year_id) VALUES (?, ?, ?, ?)',
        [teacherId, classId, subjectId, academicYearId],
      )
      const assignmentId = Number((insertResult as { insertId: number }).insertId)
      await audit(connection, req, 'TEACHER_ASSIGNMENT_CREATED', 'teacher_subject', assignmentId, { teacherId, classId, subjectId, academicYearId })
      return { ok: true as const, id: assignmentId }
    })
    if (!assignment.ok) {
      res.status(assignment.status).json({ success: false, message: assignment.message })
      return
    }
    res.status(201).json({ success: true, assignmentId: assignment.id, message: 'Teacher assignment created' })
  } catch (error) {
    reportFailure(res, 'create teacher assignment', error)
  }
})

router.delete('/teacher-assignments/:assignmentId', async (req: AuthenticatedRequest, res) => {
  const assignmentId = parseId(req.params.assignmentId)
  if (!assignmentId) {
    res.status(400).json({ success: false, message: 'A valid teacher assignment ID is required' })
    return
  }
  try {
    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id, teacher_id AS teacherId, class_id AS classId, subject_id AS subjectId, academic_year_id AS academicYearId FROM teacher_subjects WHERE id = ? LIMIT 1 FOR UPDATE',
        [assignmentId],
      )
      const assignment = (rows as Record<string, unknown>[])[0]
      if (!assignment) return { ok: false as const, status: 404, message: 'Teacher assignment not found' }
      await connection.execute('DELETE FROM teacher_subjects WHERE id = ?', [assignmentId])
      await audit(connection, req, 'TEACHER_ASSIGNMENT_REMOVED', 'teacher_subject', assignmentId, {
        teacherId: Number(assignment.teacherId), classId: Number(assignment.classId), subjectId: Number(assignment.subjectId), academicYearId: Number(assignment.academicYearId),
      })
      return { ok: true as const }
    })
    if (!result.ok) {
      res.status(result.status).json({ success: false, message: result.message })
      return
    }
    res.json({ success: true, message: 'Teacher assignment removed' })
  } catch (error) {
    reportFailure(res, 'remove teacher assignment', error)
  }
})

export default router
