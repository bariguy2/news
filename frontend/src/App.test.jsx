import { fireEvent, render, screen } from '@testing-library/react'
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

  beforeEach(() => {
    onboarded = false
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
        return response([{
          id: 7,
          title: 'A useful technology headline',
          source: 'Tech Source',
          category: 'Tech',
          published_at: '2026-07-06T10:00:00Z',
          url: 'https://example.com/tech',
        }])
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
      return response({ detail: 'Not found' }, 404)
    }))
  })

  afterEach(() => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Build my briefing' }))

    expect(await screen.findByRole('heading', { name: 'Your briefing' })).toBeVisible()
    const storyLink = await screen.findByRole('link', { name: /A useful technology headline/ })
    expect(storyLink).toHaveAttribute('href', '/article/7')

    const postCall = fetch.mock.calls.find(([, options = {}]) => options.method === 'POST')
    expect(JSON.parse(postCall[1].body)).toEqual({ selected_categories: ['Tech'] })
    expect(fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('category') === 'Tech')).toBe(true)

    fireEvent.click(storyLink)
    expect(await screen.findByRole('heading', { name: 'A useful technology headline' })).toBeVisible()
    expect(screen.getByText('Verified facts from the article.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Why it matters' })).toBeVisible()
    expect(screen.getByText('A grounded explanation of why the event matters.')).toBeVisible()

    const sourceLink = screen.getByRole('link', { name: /Read full article at Tech Source/ })
    expect(sourceLink).toHaveAttribute('href', 'https://example.com/tech')
    expect(sourceLink).toHaveAttribute('target', '_blank')
    expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
