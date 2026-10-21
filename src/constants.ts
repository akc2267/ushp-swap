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
}

/** A hookless Uniswap v4 pool between two currencies (order doesn't matter). */
export type PoolDef = {
  a: `0x${string}`
  b: `0x${string}`
  fee: number
  tickSpacing: number
}

// Native ETH is never bought or sold directly — it only appears as an
// intermediate hop inside a single swap (e.g. USDC -> ETH -> LINK).
export const ETH: TokenInfo = {
  symbol: 'ETH',
  name: 'Ethereum',
  address: ZERO_ADDRESS,
  decimals: 18,
  isNative: true,
}

const tok = (symbol: string, name: string, address: `0x${string}`, decimals: number): TokenInfo => ({
  symbol,
  name,
  address,
  decimals,
  isNative: false,
})

// Every swap is USDC <-> LINK. Pools discovered on-chain and ranked by
// liquidity with scripts/probe-pair-pools.mjs; the app quotes each route
// (direct, or through ETH) and takes the best. Testnet pools come and go and
// their prices are arbitrary — re-run the probe if Sepolia quotes fail.
const MAINNET_USDC = tok('USDC', 'USD Coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6)
const MAINNET_LINK = tok('LINK', 'Chainlink', '0x514910771AF9Ca656af840dff83E8264EcF986CA', 18)
const SEPOLIA_USDC = tok('USDC', 'USD Coin', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 6) // Circle's official Sepolia USDC
const SEPOLIA_LINK = tok('LINK', 'Chainlink', '0x779877A7B0D9E8603169DdbD7836e478b4624789', 18) // Chainlink faucet LINK

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
  /** The token every swap is paired against (USDC). */
  base: TokenInfo
  /** Tokens the user can pick, in display order (the first is the default). */
  tokens: TokenInfo[]
  pools: PoolDef[]
}

export const CHAIN_CONFIG = {
  [mainnet.id]: {
    chain: mainnet,
    name: 'Ethereum',
    testnet: false,
    universalRouter: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
    v4Quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
    explorer: 'https://etherscan.io',
    base: MAINNET_USDC,
    tokens: [MAINNET_LINK],
    pools: [
      { a: MAINNET_USDC.address, b: MAINNET_LINK.address, fee: 3000, tickSpacing: 60 },
      { a: ZERO_ADDRESS, b: MAINNET_USDC.address, fee: 500, tickSpacing: 10 },
      { a: ZERO_ADDRESS, b: MAINNET_LINK.address, fee: 3000, tickSpacing: 60 },
    ],
  },
  [sepolia.id]: {
    chain: sepolia,
    name: 'Sepolia',
    testnet: true,
    universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
    v4Quoter: '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227',
    explorer: 'https://sepolia.etherscan.io',
    base: SEPOLIA_USDC,
    tokens: [SEPOLIA_LINK],
    pools: [
      { a: SEPOLIA_USDC.address, b: SEPOLIA_LINK.address, fee: 9000, tickSpacing: 90 },
      { a: ZERO_ADDRESS, b: SEPOLIA_USDC.address, fee: 3000, tickSpacing: 60 },
      { a: ZERO_ADDRESS, b: SEPOLIA_LINK.address, fee: 10000, tickSpacing: 200 },
    ],
  },
} as const satisfies Record<number, ChainConfig>

export type SupportedChainId = keyof typeof CHAIN_CONFIG
export const SUPPORTED_CHAIN_IDS = [mainnet.id, sepolia.id] as const

export function isSupportedChain(id: number | undefined): id is SupportedChainId {
  return id !== undefined && id in CHAIN_CONFIG
}

// --- ABIs ---------------------------------------------------------------

// V4Quoter.quoteExactInput (multi-hop; a one-hop path is a direct pool).
// Marked `view` so viem's readContract accepts it; on-chain it is a
// (revert-and-return) simulation that eth_call resolves.
const PATH_KEY_COMPONENTS = [
  { name: 'intermediateCurrency', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
  { name: 'hookData', type: 'bytes' },
] as const

export const QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInput',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'exactCurrency', type: 'address' },
          { name: 'path', type: 'tuple[]', components: PATH_KEY_COMPONENTS },
          { name: 'exactAmount', type: 'uint128' },
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
