'use client'

import '../polyfills'
import { useState, type ReactNode } from 'react'
import { PrivyProvider, addRpcUrlOverrideToChain } from '@privy-io/react-auth'
import { WagmiProvider } from '@privy-io/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mainnet, sepolia } from 'wagmi/chains'
import { config } from '../wagmi'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID

// Point the embedded wallet at our RPCs too, when dedicated ones are configured.
const mainnetChain = process.env.NEXT_PUBLIC_RPC_URL
  ? addRpcUrlOverrideToChain(mainnet, process.env.NEXT_PUBLIC_RPC_URL)
  : mainnet
const sepoliaChain = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL
  ? addRpcUrlOverrideToChain(sepolia, process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL)
  : sepolia

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  if (!PRIVY_APP_ID) {
    throw new Error('NEXT_PUBLIC_PRIVY_APP_ID is not set — copy .env.example to .env.local')
  }

  // Privy requires this nesting: PrivyProvider > QueryClientProvider > WagmiProvider.
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: '#131C33',
          accentColor: '#7ECBA1',
          landingHeader: 'Log in to USHP Swap',
          walletChainType: 'ethereum-only',
        },
        // Email/social users get a self-custodial embedded wallet automatically;
        // users who log in with MetaMask etc. keep using that wallet.
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
        defaultChain: mainnetChain,
        supportedChains: [mainnetChain, sepoliaChain],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
