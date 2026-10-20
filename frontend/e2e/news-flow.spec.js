import { expect, test } from '@playwright/test'


test('onboarding leads to a filtered feed, detail, and source link', async ({ page, context }) => {
  test.setTimeout(45_000)
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

  await context.route('https://example.com/pending-story', (route) => route.fulfill({
    contentType: 'text/html', body: '<h1>Original pending story</h1>',
  }))
  const pendingCard = page.locator('.story-card').filter({ has: page.getByRole('heading', { name: 'Technology story awaiting a summary' }) })
  const pendingPopupPromise = page.waitForEvent('popup')
  await pendingCard.getByRole('link', { name: /Read original/ }).click()
  const pendingPopup = await pendingPopupPromise
  await expect(pendingPopup).toHaveURL('https://example.com/pending-story')
  await pendingPopup.close()
  await expect(pendingCard.getByText('Read', { exact: true })).toBeVisible()
  await page.reload()
  await expect(pendingCard.getByText('Read', { exact: true })).toBeVisible()
  await expect(pendingCard.getByText('Summary in progress')).toBeVisible()

  const choice = page.getByRole('button', { name: 'Summarize: Technology story you can choose' })
  await expect(choice).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open summary: Technology story you can choose' })).toHaveCount(0)
  await choice.click()
  // Hold one stale list response: completion must enable the card without it.
  let delayedFeedResponse = false
  let releaseFeedResponse
  await page.route((url) => url.pathname === '/api/articles', async (route) => {
    const response = await route.fetch()
    const rows = await response.json()
    if (!delayedFeedResponse && rows.some((row) => row.id === 4 && row.summary_status === 'pending')) {
      delayedFeedResponse = true
      await new Promise((resolve) => { releaseFeedResponse = resolve })
    }
    await route.fulfill({ response })
  })
  const progress = page.getByRole('progressbar', { name: 'Summary progress for Technology story you can choose' })
  await expect(progress).toHaveAttribute('aria-valuenow', '18', { timeout: 10_000 })
  await expect(progress).toHaveAttribute('aria-valuenow', '43', { timeout: 10_000 })
  const fill = progress.locator('.article-progress-fill')
  await expect(fill).toHaveCSS('transition-duration', '0.8s')
  // Capture actual interpolation between two backend-reported percentages.
  const animatedPercent = await fill.evaluate((element) => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve(element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width * 100)
    }))
  }))
  expect(animatedPercent).toBeGreaterThan(18)
  expect(animatedPercent).toBeLessThan(43)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(fill).toHaveCSS('transition-duration', '0s')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/news-article-progress-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(progress).toHaveAttribute('aria-valuenow', '100', { timeout: 10_000 })
  try {
    expect(delayedFeedResponse).toBe(true)
    await expect(page.getByRole('link', { name: 'Open summary: Technology story you can choose' })).toBeVisible({ timeout: 1_000 })
  } finally {
    releaseFeedResponse?.()
  }
  await expect(page.getByRole('heading', { name: 'Summary processing' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Open summary: Technology story you can choose' }).click()
  await expect(page.getByText('Requested facts are ready.')).toBeVisible()
  await expect(page.getByText('Requested impact is ready.')).toBeVisible()
  await expect(page.getByText('Read', { exact: true })).toBeVisible()
  await page.goto('/feed')
  await expect(page.getByRole('link', { name: 'Open summary: Technology story you can choose' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open summary: Technology story you can choose' }).getByText('Read', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/news-feed-choice.png', fullPage: true })

  await page.getByRole('link', { name: /Browser-tested technology story/ }).click()

  await expect(page).toHaveURL(/\/article\/1$/)
  await expect(page.getByRole('heading', { name: 'Browser-tested technology story' })).toBeVisible()
  await expect(page.getByText('The verified facts are visible in the browser.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Why it matters' })).toBeVisible()
  await expect(page.getByText('The impact explanation is visually distinct and available.')).toBeVisible()
  await expect(page.getByText('Read', { exact: true })).toBeVisible()

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
  const readCard = page.getByRole('link', { name: /Open summary: Browser-tested technology story/ })
  await expect(readCard.getByText('Read', { exact: true })).toBeVisible()
  await page.reload()
  await expect(readCard.getByText('Read', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/news-read-mobile.png', fullPage: true })

  await page.goto('/article/4')
  await expect(page.getByText('Requested facts are ready.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Summarize again' })).toBeVisible()
  await page.screenshot({ path: 'test-results/news-resummarize-mobile.png', fullPage: true })
  const regenerationResponse = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes('/api/articles/4/summarize?regenerate=true'))
  await page.getByRole('button', { name: 'Summarize again' }).click()
  const queuedResponse = await regenerationResponse
  expect(queuedResponse.status()).toBe(200)
  expect(await queuedResponse.json()).toEqual({ summary_status: 'pending' })
  await expect(page).toHaveURL(/\/feed$/)
  await expect(progress).toHaveAttribute('aria-valuenow', '18', { timeout: 10_000 })
  const regeneratingCard = page.locator('.story-card').filter({ has: page.getByRole('heading', { name: 'Technology story you can choose' }) })
  await expect(regeneratingCard.getByText('Read', { exact: true })).toBeVisible()
  await expect(progress).toHaveAttribute('aria-valuenow', '100', { timeout: 10_000 })
  await page.getByRole('link', { name: 'Open summary: Technology story you can choose' }).click()
  await expect(page.getByText('Regenerated facts are ready.')).toBeVisible()
  await expect(page.getByText('Regenerated impact is ready.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Regenerated facts are ready.')).toBeVisible()
})
