// Server-only Privy helpers. The app secret is read from a non-NEXT_PUBLIC_
// env var, so it is never bundled into client code — don't import this file
// from a 'use client' module.
import { createRemoteJWKSet, jwtVerify } from 'jose'

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''
const APP_SECRET = process.env.PRIVY_APP_SECRET ?? ''
const JWKS_URL =
  process.env.PRIVY_JWKS_URL || `https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`

// jose caches the key set and refetches it when Privy rotates keys.
const jwks = createRemoteJWKSet(new URL(JWKS_URL))

export type PrivySession = {
  userId: string // Privy DID, e.g. did:privy:...
  sessionId?: string
  expiresAt?: number
}

/**
 * Verify a Privy access token (ES256 JWT) against the app's JWKS.
 * Throws if the signature, issuer, audience or expiry is invalid.
 */
export async function verifyPrivyToken(token: string): Promise<PrivySession> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: 'privy.io',
    audience: APP_ID,
    algorithms: ['ES256'],
  })
  if (!payload.sub) throw new Error('Token has no subject')
  return {
    userId: payload.sub,
    sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
    expiresAt: payload.exp,
  }
}

/**
 * Pull the access token from a request: `Authorization: Bearer <token>` (what
 * `getAccessToken()` gives the client) or the `privy-token` cookie (set when
 * HTTP-only cookies are enabled in the Privy dashboard).
 */
export function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie.match(/(?:^|;\s*)privy-token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export type PrivyUser = {
  id: string
  created_at: number
  linked_accounts: Array<{ type: string; address?: string; wallet_client_type?: string }>
}

/** Fetch a user from Privy's REST API (authenticated with the app secret). */
export async function getPrivyUser(userId: string): Promise<PrivyUser> {
  if (!APP_SECRET) throw new Error('PRIVY_APP_SECRET is not set')
  const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`,
      'privy-app-id': APP_ID,
    },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Privy user lookup failed (${res.status})`)
  return res.json()
}
