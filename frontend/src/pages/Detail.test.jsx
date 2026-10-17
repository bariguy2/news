import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getArticle, markArticleRead, requestSummary } from '../api.js'
import Detail from './Detail.jsx'

vi.mock('../api.js', () => ({ getArticle: vi.fn(), markArticleRead: vi.fn(), requestSummary: vi.fn() }))

const article = { id: 1, title: 'A readable story', source: 'Source', category: 'Tech',
  url: 'https://example.com/story', published_at: null, summary_facts: 'Facts remain visible.',
  summary_impact: 'Impact remains visible.', read_at: null }

function renderDetail() {
  return render(<MemoryRouter initialEntries={['/article/1']}><Routes>
    <Route path="/article/:id" element={<Detail />} />
    <Route path="/feed" element={<h1>Your briefing</h1>} />
  </Routes></MemoryRouter>)
}

describe('reading article summaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getArticle.mockResolvedValue(article)
    markArticleRead.mockResolvedValue({ read_at: '2026-10-09T12:00:00Z' })
  })

  it('marks a directly opened summary after it successfully loads', async () => {
    renderDetail()
    expect(await screen.findByText('Read', { exact: true })).toBeVisible()
    expect(screen.getByText('Facts remain visible.')).toBeVisible()
    expect(markArticleRead).toHaveBeenCalledExactlyOnceWith('1')
  })

  it('keeps the summary usable and retries when read persistence fails', async () => {
    markArticleRead.mockRejectedValueOnce(new Error('Offline'))
    renderDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save read status')
    expect(screen.queryByText('Read', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('Facts remain visible.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving read status' }))
    expect(await screen.findByText('Read', { exact: true })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not write for unavailable or already read summaries', async () => {
    getArticle.mockRejectedValueOnce(new Error('404'))
    const view = renderDetail()
    await screen.findByRole('heading', { name: 'Summary unavailable' })
    expect(markArticleRead).not.toHaveBeenCalled()
    view.unmount()
    getArticle.mockResolvedValue({ ...article, read_at: '2026-10-09T12:00:00Z' })
    renderDetail()
    await waitFor(() => expect(screen.getByText('Read', { exact: true })).toBeVisible())
    expect(markArticleRead).not.toHaveBeenCalled()
  })

  it('queues a replacement once and returns to the feed for progress', async () => {
    let finishRequest
    requestSummary.mockImplementation(() => new Promise((resolve) => { finishRequest = resolve }))
    renderDetail()
    const button = await screen.findByRole('button', { name: 'Summarize again' })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(requestSummary).toHaveBeenCalledExactlyOnceWith('1', true)
    expect(screen.getByText('Facts remain visible.')).toBeVisible()
    await act(async () => { finishRequest({ summary_status: 'pending' }) })
    expect(await screen.findByRole('heading', { name: 'Your briefing' })).toBeVisible()
  })

  it('keeps the existing summary and allows retry if requesting fails', async () => {
    requestSummary.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ summary_status: 'pending' })
    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not request a new summary')
    expect(screen.getByText('Facts remain visible.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Summarize again' }))
    expect(await screen.findByRole('heading', { name: 'Your briefing' })).toBeVisible()
  })

  it('does not redirect when a queued request finishes after the user leaves', async () => {
    let finishRequest
    requestSummary.mockImplementation(() => new Promise((resolve) => { finishRequest = resolve }))
    render(<MemoryRouter initialEntries={['/article/1']}><Routes>
      <Route path="/article/:id" element={<><Detail /><Link to="/elsewhere">Leave article</Link></>} />
      <Route path="/elsewhere" element={<h1>Another page</h1>} />
      <Route path="/feed" element={<h1>Your briefing</h1>} />
    </Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Summarize again' }))
    fireEvent.click(screen.getByRole('link', { name: 'Leave article' }))
    await act(async () => { finishRequest({ summary_status: 'pending' }) })
    expect(screen.getByRole('heading', { name: 'Another page' })).toBeVisible()
  })
})
