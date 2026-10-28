import { Router } from 'express'
import type { Response } from 'express'
import type { PoolConnection } from '../config/database.js'

import { isDatabaseUnavailable, pool } from '../config/database.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()
const inquiryStatuses = ['NEW', 'IN_PROGRESS', 'CLOSED'] as const

async function withTransaction<T>(action: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await action(connection)
    await connection.commit()
    return result
  } catch (error) {
    try { await connection.rollback() } catch (rollbackError) {
      console.error('Unable to roll back content transaction', rollbackError)
    }
    throw error
  } finally {
    connection.release()
  }
}

async function audit(
  connection: PoolConnection,
  req: AuthenticatedRequest,
  action: string,
  entityType: string,
  entityId: number | null,
  details: object,
): Promise<void> {
  await connection.execute(
    'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user!.id, action, entityType, entityId, JSON.stringify(details), req.ip ?? null, req.get('user-agent')?.slice(0, 500) ?? null],
  )
}

function fail(res: Response, action: string, error: unknown): void {
  if (isDatabaseUnavailable(error)) {
    res.status(503).json({ success: false, message: 'The school database is not configured or is temporarily unavailable.' })
    return
  }
  const code = (error as { code?: string } | null)?.code
  if (code === 'ER_DUP_ENTRY' || code === '23505') {
    res.status(409).json({ success: false, message: 'A record with those details already exists' })
    return
  }
  console.error(`Content ${action} failed`, error)
  res.status(500).json({ success: false, message: `Unable to ${action}` })
}

function parseId(value: unknown): number | null {
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function parseText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 && text.length <= max ? text : null
}

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200)
  return slug || 'article'
}

function parseDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

router.get('/news', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT n.id, n.title, n.slug, n.summary, n.body, n.cover_image_url AS coverImageUrl, n.is_published AS isPublished, n.published_at AS publishedAt, n.created_at AS createdAt, CONCAT_WS(" ", u.first_name, u.last_name) AS author FROM news n LEFT JOIN users u ON u.id = n.author_user_id ORDER BY n.created_at DESC',
    )
    res.json({ success: true, news: rows })
  } catch (error) {
    fail(res, 'load news', error)
  }
})

router.post('/news', async (req: AuthenticatedRequest, res) => {
  const title = parseText(req.body?.title, 200)
  const summary = parseText(req.body?.summary ?? '', 2000)
  const body = parseText(req.body?.body, 50000)
  const coverImageUrl = parseText(req.body?.coverImageUrl ?? '', 1000)
  const isPublished = req.body?.isPublished === true
  if (!title || !body) {
    res.status(400).json({ success: false, message: 'Provide a title and article body' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const slug = `${slugify(title)}-${Date.now().toString(36)}`
      const [result] = await connection.execute(
        'INSERT INTO news (title, slug, summary, body, cover_image_url, is_published, published_at, author_user_id) VALUES (?, ?, ?, ?, ?, ?, IF(?, CURRENT_TIMESTAMP, NULL), ?)',
        [title, slug, summary, body, coverImageUrl, isPublished, isPublished, req.user!.id],
      )
      const newsId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'NEWS_CREATED', 'news', newsId, { title, isPublished })
      return newsId
    })
    res.status(201).json({ success: true, id, message: 'News article saved' })
  } catch (error) {
    fail(res, 'create news', error)
  }
})

router.patch('/news/:newsId', async (req: AuthenticatedRequest, res) => {
  const newsId = parseId(req.params.newsId)
  const title = parseText(req.body?.title, 200)
  const summary = parseText(req.body?.summary ?? '', 2000)
  const body = parseText(req.body?.body, 50000)
  const coverImageUrl = parseText(req.body?.coverImageUrl ?? '', 1000)
  const isPublished = req.body?.isPublished === true
  if (!newsId || !title || !body) {
    res.status(400).json({ success: false, message: 'A valid article ID, title and body are required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM news WHERE id = ? FOR UPDATE', [newsId])
      if (!(existing as unknown[]).length) return false
      await connection.execute(
        'UPDATE news SET title = ?, summary = ?, body = ?, cover_image_url = ?, is_published = ?, published_at = IF(?, COALESCE(published_at, CURRENT_TIMESTAMP), NULL) WHERE id = ?',
        [title, summary, body, coverImageUrl, isPublished, isPublished, newsId],
      )
      await audit(connection, req, 'NEWS_UPDATED', 'news', newsId, { title, isPublished })
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'News article not found' })
      return
    }
    res.json({ success: true, message: 'News article updated' })
  } catch (error) {
    fail(res, 'update news', error)
  }
})

