const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'


export async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options)

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`)
  }

  return response.json()
}


export function getPreferences() {
  return apiFetch('/api/preferences')
}


export function updatePreferences(selectedCategories) {
  return apiFetch('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected_categories: selectedCategories }),
  })
}


export function getCategories() {
  return apiFetch('/api/categories')
}


export function getArticles(categories = [], search = '') {
  const query = new URLSearchParams({ limit: '50' })
  if (categories.length > 0) {
    query.set('category', categories.join(','))
  }
  if (search.trim()) query.set('q', search.trim())
  return apiFetch(`/api/articles?${query}`)
}


export function getArticle(articleId) {
  return apiFetch(`/api/articles/${articleId}`)
}


export function requestSummary(articleId) {
  return apiFetch(`/api/articles/${articleId}/summarize`, { method: 'POST' })
}


export function markArticleRead(articleId) {
  return apiFetch(`/api/articles/${articleId}/read`, { method: 'POST', keepalive: true })
}
