'use client'

import { useMemo, useState } from 'react'
import type { TokenInfo } from '../constants'
import { formatUsd, useUsdPrices } from '../hooks/useUsdPrices'
import { CloseIcon, SearchIcon, TokenIcon, TrendingIcon } from './icons'

export function AssetSelector({
  base,
  tokens,
  selected,
  onSelect,
  onClose,
}: {
  base: TokenInfo
  tokens: TokenInfo[]
  selected: TokenInfo
  onSelect: (token: TokenInfo) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  // USD prices come from mainnet regardless of the active chain.
  const { data: prices = {} } = useUsdPrices()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tokens
    return tokens.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    )
  }, [query, tokens])

  const baseMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return !q || base.symbol.toLowerCase().includes(q) || base.name.toLowerCase().includes(q)
  }, [query, base])

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

          {baseMatches && (
            <div className="asset-row asset-row--base" title="Base currency — always one side of the pair">
              <div className="asset-row-left">
                <TokenIcon symbol={base.symbol} size={40} />
                <div className="asset-names">
                  <span className="asset-ticker">{base.symbol}</span>
                  <span className="asset-name">{base.name}</span>
                </div>
              </div>
              <div className="asset-row-right">
                {prices[base.symbol] ? <span className="asset-price">{formatUsd(prices[base.symbol])}</span> : null}
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

          {filtered.length === 0 && !baseMatches && (
            <div className="empty-state">No assets match “{query}”.</div>
          )}
        </div>
      </div>
    </div>
  )
}
