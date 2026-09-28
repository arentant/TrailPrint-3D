import { Auth, type AuthConfig } from '@auth/core'
import Google from '@auth/core/providers/google'
import type { Session } from '@auth/core/types'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type ApiRequest = IncomingMessage & { body?: unknown }
const SESSION_MAX_AGE = 8 * 60 * 60
const MAX_AUTH_BODY_BYTES = 16 * 1024

export interface AuthSettings {
  origin: string
  secret: string
  clientId: string
  clientSecret: string
  allowedEmails: Set<string>
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function getAuthSettings(env = process.env): AuthSettings {
  const required = ['AUTH_URL', 'AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'ALLOWED_EMAILS']
  if (required.some((key) => !env[key]?.trim())) throw new Error('Authentication is not configured')
  const url = new URL(env.AUTH_URL!)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:' && !env.VERCEL)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AUTH_URL must be the application origin, using HTTPS outside local development')
  }
  if (env.AUTH_SECRET!.trim().length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters')
  const allowedEmails = new Set(env.ALLOWED_EMAILS!.split(/[,\n]/).map(normalizeEmail).filter(Boolean))
  if (!allowedEmails.size || [...allowedEmails].some((email) => !/^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/.test(email))) {
    throw new Error('ALLOWED_EMAILS must contain exact email addresses')
  }
  return {
    origin: url.origin,
    secret: env.AUTH_SECRET!.trim(),
    clientId: env.AUTH_GOOGLE_ID!.trim(),
    clientSecret: env.AUTH_GOOGLE_SECRET!.trim(),
    allowedEmails,
  }
}

export function createAuthConfig(settings: AuthSettings): AuthConfig {
  const allowed = (email: unknown) => settings.allowedEmails.has(normalizeEmail(email))
  return {
    basePath: '/api/auth',
    // Requests are constructed from AUTH_URL below, never forwarded host headers.
    trustHost: true,
    secret: settings.secret,
    useSecureCookies: settings.origin.startsWith('https:'),
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE },
    providers: [Google({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      checks: ['pkce', 'state', 'nonce'],
      authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } },
    })],
    pages: { signIn: '/', error: '/' },
    callbacks: {
      signIn({ account, profile }) {
        return account?.provider === 'google' && profile?.email_verified === true && allowed(profile.email)
      },
      jwt({ token, account, profile }) {
        if (account) {
          if (account.provider !== 'google' || profile?.email_verified !== true || !allowed(profile.email)) return null
          token.email = normalizeEmail(profile.email)
          token.emailVerified = true
          token.provider = 'google'
        }
        // Recheck on every session read. Removing an address also revokes existing sessions.
        // Never copy values from a client-supplied session update into the token.
        return token.provider === 'google' && token.emailVerified === true && allowed(token.email) ? token : null
      },
      session({ session, token }) {
        return { expires: session.expires, user: { name: token.name, email: token.email } }
      },
      redirect() { return settings.origin },
    },
    logger: {
      // Auth errors can contain provider responses; log the category, not tokens or profiles.
      error(error) { console.error('[auth]', error.name) },
      warn(code) { console.warn('[auth]', code) },
      debug() {},
    },
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

function copyCookies(response: Response, res: ServerResponse): void {
  const cookies = response.headers.getSetCookie()
  if (cookies.length) res.setHeader('Set-Cookie', cookies)
}

export async function requireSession(req: ApiRequest, res: ServerResponse): Promise<Session | null> {
  let settings: AuthSettings
  try {
    settings = getAuthSettings()
  } catch {
    sendJson(res, 503, { error: 'Sign-in is not configured. Please contact the app owner.' })
    return null
  }
  if (req.headers.origin && req.headers.origin !== settings.origin) {
    sendJson(res, 403, { error: 'This request is not allowed.' })
    return null
  }
  const response = await Auth(new Request(`${settings.origin}/api/auth/session`, {
    headers: { cookie: req.headers.cookie ?? '' },
  }), createAuthConfig(settings))
  copyCookies(response, res)
  if (!response.ok) {
    sendJson(res, 503, { error: 'Sign-in is temporarily unavailable. Please try again.' })
    return null
  }
  const session = await response.json() as Session | null
  if (!session?.user?.email || !settings.allowedEmails.has(normalizeEmail(session.user.email))) {
    sendJson(res, 401, { error: 'Sign in with an approved Google account to continue.' })
    return null
  }
  return session
}

async function readAuthBody(req: ApiRequest): Promise<string | undefined> {
  if (req.method !== 'POST') return undefined
  let body: string
  if (req.body !== undefined) {
    if (typeof req.body === 'string') body = req.body
    else if (Buffer.isBuffer(req.body)) body = req.body.toString('utf8')
    else if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      body = new URLSearchParams(req.body as Record<string, string>).toString()
    } else body = JSON.stringify(req.body)
  } else {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_AUTH_BODY_BYTES) throw new Error('Request too large')
      chunks.push(bytes)
    }
    body = Buffer.concat(chunks).toString('utf8')
  }
  if (Buffer.byteLength(body) > MAX_AUTH_BODY_BYTES) throw new Error('Request too large')
  return body
}

export async function handleAuth(req: ApiRequest, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  let settings: AuthSettings
  try {
    settings = getAuthSettings()
  } catch {
    sendJson(res, 503, { error: 'Sign-in is not configured. Please contact the app owner.' })
    return
  }
  const incoming = new URL(req.url ?? '/', settings.origin)
  // Vercel rewrites /api/auth/:path* to this single function. Vite keeps the original path.
  const path = incoming.pathname === '/api/auth'
    ? `/api/auth/${incoming.searchParams.get('authPath') ?? ''}` : incoming.pathname
  if (!/^\/api\/auth\/(session|csrf|providers|signin(?:\/google)?|callback\/google|signout|error)$/.test(path)) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  const url = new URL(path, settings.origin)
  url.search = incoming.search
  url.searchParams.delete('authPath')
  if (path.startsWith('/api/auth/signin')) url.search = ''
  if (req.method === 'POST' && req.headers.origin && req.headers.origin !== settings.origin) {
    sendJson(res, 403, { error: 'This request is not allowed.' })
    return
  }
  let body: string | undefined
  try {
    body = await readAuthBody(req)
  } catch {
    sendJson(res, 400, { error: 'Invalid sign-in request' })
    return
  }
  const headers = new Headers()
  for (const name of ['cookie', 'content-type', 'x-auth-return-redirect']) {
    const value = req.headers[name]
    if (typeof value === 'string') headers.set(name, value)
  }
  const response = await Auth(new Request(url, { method: req.method, headers, body }), createAuthConfig(settings))
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value)
  })
  copyCookies(response, res)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.writeHead(response.status).end(Buffer.from(await response.arrayBuffer()))
}
