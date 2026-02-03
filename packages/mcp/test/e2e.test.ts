/**
 * End-to-end workflow tests
 * Tests realistic usage scenarios
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Import tools directly
import { analyzeKnowledgeTool } from '../src/tools/discovery.js'
import { matchBountiesTool } from '../src/tools/matching.js'
import { generateCardTool, initiateExchangeTool } from '../src/tools/network.js'
import { generateKeypairTool, generateMnemonicTool, walletFromMnemonicTool, createKeystoreTool } from '../src/tools/identity.js'

const TEST_DIR = path.join(process.cwd(), 'test-e2e')

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock session
vi.mock('../src/session.js', () => ({
  session: {
    address: '0x1234567890123456789012345678901234567890',
    subdomain: 'testuser',
    privateKey: 'a'.repeat(64),
    publicKey: 'b'.repeat(66),
    setIdentity: vi.fn(),
    setSubdomain: vi.fn(),
    requirePrivateKey: () => 'a'.repeat(64),
    requireAddress: () => '0x1234567890123456789012345678901234567890',
  },
}))

describe('E2E: Seller Workflow', () => {
  beforeAll(() => {
    // Create realistic test content
    fs.mkdirSync(path.join(TEST_DIR, 'research'), { recursive: true })
    fs.mkdirSync(path.join(TEST_DIR, 'code'), { recursive: true })

    // Create research content
    fs.writeFileSync(
      path.join(TEST_DIR, 'research', 'climate-analysis.md'),
      `---
tags: [climate, environment, research]
---

# Climate Data Analysis

## Summary
Comprehensive analysis of climate data from 2020-2024.

## Key Findings
- Temperature increased by 0.5°C
- Sea levels rose by 3mm
- CO2 levels reached new highs

## Data Sources
- NASA
- NOAA
- IPCC
`
    )

    fs.writeFileSync(
      path.join(TEST_DIR, 'research', 'market-report.md'),
      `# Market Research Report

Analysis of the AI market trends.

## Key Points
- Market growing at 25% YoY
- Enterprise adoption accelerating
`
    )

    // Create code content
    fs.writeFileSync(
      path.join(TEST_DIR, 'code', 'utils.ts'),
      `export function formatCurrency(amount: bigint): string {
  return (Number(amount) / 1e18).toFixed(4) + ' ETH'
}

export function validateAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}
`
    )
  })

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  })

  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('Step 1: Analyze local knowledge', () => {
    const result = analyzeKnowledgeTool.execute({
      paths: [TEST_DIR],
      depth: 'deep',
    })

    expect(result.items.length).toBeGreaterThan(0)
    expect(result.summary.by_category).toHaveProperty('research')
    expect(result.summary.by_category).toHaveProperty('code')

    // Verify privacy note
    expect(result.privacy_note).toContain('metadata')
  })

  it('Step 2: Match against bounties', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/bounties')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              bounties: [
                {
                  id: 'bounty-climate',
                  title: 'Need climate research data',
                  category: 'research',
                  tags: ['climate', 'environment'],
                  reward_amount: '2000000000000000000',
                  poster: '0xbuyer',
                },
              ],
            }),
        })
      }
      if (url.includes('/market/pricing')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ avg_price: '1500000000000000000' }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    // Create simulated knowledge items (matching what analyze would return)
    const knowledgeItems = [
      {
        path: path.join(TEST_DIR, 'research', 'climate-analysis.md'),
        category: 'research',
        tags: ['research', 'climate', 'environment'],
        size_bytes: 500,
      },
      {
        path: path.join(TEST_DIR, 'research', 'market-report.md'),
        category: 'research',
        tags: ['research', 'market'],
        size_bytes: 300,
      },
    ]

    // Match against bounties
    const matches = await matchBountiesTool.execute({
      knowledge_items: knowledgeItems,
      min_confidence: 20,
    })

    expect(matches.matches.length).toBeGreaterThan(0)

    // The climate analysis should match the climate bounty
    const climateMatch = matches.matches.find(
      (m: any) => m.bounty.id === 'bounty-climate'
    )
    expect(climateMatch).toBeDefined()
    expect(climateMatch.confidence).toBeGreaterThan(20)
    expect(climateMatch.match_reasons.length).toBeGreaterThan(0)
  })

  it('Step 3: Generate agent card', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    const card = await generateCardTool.execute({
      categories: ['research', 'code'],
      seeking: ['dataset'],
      custom_message: 'I have climate research and TypeScript utilities available!',
    })

    expect(card.card.type).toBe('datafund_agent_card')
    expect(card.card.capabilities.categories).toContain('research')
    expect(card.share_text).toContain('climate research')
  })

  it('Step 4: Create offer (phase 1)', async () => {
    const offer = await initiateExchangeTool.execute({
      name: 'Climate Analysis Report 2024',
      description: 'Comprehensive climate data analysis with key findings',
      price_wei: '1500000000000000000',
      category: 'research',
      tags: ['climate', 'environment', 'data'],
    })

    expect(offer.phase).toBe(1)
    expect(offer.offer_id).toBeDefined()
    expect(offer.share_message).toContain('Climate Analysis')
    expect(offer.offer_details.price_eth).toBe('1')
  })
})

describe('E2E: Identity Workflow', () => {
  it('should generate keypair and create keystore', async () => {
    // Step 1: Generate keypair
    const keypair = generateKeypairTool.execute()

    expect(keypair.privateKey).toHaveLength(64)
    expect(keypair.publicKey).toBeDefined()
    expect(keypair.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(keypair.session).toBe('saved')

    // Step 2: Create keystore
    const keystore = await createKeystoreTool.execute({
      subdomain: 'myagent',
      password: 'secure-password-123',
    })

    expect(keystore.keystore).toBeDefined()
    expect(keystore.keystore.version).toBe(1)
    expect(keystore.keystore.crypto).toBeDefined()
    expect(keystore.subdomain).toBe('myagent')
  })

  it('should generate mnemonic and derive wallet', () => {
    // Step 1: Generate mnemonic
    const mnemonic = generateMnemonicTool.execute({ word_count: 12 })

    expect(mnemonic.mnemonic.split(' ')).toHaveLength(12)
    expect(mnemonic.warning).toContain('SECURITY')

    // Step 2: Derive wallet
    const wallet = walletFromMnemonicTool.execute({
      mnemonic: mnemonic.mnemonic,
      index: 0,
    })

    expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(wallet.session).toBe('saved')

    // Step 3: Derive another wallet from same mnemonic
    const wallet2 = walletFromMnemonicTool.execute({
      mnemonic: mnemonic.mnemonic,
      index: 1,
    })

    // Should be different address
    expect(wallet2.address).not.toBe(wallet.address)
  })
})

describe('E2E: Tool Output Format', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('all tools should return JSON-serializable output', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ bounties: [], skills: [], total: 0 }),
    })

    const outputs = [
      generateKeypairTool.execute(),
      generateMnemonicTool.execute({}),
      analyzeKnowledgeTool.execute({ paths: ['.'] }),
      await matchBountiesTool.execute({ knowledge_items: [] }),
      await generateCardTool.execute({}),
      await initiateExchangeTool.execute({
        name: 'test',
        description: 'test',
        price_wei: '1000000000000000000',
      }),
    ]

    outputs.forEach((output) => {
      // Should not throw
      const serialized = JSON.stringify(output)
      const parsed = JSON.parse(serialized)
      expect(parsed).toBeDefined()
    })
  })

  it('error responses should be structured', async () => {
    // Test error handling
    const errorResult = await initiateExchangeTool.execute({
      name: 'incomplete', // Missing required fields
    })

    expect(errorResult).toHaveProperty('error')
    expect(typeof errorResult.error).toBe('string')
  })
})
