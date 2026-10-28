import { Router } from 'express'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { notifyRole } from '../services/school-users.js'

const router = Router()

function unavailable(error: unknown): boolean {
  return isDatabaseUnavailable(error)
}

router.get('/school', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT setting_key AS settingKey, setting_value AS settingValue FROM school_settings WHERE setting_key IN (?)',
      [['school_name', 'contact_email', 'contact_phone', 'address', 'timezone', 'currency', 'default_language']],
    )
    const settings: Record<string, string> = {
      schoolName: 'Ecole Secondaire de Murama',
      contactEmail: '',
      contactPhone: '',
      address: '',
      timezone: 'Africa/Kigali',
      currency: 'RWF',
      defaultLanguage: 'en',
    }
    const keys: Record<string, string> = {
      school_name: 'schoolName',
      contact_email: 'contactEmail',
      contact_phone: 'contactPhone',
      address: 'address',
      timezone: 'timezone',
      currency: 'currency',
      default_language: 'defaultLanguage',
    }
    for (const row of rows as Record<string, unknown>[]) {
      if (typeof row.settingKey === 'string' && Object.hasOwn(keys, row.settingKey)) {
        settings[keys[row.settingKey]] = String(row.settingValue ?? '')
      }
    }
    res.json({ success: true, school: settings })
  } catch (error) {
    console.error('Unable to load public school details', error)
    res.status(unavailable(error) ? 503 : 500).json({
      success: false,
      message: unavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load school details',
    })
  }
})

router.get('/announcements', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, message, published_at AS publishedAt FROM announcements WHERE is_published = TRUE AND audience = ? AND published_at IS NOT NULL AND published_at <= CURRENT_TIMESTAMP ORDER BY published_at DESC LIMIT 12',
      ['all'],
    )
    res.json({ success: true, announcements: rows })
  } catch (error) {
    console.error('Unable to load public announcements', error)
    res.status(unavailable(error) ? 503 : 500).json({
      success: false,
      message: unavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load announcements',
    })
  }
})

router.get('/news', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, slug, summary, body, cover_image_url AS coverImageUrl, published_at AS publishedAt FROM news WHERE is_published = TRUE AND published_at IS NOT NULL AND published_at <= CURRENT_TIMESTAMP ORDER BY published_at DESC LIMIT 12',
    )
    res.json({ success: true, news: rows })
  } catch (error) {
    console.error('Unable to load public news', error)
    res.status(unavailable(error) ? 503 : 500).json({
      success: false,
      message: unavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load news',
    })
  }
})

router.get('/events', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, description, starts_at AS startsAt, ends_at AS endsAt, location FROM events WHERE is_published = TRUE ORDER BY starts_at ASC LIMIT 16',
    )
    res.json({ success: true, events: rows })
  } catch (error) {
    console.error('Unable to load public events', error)
    res.status(unavailable(error) ? 503 : 500).json({
      success: false,
      message: unavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load events',
    })
  }
})

router.get('/gallery', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, title, media_type AS mediaType, media_url AS mediaUrl, thumbnail_url AS thumbnailUrl, description, published_at AS publishedAt FROM gallery_items WHERE is_published = TRUE AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 24',
    )
    res.json({ success: true, items: rows })
  } catch (error) {
    console.error('Unable to load public gallery', error)
    res.status(unavailable(error) ? 503 : 500).json({
      success: false,
      message: unavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to load gallery',
    })
  }
})

router.post('/inquiries', createRateLimiter(15 * 60 * 1000, 8), async (req, res) => {
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : ''
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : ''
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  if (!fullName || fullName.length > 150 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || subject.length > 200 || !message || message.length > 8000) {
    res.status(400).json({ success: false, message: 'Provide your name, a valid email, a subject and a message' })
    return
  }
  if (phone && phone.length > 30) {
    res.status(400).json({ success: false, message: 'Phone number is too long' })
    return
  }
  try {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [result] = await connection.execute(
        'INSERT INTO school_inquiries (full_name, email, phone, subject, message, status) VALUES (?, ?, ?, ?, ?, ?)',
        [fullName, email, phone || null, subject, message, 'NEW'],
      )
      const inquiryId = Number((result as { insertId: number }).insertId)
      await notifyRole(
        connection,
        'ADMIN',
        'New school inquiry',
        `${fullName} submitted “${subject}”. Open inquiries in the workspace to respond.`,
        'inquiry',
      )
      await connection.execute(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [null, 'PUBLIC_INQUIRY_RECEIVED', 'school_inquiry', inquiryId, JSON.stringify({ email, subject }), req.ip ?? null, req.get('user-agent')?.slice(0, 500) ?? null],
      )
      await connection.commit()
      res.status(201).json({ success: true, message: 'Your message was received by the school administration.' })
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  } catch (error) {
    console.error('Unable to save public inquiry', error)
    res.status(unavailable(error) ? 503 : 500).json({
      success: false,
      message: unavailable(error) ? 'The school database is not configured or is temporarily unavailable.' : 'Unable to send your message right now',
    })
  }
})

export default router
