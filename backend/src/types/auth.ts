export type UserRole =
  | 'ADMIN'
  | 'HEADTEACHER'
  | 'TEACHER'
  | 'STUDENT'
  | 'PARENT'
  | 'STAFF'

export interface AuthUser {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  role: UserRole
}

export interface JwtPayload {
  userId: number
  role: UserRole
}
