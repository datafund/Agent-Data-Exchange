import { callRemoteTool } from '../proxy.js'
import { session } from '../session.js'

export const waitForStateTool = {
  name: 'df_wait_for_state',
  description: 'Poll an escrow until it reaches a target state or times out.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      escrow_id: {
        type: 'string',
        description: 'Escrow ID to watch',
      },
      target_state: {
        type: 'string',
        description: 'Target state: Created, Funded, KeyCommitted, Released, Claimed, Expired, Disputed',
      },
      timeout_seconds: {
        type: 'number',
        description: 'Max wait time in seconds (default: 300)',
      },
      poll_interval_seconds: {
        type: 'number',
        description: 'Poll interval in seconds (default: 15)',
      },
    },
    required: ['escrow_id', 'target_state'],
  },
  async execute(args: {
    escrow_id: string
    target_state: string
    timeout_seconds?: number
    poll_interval_seconds?: number
  }) {
    const timeout = (args.timeout_seconds || 300) * 1000
    const interval = (args.poll_interval_seconds || 15) * 1000
    const start = Date.now()

    while (Date.now() - start < timeout) {
      const status = await callRemoteTool('fairdrop_escrow_status', {
        escrow_id: args.escrow_id,
      }) as { state: string; [key: string]: unknown }

      if (status.state === args.target_state) {
        return {
          reached: true,
          state: status.state,
          escrowId: args.escrow_id,
          elapsed_seconds: Math.round((Date.now() - start) / 1000),
          details: status,
        }
      }

      await new Promise(resolve => setTimeout(resolve, interval))
    }

    return {
      reached: false,
      escrowId: args.escrow_id,
      timeout: true,
      elapsed_seconds: Math.round((Date.now() - start) / 1000),
    }
  },
}

export const myEscrowsTool = {
  name: 'df_my_escrows',
  description: 'List my escrows by role and state.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      role: {
        type: 'string',
        description: 'Filter by role: seller, buyer, all (default: all)',
      },
      state: {
        type: 'string',
        description: 'Filter by state',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 10)',
      },
    },
    required: [] as string[],
  },
  async execute(args: { role?: string; state?: string; limit?: number }) {
    const address = session.requireAddress()

    return await callRemoteTool('fairdrop_escrow_list', {
      address,
      role: args.role || 'all',
      state: args.state,
      limit: args.limit || 10,
    })
  },
}
