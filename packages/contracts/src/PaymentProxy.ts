import { type PublicClient, type WalletClient, type Hex, keccak256, toBytes } from 'viem'

export const PAYMENT_PROXY_ABI = [
  {
    name: 'forward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'seller', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'skillId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'feeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint16' }],
  },
  {
    name: 'relayers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

export class PaymentProxyClient {
  constructor(
    private address: Hex,
    private pub: PublicClient,
    private wallet?: WalletClient,
  ) {}

  async forward(seller: Hex, token: Hex, amount: bigint, skillId: string): Promise<Hex> {
    if (!this.wallet?.account) throw new Error('Wallet required for forward()')
    // UUIDs are 36 chars (with hyphens) which exceeds bytes32. Hash to fit.
    const skillIdBytes32 = keccak256(toBytes(skillId))
    const { request } = await this.pub.simulateContract({
      address: this.address,
      abi: PAYMENT_PROXY_ABI,
      functionName: 'forward',
      args: [seller, token, amount, skillIdBytes32],
      account: this.wallet.account,
    })
    return this.wallet.writeContract(request)
  }

  async feeBps(): Promise<number> {
    return this.pub.readContract({
      address: this.address,
      abi: PAYMENT_PROXY_ABI,
      functionName: 'feeBps',
    }) as Promise<number>
  }
}
