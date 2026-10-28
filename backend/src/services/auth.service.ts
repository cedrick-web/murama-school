import bcrypt from 'bcryptjs'

import { pool } from '../config/database.js'
import type { AuthUser } from '../types/auth.js'

interface LoginResult {
  user: AuthUser
}

function mapUser(row: Record<string, unknown>): AuthUser {
  return {
    id: Number(row.id),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    role: String(row.role) as AuthUser['role'],
  }
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const [rows] = await pool.execute(
    'SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.password_hash, u.is_active, r.name AS role FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE LOWER(u.email) = LOWER(?) LIMIT 1',
    [email],
  )

  const row = (rows as Record<string, unknown>[])[0]

  if (!row || !Boolean(row.is_active)) {
    return null
  }

  const passwordMatches = await bcrypt.compare(password, String(row.password_hash))

  if (!passwordMatches) {
    return null
  }

  const user = mapUser(row)

  await pool.execute(
    'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
    [user.id],
  )

  return { user }
}

export async function loginWithVerifiedEmail(email: string): Promise<LoginResult | null> {
  const [rows] = await pool.execute(
    'SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active, r.name AS role FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE LOWER(u.email) = LOWER(?) LIMIT 1',
    [email],
  )

  const row = (rows as Record<string, unknown>[])[0]
  if (!row || !Boolean(row.is_active)) return null

  const user = mapUser(row)
  await pool.execute(
    'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
    [user.id],
  )
  return { user }
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  nextPassword: string,
): Promise<'ok' | 'invalid' | 'missing'> {
  const [rows] = await pool.execute(
    'SELECT password_hash FROM users WHERE id = ? AND is_active = TRUE LIMIT 1',
    [userId],
  )
  const row = (rows as Record<string, unknown>[])[0]
  if (!row) return 'missing'
  const matches = await bcrypt.compare(currentPassword, String(row.password_hash))
  if (!matches) return 'invalid'
  const passwordHash = await bcrypt.hash(nextPassword, 12)
  await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId])
  return 'ok'
}

export async function getUserById(id: number): Promise<AuthUser | null> {
  const [rows] = await pool.execute(
    'SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active, r.name AS role FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1',
    [id],
  )

  const row = (rows as Record<string, unknown>[])[0]

  if (!row || !Boolean(row.is_active)) {
    return null
  }

  return mapUser(row)
}
