/**
 * Thin API client for agents.datafund.io REST API.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { CLIError } from './errors.js'

const TIMEOUT_MS = 30_000

export function getBaseUrl(): string {
  return (process.env.SX_API || 'https://agents.datafund.io').trim()
}

export async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`

  let res: Response
  try {
    res = await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        ...opts?.headers,
      },
    })
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new CLIError('ERR_NETWORK_TIMEOUT', `Request timed out after ${TIMEOUT_MS / 1000}s`, 'Try again or check your network')
    }
    throw new CLIError('ERR_API_ERROR', `Network error: ${(err as Error).message}`, 'Check SX_API and your network')
  }

  if (res.status === 404) {
    throw new CLIError('ERR_NOT_FOUND', `Not found: ${path}`)
  }
  if (res.status === 429) {
    throw new CLIError('ERR_RATE_LIMITED', 'Rate limited by API', 'Wait a moment and retry')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new CLIError('ERR_API_ERROR', `API returned ${res.status}: ${body}`, 'Check SX_API or try again')
  }

  return res.json() as Promise<T>
}

/**
 * POST with EIP-191 signature authentication.
 * Signs `${timestamp}:${JSON.stringify(body)}` with the private key.
 */
export async function apiPost<T = unknown>(path: string, body: Record<string, unknown>, privateKey?: `0x${string}`): Promise<T> {
  const headers: Record<string, string> = {}

  if (privateKey) {
    const account = privateKeyToAccount(privateKey)
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const bodyStr = JSON.stringify(body)
    const message = `${timestamp}:${bodyStr}`
    const signature = await account.signMessage({ message })

    headers['X-Address'] = account.address
    headers['X-Signature'] = signature
    headers['X-Timestamp'] = timestamp
  }

  return apiFetch<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}
