import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock fs
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

// Mock session — vi.mock factories are hoisted so cannot reference outer variables
vi.mock('../src/session.js', () => ({
  session: {
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    requirePrivateKey: vi.fn(() => '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    requireAddress: vi.fn(() => '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  },
}))

// Note: signing.js is not imported by buy-x402 (x402 uses X-Payment header, not EIP-191)

// Import the tool AFTER mocks are set up
import { buyX402Tool } from '../src/tools/buy-x402.js'
import { session } from '../src/session.js'

// --- Test fixtures ---

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const SKILL_ID = 'test-skill-123'
const OUTPUT_PATH = '/tmp/test-output.tar.gz'
const SELLER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const PRICE = '1000000' // 1 USDC in smallest units
const TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'

const skillDetailsResponse = {
  id: SKILL_ID,
  title: 'Test Skill',
  price: PRICE,
  payment_method: 'x402',
  seller: SELLER,
}

const paymentRequiredResponse = {
  x402Version: 2,
  paymentRequirements: [{
    scheme: 'exact',
    network: 'eip155:8453',
    maxAmountRequired: PRICE,
    resource: `/api/v1/skills/${SKILL_ID}/download`,
    description: `Purchase skill: ${SKILL_ID}`,
    payTo: '0x1234567890123456789012345678901234567890',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    extra: { seller: SELLER, skillId: SKILL_ID },
  }],
}

function makeContentBuffer() {
  return Buffer.from('test content payload for skill download')
}

function mockContentResponse(txHash?: string) {
  const buf = makeContentBuffer()
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    headers: {
      get: (name: string) => {
        if (name === 'X-Payment-TxHash') return txHash || TX_HASH
        return null
      },
    },
  }
}

// --- Tests ---

