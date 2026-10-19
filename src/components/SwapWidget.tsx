import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encodeFunctionData, formatUnits, parseUnits } from 'viem'
import {
  useAccount,
  useCapabilities,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSendCalls,
  useSendTransaction,
  useSwitchChain,
  useWalletClient,
} from 'wagmi'
import { mainnet } from 'wagmi/chains'
import {
  ERC20_ABI,
  ETH,
  MAX_UINT160,
  MAX_UINT256,
  PERMIT2,
  PERMIT2_ABI,
  UNIVERSAL_ROUTER,
  UNIVERSAL_ROUTER_ABI,
  USDC,
  type TokenInfo,
} from '../constants'
import { applySlippage, buildV4SwapCalldata, getQuote } from '../uniswap'
import { AssetSelector } from './AssetSelector'
import { ArrowDown, Chevron, EthIcon, TokenIcon } from './icons'

const SLIPPAGE_BPS = 50 // 0.5%
type Side = 'buy' | 'sell'

type Call = { to: `0x${string}`; data: `0x${string}`; value: bigint }

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function trimAmount(value: string, maxDecimals = 6) {
  if (!value.includes('.')) return value
  const [int, frac] = value.split('.')
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, '')
  return trimmed ? `${int}.${trimmed}` : int
}

// Does the connected wallet support EIP-5792 atomic batching on this chain?
// Handles both the current (`atomic.status`) and older (`atomicBatch`) shapes.
function supportsAtomic(capabilities: unknown, chainId: number): boolean {
  if (!capabilities || typeof capabilities !== 'object') return false
  const caps = capabilities as Record<string, any>
  const entry = caps[chainId] ?? caps[`0x${chainId.toString(16)}`]
  if (!entry) return false
  const status = entry.atomic?.status
  return status === 'supported' || status === 'ready' || entry.atomicBatch?.supported === true
}

