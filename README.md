# USHP Swap

Next.js (App Router) swap UI for Uniswap v4 on **Ethereum mainnet (real funds)** and
**Sepolia testnet**, with [Privy](https://privy.io) for login and wallets. Styling follows
[ushpindex.com](https://www.ushpindex.com).

## Run

```sh
cp .env.example .env.local   # then fill in the Privy values
npm install
npm run dev                  # http://localhost:3000
npm run build && npm start   # production
```

| Env var | Where it's used |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Client (`PrivyProvider`) and server (JWT audience) |
| `PRIVY_APP_SECRET` | Server only (`src/lib/privy-server.ts`). Never prefix with `NEXT_PUBLIC_`. |
| `PRIVY_JWKS_URL` | Optional; defaults to the app's Privy JWKS endpoint |
| `NEXT_PUBLIC_RPC_URL` | Optional mainnet RPC for quotes/balances and the embedded wallet |
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | Optional Sepolia RPC, same purpose |

## How it fits together

- `src/app/providers.tsx` — `PrivyProvider` → `QueryClientProvider` → `@privy-io/wagmi`'s `WagmiProvider`.
  Email/social users get a Privy embedded wallet on login; wallet users keep their own.
  Login methods come from the Privy dashboard.
- `src/constants.ts` — per-chain Uniswap v4 addresses and token lists (`CHAIN_CONFIG`).
  Every token trades against native ETH in a hookless v4 pool.
- `src/components/SwapWidget.tsx` — network picker (follows the wallet if the user switches
  there), $20 / $100 / $500 presets, quotes via the V4Quoter, swaps via the Universal Router.
  Buys are one transaction. Sells need two allowances the first time (token → Permit2,
  Permit2 → router for 30 days); after that every sell is one transaction. First-time setup:
  smart accounts get an EIP-5792 batch (one confirmation); Privy embedded wallets send the
  approvals silently; plain EOAs approve once and sign a 30-day Permit2 allowance that the
  swap applies (`PERMIT2_PERMIT` + `V4_SWAP`). Not-yet-upgraded MetaMask accounts are not
  batched: MetaMask's upgrade transaction omits the 7702 authorization's 25k gas from its
  limit, so approve+swap batches that also upgrade the account run out of gas.
- `src/app/api/me/route.ts` — example authenticated route: verifies the Privy access token
  (`Authorization: Bearer <getAccessToken()>` or the `privy-token` cookie) against the JWKS,
  then loads the user from Privy's REST API with the app secret.
- `next.config.ts` aliases Privy's optional Solana peer deps to an empty stub — the app is
  Ethereum-only.
- `src/hooks/useUsdPrices.ts` — USD prices for presets and the asset list, always from mainnet
  pools (Sepolia pool prices are arbitrary), matched to Sepolia tokens by symbol.
- `scripts/` — standalone viem scripts: `probe-pools.mjs` / `probe-sepolia.mjs` discover liquid
  ETH pools; `test-swap-call.mjs` / `test-sepolia-swap.mjs` simulate swap calldata.

## Patches

`patches/@privy-io+react-auth+3.50.0.patch` (applied by `patch-package` on `postinstall`) adds
the missing React `key` to the "recently used wallet" button on Privy's login screen, which
otherwise logs `Each child in a list should have a unique "key" prop` in development. It is
dev-noise only. When upgrading Privy, delete the patch first; if the warning returns, re-create it
with `npx patch-package @privy-io/react-auth`.

## Deploying (GitHub Pages)

`.github/workflows/deploy.yml` builds a static export on every push to `main` and publishes it
with GitHub Pages (Settings → Pages → Source: GitHub Actions). Pages is static hosting, so the
workflow removes `src/app/api` before building — the `/api/me` example route only exists when
running with `npm run dev` / `npm start` or on a Node host.
