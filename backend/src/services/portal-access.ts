import type { UserRole } from '../types/auth.js'

/**
 * Pure authorization decision used after database identity/relationship lookup.
 * Callers must not pass client-supplied IDs as linkedStudentIds unless a query
 * has verified the authenticated parent's relationship to each ID.
 */
export function authorizeStudentScope(
  role: UserRole,
  ownStudentId: number | null,
  linkedStudentIds: readonly number[],
  requestedStudentId?: number,
): number | null {
  if (role === 'STUDENT') {
    if (ownStudentId === null) return null
    return requestedStudentId === undefined || requestedStudentId === ownStudentId
      ? ownStudentId
      : null
  }

  if (role === 'PARENT' && requestedStudentId !== undefined) {
    return linkedStudentIds.includes(requestedStudentId) ? requestedStudentId : null
  }

  return null
}
