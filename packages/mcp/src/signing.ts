/**
 * EIP-191 request signing for marketplace API authentication.
 *
 * Signs requests with the session's private key to produce headers
 * matching the server's verify-signature middleware.
 */

import * as secp256k1 from '@noble/secp256k1'
import * as crypto from 'crypto'
import { keccak256 } from 'viem'
import { randomUUID } from 'crypto'

// Initialize @noble/secp256k1 v3 hash functions using Node.js crypto
if (!secp256k1.hashes.sha256) {
  secp256k1.hashes.sha256 = (...msgs: Uint8Array[]) => {
    const h = crypto.createHash('sha256')
    for (const m of msgs) h.update(m)
    return Uint8Array.from(h.digest())
  }
}
if (!secp256k1.hashes.hmacSha256) {
  secp256k1.hashes.hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
    const h = crypto.createHmac('sha256', key)
    for (const m of msgs) h.update(m)
    return Uint8Array.from(h.digest())
  }
}

/**
 * Create EIP-191 signature headers for a marketplace API request.
 *
 * Message format: `${timestamp}:${nonce}:${JSON.stringify(body)}`
 * Signature: EIP-191 personal sign (prefixed message).
 */
export function signRequest(
  body: Record<string, unknown>,
  privateKey: string,
): Record<string, string> {
  const key = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomUUID()
  const bodyStr = JSON.stringify(body)
  const message = `${timestamp}:${nonce}:${bodyStr}`

  // EIP-191 personal message prefix
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`
  const prefixed = prefix + message
  const hashHex = keccak256(new Uint8Array(Buffer.from(prefixed)))

  // Sign with @noble/secp256k1 v3: format 'recovered' returns [recovery(1), r(32), s(32)]
  const hashBytes = Uint8Array.from(Buffer.from(hashHex.slice(2), 'hex'))
  const keyBytes = Uint8Array.from(Buffer.from(key, 'hex'))
  const sig = secp256k1.sign(hashBytes, keyBytes, { format: 'recovered' as any, prehash: false })

  const recovery = sig[0]
  const r = Buffer.from(sig.slice(1, 33)).toString('hex')
  const s = Buffer.from(sig.slice(33, 65)).toString('hex')
  const v = (recovery + 27).toString(16).padStart(2, '0')
  const signature = `0x${r}${s}${v}`

  // Derive address from public key
  const pubKey = secp256k1.getPublicKey(keyBytes, false) // uncompressed, 65 bytes
  const pubKeyHash = keccak256(new Uint8Array(pubKey.slice(1)))
  const address = `0x${pubKeyHash.slice(-40)}`

  return {
    'Content-Type': 'application/json',
    'X-Address': address,
    'X-Signature': signature,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
  }
}
