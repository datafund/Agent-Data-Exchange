import { verifyMessage } from 'viem'

/**
 * Strip HTML tags and trim whitespace from user input.
 * Returns empty string for falsy values.
 */
export function sanitize(input: unknown): string {
  if (!input || typeof input !== 'string') return ''
  return input.replace(/<[^>]*>/g, '').trim()
}

/**
 * Validate an Ethereum address (0x + 40 hex chars).
 */
export function isValidAddress(addr: unknown): addr is string {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr)
}

/**
 * Verify an EIP-191 signature if provided.
 * Returns true if no signature (optional auth), or if signature is valid.
 * Returns false only if signature is provided but invalid.
 */
export async function verifyWalletSignature(
  address: string,
  signature: string | undefined,
  message: string,
): Promise<boolean> {
  if (!signature) return true // optional for now
  try {
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })
    return valid
  } catch {
    return false
  }
}
