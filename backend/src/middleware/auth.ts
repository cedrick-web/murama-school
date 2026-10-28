import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

import { isDatabaseUnavailable } from '../config/database.js'
import { getUserById } from '../services/auth.service.js'
import type { AuthUser, JwtPayload, UserRole } from '../types/auth.js'

export interface AuthenticatedRequest extends Request {
  user?: AuthUser
}

type ActiveUserLookup = (id: number) => Promise<AuthUser | null>

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET

  if (!secret || secret.length < 32) {
    throw Object.assign(
      new Error('JWT_SECRET must be configured with at least 32 characters'),
      { code: 'JWT_NOT_CONFIGURED' },
    )
  }

  return secret
}

export function signAccessToken(user: AuthUser): string {
  const payload: JwtPayload = {
    userId: user.id,
    role: user.role,
  }

  return jwt.sign(payload, getJwtSecret(), { expiresIn: '8h' })
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'ADMIN'
    || value === 'HEADTEACHER'
    || value === 'TEACHER'
    || value === 'STUDENT'
    || value === 'PARENT'
    || value === 'STAFF'
}

/**
 * JWTs prove identity, but permissions and account status can become stale.
 * Validate the token shape, then resolve the current active user on every request.
 */
export function createRequireAuth(findActiveUser: ActiveUserLookup = getUserById) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const authorization = req.headers.authorization
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : null

    if (!token) {
      res.status(401).json({ success: false, message: 'Authentication required' })
      return
    }

    let secret: string
    try {
      secret = getJwtSecret()
    } catch {
      console.error('JWT authentication is unavailable because JWT_SECRET is not configured')
      res.status(503).json({ success: false, message: 'Authentication is temporarily unavailable.' })
      return
    }

    let payload: JwtPayload
    try {
      const verified = jwt.verify(token, secret)
      if (
        typeof verified !== 'object'
        || !Number.isSafeInteger(verified.userId)
        || verified.userId <= 0
        || !isUserRole(verified.role)
      ) {
        res.status(401).json({ success: false, message: 'Invalid or expired authentication token' })
        return
      }
      payload = { userId: verified.userId, role: verified.role }
    } catch {
      res.status(401).json({ success: false, message: 'Invalid or expired authentication token' })
      return
    }

    try {
      const user = await findActiveUser(payload.userId)
      if (!user) {
        res.status(401).json({ success: false, message: 'User account is no longer active' })
        return
      }

      // Use the current database role, never the role copied into an older JWT.
      req.user = user
      next()
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        res.status(503).json({
          success: false,
          message: 'The school database is not configured or is temporarily unavailable.',
        })
        return
      }

      console.error('Unable to validate authenticated user', error)
      res.status(500).json({ success: false, message: 'Unable to validate authentication' })
    }
  }
}

export const requireAuth = createRequireAuth()

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'You do not have permission to access this resource',
      })
      return
    }
    next()
  }
}
