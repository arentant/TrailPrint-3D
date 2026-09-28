import { encode } from '@auth/core/jwt'

// Test-only credentials. The app has no auth bypass, including in development.
export const authEnv = {
  AUTH_URL: 'http://127.0.0.1:4173',
  AUTH_SECRET: 'test-only-session-secret-not-for-production-000000000000',
  AUTH_GOOGLE_ID: 'test-google-client',
  AUTH_GOOGLE_SECRET: 'test-google-secret',
  ALLOWED_EMAILS: 'allowed@example.com,teammate@example.org',
}

export async function sessionCookie({ email = 'allowed@example.com', secret = authEnv.AUTH_SECRET, maxAge = 3600, verified = true, origin = authEnv.AUTH_URL } = {}) {
  const name = `${origin.startsWith('https:') ? '__Secure-' : ''}authjs.session-token`
  const value = await encode({
    secret, salt: name, maxAge,
    token: { sub: 'test-user', name: 'Test User', email, emailVerified: verified, provider: 'google' },
  })
  return { name, value }
}
