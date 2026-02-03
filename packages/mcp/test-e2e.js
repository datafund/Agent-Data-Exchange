/**
 * End-to-end test — runs tools in-process with shared session.
 */

const tools = {}

// Load all tools from the built bundle by importing the tool objects directly
const bundle = require('./dist/index.js')

// We need to access tools directly. Since the server registers them internally,
// let's import tools from source modules via the built output.
// Instead, let's build a mini-harness that calls tools through the server.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let client
let results = { passed: 0, failed: 0, skipped: 0, errors: [] }

async function call(toolName, args = {}) {
  const result = await client.callTool({ name: toolName, arguments: args })
  const text = result.content?.[0]?.text
  if (result.isError) {
    throw new Error(`${toolName}: ${text}`)
  }
  return JSON.parse(text)
}

async function test(name, fn) {
  try {
    await fn()
    results.passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.failed++
    results.errors.push({ name, error: e.message })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

async function skip(name, reason) {
  results.skipped++
  console.log(`  ○ ${name} (skipped: ${reason})`)
}

async function run() {
  console.log('Starting agent-data-exchange MCP server...\n')

  const serverProcess = spawn('node', [path.join(__dirname, 'dist/index.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'dist/index.js')],
  })

  client = new Client(
    { name: 'e2e-test', version: '0.1.0' },
    { capabilities: {} }
  )

  await client.connect(transport)
  console.log('Connected.\n')

  // ═══════════════════════════════════════════
  // 1. LOCAL CRYPTO
  // ═══════════════════════════════════════════
  console.log('── Local Crypto ──')

  let keypair
  await test('df_generate_keypair', async () => {
    keypair = await call('df_generate_keypair')
    if (!keypair.privateKey || !keypair.publicKey || !keypair.address) throw new Error('Missing fields')
    if (!keypair.address.startsWith('0x')) throw new Error('Bad address format')
    if (keypair.privateKey.length !== 64) throw new Error(`Bad privkey length: ${keypair.privateKey.length}`)
  })

  await test('df_generate_mnemonic (12 words)', async () => {
    const r = await call('df_generate_mnemonic', {})
    if (r.mnemonic.split(' ').length !== 12) throw new Error(`Got ${r.mnemonic.split(' ').length} words`)
  })

  await test('df_generate_mnemonic (24 words)', async () => {
    const r = await call('df_generate_mnemonic', { word_count: 24 })
    if (r.mnemonic.split(' ').length !== 24) throw new Error(`Got ${r.mnemonic.split(' ').length} words`)
  })

  let mnemonic
  await test('df_wallet_from_mnemonic', async () => {
    const m = await call('df_generate_mnemonic', {})
    mnemonic = m.mnemonic
    const w = await call('df_wallet_from_mnemonic', { mnemonic: m.mnemonic })
    if (!w.address.startsWith('0x')) throw new Error('Bad address')
    // Derive again with same mnemonic — should be deterministic
    const w2 = await call('df_wallet_from_mnemonic', { mnemonic: m.mnemonic })
    if (w.address !== w2.address) throw new Error('Non-deterministic derivation')
  })

  // Restore original keypair to session for subsequent tests
  await call('df_wallet_from_mnemonic', { mnemonic }) // just to have something in session
  // Actually regenerate the original keypair
  keypair = await call('df_generate_keypair')

  let keystore
  await test('df_create_keystore', async () => {
    const r = await call('df_create_keystore', {
      subdomain: 'e2e-test',
      password: 'testpass123',
    })
    keystore = r.keystore
    if (!keystore.version || keystore.version !== 1) throw new Error('Bad keystore version')
    if (!keystore.crypto) throw new Error('Missing crypto field')
    if (r.address !== keypair.address) throw new Error('Address mismatch')
  })

  await test('df_decrypt_keystore', async () => {
    const r = await call('df_decrypt_keystore', {
      keystore,
      password: 'testpass123',
    })
    if (r.privateKey !== keypair.privateKey) throw new Error('Private key mismatch after decrypt')
    if (r.address !== keypair.address) throw new Error('Address mismatch after decrypt')
    if (r.subdomain !== 'e2e-test') throw new Error('Subdomain lost')
  })

  await test('df_decrypt_keystore (wrong password)', async () => {
    try {
      await call('df_decrypt_keystore', { keystore, password: 'wrongpass' })
      throw new Error('Should have thrown')
    } catch (e) {
      if (e.message === 'Should have thrown') throw e
      // Expected error — pass
    }
  })

  // ═══════════════════════════════════════════
  // 2. SESSION PERSISTENCE
  // ═══════════════════════════════════════════
  console.log('\n── Session Persistence ──')

  await test('df_save_session', async () => {
    const r = await call('df_save_session', { password: 'sesspass123' })
    if (!r.success) throw new Error('Save failed')
    if (!r.path.includes('.datafund/sessions/')) throw new Error(`Bad path: ${r.path}`)
    if (!fs.existsSync(r.path)) throw new Error('File not created')
  })

  await test('df_load_session', async () => {
    const r = await call('df_load_session', { label: 'e2e-test', password: 'sesspass123' })
    if (!r.success) throw new Error('Load failed')
    if (r.address !== keypair.address) throw new Error('Address mismatch after load')
  })

  // ═══════════════════════════════════════════
  // 3. ENS RESOLVE
  // ═══════════════════════════════════════════
  console.log('\n── ENS Resolve ──')

  await test('df_ens_resolve (vitalik.eth)', async () => {
    const r = await call('df_ens_resolve', { name: 'vitalik.eth' })
    if (!r.resolved) throw new Error('Not resolved')
    if (r.address !== '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045') throw new Error(`Wrong address: ${r.address}`)
  })

  await test('df_ens_resolve (nonexistent)', async () => {
    const r = await call('df_ens_resolve', { name: 'thisdoesnotexist99999.eth' })
    if (r.resolved) throw new Error('Should not resolve')
    if (r.address !== null) throw new Error('Should be null')
  })

  // ═══════════════════════════════════════════
  // 4. PROXY TO mcp.fairdrop.xyz
  // ═══════════════════════════════════════════
  console.log('\n── Proxy (mcp.fairdrop.xyz) ──')

  await test('df_status', async () => {
    const r = await call('df_status')
    if (!r.connection) throw new Error('Missing connection field')
    if (!r.connection.connected) throw new Error('Not connected')
  })

  await test('df_lookup (gregor.fairdata.eth)', async () => {
    try {
      const r = await call('df_lookup', { name: 'gregor' })
      // May or may not resolve — just check it returns without crash
      if (r.name === undefined && r.error === undefined) throw new Error('Bad response shape')
    } catch (e) {
      // Lookup failure is OK if the name doesn't exist
      if (!e.message.includes('fairdrop_lookup')) throw e
    }
  })

  // ═══════════════════════════════════════════
  // 5. MARKETPLACE
  // ═══════════════════════════════════════════
  console.log('\n── Marketplace ──')

  await test('df_browse_skills', async () => {
    const r = await call('df_browse_skills', { limit: 2 })
    if (!Array.isArray(r.skills)) throw new Error('Missing skills array')
    if (typeof r.total !== 'number') throw new Error('Missing total')
  })

  let sellerAddr
  await test('df_check_reputation', async () => {
    // Get a real seller from browse
    const skills = await call('df_browse_skills', { limit: 1 })
    if (skills.skills.length === 0) throw new Error('No skills to check')
    sellerAddr = skills.skills[0].seller
    const r = await call('df_check_reputation', { address: sellerAddr })
    // Should return something — even "new" for unknown sellers
    if (r === undefined) throw new Error('Empty response')
  })

  await test('df_skill_details', async () => {
    const skills = await call('df_browse_skills', { limit: 1 })
    if (skills.skills.length === 0) throw new Error('No skills')
    const r = await call('df_skill_details', { skill_id: skills.skills[0].id })
    if (r === undefined) throw new Error('Empty response')
  })

  // ═══════════════════════════════════════════
  // 6. REGISTER ACCOUNT
  // ═══════════════════════════════════════════
  console.log('\n── Registration ──')

  await test('df_register_account', async () => {
    // Generate fresh keypair for registration
    const fresh = await call('df_generate_keypair')
    const subdomain = `e2e-test-${Date.now()}`
    const r = await call('df_register_account', { subdomain })
    if (!r.success) throw new Error(`Registration failed: ${JSON.stringify(r)}`)
    // Check stamp was allocated
    if (r.stamp?.batchId) {
      console.log(`    stamp: ${r.stamp.batchId}`)
    }
    if (r.ens?.registered) {
      console.log(`    ens: ${subdomain}.fairdata.eth`)
    }
  })

  // ═══════════════════════════════════════════
  // 7. SIGN TRANSACTION
  // ═══════════════════════════════════════════
  console.log('\n── Transaction Signing ──')

  await test('df_sign_transaction (simple transfer)', async () => {
    // Sign a simple ETH transfer (no RPC needed if we provide all fields)
    const r = await call('df_sign_transaction', {
      unsigned_tx: {
        to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
        value: '0x0',
        chainId: 8453,
        gas: '21000',
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '100000000',
        nonce: 0,
        data: '0x',
      },
    })
    if (!r.signed_tx) throw new Error('Missing signed_tx')
    if (!r.signed_tx.startsWith('0x')) throw new Error('Bad format')
    if (!r.from) throw new Error('Missing from')
  })

  // ═══════════════════════════════════════════
  // 8. RESOURCES
  // ═══════════════════════════════════════════
  console.log('\n── Resources ──')

  await test('df://guide resource', async () => {
    const r = await client.readResource({ uri: 'df://guide' })
    const text = r.contents?.[0]?.text
    if (!text || !text.includes('Skill Exchange')) throw new Error('Bad guide content')
  })

  await test('df://status resource', async () => {
    const r = await client.readResource({ uri: 'df://status' })
    const data = JSON.parse(r.contents?.[0]?.text)
    if (data.hasIdentity !== true) throw new Error('Should have identity in session')
  })

  // ═══════════════════════════════════════════
  // 9. COMPOSITE: df_sell (requires stamp)
  // ═══════════════════════════════════════════
  console.log('\n── Composite: Sell ──')

  await test('df_sell (upload + escrow)', async () => {
    // This will fail if no stamp is assigned, but we want to see WHERE it fails
    const content = Buffer.from('Hello, this is test content for e2e').toString('base64')
    const r = await call('df_sell', {
      content_base64: content,
      price_wei: '1000000000000000',
      name: 'E2E Test Skill',
      description: 'Test content from e2e test run',
      category: 'other',
    })
    if (!r.escrowId) throw new Error('Missing escrowId')
    console.log(`    escrowId: ${r.escrowId}`)
    console.log(`    txHash: ${r.txHash}`)
  })

  // ═══════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════
  console.log('\n══════════════════════════════════')
  console.log(`Passed:  ${results.passed}`)
  console.log(`Failed:  ${results.failed}`)
  console.log(`Skipped: ${results.skipped}`)

  if (results.errors.length > 0) {
    console.log('\nFailures:')
    for (const e of results.errors) {
      console.log(`  ${e.name}: ${e.error}`)
    }
  }

  console.log('══════════════════════════════════')

  await client.close()
  process.exit(results.failed > 0 ? 1 : 0)
}

run().catch(e => {
  console.error('Fatal:', e)
  process.exit(2)
})
