import { Router } from 'express'
import { ethers } from 'ethers'
import type { AgentsDatabase } from '../../db/database.js'

const ESCROW_CONTRACT = '0xDd4396d4F28d2b513175ae17dE11e56a898d19c3'
const CHAIN_ID = 8453

const ESCROW_ABI = [
  'function createEscrow(bytes32 contentHash, bytes32 keyCommitment, address paymentToken, uint256 amount, uint256 expiryDays, bytes32 metadataHash, bytes32 category, bytes32 expectedDataHash, address designatedBuyer, bool fastSettle) returns (uint256)',
  'function fundEscrow(uint256 escrowId) payable',
  'function fundEscrowWithToken(uint256 escrowId)',
]

const escrowInterface = new ethers.Interface(ESCROW_ABI)

export function escrowRoutes(db: AgentsDatabase): Router {
  const router = Router()

  router.get('/:escrowId', (req, res) => {
    const escrowId = parseInt(req.params.escrowId, 10)
    if (isNaN(escrowId)) return res.status(400).json({ error: 'Invalid escrow ID' })
    const escrow = db.getEscrow(escrowId)
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' })
    res.json(escrow)
  })

  router.get('/', (req, res) => {
    const { seller, buyer, state } = req.query as Record<string, string | undefined>
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)
    const offset = parseInt(req.query.offset as string) || 0
    const escrows = db.listEscrows({ seller, buyer, state, limit, offset })
    const total = db.countEscrows({ seller, buyer, state })
    res.json({ escrows, total, limit, offset })
  })

  router.post('/', (req, res) => {
    try {
      const { action } = req.body
      if (action === 'fund') {
        const { escrowId } = req.body
        if (!escrowId) return res.status(400).json({ error: 'escrowId is required for funding' })
        const escrow = db.getEscrow(parseInt(escrowId, 10))
        if (!escrow) return res.status(404).json({ error: 'Escrow not found' })
        if (escrow.state !== 'created') return res.status(400).json({ error: `Escrow cannot be funded - current state: ${escrow.state}`, currentState: escrow.state })
        const isNativeToken = escrow.payment_token === '0x0000000000000000000000000000000000000000'
        const functionName = isNativeToken ? 'fundEscrow' : 'fundEscrowWithToken'
        const calldata = escrowInterface.encodeFunctionData(functionName, [escrowId])
        return res.json({
          action: 'fund', escrowId: escrow.id,
          transaction: { to: ESCROW_CONTRACT, data: calldata, value: isNativeToken ? escrow.amount : '0', chainId: CHAIN_ID },
          escrow: { seller: escrow.seller, amount: escrow.amount, paymentToken: escrow.payment_token, state: escrow.state },
          instructions: isNativeToken ? `Send ${escrow.amount} wei to fund escrow #${escrowId}` : `Approve ${escrow.amount} tokens first, then call fundEscrowWithToken`,
        })
      } else if (action === 'create') {
        const { contentHash, keyCommitment, paymentToken = '0x0000000000000000000000000000000000000000', amount, expiryDays = 7, metadataHash = ethers.ZeroHash, category = ethers.ZeroHash, expectedDataHash = ethers.ZeroHash, designatedBuyer = ethers.ZeroAddress, fastSettle = false } = req.body
        if (!contentHash) return res.status(400).json({ error: 'contentHash is required' })
        if (!keyCommitment) return res.status(400).json({ error: 'keyCommitment is required' })
        if (!amount) return res.status(400).json({ error: 'amount is required' })
        const bytes32Regex = /^0x[a-fA-F0-9]{64}$/
        if (!bytes32Regex.test(contentHash)) return res.status(400).json({ error: 'contentHash must be a valid bytes32 (0x + 64 hex chars)' })
        if (!bytes32Regex.test(keyCommitment)) return res.status(400).json({ error: 'keyCommitment must be a valid bytes32 (0x + 64 hex chars)' })
        const calldata = escrowInterface.encodeFunctionData('createEscrow', [contentHash, keyCommitment, paymentToken, amount, expiryDays, metadataHash, category, expectedDataHash, designatedBuyer, fastSettle])
        return res.json({
          action: 'create',
          transaction: { to: ESCROW_CONTRACT, data: calldata, value: '0', chainId: CHAIN_ID },
          params: { contentHash, keyCommitment, paymentToken, amount, expiryDays, metadataHash, category, expectedDataHash, designatedBuyer, fastSettle },
          instructions: 'Submit this transaction to create the escrow. The escrow ID will be emitted in the EscrowCreated event.',
        })
      } else {
        return res.status(400).json({
          error: 'Invalid action. Use "create" (seller) or "fund" (buyer)',
          usage: { create: { action: 'create', contentHash: '0x... (bytes32)', keyCommitment: '0x... (bytes32)', amount: '1000000000000000000 (wei)', paymentToken: '0x0000... (optional)', expiryDays: 7 }, fund: { action: 'fund', escrowId: '123' } }
        })
      }
    } catch (err) {
      console.error('[escrows] POST error:', err)
      return res.status(500).json({ error: 'Failed to prepare transaction' })
    }
  })

  return router
}
