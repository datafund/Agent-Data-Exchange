// Shared wallet name mapping — single source of truth
const WALLET_NAMES = {
  '0x96663b32321c014a2b5f34559788c9cc358b2086': 'Atlas',
  '0x2dff7f86d6cad66e6fd3b92f6b67f25c5c5fb65b': 'Beacon',
  '0x8af66b19d5b1cd6f21d24915852858e102c9fd8a': 'Cipher',
  '0x341de28ada6377d86f6005aa44d3134736ac3afd': 'Delta',
  '0x8fbd3f386f5f2a8c93de654871d6f9bb489c92af': 'Echo',
  '0xed67b7969a0660022b09308691b33971e15f12b2': 'Forge',
}
function walletName(addr) {
  if (!addr) return '-'
  return WALLET_NAMES[addr.toLowerCase()] || (addr.slice(0,6)+'...'+addr.slice(-4))
}
function formatPrice(weiStr, token) {
  if (!weiStr || weiStr === '0') return '0 ' + (token || 'ETH')
  const s = String(weiStr)
  // If it looks like wei (>= 15 digits), convert to ETH
  if (/^\d+$/.test(s) && s.length >= 15) {
    const eth = Number(s) / 1e18
    const formatted = eth < 0.0001 ? eth.toExponential(2) : parseFloat(eth.toPrecision(4))
    return formatted + ' ' + (token || 'ETH')
  }
  // Already formatted or small number
  return s.includes(token || 'ETH') ? s : s + ' ' + (token || 'ETH')
}
