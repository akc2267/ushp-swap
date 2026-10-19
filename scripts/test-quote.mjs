// Standalone sanity check: does the V4Quoter return a real quote for the
// ETH/USDC pool on mainnet right now? Run with the project's node_modules.
import { createPublicClient, http, parseUnits, formatUnits } from 'viem'
import { mainnet } from 'viem/chains'

const V4_QUOTER = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'
const ETH = '0x0000000000000000000000000000000000000000'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const POOL_KEY = { currency0: ETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ETH }

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
  transport: http(process.env.VITE_RPC_URL || 'https://eth.llamarpc.com'),
})

async function quote(amountIn, zeroForOne) {
  const [amountOut, gas] = await client.readContract({
    address: V4_QUOTER,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey: POOL_KEY, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
  })
  return { amountOut, gas }
}

console.log('Block:', await client.getBlockNumber())

const a = await quote(parseUnits('0.01', 18), true)
console.log(`0.01 ETH -> ${formatUnits(a.amountOut, 6)} USDC (gas est ${a.gas})`)

const b = await quote(parseUnits('100', 6), false)
console.log(`100 USDC -> ${formatUnits(b.amountOut, 18)} ETH (gas est ${b.gas})`)
