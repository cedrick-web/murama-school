import { Router } from 'express'

import { getUserById, login, loginWithVerifiedEmail } from '../services/auth.service.js'
import { isDatabaseUnavailable } from '../config/database.js'
import { SupabaseAuthConfigurationError, verifyGoogleAccessToken } from '../services/supabase-auth.service.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import {
  requireAuth,
  signAccessToken,
  type AuthenticatedRequest,
} from '../middleware/auth.js'

const router = Router()

router.post('/login', async (req, res) => {
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
    res.status(unavailable ? 503 : 500).json({
      success: false,
      message: unavailable ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to complete login',
    })
  }
})

router.post('/google', createRateLimiter(15 * 60 * 1000, 10), async (req, res) => {
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

router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await getUserById(req.user!.id)

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User account is no longer active',
      })
      return
    }

    res.json({ success: true, user })
  } catch (error) {
    const unavailable = isDatabaseUnavailable(error)
    res.status(unavailable ? 503 : 500).json({
      success: false,
      message: unavailable ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load the current user',
    })
  }
})

export default router
