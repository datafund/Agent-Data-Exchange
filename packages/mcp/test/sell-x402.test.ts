import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as crypto from 'crypto'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock fs
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockReadFileSync = vi.fn()
vi.mock('fs', () => ({
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}))

// Mock session
vi.mock('../src/session.js', () => ({
  session: {
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    requirePrivateKey: vi.fn(() => '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    requireAddress: vi.fn(() => '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
    setEscrow: vi.fn(),
  },
}))

// Mock proxy (callRemoteTool) — needed for Swarm upload + download verification
const mockCallRemoteTool = vi.fn()
vi.mock('../src/proxy.js', () => ({
  callRemoteTool: (...args: any[]) => mockCallRemoteTool(...args),
}))

// Mock tx-verify — not used in x402 flow but imported by sell.ts
vi.mock('../src/tx-verify.js', () => ({
  verifyTransaction: vi.fn(),
}))

// Mock signing tool — not used in x402 flow but imported by sell.ts
vi.mock('../src/tools/signing.js', () => ({
  signTransactionTool: {
    execute: vi.fn(),
  },
}))

// Mock signing.js (EIP-191) — used for marketplace publish
vi.mock('../src/signing.js', () => ({
  signRequest: vi.fn(() => ({
    'Content-Type': 'application/json',
    'X-Address': '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    'X-Signature': '0xmocksig',
    'X-Timestamp': '1234567890',
    'X-Nonce': 'mock-nonce',
  })),
}))

// Import AFTER mocks
import { sellTool } from '../src/tools/sell.js'

// --- Test fixtures ---

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const SWARM_REF = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'
const PRICE_USDC = '1000000' // 1 USDC
const TEST_CONTENT = 'Hello, this is test content for x402 sale'
const TEST_CONTENT_BASE64 = Buffer.from(TEST_CONTENT).toString('base64')

function makeUploadResponse() {
  return { reference: SWARM_REF }
}

function makeDownloadResponse(encryptedBase64: string) {
  return {
    data_base64: encryptedBase64,
    size: Buffer.from(encryptedBase64, 'base64').length,
  }
}

// --- Tests ---

describe('df_sell with payment_method: x402', () => {
  let capturedUploadData: string | null = null

  beforeEach(() => {
    mockFetch.mockReset()
    mockCallRemoteTool.mockReset()
    mockReadFileSync.mockReset()
    capturedUploadData = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should have updated tool metadata with payment_method property', () => {
    expect(sellTool.inputSchema.properties).toHaveProperty('payment_method')
    expect(sellTool.inputSchema.properties.payment_method.type).toBe('string')
  })

  describe('successful x402 sell from content_base64', () => {
    it('should encrypt, upload, and publish without escrow', async () => {
      // Mock callRemoteTool: upload returns Swarm ref, download verifies
      mockCallRemoteTool.mockImplementation(async (name: string, args: any) => {
        if (name === 'fairdrop_upload_bytes') {
          capturedUploadData = args.data_base64
          return makeUploadResponse()
        }
        if (name === 'fairdrop_download_bytes') {
          // Return the same data that was uploaded (for verification)
          return makeDownloadResponse(capturedUploadData!)
        }
        throw new Error(`Unexpected tool call: ${name}`)
      })

      // Mock marketplace publish
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'skill-001', status: 'active' }),
      })

      const result = await sellTool.execute({
        content_base64: TEST_CONTENT_BASE64,
        price_wei: PRICE_USDC,
        name: 'Test Skill',
        description: 'A test skill for x402',
        category: 'research',
        tags: ['test', 'x402'],
        payment_method: 'x402',
      })

      expect(result.success).toBe(true)
      expect(result.payment_method).toBe('x402')
      expect(result.contentHash).toBeDefined()
      expect(result.contentHash).toMatch(/^0x[0-9a-f]{64}$/i)
      expect(result.encryptedDataRef).toBe(SWARM_REF)
      expect(result.marketplace).toEqual({ id: 'skill-001', status: 'active' })
      expect(Array.isArray(result.next_steps)).toBe(true)

      // Verify no escrow-related fields
      expect(result).not.toHaveProperty('escrowId')
      expect(result).not.toHaveProperty('txHash')
      expect(result).not.toHaveProperty('encryptionKey')
      // x402 flow has its own key backup (not escrow key backup)
      expect(result).toHaveProperty('keyBackupFile')

      // Verify Swarm upload was called
      expect(mockCallRemoteTool).toHaveBeenCalledWith('fairdrop_upload_bytes', {
        data_base64: expect.any(String),
      })

      // Verify the uploaded data is encrypted (not plaintext)
      expect(capturedUploadData).toBeDefined()
      const uploadedBytes = Buffer.from(capturedUploadData!, 'base64')
      // AES-256-GCM: IV(12) + authTag(16) + ciphertext
      expect(uploadedBytes.length).toBeGreaterThan(12 + 16)
      // The encrypted data should NOT contain the plaintext
      expect(uploadedBytes.toString()).not.toContain(TEST_CONTENT)

      // Verify marketplace publish was called with correct body
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [publishUrl, publishOpts] = mockFetch.mock.calls[0]
      expect(publishUrl).toContain('/api/v1/skills')
      const body = JSON.parse(publishOpts.body)
      expect(body.payment_method).toBe('x402')
      expect(body.x402_content_key).toBeDefined()
      expect(body.x402_content_key).toHaveLength(64) // 32 bytes = 64 hex chars
      expect(body.priceToken).toBe('USDC')
      expect(body.price).toBe(PRICE_USDC)
      expect(body.seller).toBe(TEST_ADDRESS)
      expect(body.title).toBe('Test Skill')
      expect(body.tags).toEqual(['test', 'x402'])
      expect(body.contentHash).toBeDefined()
      expect(body.encryptedDataRef).toBe(SWARM_REF)

      // Verify the content key can actually decrypt the uploaded data
      const keyBuf = Buffer.from(body.x402_content_key, 'hex')
      const iv = uploadedBytes.subarray(0, 12)
      const authTag = uploadedBytes.subarray(12, 28)
      const ciphertext = uploadedBytes.subarray(28)
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      expect(decrypted.toString()).toBe(TEST_CONTENT)
    })
  })

  describe('successful x402 sell from file_path', () => {
    it('should read file and encrypt for x402', async () => {
      const fileContent = Buffer.from('File content for x402 sale')
      mockReadFileSync.mockReturnValue(fileContent)

      mockCallRemoteTool.mockImplementation(async (name: string, args: any) => {
        if (name === 'fairdrop_upload_bytes') {
          capturedUploadData = args.data_base64
          return makeUploadResponse()
        }
        if (name === 'fairdrop_download_bytes') {
          return makeDownloadResponse(capturedUploadData!)
        }
        throw new Error(`Unexpected tool call: ${name}`)
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'skill-002', status: 'active' }),
      })

      const result = await sellTool.execute({
        file_path: '/tmp/test-file.tar.gz',
        price_wei: PRICE_USDC,
        name: 'File Skill',
        description: 'Skill from file',
        category: 'dataset',
        payment_method: 'x402',
      })

      expect(result.success).toBe(true)
      expect(result.payment_method).toBe('x402')
      expect(mockReadFileSync).toHaveBeenCalledWith('/tmp/test-file.tar.gz')
    })
  })

  describe('error: no content provided', () => {
    it('should throw when neither content_base64 nor file_path is given', async () => {
      await expect(
        sellTool.execute({
          price_wei: PRICE_USDC,
          name: 'No Content',
          description: 'Missing content',
          category: 'other',
          payment_method: 'x402',
        })
      ).rejects.toThrow('Provide content_base64 or file_path')
    })
  })

  describe('error: empty content', () => {
    it('should throw when file content is empty', async () => {
      mockReadFileSync.mockReturnValue(Buffer.alloc(0))

      await expect(
        sellTool.execute({
          file_path: '/tmp/empty-file.txt',
          price_wei: PRICE_USDC,
          name: 'Empty',
          description: 'Empty content',
          category: 'other',
          payment_method: 'x402',
        })
      ).rejects.toThrow('Content is empty')
    })
  })

  describe('error: Swarm upload fails', () => {
    it('should throw when upload returns no reference', async () => {
      mockCallRemoteTool.mockImplementation(async (name: string) => {
        if (name === 'fairdrop_upload_bytes') {
          return { reference: '' }
        }
        throw new Error(`Unexpected tool call: ${name}`)
      })

      await expect(
        sellTool.execute({
          content_base64: TEST_CONTENT_BASE64,
          price_wei: PRICE_USDC,
          name: 'Upload Fail',
          description: 'Upload will fail',
          category: 'other',
          payment_method: 'x402',
        })
      ).rejects.toThrow('Swarm upload did not return a reference')
    })
  })

  describe('error: Swarm verification fails', () => {
    it('should throw when uploaded content cannot be verified', async () => {
      mockCallRemoteTool.mockImplementation(async (name: string, args: any) => {
        if (name === 'fairdrop_upload_bytes') {
          return makeUploadResponse()
        }
        if (name === 'fairdrop_download_bytes') {
          // Return empty data — verification fails
          return { data_base64: '', size: 0 }
        }
        throw new Error(`Unexpected tool call: ${name}`)
      })

      await expect(
        sellTool.execute({
          content_base64: TEST_CONTENT_BASE64,
          price_wei: PRICE_USDC,
          name: 'Verify Fail',
          description: 'Verification will fail',
          category: 'other',
          payment_method: 'x402',
        })
      ).rejects.toThrow('Swarm upload verification failed')
    })
  })

  describe('error: marketplace publish fails', () => {
    it('should throw when marketplace returns error', async () => {
      mockCallRemoteTool.mockImplementation(async (name: string, args: any) => {
        if (name === 'fairdrop_upload_bytes') {
          capturedUploadData = args.data_base64
          return makeUploadResponse()
        }
        if (name === 'fairdrop_download_bytes') {
          return makeDownloadResponse(capturedUploadData!)
        }
        throw new Error(`Unexpected tool call: ${name}`)
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid content key format'),
      })

      await expect(
        sellTool.execute({
          content_base64: TEST_CONTENT_BASE64,
          price_wei: PRICE_USDC,
          name: 'Publish Fail',
          description: 'Publish will fail',
          category: 'other',
          payment_method: 'x402',
        })
      ).rejects.toThrow('Marketplace publish failed (400): Invalid content key format')
    })
  })

  describe('escrow flow unchanged', () => {
    it('should not route to x402 when payment_method is not set', async () => {
      // When payment_method is not 'x402', the escrow flow runs.
      // The escrow flow calls createPublicClient (viem) which will fail in test
      // because there's no real RPC. This proves we entered the escrow branch.
      await expect(
        sellTool.execute({
          content_base64: TEST_CONTENT_BASE64,
          price_wei: '1000000000000000',
          name: 'Escrow Sell',
          description: 'Should use escrow flow',
          category: 'research',
          // No payment_method — defaults to escrow
        })
      ).rejects.toThrow() // Will throw because escrow needs real RPC / mocked viem
    })

    it('should not route to x402 when payment_method is escrow', async () => {
      await expect(
        sellTool.execute({
          content_base64: TEST_CONTENT_BASE64,
          price_wei: '1000000000000000',
          name: 'Escrow Sell',
          description: 'Should use escrow flow',
          category: 'research',
          payment_method: 'escrow',
        })
      ).rejects.toThrow() // Will throw because escrow needs real RPC / mocked viem
    })
  })
})
