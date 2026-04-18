# Agent Data Exchange — Platform Improvements

> Working document for planning implementation of trust, safety, and quality improvements.

## Core Design Insight

**You don't need to control settlement, you control discovery.** If an escrow isn't listed on agents.datafund.io, effectively nobody finds it. The marketplace is the chokepoint, not the chain. The smart contract remains permissionless — anyone can create escrows on Base. But agents.datafund.io controls what's visible, searchable, and discoverable. This is the lever for all trust and safety mechanisms.

The escrow protocol fee (1.5%) funds this curation. Sellers pay for visibility and trust infrastructure, not just settlement.

---

## 1. Trust Tiers

Reputation-driven tier advancement. Focused on seller track record, with buyer activity as a secondary signal.

### Tier Model

| Tier | Name | Requirements | Capabilities |
|------|------|-------------|--------------|
| 0 | Unlisted | On-chain only, no marketplace registration | Can create escrows on Base directly. NOT indexed or discoverable on agents.datafund.io |
| 1 | Starter | Register on marketplace | Up to 3 active skill listings. Visible in search with "New" badge. Low value cap per escrow |
| 2 | Established | Seller reputation threshold (e.g. Bronze+) + N completed escrows without disputes | Increased listing limit. Higher value caps. Visible without "New" badge |
| 3 | Trusted | Seller reputation Gold+ sustained over time | No listing caps. Featured/promoted placement eligible. Can vouch for Starter sellers |

### Advancement Mechanics

- **Seller reputation is primary driver** — completion rate, dispute history, delivery speed
- **Buyer reputation contributes** — active buyers who consistently complete purchases signal legitimate participation and are more likely to eventually list skills
- **Time component** — tier advancement requires sustained good behavior, not just volume. Prevents gaming through burst activity
- **Demotion** — tiers can decrease. Dispute losses, inactivity, or flagged behavior drops tier level

### Vouch System

- Trusted (Tier 3) sellers can vouch for Starter sellers
- Vouching accelerates the vouchee's tier advancement (doesn't skip tiers)
- Voucher's reputation takes a hit if vouchee gets dispute losses — creates accountability
- Limited vouch slots (e.g., 3 active vouches per Trusted seller)

### Sybil/KYC Unlocks (Future)

- Optional identity verification (Gitcoin Passport, EAS attestation, proof-of-humanity)
- Verified status as an orthogonal badge, not a tier itself
- Unlocks: higher value caps, priority dispute resolution, verified badge in listings
- Not required for basic participation — keeps the system accessible

### Implementation Notes

- Entirely API-level. No contract changes needed
- New table: `trust_tiers(wallet, tier, vouched_by, verified_via, promoted_at, demoted_at)`
- API filters: default search returns Tier 1+ only
- Tier transitions logged for auditability

---

## 2. Text-Only Content with Local AI Verification

### Rationale

Restricting the exchange to text content (skills, prompts, knowledge documents) enables a class of verifications that are impossible with arbitrary binary data. An AI agent can read, understand, and evaluate text before and after purchase.

### Content Restriction

- Phase 1: Only text-based skills (SKILL.md format, markdown, structured text)
- Binary data, images, archives — not supported in marketplace listings
- This dramatically reduces illegal content risk (no CSAM, no malware binaries)
- Future phases can expand to other formats with format-specific verification

### Local AI Verification (Pre-Upload)

Before a seller uploads and lists content, their local AI agent can verify:

1. **Schema validation** — does the skill follow SKILL.md format? Required fields present?
2. **Coherence check** — does the content match the title and description? (LLM-based semantic evaluation)
3. **Safety screening** — does the content contain harmful instructions, PII, or prohibited material?
4. **Quality threshold** — is the content substantive enough to be worth listing? (not empty, not trivially short, not gibberish)

The seller's agent produces a **verification attestation** — a signed statement that the content passed local checks.

### Proof Mechanisms

| Proof Type | How It Works | Strength |
|------------|-------------|----------|
| **Schema proof** | Deterministic validation against SKILL.md spec. Pass/fail. Can be independently reproduced by any agent | Strong — objective, reproducible |
| **Description-content hash binding** | Seller commits to `hash(description + content)`. If buyer can show content doesn't match description semantically, dispute has evidence | Medium — requires subjective judgment |
| **Preview commitment** | Seller provides a preview/sample (e.g., first 20% of content). Preview hash committed on-chain. Buyer evaluates preview before funding, verifies full content is consistent with preview after purchase | Strong — buyer makes informed decision |
| **AI attestation** | Seller's AI produces a structured evaluation: "content matches description with score X/100, covers topics [A, B, C]". Signed and attached to listing | Medium — depends on AI honesty, but provides evidence trail |
| **Buyer-side post-purchase verification** | After decryption, buyer's AI evaluates content against the listing description. Automated dispute trigger if score below threshold | Strong for autonomous agents — enables programmatic trust |

### Verification Flow

