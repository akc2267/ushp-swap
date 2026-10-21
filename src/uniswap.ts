import { V4Planner, Actions } from '@uniswap/v4-sdk'
import { CommandType } from '@uniswap/universal-router-sdk'
import { encodeAbiParameters, toHex, type Hex, type PublicClient } from 'viem'
import { HOOK_DATA, HOOKS, PERMIT2, QUOTER_ABI, type PoolDef, type TokenInfo } from './constants'

// ---------------------------------------------------------------------------
// Routing
//
// Each chain lists a handful of known pools (a small graph of currencies).
// A route is a v4 path from tokenIn to tokenOut through up to MAX_HOPS pools;
// every route is quoted and the best output wins. A one-hop path is simply a
// direct pool, so direct and multi-hop swaps share the same code.
// ---------------------------------------------------------------------------

const MAX_HOPS = 2

export type PathKey = {
  intermediateCurrency: `0x${string}`
  fee: number
  tickSpacing: number
  hooks: `0x${string}`
  hookData: Hex
}

export type Quote = { amountOut: bigint; path: PathKey[] }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** All simple paths from `from` to `to` through the pool graph (≤ MAX_HOPS). */
export function findPaths(pools: PoolDef[], from: `0x${string}`, to: `0x${string}`): PathKey[][] {
  const paths: PathKey[][] = []
  const walk = (current: `0x${string}`, path: PathKey[], visited: string[]) => {
    for (const pool of pools) {
      const next = same(pool.a, current) ? pool.b : same(pool.b, current) ? pool.a : null
      if (!next || visited.some((v) => same(v, next))) continue
      const hop: PathKey = { intermediateCurrency: next, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: HOOKS, hookData: HOOK_DATA }
      if (same(next, to)) paths.push([...path, hop])
      else if (path.length + 1 < MAX_HOPS) walk(next, [...path, hop], [...visited, next])
    }
  }
  walk(from, [], [from])
  return paths
}

/**
 * Quote every route between two tokens with the chain's V4Quoter and return
 * the one with the best output. Throws if no route can be quoted.
 */
export async function getBestQuote(
  publicClient: PublicClient,
  quoter: `0x${string}`,
  pools: PoolDef[],
  tokenIn: TokenInfo,
  tokenOut: TokenInfo,
  amountIn: bigint,
): Promise<Quote> {
  const quotes = await Promise.all(
    findPaths(pools, tokenIn.address, tokenOut.address).map((path) =>
      publicClient
        .readContract({
          address: quoter,
          abi: QUOTER_ABI,
          functionName: 'quoteExactInput',
          args: [{ exactCurrency: tokenIn.address, path, exactAmount: amountIn }],
        })
        .then(([amountOut]) => ({ amountOut, path }))
        .catch(() => null),
    ),
  )
  const best = quotes.reduce<Quote | null>((b, q) => (q && (!b || q.amountOut > b.amountOut) ? q : b), null)
  if (!best || best.amountOut === 0n) throw new Error(`No route for ${tokenIn.symbol} → ${tokenOut.symbol}`)
  return best
}

// ---------------------------------------------------------------------------
// Permit2 signature approvals
//
// Instead of an on-chain Permit2.approve() transaction, the user signs an
// EIP-712 PermitSingle for exactly this swap's amount and the Universal Router
// applies it (PERMIT2_PERMIT command) in the same transaction as the swap.
// Wallets render this as a readable "spending cap" request for one token,
// amount and spender, which is far less alarming than an unlimited approval.
// ---------------------------------------------------------------------------

export type PermitSingle = {
  details: { token: `0x${string}`; amount: bigint; expiration: number; nonce: number }
  spender: `0x${string}`
  sigDeadline: bigint
}

export type SignedPermit = { permit: PermitSingle; signature: Hex }

/** EIP-712 payload for a Permit2 PermitSingle, ready for signTypedData. */
export function permit2TypedData(chainId: number, permit: PermitSingle) {
  return {
    domain: { name: 'Permit2', chainId, verifyingContract: PERMIT2 },
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    primaryType: 'PermitSingle',
    message: permit,
  } as const
}

// Universal Router PERMIT2_PERMIT input: abi.encode(PermitSingle, bytes signature)
const PERMIT2_PERMIT_PARAMS = [
  {
    type: 'tuple',
    components: [
      {
        name: 'details',
        type: 'tuple',
        components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' },
          { name: 'nonce', type: 'uint48' },
        ],
      },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' },
    ],
  },
  { type: 'bytes' },
] as const

export type SwapCalldata = {
  commands: `0x${string}`
  inputs: `0x${string}`[]
  value: bigint
}

/**
 * Build the Universal Router `execute` calldata for an exact-input v4 swap
 * along `path` (from getBestQuote). Pass `permit` to have the router apply a
 * signed Permit2 allowance first.
 *
 * NOTE: in the installed SDK versions `RoutePlanner.inputs` does NOT correctly
 * ABI-encode the V4_SWAP payload — it must be `v4Planner.finalize()`, which is
 * the proper abi.encode(bytes actions, bytes[] params). We verified this
 * empirically before sending real funds.
 */
export function buildV4SwapCalldata(params: {
  tokenIn: TokenInfo
  tokenOut: TokenInfo
  path: PathKey[]
  amountIn: bigint
  amountOutMinimum: bigint
  permit?: SignedPermit
}): SwapCalldata {
  const { tokenIn, tokenOut, path, amountIn, amountOutMinimum, permit } = params

  const v4Planner = new V4Planner()
  v4Planner.addAction(Actions.SWAP_EXACT_IN, [
    {
      currencyIn: tokenIn.address,
      path,
      amountIn: amountIn.toString(),
      amountOutMinimum: amountOutMinimum.toString(),
    },
  ])
  v4Planner.addAction(Actions.SETTLE_ALL, [tokenIn.address, amountIn.toString()])
  v4Planner.addAction(Actions.TAKE_ALL, [tokenOut.address, amountOutMinimum.toString()])

  const commands: number[] = []
  const inputs: Hex[] = []
  if (permit) {
    commands.push(CommandType.PERMIT2_PERMIT)
    inputs.push(encodeAbiParameters(PERMIT2_PERMIT_PARAMS, [permit.permit, permit.signature]))
  }
  commands.push(CommandType.V4_SWAP)
  inputs.push(v4Planner.finalize() as Hex)

  // Native ETH input would be paid via msg.value; ERC20 input is pulled via Permit2.
  const value = tokenIn.isNative ? amountIn : 0n

  return { commands: toHex(new Uint8Array(commands)), inputs, value }
}

/** Apply slippage tolerance (in basis points) to a quoted output amount. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n
}
