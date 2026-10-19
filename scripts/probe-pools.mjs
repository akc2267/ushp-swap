// Discover which mainnet tokens have a live v4 pool paired with native ETH,
// and at which fee tier, by probing the V4Quoter. A non-reverting quote means
// the pool exists and has liquidity. We keep the tier with the best output.
import { createPublicClient, http, parseUnits, formatUnits } from 'viem'
import { mainnet } from 'viem/chains'

const V4_QUOTER = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'
const ETH = '0x0000000000000000000000000000000000000000'

const TOKENS = [
  { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
  { symbol: 'WBTC', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  { symbol: 'UNI', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18 },
  { symbol: 'LINK', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
  { symbol: 'PEPE', address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18 },
  { symbol: 'AAVE', address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', decimals: 18 },
  { symbol: 'LDO', address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', decimals: 18 },
  { symbol: 'ENS', address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', decimals: 18 },
]

const FEE_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
]

const QUOTER_ABI = [
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
]

const client = createPublicClient({
  chain: mainnet,
  transport: http(process.env.VITE_RPC_URL || 'https://ethereum-rpc.publicnode.com'),
})

const amountIn = parseUnits('0.1', 18) // 0.1 ETH probe

for (const t of TOKENS) {
  // native ETH (0x0) is always the lower address => currency0
  let best = null
  for (const tier of FEE_TIERS) {
    try {
      const [amountOut] = await client.readContract({
        address: V4_QUOTER,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: { currency0: ETH, currency1: t.address, fee: tier.fee, tickSpacing: tier.tickSpacing, hooks: ETH },
            zeroForOne: true,
            exactAmount: amountIn,
            hookData: '0x',
          },
        ],
      })
      if (amountOut > 0n && (!best || amountOut > best.amountOut)) {
        best = { ...tier, amountOut }
      }
    } catch {
      // pool doesn't exist at this tier
    }
  }
  if (best) {
    console.log(
      `✅ ${t.symbol.padEnd(5)} fee=${String(best.fee).padStart(5)} ts=${String(best.tickSpacing).padStart(3)}  0.1 ETH -> ${formatUnits(best.amountOut, t.decimals)} ${t.symbol}`,
    )
  } else {
    console.log(`❌ ${t.symbol.padEnd(5)} no ETH pool found`)
  }
}
