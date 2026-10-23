import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getArticles, getPreferences, requestSummary, markArticleRead, getArticleProgress } from '../api.js'
import Feed, { EMPTY_FEED_POLL_MS, POPULATED_FEED_POLL_MS } from './Feed.jsx'


vi.mock('../api.js', () => ({
  getArticles: vi.fn(),
  getPreferences: vi.fn(),
  requestSummary: vi.fn(),
  markArticleRead: vi.fn(),
  getArticleProgress: vi.fn(async () => ({ stage: 'queued', percentage: 0, elapsed_seconds: 0, estimated: true })),
}))


describe('feed polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getArticleProgress.mockReset().mockResolvedValue({ stage: 'queued', percentage: 0, elapsed_seconds: 0, estimated: true })
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

  it('marks original-source opens as read and preserves the badge during polling', async () => {
    const article = { id: 30, title: 'Original-only story', source: 'Tech Source', category: 'Tech',
      published_at: null, url: 'https://example.com/original', summary_status: 'unrequested', read_at: null }
    getArticles.mockReset().mockResolvedValue([article])
    markArticleRead.mockResolvedValue({ read_at: '2026-10-09T12:00:00Z' })
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    expect(screen.queryByText('Read', { exact: true })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Read original/ })) })
    expect(markArticleRead).toHaveBeenCalledWith(30)
    expect(screen.getByText('Read', { exact: true })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Summarize: Original-only story' })).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(POPULATED_FEED_POLL_MS) })
    expect(screen.getByText('Read', { exact: true })).toBeVisible()
  })

  it('does not claim an article is read when saving fails and offers retry', async () => {
    getArticles.mockReset().mockResolvedValue([{ id: 31, title: 'Offline story', source: 'Tech Source', category: 'Tech',
      published_at: null, url: 'https://example.com/offline', summary_status: 'pending' }])
    markArticleRead.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ read_at: '2026-10-09T12:00:00Z' })
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Read original/ })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save read status')
    expect(screen.queryByText('Read', { exact: true })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry saving read status' })) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Read', { exact: true })).toBeVisible()
  })

  it('opens a completed summary immediately before the five-second feed refresh', async () => {
    const pending = { id: 40, title: 'Immediate summary', source: 'Source', category: 'Tech',
      published_at: '2026-10-22T12:00:00Z', url: 'https://example.com/immediate', summary_status: 'pending' }
    const olderDone = { ...pending, id: 39, title: 'Older ready summary', summary_status: 'done', published_at: '2026-10-21T12:00:00Z' }
    const newerUntouched = { ...pending, id: 42, title: 'New headline', summary_status: 'unrequested', published_at: '2026-10-22T13:00:00Z' }
    let finishRefresh
    getArticles.mockReset().mockResolvedValueOnce([olderDone, newerUntouched, pending])
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve }))
    getArticleProgress.mockResolvedValueOnce({ stage: 'summarizing', percentage: 80 })
      .mockResolvedValue({ stage: 'done', percentage: 100 })
    render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Older ready summary', 'New headline', 'Immediate summary'])
    expect(screen.queryByRole('link', { name: 'Open summary: Immediate summary' })).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByRole('link', { name: 'Open summary: Immediate summary' })).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Immediate summary', 'Older ready summary', 'New headline'])
    expect(getArticles).toHaveBeenCalledTimes(2)
    await act(async () => { finishRefresh([{ ...pending, summary_status: 'done' }, olderDone, newerUntouched]) })
  })

  it('keeps completion visible when an older in-flight feed poll returns pending', async () => {
    const pending = { id: 41, title: 'Keep completed status', source: 'Source', category: 'Tech',
      published_at: null, url: 'https://example.com/stale-poll', summary_status: 'pending' }
    let finishPoll
    let finishProgress
    getArticles.mockReset().mockResolvedValueOnce([pending])
      .mockImplementationOnce(() => new Promise((resolve) => { finishPoll = resolve }))
      .mockResolvedValue([{ ...pending, summary_status: 'done' }])
    getArticleProgress.mockImplementationOnce(() => new Promise((resolve) => { finishProgress = resolve }))
    const { unmount } = render(<MemoryRouter><Feed /></MemoryRouter>)
    await act(async () => {})
    await act(async () => { await vi.advanceTimersByTimeAsync(EMPTY_FEED_POLL_MS) })
    await act(async () => { finishProgress({ stage: 'done', percentage: 100 }) })
    expect(screen.getByRole('link', { name: 'Open summary: Keep completed status' })).toBeVisible()
    await act(async () => { finishPoll([pending]) })
    expect(screen.getByRole('link', { name: 'Open summary: Keep completed status' })).toBeVisible()
    expect(getArticles).toHaveBeenCalledTimes(3)
    unmount()
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(getArticles).toHaveBeenCalledTimes(3)
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
