import { test, expect } from '@playwright/test'
import { authEnv, sessionCookie } from '../auth-fixture.mjs'

test('signed-out visitors see sign-in and cannot call the elevation API', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to TrailPrint' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import GPX', exact: true })).toBeHidden()
  expect((await page.request.post('/api/elevation', { data: {} })).status()).toBe(401)
  await page.screenshot({ path: 'test-results/sign-in-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: 'test-results/sign-in-mobile.png', fullPage: true })
})

test('an approved session opens the app and sign-out removes access', async ({ page, context }) => {
  const cookie = await sessionCookie()
  await context.addCookies([{ ...cookie, url: authEnv.AUTH_URL, httpOnly: true, sameSite: 'Lax' }])
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Import GPX', exact: true })).toBeVisible()
  await expect(page.getByText('allowed@example.com', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  expect((await page.request.post('/api/elevation', { data: {} })).status()).toBe(401)
})

test('an unapproved email cannot open the workspace even with a valid signed cookie', async ({ page, context }) => {
  const cookie = await sessionCookie({ email: 'unapproved@example.com' })
  await context.addCookies([{ ...cookie, url: authEnv.AUTH_URL }])
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import GPX', exact: true })).toBeHidden()
  expect((await page.request.post('/api/elevation', { data: {} })).status()).toBe(401)
})

test('access denial is explained without exposing the allowlist', async ({ page }) => {
  await page.goto('/?error=AccessDenied')
  await expect(page.getByRole('alert')).toContainText('does not have access')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByText('allowed@example.com')).toBeHidden()
})

test('the workspace closes when its session expires', async ({ page, context }) => {
  const cookie = await sessionCookie()
  await context.addCookies([{ ...cookie, url: authEnv.AUTH_URL }])
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Import GPX', exact: true })).toBeVisible()
  await context.clearCookies()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('session has ended')
  await expect(page.getByRole('button', { name: 'Import GPX', exact: true })).toBeHidden()
})
