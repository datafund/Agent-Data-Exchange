#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
  // Identity (5)
  generateKeypairTool,
  createKeystoreTool,
  decryptKeystoreTool,
  generateMnemonicTool,
  walletFromMnemonicTool,
  // Signing (1)
  signTransactionTool,
  // Registration (1)
  registerAccountTool,
  // ENS (1)
  ensResolveTool,
  // Marketplace - Phase 1 (4)
  browseSkillsTool,
  publishSkillTool,
  checkReputationTool,
  skillDetailsTool,
  // Marketplace - Phase 2 (5)
  searchBountiesTool,
  postBountyTool,
  watchCategoryTool,
  suggestPriceTool,
  marketSummaryTool,
  // Composite (5)
  sellTool,
  buyTool,
  releaseKeyTool,
  claimTool,
  downloadContentTool,
  // Polling (2)
  waitForStateTool,
  myEscrowsTool,
  // Session (2)
  saveSessionTool,
  loadSessionTool,
  // Proxy (7)
  statusTool,
  lookupTool,
  uploadTool,
  downloadTool,
  assignStampTool,
  escrowStatusTool,
  sendAnonymousTool,
  // Discovery - Phase 2 (2)
  analyzeKnowledgeTool,
  autoSuggestTool,
  // Matching - Phase 2 (1)
  matchBountiesTool,
  // Network - Phase 2 (2)
  generateCardTool,
  initiateExchangeTool,
} from './tools/index.js'

import { guideResource, statusResource } from './resources/index.js'

const tools = [
  // === Phase 1: Core Exchange (27 tools) ===

  // Local crypto (6)
  generateKeypairTool,
  createKeystoreTool,
  decryptKeystoreTool,
  generateMnemonicTool,
  walletFromMnemonicTool,
  signTransactionTool,
  // Local → remote HTTP (2)
  registerAccountTool,
  ensResolveTool,
  // Marketplace (4)
  browseSkillsTool,
  publishSkillTool,
  checkReputationTool,
  skillDetailsTool,
  // Composite workflows (5)
  sellTool,
  buyTool,
  releaseKeyTool,
  claimTool,
  downloadContentTool,
  // State & polling (2)
  waitForStateTool,
  myEscrowsTool,
  // Session persistence (2)
  saveSessionTool,
  loadSessionTool,
  // Proxy to mcp.fairdrop.xyz (7)
  statusTool,
  lookupTool,
  uploadTool,
  downloadTool,
  assignStampTool,
  escrowStatusTool,
  sendAnonymousTool,

  // === Phase 2: Growth & Facilitation (10 tools) ===

  // Discovery (2) - local file scanning, no content leaves machine
  analyzeKnowledgeTool,
  autoSuggestTool,
  // Marketplace extensions (5)
  searchBountiesTool,
  postBountyTool,
  watchCategoryTool,
  suggestPriceTool,
  marketSummaryTool,
  // Matching (1) - local tag/category comparison
  matchBountiesTool,
  // Network (2) - capability cards and exchange initiation
  generateCardTool,
  initiateExchangeTool,
]

const resources = [guideResource, statusResource]

const server = new Server(
  {
    name: 'agent-data-exchange',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
)

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}))

// Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const tool = tools.find((t) => t.name === name)

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }

  try {
    const result = await tool.execute(args as any)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
      isError: true,
    }
  }
})

// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: resources.map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  })),
}))

// Read resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params
  const resource = resources.find((r) => r.uri === uri)

  if (!resource) {
    throw new Error(`Unknown resource: ${uri}`)
  }

  const content = resource.read()
  return {
    contents: [
      {
        uri,
        mimeType: resource.mimeType,
        text: typeof content === 'string' ? content : JSON.stringify(content),
      },
    ],
  }
})

// Start
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('agent-data-exchange MCP server running on stdio')
}

main().catch((error) => {
  console.error('Failed to start:', error)
  process.exit(1)
})
