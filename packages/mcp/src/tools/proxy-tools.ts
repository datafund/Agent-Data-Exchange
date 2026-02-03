/**
 * Passthrough tools to mcp.fairdrop.xyz
 */
import { callRemoteTool } from '../proxy.js'

function proxyTool(
  name: string,
  remoteName: string,
  description: string,
  inputSchema: Record<string, unknown>
) {
  return {
    name,
    description,
    inputSchema,
    async execute(args: Record<string, unknown>) {
      return await callRemoteTool(remoteName, args)
    },
  }
}

export const statusTool = proxyTool(
  'df_status',
  'fairdrop_status',
  'Check connection status and get setup guide for the Datafund Skill Exchange.',
  { type: 'object' as const, properties: {}, required: [] as string[] }
)

export const lookupTool = proxyTool(
  'df_lookup',
  'fairdrop_lookup',
  'Resolve ENS name to address and public key via Swarm.',
  {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'ENS name or subdomain' },
    },
    required: ['name'],
  }
)

export const uploadTool = proxyTool(
  'df_upload',
  'fairdrop_upload',
  'Upload content to Swarm. Provide content_base64 or file_path.',
  {
    type: 'object' as const,
    properties: {
      content_base64: { type: 'string', description: 'Base64-encoded content' },
      file_path: { type: 'string', description: 'Path to file' },
      encrypt: { type: 'boolean', description: 'Encrypt the upload' },
    },
    required: [] as string[],
  }
)

export const downloadTool = proxyTool(
  'df_download',
  'fairdrop_download',
  'Download content from Swarm by reference.',
  {
    type: 'object' as const,
    properties: {
      reference: { type: 'string', description: 'Swarm reference (64 hex chars)' },
      output_path: { type: 'string', description: 'Local path to save file' },
    },
    required: ['reference', 'output_path'],
  }
)

export const assignStampTool = proxyTool(
  'df_assign_stamp',
  'fairdrop_assign_stamp',
  'Assign a postage stamp batch for Swarm uploads.',
  {
    type: 'object' as const,
    properties: {
      batch_id: { type: 'string', description: 'Postage stamp batch ID' },
    },
    required: ['batch_id'],
  }
)

export const escrowStatusTool = proxyTool(
  'df_escrow_status',
  'fairdrop_escrow_status',
  'Get detailed escrow status and audit trail.',
  {
    type: 'object' as const,
    properties: {
      escrow_id: { type: 'string', description: 'Escrow ID' },
    },
    required: ['escrow_id'],
  }
)

export const sendAnonymousTool = proxyTool(
  'df_send_anonymous',
  'fairdrop_send_anonymous',
  'Send encrypted content anonymously to a recipient.',
  {
    type: 'object' as const,
    properties: {
      recipient_pubkey: { type: 'string', description: 'Recipient public key (33 bytes hex)' },
      content_base64: { type: 'string', description: 'Base64-encoded content' },
      file_path: { type: 'string', description: 'Path to file' },
      swarm_reference: { type: 'string', description: 'Existing Swarm reference' },
    },
    required: ['recipient_pubkey'],
  }
)
