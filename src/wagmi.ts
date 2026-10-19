import { http } from 'wagmi'
import { mainnet, sepolia } from 'wagmi/chains'
import { createConfig } from '@privy-io/wagmi'

// Read RPCs for quotes / balances. Override with NEXT_PUBLIC_RPC_URL /
// NEXT_PUBLIC_SEPOLIA_RPC_URL for faster/dedicated endpoints (e.g. Alchemy or Infura).
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://ethereum-rpc.publicnode.com'
export const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'

// Privy's createConfig injects its own connectors (embedded + external
// wallets), so none are listed here. Transactions go through whichever wallet
// Privy has set active.
export const config = createConfig({
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(RPC_URL),
    [sepolia.id]: http(SEPOLIA_RPC_URL),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
