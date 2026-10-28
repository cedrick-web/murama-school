import type { SchoolUser } from './supabase-auth'

export const SCHOOL_TOKEN_KEY = 'murama-session-token'
const legacyTokenKeys = ['murama-admin-token', 'murama-teacher-token', 'murama-portal-token', 'murama-staff-token'] as const

/** One school session across workspaces. Old portal-specific keys are migration-only. */
export function readSchoolToken(): string | null {
  const current = sessionStorage.getItem(SCHOOL_TOKEN_KEY)
  if (current) return current
  for (const key of legacyTokenKeys) {
    const token = sessionStorage.getItem(key)
    if (token) {
      persistSchoolToken(token)
      return token
    }
  }
  return null
}

export function clearSchoolSession(): void {
  sessionStorage.removeItem(SCHOOL_TOKEN_KEY)
  for (const key of legacyTokenKeys) sessionStorage.removeItem(key)
  sessionStorage.removeItem('murama-google-return-path')
}

export function persistSchoolToken(token: string): void {
  clearSchoolSession()
  sessionStorage.setItem(SCHOOL_TOKEN_KEY, token)
}

export function schoolHomePath(role: SchoolUser['role']): string {
  switch (role) {
    case 'ADMIN':
    case 'HEADTEACHER': return '/admin/dashboard'
    case 'TEACHER': return '/teacher'
    case 'STAFF': return '/staff'
    case 'STUDENT': return '/portal/student'
    case 'PARENT': return '/portal/parent'
  }
}
