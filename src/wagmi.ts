import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// A read RPC for quotes / balances. Swap transactions are sent through the
// connected wallet (MetaMask) itself. Override with VITE_RPC_URL in .env for a
// faster/dedicated endpoint (e.g. an Alchemy or Infura mainnet URL).
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://ethereum-rpc.publicnode.com'

export const config = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(RPC_URL),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
