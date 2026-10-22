import { expect, test } from '@playwright/test'

const backendURL = `http://127.0.0.1:${process.env.NEWS_E2E_BACKEND_PORT ?? '8000'}`


test('onboarding leads to a filtered feed, detail, and source link', async ({ page, context }) => {
  test.setTimeout(45_000)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'What should make your front page?' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Tech' }).check()
  await page.getByRole('checkbox', { name: 'Business' }).check()
  await page.getByRole('checkbox', { name: 'Sports' }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Make it more your own.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Science', exact: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Finance & banking' }).check()
  await page.getByRole('checkbox', { name: 'Artificial intelligence', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Basketball', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Toronto Raptors', exact: true }).check()
  await page.getByRole('textbox', { name: 'Add another basketball team' }).fill('Ottawa BlackJacks')
  await page.getByRole('button', { name: 'Add team' }).click()
  await page.getByRole('button', { name: 'Back to categories' }).click()
  await expect(page.getByRole('checkbox', { name: 'Business' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Sports' })).toBeChecked()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('checkbox', { name: 'Toronto Raptors' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Ottawa BlackJacks' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Finance & banking' })).toBeChecked()
  const beforeSave = await (await page.request.get(`${backendURL}/api/preferences`)).json()
  expect(beforeSave.onboarded).toBe(false)
  await page.screenshot({ path: 'test-results/news-onboarding-interests-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/news-onboarding-interests-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'How do you like your news?' })).toBeVisible()
  await page.getByRole('radio', { name: 'Conversational' }).check()
  await page.getByRole('radio', { name: 'Brief' }).check()
  await page.getByRole('radio', { name: 'Mixed' }).check()
  await page.getByRole('button', { name: 'Back to topics' }).click()
  await expect(page.getByRole('checkbox', { name: 'Finance & banking' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Toronto Raptors' })).toBeChecked()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('radio', { name: 'Conversational' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Brief' })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Mixed' })).toBeChecked()
  const preview = page.locator('.style-preview')
  const typedTextLength = () => preview.locator('.typing-preview-visible').evaluateAll((elements) =>
    elements.reduce((total, element) => total + element.textContent.length, 0))
  const fullPreviewLength = await preview.locator('.typing-preview-reserve').evaluateAll((elements) =>
    elements.reduce((total, element) => total + element.textContent.length, 0))
  const initialTyped = await typedTextLength()
  const previewHeight = (await preview.boundingBox()).height
  await expect.poll(typedTextLength, { timeout: 1_000 }).toBeGreaterThan(initialTyped)
  expect(await typedTextLength()).toBeLessThan(fullPreviewLength)
  expect((await preview.boundingBox()).height).toBe(previewHeight)
  await page.screenshot({ path: 'test-results/news-summary-preview-typing.png', fullPage: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(preview.locator('[data-typing="true"]')).toHaveCount(0)
  expect(await typedTextLength()).toBe(fullPreviewLength)
  await page.getByRole('radio', { name: 'Bullet points' }).check()
  await expect(preview.locator('[data-typing="true"]')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Mixed' }).check()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(preview.locator('[data-typing="true"]')).toHaveCount(0, { timeout: 5_000 })
  await page.screenshot({ path: 'test-results/news-summary-style-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/news-summary-style-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
  const savedPreferences = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/preferences')
  await page.getByRole('button', { name: 'Build my briefing' }).click()
  const preferences = await (await savedPreferences).json()
  expect(preferences.summary_style).toEqual({ tone: 'conversational', length: 'brief', format: 'mixed' })
  expect(preferences.focused_interests).toEqual({
    Business: { topics: ['Finance & banking'], teams: {} },
    Tech: { topics: ['Artificial intelligence'], teams: {} },
    Sports: { topics: ['Basketball'], teams: { Basketball: ['Toronto Raptors', 'Ottawa BlackJacks'] } },
  })

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
  const persistedPreferences = await (await page.request.get(`${backendURL}/api/preferences`)).json()
  expect(persistedPreferences.focused_interests).toEqual(preferences.focused_interests)
  expect(persistedPreferences.summary_style).toEqual(preferences.summary_style)
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
  await expect(page.locator('.facts-section').getByRole('listitem')).toHaveText('Requested facts are ready.')
  await expect(page.locator('.impact-panel').getByRole('list')).toHaveCount(0)
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
  await expect(page.getByRole('button', { name: 'Summarize again' })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/news-hosted-detail-mobile.png', fullPage: true })
  const apiBase = `http://127.0.0.1:${process.env.NEWS_E2E_BACKEND_PORT ?? '8000'}`
  const forbidden = await page.request.post(`${apiBase}/api/articles/4/summarize?regenerate=true`)
  expect(forbidden.status()).toBe(403)
  const reused = await page.request.post(`${apiBase}/api/articles/4/summarize`)
  expect(await reused.json()).toEqual({ summary_status: 'done' })
  await page.reload()
  await expect(page.getByText('Requested facts are ready.')).toBeVisible()
})
