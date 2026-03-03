import { describe, it, expect } from 'vitest'
import {
  suggestPaymentMethod,
  formatUsdc,
  parseUsdc,
  X402_PRICE_TIERS,
  encryptContentKey,
  decryptContentKey,
  encryptContent,
  decryptContent,
  sanitizeFilename,
} from '../src/x402.js'

describe('suggestPaymentMethod', () => {
  it('returns free for zero', () => {
    expect(suggestPaymentMethod('0')).toBe('free')
    expect(suggestPaymentMethod('')).toBe('free')
  })
  it('returns x402 under $5', () => {
    expect(suggestPaymentMethod('100000')).toBe('x402')
    expect(suggestPaymentMethod('4999999')).toBe('x402')
  })
  it('returns escrow at $5+', () => {
    expect(suggestPaymentMethod('5000000')).toBe('escrow')
    expect(suggestPaymentMethod('10000000')).toBe('escrow')
  })
})

describe('formatUsdc', () => {
  it('formats to dollar string', () => {
    expect(formatUsdc('500000')).toBe('$0.50')
    expect(formatUsdc('1000000')).toBe('$1.00')
    expect(formatUsdc('0')).toBe('$0.00')
    expect(formatUsdc('100000')).toBe('$0.10')
    expect(formatUsdc('1500')).toBe('$0.0015')
    expect(formatUsdc('10000000')).toBe('$10.00')
  })
})

describe('parseUsdc', () => {
  it('converts dollars to smallest units', () => {
    expect(parseUsdc('0.50')).toBe('500000')
    expect(parseUsdc('1')).toBe('1000000')
    expect(parseUsdc('5')).toBe('5000000')
  })
  it('returns 0 for invalid input', () => {
    expect(parseUsdc('abc')).toBe('0')
    expect(parseUsdc('-1')).toBe('0')
  })
})

describe('X402_PRICE_TIERS', () => {
  it('has 4 tiers', () => {
    expect(X402_PRICE_TIERS).toHaveLength(4)
    expect(X402_PRICE_TIERS[0].label).toBe('Free')
    expect(X402_PRICE_TIERS[3].label).toBe('Premium')
  })
})

describe('content key encryption', () => {
  const masterSecret = 'a'.repeat(64)

  it('round-trips key encryption', () => {
    const originalKey = 'b'.repeat(64)
    const encrypted = encryptContentKey(originalKey, masterSecret)
    expect(encrypted).not.toBe(originalKey)
    const decrypted = decryptContentKey(encrypted, masterSecret)
    expect(decrypted).toBe(originalKey)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const key = 'c'.repeat(64)
    const e1 = encryptContentKey(key, masterSecret)
    const e2 = encryptContentKey(key, masterSecret)
    expect(e1).not.toBe(e2)
  })
})

describe('content encryption', () => {
  it('round-trips content', () => {
    const original = Buffer.from('hello world test content')
    const { key, encrypted } = encryptContent(original)
    expect(key).toHaveLength(64)
    expect(encrypted.length).toBeGreaterThan(original.length)
    const decrypted = decryptContent(encrypted, key)
    expect(decrypted.toString()).toBe(original.toString())
  })
})

describe('sanitizeFilename', () => {
  it('strips path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd')
  })
  it('strips non-whitelisted characters', () => {
    expect(sanitizeFilename('file"name;bad\n.tar.gz')).toBe('filenamebad.tar.gz')
  })
  it('preserves normal filenames', () => {
    expect(sanitizeFilename('my-pack-v1.tar.gz')).toBe('my-pack-v1.tar.gz')
  })
  it('falls back to download for empty', () => {
    expect(sanitizeFilename('')).toBe('download')
    expect(sanitizeFilename('...')).toBe('download')
  })
  it('strips leading dots (no hidden files)', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden')
    expect(sanitizeFilename('..config')).toBe('config')
  })
})
