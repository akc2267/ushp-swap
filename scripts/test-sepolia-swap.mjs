// Simulate ETH -> token execute() calls on Sepolia for every token the app
// lists there, to confirm the router address, pool keys and calldata are all
// valid. Uses an eth_call state override to fund a throwaway sender, so no
// real wallet or testnet ETH is needed.
//
//   node scripts/test-sepolia-swap.mjs
import { createPublicClient, http, parseUnits, encodeFunctionData, formatUnits } from 'viem'
import { sepolia } from 'viem/chains'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { V4Planner, Actions } = require('@uniswap/v4-sdk')
const { RoutePlanner, CommandType } = require('@uniswap/universal-router-sdk')

const UR = '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b'
const Q = '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227'
const ETH = '0x0000000000000000000000000000000000000000'
const SENDER = '0x000000000000000000000000000000000000dEaD'
const TOKENS = [
  { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6, fee: 3000, tickSpacing: 60 },
  { symbol: 'UNI', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, fee: 100, tickSpacing: 1 },
  { symbol: 'LINK', address: '0x779877A7B0D9E8603169DdbD7836e478b4624789', decimals: 18, fee: 10000, tickSpacing: 200 },
]

const QUOTER_ABI = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'view', inputs: [{ name: 'p', type: 'tuple', components: [{ name: 'poolKey', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { name: 'zeroForOne', type: 'bool' }, { name: 'exactAmount', type: 'uint128' }, { name: 'hookData', type: 'bytes' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'g', type: 'uint256' }] }]
const UR_ABI = [{ type: 'function', name: 'execute', stateMutability: 'payable', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [] }]

const c = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com') })
const amountIn = parseUnits('0.01', 18)

for (const t of TOKENS) {
  const poolKey = { currency0: ETH, currency1: t.address, fee: t.fee, tickSpacing: t.tickSpacing, hooks: ETH }
  const [quoted] = await c.readContract({ address: Q, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [{ poolKey, zeroForOne: true, exactAmount: amountIn, hookData: '0x' }] })
  const minOut = (quoted * 995n) / 1000n

  const v4 = new V4Planner()
  v4.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{ poolKey, zeroForOne: true, amountIn: amountIn.toString(), amountOutMinimum: minOut.toString(), hookData: '0x' }])
  v4.addAction(Actions.SETTLE_ALL, [ETH, amountIn.toString()])
  v4.addAction(Actions.TAKE_ALL, [t.address, minOut.toString()])
  const route = new RoutePlanner()
  route.addCommand(CommandType.V4_SWAP, [v4.actions, v4.params])
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
  const data = encodeFunctionData({ abi: UR_ABI, functionName: 'execute', args: [route.commands, [v4.finalize()], deadline] })

  try {
    await c.call({ account: SENDER, to: UR, data, value: amountIn, stateOverride: [{ address: SENDER, balance: parseUnits('1', 18) }] })
    console.log(`✅ ${t.symbol.padEnd(5)} 0.01 ETH -> ${formatUnits(quoted, t.decimals)} ${t.symbol} — execute() simulates OK`)
  } catch (e) {
    console.log(`❌ ${t.symbol.padEnd(5)} execute() reverted: ${e.shortMessage || e.message}`)
  }
}
