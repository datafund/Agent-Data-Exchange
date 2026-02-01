/**
 * EIP-191 signature verification middleware.
 *
 * Write endpoints require:
 *   X-Address: 0x... (signer address)
 *   X-Signature: 0x... (EIP-191 signature of the request body JSON)
 *   X-Timestamp: unix seconds (must be within 5 minutes)
 *
 * The signed message is: `${timestamp}:${JSON.stringify(body)}`
 * This prevents replay attacks and ensures the sender owns the address.
 */

import type { Request, Response, NextFunction } from 'express'
import { verifyMessage } from 'viem'

const MAX_AGE_SECONDS = 300 // 5 minutes

export async function verifySignature(req: Request, res: Response, next: NextFunction) {
  const address = req.headers['x-address'] as string | undefined
  const signature = req.headers['x-signature'] as string | undefined
  const timestamp = req.headers['x-timestamp'] as string | undefined

  if (!address || !signature || !timestamp) {
    res.status(401).json({
      error: 'Missing auth headers. Required: X-Address, X-Signature, X-Timestamp',
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
    res.status(401).json({ error: 'X-Timestamp expired or invalid (must be within 5 minutes)' })
    return
  }

  // Reconstruct signed message
  const body = JSON.stringify(req.body ?? {})
  const message = `${timestamp}:${body}`

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

  // Attach verified address to request for downstream use
  ;(req as any).verifiedAddress = address.toLowerCase()
  next()
}
