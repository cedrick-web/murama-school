import { Router } from 'express'

import { getUserById, login } from '../services/auth.service.js'
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
  } catch {
    res.status(500).json({
      success: false,
      message: 'Unable to complete login',
    })
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
  } catch {
    res.status(500).json({
      success: false,
      message: 'Unable to load the current user',
    })
  }
})

export default router
