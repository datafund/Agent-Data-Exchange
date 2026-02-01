/**
 * Structured CLI errors with codes, exit codes, and retry hints.
 */

export type ErrorCode =
  | 'ERR_INVALID_ADDRESS'
  | 'ERR_INVALID_ARGUMENT'
  | 'ERR_MISSING_KEY'
  | 'ERR_MISSING_RPC'
  | 'ERR_MISSING_TOKEN'
  | 'ERR_CONFIRMATION_REQUIRED'
  | 'ERR_INVALID_SIGNATURE'
  | 'ERR_WRONG_CHAIN'
  | 'ERR_INSUFFICIENT_BALANCE'
  | 'ERR_GAS_TOO_HIGH'
  | 'ERR_TX_REVERTED'
  | 'ERR_NOT_FOUND'
  | 'ERR_RATE_LIMITED'
  | 'ERR_NETWORK_TIMEOUT'
  | 'ERR_API_ERROR'

const EXIT_CODES: Record<ErrorCode, number> = {
  ERR_INVALID_ADDRESS: 1,
  ERR_INVALID_ARGUMENT: 1,
  ERR_MISSING_KEY: 2,
  ERR_MISSING_RPC: 2,
  ERR_MISSING_TOKEN: 2,
  ERR_CONFIRMATION_REQUIRED: 1,
  ERR_INVALID_SIGNATURE: 2,
  ERR_WRONG_CHAIN: 3,
  ERR_INSUFFICIENT_BALANCE: 3,
  ERR_GAS_TOO_HIGH: 3,
  ERR_TX_REVERTED: 3,
  ERR_NOT_FOUND: 4,
  ERR_RATE_LIMITED: 4,
  ERR_NETWORK_TIMEOUT: 4,
  ERR_API_ERROR: 4,
}

const RETRYABLE: Set<ErrorCode> = new Set([
  'ERR_GAS_TOO_HIGH',
  'ERR_RATE_LIMITED',
  'ERR_NETWORK_TIMEOUT',
  'ERR_API_ERROR',
])

export class CLIError extends Error {
  code: ErrorCode
  exitCode: number
  retryable: boolean
  suggestion?: string

  constructor(code: ErrorCode, message: string, suggestion?: string) {
    super(message)
    this.name = 'CLIError'
    this.code = code
    this.exitCode = EXIT_CODES[code]
    this.retryable = RETRYABLE.has(code)
    this.suggestion = suggestion
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.suggestion && { suggestion: this.suggestion }),
      },
    }
  }

  toHuman(): string {
    let msg = `error: ${this.code} — ${this.message}`
    if (this.suggestion) msg += `. ${this.suggestion}`
    return msg
  }
}