router.delete('/news/:newsId', async (req: AuthenticatedRequest, res) => {
  const newsId = parseId(req.params.newsId)
  if (!newsId) {
    res.status(400).json({ success: false, message: 'A valid article ID is required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id, title FROM news WHERE id = ? FOR UPDATE', [newsId])
      const article = (existing as Record<string, unknown>[])[0]
      if (!article) return false
      await audit(connection, req, 'NEWS_DELETED', 'news', newsId, { title: article.title })
      await connection.execute('DELETE FROM news WHERE id = ?', [newsId])
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'News article not found' })
      return
    }
    res.json({ success: true, message: 'News article deleted' })
  } catch (error) {
    fail(res, 'delete news', error)
  }
})

router.get('/events', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT e.id, e.title, e.description, e.starts_at AS startsAt, e.ends_at AS endsAt, e.location, e.is_published AS isPublished, e.created_at AS createdAt, CONCAT_WS(" ", u.first_name, u.last_name) AS createdBy FROM events e LEFT JOIN users u ON u.id = e.created_by ORDER BY e.starts_at DESC',
    )
    res.json({ success: true, events: rows })
  } catch (error) {
    fail(res, 'load events', error)
  }
})

router.post('/events', async (req: AuthenticatedRequest, res) => {
  const title = parseText(req.body?.title, 200)
  const description = parseText(req.body?.description ?? '', 10000)
  const startsAt = parseDateTime(req.body?.startsAt)
  const endsAt = req.body?.endsAt ? parseDateTime(req.body.endsAt) : null
  const location = parseText(req.body?.location ?? '', 255)
  const isPublished = req.body?.isPublished === true
  if (!title || !startsAt) {
    res.status(400).json({ success: false, message: 'Provide an event title and start time' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO events (title, description, starts_at, ends_at, location, is_published, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [title, description, startsAt, endsAt, location, isPublished, req.user!.id],
      )
      const eventId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'EVENT_CREATED', 'event', eventId, { title, isPublished })
      return eventId
    })
    res.status(201).json({ success: true, id, message: 'School event saved' })
  } catch (error) {
    fail(res, 'create event', error)
  }
})

router.patch('/events/:eventId', async (req: AuthenticatedRequest, res) => {
  const eventId = parseId(req.params.eventId)
  const title = parseText(req.body?.title, 200)
  const description = parseText(req.body?.description ?? '', 10000)
  const startsAt = parseDateTime(req.body?.startsAt)
  const endsAt = req.body?.endsAt ? parseDateTime(req.body.endsAt) : null
  const location = parseText(req.body?.location ?? '', 255)
  const isPublished = req.body?.isPublished === true
  if (!eventId || !title || !startsAt) {
    res.status(400).json({ success: false, message: 'A valid event ID, title and start time are required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM events WHERE id = ? FOR UPDATE', [eventId])
      if (!(existing as unknown[]).length) return false
      await connection.execute(
        'UPDATE events SET title = ?, description = ?, starts_at = ?, ends_at = ?, location = ?, is_published = ? WHERE id = ?',
        [title, description, startsAt, endsAt, location, isPublished, eventId],
      )
      await audit(connection, req, 'EVENT_UPDATED', 'event', eventId, { title, isPublished })
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'Event not found' })
      return
    }
    res.json({ success: true, message: 'Event updated' })
  } catch (error) {
    fail(res, 'update event', error)
  }
})

router.delete('/events/:eventId', async (req: AuthenticatedRequest, res) => {
  const eventId = parseId(req.params.eventId)
  if (!eventId) {
    res.status(400).json({ success: false, message: 'A valid event ID is required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id, title FROM events WHERE id = ? FOR UPDATE', [eventId])
      const event = (existing as Record<string, unknown>[])[0]
      if (!event) return false
      await audit(connection, req, 'EVENT_DELETED', 'event', eventId, { title: event.title })
      await connection.execute('DELETE FROM events WHERE id = ?', [eventId])
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'Event not found' })
      return
    }
    res.json({ success: true, message: 'Event deleted' })
  } catch (error) {
    fail(res, 'delete event', error)
  }
})

router.get('/gallery', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT g.id, g.title, g.media_type AS mediaType, g.media_url AS mediaUrl, g.thumbnail_url AS thumbnailUrl, g.description, g.is_published AS isPublished, g.published_at AS publishedAt, g.created_at AS createdAt FROM gallery_items g ORDER BY g.created_at DESC',
    )
    res.json({ success: true, items: rows })
  } catch (error) {
    fail(res, 'load gallery', error)
  }
})