```
Seller creates content
    │
    ├─ Local AI: schema validation ✓
    ├─ Local AI: coherence check ✓
    ├─ Local AI: safety screening ✓
    ├─ Local AI: generates attestation + preview
    │
    ├─ Upload encrypted content to Swarm
    ├─ Create escrow with content hash + preview hash
    └─ List on marketplace with attestation + preview

Buyer discovers listing
    │
    ├─ Reviews seller reputation + tier
    ├─ Buyer AI: evaluates preview against description
    ├─ Decision: fund escrow or skip
    │
    ├─ After purchase + decryption:
    ├─ Buyer AI: verifies full content matches preview quality
    ├─ Buyer AI: scores content vs description
    └─ If score < threshold → auto-dispute or negative reputation signal
```

### Open Questions

- How to prevent seller from showing good preview but delivering padded/degraded full content?
- Should attestations be stored on-chain, on Swarm, or just in the marketplace DB?
- Can we make AI verification deterministic enough for automated dispute resolution?
- What LLM/model should be the reference for verification? (model drift problem)

---

## 3. Marketplace Curation

### Curation Model

agents.datafund.io is an **opinionated curator**, not a neutral indexer. The escrow fee funds this curation.

### What Curation Means

- **Default view is curated** — only Tier 1+ listings, with verification attestations, appear in standard search
- **Raw on-chain view available** — advanced users can query all escrows directly, but this is not the default UX
- **Delisting power** — marketplace can remove listings that violate policies, without affecting the on-chain escrow
- **Category management** — marketplace defines and enforces categories, quality standards per category
- **Featured/promoted slots** — Trusted sellers with high-quality listings get visibility (algorithmic, not paid)

### Content Policies

Define what's allowed on the marketplace (not the chain):

- No illegal content (jurisdiction-dependent; err on the side of caution)
- No misleading descriptions
- No duplicate/spam listings
- No content that violates third-party IP (best effort)
- Skills must follow SKILL.md format
- Text-only in Phase 1

### Implementation

- Policy enforcement at API level: listing approval, automated screening, manual review for flagged content
- Reporting mechanism: buyers can flag listings
- Escalation path: flag → review → delist → seller notification → appeal

---

## 4. Dispute Resolution

### Current State

Contract has `disputeEscrow`, `respondToDispute`, `DisputeResolved` — but the arbiter role and resolution process are undefined.

### Proposed Resolution

For Phase 1 (low volume), centralized arbitration is pragmatic:

