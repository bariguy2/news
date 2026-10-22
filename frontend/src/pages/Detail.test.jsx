import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getArticle, markArticleRead } from '../api.js'
import Detail from './Detail.jsx'

vi.mock('../api.js', () => ({ getArticle: vi.fn(), markArticleRead: vi.fn() }))

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

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('marks a directly opened summary after it successfully loads', async () => {
    renderDetail()
    expect(await screen.findByText('Read', { exact: true })).toBeVisible()
    await waitFor(() => expect(screen.getByText('Facts remain visible.')).toBeVisible())
    expect(markArticleRead).toHaveBeenCalledExactlyOnceWith('1')
  })

  it('keeps the summary usable and retries when read persistence fails', async () => {
    markArticleRead.mockRejectedValueOnce(new Error('Offline'))
    renderDetail()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save read status')
    expect(screen.queryByText('Read', { exact: true })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Facts remain visible.')).toBeVisible())
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

  it('offers the original source without a public regeneration action', async () => {
    renderDetail()
    await screen.findByText('Facts remain visible.')
    expect(screen.queryByRole('button', { name: 'Summarize again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Read full article/ })).toHaveAttribute('href', article.url)
  })

  it('types an unread summary once, continues after saving read status, and skips typing on return', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false,
      addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const view = renderDetail()
    await act(async () => {})
    const visible = view.container.querySelectorAll('.typing-preview-visible')
    expect(visible).toHaveLength(2)
    expect(visible[0].textContent).toBe('')
    expect(visible[1].textContent).toBe('')
    expect(screen.getByText('Read', { exact: true })).toBeVisible()
    expect(screen.getByRole('link', { name: /Read full article/ })).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(120) })
    expect(visible[0].textContent.length).toBeGreaterThan(0)
    expect(visible[0].textContent.length).toBeLessThan(article.summary_facts.length)
    expect(visible[1].textContent.length).toBeGreaterThan(0)
    expect(visible[1].textContent.length).toBeLessThan(article.summary_impact.length)
    expect(visible[1]).toHaveAttribute('data-typing', 'true')
    await act(async () => { await vi.advanceTimersByTimeAsync(280) })
    expect(visible[0].textContent.length).toBeLessThan(article.summary_facts.length)
    expect(visible[1].textContent.length).toBeLessThan(article.summary_impact.length)
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(view.container.querySelector('.typing-preview-text')).toBeNull()
    expect(screen.getByText(article.summary_facts)).toBeVisible()
    expect(screen.getByText(article.summary_impact)).toBeVisible()
    expect(vi.getTimerCount()).toBe(0)
    view.unmount()

    getArticle.mockResolvedValue({ ...article, read_at: '2026-10-09T12:00:00Z' })
    const reopened = renderDetail()
    await act(async () => {})
    expect(reopened.container.querySelector('.typing-preview-text')).toBeNull()
    expect(screen.getByText(article.summary_facts)).toBeVisible()
    expect(screen.getByText(article.summary_impact)).toBeVisible()
    expect(markArticleRead).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows an unread summary immediately with reduced motion', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true,
      addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const view = renderDetail()
    await act(async () => {})
    expect(view.container.querySelector('.typing-preview-text')).toBeNull()
    expect(screen.getByText(article.summary_facts)).toBeVisible()
    expect(screen.getByText(article.summary_impact)).toBeVisible()
    expect(markArticleRead).toHaveBeenCalledExactlyOnceWith('1')
    expect(vi.getTimerCount()).toBe(0)
  })
})
