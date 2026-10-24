import { Router } from 'express'
import type { Response } from 'express'
import type { PoolConnection } from 'mysql2/promise'

import { pool } from '../config/database.js'
import academicRoutes from './academic.routes.js'
import peopleRoutes from './people.routes.js'
import operationsRoutes from './operations.routes.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.js'
import type { UserRole } from '../types/auth.js'

const router = Router()
const validRoles: UserRole[] = [
  'ADMIN',
  'HEADTEACHER',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'STAFF',
]
const settingDefaults = {
  school_name: 'Ecole Secondaire de Murama',
  default_language: 'en',
  supported_languages: 'en,rw',
  timezone: 'Africa/Kigali',
  currency: 'RWF',
  contact_email: '',
  contact_phone: '',
  address: '',
} as const
type SettingKey = keyof typeof settingDefaults

router.use(requireAuth, requireRole('ADMIN'))
router.use('/academics', academicRoutes)
router.use('/people', peopleRoutes)
router.use('/operations', operationsRoutes)

async function withTransaction<T>(
  action: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) {
    try {
      await connection.rollback()
    } catch (rollbackError) {
      console.error('Unable to roll back admin transaction', rollbackError)
    }
    throw error
  } finally {
    connection.release()
  }
}

async function writeAuditLog(
  connection: PoolConnection,
  req: AuthenticatedRequest,
  action: string,
  entityType: string,
  entityId: number | null,
  details: Record<string, unknown>,
): Promise<void> {
  await connection.execute(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      req.user!.id,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      req.ip ?? null,
      req.get('user-agent')?.slice(0, 500) ?? null,
    ],
  )
}

function fail(
  res: Response,
  action: string,
  error: unknown,
): void {
  console.error(`Admin ${action} failed`, error)
  res.status(500).json({
    success: false,
    message: `Unable to ${action}`,
  })
}

function parseUserId(value: string | string[]): number | null {
  if (typeof value !== 'string') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

router.get('/users', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT u.id, u.first_name AS firstName, u.last_name AS lastName, u.email, u.phone, u.is_active AS isActive, r.name AS role, u.last_login_at AS lastLoginAt FROM users u INNER JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC',
    )
    res.json({ success: true, users: rows })
  } catch (error) {
    fail(res, 'load users', error)
  }
})

router.patch('/users/:userId/role', async (req: AuthenticatedRequest, res) => {
  const userId = parseUserId(req.params.userId)
  const roleName = typeof req.body?.role === 'string'
    ? req.body.role.trim().toUpperCase()
    : ''

  if (!userId || !validRoles.includes(roleName as UserRole)) {
    res.status(400).json({ success: false, message: 'A valid user ID and role are required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [roles] = await connection.execute(
        'SELECT id, name FROM roles WHERE name = ? LIMIT 1',
        [roleName],
      )
      const role = (roles as Record<string, unknown>[])[0]
      if (!role) return { status: 400, message: 'Unknown role' }

      const [users] = await connection.execute(
        'SELECT id, role_id AS roleId, is_active AS isActive FROM users WHERE id = ? FOR UPDATE',
        [userId],
      )
      const target = (users as Record<string, unknown>[])[0]
      if (!target) return { status: 404, message: 'User not found' }

      const previousRoleId = Number(target.roleId)
      const nextRoleId = Number(role.id)
      if (req.user!.id === userId && roleName !== 'ADMIN') {
        return { status: 400, message: 'You cannot change your own administrator role' }
      }
      if (previousRoleId === nextRoleId) return { status: 200, message: 'User role is unchanged' }

      if (Boolean(target.isActive) && roleName !== 'ADMIN') {
        const [admins] = await connection.execute(
          'SELECT id FROM roles WHERE name = ? FOR UPDATE',
          ['ADMIN'],
        )
        const adminRole = (admins as Record<string, unknown>[])[0]
        if (adminRole && previousRoleId === Number(adminRole.id)) {
          const [remaining] = await connection.execute(
            'SELECT COUNT(*) AS count FROM users WHERE role_id = ? AND is_active = TRUE AND id <> ?',
            [Number(adminRole.id), userId],
          )
          if (Number((remaining as Record<string, unknown>[])[0]?.count) === 0) {
            return { status: 409, message: 'At least one active administrator must remain' }
          }
        }
      }

      await connection.execute('UPDATE users SET role_id = ? WHERE id = ?', [nextRoleId, userId])
      await connection.execute('DELETE FROM user_roles WHERE user_id = ?', [userId])
      await connection.execute(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, nextRoleId],
      )
      await writeAuditLog(connection, req, 'ROLE_CHANGED', 'user', userId, {
        previousRoleId,
        newRole: roleName,
      })
      return { status: 200, message: 'User role updated' }
    })

    res.status(result.status).json({
      success: result.status < 400,
      message: result.message,
    })
  } catch (error) {
    fail(res, 'update user role', error)
  }
})

