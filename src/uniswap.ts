import { V4Planner, Actions } from '@uniswap/v4-sdk'
import { RoutePlanner, CommandType } from '@uniswap/universal-router-sdk'
import type { PublicClient } from 'viem'
import {
  HOOK_DATA,
  poolKeyFor,
  QUOTER_ABI,
  V4_QUOTER,
  ZERO_ADDRESS,
  type TokenInfo,
} from './constants'

/**
 * Get an exact-input quote from the V4Quoter for a token's ETH pool.
 * `zeroForOne === true` means swapping currency0 (ETH) -> currency1 (token).
 * Returns the expected output amount in the output token's smallest units.
 */
export async function getQuote(
  publicClient: PublicClient,
  token: TokenInfo,
  amountIn: bigint,
  zeroForOne: boolean,
): Promise<bigint> {
  const [amountOut] = await publicClient.readContract({
    address: V4_QUOTER,
    abi: QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        poolKey: poolKeyFor(token),
        zeroForOne,
        exactAmount: amountIn,
        hookData: HOOK_DATA,
      },
    ],
  })
  return amountOut
}

export type SwapCalldata = {
  commands: `0x${string}`
  inputs: `0x${string}`[]
  value: bigint
}

/**
 * Build the Universal Router `execute` calldata for a single-hop v4 swap
 * between native ETH and `token`.
 *
 * NOTE: in the installed SDK versions `RoutePlanner.inputs` does NOT correctly
 * ABI-encode the V4_SWAP payload — it must be `v4Planner.finalize()`, which is
 * the proper abi.encode(bytes actions, bytes[] params). We verified this
 * empirically before sending real funds.
 */
export function buildV4SwapCalldata(
  token: TokenInfo,
  params: {
    zeroForOne: boolean
    amountIn: bigint
    amountOutMinimum: bigint
  },
): SwapCalldata {
  const { zeroForOne, amountIn, amountOutMinimum } = params
  const poolKey = poolKeyFor(token)

  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0

  const config = {
    poolKey,
    zeroForOne,
    amountIn: amountIn.toString(),
    amountOutMinimum: amountOutMinimum.toString(),
    hookData: HOOK_DATA,
  }

  const v4Planner = new V4Planner()
  v4Planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [config])
  v4Planner.addAction(Actions.SETTLE_ALL, [inputCurrency, amountIn.toString()])
  v4Planner.addAction(Actions.TAKE_ALL, [outputCurrency, amountOutMinimum.toString()])

  const encodedActions = v4Planner.finalize() as `0x${string}`

  const routePlanner = new RoutePlanner()
  routePlanner.addCommand(CommandType.V4_SWAP, [v4Planner.actions, v4Planner.params])

  // Native ETH input is paid via msg.value; ERC20 input is pulled via Permit2.
  const value = inputCurrency === ZERO_ADDRESS ? amountIn : 0n

  return {
    commands: routePlanner.commands as `0x${string}`,
    inputs: [encodedActions],
    value,
  }
}

/** Apply slippage tolerance (in basis points) to a quoted output amount. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n
}
