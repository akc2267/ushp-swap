import { mainnet, sepolia } from 'wagmi/chains'

// Permit2 is deployed at the same address on every chain.
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
export const HOOKS = ZERO_ADDRESS
export const HOOK_DATA = '0x' as const

export type TokenInfo = {
  symbol: string
  name: string
  address: `0x${string}`
  decimals: number
  isNative: boolean
  // Pool params for this token's v4 pool paired with native ETH.
  // Discovered on-chain via scripts/probe-pools.mjs. Undefined for ETH itself.
  poolFee?: number
  poolTickSpacing?: number
}

// Native ETH is the common base currency — every tradable token below has a
// live v4 pool paired with ETH. ETH is address(0), so it is always currency0.
export const ETH: TokenInfo = {
  symbol: 'ETH',
  name: 'Ethereum',
  address: ZERO_ADDRESS,
  decimals: 18,
  isNative: true,
}

// Real, verified-tradable mainnet tokens (each has a live ETH v4 pool with liquidity).
export const MAINNET_TOKENS: TokenInfo[] = [
  { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, isNative: false, poolFee: 500, poolTickSpacing: 10 },
  { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, isNative: false, poolFee: 500, poolTickSpacing: 10 },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, isNative: false, poolFee: 500, poolTickSpacing: 10 },
  { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, isNative: false, poolFee: 3000, poolTickSpacing: 60 },
  { symbol: 'UNI', name: 'Uniswap', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, isNative: false, poolFee: 3000, poolTickSpacing: 60 },
  { symbol: 'LINK', name: 'Chainlink', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, isNative: false, poolFee: 3000, poolTickSpacing: 60 },
  { symbol: 'AAVE', name: 'Aave', address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', decimals: 18, isNative: false, poolFee: 3000, poolTickSpacing: 60 },
  { symbol: 'LDO', name: 'Lido DAO', address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', decimals: 18, isNative: false, poolFee: 3000, poolTickSpacing: 60 },
  { symbol: 'ENS', name: 'Ethereum Name Service', address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', decimals: 18, isNative: false, poolFee: 3000, poolTickSpacing: 60 },
  { symbol: 'PEPE', name: 'Pepe', address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18, isNative: false, poolFee: 10000, poolTickSpacing: 200 },
]

// Sepolia tokens with a liquid, hookless ETH v4 pool. Discovered on-chain via
// scripts/probe-sepolia.mjs — testnet pools come and go, so re-run it if
// quotes start failing.
const SEPOLIA_TOKENS: TokenInfo[] = [
  // Circle's official Sepolia USDC
  { symbol: 'USDC', name: 'USD Coin', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6, isNative: false, poolFee: 3000, poolTickSpacing: 60 },
  { symbol: 'UNI', name: 'Uniswap', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, isNative: false, poolFee: 100, poolTickSpacing: 1 },
  // Chainlink's faucet LINK
  { symbol: 'LINK', name: 'Chainlink', address: '0x779877A7B0D9E8603169DdbD7836e478b4624789', decimals: 18, isNative: false, poolFee: 10000, poolTickSpacing: 200 },
]

// ---------------------------------------------------------------------------
// Per-chain Uniswap v4 deployments.
// Addresses from https://docs.uniswap.org/contracts/v4/deployments, each
// checked to have code on-chain.
// ---------------------------------------------------------------------------

export type ChainConfig = {
  chain: typeof mainnet | typeof sepolia
  name: string
  testnet: boolean
  universalRouter: `0x${string}`
  v4Quoter: `0x${string}`
  explorer: string
  tokens: TokenInfo[]
}

export const CHAIN_CONFIG = {
  [mainnet.id]: {
    chain: mainnet,
    name: 'Ethereum',
    testnet: false,
    universalRouter: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    v4Quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
    explorer: 'https://etherscan.io',
    tokens: MAINNET_TOKENS,
  },
  [sepolia.id]: {
    chain: sepolia,
    name: 'Sepolia',
    testnet: true,
    universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
    v4Quoter: '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227',
    explorer: 'https://sepolia.etherscan.io',
    tokens: SEPOLIA_TOKENS,
  },
} as const satisfies Record<number, ChainConfig>

export type SupportedChainId = keyof typeof CHAIN_CONFIG
export const SUPPORTED_CHAIN_IDS = [mainnet.id, sepolia.id] as const

export function isSupportedChain(id: number | undefined): id is SupportedChainId {
  return id !== undefined && id in CHAIN_CONFIG
}

/** Build the v4 PoolKey for a token's ETH pool. ETH (address 0) is currency0. */
export function poolKeyFor(token: TokenInfo) {
  if (token.poolFee === undefined || token.poolTickSpacing === undefined) {
    throw new Error(`No pool configured for ${token.symbol}`)
  }
  return {
    currency0: ETH.address,
    currency1: token.address,
    fee: token.poolFee,
    tickSpacing: token.poolTickSpacing,
    hooks: HOOKS,
  } as const
}

// --- ABIs ---------------------------------------------------------------

// V4Quoter.quoteExactInputSingle. Marked `view` so viem's readContract accepts
// it; on-chain it is a (revert-and-return) simulation that eth_call resolves.
export const QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export const UNIVERSAL_ROUTER_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const PERMIT2_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
] as const

export const MAX_UINT160 = (1n << 160n) - 1n
export const MAX_UINT256 = (1n << 256n) - 1n
