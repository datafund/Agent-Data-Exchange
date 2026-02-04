/**
 * Passthrough tools to mcp.fairdrop.xyz
 */
import { callRemoteTool } from '../proxy.js'
import { session } from '../session.js'

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

export const statusTool = {
  name: 'df_status',
  description: 'Show current identity, ENS registration status, backup status, and connection info.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
  async execute() {
    // Session info
    const hasIdentity = !!session.privateKey
    const sessionInfo: Record<string, unknown> = {
      loaded: hasIdentity,
      address: session.address || null,
      subdomain: session.subdomain || null,
      stampBatchId: session.stampBatchId || null,
    }

    // ENS lookup (if subdomain is set)
    let ensInfo: Record<string, unknown> | null = null
    if (session.subdomain) {
      try {
        const apiUrl = process.env.FDS_ID_API_URL || 'https://id.fairdatasociety.org'
        const response = await fetch(`${apiUrl}/api/ens/lookup/${session.subdomain}`)
        if (response.ok) {
          const data = await response.json() as {
            exists: boolean
            ensName?: string
            publicKey?: string | null
            backupHash?: string | null
          }
          ensInfo = {
            registered: data.exists,
            ensName: data.ensName,
            publicKey: data.publicKey ? 'set' : 'missing',
            backup: data.backupHash ? 'set' : 'not set',
          }
        }
      } catch {
        ensInfo = { error: 'ENS lookup failed' }
      }
    }

    // Fairdrop connection
    let fairdropConnection: Record<string, unknown> | null = null
    try {
      const result = await callRemoteTool('fairdrop_status', {}) as {
        connection?: unknown
        stamp?: unknown
      }
      fairdropConnection = {
        connected: true,
        connection: result.connection,
        stamp: result.stamp,
      }
    } catch {
      fairdropConnection = { connected: false }
    }

    // Next steps
    const nextSteps: string[] = []
    if (!hasIdentity) {
      nextSteps.push('df_generate_keypair — create a new identity')
      nextSteps.push('df_restore_from_ens — restore from ENS backup')
      nextSteps.push('df_decrypt_keystore — restore from keystore file')
    } else if (!session.subdomain) {
      nextSteps.push('df_register_account — register ENS subdomain')
    } else if (ensInfo && ensInfo.backup === 'not set') {
      nextSteps.push('df_backup_keystore — back up your keystore to Swarm + ENS')
    } else {
      nextSteps.push('df_sell — list content for sale')
      nextSteps.push('df_buy — purchase a skill')
    }

    return {
      session: sessionInfo,
      ens: ensInfo,
      fairdrop: fairdropConnection,
      next_steps: nextSteps,
    }
  },
}

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
