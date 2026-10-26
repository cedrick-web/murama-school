import { Router } from 'express'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { validateVisitRequest } from '../services/visit-request-policy.js'

const router = Router()

router.get('/school', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_key AS settingKey, setting_value AS settingValue FROM school_settings WHERE setting_key IN (?, ?, ?, ?)',
      ['school_name', 'contact_email', 'contact_phone', 'address'],
    )
    const settings: Record<string, string> = {
      schoolName: 'Ecole Secondaire de Murama',
      contactEmail: '',
      contactPhone: '',
      address: '',
    }
    const keys: Record<string, string> = {
      school_name: 'schoolName',
      contact_email: 'contactEmail',
      contact_phone: 'contactPhone',
      address: 'address',
    }

    for (const row of rows as Record<string, unknown>[]) {
      if (typeof row.settingKey === 'string' && Object.hasOwn(keys, row.settingKey)) {
        settings[keys[row.settingKey]] = String(row.settingValue ?? '')
      }
    }

    res.json({ success: true, school: settings })
  } catch (error) {
    console.error('Unable to load public school details', error)
    res.status(isDatabaseUnavailable(error) ? 503 : 500).json({ success: false, message: isDatabaseUnavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load school details' })
  }
})

router.get('/announcements', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, message, published_at AS publishedAt FROM announcements WHERE is_published = TRUE AND audience = ? AND published_at IS NOT NULL AND published_at <= CURRENT_TIMESTAMP ORDER BY published_at DESC LIMIT 6',
      ['all'],
    )
    res.json({ success: true, announcements: rows })
  } catch (error) {
    console.error('Unable to load public announcements', error)
    res.status(isDatabaseUnavailable(error) ? 503 : 500).json({ success: false, message: isDatabaseUnavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load announcements' })
  }
})


const visitRequestRateLimit = createRateLimiter(15 * 60 * 1000, 5)

router.post('/visits', visitRequestRateLimit, async (req, res) => {
  const visit = validateVisitRequest(req.body ?? {})
  if (!visit) {
    res.status(400).json({
      success: false,
      message: 'Provide a name, valid email or phone, visitor type, today-or-future visit date, optional valid time, and a purpose between 10 and 3000 characters.',
    })
    return
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO school_visit_requests (full_name, email, phone, visitor_type, preferred_date, preferred_time, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [visit.fullName, visit.email, visit.phone, visit.visitorType, visit.preferredDate, visit.preferredTime, visit.purpose],
    )
    const requestId = Number((result as { insertId: number }).insertId)
    res.status(201).json({
      success: true,
      requestId,
      message: 'Your school visit request has been received. The school will contact you using the details you provided.',
    })
  } catch (error) {
    console.error('Unable to create school visit request', error)
    res.status(isDatabaseUnavailable(error) ? 503 : 500).json({
      success: false,
      message: isDatabaseUnavailable(error)
        ? 'The school system is temporarily unavailable. Please try again later.'
        : 'Unable to submit your visit request right now.',
    })
  }
})

export default router
