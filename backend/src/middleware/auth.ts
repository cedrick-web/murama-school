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
    throw new Error('JWT_SECRET must be configured with at least 32 characters')
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

/**
 * Resolve the user from the database on each authenticated request.
 * JWTs prove identity, but their role and account status can become stale
 * after an administrator changes permissions or disables an account.
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

    let payload: JwtPayload
    try {
      payload = jwt.verify(token, getJwtSecret()) as JwtPayload
    } catch {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token',
      })
      return
    }

    if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token',
      })
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
