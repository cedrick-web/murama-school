import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { pool } from '../config/database.js'

dotenv.config()

const rl = createInterface({ input, output })

try {
  const firstName = (await rl.question('First name: ')).trim()
  const lastName = (await rl.question('Last name: ')).trim()
  const email = (await rl.question('Admin email: ')).trim().toLowerCase()
  const password = await rl.question('Admin password (12+ characters): ')

  if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) {
    throw new Error('Provide valid names, a valid email and a password between 12 and 128 characters')
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [existingUsers] = await connection.execute(
      'SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1 FOR UPDATE',
      [email],
    )
    if ((existingUsers as Record<string, unknown>[]).length) {
      throw new Error('An account already exists for this email address')
    }

    const [roles] = await connection.execute(
      'SELECT id FROM roles WHERE name = ? LIMIT 1',
      ['ADMIN'],
    )
    const adminRole = (roles as Record<string, unknown>[])[0]
    if (!adminRole) {
      throw new Error('ADMIN role is missing. Apply the Murama School database schema first.')
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const [userResult] = await connection.execute(
      'INSERT INTO users (role_id, first_name, last_name, email, password_hash, is_active) VALUES (?, ?, ?, ?, ?, TRUE)',
      [Number(adminRole.id), firstName, lastName, email, passwordHash],
    )
    const adminId = Number((userResult as { insertId: number }).insertId)
    await connection.execute(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [adminId, Number(adminRole.id)],
    )
    await connection.execute(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [adminId, 'BOOTSTRAP_ADMIN_CREATED', 'user', adminId, JSON.stringify({ role: 'ADMIN' })],
    )
    await connection.commit()
    console.log('Administrator account created successfully.')
  } catch (error) {
    try {
      await connection.rollback()
    } catch (rollbackError) {
      console.error('Unable to roll back administrator creation', rollbackError)
    }
    throw error
  } finally {
    connection.release()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to create administrator account')
  process.exitCode = 1
} finally {
  rl.close()
  await pool.end()
}