router.patch('/users/:userId/status', async (req: AuthenticatedRequest, res) => {
  const userId = parseUserId(req.params.userId)
  const isActive = req.body?.isActive
  if (!userId || typeof isActive !== 'boolean') {
    res.status(400).json({
      success: false,
      message: 'A valid user ID and boolean account status are required',
    })
    return
  }
  if (req.user!.id === userId && !isActive) {
    res.status(400).json({ success: false, message: 'You cannot deactivate your own account' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [users] = await connection.execute(
        'SELECT u.id, u.is_active AS isActive, u.role_id AS roleId, r.name AS role FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE u.id = ? FOR UPDATE',
        [userId],
      )
      const target = (users as Record<string, unknown>[])[0]
      if (!target) return { status: 404, message: 'User not found' }

      const wasActive = Boolean(target.isActive)
      if (wasActive === isActive) return { status: 200, message: 'Account status is unchanged' }
      if (!wasActive && isActive && target.role !== 'ADMIN') {
        return {
          status: 409,
          message: 'Portal accounts stay disabled until secure invitations are configured',
        }
      }

      if (wasActive && !isActive && target.role === 'ADMIN') {
        await connection.execute(
          'SELECT id FROM roles WHERE name = ? FOR UPDATE',
          ['ADMIN'],
        )
        const [remaining] = await connection.execute(
          'SELECT COUNT(*) AS count FROM users WHERE role_id = ? AND is_active = TRUE AND id <> ?',
          [Number(target.roleId), userId],
        )
        if (Number((remaining as Record<string, unknown>[])[0]?.count) === 0) {
          return { status: 409, message: 'At least one active administrator must remain' }
        }
      }

      await connection.execute('UPDATE users SET is_active = ? WHERE id = ?', [isActive, userId])
      await writeAuditLog(connection, req, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'user', userId, {
        isActive,
      })
      return { status: 200, message: `User ${isActive ? 'activated' : 'deactivated'}` }
    })

    res.status(result.status).json({
      success: result.status < 400,
      message: result.message,
    })
  } catch (error) {
    fail(res, 'update account status', error)
  }
})

router.get('/settings', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_key AS settingKey, setting_value AS settingValue FROM school_settings',
    )
    const settings: Record<string, string> = { ...settingDefaults }
    for (const row of rows as Record<string, unknown>[]) {
      if (
        typeof row.settingKey === 'string'
        && Object.hasOwn(settingDefaults, row.settingKey)
      ) {
        settings[row.settingKey] = String(row.settingValue ?? '')
      }
    }
    res.json({ success: true, settings })
  } catch (error) {
    fail(res, 'load school settings', error)
  }
})

router.put('/settings', async (req: AuthenticatedRequest, res) => {
  const input = req.body?.settings
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    res.status(400).json({ success: false, message: 'A settings object is required' })
    return
  }

  const unknownKeys = Object.keys(input).filter((key) => !Object.hasOwn(settingDefaults, key))
  if (unknownKeys.length) {
    res.status(400).json({ success: false, message: `Unsupported settings: ${unknownKeys.join(', ')}` })
    return
  }

  const values: Partial<Record<SettingKey, string>> = {}
  for (const [key, rawValue] of Object.entries(input)) {
    if (typeof rawValue !== 'string') {
      res.status(400).json({ success: false, message: `Setting ${key} must be text` })
      return
    }

    const value = rawValue.trim()
    if (value.length > 500) {
      res.status(400).json({ success: false, message: `Setting ${key} is too long` })
      return
    }
    if (key === 'school_name' && !value) {
      res.status(400).json({ success: false, message: 'School name cannot be empty' })
      return
    }
    if (key === 'default_language' && !['en', 'rw'].includes(value)) {
      res.status(400).json({ success: false, message: 'Default language must be en or rw' })
      return
    }
    if (key === 'supported_languages') {
      const languages = value.split(',').map((language) => language.trim())
      if (!languages.length || languages.some((language) => !['en', 'rw'].includes(language))) {
        res.status(400).json({ success: false, message: 'Supported languages can only include en and rw' })
        return
      }
    }
    if (key === 'timezone') {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value })
      } catch {
        res.status(400).json({ success: false, message: 'Timezone must be a valid IANA timezone' })
        return
      }
    }
    if (key === 'currency' && !/^[A-Za-z]{3}$/.test(value)) {
      res.status(400).json({ success: false, message: 'Currency must be a three-letter code' })
      return
    }
    if (key === 'contact_email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      res.status(400).json({ success: false, message: 'Contact email is invalid' })
      return
    }
    values[key as SettingKey] = value
  }

  if (!Object.keys(values).length) {
    res.status(400).json({ success: false, message: 'At least one setting is required' })
    return
  }

  try {
    await withTransaction(async (connection) => {
      for (const [key, value] of Object.entries(values)) {
        await connection.execute(
          'INSERT INTO school_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
          [key, value],
        )
      }
      await writeAuditLog(connection, req, 'SCHOOL_SETTINGS_UPDATED', 'school_settings', null, {
        updatedKeys: Object.keys(values),
      })
    })
    res.json({ success: true, message: 'School settings updated' })
  } catch (error) {
    fail(res, 'save school settings', error)
  }
})

