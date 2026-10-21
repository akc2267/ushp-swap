// Find hookless Uniswap v4 pools that pair a given token (default: USDT) with
// anything, and rank them by liquidity. Scans PoolManager `Initialize` logs
// for the token as currency0 or currency1, then probes each pool with the
// V4Quoter (batched via multicall) in both directions.
//
//   node scripts/probe-pair-pools.mjs mainnet [tokenAddress]
//   node scripts/probe-pair-pools.mjs sepolia <tokenAddress>
//
// Optional env: TARGETS=addr1,addr2 limits probing to pools against those
// tokens (use 0x000…000 for native ETH) — mainnet has 20k+ spam USDT pools.
// CACHE=path.json caches the log scan between runs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, http, parseAbiItem, formatUnits, erc20Abi } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

const NETWORKS = {
  mainnet: {
    chain: mainnet,
    poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
    fromBlock: 21_688_000n,
    logsRpc: 'https://gateway.tenderly.co/public/mainnet',
    rpc: process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com',
    defaultToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  },
  sepolia: {
    chain: sepolia,
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    quoter: '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227',
    fromBlock: 7_250_000n,
    logsRpc: 'https://gateway.tenderly.co/public/sepolia',
    rpc: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
  },
}

const net = NETWORKS[process.argv[2] ?? 'mainnet']
const TOKEN = (process.argv[3] ?? net.defaultToken).toLowerCase()
const ZERO = '0x0000000000000000000000000000000000000000'

const logs = createPublicClient({ chain: net.chain, transport: http(net.logsRpc) })
const client = createPublicClient({ chain: net.chain, transport: http(net.rpc), batch: { multicall: true } })

const INITIALIZE = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
)
const QUOTER_ABI = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'view', inputs: [{ name: 'p', type: 'tuple', components: [{ name: 'poolKey', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { name: 'zeroForOne', type: 'bool' }, { name: 'exactAmount', type: 'uint128' }, { name: 'hookData', type: 'bytes' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'g', type: 'uint256' }] }]

// 1. All hookless pools containing TOKEN (adaptive log windows).
const TARGETS = process.env.TARGETS ? new Set(process.env.TARGETS.toLowerCase().split(',')) : null
const head = await logs.getBlockNumber()
let pools = []
const cached = process.env.CACHE && existsSync(process.env.CACHE)
if (cached) pools = JSON.parse(readFileSync(process.env.CACHE, 'utf8'))
for (const side of cached ? [] : ['currency0', 'currency1']) {
  let step = 200_000n
  for (let from = net.fromBlock; from <= head; ) {
    const to = from + step - 1n > head ? head : from + step - 1n
    try {
      const batch = await logs.getLogs({ address: net.poolManager, event: INITIALIZE, args: { [side]: TOKEN }, fromBlock: from, toBlock: to })
      for (const l of batch) {
        if (l.args.hooks.toLowerCase() !== ZERO) continue
        const { currency0, currency1, fee, tickSpacing } = l.args
        pools.push({ currency0, currency1, fee, tickSpacing })
      }
      from = to + 1n
    } catch {
      step = step / 2n
      if (step < 1000n) throw new Error('log range too small')
    }
  }
}
if (process.env.CACHE && !cached) writeFileSync(process.env.CACHE, JSON.stringify(pools))
console.error(`found ${pools.length} hookless pools with ${TOKEN}`)
if (TARGETS) {
  pools = pools.filter((p) => TARGETS.has((p.currency0.toLowerCase() === TOKEN ? p.currency1 : p.currency0).toLowerCase()))
  console.error(`${pools.length} against target tokens`)
}

// 2. Probe each pool with the token's decimals: ~100 units in, back out, and ~2000 units for depth.
const tokenDecimals = await client.readContract({ address: TOKEN, abi: erc20Abi, functionName: 'decimals' })
const SMALL = 100n * 10n ** BigInt(tokenDecimals)
const BIG = 2000n * 10n ** BigInt(tokenDecimals)
const quote = (p, zeroForOne, amount) =>
  client
    .readContract({ address: net.quoter, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [{ poolKey: { currency0: p.currency0, currency1: p.currency1, fee: p.fee, tickSpacing: p.tickSpacing, hooks: ZERO }, zeroForOne, exactAmount: amount, hookData: '0x' }] })
    .then((r) => r[0])
    .catch(() => null)

const results = await Promise.all(
  pools.map(async (p) => {
    const tokenIs0 = p.currency0.toLowerCase() === TOKEN
    const other = tokenIs0 ? p.currency1 : p.currency0
    const out = await quote(p, tokenIs0, SMALL)
    if (!out) return null
    const [back, big] = await Promise.all([quote(p, !tokenIs0, out), quote(p, tokenIs0, BIG)])
    let symbol = 'ETH'
    let decimals = 18
    if (other.toLowerCase() !== ZERO) {
      ;[symbol, decimals] = await Promise.all([
        client.readContract({ address: other, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
        client.readContract({ address: other, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
      ])
    }
    return {
      symbol,
      other,
      fee: p.fee,
      tickSpacing: p.tickSpacing,
      per100: Number(formatUnits(out, decimals)),
      roundTrip: back ? Number(back) / Number(SMALL) : 0,
      depth: big ? Number(big) / 20 / Number(out) : 0, // share of the 100-unit rate kept at 2000 units
    }
  }),
)

for (const r of results.filter(Boolean).sort((a, b) => a.symbol.localeCompare(b.symbol) || b.depth - a.depth)) {
  console.log(
    `${String(r.symbol).padEnd(8)} ${r.other} fee=${r.fee} ts=${r.tickSpacing} 100→${r.per100.toPrecision(6)} roundTrip=${r.roundTrip.toFixed(4)} depth@2000=${r.depth.toFixed(3)}`,
  )
}
