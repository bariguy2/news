import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getArticles, getPreferences, requestSummary } from '../api.js'
import Feed, { EMPTY_FEED_POLL_MS, POPULATED_FEED_POLL_MS } from './Feed.jsx'


vi.mock('../api.js', () => ({
  getArticles: vi.fn(),
  getPreferences: vi.fn(),
  requestSummary: vi.fn(),
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

  it('leaves an untouched headline waiting until its summary is requested', async () => {
    const article = { id: 11, title: 'Choose this story', source: 'Tech Source', category: 'Tech',
      published_at: null, url: 'https://example.com/choose', summary_status: 'unrequested' }
    getArticles.mockReset().mockResolvedValue([article])
    let acceptRequest
    requestSummary.mockImplementation(() => new Promise((resolve) => { acceptRequest = resolve }))
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    expect(requestSummary).not.toHaveBeenCalled()
    expect(screen.getByText('Would you like an AI summary?')).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(EMPTY_FEED_POLL_MS) })
    expect(getArticles).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Summarize: Choose this story' }))
    expect(screen.getByRole('button', { name: 'Summarize: Choose this story' })).toBeDisabled()
    expect(requestSummary).toHaveBeenCalledExactlyOnceWith(11)
    getArticles.mockResolvedValue([{ ...article, summary_status: 'pending' }])
    await act(async () => { acceptRequest({ summary_status: 'pending' }) })
    expect(screen.getByText('Summary in progress')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Summarize: Choose this story' })).not.toBeInTheDocument()
    getArticles.mockResolvedValue([{ ...article, summary_status: 'done' }])
    await act(async () => { await vi.advanceTimersByTimeAsync(EMPTY_FEED_POLL_MS) })
    expect(screen.getByRole('link', { name: 'Open summary: Choose this story' })).toHaveAttribute('href', '/article/11')
  })

  it('keeps the choice available when the summary request fails', async () => {
    getArticles.mockReset().mockResolvedValue([{ id: 12, title: 'Retry this story', source: 'Tech Source',
      category: 'Tech', published_at: null, url: 'https://example.com/retry', summary_status: 'failed' }])
    requestSummary.mockRejectedValue(new Error('Offline'))
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry summary: Retry this story' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not request a summary')
    expect(screen.getByRole('button', { name: 'Retry summary: Retry this story' })).toBeEnabled()
  })

  it('debounces search, polls the current query, and clears no-match results', async () => {
    getArticles.mockReset().mockResolvedValue([{ id: 20, title: 'Searchable story', source: 'Tech Source',
      category: 'Tech', published_at: null, url: 'https://example.com/search', summary_status: 'done' }])
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    const input = screen.getByRole('searchbox', { name: 'Search articles' })
    fireEvent.change(input, { target: { value: 'no' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    fireEvent.change(input, { target: { value: '  nonexistent  ' } })
    getArticles.mockResolvedValue([])
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(getArticles).toHaveBeenCalledTimes(2)
    expect(getArticles).toHaveBeenLastCalledWith(['Tech'], 'nonexistent')
    expect(screen.getByRole('heading', { name: 'No matching stories' })).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(EMPTY_FEED_POLL_MS) })
    expect(getArticles).toHaveBeenLastCalledWith(['Tech'], 'nonexistent')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear search' })) })
    expect(input).toHaveValue('')
    expect(getArticles).toHaveBeenLastCalledWith(['Tech'], '')
    expect(screen.getByRole('heading', { name: 'No stories yet' })).toBeVisible()
  })

  it('ignores an older search response after the query changes', async () => {
    let finishOld
    getArticles.mockReset().mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValue([])
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    const input = screen.getByRole('searchbox', { name: 'Search articles' })
    fireEvent.change(input, { target: { value: 'old' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.change(input, { target: { value: 'new' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    await act(async () => { finishOld([{ id: 99, title: 'Stale result', summary_status: 'done' }]) })
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No matching stories' })).toBeVisible()
    expect(getArticles).toHaveBeenLastCalledWith(['Tech'], 'new')
  })

  it('serializes a requested refresh with an already running poll', async () => {
    const article = { id: 13, title: 'Concurrent request', source: 'Tech Source', category: 'Tech',
      published_at: null, url: 'https://example.com/concurrent', summary_status: 'unrequested' }
    let finishPoll
    getArticles.mockReset().mockResolvedValueOnce([article])
      .mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve }))
      .mockResolvedValue([{ ...article, summary_status: 'done' }])
    requestSummary.mockResolvedValue({ summary_status: 'pending' })
    const { unmount } = render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(POPULATED_FEED_POLL_MS) })
    expect(getArticles).toHaveBeenCalledTimes(2)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Summarize: Concurrent request' })) })
    expect(getArticles).toHaveBeenCalledTimes(2)
    await act(async () => { finishPoll([{ ...article, summary_status: 'pending' }]) })
    expect(getArticles).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('link', { name: 'Open summary: Concurrent request' })).toBeVisible()
    unmount()
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(getArticles).toHaveBeenCalledTimes(3)
  })
})
