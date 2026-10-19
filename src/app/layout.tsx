import type { Metadata, Viewport } from 'next'
import { EB_Garamond, Inter } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

// ushpindex.com pairs a serif display face with Inter for UI text.
const serif = EB_Garamond({ subsets: ['latin'], variable: '--font-serif', display: 'swap' })
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'Swap | USHP',
  description: 'Swap on Uniswap v4 — Ethereum mainnet and Sepolia.',
}

export const viewport: Viewport = {
  themeColor: '#131C33',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