function isUserRejection(err: unknown): boolean {
  const e = err as any
  if (!e) return false
  if (e.code === 4001 || e.cause?.code === 4001) return true
  const s = `${e.name ?? ''} ${e.shortMessage ?? ''} ${e.message ?? ''}`.toLowerCase()
  return s.includes('rejected') || s.includes('denied') || s.includes('userrejected')
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
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { connect, connectors, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const { sendCallsAsync } = useSendCalls()
  const { sendTransactionAsync } = useSendTransaction()
  const { data: capabilities } = useCapabilities({ query: { enabled: isConnected, retry: false } })

  // The widget trades native ETH against one selected token. `side` decides
  // which one is spent: buy = ETH -> token, sell = token -> ETH.
  const [token, setToken] = useState<TokenInfo>(USDC)
  const [side, setSide] = useState<Side>('buy')

  const [amount, setAmount] = useState('')
  const [quoteOut, setQuoteOut] = useState<bigint | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const [spendBalance, setSpendBalance] = useState<bigint | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)

  const onMainnet = walletChainId === mainnet.id
  const spendToken = side === 'buy' ? ETH : token
  const receiveToken = side === 'buy' ? token : ETH
  // PoolKey currency0 is native ETH, so ETH -> token is zeroForOne === true.
  const zeroForOne = side === 'buy'
  const oneClickAvailable = isConnected && onMainnet && supportsAtomic(capabilities, mainnet.id)

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
        const out = await getQuote(publicClient, token, amountIn, zeroForOne)
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
  }, [publicClient, token, amountIn, zeroForOne])

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
  function flip() {
    setSide((s) => (s === 'buy' ? 'sell' : 'buy'))
    setAmount('')
    setQuoteOut(null)
  }

  function chooseToken(t: TokenInfo) {
    setSelectorOpen(false)
    if (t.symbol === token.symbol) return
    setToken(t)
    setAmount('')
    setQuoteOut(null)
  }

  const insufficient =
    amountIn !== null && spendBalance !== null && amountIn > spendBalance

  // --- build the ordered list of calls for this swap --------------------
  // For native input (ETH -> token) this is just the router `execute` call.
  // For ERC20 input (token -> ETH) it prepends the Permit2 approvals that are
  // actually still needed, so the whole thing can be batched into one click.
  async function buildSwapCalls(amountIn: bigint, minOut: bigint): Promise<Call[]> {
    const calls: Call[] = []
    const now = Math.floor(Date.now() / 1000)

    if (!spendToken.isNative && publicClient && address) {
      const erc20Allowance = await publicClient.readContract({
        address: spendToken.address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, PERMIT2],
      })
      if (erc20Allowance < amountIn) {
        calls.push({
          to: spendToken.address,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [PERMIT2, MAX_UINT256] }),
          value: 0n,
        })
      }

      const [permitAmount, expiration] = await publicClient.readContract({
        address: PERMIT2,
        abi: PERMIT2_ABI,
        functionName: 'allowance',
        args: [address, spendToken.address, UNIVERSAL_ROUTER],
      })
      if (permitAmount < amountIn || Number(expiration) <= now) {
        const newExpiration = now + 60 * 60 * 24 * 30 // 30 days
        calls.push({
          to: PERMIT2,
          data: encodeFunctionData({
            abi: PERMIT2_ABI,
            functionName: 'approve',
            args: [spendToken.address, UNIVERSAL_ROUTER, MAX_UINT160, newExpiration],
          }),
          value: 0n,
        })
      }
    }

    const { commands, inputs, value } = buildV4SwapCalldata(token, {
      zeroForOne,
      amountIn,
      amountOutMinimum: minOut,
    })
    const deadline = BigInt(now + 1200)
    calls.push({
      to: UNIVERSAL_ROUTER,
      data: encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, deadline] }),
      value,
    })

    return calls
  }

  // --- swap --------------------------------------------------------------
  async function handleSwap() {
    if (!publicClient || amountIn === null || minOut === null) return
    setBusy(true)
    setTxHash(null)
    setStatus(null)
    try {
      const calls = await buildSwapCalls(amountIn, minOut)
      const approvals = calls.length - 1

      // Send each call as its own transaction (approvals first, then the swap).
      const runSequential = async () => {
        for (let i = 0; i < calls.length; i++) {
          const isSwap = i === calls.length - 1
          setStatus(isSwap ? 'Confirm the swap in your wallet…' : `Confirm approval ${i + 1} of ${approvals}…`)
          const hash = await sendTransactionAsync({
            chainId: mainnet.id,
            to: calls[i].to,
            data: calls[i].data,
            value: calls[i].value,
          })
          if (isSwap) setTxHash(hash)
          await publicClient.waitForTransactionReceipt({ hash })
        }
      }

      // Batching only helps when there's more than one call (i.e. approvals +
      // swap). A lone swap (e.g. ETH -> token) always goes as a plain tx.
      if (oneClickAvailable && calls.length > 1) {
        try {
          setStatus('Confirm one-click swap (approve + swap)…')
          const res = (await sendCallsAsync({ chainId: mainnet.id, calls })) as { id?: string } | string
          const id = typeof res === 'string' ? res : res?.id
          setStatus('Bundled transaction submitted — waiting for confirmation…')
          if (id && walletClient?.waitForCallsStatus) {
            const { receipts } = await walletClient.waitForCallsStatus({ id })
            const last = receipts?.[receipts.length - 1]
            if (last?.transactionHash) setTxHash(last.transactionHash)
          }
        } catch (batchErr) {
          if (isUserRejection(batchErr)) throw batchErr
          // Wallet advertised 5792 but the batch failed — fall back gracefully.
          console.warn('one-click batch failed, falling back to sequential', batchErr)
          setStatus('One-click unavailable — using standard flow…')
          await runSequential()
        }
      } else {
        await runSequential()
      }

      setStatus('Swap confirmed ✓')
      setAmount('')
      setQuoteOut(null)
      loadBalance()
    } catch (err: unknown) {
      setStatus(isUserRejection(err) ? 'Transaction rejected.' : `Error: ${errMessage(err).slice(0, 160)}`)
    } finally {
      setBusy(false)
    }
  }

  // --- primary button ----------------------------------------------------
  function primaryButton() {
    if (!isConnected) {
      return (
        <button
          className="cta"
          disabled={isConnecting || connectors.length === 0}
          onClick={() => connect({ connector: connectors[0] })}
        >
          {isConnecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
      )
    }
    if (!onMainnet) {
      return (
        <button className="cta" onClick={() => switchChain({ chainId: mainnet.id })}>
          Switch to Ethereum
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
  // One-click is most meaningful when spending an ERC20 (it bundles approvals).
  const showOneClickHint = oneClickAvailable && !spendToken.isNative

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
      {/* header: Buy/Sell + network/account */}
      <div className="widget-head">
        <div className="segmented">
          <button className={side === 'buy' ? 'seg active' : 'seg'} onClick={() => setSide('buy')}>
            Buy
          </button>
          <button className={side === 'sell' ? 'seg active' : 'seg'} onClick={() => setSide('sell')}>
            Sell
          </button>
        </div>

        {isConnected ? (
          <button className="pill account-pill" onClick={() => disconnect()} title="Disconnect">
            <span className="dot" /> {address ? shortAddr(address) : 'Connected'}
          </button>
        ) : (
          <div className="pill">
            <EthIcon size={22} />
            <span>Ethereum</span>
            <Chevron size={16} />
          </div>
        )}
      </div>

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
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            />
            {tokenChip(spendToken)}
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

      {showOneClickHint && (
        <div className="oneclick-hint">⚡ One-click trading: approve + swap in a single confirmation</div>
      )}

      {primaryButton()}

      {status && (
        <div className={`status ${status.startsWith('Error') || status.includes('rejected') ? 'err' : ''}`}>
          {status}
          {txHash && (
            <>
              {' '}
              <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
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
          selected={token}
          onSelect={chooseToken}
          onClose={() => setSelectorOpen(false)}
        />
      )}
    </div>
  )
}