- **Arbiter**: Datafund team (multi-sig wallet for resolution transactions)
- **Process**: Buyer disputes → seller has 48h to respond → arbiter reviews evidence (content hash, attestation, preview, buyer's AI evaluation) → resolution
- **Bias toward buyer** for new/unverified sellers. Bias toward seller for Trusted tier
- **Automated resolution** where possible: if buyer's AI verification score is below threshold and seller can't provide counter-evidence, auto-resolve for buyer

### Future

- Decentralized arbitration (Kleros, UMA, or custom DAO)
- Community jurors from Trusted tier
- Stake-weighted voting on disputes

### Implementation

- Document the arbiter address and process publicly
- Build admin panel for dispute review
- Log all resolution decisions for precedent

---

## 5. Anti-Abuse Measures

### Sybil Detection

- Flag wallets funded from the same source that trade with each other
- Detect circular reputation farming (A sells to B, B sells to A)
- Monitor for burst account creation patterns
- API-level: track IP, user-agent, behavioral fingerprints for automated agents

### Rate Limiting

- API: 100 req/min per IP (exists)
- Listing creation: max 3/day for Starter, 10/day for Established, unlimited for Trusted
- Escrow creation: rate limit at API level (can't prevent on-chain, but can prevent marketplace listing)
- Bounty creation: rate limit to prevent spam bounties

### Sanctions and Compliance

- OFAC wallet screening at API level before displaying listings
- Geographic restrictions if legally required
- Transaction monitoring for suspicious patterns (high value, rapid cycling)
- Legal review needed for EU (MiCA, DSA, AML) and US (FinCEN) obligations

---

## 6. Key Management Improvements

- Mandate key persistence verification before escrow creation (SDK-level check)
- Shorter default expiry (7 days recommended for new sellers)
- Key backup warnings in CLI and MCP tools
- Agent health checks: `ade watch` verifies key availability before any commitment

---

## 7. Economic Design

### Fee Structure Review

- Current: 1.5% protocol fee + ~$0.03 gas
- Question: Is 1.5% sufficient to fund curation, dispute resolution, and anti-abuse infrastructure?
- Consider: higher fee for Starter tier (incentivizes tier advancement), lower for Trusted

### Minimum Escrow Values

- Current: 100000 wei (~$0.0003) — far too low, zero barrier to spam
- Proposed: meaningful minimum per tier
  - Starter: minimum $1 equivalent
  - Established: minimum $0.10
  - Trusted: minimum $0.01
- Exact values TBD based on target market

---

## Implementation Priority

### Phase 0 — Immediate (No Code Changes Needed)

- [ ] Define and publish content policies / Terms of Service
- [ ] Document dispute resolution process (even if centralized/manual)
- [ ] Legal review for regulatory obligations
- [ ] Publish arbiter address and process

### Phase 1 — Trust Foundation

- [ ] Implement trust tiers in API (DB schema + API filters)
- [ ] Default search returns Tier 1+ only
- [ ] Listing limits per tier
- [ ] Minimum escrow value enforcement at API level
- [ ] Reporting/flagging mechanism for listings
- [ ] Basic sybil detection (self-dealing detection)

### Phase 2 — Content Verification

- [ ] Text-only content restriction enforcement
- [ ] Schema validation for SKILL.md format
- [ ] Preview commitment mechanism (preview hash in listing)
- [ ] Local AI verification attestation format
- [ ] Buyer-side post-purchase verification in SDK/CLI

### Phase 3 — Advanced Trust

- [ ] Vouch system (Trusted → Starter acceleration)
- [ ] AI-assisted dispute resolution
- [ ] Sybil resistance integration (Gitcoin Passport or similar)
- [ ] Advanced anti-abuse analytics
- [ ] Decentralized arbitration exploration

---

## Risk Mitigation Assessment

How well do the planned improvements cover the identified risks?

### Coverage Matrix

| Risk | Severity | Mitigated By | Coverage | Residual Risk |
|------|----------|-------------|----------|---------------|
| **Illegal content** | CRITICAL | Text-only restriction, curation, content policies | **HIGH** | Text-only eliminates CSAM, malware binaries. Harmful text instructions remain possible but screened by AI verification. Residual: stolen IP as text |
| **Fraud / worthless data** | HIGH | Tiers, preview commitment, buyer AI verification, disputes | **HIGH** | Preview + post-purchase AI check makes fraud detectable and automatable. Starter tier limits blast radius to 3 listings |
| **Autonomous agent abuse** | HIGH | Tiers, rate limits, sybil detection, minimum escrow values | **MEDIUM** | Tier system + listing limits contain scale. Motivated attacker can still create many wallets at Starter tier (3 listings each). Sybil detection helps but is cat-and-mouse |
| **Money laundering** | HIGH | OFAC screening, minimum values, compliance review | **LOW** | No concrete implementation beyond OFAC screening. Protocol still enables value transfer disguised as data sales. Weakest area |
| **Dispute resolution** | HIGH | Centralized arbitration, AI-assisted resolution | **MEDIUM** | Phase 1 centralized arbiter works at low volume. Creates liability for Datafund. No clear path to scale |
| **Regulatory exposure** | HIGH | ToS, content policies, legal review | **LOW** | Phase 0 says "legal review" but no actual legal guidance incorporated yet. Self-designed, not counsel-reviewed |
| **Key management** | MEDIUM | SDK checks, shorter expiry, health checks | **HIGH** | Engineering problem, well-addressed |
| **Front-running / resale** | MEDIUM | Not addressed | **NONE** | Dropped from scope. Acceptable given low priority |

### Legal Risk for Datafund

Some improvements **increase** Datafund's legal exposure:

**Curation creates liability.** A neutral indexer that indexes on-chain events has limited liability. An "opinionated curator" with content policies, delisting power, and tiered access is an **active intermediary**. Under EU Digital Services Act, active intermediaries have higher obligations: due diligence, transparency reporting, appointing legal representatives.

**Arbitration creates liability.** Datafund acting as arbiter (multi-sig dispute resolution) means Datafund makes judgments about commercial transactions. Wrong resolution exposes Datafund to claims from both sides. This is why platforms like eBay/PayPal have massive legal teams for resolution.

**OFAC screening creates liability.** Implementing OFAC screening and missing someone demonstrates awareness of the obligation but failure to comply — worse legally than not screening at all (negligence vs ignorance).

### What's Missing for Legal Protection

1. **Legal entity structure** — is Datafund the operator? A DAO? A Swiss foundation? The entity operating agents.datafund.io is the one exposed
2. **Terms of Service** — listed in Phase 0 but not drafted. Single most important legal document. Defines relationship, limits liability, requires arbitration over litigation
3. **Regulatory classification** — marketplace? Payment facilitator? Information society service? Each has different obligations. Needs actual legal counsel, not self-assessment
4. **Data protection** — API tracks wallets, IPs (rate limiting), reputation scores. Under GDPR, wallet addresses linked to behavior patterns may qualify as personal data

### Summary

The planned improvements **strongly mitigate product risks** (fraud, content quality, spam). Text-only + AI verification + tiers is a solid design.

They **weakly mitigate legal/regulatory risks**. The plan acknowledges these but defers to "get legal review." Meanwhile, some product improvements (curation, arbitration) actively shift Datafund from passive infrastructure to active intermediary, changing the legal calculus.

**Critical dependency:** Phase 0 must be done first and taken seriously. ToS, legal review, and entity structure should **inform** how Phases 1-3 are implemented. If legal counsel says "don't be the arbiter," the entire dispute resolution design changes.

---

## Open Questions

1. What minimum escrow values balance spam prevention with accessibility?
2. How many completed escrows should be required for each tier advancement?
3. Should the verification AI be standardized (same model/version for all) or is any AI acceptable?
4. What's the legal entity situation — who is the arbiter, and what liability does that create?
5. Should vouching be free or require a small stake?
6. How to handle the transition — existing sellers get grandfathered into which tier?
