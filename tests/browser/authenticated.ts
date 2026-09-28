import { test as base, expect } from '@playwright/test'
import { authEnv, sessionCookie } from '../auth-fixture.mjs'

export const test = base.extend({
  page: async ({ page, context }, use) => {
    const cookie = await sessionCookie()
    await context.addCookies([{ ...cookie, url: authEnv.AUTH_URL, httpOnly: true, sameSite: 'Lax' }])
    await use(page)
  },
})
export { expect }
