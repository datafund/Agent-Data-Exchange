import { FDSKeystoreManager } from '@fairdatasociety/fds-id'
import type { FDSAccount, FDSKeystore } from '@fairdatasociety/fds-id'
import * as fs from 'fs'
import * as path from 'path'

export interface EscrowState {
  encryptionKey?: string
  serializedEncryptedKey?: string
  commitmentSalt?: string
  role: 'seller' | 'buyer'
}

export interface SessionData {
  privateKey?: string
  publicKey?: string
  address?: string
  subdomain?: string
  stampBatchId?: string
  escrows: Record<string, EscrowState>
}

const SESSIONS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.datafund',
  'sessions'
)

export class Session {
  private data: SessionData = { escrows: {} }

  get privateKey() { return this.data.privateKey }
  get publicKey() { return this.data.publicKey }
  get address() { return this.data.address }
  get subdomain() { return this.data.subdomain }
  get stampBatchId() { return this.data.stampBatchId }

  setIdentity(privateKey: string, publicKey: string, address: string) {
    this.data.privateKey = privateKey
    this.data.publicKey = publicKey
    this.data.address = address
  }

  setPrivateKey(privateKey: string) {
    this.data.privateKey = privateKey
  }

  setPublicKey(publicKey: string) {
    this.data.publicKey = publicKey
  }

  setAddress(address: string) {
    this.data.address = address
  }

  setSubdomain(subdomain: string) {
    this.data.subdomain = subdomain
  }

  setStampBatchId(batchId: string) {
    this.data.stampBatchId = batchId
  }

  getEscrow(escrowId: string): EscrowState | undefined {
    return this.data.escrows[escrowId]
  }

  setEscrow(escrowId: string, state: EscrowState) {
    this.data.escrows[escrowId] = state
  }

  updateEscrow(escrowId: string, update: Partial<EscrowState>) {
    const existing = this.data.escrows[escrowId] || { role: 'seller' as const }
    this.data.escrows[escrowId] = { ...existing, ...update }
  }

  requirePrivateKey(): string {
    if (!this.data.privateKey) {
      throw new Error('No private key in session. Use df_generate_keypair, df_wallet_from_mnemonic, or df_decrypt_keystore first.')
    }
    return this.data.privateKey
  }

  requireAddress(): string {
    if (!this.data.address) {
      throw new Error('No address in session. Use df_generate_keypair first.')
    }
    return this.data.address
  }

  async save(password: string): Promise<string> {
    const label = this.data.subdomain || this.data.address || 'default'
    const account: FDSAccount = {
      subdomain: label,
      publicKey: this.data.publicKey || 'session',
      privateKey: JSON.stringify(this.data),
      walletAddress: this.data.address || '0x0000000000000000000000000000000000000000',
      created: Date.now(),
    }

    const keystore = await FDSKeystoreManager.encrypt(account, password)

    fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    const filePath = path.join(SESSIONS_DIR, `${label}.enc.json`)
    fs.writeFileSync(filePath, JSON.stringify(keystore, null, 2))
    return filePath
  }

  async load(label: string, password: string): Promise<void> {
    const filePath = path.join(SESSIONS_DIR, `${label}.enc.json`)
    if (!fs.existsSync(filePath)) {
      throw new Error(`Session file not found: ${filePath}`)
    }

    const keystore = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FDSKeystore
    const account = await FDSKeystoreManager.decrypt(keystore, password)
    const restored = JSON.parse(account.privateKey) as SessionData
    this.data = restored
  }

  toJSON(): SessionData {
    return { ...this.data }
  }
}

// Global singleton
export const session = new Session()
