'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encodeFunctionData, formatUnits, parseUnits, type Hex } from 'viem'
import { usePrivy, useSendTransaction as usePrivySendTransaction, useWallets } from '@privy-io/react-auth'
import {
  useAccount,
  useCapabilities,
  usePublicClient,
  useSendCalls,
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
  useWalletClient,
} from 'wagmi'
import { mainnet } from 'wagmi/chains'
import {
  CHAIN_CONFIG,
  ERC20_ABI,
  ETH,
  isSupportedChain,
  MAX_UINT160,
  MAX_UINT256,
  PERMIT2,
  PERMIT2_ABI,
  UNIVERSAL_ROUTER_ABI,
  type SupportedChainId,
  type TokenInfo,
} from '../constants'
import { formatUsd, useUsdPrices } from '../hooks/useUsdPrices'
import {
  applySlippage,
  buildV4SwapCalldata,
  getQuote,
  permit2TypedData,
  type PermitSingle,
  type SignedPermit,
} from '../uniswap'
import { AssetSelector } from './AssetSelector'
import { ArrowDown, Chevron, TokenIcon } from './icons'
import { NetworkSelect } from './NetworkSelect'

const SLIPPAGE_BPS = 50 // 0.5%
const USD_PRESETS = [20, 100, 500]
// Token -> router allowances (on-chain or signed) last 30 days, so after the
// first sell of a token, later sells are a single confirmation.
const ALLOWANCE_TTL_SECONDS = 60 * 60 * 24 * 30
const SIGNATURE_DEADLINE_SECONDS = 30 * 60
type Side = 'buy' | 'sell'

type Call = { to: `0x${string}`; data: `0x${string}`; value: bigint }

function trimAmount(value: string, maxDecimals = 6) {
  if (!value.includes('.')) return value
  const [int, frac] = value.split('.')
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, '')
  return trimmed ? `${int}.${trimmed}` : int
}

// EIP-5792 atomic batching status for this chain: 'supported' means the
// account is already a smart account (e.g. a MetaMask account that has been
// upgraded, or Coinbase Smart Wallet); 'ready' means the wallet would first
// upgrade the account. Handles the current and older capability shapes.
function atomicStatus(capabilities: unknown, chainId: number): 'supported' | 'ready' | null {
  if (!capabilities || typeof capabilities !== 'object') return null
  const caps = capabilities as Record<string, any>
  const entry = caps[chainId] ?? caps[`0x${chainId.toString(16)}`]
  if (!entry) return null
  const status = entry.atomic?.status
  if (status === 'supported' || entry.atomicBatch?.supported === true) return 'supported'
  if (status === 'ready') return 'ready'
  return null
}

function isUserRejection(err: unknown): boolean {
  const e = err as any
  if (!e) return false
  if (e.code === 4001 || e.cause?.code === 4001) return true
  const s = `${e.name ?? ''} ${e.shortMessage ?? ''} ${e.message ?? ''}`.toLowerCase()
  return (
    s.includes('rejected') ||
    s.includes('denied') ||
    s.includes('userrejected') ||
    s.includes('exited') ||
    s.includes('cancel')
  )
}

function errMessage(err: unknown): string {
  const e = err as any
  return e?.shortMessage || e?.message || String(err)
}

