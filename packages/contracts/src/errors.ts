/**
 * Contract error code mapping.
 *
 * The DataEscrowV3 contract uses short error codes (E01-E10) to save gas
 * and avoid information disclosure. This module maps them to user-friendly messages.
 *
 * NOTE: The actual contract require() statements need to be updated in the
 * fairdrop/contracts repository. This provides client-side decoding.
 */

export const CONTRACT_ERRORS: Record<string, string> = {
  'E01': 'Seller not registered as agent',
  'E02': 'Expiry must be between 1 and 365 days',
  'E03': 'Amount is below the minimum threshold',
  'E04': 'Content hash is required',
  'E05': 'Key commitment is required',
  'E06': 'Invalid escrow state for this operation',
  'E07': 'Unauthorized: not seller or buyer',
  'E08': 'Key does not match commitment',
  'E09': 'Escrow has expired',
  'E10': 'Escrow already funded',
  'E11': 'Designated buyer mismatch',
  'E12': 'Dispute window still active',
  'E13': 'Insufficient bond for dispute',
  'E14': 'Dispute response period expired',
  'E15': 'Already disputed',
};

/**
 * Decode a contract error message.
 * Extracts error code (E01-E99) and returns human-readable message.
 *
 * @param error - The error message or revert reason from the contract
 * @returns Human-readable error message
 */
export function decodeContractError(error: string | Error): string {
  const errorStr = error instanceof Error ? error.message : error;

  // Look for error code pattern E01-E99
  const match = errorStr.match(/E\d{2}/);
  if (match) {
    const code = match[0];
    const message = CONTRACT_ERRORS[code];
    if (message) {
      return `${code}: ${message}`;
    }
    return `Unknown error code: ${code}`;
  }

  // Check for common ethers.js error patterns
  if (errorStr.includes('execution reverted')) {
    // Try to extract the revert reason
    const reasonMatch = errorStr.match(/reason="([^"]+)"/);
    if (reasonMatch) {
      return decodeContractError(reasonMatch[1]);
    }
    return 'Transaction reverted (no reason provided)';
  }

  if (errorStr.includes('insufficient funds')) {
    return 'Insufficient funds for transaction';
  }

  if (errorStr.includes('nonce')) {
    return 'Transaction nonce error - please retry';
  }

  // Return original if no pattern matched
  return errorStr;
}

/**
 * Check if an error is a known contract error.
 */
export function isContractError(error: string | Error): boolean {
  const errorStr = error instanceof Error ? error.message : error;
  return /E\d{2}/.test(errorStr) || errorStr.includes('execution reverted');
}
