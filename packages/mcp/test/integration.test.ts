import { describe, it, expect } from 'vitest'

// Import all tools to verify they're properly exported
import {
  // Phase 1 tools
  generateKeypairTool,
  createKeystoreTool,
  decryptKeystoreTool,
  generateMnemonicTool,
  walletFromMnemonicTool,
  signTransactionTool,
  registerAccountTool,
  ensResolveTool,
  browseSkillsTool,
  publishSkillTool,
  checkReputationTool,
  skillDetailsTool,
  sellTool,
  buyTool,
  releaseKeyTool,
  claimTool,
  waitForStateTool,
  myEscrowsTool,
  saveSessionTool,
  loadSessionTool,
  statusTool,
  lookupTool,
  uploadTool,
  downloadTool,
  assignStampTool,
  escrowStatusTool,
  sendAnonymousTool,
  // Phase 2 tools
  analyzeKnowledgeTool,
  autoSuggestTool,
  searchBountiesTool,
  postBountyTool,
  watchCategoryTool,
  suggestPriceTool,
  marketSummaryTool,
  matchBountiesTool,
  generateCardTool,
  initiateExchangeTool,
} from '../src/tools/index.js'

describe('Tool Exports', () => {
  it('should export all Phase 1 tools (27 total)', () => {
    const phase1Tools = [
      generateKeypairTool,
      createKeystoreTool,
      decryptKeystoreTool,
      generateMnemonicTool,
      walletFromMnemonicTool,
      signTransactionTool,
      registerAccountTool,
      ensResolveTool,
      browseSkillsTool,
      publishSkillTool,
      checkReputationTool,
      skillDetailsTool,
      sellTool,
      buyTool,
      releaseKeyTool,
      claimTool,
      waitForStateTool,
      myEscrowsTool,
      saveSessionTool,
      loadSessionTool,
      statusTool,
      lookupTool,
      uploadTool,
      downloadTool,
      assignStampTool,
      escrowStatusTool,
      sendAnonymousTool,
    ]

    expect(phase1Tools.length).toBe(27)
    phase1Tools.forEach((tool) => {
      expect(tool).toBeDefined()
      expect(tool.name).toBeDefined()
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.execute).toBeDefined()
    })
  })

  it('should export all Phase 2 tools (10 total)', () => {
    const phase2Tools = [
      analyzeKnowledgeTool,
      autoSuggestTool,
      searchBountiesTool,
      postBountyTool,
      watchCategoryTool,
      suggestPriceTool,
      marketSummaryTool,
      matchBountiesTool,
      generateCardTool,
      initiateExchangeTool,
    ]

    expect(phase2Tools.length).toBe(10)
    phase2Tools.forEach((tool) => {
      expect(tool).toBeDefined()
      expect(tool.name).toBeDefined()
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.execute).toBeDefined()
    })
  })

  it('all tools should have df_ prefix naming convention', () => {
    const allTools = [
      generateKeypairTool,
      createKeystoreTool,
      decryptKeystoreTool,
      generateMnemonicTool,
      walletFromMnemonicTool,
      signTransactionTool,
      registerAccountTool,
      ensResolveTool,
      browseSkillsTool,
      publishSkillTool,
      checkReputationTool,
      skillDetailsTool,
      sellTool,
      buyTool,
      releaseKeyTool,
      claimTool,
      waitForStateTool,
      myEscrowsTool,
      saveSessionTool,
      loadSessionTool,
      statusTool,
      lookupTool,
      uploadTool,
      downloadTool,
      assignStampTool,
      escrowStatusTool,
      sendAnonymousTool,
      analyzeKnowledgeTool,
      autoSuggestTool,
      searchBountiesTool,
      postBountyTool,
      watchCategoryTool,
      suggestPriceTool,
      marketSummaryTool,
      matchBountiesTool,
      generateCardTool,
      initiateExchangeTool,
    ]

    allTools.forEach((tool) => {
      expect(tool.name.startsWith('df_')).toBe(true)
    })
  })

  it('all tools should have valid JSON Schema for inputSchema', () => {
    const allTools = [
      generateKeypairTool,
      analyzeKnowledgeTool,
      autoSuggestTool,
      searchBountiesTool,
      matchBountiesTool,
      generateCardTool,
      initiateExchangeTool,
      marketSummaryTool,
    ]

    allTools.forEach((tool) => {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties).toBeDefined()
      expect(Array.isArray(tool.inputSchema.required)).toBe(true)
    })
  })
})

describe('Tool Functionality Verification', () => {
  it('df_generate_keypair should generate valid keypair', () => {
    const result = generateKeypairTool.execute()

    expect(result).toHaveProperty('privateKey')
    expect(result).toHaveProperty('publicKey')
    expect(result).toHaveProperty('address')
    expect(result.privateKey.length).toBe(64) // 32 bytes hex
    expect(result.address.startsWith('0x')).toBe(true)
  })

  it('df_generate_mnemonic should generate valid mnemonic', () => {
    const result = generateMnemonicTool.execute({ word_count: 12 })

    expect(result).toHaveProperty('mnemonic')
    expect(result.mnemonic.split(' ').length).toBe(12)
  })

  it('df_generate_mnemonic should support 24 words', () => {
    const result = generateMnemonicTool.execute({ word_count: 24 })

    expect(result.mnemonic.split(' ').length).toBe(24)
  })

  it('df_wallet_from_mnemonic should derive wallet from mnemonic', () => {
    const mnemonic = generateMnemonicTool.execute({})
    const wallet = walletFromMnemonicTool.execute({ mnemonic: mnemonic.mnemonic })

    expect(wallet).toHaveProperty('address')
    expect(wallet.address.startsWith('0x')).toBe(true)
    expect(wallet.session).toBe('saved')
  })

  it('df_create_keystore should encrypt private key', async () => {
    // First generate a keypair
    generateKeypairTool.execute()

    const result = await createKeystoreTool.execute({
      subdomain: 'testuser',
      password: 'testpassword123',
    })

    expect(result).toHaveProperty('keystore')
    expect(result.keystore).toHaveProperty('crypto')
    expect(result.keystore).toHaveProperty('version')
  })

  it('df_analyze_knowledge should scan and categorize files', () => {
    const result = analyzeKnowledgeTool.execute({ paths: ['.'] })

    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('privacy_note')
  })
})

describe('Phase 2 Tool Naming', () => {
  it('discovery tools should have appropriate names', () => {
    expect(analyzeKnowledgeTool.name).toBe('df_analyze_knowledge')
    expect(autoSuggestTool.name).toBe('df_auto_suggest')
  })

  it('marketplace tools should have appropriate names', () => {
    expect(searchBountiesTool.name).toBe('df_search_bounties')
    expect(postBountyTool.name).toBe('df_post_bounty')
    expect(watchCategoryTool.name).toBe('df_watch_category')
    expect(suggestPriceTool.name).toBe('df_suggest_price')
    expect(marketSummaryTool.name).toBe('df_market_summary')
  })

  it('matching tool should have appropriate name', () => {
    expect(matchBountiesTool.name).toBe('df_match_bounties')
  })

  it('network tools should have appropriate names', () => {
    expect(generateCardTool.name).toBe('df_generate_card')
    expect(initiateExchangeTool.name).toBe('df_initiate_exchange')
  })
})
