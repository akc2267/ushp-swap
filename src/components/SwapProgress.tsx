'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { CheckIcon } from './icons'

// Roughly one Ethereum block plus inclusion time.
export const EXPECTED_SWAP_SECONDS = 15

export type SwapPhase = 'wallet' | 'chain' | 'done'
export type SwapProgressState = { phase: SwapPhase; label: string; startedAt: number }

/**
 * Shown in place of the Swap button while a swap is in flight, so the app
 * never looks frozen:
 *  - wallet: waiting on a wallet prompt (indeterminate bar)
 *  - chain:  submitted; a bar fills over ~15s with a live countdown
 *  - done:   bar completes with a check, then the widget resets
 */
export function SwapProgress({ phase, label, startedAt }: SwapProgressState) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (phase !== 'chain') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [phase])

  const remaining = Math.ceil(EXPECTED_SWAP_SECONDS - Math.max(0, (now - startedAt) / 1000))
  const detail =
    phase === 'wallet'
      ? 'Confirm in your wallet'
      : phase === 'done'
        ? 'Done'
        : remaining > 0
          ? `About ${remaining}s left`
          : 'Almost there — waiting for the block'

  return (
    <div className={`swap-progress is-${phase}`} role="status" aria-live="polite">
      <div className="swap-progress-head">
        <span className="swap-progress-icon" aria-hidden>
          {phase === 'done' ? <CheckIcon size={16} /> : <span className="swap-spinner" />}
        </span>
        <span className="swap-progress-label">{label}</span>
        <span className="swap-progress-detail">{detail}</span>
      </div>
      <div className="swap-progress-track">
        {/* Keyed on the step so the fill animation restarts for each one. */}
        <ProgressFill key={`${phase}-${startedAt}`} phase={phase} startedAt={startedAt} />
      </div>
      {phase === 'chain' && (
        <p className="swap-progress-note">Swaps settle on Ethereum in about {EXPECTED_SWAP_SECONDS} seconds.</p>
      )}
    </div>
  )
}

// The bar's fill. The on-chain fill is a CSS animation; if the step began
// before this mounted, it starts part-way through (negative delay, fixed at
// mount) so the bar reflects real elapsed time.
function ProgressFill({ phase, startedAt }: { phase: SwapPhase; startedAt: number }) {
  const [delay] = useState(() => Math.max(0, (Date.now() - startedAt) / 1000))
  return (
    <div
      className="swap-progress-fill"
      style={
        {
          '--expected': `${EXPECTED_SWAP_SECONDS}s`,
          animationDelay: phase === 'chain' ? `-${delay}s` : undefined,
        } as CSSProperties
      }
    />
  )
}
