import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { authEnv, sessionCookie } from '../auth-fixture.mjs'
import { generateKeyPair, SignJWT } from 'jose'

let output
let elevation
let auth
let createAuthConfig
let getAuthSettings
const previousEnv = Object.fromEntries(Object.keys(authEnv).map((key) => [key, process.env[key]]))

before(async () => {
  Object.assign(process.env, authEnv)
  output = await mkdtemp(join(tmpdir(), 'trailprint-api-runtime-'))
  // Compile without Vite or a bundler, as Vercel's Node runtime does. Importing
  // this output catches missing .js extensions in every transitive dependency.
  execFileSync(process.execPath, [
    resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.api.json',
    '--noEmit', 'false', '--rootDir', '.', '--outDir', output,
  ], { stdio: 'pipe' })
  await writeFile(join(output, 'package.json'), '{"type":"module"}\n')
  await symlink(resolve('node_modules'), join(output, 'node_modules'), 'dir')
  elevation = (await import(pathToFileURL(join(output, 'api/elevation.js')).href)).default
  const module = await import(pathToFileURL(join(output, 'server/auth.js')).href)
  auth = module.handleAuth
  createAuthConfig = module.createAuthConfig
  getAuthSettings = module.getAuthSettings
})

after(async () => {
  if (output) await rm(output, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

async function invoke(request, handler = elevation) {
  const result = { status: undefined, headers: {}, body: undefined }
  const response = {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; return this },
    writeHead(status, headers = {}) {
      result.status = status
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
      return this
    },
    end(body) { result.body = body; return this },
  }
  await handler({ headers: {}, ...request }, response)
  return result
}

test('the compiled endpoint starts in plain Node and handles GET', async () => {
  const response = await invoke({ method: 'GET' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.allow, 'POST')
  assert.equal(response.headers['cache-control'], 'private, no-store')
  assert.deepEqual(JSON.parse(response.body), { error: 'Use POST for elevation requests' })
})

test('Vercel-parsed POST bodies reach validation instead of a startup crash', async () => {
  const response = await invoke({ method: 'POST', body: {}, headers: { cookie: await cookieHeader() } })
  assert.equal(response.status, 400)
  assert.deepEqual(JSON.parse(response.body), { error: 'Enter a valid OpenTopography API key' })
})

async function cookieHeader(options) {
  const cookie = await sessionCookie(options)
  return `${cookie.name}=${cookie.value}`
}

function authRequest(path, request = {}) {
  return invoke({ url: `/api/auth/${path}`, method: 'GET', ...request }, auth)
}

function cookiesFrom(response) {
  return (response.headers['set-cookie'] ?? []).map((cookie) => cookie.split(';')[0]).join('; ')
}

test('authentication requires complete configuration and exact addresses', () => {
  for (const field of Object.keys(authEnv)) {
    assert.throws(() => getAuthSettings({ ...authEnv, [field]: '' }))
  }
  assert.throws(() => getAuthSettings({ ...authEnv, AUTH_SECRET: 'too-short' }))
  assert.throws(() => getAuthSettings({ ...authEnv, ALLOWED_EMAILS: '*@example.com' }))
  assert.throws(() => getAuthSettings({ ...authEnv, AUTH_URL: 'http://public.example.com' }))
  assert.throws(() => getAuthSettings({ ...authEnv, VERCEL: '1' }))
  const settings = getAuthSettings({ ...authEnv, ALLOWED_EMAILS: ' Allowed@Example.COM ,\n teammate@example.org ' })
  assert.deepEqual([...settings.allowedEmails], ['allowed@example.com', 'teammate@example.org'])
})

test('Google sign-in requires both a verified email and an exact allowlist match', async () => {
  const { signIn } = createAuthConfig(getAuthSettings()).callbacks
  for (const email of ['allowed@example.com', 'TEAMMATE@EXAMPLE.ORG']) {
    assert.equal(await signIn({ account: { provider: 'google' }, profile: { email, email_verified: true } }), true)
  }
  for (const profile of [
    { email: 'allowed@example.com', email_verified: false },
    { email: 'allowed@example.com' },
    { email: 'other@example.com', email_verified: true },
    { email: 'allowed@example.com.evil.test', email_verified: true },
    { email: 'allowed+alias@example.com', email_verified: true },
  ]) {
    assert.equal(await signIn({ account: { provider: 'google' }, profile }), false)
  }
  assert.equal(await signIn({ account: { provider: 'github' }, profile: { email: 'allowed@example.com', email_verified: true } }), false)
})

test('JWT updates cannot change identity using client-supplied session data', async () => {
  const { jwt } = createAuthConfig(getAuthSettings()).callbacks
  const token = { email: 'allowed@example.com', emailVerified: true, provider: 'google' }
  assert.equal(await jwt({ token, trigger: 'update', session: { email: 'other@example.com', emailVerified: true } }), token)
  assert.equal(await jwt({ token: { ...token, email: 'other@example.com' }, trigger: 'update', session: token }), null)
})

test('missing, tampered, expired, unverified, and unapproved sessions cannot use elevation', async () => {
  const cookies = [
    '', 'authjs.session-token=forged',
    await cookieHeader({ maxAge: -3600 }),
    await cookieHeader({ secret: 'different-test-secret-00000000000000000000' }),
    await cookieHeader({ verified: false }),
    await cookieHeader({ email: 'other@example.com' }),
  ]
  for (const cookie of cookies) {
    const response = await invoke({ method: 'POST', body: {}, headers: { cookie } })
    assert.equal(response.status, 401)
  }
})

test('removing an email revokes its existing cookie on the next request', async () => {
  const cookie = await cookieHeader()
  const previous = process.env.ALLOWED_EMAILS
  try {
    process.env.ALLOWED_EMAILS = 'teammate@example.org'
    const response = await invoke({ method: 'POST', body: {}, headers: { cookie } })
    assert.equal(response.status, 401)
    assert.ok(response.headers['set-cookie'].some((value) => value.includes('authjs.session-token=;')))
  } finally {
    process.env.ALLOWED_EMAILS = previous
  }
})

test('missing configuration fails closed and cross-origin authenticated POSTs are rejected', async () => {
  const secret = process.env.AUTH_SECRET
  try {
    delete process.env.AUTH_SECRET
    assert.equal((await invoke({ method: 'POST', body: {} })).status, 503)
    assert.equal((await authRequest('session')).status, 503)
  } finally {
    process.env.AUTH_SECRET = secret
  }
  const headers = { cookie: await cookieHeader(), origin: 'https://untrusted.example' }
  assert.equal((await invoke({ method: 'POST', body: {}, headers })).status, 403)
  assert.equal((await authRequest('signout', { method: 'POST', body: {}, headers })).status, 403)
})

test('session and rewritten Vercel routes expose only the approved identity', async () => {
  assert.equal(JSON.parse((await authRequest('session')).body), null)
  const response = await invoke({ method: 'GET', url: '/api/auth?authPath=session', headers: { cookie: await cookieHeader() } }, auth)
  assert.equal(response.status, 200)
  const session = JSON.parse(response.body)
  assert.deepEqual(session.user, { name: 'Test User', email: 'allowed@example.com' })
  assert.ok(session.expires)
  assert.equal(response.headers['cache-control'], 'private, no-store')
})

test('sign-out requires CSRF and clears the session with a valid token', async () => {
  const cookie = await cookieHeader()
  const denied = await authRequest('signout', { method: 'POST', body: {}, headers: { cookie } })
  assert.ok(!denied.headers['set-cookie']?.some((value) => value.includes('authjs.session-token=;')))
  const csrf = await authRequest('csrf')
  const csrfToken = JSON.parse(csrf.body).csrfToken
  const response = await authRequest('signout', {
    method: 'POST',
    headers: { cookie: `${cookie}; ${cookiesFrom(csrf)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: { csrfToken, callbackUrl: 'https://untrusted.example' },
  })
  assert.equal(response.status, 302)
  assert.equal(response.headers.location, authEnv.AUTH_URL)
  assert.ok(response.headers['set-cookie'].some((value) => value.includes('authjs.session-token=;')))
})

test('HTTPS cookies are HttpOnly, Secure, SameSite=Lax and never cached', async () => {
  const origin = process.env.AUTH_URL
  try {
    process.env.AUTH_URL = 'https://trailprint.example'
    const cookie = await cookieHeader({ origin: process.env.AUTH_URL })
    const response = await authRequest('session', { headers: { cookie } })
    const sessionCookie = response.headers['set-cookie'].find((value) => value.startsWith('__Secure-authjs.session-token='))
    assert.match(sessionCookie, /HttpOnly/)
    assert.match(sessionCookie, /Secure/)
    assert.match(sessionCookie, /SameSite=Lax/)
    assert.equal(response.headers['cache-control'], 'private, no-store')
  } finally {
    process.env.AUTH_URL = origin
  }
})

test('Google OAuth round trip uses state, PKCE and nonce, then enforces the allowlist', async (t) => {
  const { privateKey } = await generateKeyPair('RS256')
  let nonce
  let profile = { email: 'allowed@example.com', email_verified: true }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === 'https://accounts.google.com/.well-known/openid-configuration') {
      return Response.json({
        issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token', userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs', code_challenge_methods_supported: ['S256'],
      })
    }
    assert.equal(String(url), 'https://oauth2.googleapis.com/token')
    assert.ok(new URLSearchParams(init.body).get('code_verifier'))
    const id_token = await new SignJWT({ ...profile, nonce, name: 'Google Test User' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com')
      .setAudience(authEnv.AUTH_GOOGLE_ID).setSubject('google-user').setIssuedAt().setExpirationTime('5m').sign(privateKey)
    return Response.json({ access_token: 'test-provider-token', token_type: 'Bearer', expires_in: 300, id_token })
  })

  async function begin() {
    const csrf = await authRequest('csrf')
    const response = await authRequest('signin/google?redirect_uri=https://untrusted.example&scope=unwanted', {
      method: 'POST', headers: { cookie: cookiesFrom(csrf), 'content-type': 'application/json', host: 'untrusted.example' },
      body: { csrfToken: JSON.parse(csrf.body).csrfToken },
    })
    assert.equal(response.status, 302)
    const url = new URL(response.headers.location)
    assert.equal(url.origin, 'https://accounts.google.com')
    assert.equal(url.searchParams.get('redirect_uri'), `${authEnv.AUTH_URL}/api/auth/callback/google`)
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('scope'), 'openid email profile')
    assert.ok(url.searchParams.get('code_challenge'))
    assert.ok(url.searchParams.get('state'))
    nonce = url.searchParams.get('nonce')
    assert.ok(nonce)
    return { state: url.searchParams.get('state'), cookie: `${cookiesFrom(csrf)}; ${cookiesFrom(response)}` }
  }

  const approved = await begin()
  const callback = await authRequest(`callback/google?code=test-code&state=${approved.state}`, { headers: { cookie: approved.cookie } })
  assert.equal(callback.headers.location, authEnv.AUTH_URL)
  const signedIn = await authRequest('session', { headers: { cookie: cookiesFrom(callback) } })
  assert.equal(JSON.parse(signedIn.body).user.email, profile.email)

  for (const rejected of [
    { email: 'other@example.com', email_verified: true },
    { email: 'allowed@example.com', email_verified: false },
  ]) {
    profile = rejected
    const flow = await begin()
    const denied = await authRequest(`callback/google?code=test-code&state=${flow.state}`, { headers: { cookie: flow.cookie } })
    assert.equal(new URL(denied.headers.location).searchParams.get('error'), 'AccessDenied')
    assert.ok(!denied.headers['set-cookie']?.some((value) => value.startsWith('authjs.session-token=')))
  }
  const flow = await begin()
  const mismatch = await authRequest('callback/google?code=test-code&state=wrong-state', { headers: { cookie: flow.cookie } })
  assert.ok(new URL(mismatch.headers.location).searchParams.get('error'))
  assert.ok(!mismatch.headers['set-cookie']?.some((value) => value.startsWith('authjs.session-token=')))
})
