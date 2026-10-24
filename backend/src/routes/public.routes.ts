import { Router } from 'express'

import { pool } from '../config/database.js'

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
    res.status(500).json({
      success: false,
      message: 'Unable to load school details',
    })
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
    res.status(500).json({
      success: false,
      message: 'Unable to load announcements',
    })
  }
})

export default router
