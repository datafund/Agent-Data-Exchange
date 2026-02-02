# DataEscrowV3 Contract Reference

Smart contract for trustless data exchange escrows on Base L2.

## Contract Addresses

| Network | Address |
|---------|---------|
| Base Mainnet (8453) | [`0x69Aa385686AEdA505013a775ddE7A59d045cb30d`](https://basescan.org/address/0x69Aa385686AEdA505013a775ddE7A59d045cb30d) |
| Base Sepolia (84532) | [`0xa226C0E0cEa2D8353C9Ec6ee959A03D54F8D14b6`](https://sepolia.basescan.org/address/0xa226C0E0cEa2D8353C9Ec6ee959A03D54F8D14b6) |

## Key Functions

### Creating an Escrow (Seller)

#### `createEscrow`

Basic escrow creation without agent ID or custom dispute window.

```solidity
function createEscrow(
    bytes32 contentHash,      // keccak256 hash of the data being sold
    bytes32 keyCommitment,    // keccak256 hash of the encryption key
    address paymentToken,     // address(0) for native ETH, or ERC20 address
    uint256 amount,           // price in wei (or token decimals)
    uint256 expiryDays        // days until escrow expires if unfunded (1-365)
) external returns (uint256 escrowId)
```

#### `createEscrowWithAgent`

Create escrow with ERC-8004 agent ID for reputation tracking.

```solidity
function createEscrowWithAgent(
    bytes32 contentHash,
    bytes32 keyCommitment,
    address paymentToken,
    uint256 amount,
    uint256 expiryDays,
    uint256 disputeWindowSeconds,  // custom dispute window (default: 86400 = 24h)
    uint256 sellerAgentId          // ERC-8004 agent ID for reputation
) external returns (uint256 escrowId)
```

### Funding an Escrow (Buyer)

#### `fundEscrow`

Fund an escrow with native ETH.

```solidity
function fundEscrow(
    uint256 escrowId
) external payable
```

#### `fundEscrowWithAgent`

Fund with ETH and associate buyer's agent ID.

```solidity
function fundEscrowWithAgent(
    uint256 escrowId,
    uint256 buyerAgentId  // ERC-8004 agent ID for reputation
) external payable
```

#### `fundEscrowWithToken`

Fund with ERC20 token (requires prior approval).

```solidity
function fundEscrowWithToken(
    uint256 escrowId
) external
```

### Delivering Content (Seller)

Two-step reveal process for front-running protection:

#### Step 1: `commitKeyRelease`

Commit to releasing the key (must wait for block confirmation before reveal).

```solidity
function commitKeyRelease(
    uint256 escrowId,
    bytes32 encryptedKeyCommitment  // keccak256(encryptedKey || salt)
) external
```

#### Step 2: `revealKey`

Reveal the encrypted key to the buyer.

```solidity
function revealKey(
    uint256 escrowId,
    bytes encryptedKeyForBuyer,  // key encrypted with buyer's public key
    bytes32 salt                  // salt used in commitment
) external
```

### Claiming Payment (Seller)

```solidity
function claimPayment(
    uint256 escrowId
) external
```

Can only be called after:
- Key has been revealed
- Dispute window has passed (24h default)
- No dispute was raised

### Cancellation & Expiry

#### `cancelEscrow` (Seller)

Cancel an unfunded escrow.

```solidity
function cancelEscrow(uint256 escrowId) external
```

#### `claimExpired` (Buyer)

Reclaim funds if seller didn't deliver before expiry.

```solidity
function claimExpired(uint256 escrowId) external
```

### Disputes

#### `disputeEscrow` (Buyer)

Raise a dispute during the dispute window. Requires posting a bond.

```solidity
function disputeEscrow(uint256 escrowId) external payable
```

#### `respondToDispute` (Seller)

Seller submits evidence/response hash.

```solidity
function respondToDispute(uint256 escrowId, bytes32 responseHash) external
```

## Escrow States

```
Created → Funded → KeyCommitted → KeyRevealed → Claimed
    │         │           │              │
    └→ Cancelled   └→ Expired    └→ Disputed → Resolved
```

| State | Description |
|-------|-------------|
| `Created` | Seller created escrow, awaiting buyer |
| `Funded` | Buyer deposited funds |
| `KeyCommitted` | Seller committed to key release |
| `KeyRevealed` | Seller revealed encrypted key |
| `Claimed` | Seller claimed payment (complete) |
| `Cancelled` | Seller cancelled unfunded escrow |
| `Expired` | Buyer reclaimed after expiry |
| `Disputed` | Buyer raised dispute |
| `ResolvedSeller` / `ResolvedBuyer` | Arbiters resolved dispute |

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_DISPUTE_WINDOW` | 86400 | 24 hours in seconds |
| `MAX_DISPUTE_WINDOW` | 604800 | 7 days maximum |
| `MIN_AMOUNT_NATIVE` | 100000 | Minimum wei for ETH escrows |
| `MIN_AMOUNT_TOKEN` | 100 | Minimum for token escrows |
| `DISPUTE_BOND_PERCENT` | 10 | 10% bond required for disputes |
| `SELLER_RESPONSE_WINDOW` | 172800 | 48h for seller to respond |
| `EMERGENCY_DELAY` | 2592000 | 30 days for emergency withdrawal |

## Events

### Lifecycle Events

```solidity
event EscrowCreated(uint256 indexed escrowId, address indexed seller, address paymentToken, bytes32 contentHash, bytes32 keyCommitment, uint256 amount, uint256 expiresAt, uint256 disputeWindow, uint256 sellerAgentId);
event EscrowFunded(uint256 indexed escrowId, address indexed buyer, uint256 amount, uint256 buyerAgentId);
event KeyCommitted(uint256 indexed escrowId, bytes32 encryptedKeyCommitment, uint256 commitBlock, uint256 commitTimestamp);
event KeyRevealed(uint256 indexed escrowId, bytes encryptedKeyForBuyer);
event PaymentClaimed(uint256 indexed escrowId, address indexed seller, uint256 amount);
event EscrowCancelled(uint256 indexed escrowId);
event EscrowExpired(uint256 indexed escrowId, address indexed buyer, uint256 amount);
```

### Dispute Events

```solidity
event DisputeRaised(uint256 indexed escrowId, address indexed buyer, uint256 bond);
event SellerResponded(uint256 indexed escrowId, bytes32 responseHash);
event DisputeResolved(uint256 indexed escrowId, bool sellerWins, uint256 payment, uint256 bond);
```

## Example: Creating and Funding an Escrow

### TypeScript with ethers.js

```typescript
import { ethers } from 'ethers';
import { DataEscrowABI } from './abi/DataEscrow';

const CONTRACT = '0x69Aa385686AEdA505013a775ddE7A59d045cb30d';
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

// Seller creates escrow
async function createEscrow(
  signer: ethers.Signer,
  contentHash: string,
  encryptionKey: string,
  priceEth: string
) {
  const contract = new ethers.Contract(CONTRACT, DataEscrowABI, signer);

  const keyCommitment = ethers.keccak256(ethers.toUtf8Bytes(encryptionKey));
  const amount = ethers.parseEther(priceEth);
  const expiryDays = 7;

  const tx = await contract.createEscrow(
    contentHash,
    keyCommitment,
    ethers.ZeroAddress,  // native ETH
    amount,
    expiryDays
  );

  const receipt = await tx.wait();
  const event = receipt.logs.find(
    (log: any) => log.fragment?.name === 'EscrowCreated'
  );

  return event.args.escrowId;
}

// Buyer funds escrow
async function fundEscrow(signer: ethers.Signer, escrowId: number) {
  const contract = new ethers.Contract(CONTRACT, DataEscrowABI, signer);
  const escrow = await contract.getEscrow(escrowId);

  const tx = await contract.fundEscrow(escrowId, {
    value: escrow.amount
  });

  await tx.wait();
}

// Seller reveals key (two-step process)
async function revealKey(
  signer: ethers.Signer,
  escrowId: number,
  encryptedKeyForBuyer: string
) {
  const contract = new ethers.Contract(CONTRACT, DataEscrowABI, signer);

  // Step 1: Commit
  const salt = ethers.randomBytes(32);
  const commitment = ethers.keccak256(
    ethers.concat([ethers.toUtf8Bytes(encryptedKeyForBuyer), salt])
  );

  await (await contract.commitKeyRelease(escrowId, commitment)).wait();

  // Wait for block confirmation (front-running protection)
  await new Promise(r => setTimeout(r, 15000));

  // Step 2: Reveal
  await (await contract.revealKey(
    escrowId,
    ethers.toUtf8Bytes(encryptedKeyForBuyer),
    salt
  )).wait();
}
```

## Full ABI

The complete ABI is available at:
- TypeScript: [`packages/agents-api/src/abi/DataEscrow.ts`](../packages/agents-api/src/abi/DataEscrow.ts)
- JSON: Copy from the TypeScript file and remove `as const`

## See Also

- [Architecture Guide](./ARCHITECTURE.md) - How the escrow fits into the platform
- [Getting Started Guide](./GETTING_STARTED.md) - Step-by-step seller tutorial
