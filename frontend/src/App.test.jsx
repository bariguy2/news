import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'


function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}


describe('news application flow', () => {
  let onboarded
  let feedRows
  let failFeed

  beforeEach(() => {
    onboarded = false
    failFeed = false
    feedRows = [{ id: 7, title: 'A useful technology headline', source: 'Tech Source', category: 'Tech',
      published_at: '2026-07-06T10:00:00Z', url: 'https://example.com/tech', summary_status: 'done' }]
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const request = new URL(url)
      const method = options.method ?? 'GET'

      if (request.pathname === '/api/preferences' && method === 'GET') {
        return response({
          onboarded,
          selected_categories: onboarded ? ['Tech'] : [],
        })
      }
      if (request.pathname === '/api/categories') {
        return response(['Business', 'Science', 'Sports', 'Tech', 'World'])
      }
      if (request.pathname === '/api/preferences' && method === 'POST') {
        onboarded = true
        return response({ onboarded: true, selected_categories: ['Tech'] })
      }
      if (request.pathname === '/api/articles' && request.searchParams.get('category') === 'Tech') {
        return failFeed ? response({}, 500) : response(feedRows)
      }
      if (request.pathname === '/api/articles/7') {
        return response({
          id: 7,
          title: 'A useful technology headline',
          source: 'Tech Source',
          category: 'Tech',
          published_at: '2026-07-06T10:00:00Z',
          url: 'https://example.com/tech',
          summary_facts: 'Verified facts from the article.',
          summary_impact: 'A grounded explanation of why the event matters.',
        })
      }
      if (request.pathname === '/api/articles/7/read' && method === 'POST') {
        return response({ read_at: '2026-10-09T12:00:00Z' })
      }
      return response({ detail: 'Not found' }, 404)
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('persists onboarding, loads a filtered feed, and opens article detail', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'What should make your front page?' })).toBeVisible()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tech' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Make it more your own.' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))

    expect(await screen.findByRole('heading', { name: 'Your briefing' })).toBeVisible()
    const storyLink = await screen.findByRole('link', { name: /A useful technology headline/ })
    expect(storyLink).toHaveAttribute('href', '/article/7')

    const postCall = fetch.mock.calls.find(([, options = {}]) => options.method === 'POST')
    expect(JSON.parse(postCall[1].body)).toEqual({ selected_categories: ['Tech'], focused_interests: {},
      summary_style: { tone: 'neutral', length: 'standard', format: 'paragraphs' } })
    expect(fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('category') === 'Tech')).toBe(true)

    fireEvent.click(storyLink)
    expect(await screen.findByRole('heading', { name: 'A useful technology headline' })).toBeVisible()
    await waitFor(() => expect(screen.getByText('Verified facts from the article.')).toBeVisible())
    expect(screen.getByRole('heading', { name: 'Why it matters' })).toBeVisible()
    expect(screen.getByText('A grounded explanation of why the event matters.')).toBeVisible()

    const sourceLink = screen.getByRole('link', { name: /Read full article at Tech Source/ })
    expect(sourceLink).toHaveAttribute('href', 'https://example.com/tech')
    expect(sourceLink).toHaveAttribute('target', '_blank')
    expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  function mockScrolling() {
    const layout = { articleTop: 720 }
    vi.stubGlobal('scrollY', 600)
    vi.spyOn(window, 'scrollTo').mockImplementation(({ top }) => { vi.stubGlobal('scrollY', top) })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return new DOMRect(0, this.dataset.articleId === '7' ? layout.articleTop - window.scrollY : 0, 300, 180)
    })
    return layout
  }

  it('restores the search and opened article offset using fresh reordered data', async () => {
    onboarded = true
    const layout = mockScrolling()
    render(<MemoryRouter initialEntries={['/feed']}><App /></MemoryRouter>)
    const input = await screen.findByRole('searchbox')
    fireEvent.change(input, { target: { value: 'technology' } })
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('q') === 'technology')).toBe(true))
    const story = await screen.findByRole('link', { name: /Open summary/ })
    vi.stubGlobal('scrollY', 600)
    fireEvent.click(story)
    await screen.findByRole('heading', { name: 'A useful technology headline' })
    expect(window.scrollY).toBe(0)

    layout.articleTop = 500
    fireEvent.click(screen.getByRole('link', { name: /Your briefing/ }))
    await screen.findByRole('link', { name: /Open summary/ })
    expect(screen.getByRole('searchbox')).toHaveValue('technology')
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 380, left: 0, behavior: 'instant' })
    expect(new URL(fetch.mock.calls.filter(([url]) => new URL(url).pathname === '/api/articles').at(-1)[0])
      .searchParams.get('q')).toBe('technology')
    expect(document.activeElement).toHaveAttribute('data-article-id', '7')

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(new URL(fetch.mock.calls.filter(([url]) => new URL(url).pathname === '/api/articles')
      .at(-1)[0]).searchParams.has('q')).toBe(false))
    fireEvent.click(await screen.findByRole('link', { name: /Open summary/ }))
    await screen.findByRole('heading', { name: 'A useful technology headline' })
    fireEvent.click(screen.getByRole('link', { name: /Your briefing/ }))
    await screen.findByRole('link', { name: /Open summary/ })
    expect(screen.getByRole('searchbox')).toHaveValue('')
  })

  it('keeps the saved position across a failed return load and falls back when the article is gone', async () => {
    onboarded = true
    mockScrolling()
    render(<MemoryRouter initialEntries={['/feed']}><App /></MemoryRouter>)
    const story = await screen.findByRole('link', { name: /Open summary/ })
    vi.stubGlobal('scrollY', 600)
    fireEvent.click(story)
    await screen.findByRole('heading', { name: 'A useful technology headline' })
    failFeed = true
    fireEvent.click(screen.getByRole('link', { name: /Your briefing/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
    expect(window.scrollY).toBe(0)
    failFeed = false
    feedRows = []
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'No stories yet' })
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 600, left: 0, behavior: 'instant' })
  })
})
