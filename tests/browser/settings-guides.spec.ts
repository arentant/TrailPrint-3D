import { test, expect } from './authenticated'
import type { Page } from '@playwright/test'

async function checkVisibleGuides(page: Page): Promise<void> {
  // Every numeric setting must expose a guide, including conditional fields.
  for (const field of await page.locator('.field:visible, .slider:visible, .checkbox-row:visible').all()) {
    await expect(field.locator('[data-setting-guide] button')).toHaveCount(1)
  }
  const guides = page.locator('[data-setting-guide]:visible')
  expect(await guides.count()).toBeGreaterThan(10)
  for (const help of await guides.all()) {
    const trigger = help.getByRole('button')
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    const popup = page.getByRole('tooltip')
    await expect(popup).toBeVisible()
    await expect(popup.getByRole('img')).toHaveCount(1)
    await expect(popup.locator('.info-tip__title')).not.toBeEmpty()
    await expect(popup.locator('figcaption')).not.toBeEmpty()
    await expect(popup.locator('.info-tip__content')).not.toBeEmpty()
    await expect(trigger).toHaveAttribute('aria-describedby', (await popup.getAttribute('id'))!)
    await trigger.press('Escape')
    await expect(popup).toHaveCount(0)
  }
}

test('setting guides support hover, keyboard, pinned clicks, dismissal and small screens', async ({ page }) => {
  await page.goto('/')
  const radius = page.locator('[data-setting-guide="radius"] button')
  await radius.hover()
  await expect(page.getByRole('tooltip')).toContainText('Radius is half the full diameter.')
  await page.mouse.move(1000, 150)
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  await radius.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await radius.press('Escape')
  await expect(radius).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await radius.press('Tab')
  await expect(page.getByRole('spinbutton', { name: 'Print radius', exact: true })).toBeFocused()

  await radius.click()
  await page.mouse.move(1000, 150)
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.screenshot({ path: 'test-results/settings-guide-radius.png' })
  await page.getByRole('heading', { name: 'TrailPrint', exact: true }).click()
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  await radius.click()
  await page.locator('[data-setting-guide="shape"] button').focus()
  await expect(page.getByRole('tooltip')).toHaveCount(1)
  await expect(page.getByRole('tooltip')).toContainText('Print shape')
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 360, height: 560 })
  const elevation = page.locator('[data-setting-guide="elevation"] button')
  await elevation.click()
  const popup = page.getByRole('tooltip')
  await expect(popup).toBeVisible()
  const box = (await popup.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(12)
  expect(box.x + box.width).toBeLessThanOrEqual(348)
  expect(box.y).toBeGreaterThanOrEqual(12)
  expect(box.y + box.height).toBeLessThanOrEqual(548)
  await page.screenshot({ path: 'test-results/settings-guide-small-screen.png' })
  await page.keyboard.press('Escape')
})

test('Mountain guides cover every setting, optional electronics, magnets, masks, mold and presets', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Custom', exact: true }).click()
  for (const name of ['NFC & LED indicators', 'Underside magnet holes']) {
    const toggle = page.getByRole('switch', { name, exact: true })
    if (await toggle.getAttribute('aria-checked') === 'false') await toggle.click()
  }
  await page.getByRole('button', { name: '6. Paint masks', exact: false }).click()
  await page.getByRole('switch', { name: 'Enable paint masks', exact: true }).click()
  await page.getByRole('button', { name: '7. Mold kit', exact: false }).click()
  await page.getByRole('switch', { name: 'Enable mold kit', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced: fit clearance', exact: true }).click()
  await checkVisibleGuides(page)

  // Disabled synchronized fields still have usable help controls.
  await expect(page.getByRole('spinbutton', { name: 'Lid height', exact: true })).toBeDisabled()
  await page.locator('[data-setting-guide="lidHeight"] button').click()
  await expect(page.getByRole('tooltip')).toContainText('Turn off Match skirt dimensions')
  await page.screenshot({ path: 'test-results/settings-guide-mold.png' })
  await page.keyboard.press('Escape')

  for (const shape of ['Rectangle', 'Polygon']) {
    await page.getByRole('group', { name: 'Print shape', exact: true }).getByRole('button', { name: shape, exact: true }).click()
    await checkVisibleGuides(page)
  }
  await page.getByRole('button', { name: 'Save preset', exact: true }).click()
  await page.locator('[data-setting-guide="saveFraming"] button').click()
  await expect(page.getByRole('tooltip')).toContainText('Location, zoom, and rotation')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Save preset', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('City guides cover surface, map shapes, layers and all four route dimensions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'City', exact: true }).click()
  await page.getByRole('button', { name: 'Real terrain', exact: true }).click()
  await page.getByRole('combobox', { name: 'Mesh quality', exact: true }).selectOption('custom')
  await checkVisibleGuides(page)
  for (const shape of ['Rectangle', 'Polygon']) {
    await page.getByRole('button', { name: shape, exact: true }).click()
    await checkVisibleGuides(page)
  }
  for (const label of ['Show buildings', 'Show roads & footpaths']) {
    const checkbox = page.getByRole('checkbox', { name: label, exact: true })
    await checkbox.locator('..').click()
    await expect(checkbox).not.toBeChecked()
    const trigger = checkbox.locator('..').locator('..').locator('[data-setting-guide] button')
    await trigger.click()
    await expect(page.getByRole('tooltip').getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(errors).toEqual([])
})
