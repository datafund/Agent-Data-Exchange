import * as crypto from 'crypto'

export const USDC_DECIMALS = 6
export const ESCROW_THRESHOLD = 5_000_000n

export const X402_PRICE_TIERS = [
  { label: 'Free', amount: '0', method: 'free' as const },
  { label: 'Micro', amount: '100000', method: 'x402' as const },
  { label: 'Standard', amount: '500000', method: 'x402' as const },
  { label: 'Premium', amount: '1000000', method: 'x402' as const },
] as const

export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
export const BASE_NETWORK = 'eip155:8453'
export const BASE_SEPOLIA_NETWORK = 'eip155:84532'

export function suggestPaymentMethod(priceUsdc: string): 'free' | 'x402' | 'escrow' {
  const amount = BigInt(priceUsdc || '0')
  if (amount === 0n) return 'free'
  if (amount >= ESCROW_THRESHOLD) return 'escrow'
  return 'x402'
}

export function formatUsdc(smallestUnits: string): string {
  const n = BigInt(smallestUnits || '0')
  const whole = n / 1_000_000n
  const frac = n % 1_000_000n
  if (frac === 0n) return `$${whole}.00`
  const fracStr = frac.toString().padStart(6, '0')
  const trimmed = fracStr.replace(/0+$/, '')
  const display = trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed
  return `$${whole}.${display}`
}

export function parseUsdc(dollars: string): string {
  const num = parseFloat(dollars)
  if (isNaN(num) || num < 0) return '0'
  return Math.round(num * 1_000_000).toString()
}

export function encryptContentKey(keyHex: string, masterSecretHex: string): string {
  const master = Buffer.from(masterSecretHex, 'hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', master, iv)
  const ct = Buffer.concat([cipher.update(keyHex, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptContentKey(encrypted: string, masterSecretHex: string): string {
  const master = Buffer.from(masterSecretHex, 'hex')
  const buf = Buffer.from(encrypted, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', master, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ct).toString('utf8') + decipher.final('utf8')
}

export function encryptContent(content: Buffer): { key: string; encrypted: Buffer } {
  const key = crypto.randomBytes(32)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    key: key.toString('hex'),
    encrypted: Buffer.concat([iv, authTag, ciphertext]),
  }
}

export function decryptContent(encrypted: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex')
  const iv = encrypted.subarray(0, 12)
  const authTag = encrypted.subarray(12, 28)
  const ciphertext = encrypted.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'download'
}

export function isValidSwarmRef(ref: string): boolean {
  return /^[0-9a-f]{64}$/i.test(ref)
}
