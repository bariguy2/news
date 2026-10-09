import { expect, test } from '@playwright/test'


test('onboarding leads to a filtered feed, detail, and source link', async ({ page, context }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'What should make your front page?' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Tech' }).check()
  await page.getByRole('button', { name: 'Build my briefing' }).click()

  await expect(page).toHaveURL(/\/feed$/)
  await expect(page.getByRole('heading', { name: 'Your briefing' })).toBeVisible()
  await expect(page.getByText('Browser-tested technology story')).toBeVisible()
  await expect(page.getByText('Technology story awaiting a summary')).toBeVisible()
  await expect(page.getByText('Summary in progress')).toBeVisible()
  await expect(page.getByRole('link', { name: /Read original at Pending Source/ })).toHaveAttribute('href', 'https://example.com/pending-story')
  await expect(page.getByRole('link', { name: /Open summary: Technology story awaiting a summary/ })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/news-feed-pending.png', fullPage: true })
  await expect(page.getByText('Filtered world story')).not.toBeVisible()

  const search = page.getByRole('searchbox', { name: 'Search articles' })
  await search.fill('BROWSER-TESTED')
  await expect(page.getByRole('heading', { name: 'Technology story awaiting a summary' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Open summary: Browser-tested technology story/ })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/news-search-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await search.fill('no-such-news-keyword')
  await expect(page.getByRole('heading', { name: 'No matching stories' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('heading', { name: 'Technology story awaiting a summary' })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })

  const choice = page.getByRole('button', { name: 'Summarize: Technology story you can choose' })
  await expect(choice).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open summary: Technology story you can choose' })).toHaveCount(0)
  await choice.click()
  await page.getByRole('link', { name: 'Open summary: Technology story you can choose' }).click()
  await expect(page.getByText('Requested facts are ready.')).toBeVisible()
  await expect(page.getByText('Requested impact is ready.')).toBeVisible()
  await page.goto('/feed')
  await expect(page.getByRole('link', { name: 'Open summary: Technology story you can choose' })).toBeVisible()
  await page.screenshot({ path: 'test-results/news-feed-choice.png', fullPage: true })

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
