import { SwapWidget } from './components/SwapWidget'

export default function App() {
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">Global Markets</div>
        <div className="brand-sub">Swap · Uniswap v4 · Ethereum mainnet</div>
      </header>
      <main className="stage">
        <SwapWidget />
      </main>
    </div>
  )
}