router.get('/announcements', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT a.id, a.title, a.message, a.audience, a.is_published AS isPublished, a.published_at AS publishedAt, a.created_at AS createdAt, CONCAT_WS(" ", u.first_name, u.last_name) AS createdBy FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.created_at DESC',
    )
    res.json({ success: true, announcements: rows })
  } catch (error) {
    fail(res, 'load announcements', error)
  }
})

function validateAnnouncement(
  input: Record<string, unknown>,
): { title: string; message: string; audience: string; isPublished: boolean } | null {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  const audience = typeof input.audience === 'string' ? input.audience.trim() : ''
  const isPublished = input.isPublished

  if (!title || title.length > 200 || !message || message.length > 10000) return null
  if (!['all', 'students', 'parents', 'teachers', 'staff'].includes(audience)) return null
  if (typeof isPublished !== 'boolean') return null
  return { title, message, audience, isPublished }
}

router.post('/announcements', async (req: AuthenticatedRequest, res) => {
  const announcement = validateAnnouncement(req.body ?? {})
  if (!announcement) {
    res.status(400).json({
      success: false,
      message: 'Provide a title (up to 200 characters), message, valid audience, and publish status',
    })
    return
  }

  try {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO announcements (title, message, audience, is_published, published_at, created_by) VALUES (?, ?, ?, ?, IF(?, CURRENT_TIMESTAMP, NULL), ?)',
        [
          announcement.title,
          announcement.message,
          announcement.audience,
          announcement.isPublished,
          announcement.isPublished,
          req.user!.id,
        ],
      )
      const announcementId = Number((result as { insertId: number }).insertId)
      await writeAuditLog(connection, req, 'ANNOUNCEMENT_CREATED', 'announcement', announcementId, {
        title: announcement.title,
        isPublished: announcement.isPublished,
      })
      return announcementId
    })
    res.status(201).json({ success: true, announcement: { id, ...announcement } })
  } catch (error) {
    fail(res, 'create announcement', error)
  }
})

router.patch('/announcements/:announcementId', async (req: AuthenticatedRequest, res) => {
  const announcementId = parseUserId(req.params.announcementId)
  const announcement = validateAnnouncement(req.body ?? {})
  if (!announcementId || !announcement) {
    res.status(400).json({ success: false, message: 'A valid announcement and ID are required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute(
        'SELECT id FROM announcements WHERE id = ? FOR UPDATE',
        [announcementId],
      )
      if (!(existing as Record<string, unknown>[]).length) {
        return { status: 404, message: 'Announcement not found' }
      }

      await connection.execute(
        'UPDATE announcements SET title = ?, message = ?, audience = ?, is_published = ?, published_at = IF(?, COALESCE(published_at, CURRENT_TIMESTAMP), NULL) WHERE id = ?',
        [
          announcement.title,
          announcement.message,
          announcement.audience,
          announcement.isPublished,
          announcement.isPublished,
          announcementId,
        ],
      )
      await writeAuditLog(connection, req, 'ANNOUNCEMENT_UPDATED', 'announcement', announcementId, {
        title: announcement.title,
        isPublished: announcement.isPublished,
      })
      return { status: 200, message: 'Announcement updated' }
    })
    res.status(result.status).json({ success: result.status < 400, message: result.message })
  } catch (error) {
    fail(res, 'update announcement', error)
  }
})

router.delete('/announcements/:announcementId', async (req: AuthenticatedRequest, res) => {
  const announcementId = parseUserId(req.params.announcementId)
  if (!announcementId) {
    res.status(400).json({ success: false, message: 'A valid announcement ID is required' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [existing] = await connection.execute(
        'SELECT id, title FROM announcements WHERE id = ? FOR UPDATE',
        [announcementId],
      )
      const announcement = (existing as Record<string, unknown>[])[0]
      if (!announcement) return { status: 404, message: 'Announcement not found' }

      await writeAuditLog(connection, req, 'ANNOUNCEMENT_DELETED', 'announcement', announcementId, {
        title: announcement.title,
      })
      await connection.execute('DELETE FROM announcements WHERE id = ?', [announcementId])
      return { status: 200, message: 'Announcement deleted' }
    })
    res.status(result.status).json({ success: result.status < 400, message: result.message })
  } catch (error) {
    fail(res, 'delete announcement', error)
  }
})

router.get('/audit-logs', async (req, res) => {
  const requestedLimit = Number(req.query.limit ?? 50)
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 100))
    : 50

  try {
    const [rows] = await pool.execute(
      'SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.details, a.created_at AS createdAt, CONCAT_WS(" ", u.first_name, u.last_name) AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT ?',
      [limit],
    )
    res.json({ success: true, logs: rows })
  } catch (error) {
    fail(res, 'load audit log', error)
  }
})

export default router
