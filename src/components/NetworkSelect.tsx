'use client'

import { useEffect, useRef, useState } from 'react'
import { CHAIN_CONFIG, SUPPORTED_CHAIN_IDS, type SupportedChainId } from '../constants'
import { Chevron, EthIcon } from './icons'

export function NetworkSelect({
  value,
  onChange,
}: {
  value: SupportedChainId
  onChange: (id: SupportedChainId) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = CHAIN_CONFIG[value]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="account" ref={ref}>
      <button className="pill network-pill" onClick={() => setOpen((o) => !o)} aria-haspopup="menu">
        <EthIcon size={20} testnet={current.testnet} />
        <span>{current.name}</span>
        {current.testnet && <span className="testnet-tag">Testnet</span>}
        <Chevron size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {SUPPORTED_CHAIN_IDS.map((id) => {
            const cfg = CHAIN_CONFIG[id]
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={id === value}
                className={`menu-item menu-item--network ${id === value ? 'is-active' : ''}`}
                onClick={() => {
                  setOpen(false)
                  if (id !== value) onChange(id)
                }}
              >
                <EthIcon size={22} testnet={cfg.testnet} />
                <span>{cfg.name}</span>
                {cfg.testnet && <span className="testnet-tag">Testnet</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
