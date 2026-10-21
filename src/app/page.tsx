import { AccountButton } from '@/components/AccountButton'
import { SwapWidget } from '@/components/SwapWidget'
import { UshpMark } from '@/components/icons'

export default function Home() {
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="https://www.ushpindex.com" aria-label="USHP home">
          <UshpMark height={26} />
          <span className="brand-word">USHP</span>
        </a>
        <AccountButton />
      </header>

      <main className="stage">
        <div className="hero">
          <h1>Swap</h1>
          <p>USDC ↔ LINK on Uniswap v4 · Ethereum &amp; Sepolia</p>
        </div>
        <SwapWidget />
      </main>

      <footer className="footer">
        <a href="https://www.ushpindex.com/legal/terms-of-service" target="_blank" rel="noreferrer">
          Terms of Service
        </a>
        <span aria-hidden>·</span>
        <a href="https://www.ushpindex.com/legal/privacy-policy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
      </footer>
    </div>
  )
}
