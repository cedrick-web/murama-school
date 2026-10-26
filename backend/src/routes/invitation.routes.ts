import { createHash } from 'node:crypto'
import { Router, type Response } from 'express'
import bcrypt from 'bcryptjs'

import { isDatabaseUnavailable, pool, type PoolConnection } from '../config/database.js'
import { createRateLimiter } from '../middleware/rate-limit.js'

const router = Router()
const tokenRateLimit = createRateLimiter(15 * 60 * 1000, 10)

type Row = Record<string, unknown>

function tokenDigest(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 32 || value.length > 200) return null
  return createHash('sha256').update(value).digest('hex')
}

function invitationIsUsable(invitation: Row): boolean {
  const expiry = new Date(String(invitation.expiresAt)).getTime()
  return !invitation.acceptedAt
    && !invitation.revokedAt
    && Number.isFinite(expiry)
    && expiry > Date.now()
    && !Boolean(invitation.isActive)
    && ['STUDENT', 'PARENT'].includes(String(invitation.role))
}

async function loadInvitation(tokenHash: string): Promise<Row | null> {
  const [rows] = await pool.execute(
    'SELECT i.id, i.user_id AS userId, i.linked_student_id AS linkedStudentId, i.relationship, i.expires_at AS expiresAt, i.accepted_at AS acceptedAt, i.revoked_at AS revokedAt, u.email, u.first_name AS firstName, u.last_name AS lastName, u.is_active AS isActive, r.name AS role FROM account_invitations i INNER JOIN users u ON u.id = i.user_id INNER JOIN roles r ON r.id = u.role_id WHERE i.token_hash = ? LIMIT 1',
    [tokenHash],
  )
  return (rows as Row[])[0] ?? null
}

function respondWithError(res: Response, error: unknown, action: string): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
    return
  }
  console.error(`Account invitation ${action} failed`, error)
  res.status(500).json({ success: false, message: 'Unable to process this invitation' })
}

async function withTransaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T> {
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
      console.error('Unable to roll back invitation transaction', rollbackError)
    }
    throw error
  } finally {
    connection.release()
  }
}

router.post('/validate', tokenRateLimit, async (req, res) => {
  const digest = tokenDigest(req.body?.token)
  if (!digest) {
    res.status(400).json({ success: false, message: 'A valid invitation token is required' })
    return
  }

  try {
    const invitation = await loadInvitation(digest)
    if (!invitation || !invitationIsUsable(invitation)) {
      res.status(410).json({ success: false, message: 'This invitation is invalid, expired, revoked, or already used. Contact the school administration for a new link.' })
      return
    }
    res.json({
      success: true,
      invitation: {
        email: invitation.email,
        firstName: invitation.firstName,
        lastName: invitation.lastName,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
    })
  } catch (error) {
    respondWithError(res, error, 'validation')
  }
})

router.post('/accept', tokenRateLimit, async (req, res) => {
  const digest = tokenDigest(req.body?.token)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!digest) {
    res.status(400).json({ success: false, message: 'A valid invitation token is required' })
    return
  }
  if (password.length < 12 || password.length > 128) {
    res.status(400).json({ success: false, message: 'Choose a password between 12 and 128 characters' })
    return
  }

  try {
    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT i.id, i.user_id AS userId, i.linked_student_id AS linkedStudentId, i.relationship, i.expires_at AS expiresAt, i.accepted_at AS acceptedAt, i.revoked_at AS revokedAt, u.email, u.first_name AS firstName, u.last_name AS lastName, u.is_active AS isActive, r.name AS role FROM account_invitations i INNER JOIN users u ON u.id = i.user_id INNER JOIN roles r ON r.id = u.role_id WHERE i.token_hash = ? LIMIT 1 FOR UPDATE',
        [digest],
      )
      const invitation = (rows as Row[])[0]
      if (!invitation || !invitationIsUsable(invitation)) {
        return { ok: false as const, status: 410, message: 'This invitation is invalid, expired, revoked, or already used. Contact the school administration for a new link.' }
      }

      const passwordHash = await bcrypt.hash(password, 12)
      await connection.execute(
        'UPDATE users SET password_hash = ?, is_active = TRUE WHERE id = ? AND is_active = FALSE',
        [passwordHash, Number(invitation.userId)],
      )

      if (invitation.role === 'PARENT' && invitation.linkedStudentId !== null) {
        await connection.execute(
          'INSERT INTO student_parents (student_id, parent_id, relationship, is_primary) SELECT ?, p.id, ?, FALSE FROM parents p WHERE p.user_id = ? ON CONFLICT (student_id, parent_id) DO UPDATE SET relationship = EXCLUDED.relationship',
          [Number(invitation.linkedStudentId), String(invitation.relationship), Number(invitation.userId)],
        )
      }

      await connection.execute(
        'UPDATE account_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL',
        [Number(invitation.id)],
      )
      await connection.execute(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          Number(invitation.userId),
          'ACCOUNT_INVITATION_ACCEPTED',
          'account_invitation',
          Number(invitation.id),
          JSON.stringify({ role: String(invitation.role) }),
          req.ip ?? null,
          req.get('user-agent')?.slice(0, 500) ?? null,
        ],
      )
      return {
        ok: true as const,
        role: String(invitation.role),
        email: String(invitation.email),
      }
    })

    if (!result.ok) {
      res.status(result.status).json({ success: false, message: result.message })
      return
    }
    res.json({
      success: true,
      role: result.role,
      email: result.email,
      message: 'Your school account is now active. Sign in to the student and parent portal.',
    })
  } catch (error) {
    respondWithError(res, error, 'acceptance')
  }
})

export default router
