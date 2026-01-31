import { ethers } from 'ethers';

const RPC = 'https://eth-sepolia.g.alchemy.com/v2/CP_HPZ76hYvOsDJrRyFbA';
const ADDR = '0xa226C0E0cEa2D8353C9Ec6ee959A03D54F8D14b6';
const SELLER_KEY = '0xc4cd2ed283d46af361315e6e6751b111c67f0bbecb98bc7079cbaa142956a07e';
const BUYER_KEY = '0x80e1efce56f7bfa4b63cdeb7d98272d03f9e2c5f0ec5a49afdee91bef4488197';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const seller = new ethers.Wallet(SELLER_KEY, provider);
  const buyer = new ethers.Wallet(BUYER_KEY, provider);

  const [sellerBal, buyerBal, code] = await Promise.all([
    provider.getBalance(seller.address),
    provider.getBalance(buyer.address),
    provider.getCode(ADDR),
  ]);

  console.log('Seller:', seller.address, 'Balance:', ethers.formatEther(sellerBal), 'ETH');
  console.log('Buyer:', buyer.address, 'Balance:', ethers.formatEther(buyerBal), 'ETH');
  console.log('Contract has code:', code.length > 2 ? `YES (${code.length} bytes)` : 'NO');

  // Try various function signatures to discover the ABI
  const probes = [
    'function nextEscrowId() view returns (uint256)',
    'function getEscrow(uint256) view returns (address,address,address,bytes32,bytes32,uint256,uint256,uint8)',
    'function getEscrow(uint256) view returns (address,address,bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint256,uint256,string,uint8)',
    'function owner() view returns (address)',
    'function paused() view returns (bool)',
  ];

  for (const sig of probes) {
    try {
      const c = new ethers.Contract(ADDR, [sig], provider);
      const name = sig.match(/function (\w+)/)?.[1] || '';
      if (name === 'getEscrow') {
        const result = await c.getEscrow(0);
        console.log(`${name}(0):`, result);
      } else {
        const result = await c[name]();
        console.log(`${name}():`, result.toString());
      }
    } catch (e: any) {
      const name = sig.match(/function (\w+)/)?.[1] || '';
      console.log(`${name}: FAILED -`, e.message?.slice(0, 80));
    }
  }
}

main().catch(console.error);
