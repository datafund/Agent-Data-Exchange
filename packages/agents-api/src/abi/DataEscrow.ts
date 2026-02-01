/**
 * DataEscrowV3 Contract ABI
 * Generated from compiled contract (packages/contracts/out/DataEscrow.sol/DataEscrowV3.json)
 *
 * V3 features: ERC20 token support, ERC-8004 agent IDs, configurable fees,
 * configurable dispute windows, emergency withdrawal, UUPS upgradeable
 */

export const DataEscrowABI = [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "DEFAULT_DISPUTE_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "DISPUTE_BOND_PERCENT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "EMERGENCY_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_DISPUTE_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FEE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_AMOUNT_NATIVE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_AMOUNT_TOKEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_BLOCK_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_TIME_DELAY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "NATIVE_TOKEN",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SELLER_RESPONSE_WINDOW",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "UPGRADE_INTERFACE_VERSION",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "VERSION",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "agentRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "arbiters",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelEscrow",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimDisputeTimeout",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimExpired",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimPayment",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "commitKeyRelease",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "name": "encryptedKeyCommitment",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createEscrow",
    "inputs": [
      {
        "name": "contentHash",
        "type": "bytes32"
      },
      {
        "name": "keyCommitment",
        "type": "bytes32"
      },
      {
        "name": "paymentToken",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      },
      {
        "name": "expiryDays",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createEscrowWithAgent",
    "inputs": [
      {
        "name": "contentHash",
        "type": "bytes32"
      },
      {
        "name": "keyCommitment",
        "type": "bytes32"
      },
      {
        "name": "paymentToken",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      },
      {
        "name": "expiryDays",
        "type": "uint256"
      },
      {
        "name": "disputeWindowSeconds",
        "type": "uint256"
      },
      {
        "name": "sellerAgentId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createEscrowWithTerms",
    "inputs": [
      {
        "name": "contentHash",
        "type": "bytes32"
      },
      {
        "name": "keyCommitment",
        "type": "bytes32"
      },
      {
        "name": "paymentToken",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      },
      {
        "name": "expiryDays",
        "type": "uint256"
      },
      {
        "name": "disputeWindowSeconds",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "disputeEscrow",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "emergencyWithdraw",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "escrows",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "seller",
        "type": "address"
      },
      {
        "name": "buyer",
        "type": "address"
      },
      {
        "name": "paymentToken",
        "type": "address"
      },
      {
        "name": "contentHash",
        "type": "bytes32"
      },
      {
        "name": "keyCommitment",
        "type": "bytes32"
      },
      {
        "name": "encryptedKeyCommitment",
        "type": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256"
      },
      {
        "name": "expiresAt",
        "type": "uint256"
      },
      {
        "name": "disputeWindow",
        "type": "uint256"
      },
      {
        "name": "commitBlock",
        "type": "uint256"
      },
      {
        "name": "commitTimestamp",
        "type": "uint256"
      },
      {
        "name": "releaseTimestamp",
        "type": "uint256"
      },
      {
        "name": "disputeRaisedAt",
        "type": "uint256"
      },
      {
        "name": "disputeBond",
        "type": "uint256"
      },
      {
        "name": "sellerResponseHash",
        "type": "bytes32"
      },
      {
        "name": "sellerAgentId",
        "type": "uint256"
      },
      {
        "name": "buyerAgentId",
        "type": "uint256"
      },
      {
        "name": "state",
        "type": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeBasisPoints",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "fundEscrow",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "fundEscrowWithAgent",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "name": "buyerAgentId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "fundEscrowWithToken",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "fundEscrowWithTokenAndAgent",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "name": "buyerAgentId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getArbiters",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getEscrow",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "seller",
        "type": "address"
      },
      {
        "name": "buyer",
        "type": "address"
      },
      {
        "name": "paymentToken",
        "type": "address"
      },
      {
        "name": "contentHash",
        "type": "bytes32"
      },
      {
        "name": "keyCommitment",
        "type": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256"
      },
      {
        "name": "expiresAt",
        "type": "uint256"
      },
      {
        "name": "disputeWindow_",
        "type": "uint256"
      },
      {
        "name": "state",
        "type": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getEscrowAgents",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "sellerAgentId",
        "type": "uint256"
      },
      {
        "name": "buyerAgentId",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getEscrowDispute",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "disputeRaisedAt",
        "type": "uint256"
      },
      {
        "name": "disputeBond",
        "type": "uint256"
      },
      {
        "name": "sellerResponseHash",
        "type": "bytes32"
      },
      {
        "name": "sellerVotes",
        "type": "uint256"
      },
      {
        "name": "buyerVotes",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "initialize",
    "inputs": [
      {
        "name": "_owner",
        "type": "address"
      },
      {
        "name": "_arbiters",
        "type": "address[]"
      },
      {
        "name": "_requiredVotes",
        "type": "uint256"
      },
      {
        "name": "_supportedTokens",
        "type": "address[]"
      },
      {
        "name": "_treasury",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "isTokenSupported",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextEscrowId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pausedAt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proxiableUUID",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requiredVotes",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "respondToDispute",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "name": "responseHash",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revealKey",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "name": "encryptedKeyForBuyer",
        "type": "bytes"
      },
      {
        "name": "salt",
        "type": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAgentRegistry",
    "inputs": [
      {
        "name": "_registry",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setArbiters",
    "inputs": [
      {
        "name": "_arbiters",
        "type": "address[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFeeBasisPoints",
    "inputs": [
      {
        "name": "_feeBps",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTokenSupported",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      },
      {
        "name": "enabled",
        "type": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTreasury",
    "inputs": [
      {
        "name": "_treasury",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "supportedTokens",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "treasury",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "upgradeToAndCall",
    "inputs": [
      {
        "name": "newImplementation",
        "type": "address"
      },
      {
        "name": "data",
        "type": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "voteOnDispute",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "name": "sellerWins",
        "type": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AgentRegistryUpdated",
    "inputs": [
      {
        "name": "oldRegistry",
        "type": "address",
        "indexed": false
      },
      {
        "name": "newRegistry",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ArbitersUpdated",
    "inputs": [
      {
        "name": "newArbiters",
        "type": "address[]",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DisputeRaised",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "bond",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DisputeResolved",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "sellerWins",
        "type": "bool",
        "indexed": false
      },
      {
        "name": "payment",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "bond",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EmergencyWithdrawal",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscrowCancelled",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscrowCreated",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "seller",
        "type": "address",
        "indexed": true
      },
      {
        "name": "paymentToken",
        "type": "address",
        "indexed": false
      },
      {
        "name": "contentHash",
        "type": "bytes32",
        "indexed": false
      },
      {
        "name": "keyCommitment",
        "type": "bytes32",
        "indexed": false
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "expiresAt",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "disputeWindow",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "sellerAgentId",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscrowExpired",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EscrowFunded",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "buyerAgentId",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeCollected",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeUpdated",
    "inputs": [
      {
        "name": "oldBps",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "newBps",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Initialized",
    "inputs": [
      {
        "name": "version",
        "type": "uint64",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "KeyCommitted",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "encryptedKeyCommitment",
        "type": "bytes32",
        "indexed": false
      },
      {
        "name": "commitBlock",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "commitTimestamp",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "KeyRevealed",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "encryptedKeyForBuyer",
        "type": "bytes",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PaymentClaimed",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "seller",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SellerResponded",
    "inputs": [
      {
        "name": "escrowId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenWhitelisted",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TreasuryUpdated",
    "inputs": [
      {
        "name": "oldTreasury",
        "type": "address",
        "indexed": false
      },
      {
        "name": "newTreasury",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Unpaused",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Upgraded",
    "inputs": [
      {
        "name": "implementation",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AddressEmptyCode",
    "inputs": [
      {
        "name": "target",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC1967InvalidImplementation",
    "inputs": [
      {
        "name": "implementation",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ERC1967NonPayable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExpectedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FailedCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidInitialization",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotArbiter",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotInitializing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UUPSUnauthorizedCallContext",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UUPSUnsupportedProxiableUUID",
    "inputs": [
      {
        "name": "slot",
        "type": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const
