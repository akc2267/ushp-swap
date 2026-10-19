// Minimal inline SVG icons so the app stays fully self-contained.

export function EthIcon({ size = 24 }: { size?: number }) {
  return (
    <span className="token-icon" style={{ width: size, height: size, background: '#627EEA' }}>
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        <path d="M12 2.5L11.85 3v11.1l.15.15 5.1-3.02L12 2.5z" fill="#fff" opacity="0.6" />
        <path d="M12 2.5L6.9 11.23 12 14.25V2.5z" fill="#fff" />
        <path d="M12 15.2l-.08.1v3.95l.08.25 5.1-7.19L12 15.2z" fill="#fff" opacity="0.6" />
        <path d="M12 19.5v-4.3L6.9 12.3 12 19.5z" fill="#fff" />
      </svg>
    </span>
  )
}

export function UsdcIcon({ size = 24 }: { size?: number }) {
  return (
    <span className="token-icon" style={{ width: size, height: size, background: '#2775CA' }}>
      <svg viewBox="0 0 24 24" width={size * 0.7} height={size * 0.7} fill="none">
        <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.4" />
        <path
          d="M12 7.2v1c1.4.15 2.3.95 2.3 2.05h-1.3c0-.55-.45-.95-1.3-.95-.85 0-1.25.35-1.25.8 0 .5.4.7 1.6.95 1.7.35 2.45.95 2.45 2.1 0 1.1-.85 1.85-2.2 2v1h-1v-1c-1.5-.15-2.45-.95-2.5-2.15h1.35c.05.6.55 1 1.5 1 .9 0 1.35-.35 1.35-.85 0-.5-.35-.7-1.6-.95-1.6-.3-2.45-.9-2.45-2.05 0-1.05.85-1.8 2.15-1.95v-1h1z"
          fill="#fff"
        />
      </svg>
    </span>
  )
}

export function TokenIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  if (symbol === 'ETH') return <EthIcon size={size} />
  if (symbol === 'USDC') return <UsdcIcon size={size} />
  // Fallback: monogram chip for decorative / preview tokens.
  return (
    <span className="token-icon token-icon--mono" style={{ width: size, height: size }}>
      {symbol.slice(0, 1)}
    </span>
  )
}

export function Chevron({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ArrowDown({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M12 19l-5-5M12 19l5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function CloseIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function TrendingIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 17l6-6 4 4 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 8h4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Triangle({ up }: { up: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" style={{ transform: up ? 'none' : 'rotate(180deg)' }}>
      <path d="M6 2l4.5 8h-9z" fill="currentColor" />
    </svg>
  )
}
