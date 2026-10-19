import { NextResponse } from 'next/server'
import { getPrivyUser, tokenFromRequest, verifyPrivyToken } from '@/lib/privy-server'

// GET /api/me — verifies the caller's Privy access token server-side and
// returns their Privy user id plus linked wallet addresses. Use this as the
// pattern for any route that needs an authenticated user.
export async function GET(req: Request) {
  const token = tokenFromRequest(req)
  if (!token) {
    return NextResponse.json({ error: 'Missing Privy access token' }, { status: 401 })
  }

  let userId: string
  try {
    ;({ userId } = await verifyPrivyToken(token))
  } catch {
    return NextResponse.json({ error: 'Invalid or expired access token' }, { status: 401 })
  }

  try {
    const user = await getPrivyUser(userId)
    const wallets = user.linked_accounts
      .filter((a) => a.type === 'wallet' && a.address)
      .map((a) => ({ address: a.address, walletClientType: a.wallet_client_type }))
    return NextResponse.json({ userId, wallets })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Could not load user' }, { status: 502 })
  }
}
