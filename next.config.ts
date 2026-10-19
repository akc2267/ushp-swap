import type { NextConfig } from 'next'

// Privy's react-auth references optional Solana peers via dynamic import. We
// don't use Solana, so alias them to an empty module instead of installing them.
const SOLANA_STUB = './src/lib/stubs/empty.js'
const solanaAliases = {
  '@solana/kit': SOLANA_STUB,
  '@solana-program/system': SOLANA_STUB,
  '@solana-program/token': SOLANA_STUB,
  '@solana-program/memo': SOLANA_STUB,
}

// GitHub Pages build (see .github/workflows/deploy.yml): a fully static export
// served from https://<user>.github.io/<repo>/, so every URL needs the repo
// name as its base path. Pages can't run server code, so the workflow drops
// the /api routes before building.
const isPages = process.env.GITHUB_PAGES === 'true'
const basePath = process.env.PAGES_BASE_PATH ?? ''

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: solanaAliases,
  },
  ...(isPages && {
    output: 'export',
    basePath,
    trailingSlash: true,
    images: { unoptimized: true },
  }),
}

export default nextConfig
