// Stand-in for Privy's optional Solana peer dependencies. This app is
// Ethereum-only (walletChainType: 'ethereum-only'), so Privy never reaches the
// code paths that dynamically import them.
module.exports = {}
