// Discover Sepolia v4 pools paired with native ETH that actually have
// liquidity. Scans PoolManager `Initialize` logs for currency0 == ETH and no
// hooks, filters to pools with in-range liquidity via StateView (multicall),
// then probes those with the V4Quoter in both directions at a few sizes.
// A pool is usable when both directions quote and the round trip loses little.
//
//   node scripts/probe-sepolia.mjs
import { createPublicClient, http, parseAbiItem, parseUnits, formatUnits, erc20Abi } from 'viem'
import { sepolia } from 'viem/chains'

const POOL_MANAGER = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'
const V4_QUOTER = '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227'
const STATE_VIEW = '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c'
const ETH = '0x0000000000000000000000000000000000000000'
const FROM_BLOCK = 7_250_000n // shortly before the v4 Sepolia deployment
const STEP = 49_000n

// Tenderly's public gateway is the free Sepolia endpoint that serves wide eth_getLogs ranges.
const logs = createPublicClient({ chain: sepolia, transport: http('https://gateway.tenderly.co/public/sepolia') })
const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'),
})

const INITIALIZE = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
)
const STATE_VIEW_ABI = [
  {
    type: 'function',
    name: 'getLiquidity',
    stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
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

async function quote(poolKey, zeroForOne, amount) {
  try {
    const [out] = await client.readContract({
      address: V4_QUOTER,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ poolKey, zeroForOne, exactAmount: amount, hookData: '0x' }],
    })
    return out
  } catch {
    return null
  }
}

// 1. Collect every hookless ETH-paired pool.
const head = await logs.getBlockNumber()
const pools = []
for (let from = FROM_BLOCK; from <= head; from += STEP) {
  const to = from + STEP - 1n > head ? head : from + STEP - 1n
  const batch = await logs.getLogs({
    address: POOL_MANAGER,
    event: INITIALIZE,
    args: { currency0: ETH },
    fromBlock: from,
    toBlock: to,
  })
  for (const l of batch) {
    if (l.args.hooks.toLowerCase() === ETH) pools.push(l.args)
  }
}
console.error(`found ${pools.length} hookless ETH pools`)

// 2. Keep only pools with active liquidity (one multicall per 500 pools).
const liquid = []
for (let i = 0; i < pools.length; i += 500) {
  const chunk = pools.slice(i, i + 500)
  const res = await client.multicall({
    contracts: chunk.map((p) => ({ address: STATE_VIEW, abi: STATE_VIEW_ABI, functionName: 'getLiquidity', args: [p.id] })),
  })
  res.forEach((r, j) => {
    if (r.status === 'success' && r.result > 0n) liquid.push(chunk[j])
  })
}
console.error(`${liquid.length} have active liquidity`)

// 3. Probe with batched quotes: 0.01 ETH in, sell the output back, and
//    0.5 ETH in for depth. The quoter catches its own revert, so it multicalls.
async function quoteMany(items) {
  const out = []
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100)
    const res = await client.multicall({
      contracts: chunk.map(({ poolKey, zeroForOne, amount }) => ({
        address: V4_QUOTER,
        abi: QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{ poolKey, zeroForOne, exactAmount: amount, hookData: '0x' }],
      })),
    })
    for (const r of res) out.push(r.status === 'success' ? r.result[0] : null)
  }
  return out
}

const keyOf = (p) => ({ currency0: ETH, currency1: p.currency1, fee: p.fee, tickSpacing: p.tickSpacing, hooks: ETH })
const SMALL = parseUnits('0.01', 18)
const BIG = parseUnits('0.5', 18)

const small = await quoteMany(liquid.map((p) => ({ poolKey: keyOf(p), zeroForOne: true, amount: SMALL })))
const quoted = liquid.map((p, i) => ({ p, out: small[i] })).filter((x) => x.out && x.out > 0n)
console.error(`${quoted.length} return a quote`)

const [back, big] = await Promise.all([
  quoteMany(quoted.map(({ p, out }) => ({ poolKey: keyOf(p), zeroForOne: false, amount: out }))),
  quoteMany(quoted.map(({ p }) => ({ poolKey: keyOf(p), zeroForOne: true, amount: BIG }))),
])

const meta = await client.multicall({
  contracts: quoted.flatMap(({ p }) => [
    { address: p.currency1, abi: erc20Abi, functionName: 'symbol' },
    { address: p.currency1, abi: erc20Abi, functionName: 'decimals' },
  ]),
})

const results = quoted.map(({ p, out }, i) => {
  const symbol = meta[2 * i].status === 'success' ? meta[2 * i].result : '?'
  const decimals = meta[2 * i + 1].status === 'success' ? meta[2 * i + 1].result : 18
  return {
    symbol,
    address: p.currency1,
    decimals,
    fee: p.fee,
    tickSpacing: p.tickSpacing,
    perEth: Number(formatUnits(out, decimals)) * 100,
    roundTrip: back[i] ? Number(back[i]) / Number(SMALL) : 0,
    // how much of the 0.01-ETH rate survives at 0.5 ETH (1.0 = deep)
    depth: big[i] ? Number(big[i]) / 50 / Number(out) : 0,
  }
})

results.sort((a, b) => b.depth - a.depth || b.roundTrip - a.roundTrip)
for (const r of results) {
  console.log(
    `${String(r.symbol).padEnd(10)} ${r.address} dec=${r.decimals} fee=${r.fee} ts=${r.tickSpacing} 1 ETH≈${r.perEth.toPrecision(6)} roundTrip=${r.roundTrip.toFixed(4)} depth@0.5ETH=${r.depth.toFixed(3)}`,
  )
}
