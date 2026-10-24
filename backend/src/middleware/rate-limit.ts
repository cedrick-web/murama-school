import type { RequestHandler } from 'express'

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
      buckets.set(key, entry)
    }

    // Opportunistically remove expired entries to keep memory bounded.
    if (buckets.size > 5000) {
      for (const [address, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(address)
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
        message: 'Too many Google sign-in attempts. Please wait before trying again.',
      })
      return
    }

    entry.count += 1
    res.setHeader('RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)))
    next()
  }
}
