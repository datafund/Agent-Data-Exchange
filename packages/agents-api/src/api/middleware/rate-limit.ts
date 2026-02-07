/**
 * Rate limiting middleware.
 *
 * Limits requests per address or IP to prevent spam and abuse.
 */

import type { Request, Response, NextFunction } from 'express'

interface RateLimitConfig {
  windowMs: number      // Time window in ms
  maxRequests: number   // Max requests per window
}

// Store: key -> { count, resetAt }
const requestCounts = new Map<string, { count: number; resetAt: number }>()

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of requestCounts) {
    if (value.resetAt < now) {
      requestCounts.delete(key)
    }
  }
}, 60_000)

/**
 * Create a rate limiter middleware.
 */
export function createRateLimit(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Use verified address if available (from verifySignature), else IP
    const key = (req as any).verifiedAddress || req.ip || 'unknown'
    const now = Date.now()

    let record = requestCounts.get(key)

    if (!record || record.resetAt < now) {
      // New window
      record = { count: 1, resetAt: now + config.windowMs }
      requestCounts.set(key, record)
    } else {
      record.count++
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - record.count))
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000))

    if (record.count > config.maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      })
      return
    }

    next()
  }
}

// Pre-configured rate limiters
export const defaultRateLimit = createRateLimit({
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 60,      // 60 requests per minute
})

export const strictRateLimit = createRateLimit({
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 20,      // 20 requests per minute (for mutations)
})
