import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// The Uniswap SDKs (and their ethers/JSBI deps) expect Node globals such as
// Buffer / process to exist in the browser, so we polyfill them.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'util'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
})
