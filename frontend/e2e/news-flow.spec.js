import { expect, test } from '@playwright/test'


test('onboarding leads to a filtered feed, detail, and source link', async ({ page, context }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'What should make your front page?' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Tech' }).check()
  await page.getByRole('button', { name: 'Build my briefing' }).click()

  await expect(page).toHaveURL(/\/feed$/)
  await expect(page.getByRole('heading', { name: 'Your briefing' })).toBeVisible()
  await expect(page.getByText('Browser-tested technology story')).toBeVisible()
  await expect(page.getByText('Filtered world story')).not.toBeVisible()

  await page.getByRole('link', { name: /Browser-tested technology story/ }).click()

  await expect(page).toHaveURL(/\/article\/1$/)
  await expect(page.getByRole('heading', { name: 'Browser-tested technology story' })).toBeVisible()
  await expect(page.getByText('The verified facts are visible in the browser.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Why it matters' })).toBeVisible()
  await expect(page.getByText('The impact explanation is visually distinct and available.')).toBeVisible()

  const sourceLink = page.getByRole('link', { name: /Read full article at Browser Source/ })
  await expect(sourceLink).toHaveAttribute('href', 'https://example.com/original-story')
  await expect(sourceLink).toHaveAttribute('target', '_blank')
  await expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer')
  await page.screenshot({ path: 'test-results/news-detail.png', fullPage: true })

  await context.route('https://example.com/original-story', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<title>Original story</title><h1>Original story</h1>',
  }))
  const popupPromise = page.waitForEvent('popup')
  await sourceLink.click()
  const popup = await popupPromise
  await expect(popup).toHaveURL('https://example.com/original-story')
  await popup.close()

  await page.goto('/')
  await expect(page).toHaveURL(/\/feed$/)
  await expect(page.getByText('Browser-tested technology story')).toBeVisible()
})
