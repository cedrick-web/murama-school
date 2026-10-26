import { Router } from 'express'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import { createRateLimiter } from '../middleware/rate-limit.js'

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

function validVisitDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false
  const parsed = new Date(value + 'T00:00:00.000Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false
  const todayInRwanda = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date())
  return value >= todayInRwanda
}

router.post('/visits', visitRequestRateLimit, async (req, res) => {
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : ''
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const visitorType = typeof req.body?.visitorType === 'string' ? req.body.visitorType.trim().toUpperCase() : 'OTHER'
  const preferredDate = req.body?.preferredDate
  const preferredTime = req.body?.preferredTime === '' || req.body?.preferredTime === null || req.body?.preferredTime === undefined
    ? null
    : req.body.preferredTime
  const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim() : ''

  if (
    fullName.length < 2 || fullName.length > 120
    || (!email && !phone)
    || (email && (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)))
    || (phone && (phone.length > 40 || phone.replace(/\\D/g, '').length < 7))
    || !['PARENT', 'STUDENT', 'PROSPECTIVE_PARENT', 'OTHER'].includes(visitorType)
    || !validVisitDate(preferredDate)
    || (preferredTime !== null && (typeof preferredTime !== 'string' || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(preferredTime)))
    || purpose.length < 10 || purpose.length > 3000
  ) {
    res.status(400).json({
      success: false,
      message: 'Provide a name, valid email or phone, visitor type, today-or-future visit date, optional valid time, and a purpose between 10 and 3000 characters.',
    })
    return
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO school_visit_requests (full_name, email, phone, visitor_type, preferred_date, preferred_time, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fullName, email || null, phone || null, visitorType, preferredDate, preferredTime, purpose],
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
