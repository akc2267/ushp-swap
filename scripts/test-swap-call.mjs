// Simulate the actual ETH->USDC execute() call from the user's address to
// confirm the swap calldata is valid (i.e. the error is plumbing, not a revert).
import { createPublicClient, http, parseUnits, encodeFunctionData } from 'viem'
import { mainnet } from 'viem/chains'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { V4Planner, Actions } = require('@uniswap/v4-sdk')
const { RoutePlanner, CommandType } = require('@uniswap/universal-router-sdk')

const UR = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'
const Q = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'
const ETH = '0x0000000000000000000000000000000000000000'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USER = '0x557De6bbB50A9615b5175C40817c4644e6eA11c3'
const poolKey = { currency0: ETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ETH }

const QUOTER_ABI = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'view', inputs: [{ name: 'p', type: 'tuple', components: [{ name: 'poolKey', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }, { name: 'zeroForOne', type: 'bool' }, { name: 'exactAmount', type: 'uint128' }, { name: 'hookData', type: 'bytes' }] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'g', type: 'uint256' }] }]
const UR_ABI = [{ type: 'function', name: 'execute', stateMutability: 'payable', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [] }]

const c = createPublicClient({ chain: mainnet, transport: http(process.env.VITE_RPC_URL || 'https://ethereum-rpc.publicnode.com') })

const amountIn = parseUnits('0.0005', 18)
const [quoted] = await c.readContract({ address: Q, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [{ poolKey, zeroForOne: true, exactAmount: amountIn, hookData: '0x' }] })
const minOut = (quoted * 995n) / 1000n
console.log('quote:', quoted.toString(), 'minOut:', minOut.toString())

const v4 = new V4Planner()
v4.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{ poolKey, zeroForOne: true, amountIn: amountIn.toString(), amountOutMinimum: minOut.toString(), hookData: '0x' }])
v4.addAction(Actions.SETTLE_ALL, [ETH, amountIn.toString()])
v4.addAction(Actions.TAKE_ALL, [USDC, minOut.toString()])
const encodedActions = v4.finalize()
const route = new RoutePlanner()
route.addCommand(CommandType.V4_SWAP, [v4.actions, v4.params])
const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
const data = encodeFunctionData({ abi: UR_ABI, functionName: 'execute', args: [route.commands, [encodedActions], deadline] })

try {
  const gas = await c.estimateGas({ account: USER, to: UR, data, value: amountIn })
  console.log('✅ estimateGas OK:', gas.toString(), '(swap calldata is valid)')
} catch (e) {
  console.log('❌ estimateGas reverted:', e.shortMessage || e.message)
}
