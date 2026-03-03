// Identity (5 tools)
export {
  generateKeypairTool,
  createKeystoreTool,
  decryptKeystoreTool,
  generateMnemonicTool,
  walletFromMnemonicTool,
} from './identity.js'

// Signing (1 tool)
export { signTransactionTool } from './signing.js'

// Registration (1 tool)
export { registerAccountTool } from './register.js'

// ENS (1 tool)
export { ensResolveTool } from './ens.js'

// Marketplace (4 tools - Phase 1)
export {
  browseSkillsTool,
  publishSkillTool,
  checkReputationTool,
  skillDetailsTool,
} from './marketplace.js'

// Marketplace (5 tools - Phase 2)
export {
  searchBountiesTool,
  postBountyTool,
  watchCategoryTool,
  suggestPriceTool,
  marketSummaryTool,
} from './marketplace.js'

// Composite workflows (5 tools)
export { sellTool } from './sell.js'
export { buyTool } from './buy.js'
export { buyX402Tool } from './buy-x402.js'
export { releaseKeyTool } from './release.js'
export { claimTool } from './claim.js'
export { downloadContentTool, downloadFreeTool } from './download.js'

// Polling (2 tools)
export { waitForStateTool, myEscrowsTool } from './polling.js'

// Session persistence (2 tools)
export { saveSessionTool, loadSessionTool } from './session-tools.js'

// Proxy to mcp.fairdrop.xyz (7 tools)
export {
  statusTool,
  lookupTool,
  uploadTool,
  downloadTool,
  assignStampTool,
  escrowStatusTool,
  sendAnonymousTool,
} from './proxy-tools.js'

// Discovery (2 tools - Phase 2)
export {
  analyzeKnowledgeTool,
  autoSuggestTool,
} from './discovery.js'

// Matching (1 tool - Phase 2)
export { matchBountiesTool } from './matching.js'

// Network (2 tools - Phase 2)
export {
  generateCardTool,
  initiateExchangeTool,
} from './network.js'
