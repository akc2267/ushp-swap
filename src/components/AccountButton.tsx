'use client'

import { useEffect, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { CHAIN_CONFIG, isSupportedChain } from '../constants'
import { Chevron } from './icons'

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

// Header login / account control, backed by Privy.
export function AccountButton() {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const { address, chainId } = useAccount()
  const explorer = CHAIN_CONFIG[isSupportedChain(chainId) ? chainId : mainnet.id].explorer
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!ready) {
    return <button className="pill" disabled>Loading…</button>
  }

  if (!authenticated) {
    return (
      <button className="pill pill--primary" onClick={() => login()}>
        Log in
      </button>
    )
  }

  const label = address
    ? shortAddr(address)
    : (user?.email?.address ?? user?.google?.email ?? 'Account')
  const identity = user?.email?.address ?? user?.google?.email

  async function copyAddress() {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="account" ref={ref}>
      <button className="pill account-pill" onClick={() => setOpen((o) => !o)}>
        <span className="dot" /> {label} <Chevron size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {identity && <div className="menu-identity">{identity}</div>}
          {address && (
            <>
              <button className="menu-item" onClick={copyAddress}>
                {copied ? 'Copied ✓' : 'Copy address'}
              </button>
              <a
                className="menu-item"
                href={`${explorer}/address/${address}`}
                target="_blank"
                rel="noreferrer"
              >
                View on Etherscan
              </a>
            </>
          )}
          <button
            className="menu-item menu-item--danger"
            onClick={() => {
              setOpen(false)
              logout()
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
