import { Wallet, FDSKeystoreManager, HDWallet, encryptBackup, decryptBackup } from '@fairdatasociety/fds-id'
import type { FDSAccount, FDSKeystore } from '@fairdatasociety/fds-id'
import { bytesToHex } from '@noble/hashes/utils'
import { session } from '../session.js'
import { callRemoteTool } from '../proxy.js'

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

export const backupKeystoreTool = {
  name: 'df_backup_keystore',
  description: `Backup keystore to Swarm and set encrypted reference in ENS.

Complete account backup flow:
1. Upload keystore JSON to Swarm
2. Encrypt the Swarm hash with password
3. Set encrypted hash in ENS via /api/ens/backup-hash

Requires: ENS subdomain already registered, stamp assigned.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      keystore: {
        type: 'object',
        description: 'FDS keystore JSON (from df_create_keystore)',
      },
      password: {
        type: 'string',
        description: 'Keystore password (used to encrypt the backup reference)',
      },
      subdomain: {
        type: 'string',
        description: 'ENS subdomain (uses session if omitted)',
      },
    },
    required: ['keystore', 'password'],
  },
  async execute(args: { keystore: unknown; password: string; subdomain?: string }) {
    const subdomain = args.subdomain || session.subdomain
    const publicKey = session.publicKey

    if (!subdomain) {
      throw new Error('No subdomain provided and none in session. Use df_register_account first.')
    }
    if (!publicKey) {
      throw new Error('No public key in session. Use df_generate_keypair first.')
    }

    // Step 1: Upload keystore to Swarm
    const keystoreJson = JSON.stringify(args.keystore)
    const keystoreBase64 = Buffer.from(keystoreJson).toString('base64')

    const uploadResult = await callRemoteTool('fairdrop_upload', {
      content_base64: keystoreBase64,
      encrypt: false, // Keystore is already encrypted
    }) as { reference?: string; error?: string }

    if (!uploadResult.reference) {
      throw new Error(`Swarm upload failed: ${uploadResult.error || 'No reference returned'}`)
    }

    const swarmHash = uploadResult.reference

    // Step 2: Encrypt the Swarm hash (using fds-id standard encryption)
    const encryptedHash = encryptBackup(swarmHash, args.password, subdomain)

    // Step 3: Set backup hash in ENS via API
    const apiUrl = process.env.FDS_ID_API_URL || 'https://id.fairdatasociety.org'
    const response = await fetch(`${apiUrl}/api/ens/backup-hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: subdomain,
        swarmHash: encryptedHash,
        publicKey: publicKey.startsWith('0x') ? publicKey : `0x${publicKey}`,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { error?: string }
      // Return partial success - Swarm upload worked
      return {
        success: false,
        swarmHash,
        encryptedHash,
        error: `Swarm upload succeeded but ENS update failed: ${err.error || response.statusText}`,
        manual_recovery: `Save this swarmHash: ${swarmHash}. You can manually set the backup later.`,
      }
    }

    const ensResult = await response.json() as { txHash?: string }

    return {
      success: true,
      swarmHash,
      encryptedHash,
      ensTxHash: ensResult.txHash,
      ensName: `${subdomain}.fairdata.eth`,
      note: 'Keystore backed up to Swarm and ENS updated. Use df_restore_from_ens to recover.',
    }
  },
}

export const restoreFromEnsTool = {
  name: 'df_restore_from_ens',
  description: `Restore account from ENS backup.

Looks up encrypted Swarm reference in ENS, decrypts it, downloads keystore from Swarm, and restores to session.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      subdomain: {
        type: 'string',
        description: 'ENS subdomain to restore from',
      },
      password: {
        type: 'string',
        description: 'Password to decrypt backup reference and keystore',
      },
    },
    required: ['subdomain', 'password'],
  },
  async execute(args: { subdomain: string; password: string }) {
    const apiUrl = process.env.FDS_ID_API_URL || 'https://id.fairdatasociety.org'

    // Step 1: Look up backup hash from ENS
    const lookupResponse = await fetch(`${apiUrl}/api/ens/lookup/${args.subdomain}`)
    if (!lookupResponse.ok) {
      throw new Error(`ENS lookup failed: ${lookupResponse.statusText}`)
    }

    const lookupData = await lookupResponse.json() as {
      exists: boolean
      backupHash?: string | null
      publicKey?: string | null
    }

    if (!lookupData.exists) {
      throw new Error(`Subdomain ${args.subdomain}.fairdata.eth not found`)
    }

    if (!lookupData.backupHash) {
      throw new Error(`No backup found for ${args.subdomain}.fairdata.eth`)
    }

    // Step 2: Decrypt the Swarm reference (using fds-id standard encryption)
    let swarmHash: string
    try {
      swarmHash = decryptBackup(lookupData.backupHash, args.password, args.subdomain)
    } catch {
      throw new Error('Failed to decrypt backup reference. Check your password.')
    }

    // Step 3: Download keystore from Swarm
    const downloadResult = await callRemoteTool('fairdrop_download', {
      reference: swarmHash,
      output_path: '/dev/null', // We just want the content
    }) as { content_base64?: string; error?: string }

    if (!downloadResult.content_base64) {
      throw new Error(`Swarm download failed: ${downloadResult.error || 'No content returned'}`)
    }

    const keystoreJson = Buffer.from(downloadResult.content_base64, 'base64').toString('utf-8')
    const keystore = JSON.parse(keystoreJson) as FDSKeystore

    // Step 4: Decrypt keystore
    const account = await FDSKeystoreManager.decrypt(keystore, args.password)

    // Step 5: Restore to session
    session.setIdentity(account.privateKey, account.publicKey, account.walletAddress)
    if (account.subdomain) session.setSubdomain(account.subdomain)

    return {
      success: true,
      privateKey: account.privateKey,
      publicKey: account.publicKey,
      address: account.walletAddress,
      subdomain: account.subdomain,
      session: 'restored',
    }
  },
}
