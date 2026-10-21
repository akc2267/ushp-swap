'use client'

import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'viem'
import { usePublicClient } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { CHAIN_CONFIG } from '../constants'
import { getBestQuote } from '../uniswap'

/**
 * Live USD prices by symbol, from mainnet v4 quotes against USDC (taken as
 * $1): a token's price is $100 divided by how much of it 100 USDC buys.
 *
 * Always priced on mainnet, even when trading on Sepolia — testnet pool prices
 * are arbitrary, so a "$100" preset should mean $100 at real market prices.
 */
export function useUsdPrices() {
  const publicClient = usePublicClient({ chainId: mainnet.id })
  return useQuery({
    queryKey: ['usd-prices'],
    enabled: !!publicClient,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { base, tokens, pools, v4Quoter } = CHAIN_CONFIG[mainnet.id]
      const usdIn = parseUnits('100', base.decimals)
      const prices: Record<string, number> = { [base.symbol]: 1 }
      await Promise.all(
        tokens.map(async (t) => {
          try {
            const { amountOut } = await getBestQuote(publicClient!, v4Quoter, pools, base, t, usdIn)
            const units = Number(formatUnits(amountOut, t.decimals))
            if (units > 0) prices[t.symbol] = 100 / units
          } catch {
            // leave unpriced
          }
        }),
      )
      return prices
    },
  })
}

export function formatUsd(price: number): string {
  if (price >= 1) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (price >= 0.01) return `$${price.toFixed(4)}`
  return `$${price.toPrecision(3)}`
}
