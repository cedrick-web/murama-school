import { Router } from 'express'
import type { Response } from 'express'
import type { PoolConnection } from '../config/database.js'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { createSchoolUser, parsePassword } from '../services/school-users.js'

const router = Router()

async function withTransaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) {
    try { await connection.rollback() } catch (rollbackError) {
      console.error('Unable to roll back directory transaction', rollbackError)
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
    [req.user!.id, action, entityType, entityId, JSON.stringify(details), req.ip ?? null, req.get('user-agent')?.slice(0, 500) ?? null],
  )
}

function fail(res: Response, action: string, error: unknown): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
    return
  }
  const code = (error as { code?: string } | null)?.code
  if (code === 'ER_DUP_ENTRY' || code === '23505') {
    res.status(409).json({ success: false, message: 'A record with those details already exists' })
    return
  }
  console.error(`Directory ${action} failed`, error)
  res.status(500).json({ success: false, message: `Unable to ${action}` })
}

function parseId(value: unknown): number | null {
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function parseText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 && text.length <= max ? text : null
}

function parseOptional(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length <= max ? text || null : undefined
}

function parsePerson(input: Record<string, unknown>) {
  const firstName = parseText(input.firstName, 100)
  const lastName = parseText(input.lastName, 100)
  const email = parseOptional(input.email, 190)
  const phone = parseOptional(input.phone, 30)
  if (!firstName || !lastName || email === undefined || phone === undefined) return null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return { firstName, lastName, email: email?.toLowerCase() ?? null, phone }
}

router.get('/teachers', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT tr.id, tr.employee_number AS employeeNumber, tr.qualification, tr.department, u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone, u.is_active AS isActive FROM teachers tr INNER JOIN users u ON u.id = tr.user_id ORDER BY u.last_name, u.first_name',
    )
    res.json({ success: true, teachers: rows })
  } catch (error) {
    fail(res, 'load teachers', error)
  }
})

router.post('/teachers', async (req: AuthenticatedRequest, res) => {
  const person = parsePerson(req.body ?? {})
  const password = parsePassword(req.body?.password)
  const employeeNumber = parseOptional(req.body?.employeeNumber, 50)
  const qualification = parseOptional(req.body?.qualification, 255)
  const department = parseOptional(req.body?.department, 150)
  if (!person || !person.email || !password || employeeNumber === undefined || qualification === undefined || department === undefined) {
    res.status(400).json({ success: false, message: 'Provide teacher names, a valid email, a password of at least 10 characters, and valid profile details' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const userId = await createSchoolUser(connection, {
        roleName: 'TEACHER',
        ...person,
        password,
        isActive: true,
      })
      const [result] = await connection.execute(
        'INSERT INTO teachers (user_id, employee_number, qualification, department) VALUES (?, ?, ?, ?)',
        [userId, employeeNumber, qualification, department],
      )
      const teacherId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'TEACHER_CREATED', 'teacher', teacherId, { employeeNumber })
      return teacherId
    })
    res.status(201).json({ success: true, id, message: 'Teacher account created with portal access' })
  } catch (error) {
    fail(res, 'create teacher', error)
  }
})

router.patch('/teachers/:teacherId', async (req: AuthenticatedRequest, res) => {
  const teacherId = parseId(req.params.teacherId)
  const person = parsePerson(req.body ?? {})
  const employeeNumber = parseOptional(req.body?.employeeNumber, 50)
  const qualification = parseOptional(req.body?.qualification, 255)
  const department = parseOptional(req.body?.department, 150)
  if (!teacherId || !person || employeeNumber === undefined || qualification === undefined || department === undefined) {
    res.status(400).json({ success: false, message: 'A valid teacher profile is required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [rows] = await connection.execute('SELECT id, user_id AS userId FROM teachers WHERE id = ? FOR UPDATE', [teacherId])
      const teacher = (rows as Record<string, unknown>[])[0]
      if (!teacher) return false
      await connection.execute(
        'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE id = ?',
        [person.firstName, person.lastName, person.email, person.phone, Number(teacher.userId)],
      )
      await connection.execute(
        'UPDATE teachers SET employee_number = ?, qualification = ?, department = ? WHERE id = ?',
        [employeeNumber, qualification, department, teacherId],
      )
      await audit(connection, req, 'TEACHER_UPDATED', 'teacher', teacherId, { employeeNumber })
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'Teacher not found' })
      return
    }
    res.json({ success: true, message: 'Teacher profile updated' })
  } catch (error) {
    fail(res, 'update teacher', error)
  }
})

