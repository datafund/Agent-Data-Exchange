import { session } from '../session.js'

export const saveSessionTool = {
  name: 'df_save_session',
  description: 'Persist current session (keys, escrow state) to ~/.datafund/sessions/ encrypted with a password. Survives restarts.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      password: {
        type: 'string',
        description: 'Password to encrypt the session file',
      },
    },
    required: ['password'],
  },
  async execute(args: { password: string }) {
    const filePath = await session.save(args.password)
    return {
      success: true,
      path: filePath,
      note: 'Session saved. Use df_load_session to restore after restart.',
    }
  },
}

export const loadSessionTool = {
  name: 'df_load_session',
  description: 'Restore a previously saved session from ~/.datafund/sessions/.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      label: {
        type: 'string',
        description: 'Session label (subdomain or address used when saving)',
      },
      password: {
        type: 'string',
        description: 'Password used to encrypt the session',
      },
    },
    required: ['label', 'password'],
  },
  async execute(args: { label: string; password: string }) {
    await session.load(args.label, args.password)
    const data = session.toJSON()
    return {
      success: true,
      address: data.address,
      subdomain: data.subdomain,
      escrowCount: Object.keys(data.escrows).length,
      note: 'Session restored. All tools will use the restored identity.',
    }
  },
}
