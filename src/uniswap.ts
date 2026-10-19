import { V4Planner, Actions } from '@uniswap/v4-sdk'
import { CommandType } from '@uniswap/universal-router-sdk'
import { encodeAbiParameters, toHex, type Hex, type PublicClient } from 'viem'
import {
  HOOK_DATA,
  PERMIT2,
  poolKeyFor,
  QUOTER_ABI,
  ZERO_ADDRESS,
  type TokenInfo,
} from './constants'

/**
 * Get an exact-input quote from a chain's V4Quoter for a token's ETH pool.
 * `zeroForOne === true` means swapping currency0 (ETH) -> currency1 (token).
 * Returns the expected output amount in the output token's smallest units.
 */
export async function getQuote(
  publicClient: PublicClient,
  quoter: `0x${string}`,
  token: TokenInfo,
  amountIn: bigint,
  zeroForOne: boolean,
): Promise<bigint> {
  const [amountOut] = await publicClient.readContract({
    address: quoter,
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
 * Build the Universal Router `execute` calldata for a single-hop v4 swap
 * between native ETH and `token`. Pass `permit` to have the router apply a
 * signed Permit2 allowance before swapping (ERC20 input only).
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
    permit?: SignedPermit
  },
): SwapCalldata {
  const { zeroForOne, amountIn, amountOutMinimum, permit } = params
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

  const commands: number[] = []
  const inputs: Hex[] = []
  if (permit) {
    commands.push(CommandType.PERMIT2_PERMIT)
    inputs.push(encodeAbiParameters(PERMIT2_PERMIT_PARAMS, [permit.permit, permit.signature]))
  }
  commands.push(CommandType.V4_SWAP)
  inputs.push(v4Planner.finalize() as Hex)

  // Native ETH input is paid via msg.value; ERC20 input is pulled via Permit2.
  const value = inputCurrency === ZERO_ADDRESS ? amountIn : 0n

  return { commands: toHex(new Uint8Array(commands)), inputs, value }
}

/** Apply slippage tolerance (in basis points) to a quoted output amount. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n
}
