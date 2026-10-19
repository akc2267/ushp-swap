// The Uniswap SDKs (and their ethers/JSBI deps) expect Node's Buffer global to
// exist in the browser.
import { Buffer } from 'buffer'

if (typeof window !== 'undefined' && !(window as { Buffer?: unknown }).Buffer) {
  ;(window as { Buffer?: unknown }).Buffer = Buffer
}
