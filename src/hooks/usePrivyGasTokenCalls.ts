'use client'

import { useCallback } from 'react'
import { toHex, type Hex } from 'viem'
import { useAuthorizationSignature, usePrivyClient_experimental } from '@privy-io/react-auth'
import { WalletRpc } from '@privy-io/routes'

// Same request lifetime the Privy SDK uses for its own wallet RPC calls.
const REQUEST_TTL_MS = 30 * 60 * 1000

export type GasTokenCall = { to: Hex; data: Hex; value: bigint }

/**
 * Sends a batch of calls from a Privy embedded wallet with gas paid in an
 * ERC-20 such as USDC (Privy's "user pays" gas, configured under Fee
 * sponsorship → Custom gas payment tokens). Privy executes the batch
 * atomically as one user operation, bundling the paymaster's token approval.
 *
 * Privy's React SDK doesn't expose `sponsor_options` yet, so this mirrors the
 * SDK's own wallet-RPC call (`rpc` in @privy-io/js-sdk-core): sign the request
 * with the user's authorization key, then send it with the user's session.
 * No app secret is involved and no Privy modal is shown.
 *
 * Resolves once Privy accepts the batch (returns its transaction id); the
 * batch may still revert on-chain, so callers must confirm the outcome.
 */
export function usePrivyGasTokenCalls() {
  const privy = usePrivyClient_experimental()
  const { generateAuthorizationSignature } = useAuthorizationSignature()

  return useCallback(
    async ({
      walletId,
      chainId,
      calls,
      asset,
    }: {
      walletId: string
      chainId: number
      calls: GasTokenCall[]
      asset: string
    }): Promise<string> => {
      const body = {
        method: 'wallet_sendCalls' as const,
        caip2: `eip155:${chainId}`,
        chain_type: 'ethereum' as const,
        sponsor: true,
        sponsor_options: { asset },
        params: { calls: calls.map((c) => ({ to: c.to, data: c.data, value: toHex(c.value) })) },
      }
      const expiry = String(Date.now() + REQUEST_TTL_MS)
      const url = privy.getCompiledPath(WalletRpc, { params: { wallet_id: walletId } })
      const { signature } = await generateAuthorizationSignature({
        version: 1,
        url,
        method: 'POST',
        headers: { 'privy-app-id': privy.app.appId, 'privy-request-expiry': expiry },
        body,
      })
      const res = await privy.fetchPrivyRoute(WalletRpc, {
        body,
        params: { wallet_id: walletId },
        headers: { 'privy-authorization-signature': signature, 'privy-request-expiry': expiry },
      })
      if (res.method !== 'wallet_sendCalls' || !('transaction_id' in res.data)) {
        throw new Error('Unexpected response from Privy')
      }
      return res.data.transaction_id
    },
    [privy, generateAuthorizationSignature],
  )
}
