import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getArticles, getPreferences } from '../api.js'
import { formatRelativeTime } from '../time.js'


export const EMPTY_FEED_POLL_MS = 5_000
export const POPULATED_FEED_POLL_MS = 15_000


function Feed() {
  const [articles, setArticles] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    let pollTimer = null
    let hasArticles = false
    setLoading(true)
    setError('')

    function schedulePoll(selectedCategories) {
      const delay = hasArticles ? POPULATED_FEED_POLL_MS : EMPTY_FEED_POLL_MS
      pollTimer = window.setTimeout(
        () => loadArticles(selectedCategories, false),
        delay,
      )
    }

    async function loadArticles(selectedCategories, initialLoad) {
      try {
        const result = await getArticles(selectedCategories)
        if (!active) return
        hasArticles = result.length > 0
        setArticles(result)
        setError('')
      } catch {
        if (active && initialLoad) {
          setError('Your briefing could not be loaded.')
        }
      } finally {
        if (active) {
          if (initialLoad) setLoading(false)
          schedulePoll(selectedCategories)
        }
      }
    }

    async function loadFeed() {
      try {
        const preferences = await getPreferences()
        if (!active) return
        setCategories(preferences.selected_categories)
        await loadArticles(preferences.selected_categories, true)
      } catch {
        if (active) {
          setError('Your briefing could not be loaded.')
          setLoading(false)
        }
      }
    }

    loadFeed()

    return () => {
      active = false
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [reloadKey])

  return (
    <main className="feed-page">
      <header className="feed-header">
        <div>
          <p className="eyebrow">Local news</p>
          <h1>Your briefing</h1>
          <p className="lede">A focused list of stories, ready for a closer look.</p>
        </div>
        {categories.length > 0 && (
          <div className="active-categories" aria-label="Selected categories">
            {categories.map((category) => <span key={category}>{category}</span>)}
          </div>
        )}
      </header>

      {loading && <p className="status-message" aria-live="polite">Loading headlines…</p>}

      {!loading && error && (
        <div className="error-panel" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </button>
        </div>
      )}

      {!loading && !error && articles.length === 0 && (
        <section className="empty-state">
          <h2>No summarized stories yet</h2>
          <p>The local pipeline may still be working. Check back after the first refresh finishes.</p>
        </section>
      )}

      {!loading && !error && articles.length > 0 && (
        <section className="story-list" aria-label="Headlines">
          {articles.map((article) => (
            <Link
              aria-label={`Open summary: ${article.title}`}
              className="story-card"
              to={`/article/${article.id}`}
              key={article.id}
            >
              <article>
                <div className="story-meta">
                  <span className="category-badge">{article.category}</span>
                  <span>{article.source}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={article.published_at ?? undefined}>{formatRelativeTime(article.published_at)}</time>
                </div>
                <h2>{article.title}</h2>
                <span className="story-action">Open summary <span aria-hidden="true">→</span></span>
              </article>
            </Link>
          ))}
        </section>
      )}
    </main>
  )
}


export default Feed
