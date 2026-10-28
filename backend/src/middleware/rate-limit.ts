import { createHash } from 'node:crypto'
import type { RequestHandler } from 'express'
import { pool } from '../config/database.js'

interface RateLimitEntry {
  count: number
  resetAt: number
}

/**
 * Small process-local limiter for public authentication endpoints.
 * Use a shared store (for example Redis) when running multiple API instances.
 */
export function createRateLimiter(windowMs: number, maxRequests: number): RequestHandler {
  const buckets = new Map<string, RateLimitEntry>()

  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip || req.socket.remoteAddress || 'unknown'
    let entry = buckets.get(key)

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
    }
    // Move this client to the newest position before bounded-map eviction.
    buckets.delete(key)
    buckets.set(key, entry)

    // Opportunistically remove expired entries, then hard-cap memory usage.
    if (buckets.size > 5000) {
      for (const [address, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(address)
      }
      while (buckets.size > 5000) {
        const oldest = buckets.keys().next().value
        if (oldest === undefined) break
        buckets.delete(oldest)
      }
    }

    const remaining = Math.max(0, maxRequests - entry.count)
    res.setHeader('RateLimit-Limit', String(maxRequests))
    res.setHeader('RateLimit-Remaining', String(remaining))
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      res.status(429).json({
        success: false,
        message: 'Too many attempts. Please wait before trying again.',
      })
      return
    }

    entry.count += 1
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)))
    next()
  }
}

export interface RateLimitCounter {
  count: number
  resetAt: number
}
export type RateLimitIncrement = (bucketKey: string, windowMs: number) => Promise<RateLimitCounter>

let sharedCleanupCounter = 0

async function incrementSharedBucket(bucketKey: string, windowMs: number): Promise<RateLimitCounter> {
  const resetAt = new Date(Date.now() + windowMs).toISOString()
  await pool.execute(
    'INSERT INTO rate_limit_buckets (bucket_key, request_count, reset_at) VALUES (?, ?, ?) ON CONFLICT (bucket_key) DO UPDATE SET request_count = CASE WHEN rate_limit_buckets.reset_at <= CURRENT_TIMESTAMP THEN 1 ELSE rate_limit_buckets.request_count + 1 END, reset_at = CASE WHEN rate_limit_buckets.reset_at <= CURRENT_TIMESTAMP THEN EXCLUDED.reset_at ELSE rate_limit_buckets.reset_at END, updated_at = CURRENT_TIMESTAMP',
    [bucketKey, 1, resetAt],
  )
  const [rows] = await pool.execute(
    'SELECT request_count AS requestCount, reset_at AS resetAt FROM rate_limit_buckets WHERE bucket_key = ? LIMIT 1',
    [bucketKey],
  )
  const row = (rows as Array<Record<string, unknown>>)[0]
  if (!row) throw new Error('Rate limit bucket was not returned after increment')
  const parsedResetAt = new Date(String(row.resetAt)).getTime()
  if (!Number.isFinite(parsedResetAt)) throw new Error('Rate limit bucket has an invalid reset time')

  sharedCleanupCounter += 1
  if (sharedCleanupCounter % 500 === 0) {
    void pool.execute("DELETE FROM rate_limit_buckets WHERE reset_at < CURRENT_TIMESTAMP - INTERVAL '1 day'")
      .catch((error: unknown) => console.error('Unable to clean expired rate-limit buckets', error))
  }
  return { count: Number(row.requestCount), resetAt: parsedResetAt }
}

/**
 * Shared-store rate limiter for serverless deployments. Only a one-way hash of
 * the scope and client IP is persisted; the raw IP is never written to the DB.
 * Fails closed if the shared store cannot be reached.
 */
export function createDatabaseRateLimiter(
  windowMs: number,
  maxRequests: number,
  scope: string,
  increment: RateLimitIncrement = incrementSharedBucket,
): RequestHandler {
  return (req, res, next) => {
    const clientAddress = req.ip || req.socket.remoteAddress || 'unknown'
    const bucketKey = createHash('sha256').update(scope + ':' + clientAddress).digest('hex')

    void increment(bucketKey, windowMs).then(({ count, resetAt }) => {
      const remaining = Math.max(0, maxRequests - count)
      res.setHeader('RateLimit-Limit', String(maxRequests))
      res.setHeader('RateLimit-Remaining', String(remaining))
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)))

      if (count > maxRequests) {
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
        res.setHeader('Retry-After', String(retryAfter))
        res.status(429).json({
          success: false,
          message: 'Too many sign-in attempts. Please wait before trying again.',
        })
        return
      }
      next()
    }).catch((error: unknown) => {
      console.error('Shared rate-limit store unavailable', error)
      res.status(503).json({
        success: false,
        message: 'Authentication is temporarily unavailable. Please try again shortly.',
      })
    })
  }
}
