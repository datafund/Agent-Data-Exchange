import { Wallet, FDSKeystoreManager, HDWallet } from '@fairdatasociety/fds-id'
import type { FDSAccount, FDSKeystore } from '@fairdatasociety/fds-id'
import { bytesToHex } from '@noble/hashes/utils'
import { session } from '../session.js'

export const generateKeypairTool = {
  name: 'df_generate_keypair',
  description: 'Generate a new secp256k1 keypair. Saves to session automatically. Returns privateKey, publicKey, address.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
  execute() {
    const wallet = Wallet.create()
    const privateKey = bytesToHex(wallet.privateKey)
    const publicKey = bytesToHex(wallet.publicKey)

    session.setIdentity(privateKey, publicKey, wallet.address)

    return {
      privateKey,
      publicKey,
      address: wallet.address,
      session: 'saved',
      next_steps: [
        'df_create_keystore — encrypt and back up your key',
        'df_register_account — register ENS subdomain + get stamp',
        'df_sell — list content for sale on the marketplace',
      ],
    }
  },
}

export const createKeystoreTool = {
  name: 'df_create_keystore',
  description: 'Encrypt private key into FDS keystore JSON. Uses session private key if not provided.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      private_key: {
        type: 'string',
        description: 'Private key hex (uses session key if omitted)',
      },
      subdomain: {
        type: 'string',
        description: 'ENS subdomain label',
      },
      password: {
        type: 'string',
        description: 'Encryption password (min 6 chars)',
      },
    },
    required: ['subdomain', 'password'],
  },
  async execute(args: { private_key?: string; subdomain: string; password: string }) {
    const privateKeyHex = (args.private_key || session.requirePrivateKey()).replace(/^0x/, '')
    const wallet = Wallet.fromPrivateKey(privateKeyHex)
    const publicKeyHex = bytesToHex(wallet.publicKey)

    const account: FDSAccount = {
      subdomain: args.subdomain,
      publicKey: publicKeyHex,
      privateKey: privateKeyHex,
      walletAddress: wallet.address,
      created: Date.now(),
    }

    const keystore = await FDSKeystoreManager.encrypt(account, args.password)
    session.setSubdomain(args.subdomain)

    return {
      keystore,
      address: wallet.address,
      subdomain: args.subdomain,
      note: 'Store this keystore JSON securely. Use df_decrypt_keystore to recover.',
    }
  },
}

export const decryptKeystoreTool = {
  name: 'df_decrypt_keystore',
  description: 'Decrypt FDS keystore to recover private key. Saves to session.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      keystore: {
        type: 'object',
        description: 'FDS keystore JSON',
      },
      password: {
        type: 'string',
        description: 'Keystore password',
      },
    },
    required: ['keystore', 'password'],
  },
  async execute(args: { keystore: unknown; password: string }) {
    const account = await FDSKeystoreManager.decrypt(args.keystore as FDSKeystore, args.password)

    session.setIdentity(account.privateKey, account.publicKey, account.walletAddress)
    if (account.subdomain) session.setSubdomain(account.subdomain)

    return {
      privateKey: account.privateKey,
      publicKey: account.publicKey,
      address: account.walletAddress,
      subdomain: account.subdomain,
      session: 'restored',
    }
  },
}

export const generateMnemonicTool = {
  name: 'df_generate_mnemonic',
  description: 'Generate a BIP39 mnemonic phrase (12 or 24 words).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      word_count: {
        type: 'number',
        description: 'Number of words: 12 or 24 (default: 12)',
      },
    },
    required: [] as string[],
  },
  execute(args: { word_count?: number }) {
    const wordCount = (args.word_count === 24 ? 24 : 12) as 12 | 24
    const hdWallet = HDWallet.create({ wordCount })

    return {
      mnemonic: hdWallet.mnemonic,
      word_count: wordCount,
      warning: 'SECURITY: Store this mnemonic securely. Anyone with it can derive your keys.',
      next_steps: ['df_wallet_from_mnemonic — derive a wallet from this mnemonic'],
    }
  },
}

export const walletFromMnemonicTool = {
  name: 'df_wallet_from_mnemonic',
  description: 'Derive wallet from BIP39 mnemonic. Saves to session.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      mnemonic: {
        type: 'string',
        description: 'BIP39 mnemonic phrase',
      },
      index: {
        type: 'number',
        description: 'Derivation index (default: 0)',
      },
    },
    required: ['mnemonic'],
  },
  execute(args: { mnemonic: string; index?: number }) {
    const hdWallet = HDWallet.fromMnemonic(args.mnemonic)
    const wallet = hdWallet.deriveAccount(args.index || 0)
    const privateKey = bytesToHex(wallet.privateKey)
    const publicKey = bytesToHex(wallet.publicKey)

    session.setIdentity(privateKey, publicKey, wallet.address)

    return {
      privateKey,
      publicKey,
      address: wallet.address,
      session: 'saved',
    }
  },
}
