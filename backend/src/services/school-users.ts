import bcrypt from 'bcryptjs'
import type { PoolConnection } from '../config/database.js'
import type { UserRole } from '../types/auth.js'

export const provisionableRoles: UserRole[] = [
  'ADMIN',
  'HEADTEACHER',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'STAFF',
]

export function parsePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const password = value
  if (password.trim().length === 0 || password.length < 10 || password.length > 128) return null
  return password
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function getRoleId(connection: PoolConnection, roleName: UserRole): Promise<number> {
  const [roles] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', [roleName])
  const role = (roles as Record<string, unknown>[])[0]
  if (!role) throw new Error(`${roleName} role is missing from the database`)
  return Number(role.id)
}

export async function createSchoolUser(
  connection: PoolConnection,
  input: {
    roleName: UserRole
    firstName: string
    lastName: string
    email: string | null
    phone: string | null
    password: string
    isActive: boolean
  },
): Promise<number> {
  const roleId = await getRoleId(connection, input.roleName)
  const passwordHash = await hashPassword(input.password)
  const email = input.email?.trim().toLowerCase() || null
  const [result] = await connection.execute(
    'INSERT INTO users (role_id, first_name, last_name, email, phone, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [roleId, input.firstName, input.lastName, email, input.phone, passwordHash, input.isActive],
  )
  const userId = Number((result as { insertId: number }).insertId)
  await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])
  return userId
}

export async function notifyRole(
  connection: PoolConnection,
  roleName: UserRole,
  title: string,
  body: string,
  type = 'general',
): Promise<void> {
  const [users] = await connection.execute(
    'SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE r.name = ? AND u.is_active = TRUE',
    [roleName],
  )
  for (const user of users as Array<{ id: number }>) {
    await connection.execute(
      'INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)',
      [user.id, title, body, type],
    )
  }
}
