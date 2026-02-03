/**
 * Transaction intent verification.
 *
 * Every composite tool MUST call verifyTransaction() before signing.
 * The remote server could return a malicious transaction — we verify
 * that the target, function, and key parameters match our intent.
 */

import { decodeFunctionData, parseAbi } from 'viem'

// Escrow contract on Base
const ESCROW_CONTRACT = (process.env.ESCROW_CONTRACT_ADDRESS ||
  '0x69Aa385686AEdA505013a775ddE7A59d045cb30d') as `0x${string}`

// Minimal ABI for verification — matches the real DataEscrow contract
const ESCROW_ABI = parseAbi([
  'function createEscrow(bytes32 contentHash, bytes32 keyCommitment, address paymentToken, uint256 amount, uint256 expiryDays) returns (uint256)',
  'function createEscrowWithAgent(bytes32 contentHash, bytes32 keyCommitment, address paymentToken, uint256 amount, uint256 expiryDays, uint256 disputeWindowSeconds, uint256 sellerAgentId) returns (uint256)',
  'function createEscrowWithTerms(bytes32 contentHash, bytes32 keyCommitment, address paymentToken, uint256 amount, uint256 expiryDays, uint256 disputeWindowSeconds) returns (uint256)',
  'function fundEscrow(uint256 escrowId) payable',
  'function fundEscrowWithAgent(uint256 escrowId, uint256 buyerAgentId) payable',
  'function fundEscrowWithToken(uint256 escrowId)',
  'function commitKeyRelease(uint256 escrowId, bytes32 encryptedKeyCommitment)',
  'function revealKey(uint256 escrowId, bytes encryptedKeyForBuyer, bytes32 salt)',
  'function claimPayment(uint256 escrowId)',
  'function claimExpired(uint256 escrowId)',
  'function disputeEscrow(uint256 escrowId) payable',
])

// Map our intent types to actual function names on the contract
const INTENT_TO_FUNCTIONS: Record<string, string[]> = {
  createEscrow: ['createEscrow', 'createEscrowWithAgent', 'createEscrowWithTerms'],
  fundEscrow: ['fundEscrow', 'fundEscrowWithAgent', 'fundEscrowWithToken'],
  commitKeyRelease: ['commitKeyRelease'],
  revealKey: ['revealKey'],
  claimPayment: ['claimPayment'],
  claimExpired: ['claimExpired'],
  disputeEscrow: ['disputeEscrow'],
}

export interface TxIntent {
  type: 'createEscrow' | 'fundEscrow' | 'commitKeyRelease' | 'revealKey' | 'claimPayment' | 'claimExpired' | 'disputeEscrow'
  expectedValue?: bigint
  escrowId?: bigint
}

export interface UnsignedTx {
  to: string
  data: string
  value?: string
  chainId?: number
  [key: string]: unknown
}

export function verifyTransaction(tx: UnsignedTx, intent: TxIntent): void {
  // Verify target is the escrow contract
  if (tx.to?.toLowerCase() !== ESCROW_CONTRACT.toLowerCase()) {
    throw new Error(
      `Transaction target mismatch: got ${tx.to}, expected escrow contract ${ESCROW_CONTRACT}`
    )
  }

  // Decode the function call
  const decoded = decodeFunctionData({
    abi: ESCROW_ABI,
    data: tx.data as `0x${string}`,
  })

  // Verify function matches intent (allow variant functions like fundEscrowWithAgent)
  const allowedFunctions = INTENT_TO_FUNCTIONS[intent.type]
  if (!allowedFunctions || !allowedFunctions.includes(decoded.functionName)) {
    throw new Error(
      `Function mismatch: tx calls ${decoded.functionName}, expected one of [${allowedFunctions?.join(', ')}]`
    )
  }

  // Verify value for payable functions
  if (intent.expectedValue !== undefined && tx.value) {
    const txValue = BigInt(tx.value)
    if (txValue !== intent.expectedValue) {
      throw new Error(
        `Value mismatch: tx sends ${txValue} wei, expected ${intent.expectedValue} wei`
      )
    }
  }

  // For escrowId-bearing functions, verify the ID matches
  if (intent.escrowId !== undefined && decoded.args) {
    const firstArg = decoded.args[0]
    if (typeof firstArg === 'bigint' && firstArg !== intent.escrowId) {
      throw new Error(
        `Escrow ID mismatch: tx targets ${firstArg}, expected ${intent.escrowId}`
      )
    }
  }
}
