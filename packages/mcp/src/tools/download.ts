import * as secp256k1 from '@noble/secp256k1'
import { sha256 } from '@noble/hashes/sha2.js'
import { createDecipheriv } from 'crypto'
import { writeFileSync } from 'fs'
import { keccak256 } from 'viem'
import { session } from '../session.js'
import { callRemoteTool } from '../proxy.js'

export const downloadContentTool = {
  name: 'df_download_content',
  description:
    'Composite: Download encrypted content from Swarm, decrypt the AES key using ECIES, verify content hash, decrypt content, and save to disk. Use after seller has released the key.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      escrow_id: {
        type: 'string',
        description: 'Escrow ID',
      },
      output_path: {
        type: 'string',
        description: 'Path to save the decrypted content',
      },
      encrypted_data_ref: {
        type: 'string',
        description: 'Swarm reference of encrypted content (optional, resolved from session or marketplace)',
      },
      skill_id: {
        type: 'string',
        description: 'Marketplace skill ID (optional, used to look up encrypted_data_ref)',
      },
    },
    required: ['escrow_id', 'output_path'],
  },
  async execute(args: {
    escrow_id: string
    output_path: string
    encrypted_data_ref?: string
    skill_id?: string
  }) {
    const privateKey = session.requirePrivateKey()
    const escrowId = args.escrow_id

    // Step 1: Resolve encryptedDataRef
    let encryptedDataRef = args.encrypted_data_ref

    if (!encryptedDataRef) {
      const escrowState = session.getEscrow(escrowId)
      encryptedDataRef = escrowState?.encryptedDataRef
    }

    if (!encryptedDataRef && args.skill_id) {
      const MARKETPLACE_URL = process.env.MARKETPLACE_URL || 'https://agents.datafund.io'
      const res = await fetch(`${MARKETPLACE_URL}/api/v1/skills/${args.skill_id}/purchase-info`)
      if (res.ok) {
        const info = (await res.json()) as { encrypted_data_ref?: string }
        encryptedDataRef = info.encrypted_data_ref || undefined
      }
    }

    if (!encryptedDataRef) {
      throw new Error(
        'Cannot resolve encrypted data reference. Provide encrypted_data_ref, skill_id, or ensure df_buy stored it in the session.',
      )
    }

    // Step 2: Read KeyRevealed event directly from blockchain (decentralized, no indexer)
    let encryptedKeyForBuyerHex: string | undefined

    for (let attempt = 0; attempt < 5; attempt++) {
      const revealResult = (await callRemoteTool('fairdrop_get_revealed_key', {
        escrow_id: escrowId,
      })) as { found: boolean; encryptedKeyForBuyer?: string; state?: string }

      if (revealResult.found && revealResult.encryptedKeyForBuyer) {
        encryptedKeyForBuyerHex = revealResult.encryptedKeyForBuyer
        break
      }

      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 3000))
      }
    }

    if (!encryptedKeyForBuyerHex) {
      throw new Error(
        'KeyRevealed event not found on-chain. The seller may not have released the key yet.',
      )
    }

    // Step 3: ECIES decrypt AES key locally
    const privKeyBytes = hexToBytes(privateKey)
    const serializedKey = hexToBytes(encryptedKeyForBuyerHex)

    // Deserialize: [33 ephemeralPubkey][12 IV][ciphertext+tag]
    if (serializedKey.length < 33 + 12 + 32) {
      throw new Error(
        `Invalid encrypted key: ${serializedKey.length} bytes, expected 93+. ` +
        `The seller may have revealed the raw key instead of the ECIES-encrypted key. ` +
        `This escrow cannot be securely decrypted — the raw key is visible to everyone on-chain.`,
      )
    }

    const ephemeralPubkey = serializedKey.slice(0, 33)
    const keyIv = serializedKey.slice(33, 33 + 12)
    const keyCiphertextWithTag = serializedKey.slice(33 + 12)

    // ECDH shared secret
    const sharedPoint = secp256k1.getSharedSecret(privKeyBytes, ephemeralPubkey)
    // sha256 of x-coordinate (skip prefix byte)
    const aesKeyForKeyDecrypt = sha256(sharedPoint.slice(1))

    // AES-GCM decrypt: split last 16 bytes as auth tag
    const keyAuthTag = keyCiphertextWithTag.slice(-16)
    const keyCiphertext = keyCiphertextWithTag.slice(0, -16)

    const keyDecipher = createDecipheriv('aes-256-gcm', aesKeyForKeyDecrypt, keyIv)
    keyDecipher.setAuthTag(keyAuthTag)
    const decryptedKeyPart1 = keyDecipher.update(keyCiphertext)
    const decryptedKeyPart2 = keyDecipher.final()
    const contentAesKey = Buffer.concat([decryptedKeyPart1, decryptedKeyPart2])

    if (contentAesKey.length !== 32) {
      throw new Error(`Decrypted AES key is ${contentAesKey.length} bytes, expected 32`)
    }

    // Step 4: Download encrypted blob from Swarm
    const downloadResult = (await callRemoteTool('fairdrop_download_bytes', {
      reference: encryptedDataRef,
    })) as { data_base64: string; size: number }

    const encryptedBlob = Buffer.from(downloadResult.data_base64, 'base64')

    // Step 5: Verify content hash matches on-chain
    const escrowInfo = (await callRemoteTool('fairdrop_escrow_status', {
      escrow_id: escrowId,
    })) as { contentHash: string }

    const computedHash = keccak256(new Uint8Array(encryptedBlob))
    const onChainHash = escrowInfo.contentHash.startsWith('0x')
      ? escrowInfo.contentHash
      : `0x${escrowInfo.contentHash}`

    if (computedHash.toLowerCase() !== onChainHash.toLowerCase()) {
      throw new Error(
        `Content hash mismatch! Computed: ${computedHash}, on-chain: ${onChainHash}. The content may have been tampered with.`,
      )
    }

    // Step 6: AES-GCM decrypt content
    // Blob format: [12 bytes IV][ciphertext+tag]
    if (encryptedBlob.length < 12 + 16) {
      throw new Error('Encrypted blob too short')
    }

    const contentIv = encryptedBlob.subarray(0, 12)
    const contentCiphertextWithTag = encryptedBlob.subarray(12)
    const contentAuthTag = contentCiphertextWithTag.subarray(-16)
    const contentCiphertext = contentCiphertextWithTag.subarray(0, -16)

    const contentDecipher = createDecipheriv('aes-256-gcm', contentAesKey, contentIv)
    contentDecipher.setAuthTag(contentAuthTag)
    const decryptedPart1 = contentDecipher.update(contentCiphertext)
    const decryptedPart2 = contentDecipher.final()
    const decryptedContent = Buffer.concat([decryptedPart1, decryptedPart2])

    // Step 7: Write decrypted content to disk
    writeFileSync(args.output_path, decryptedContent)

    return {
      success: true,
      escrowId,
      output_path: args.output_path,
      encrypted_size: encryptedBlob.length,
      decrypted_size: decryptedContent.length,
      content_hash_verified: true,
    }
  },
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
