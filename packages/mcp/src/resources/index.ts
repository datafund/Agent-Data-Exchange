import { session } from '../session.js'

export const guideResource = {
  uri: 'df://guide',
  name: 'Datafund Skill Exchange Guide',
  description: 'How to use the agent data exchange — complete workflow reference',
  mimeType: 'text/markdown',
  read() {
    return `# Datafund Skill Exchange — Agent Guide

## Quick Start

1. **df_generate_keypair** — Create identity (auto-saved to session)
2. **df_create_keystore** — Back up your key (encrypted)
3. **df_register_account** — Get ENS name + Swarm stamp

## Selling Content

\`\`\`
df_sell(content_base64, price_wei, name, description, category)
\`\`\`

Single call: uploads → creates escrow → signs → submits → lists on marketplace.

Then wait for buyer:
- **df_wait_for_state(escrow_id, "Funded")** — poll until funded
- **df_release_key(escrow_id)** — release decryption key (commit + reveal)
- **df_claim(escrow_id, role="seller")** — claim payment

## Buying Content

\`\`\`
df_buy(skill_id)  // or df_buy(escrow_id)
\`\`\`

Single call: checks reputation → funds escrow → signs → submits.

Then wait for key:
- **df_wait_for_state(escrow_id, "Released")** — poll until key released
- **df_claim(escrow_id, role="buyer", output_path="./file")** — claim + download

## Session Persistence

- **df_save_session(password)** — encrypt session to disk
- **df_load_session(label, password)** — restore after restart

## Marketplace

- **df_browse_skills(category, query)** — search listings
- **df_check_reputation(address)** — seller reputation
- **df_skill_details(skill_id)** — purchase info

## Low-Level Tools

- **df_upload / df_download** — Swarm file operations
- **df_sign_transaction** — manual tx signing with intent verification
- **df_ens_resolve** — ENS lookup
- **df_escrow_status** — read escrow state
- **df_my_escrows** — list your escrows
`
  },
}

export const statusResource = {
  uri: 'df://status',
  name: 'Session Status',
  description: 'Current session state — identity, escrows, connection',
  mimeType: 'application/json',
  read() {
    const data = session.toJSON()
    return JSON.stringify({
      hasIdentity: !!data.privateKey,
      address: data.address || null,
      subdomain: data.subdomain || null,
      stampBatchId: data.stampBatchId || null,
      escrowCount: Object.keys(data.escrows).length,
      escrows: Object.entries(data.escrows).map(([id, s]) => ({
        id,
        role: s.role,
        hasEncryptionKey: !!s.encryptionKey,
      })),
    }, null, 2)
  },
}
