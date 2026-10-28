import { Router } from 'express'

import { changePassword, login, loginWithVerifiedEmail } from '../services/auth.service.js'
import { parsePassword } from '../services/school-users.js'
import { isDatabaseUnavailable } from '../config/database.js'
import { SupabaseAuthConfigurationError, verifyGoogleAccessToken } from '../services/supabase-auth.service.js'
import { createDatabaseRateLimiter } from '../middleware/rate-limit.js'
import {
  requireAuth,
  signAccessToken,
  type AuthenticatedRequest,
} from '../middleware/auth.js'

const router = Router()

router.post('/login', createDatabaseRateLimiter(15 * 60 * 1000, 10, 'password-login'), async (req, res) => {
  const email = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : ''
  const password = typeof req.body?.password === 'string'
    ? req.body.password
    : ''

  if (!email || !password) {
    res.status(400).json({
      success: false,
      message: 'Email and password are required',
    })
    return
  }

  try {
    const result = await login(email, password)

    if (!result) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      })
      return
    }

    res.json({
      success: true,
      token: signAccessToken(result.user),
      user: result.user,
    })
  } catch (error) {
    const unavailable = isDatabaseUnavailable(error)
    if ((error as { code?: string } | null)?.code === 'JWT_NOT_CONFIGURED') {
      console.error('Password sign-in is unavailable because JWT_SECRET is not configured')
      res.status(503).json({ success: false, message: 'Authentication is not configured on the server yet.' })
      return
    }
    res.status(unavailable ? 503 : 500).json({
      success: false,
      message: unavailable ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to complete login',
    })
  }
})

router.post('/google', createDatabaseRateLimiter(15 * 60 * 1000, 10, 'google-sign-in'), async (req, res) => {
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : ''
  if (accessToken.length < 20 || accessToken.length > 8192) {
    res.status(400).json({ success: false, message: 'A valid Supabase access token is required' })
    return
  }

  try {
    const identity = await verifyGoogleAccessToken(accessToken)
    if (!identity) {
      res.status(401).json({ success: false, message: 'The Google identity could not be verified' })
      return
    }

    const result = await loginWithVerifiedEmail(identity.email)
    if (!result) {
      res.status(403).json({
        success: false,
        message: 'This Google email is not linked to an active Murama School account. Contact the school administrator.',
      })
      return
    }

    res.json({
      success: true,
      token: signAccessToken(result.user),
      user: result.user,
      profile: {
        id: identity.id,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
      },
    })
  } catch (error) {
    if (error instanceof SupabaseAuthConfigurationError) {
      res.status(503).json({ success: false, message: 'Google sign-in is not configured on the server yet' })
      return
    }
    if (isDatabaseUnavailable(error)) {
      res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
      return
    }
    console.error('Google sign-in verification failed', error)
    res.status(502).json({ success: false, message: 'Unable to verify Google sign-in with Supabase' })
  }
})

router.post('/password', requireAuth, async (req: AuthenticatedRequest, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
  const nextPassword = parsePassword(req.body?.newPassword)
  if (!currentPassword || !nextPassword) {
    res.status(400).json({
      success: false,
      message: 'Provide your current password and a new password of at least 10 characters',
    })
    return
  }

  try {
    const result = await changePassword(req.user!.id, currentPassword, nextPassword)
    if (result === 'missing') {
      res.status(401).json({ success: false, message: 'User account is no longer active' })
      return
    }
    if (result === 'invalid') {
      res.status(401).json({ success: false, message: 'Current password is incorrect' })
      return
    }
    res.json({ success: true, message: 'Password updated' })
  } catch (error) {
    const unavailable = isDatabaseUnavailable(error)
    res.status(unavailable ? 503 : 500).json({
      success: false,
      message: unavailable ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to update password',
    })
  }
})

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ success: true, user: req.user })
})

export default router
