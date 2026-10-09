import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getArticle, markArticleRead } from '../api.js'
import Detail from './Detail.jsx'

vi.mock('../api.js', () => ({ getArticle: vi.fn(), markArticleRead: vi.fn() }))

const article = { id: 1, title: 'A readable story', source: 'Source', category: 'Tech',
  url: 'https://example.com/story', published_at: null, summary_facts: 'Facts remain visible.',
  summary_impact: 'Impact remains visible.', read_at: null }

function renderDetail() {
  return render(<MemoryRouter initialEntries={['/article/1']}><Routes>
    <Route path="/article/:id" element={<Detail />} />
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
})