router.get('/parents', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT p.id, p.occupation, p.address, u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone, u.is_active AS isActive FROM parents p INNER JOIN users u ON u.id = p.user_id ORDER BY u.last_name, u.first_name',
    )
    const [links] = await pool.execute(
      'SELECT sp.parent_id AS parentId, sp.student_id AS studentId, sp.relationship, sp.is_primary AS isPrimary, s.admission_number AS admissionNumber, u.first_name AS firstName, u.last_name AS lastName FROM student_parents sp INNER JOIN students s ON s.id = sp.student_id INNER JOIN users u ON u.id = s.user_id',
    )
    const childrenByParent = new Map<number, unknown[]>()
    for (const link of links as Array<Record<string, unknown>>) {
      const parentId = Number(link.parentId)
      const current = childrenByParent.get(parentId) ?? []
      current.push(link)
      childrenByParent.set(parentId, current)
    }
    const parents = (rows as Array<Record<string, unknown>>).map((parent) => ({
      ...parent,
      children: childrenByParent.get(Number(parent.id)) ?? [],
    }))
    res.json({ success: true, parents })
  } catch (error) {
    fail(res, 'load parents', error)
  }
})

router.post('/parents', async (req: AuthenticatedRequest, res) => {
  const person = parsePerson(req.body ?? {})
  const password = parsePassword(req.body?.password)
  const occupation = parseOptional(req.body?.occupation, 150)
  const address = parseOptional(req.body?.address, 255)
  if (!person || !person.email || !password || occupation === undefined || address === undefined) {
    res.status(400).json({ success: false, message: 'Provide parent names, a valid email, a password of at least 10 characters, and valid contact details' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const userId = await createSchoolUser(connection, {
        roleName: 'PARENT',
        ...person,
        password,
        isActive: true,
      })
      const [result] = await connection.execute(
        'INSERT INTO parents (user_id, occupation, address) VALUES (?, ?, ?)',
        [userId, occupation, address],
      )
      const parentId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'PARENT_CREATED', 'parent', parentId, { email: person.email })
      return parentId
    })
    res.status(201).json({ success: true, id, message: 'Parent account created with portal access' })
  } catch (error) {
    fail(res, 'create parent', error)
  }
})

router.patch('/parents/:parentId', async (req: AuthenticatedRequest, res) => {
  const parentId = parseId(req.params.parentId)
  const person = parsePerson(req.body ?? {})
  const occupation = parseOptional(req.body?.occupation, 150)
  const address = parseOptional(req.body?.address, 255)
  if (!parentId || !person || occupation === undefined || address === undefined) {
    res.status(400).json({ success: false, message: 'A valid parent profile is required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [rows] = await connection.execute('SELECT id, user_id AS userId FROM parents WHERE id = ? FOR UPDATE', [parentId])
      const parent = (rows as Record<string, unknown>[])[0]
      if (!parent) return false
      await connection.execute(
        'UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE id = ?',
        [person.firstName, person.lastName, person.email, person.phone, Number(parent.userId)],
      )
      await connection.execute(
        'UPDATE parents SET occupation = ?, address = ? WHERE id = ?',
        [occupation, address, parentId],
      )
      await audit(connection, req, 'PARENT_UPDATED', 'parent', parentId, {})
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'Parent not found' })
      return
    }
    res.json({ success: true, message: 'Parent profile updated' })
  } catch (error) {
    fail(res, 'update parent', error)
  }
})

router.post('/parents/:parentId/children', async (req: AuthenticatedRequest, res) => {
  const parentId = parseId(req.params.parentId)
  const studentId = parseId(req.body?.studentId)
  const relationship = parseText(req.body?.relationship, 50)
  const isPrimary = req.body?.isPrimary === true
  if (!parentId || !studentId || !relationship) {
    res.status(400).json({ success: false, message: 'Provide a parent, student and relationship' })
    return
  }
  try {
    await withTransaction(async (connection) => {
      await connection.execute(
        'INSERT INTO student_parents (student_id, parent_id, relationship, is_primary) VALUES (?, ?, ?, ?)',
        [studentId, parentId, relationship, isPrimary],
      )
      await audit(connection, req, 'PARENT_CHILD_LINKED', 'student_parent', parentId, { studentId, relationship, isPrimary })
    })
    res.status(201).json({ success: true, message: 'Student linked to parent account' })
  } catch (error) {
    fail(res, 'link parent and student', error)
  }
})

router.delete('/parents/:parentId/children/:studentId', async (req: AuthenticatedRequest, res) => {
  const parentId = parseId(req.params.parentId)
  const studentId = parseId(req.params.studentId)
  if (!parentId || !studentId) {
    res.status(400).json({ success: false, message: 'A valid parent and student are required' })
    return
  }
  try {
    await withTransaction(async (connection) => {
      await connection.execute('DELETE FROM student_parents WHERE parent_id = ? AND student_id = ?', [parentId, studentId])
      await audit(connection, req, 'PARENT_CHILD_UNLINKED', 'student_parent', parentId, { studentId })
    })
    res.json({ success: true, message: 'Student unlinked from parent account' })
  } catch (error) {
    fail(res, 'unlink parent and student', error)
  }
})

export default router
