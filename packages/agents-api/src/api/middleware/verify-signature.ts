/**
 * EIP-191 signature verification middleware.
 *
 * Write endpoints require:
 *   X-Address: 0x... (signer address)
 *   X-Signature: 0x... (EIP-191 signature of the request body JSON)
 *   X-Timestamp: unix seconds (must be within 60 seconds)
 *   X-Nonce: unique request identifier (prevents replay within window)
 *
 * The signed message is: `${timestamp}:${nonce}:${JSON.stringify(body)}`
 * This prevents replay attacks and ensures the sender owns the address.
 */

import type { Request, Response, NextFunction } from 'express'
import { verifyMessage } from 'viem'

const MAX_AGE_SECONDS = 60 // Reduced from 300 to 60 seconds for security

// Nonce tracking to prevent replay within the window
const usedNonces = new Map<string, number>() // nonce -> timestamp

// Clean expired nonces every minute
setInterval(() => {
  const cutoff = Date.now() - (MAX_AGE_SECONDS * 1000)
  for (const [nonce, ts] of usedNonces) {
    if (ts < cutoff) {
      usedNonces.delete(nonce)
    }
  }
}, 60_000)

export async function verifySignature(req: Request, res: Response, next: NextFunction) {
  const address = req.headers['x-address'] as string | undefined
  const signature = req.headers['x-signature'] as string | undefined
  const timestamp = req.headers['x-timestamp'] as string | undefined
  const nonce = req.headers['x-nonce'] as string | undefined

  if (!address || !signature || !timestamp) {
    res.status(401).json({
      error: 'Missing auth headers. Required: X-Address, X-Signature, X-Timestamp, X-Nonce',
    })
    return
  }

  // Validate address format
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: 'Invalid X-Address format' })
    return
  }

  // Check timestamp freshness
  const ts = parseInt(timestamp, 10)
  const now = Math.floor(Date.now() / 1000)
  if (isNaN(ts) || Math.abs(now - ts) > MAX_AGE_SECONDS) {
    res.status(401).json({ error: 'X-Timestamp expired or invalid (must be within 60 seconds)' })
    return
  }

  // Check nonce hasn't been used (prevent replay within window)
  if (nonce) {
    if (usedNonces.has(nonce)) {
      res.status(401).json({ error: 'Nonce already used. Generate a new nonce for each request.' })
      return
    }
  }

  // Reconstruct signed message (include nonce if provided)
  const body = JSON.stringify(req.body ?? {})
  const message = nonce ? `${timestamp}:${nonce}:${body}` : `${timestamp}:${body}`

  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })

    if (!valid) {
      res.status(401).json({ error: 'Signature verification failed' })
      return
    }
  } catch {
    res.status(401).json({ error: 'Invalid signature format' })
    return
  }

  // Mark nonce as used (only after successful verification)
  if (nonce) {
    usedNonces.set(nonce, Date.now())
  }

  // Attach verified address to request for downstream use
  ;(req as any).verifiedAddress = address.toLowerCase()
  next()
}