describe('df_buy_x402', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    // Reset session mocks to default behavior
    vi.mocked(session.requirePrivateKey).mockReturnValue(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    )
    vi.mocked(session.requireAddress).mockReturnValue(TEST_ADDRESS)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should have correct tool metadata', () => {
    expect(buyX402Tool.name).toBe('df_buy_x402')
    expect(buyX402Tool.inputSchema.required).toEqual(['skill_id', 'output_path'])
    expect(buyX402Tool.inputSchema.properties).toHaveProperty('skill_id')
    expect(buyX402Tool.inputSchema.properties).toHaveProperty('output_path')
    expect(buyX402Tool.inputSchema.properties).toHaveProperty('tx_hash')
  })

  describe('successful x402 purchase', () => {
    it('should complete the full purchase flow', async () => {
      // Call 1: GET /skills/:id -> skill details
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(skillDetailsResponse),
      })

      // Call 2: GET /skills/:id/download -> 402 with payment requirements
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: () => Promise.resolve(paymentRequiredResponse),
      })

      // Call 3: GET /skills/:id/download with X-Payment -> 200 with content
      mockFetch.mockResolvedValueOnce(mockContentResponse())

      const result = await buyX402Tool.execute({
        skill_id: SKILL_ID,
        output_path: OUTPUT_PATH,
      })

      expect(result.success).toBe(true)
      expect(result.skill_id).toBe(SKILL_ID)
      expect(result.output_path).toBe(OUTPUT_PATH)
      expect(result.size_bytes).toBe(makeContentBuffer().length)
      expect(result.payment_amount).toBe(PRICE)
      expect(result.payment_amount_formatted).toBe('$1.00')
      expect(result.tx_hash).toBe(TX_HASH)
      expect(Array.isArray(result.next_steps)).toBe(true)

      // Verify fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(3)

      // Call 1: skill details
      expect(mockFetch.mock.calls[0][0]).toContain(`/api/v1/skills/${SKILL_ID}`)

      // Call 2: initial download (no payment header)
      expect(mockFetch.mock.calls[1][0]).toContain(`/api/v1/skills/${SKILL_ID}/download`)

      // Call 3: download with payment
      const paidCall = mockFetch.mock.calls[2]
      expect(paidCall[0]).toContain(`/api/v1/skills/${SKILL_ID}/download`)
      expect(paidCall[1].headers['X-Payment']).toBeDefined()

      // Verify the payment header is valid base64 containing correct payload
      const decoded = JSON.parse(Buffer.from(paidCall[1].headers['X-Payment'], 'base64').toString())
      expect(decoded.x402Version).toBe(2)
      expect(decoded.scheme).toBe('exact')
      expect(decoded.payload.signature).toBeDefined()
      expect(decoded.payload.authorization).toBeDefined()
      expect(decoded.payload.authorization.from).toBe(TEST_ADDRESS)
    })
  })

  describe('re-download with tx_hash', () => {
    it('should skip payment and download with X-Buyer-Address', async () => {
      mockFetch.mockResolvedValueOnce(mockContentResponse())

      const result = await buyX402Tool.execute({
        skill_id: SKILL_ID,
        output_path: OUTPUT_PATH,
        tx_hash: TX_HASH,
      })

      expect(result.success).toBe(true)
      expect(result.tx_hash).toBe(TX_HASH)
      expect(result.payment_amount).toBe('0')
      expect(result.payment_amount_formatted).toBe('re-download (no charge)')

      // Should only make one fetch call (no skill details or payment)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Verify re-download URL and headers
      const call = mockFetch.mock.calls[0]
      expect(call[0]).toContain(`tx_hash=${TX_HASH}`)
      expect(call[1].headers['X-Buyer-Address']).toBe(TEST_ADDRESS)
    })

    it('should throw on failed re-download', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Buyer address does not match'),
      })

      await expect(
        buyX402Tool.execute({
          skill_id: SKILL_ID,
          output_path: OUTPUT_PATH,
          tx_hash: TX_HASH,
        })
      ).rejects.toThrow('Re-download failed')
    })
  })

  describe('error: skill not found', () => {
    it('should throw when skill does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      await expect(
        buyX402Tool.execute({
          skill_id: 'nonexistent',
          output_path: OUTPUT_PATH,
        })
      ).rejects.toThrow('Skill not found: nonexistent')
    })
  })

  describe('error: skill is not x402', () => {
    it('should throw when skill uses escrow payment method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ...skillDetailsResponse,
          payment_method: 'escrow',
        }),
      })

      await expect(
        buyX402Tool.execute({
          skill_id: SKILL_ID,
          output_path: OUTPUT_PATH,
        })
      ).rejects.toThrow('Use df_buy for escrow-based purchases')
    })

    it('should throw when skill uses free payment method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ...skillDetailsResponse,
          payment_method: 'free',
        }),
      })

      await expect(
        buyX402Tool.execute({
          skill_id: SKILL_ID,
          output_path: OUTPUT_PATH,
        })
      ).rejects.toThrow('Use df_download_free for free content')
    })
  })

  describe('error: payment rejected by facilitator', () => {
    it('should throw when 402 is returned again after payment', async () => {
      // Call 1: skill details
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(skillDetailsResponse),
      })

      // Call 2: initial 402
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: () => Promise.resolve(paymentRequiredResponse),
      })

      // Call 3: payment rejected — still 402
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: () => Promise.resolve({
          error: 'Payment verification failed',
          details: 'Insufficient USDC balance',
          ...paymentRequiredResponse,
        }),
      })

      await expect(
        buyX402Tool.execute({
          skill_id: SKILL_ID,
          output_path: OUTPUT_PATH,
        })
      ).rejects.toThrow('Payment rejected by facilitator: Insufficient USDC balance')
    })
  })

  describe('error: no private key in session', () => {
    it('should throw when session has no private key', async () => {
      vi.mocked(session.requirePrivateKey).mockImplementation(() => {
        throw new Error(
          'No private key in session. Use df_generate_keypair, df_wallet_from_mnemonic, or df_decrypt_keystore first.'
        )
      })

      await expect(
        buyX402Tool.execute({
          skill_id: SKILL_ID,
          output_path: OUTPUT_PATH,
        })
      ).rejects.toThrow('No private key in session')
    })
  })

  describe('edge cases', () => {
    it('should handle payment requirements with "accepts" field (v2 format)', async () => {
      // Call 1: skill details
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(skillDetailsResponse),
      })

      // Call 2: 402 with "accepts" field instead of "paymentRequirements"
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: () => Promise.resolve({
          x402Version: 2,
          accepts: paymentRequiredResponse.paymentRequirements,
        }),
      })

      // Call 3: successful download
      mockFetch.mockResolvedValueOnce(mockContentResponse())

      const result = await buyX402Tool.execute({
        skill_id: SKILL_ID,
        output_path: OUTPUT_PATH,
      })

      expect(result.success).toBe(true)
    })

    it('should handle "amount" field in requirements (v2 standard)', async () => {
      // Call 1: skill details
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(skillDetailsResponse),
      })

      // Call 2: 402 with "amount" instead of "maxAmountRequired"
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: () => Promise.resolve({
          x402Version: 2,
          paymentRequirements: [{
            ...paymentRequiredResponse.paymentRequirements![0],
            maxAmountRequired: undefined,
            amount: PRICE,
          }],
        }),
      })

      // Call 3: successful download
      mockFetch.mockResolvedValueOnce(mockContentResponse())

      const result = await buyX402Tool.execute({
        skill_id: SKILL_ID,
        output_path: OUTPUT_PATH,
      })

      expect(result.success).toBe(true)
      expect(result.payment_amount).toBe(PRICE)
    })
  })
})
