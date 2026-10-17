import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getArticleProgress } from '../api.js'
import ArticleProgress from './ArticleProgress.jsx'

vi.mock('../api.js', () => ({ getArticleProgress: vi.fn() }))
const article = { id: 1, title: 'First story', summary_status: 'pending' }
const queued = { stage: 'queued', percentage: 0, elapsed_seconds: 0, estimated: true }
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks() })
afterEach(() => vi.useRealTimers())

it('shows per-article 0, intermediate percentages, elapsed time, and saved 100%', async () => {
  getArticleProgress.mockResolvedValueOnce(queued)
    .mockResolvedValueOnce({ ...queued, stage: 'summarizing', percentage: 32, elapsed_seconds: 4 })
    .mockResolvedValue({ ...queued, stage: 'saving', percentage: 99, elapsed_seconds: 8 })
  const view = render(<ArticleProgress article={article} />)
  await act(async () => {})
  expect(screen.getByRole('progressbar', { name: 'Summary progress for First story' })).toHaveAttribute('aria-valuenow', '0')
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(screen.getByText('Estimated 32%')).toBeVisible()
  expect(screen.getByText(/4s elapsed/)).toBeVisible()
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99')
  view.rerender(<ArticleProgress article={{ ...article, summary_status: 'done' }} />)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  expect(screen.getByText('Summary ready')).toBeVisible()
  view.unmount()
  await act(async () => { await vi.runOnlyPendingTimersAsync() })
  expect(getArticleProgress).toHaveBeenCalledTimes(3)
})

it('keeps article progress independent and hides untouched stories', async () => {
  getArticleProgress.mockImplementation(async (id) => ({ ...queued, percentage: id === 1 ? 27 : 68 }))
  render(<><ArticleProgress article={article} /><ArticleProgress article={{ ...article, id: 2, title: 'Second story' }} />
    <ArticleProgress article={{ ...article, id: 3, title: 'Untouched', summary_status: 'unrequested' }} /></>)
  await act(async () => {})
  expect(screen.getByRole('progressbar', { name: /First story/ })).toHaveAttribute('aria-valuenow', '27')
  expect(screen.getByRole('progressbar', { name: /Second story/ })).toHaveAttribute('aria-valuenow', '68')
  expect(screen.getAllByRole('progressbar')).toHaveLength(2)
})

it('does not present a failed attempt as complete and resets to queued on retry', async () => {
  getArticleProgress.mockResolvedValueOnce({ ...queued, stage: 'failed', percentage: 42 })
    .mockResolvedValue(queued)
  const view = render(<ArticleProgress article={{ ...article, summary_status: 'failed' }} />)
  await act(async () => {})
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  expect(screen.getByText('Summary failed')).toBeVisible()
  view.rerender(<ArticleProgress article={article} />)
  await act(async () => {})
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
})

it('recovers from progress errors and ignores responses after switching articles', async () => {
  getArticleProgress.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(queued)
  const view = render(<ArticleProgress article={article} />)
  await act(async () => {})
  expect(screen.getByRole('status')).toHaveTextContent('Progress unavailable')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry progress' })) })
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  let finishOld
  getArticleProgress.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    .mockResolvedValue(queued)
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
  view.rerender(<ArticleProgress article={{ ...article, id: 2, title: 'Second story' }} />)
  await act(async () => {})
  await act(async () => { finishOld({ ...queued, stage: 'done', percentage: 100 }) })
  expect(screen.getByRole('progressbar', { name: /Second story/ })).toHaveAttribute('aria-valuenow', '0')
})

it.each(['done', 'failed'])('notifies the parent once on %s and stops pending polling', async (stage) => {
  const onStatusChange = vi.fn()
  getArticleProgress.mockResolvedValue({ ...queued, stage, percentage: stage === 'done' ? 100 : 42 })
  render(<ArticleProgress article={article} onStatusChange={onStatusChange} />)
  await act(async () => {})
  expect(onStatusChange).toHaveBeenCalledExactlyOnceWith(1, stage)
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(getArticleProgress).toHaveBeenCalledTimes(1)
})
