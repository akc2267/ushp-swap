'use client'

import { useQuery } from '@tanstack/react-query'
import { formatUnits, parseUnits } from 'viem'
import { usePublicClient } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { CHAIN_CONFIG, ETH, MAINNET_TOKENS } from '../constants'
import { getQuote } from '../uniswap'

/**
 * Live USD prices by symbol, derived purely from mainnet v4 quotes:
 * tokenPerEth = quote(1 ETH -> token); ethUsd = USDC-per-ETH; so a token's USD
 * price is ethUsd / tokenPerEth.
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
      const oneEth = parseUnits('1', 18)
      const quoter = CHAIN_CONFIG[mainnet.id].v4Quoter
      const entries = await Promise.all(
        MAINNET_TOKENS.map(async (t) => {
          try {
            const out = await getQuote(publicClient!, quoter, t, oneEth, true)
            return [t.symbol, Number(formatUnits(out, t.decimals))] as const
          } catch {
            return [t.symbol, NaN] as const
          }
        }),
      )
      const ethUsd = Object.fromEntries(entries)['USDC']
      const prices: Record<string, number> = {}
      if (ethUsd && Number.isFinite(ethUsd)) {
        prices[ETH.symbol] = ethUsd
        for (const [sym, perEth] of entries) {
          if (Number.isFinite(perEth) && perEth > 0) prices[sym] = ethUsd / perEth
        }
      }
      return prices
    },
  })
}

export function formatUsd(price: number): string {
  if (price >= 1) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (price >= 0.01) return `$${price.toFixed(4)}`
  return `$${price.toPrecision(3)}`
}
