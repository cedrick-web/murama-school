import type { AuthUser } from '../types/auth.js'
import { authorizeStudentScope } from './portal-access.js'

type Row = Record<string, unknown>
export type PortalQueryExecutor = (sql: string, values: unknown[]) => Promise<unknown>

/**
 * All student/parent record access is resolved from the authenticated account.
 * The requested student ID is never considered proof of a parent relationship.
 */
export async function resolvePortalStudentId(
  query: PortalQueryExecutor,
  user: AuthUser,
  requestedStudentId?: number,
): Promise<number | null> {
  if (user.role === 'STUDENT') {
    const result = await query(
      'SELECT id FROM students WHERE user_id = ? LIMIT 1',
      [user.id],
    )
    const rows = Array.isArray(result) ? result[0] as Row[] : []
    const student = rows[0]
    if (!student) return null
    return authorizeStudentScope(user.role, Number(student.id), [], requestedStudentId)
  }

  if (user.role === 'PARENT' && requestedStudentId !== undefined) {
    const result = await query(
      'SELECT s.id FROM parents p INNER JOIN student_parents sp ON sp.parent_id = p.id INNER JOIN students s ON s.id = sp.student_id WHERE p.user_id = ? AND s.id = ? LIMIT 1',
      [user.id, requestedStudentId],
    )
    const rows = Array.isArray(result) ? result[0] as Row[] : []
    const student = rows[0]
    return authorizeStudentScope(user.role, null, student ? [Number(student.id)] : [], requestedStudentId)
  }

  return null
}

export async function listParentChildren(
  query: PortalQueryExecutor,
  parentUserId: number,
): Promise<Row[]> {
  const result = await query(
    'SELECT s.id AS studentId, s.admission_number AS admissionNumber, s.status, sp.relationship, sp.is_primary AS isPrimary, u.first_name AS firstName, u.last_name AS lastName, c.name AS className, st.name AS streamName, ay.name AS academicYear FROM parents p INNER JOIN student_parents sp ON sp.parent_id = p.id INNER JOIN students s ON s.id = sp.student_id INNER JOIN users u ON u.id = s.user_id LEFT JOIN student_enrollments e ON e.id = (SELECT e2.id FROM student_enrollments e2 WHERE e2.student_id = s.id AND e2.enrollment_status = ? ORDER BY e2.academic_year_id DESC, e2.term_id DESC NULLS LAST, e2.id DESC LIMIT 1) LEFT JOIN academic_years ay ON ay.id = e.academic_year_id LEFT JOIN classes c ON c.id = e.class_id LEFT JOIN streams st ON st.id = e.stream_id WHERE p.user_id = ? ORDER BY sp.is_primary DESC, u.last_name, u.first_name',
    ['ACTIVE', parentUserId],
  )
  const rows = Array.isArray(result) ? result[0] : null
  return Array.isArray(rows) ? rows as Row[] : []
}
