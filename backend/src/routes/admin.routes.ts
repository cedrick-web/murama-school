import { Router } from 'express'

import { pool } from '../config/database.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth, requireRole('ADMIN'))

router.get('/users', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active, r.name AS role, u.last_login_at, u.created_at FROM users u INNER JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC',
    )

    res.json({ success: true, users: rows })
  } catch {
    res.status(500).json({
      success: false,
      message: 'Unable to load users',
    })
  }
})

router.patch('/users/:userId/role', async (req: AuthenticatedRequest, res) => {
  const userId = Number(req.params.userId)
  const roleName = typeof req.body?.role === 'string'
    ? req.body.role.trim().toUpperCase()
    : ''

  if (!Number.isInteger(userId) || userId < 1 || !roleName) {
    res.status(400).json({
      success: false,
      message: 'A valid user ID and role are required',
    })
    return
  }

  try {
    const [roles] = await pool.execute(
      'SELECT id, name FROM roles WHERE name = ? LIMIT 1',
      [roleName],
    )
    const role = (roles as Record<string, unknown>[])[0]

    if (!role) {
      res.status(400).json({
        success: false,
        message: 'Unknown role',
      })
      return
    }

    const [users] = await pool.execute(
      'SELECT id, role_id FROM users WHERE id = ? LIMIT 1',
      [userId],
    )
    const target = (users as Record<string, unknown>[])[0]

    if (!target) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      })
      return
    }

    await pool.execute(
      'UPDATE users SET role_id = ? WHERE id = ?',
      [Number(role.id), userId],
    )

    await pool.execute(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE role_id = role_id',
      [userId, Number(role.id)],
    )

    await pool.execute(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
      [
        req.user!.id,
        'ROLE_CHANGED',
        'user',
        userId,
        JSON.stringify({
          previous_role_id: Number(target.role_id),
          new_role: roleName,
        }),
      ],
    )

    res.json({
      success: true,
      message: 'User role updated',
    })
  } catch {
    res.status(500).json({
      success: false,
      message: 'Unable to update user role',
    })
  }
})

export default router