router.post('/gallery', async (req: AuthenticatedRequest, res) => {
  const title = parseText(req.body?.title ?? '', 200)
  const mediaType = req.body?.mediaType === 'video' ? 'video' : req.body?.mediaType === 'image' ? 'image' : null
  const mediaUrl = parseText(req.body?.mediaUrl, 1000)
  const thumbnailUrl = parseText(req.body?.thumbnailUrl ?? '', 1000)
  const description = parseText(req.body?.description ?? '', 2000)
  const isPublished = req.body?.isPublished === true
  if (!mediaType || !mediaUrl || !/^https:\/\//i.test(mediaUrl)) {
    res.status(400).json({ success: false, message: 'Provide an HTTPS media URL and a media type of image or video' })
    return
  }
  try {
    const id = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'INSERT INTO gallery_items (title, media_type, media_url, thumbnail_url, description, is_published, published_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, IF(?, CURRENT_TIMESTAMP, NULL), ?)',
        [title, mediaType, mediaUrl, thumbnailUrl, description, isPublished, isPublished, req.user!.id],
      )
      const itemId = Number((result as { insertId: number }).insertId)
      await audit(connection, req, 'GALLERY_ITEM_CREATED', 'gallery_item', itemId, { mediaType, isPublished })
      return itemId
    })
    res.status(201).json({ success: true, id, message: 'Gallery item saved' })
  } catch (error) {
    fail(res, 'create gallery item', error)
  }
})

router.patch('/gallery/:itemId', async (req: AuthenticatedRequest, res) => {
  const itemId = parseId(req.params.itemId)
  const title = parseText(req.body?.title ?? '', 200)
  const mediaType = req.body?.mediaType === 'video' ? 'video' : req.body?.mediaType === 'image' ? 'image' : null
  const mediaUrl = parseText(req.body?.mediaUrl, 1000)
  const thumbnailUrl = parseText(req.body?.thumbnailUrl ?? '', 1000)
  const description = parseText(req.body?.description ?? '', 2000)
  const isPublished = req.body?.isPublished === true
  if (!itemId || !mediaType || !mediaUrl || !/^https:\/\//i.test(mediaUrl)) {
    res.status(400).json({ success: false, message: 'A valid gallery item, HTTPS media URL and media type are required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM gallery_items WHERE id = ? FOR UPDATE', [itemId])
      if (!(existing as unknown[]).length) return false
      await connection.execute(
        'UPDATE gallery_items SET title = ?, media_type = ?, media_url = ?, thumbnail_url = ?, description = ?, is_published = ?, published_at = IF(?, COALESCE(published_at, CURRENT_TIMESTAMP), NULL) WHERE id = ?',
        [title, mediaType, mediaUrl, thumbnailUrl, description, isPublished, isPublished, itemId],
      )
      await audit(connection, req, 'GALLERY_ITEM_UPDATED', 'gallery_item', itemId, { mediaType, isPublished })
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'Gallery item not found' })
      return
    }
    res.json({ success: true, message: 'Gallery item updated' })
  } catch (error) {
    fail(res, 'update gallery item', error)
  }
})

router.delete('/gallery/:itemId', async (req: AuthenticatedRequest, res) => {
  const itemId = parseId(req.params.itemId)
  if (!itemId) {
    res.status(400).json({ success: false, message: 'A valid gallery item ID is required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM gallery_items WHERE id = ? FOR UPDATE', [itemId])
      if (!(existing as unknown[]).length) return false
      await audit(connection, req, 'GALLERY_ITEM_DELETED', 'gallery_item', itemId, {})
      await connection.execute('DELETE FROM gallery_items WHERE id = ?', [itemId])
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'Gallery item not found' })
      return
    }
    res.json({ success: true, message: 'Gallery item deleted' })
  } catch (error) {
    fail(res, 'delete gallery item', error)
  }
})

router.get('/inquiries', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT i.id, i.full_name AS fullName, i.email, i.phone, i.subject, i.message, i.status, i.created_at AS createdAt, CONCAT_WS(" ", u.first_name, u.last_name) AS handledBy FROM school_inquiries i LEFT JOIN users u ON u.id = i.handled_by ORDER BY i.created_at DESC',
    )
    res.json({ success: true, inquiries: rows })
  } catch (error) {
    fail(res, 'load inquiries', error)
  }
})

router.patch('/inquiries/:inquiryId', async (req: AuthenticatedRequest, res) => {
  const inquiryId = parseId(req.params.inquiryId)
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toUpperCase() : ''
  if (!inquiryId || !inquiryStatuses.includes(status as typeof inquiryStatuses[number])) {
    res.status(400).json({ success: false, message: 'A valid inquiry ID and status are required' })
    return
  }
  try {
    const found = await withTransaction(async (connection) => {
      const [existing] = await connection.execute('SELECT id FROM school_inquiries WHERE id = ? FOR UPDATE', [inquiryId])
      if (!(existing as unknown[]).length) return false
      await connection.execute(
        'UPDATE school_inquiries SET status = ?, handled_by = ? WHERE id = ?',
        [status, req.user!.id, inquiryId],
      )
      await audit(connection, req, 'INQUIRY_UPDATED', 'school_inquiry', inquiryId, { status })
      return true
    })
    if (!found) {
      res.status(404).json({ success: false, message: 'Inquiry not found' })
      return
    }
    res.json({ success: true, message: 'Inquiry status updated' })
  } catch (error) {
    fail(res, 'update inquiry', error)
  }
})

export default router
