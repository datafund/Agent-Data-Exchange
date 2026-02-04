/**
 * MCP proxy client to mcp.fairdrop.xyz
 *
 * Uses the MCP SDK's StreamableHTTPClientTransport (SSE) to call tools
 * on the remote Fairdrop MCP server. Lazy-connects on first use.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const DEFAULT_REMOTE_URL = 'https://mcp.fairdrop.xyz'

let client: Client | null = null
let connecting: Promise<Client> | null = null

function resetClient() {
  client = null
  connecting = null
}

async function getClient(): Promise<Client> {
  if (client) return client
  if (connecting) return connecting

  connecting = (async () => {
    const url = process.env.FAIRDROP_MCP_URL || DEFAULT_REMOTE_URL
    const transport = new StreamableHTTPClientTransport(new URL(url))

    const c = new Client(
      { name: 'agent-data-exchange', version: '0.1.0' },
      { capabilities: {} }
    )

    await c.connect(transport)
    client = c
    connecting = null
    return c
  })()

  return connecting
}

export async function callRemoteTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  let c = await getClient()

  let result
  try {
    result = await c.callTool({ name: toolName, arguments: args })
  } catch (err: any) {
    // Retry once on connection errors (e.g. server restarted)
    if (err?.message?.includes('not initialized') || err?.message?.includes('ECONNREFUSED') || err?.message?.includes('fetch failed')) {
      resetClient()
      c = await getClient()
      result = await c.callTool({ name: toolName, arguments: args })
    } else {
      throw err
    }
  }

  // Check for MCP-level errors that indicate stale connection
  if (result.isError) {
    const errorText = result.content && Array.isArray(result.content)
      ? (result.content.find((b: any) => b.type === 'text') as any)?.text
      : undefined
    const errorMsg = errorText || ''

    // Retry once on "not initialized" MCP errors
    if (errorMsg.includes('not initialized')) {
      resetClient()
      c = await getClient()
      result = await c.callTool({ name: toolName, arguments: args })
    }
  }

  // Check for errors
  if (result.isError) {
    const errorText = result.content && Array.isArray(result.content)
      ? (result.content.find((b: any) => b.type === 'text') as any)?.text
      : undefined
    throw new Error(`Remote tool ${toolName} failed: ${errorText || 'Unknown error'}`)
  }

  // Extract text content from MCP response
  if (result.content && Array.isArray(result.content)) {
    const textBlock = result.content.find(
      (block: any) => block.type === 'text'
    ) as { type: string; text: string } | undefined
    if (textBlock) {
      try {
        return JSON.parse(textBlock.text)
      } catch {
        return textBlock.text
      }
    }
  }

  return result
}
