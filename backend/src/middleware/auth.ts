import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

import type { AuthUser, JwtPayload, UserRole } from '../types/auth.js'

export interface AuthenticatedRequest extends Request {
  user?: AuthUser
}

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

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authorization = req.headers.authorization
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : null

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' })
    return
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload
    req.user = {
      id: payload.userId,
      firstName: '',
      lastName: '',
      email: null,
      phone: null,
      role: payload.role,
    }
    next()
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token',
    })
  }
}

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
