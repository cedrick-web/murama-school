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
  const password = await rl.question('Admin password: ')

  if (!firstName || !lastName || !email || password.length < 8) {
    throw new Error('Name, email and a password of at least 8 characters are required')
  }

  const [roles] = await pool.execute(
    'SELECT id FROM roles WHERE name = ? LIMIT 1',
    ['ADMIN'],
  )
  const adminRole = (roles as Record<string, unknown>[])[0]

  if (!adminRole) {
    throw new Error('ADMIN role is missing. Import the Murama School database schema first.')
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await pool.execute(
    'INSERT INTO users (role_id, first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?, ?)',
    [Number(adminRole.id), firstName, lastName, email, passwordHash],
  )

  console.log('Admin account created successfully.')
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Unable to create admin account',
  )
  process.exitCode = 1
} finally {
  rl.close()
  await pool.end()
}
