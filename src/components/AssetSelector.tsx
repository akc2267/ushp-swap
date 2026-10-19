import { useEffect, useMemo, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { usePublicClient } from 'wagmi'
import { ETH, TOKENS, type TokenInfo } from '../constants'
import { getQuote } from '../uniswap'
import { CloseIcon, SearchIcon, TokenIcon, TrendingIcon } from './icons'

function formatUsd(price: number): string {
  if (price >= 1) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (price >= 0.01) return `$${price.toFixed(4)}`
  return `$${price.toPrecision(3)}`
}

export function AssetSelector({
  selected,
  onSelect,
  onClose,
}: {
  selected: TokenInfo
  onSelect: (token: TokenInfo) => void
  onClose: () => void
}) {
  const publicClient = usePublicClient()
  const [query, setQuery] = useState('')
  const [prices, setPrices] = useState<Record<string, number>>({})

  // Live USD prices, derived purely from on-chain quotes:
  // tokenPerEth = quote(1 ETH -> token); ethUsd = USDC-per-ETH; so the USD
  // price of a token is ethUsd / tokenPerEth.
  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    const oneEth = parseUnits('1', 18)
    ;(async () => {
      const entries = await Promise.all(
        TOKENS.map(async (t) => {
          try {
            const out = await getQuote(publicClient, t, oneEth, true)
            const perEth = Number(formatUnits(out, t.decimals))
            return [t.symbol, perEth] as const
          } catch {
            return [t.symbol, NaN] as const
          }
        }),
      )
      if (cancelled) return
      const perEth = Object.fromEntries(entries)
      const ethUsd = perEth['USDC']
      const result: Record<string, number> = {}
      if (ethUsd && Number.isFinite(ethUsd)) {
        for (const [sym, v] of entries) {
          if (Number.isFinite(v) && v > 0) result[sym] = ethUsd / v
        }
      }
      setPrices(result)
    })()
    return () => {
      cancelled = true
    }
  }, [publicClient])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TOKENS
    return TOKENS.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    )
  }, [query])

  const ethMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return !q || ETH.symbol.toLowerCase().includes(q) || ETH.name.toLowerCase().includes(q)
  }, [query])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Search</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="search-box">
          <SearchIcon />
          <input
            autoFocus
            placeholder="Search asset name or ticker"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="asset-list">
          <div className="list-section-head">
            <TrendingIcon />
            <span>Trending</span>
          </div>

          {ethMatches && (
            <div className="asset-row asset-row--base" title="Base currency — always one side of the pair">
              <div className="asset-row-left">
                <TokenIcon symbol={ETH.symbol} size={40} />
                <div className="asset-names">
                  <span className="asset-ticker">{ETH.symbol}</span>
                  <span className="asset-name">{ETH.name}</span>
                </div>
              </div>
              <div className="asset-row-right">
                {prices['USDC'] ? <span className="asset-price">{formatUsd(prices['USDC'])}</span> : null}
                <span className="asset-base-tag">Base</span>
              </div>
            </div>
          )}

          {filtered.map((t) => {
            const isSelected = t.symbol === selected.symbol
            return (
              <button
                key={t.symbol}
                className={`asset-row ${isSelected ? 'asset-row--selected' : ''}`}
                onClick={() => onSelect(t)}
              >
                <div className="asset-row-left">
                  <TokenIcon symbol={t.symbol} size={40} />
                  <div className="asset-names">
                    <span className="asset-ticker">{t.symbol}</span>
                    <span className="asset-name">{t.name}</span>
                  </div>
                </div>
                <div className="asset-row-right">
                  {prices[t.symbol] ? (
                    <span className="asset-price">{formatUsd(prices[t.symbol])}</span>
                  ) : (
                    <span className="asset-price muted-price">—</span>
                  )}
                  {isSelected ? <span className="asset-base-tag">Selected</span> : null}
                </div>
              </button>
            )
          })}

          {filtered.length === 0 && !ethMatches && (
            <div className="empty-state">No assets match “{query}”.</div>
          )}
        </div>
      </div>
    </div>
  )
}