export function SwapWidget() {
  // `useAccount().chainId` is the wallet's ACTUAL network (e.g. Base), unlike
  // `useChainId()` which only reflects wagmi's configured chain (always mainnet
  // here) and would let a wrong-network swap slip through.
  const { address, isConnected, chainId: walletChainId } = useAccount()

  // The chain the widget trades on. It follows the wallet when the user
  // switches networks in their wallet, and asks the wallet to switch when the
  // user picks a network here.
  const [chainId, setChainId] = useState<SupportedChainId>(mainnet.id)
  const chainCfg = CHAIN_CONFIG[chainId]
  const publicClient = usePublicClient({ chainId })
  // Privy owns login and wallet connection; wagmi sees whichever wallet Privy
  // has set active (the embedded wallet, or an external one like MetaMask).
  const { ready: privyReady, authenticated, login, connectWallet } = usePrivy()
  const { wallets } = useWallets()
  const { switchChain } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()
  const { sendCallsAsync } = useSendCalls()
  const { data: walletClient } = useWalletClient()
  const { data: capabilities } = useCapabilities({ query: { enabled: isConnected, retry: false } })
  const { sendTransaction: privySendTransaction } = usePrivySendTransaction()

  // The widget trades native ETH against one selected token. `side` decides
  // which one is spent: buy = ETH -> token, sell = token -> ETH.
  const [token, setToken] = useState<TokenInfo>(chainCfg.tokens[0])
  const [side, setSide] = useState<Side>('buy')

  const [amount, setAmount] = useState('')
  const [activePreset, setActivePreset] = useState<number | null>(null)
  const [quoteOut, setQuoteOut] = useState<bigint | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [spendBalance, setSpendBalance] = useState<bigint | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [txLink, setTxLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)

  const onSelectedChain = walletChainId === chainId
  const spendToken = side === 'buy' ? ETH : token
  const receiveToken = side === 'buy' ? token : ETH
  // PoolKey currency0 is native ETH, so ETH -> token is zeroForOne === true.
  const zeroForOne = side === 'buy'

  // Privy embedded wallets send through Privy so background steps can skip its
  // confirmation modal; external wallets like MetaMask go through wagmi.
  const activeWallet = wallets.find((w) => address && w.address.toLowerCase() === address.toLowerCase())
  const isEmbeddedWallet = activeWallet?.walletClientType === 'privy'
  // One-click (approve + swap in one confirmation) only for accounts that are
  // already smart accounts. We skip 'ready' (not yet upgraded): MetaMask's
  // upgrade transaction doesn't budget for the 7702 authorization's 25k gas,
  // so an approve+swap batch that also upgrades the account runs out of gas.
  const canBatch =
    isConnected && onSelectedChain && !isEmbeddedWallet && atomicStatus(capabilities, chainId) === 'supported'

  // USD presets are priced off mainnet (see useUsdPrices), so on Sepolia they
  // only work for tokens that also trade on mainnet under the same symbol.
  const { data: prices } = useUsdPrices()
  const spendPrice = prices?.[spendToken.symbol]

  const amountIn = useMemo(() => {
    try {
      if (!amount || Number(amount) <= 0) return null
      return parseUnits(amount, spendToken.decimals)
    } catch {
      return null
    }
  }, [amount, spendToken.decimals])

  const minOut = quoteOut !== null ? applySlippage(quoteOut, SLIPPAGE_BPS) : null

  // --- fetch quote (debounced) ------------------------------------------
  const quoteSeq = useRef(0)
  useEffect(() => {
    setQuoteError(null)
    if (!publicClient || amountIn === null) {
      setQuoteOut(null)
      return
    }
    const seq = ++quoteSeq.current
    setQuoting(true)
    const t = setTimeout(async () => {
      try {
        const out = await getQuote(publicClient, chainCfg.v4Quoter, token, amountIn, zeroForOne)
        if (seq === quoteSeq.current) setQuoteOut(out)
      } catch (err) {
        if (seq === quoteSeq.current) {
          setQuoteOut(null)
          setQuoteError('No quote available for this amount.')
          console.error('quote error', err)
        }
      } finally {
        if (seq === quoteSeq.current) setQuoting(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [publicClient, chainCfg.v4Quoter, token, amountIn, zeroForOne])

  // --- fetch spend-token balance ----------------------------------------
  const loadBalance = useCallback(async () => {
    if (!publicClient || !address) {
      setSpendBalance(null)
      return
    }
    try {
      if (spendToken.isNative) {
        setSpendBalance(await publicClient.getBalance({ address }))
      } else {
        setSpendBalance(
          await publicClient.readContract({
            address: spendToken.address,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address],
          }),
        )
      }
    } catch {
      setSpendBalance(null)
    }
  }, [publicClient, address, spendToken])

  useEffect(() => {
    loadBalance()
  }, [loadBalance])

  // --- controls ----------------------------------------------------------
  function resetAmount() {
    setAmount('')
    setActivePreset(null)
    setQuoteOut(null)
  }

  function flip() {
    setSide((s) => (s === 'buy' ? 'sell' : 'buy'))
    resetAmount()
  }

  function chooseToken(t: TokenInfo) {
    setSelectorOpen(false)
    if (t.address === token.address) return
    setToken(t)
    resetAmount()
  }

  function selectChain(id: SupportedChainId, switchWallet: boolean) {
    setChainId(id)
    setToken(CHAIN_CONFIG[id].tokens[0])
    resetAmount()
    setStatus(null)
    setTxLink(null)
    if (switchWallet && isConnected && walletChainId !== id) {
      // If the user declines, the CTA falls back to "Switch to <network>".
      switchChain({ chainId: id })
    }
  }

  // Follow network changes made in the wallet itself. Ignore the initial
  // connect (undefined -> chain) so a network picked before login sticks.
  const prevWalletChain = useRef(walletChainId)
  useEffect(() => {
    const prev = prevWalletChain.current
    prevWalletChain.current = walletChainId
    if (prev === undefined || walletChainId === prev) return
    if (isSupportedChain(walletChainId) && walletChainId !== chainId) selectChain(walletChainId, false)
    // Deliberately keyed on the wallet's chain only — re-running on `chainId`
    // would undo a network the user just picked in the UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletChainId])

  function applyPreset(usd: number) {
    if (!spendPrice) return
    const raw = usd / spendPrice
    const dp = Math.min(spendToken.decimals, raw >= 1000 ? 2 : raw >= 1 ? 4 : 6)
    setAmount(trimAmount(raw.toFixed(dp), dp))
    setActivePreset(usd)
  }

  const insufficient =
    amountIn !== null && spendBalance !== null && amountIn > spendBalance

  // --- sending ------------------------------------------------------------
  // Privy embedded wallets send through Privy, which can hide its
  // confirmation modal for background steps (approvals). External wallets
  // send through wagmi. Waits for the receipt; throws if it reverted.
  async function sendAndWait(
    call: Call,
    ui: { description: string; buttonText: string; silent?: boolean },
  ): Promise<Hex> {
    if (!publicClient) throw new Error('No RPC client')
    let hash: Hex
    if (isEmbeddedWallet && address) {
      ;({ hash } = await privySendTransaction(
        { to: call.to, data: call.data, value: call.value, chainId },
        {
          address,
          // `showWalletUIs: false` is only honoured when "enforce wallet UIs"
          // is off in the Privy dashboard; otherwise Privy still shows a modal.
          uiOptions: { showWalletUIs: !ui.silent, description: ui.description, buttonText: ui.buttonText },
        },
      ))
    } else {
      hash = await sendTransactionAsync({ chainId, to: call.to, data: call.data, value: call.value })
    }
    setTxLink(`${chainCfg.explorer}/tx/${hash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 })
    if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain')
    return hash
  }

  function swapCall(permit?: SignedPermit): Call {
    const { commands, inputs, value } = buildV4SwapCalldata(token, {
      zeroForOne,
      amountIn: amountIn!,
      amountOutMinimum: minOut!,
      permit,
    })
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
    return {
      to: chainCfg.universalRouter,
      data: encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, deadline] }),
      value,
    }
  }

  // --- swap --------------------------------------------------------------
  // Buying (ETH -> token) is always one transaction. Selling a token needs two
  // allowances the first time: token -> Permit2 (ERC20 approve) and
  // Permit2 -> router (30 days). Once they exist, every sell is one transaction.
  // How the first-time setup happens depends on the wallet:
  //   - smart accounts (canBatch): approvals + swap batched — one confirmation
  //   - Privy embedded wallets: approvals sent silently, then the swap — one
  //     visible confirmation
  //   - plain EOAs (e.g. MetaMask not upgraded): approve once, sign a 30-day
  //     Permit2 allowance (no gas), which the swap transaction applies
  async function handleSwap() {
    if (!publicClient || !address || amountIn === null || minOut === null) return
    setBusy(true)
    setTxLink(null)
    setStatus(null)
    const symbol = spendToken.symbol
    const swapUi = {
      description: `Swap ${amount} ${symbol} for at least ${minDisplay} ${receiveToken.symbol}.`,
      buttonText: 'Swap',
    }
    try {
      let needsErc20Approval = false
      let needsPermit2Allowance = false
      let permitNonce = 0
      const now = Math.floor(Date.now() / 1000)

      if (!spendToken.isNative) {
        const [erc20Allowance, [permitAmount, expiration, nonce]] = await Promise.all([
          publicClient.readContract({ address: spendToken.address, abi: ERC20_ABI, functionName: 'allowance', args: [address, PERMIT2] }),
          publicClient.readContract({
            address: PERMIT2,
            abi: PERMIT2_ABI,
            functionName: 'allowance',
            args: [address, spendToken.address, chainCfg.universalRouter],
          }),
        ])
        needsErc20Approval = erc20Allowance < amountIn
        needsPermit2Allowance = permitAmount < amountIn || expiration <= now
        permitNonce = Number(nonce)
      }

      const erc20ApproveCall: Call = {
        to: spendToken.address,
        data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [PERMIT2, MAX_UINT256] }),
        value: 0n,
      }
      const permit2ApproveCall: Call = {
        to: PERMIT2,
        data: encodeFunctionData({
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [spendToken.address, chainCfg.universalRouter, MAX_UINT160, now + ALLOWANCE_TTL_SECONDS],
        }),
        value: 0n,
      }

      if (!needsErc20Approval && !needsPermit2Allowance) {
        // Steady state (and every buy): a single transaction.
        setStatus('Confirm the swap…')
        await sendAndWait(swapCall(), swapUi)
      } else if (canBatch) {
        const calls = [
          ...(needsErc20Approval ? [erc20ApproveCall] : []),
          ...(needsPermit2Allowance ? [permit2ApproveCall] : []),
          swapCall(),
        ]
        setStatus('Confirm the swap (includes one-time approval)…')
        const res = (await sendCallsAsync({ chainId, calls })) as { id?: string } | string
        const id = typeof res === 'string' ? res : res?.id
        setStatus('Swap submitted — waiting for confirmation…')
        if (id && walletClient?.waitForCallsStatus) {
          const result = await walletClient.waitForCallsStatus({ id, timeout: 180_000 })
          const last = result.receipts?.[result.receipts.length - 1]
          if (last?.transactionHash) setTxLink(`${chainCfg.explorer}/tx/${last.transactionHash}`)
          if (result.status !== 'success') throw new Error('Transaction reverted on-chain')
        }
      } else if (isEmbeddedWallet) {
        setStatus(`Enabling ${symbol} for trading…`)
        const setupUi = { description: `One-time setup so ${symbol} can be traded.`, buttonText: 'Continue', silent: true }
        if (needsErc20Approval) await sendAndWait(erc20ApproveCall, setupUi)
        if (needsPermit2Allowance) await sendAndWait(permit2ApproveCall, setupUi)
        setTxLink(null)
        setStatus('Confirm the swap…')
        await sendAndWait(swapCall(), swapUi)
      } else {
        if (needsErc20Approval) {
          setStatus(`One-time approval to enable ${symbol} trading…`)
          await sendAndWait(erc20ApproveCall, { description: '', buttonText: '' })
          setTxLink(null)
        }
        let permit: SignedPermit | undefined
        if (needsPermit2Allowance) {
          setStatus(`Sign to let Uniswap trade your ${symbol} for 30 days (no gas)…`)
          const message: PermitSingle = {
            details: { token: spendToken.address, amount: MAX_UINT160, expiration: now + ALLOWANCE_TTL_SECONDS, nonce: permitNonce },
            spender: chainCfg.universalRouter,
            sigDeadline: BigInt(now + SIGNATURE_DEADLINE_SECONDS),
          }
          permit = { permit: message, signature: await signTypedDataAsync(permit2TypedData(chainId, message)) }
        }
        setStatus('Confirm the swap…')
        await sendAndWait(swapCall(permit), swapUi)
      }

      setStatus('Swap confirmed ✓')
      resetAmount()
      loadBalance()
    } catch (err: unknown) {
      setStatus(isUserRejection(err) ? 'Request cancelled.' : `Error: ${errMessage(err).slice(0, 160)}`)
    } finally {
      setBusy(false)
    }
  }

  // --- primary button ----------------------------------------------------
  function primaryButton() {
    if (!privyReady) {
      return <button className="cta" disabled>Loading…</button>
    }
    if (!authenticated) {
      return (
        <button className="cta" onClick={() => login()}>
          Log in to trade
        </button>
      )
    }
    if (!isConnected) {
      // Logged in, but no wallet is active in wagmi yet — e.g. the embedded
      // wallet is still being created, or an external wallet is locked.
      return (
        <button className="cta" onClick={() => connectWallet()}>
          Connect wallet
        </button>
      )
    }
    if (!onSelectedChain) {
      return (
        <button className="cta" onClick={() => switchChain({ chainId })}>
          Switch to {chainCfg.name}
        </button>
      )
    }
    if (amountIn === null) {
      return <button className="cta" disabled>Enter an amount</button>
    }
    if (insufficient) {
      return <button className="cta" disabled>Insufficient {spendToken.symbol} balance</button>
    }
    if (quoting || quoteOut === null) {
      return <button className="cta" disabled>{quoteError ?? 'Fetching quote…'}</button>
    }
    return (
      <button className="cta" disabled={busy} onClick={handleSwap}>
        {busy ? (status ?? 'Working…') : `Swap ${spendToken.symbol} → ${receiveToken.symbol}`}
      </button>
    )
  }

  const receiveDisplay =
    quoteOut !== null ? trimAmount(formatUnits(quoteOut, receiveToken.decimals)) : '0'
  const minDisplay =
    minOut !== null ? trimAmount(formatUnits(minOut, receiveToken.decimals)) : null
  const balanceDisplay =
    spendBalance !== null ? trimAmount(formatUnits(spendBalance, spendToken.decimals)) : null
  const spendUsd =
    spendPrice && amount && Number(amount) > 0 ? Number(amount) * spendPrice : null

  // The non-ETH side always opens the asset selector; the ETH side is fixed.
  function tokenChip(t: TokenInfo) {
    if (t.isNative) {
      return (
        <div className="token-chip token-chip--static">
          <TokenIcon symbol={t.symbol} size={28} />
          <span>{t.symbol}</span>
        </div>
      )
    }
    return (
      <button className="token-chip" onClick={() => setSelectorOpen(true)}>
        <TokenIcon symbol={t.symbol} size={28} />
        <span>{t.symbol}</span>
        <Chevron size={16} />
      </button>
    )
  }

  return (
    <div className="widget">
      {/* header: Buy/Sell + network */}
      <div className="widget-head">
        <div className="segmented">
          <button className={side === 'buy' ? 'seg active' : 'seg'} onClick={() => setSide('buy')}>
            Buy
          </button>
          <button className={side === 'sell' ? 'seg active' : 'seg'} onClick={() => setSide('sell')}>
            Sell
          </button>
        </div>

        <NetworkSelect value={chainId} onChange={(id) => selectChain(id, true)} />
      </div>

      {chainCfg.testnet && (
        <div className="testnet-note">
          You&apos;re on the {chainCfg.name} testnet — tokens here have no real value.
        </div>
      )}

      {/* card with spend / receive */}
      <div className="swap-card">
        <div className="swap-section">
          <div className="swap-section-top">
            <span className="muted">Spend</span>
            {balanceDisplay !== null && (
              <span className="muted small">
                Balance: {balanceDisplay} {spendToken.symbol}
              </span>
            )}
          </div>
          <div className="swap-row">
            <input
              className="amount-input"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                setActivePreset(null)
              }}
            />
            {tokenChip(spendToken)}
          </div>
          <div className="preset-row">
            <div className="presets" role="group" aria-label="Quick amounts in USD">
              {USD_PRESETS.map((usd) => (
                <button
                  key={usd}
                  className={`preset ${activePreset === usd ? 'active' : ''}`}
                  disabled={!spendPrice}
                  title={spendPrice ? `Spend $${usd} of ${spendToken.symbol}` : `No USD price for ${spendToken.symbol}`}
                  onClick={() => applyPreset(usd)}
                >
                  ${usd}
                </button>
              ))}
            </div>
            {spendUsd !== null && <span className="muted small">≈ {formatUsd(spendUsd)}</span>}
          </div>
        </div>

        <div className="divider">
          <button className="flip-btn" onClick={flip} aria-label="Switch direction">
            <ArrowDown />
          </button>
        </div>

        <div className="swap-section">
          <div className="swap-section-top">
            <span className="muted">Receive at least</span>
            {quoting && <span className="muted small">Fetching…</span>}
          </div>
          <div className="swap-row">
            <span className={`amount-output ${quoteOut !== null ? '' : 'is-zero'}`}>
              {receiveDisplay}
            </span>
            {tokenChip(receiveToken)}
          </div>
          {minDisplay !== null && (
            <div className="muted small">
              Min received at {SLIPPAGE_BPS / 100}% slippage: {minDisplay} {receiveToken.symbol}
            </div>
          )}
        </div>
      </div>

      {canBatch && !spendToken.isNative && (
        <div className="oneclick-hint">⚡ One-click: any approval is bundled with the swap</div>
      )}

      {primaryButton()}

      {status && (
        <div className={`status ${status.startsWith('Error') || status.includes('cancelled') ? 'err' : ''}`}>
          {status}
          {txLink && (
            <>
              {' '}
              <a href={txLink} target="_blank" rel="noreferrer">
                View on Etherscan
              </a>
            </>
          )}
        </div>
      )}

      <p className="disclaimer">
        Global Markets tokens have not been registered under the US Securities Act of 1933, as
        amended, or the securities or other laws of any other jurisdiction, and may not be offered
        or sold in the US or to US persons unless registered under the Act or exempt therefrom. The
        tokens are offered and sold in the EEA and UK solely to qualified investors, and in
        Switzerland solely to professional clients. Other prohibitions and restrictions apply. See
        additional information below.*
      </p>

      {selectorOpen && (
        <AssetSelector
          tokens={chainCfg.tokens}
          selected={token}
          onSelect={chooseToken}
          onClose={() => setSelectorOpen(false)}
        />
      )}
    </div>
  )
}
