import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getArticles, getPreferences } from '../api.js'
import Feed, { EMPTY_FEED_POLL_MS, POPULATED_FEED_POLL_MS } from './Feed.jsx'


vi.mock('../api.js', () => ({
  getArticles: vi.fn(),
  getPreferences: vi.fn(),
}))


describe('feed polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getPreferences.mockResolvedValue({
      onboarded: true,
      selected_categories: ['Tech'],
    })
    getArticles
      .mockResolvedValueOnce([])
      .mockResolvedValue([{
        id: 9,
        title: 'A newly summarized story',
        source: 'Tech Source',
        category: 'Tech',
        published_at: '2026-08-27T12:00:00Z',
        url: 'https://example.com/new-story',
        summary_status: 'done',
      }])
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('polls an empty feed quickly, then relaxes after a story appears', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <Feed />
      </MemoryRouter>,
    )

    await act(async () => {})
    expect(screen.getByRole('heading', { name: 'No stories yet' })).toBeVisible()
    expect(screen.queryByText('Loading headlines…')).not.toBeInTheDocument()
    expect(getArticles).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EMPTY_FEED_POLL_MS)
    })

    expect(screen.getByText('A newly summarized story')).toBeVisible()
    expect(screen.queryByText('Loading headlines…')).not.toBeInTheDocument()
    expect(getArticles).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POPULATED_FEED_POLL_MS - 1)
    })
    expect(getArticles).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getArticles).toHaveBeenCalledTimes(3)

    unmount()
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(getArticles).toHaveBeenCalledTimes(3)
  })

  it('shows a pending headline, then opens its summary once a poll reports done', async () => {
    const pending = {
      id: 10,
      title: 'An article being summarized',
      source: 'Tech Source',
      category: 'Tech',
      published_at: '2026-08-27T12:00:00Z',
      url: 'https://example.com/pending',
      summary_status: 'pending',
    }
    getArticles.mockReset()
    getArticles.mockResolvedValueOnce([pending]).mockResolvedValue([{ ...pending, summary_status: 'done' }])

    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})

    expect(screen.getByRole('heading', { name: pending.title })).toBeVisible()
    expect(screen.getByText('Summary in progress')).toBeVisible()
    expect(screen.queryByRole('link', { name: `Open summary: ${pending.title}` })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Read original at Tech Source/ })).toHaveAttribute('href', pending.url)

    await act(async () => { await vi.advanceTimersByTimeAsync(EMPTY_FEED_POLL_MS) })
    expect(screen.queryByText('Summary in progress')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: `Open summary: ${pending.title}` })).toHaveAttribute('href', '/article/10')
  })
})
