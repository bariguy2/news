import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getArticles, getPreferences, requestSummary } from '../api.js'
import { formatRelativeTime } from '../time.js'


export const EMPTY_FEED_POLL_MS = 5_000
export const POPULATED_FEED_POLL_MS = 15_000


function StoryCardContent({ article }) {
  return (
    <>
      <div className="story-meta">
        <span className="category-badge">{article.category}</span>
        <span>{article.source}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={article.published_at ?? undefined}>{formatRelativeTime(article.published_at)}</time>
      </div>
      <h2>{article.title}</h2>
    </>
  )
}


function Feed() {
  const [articles, setArticles] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [requesting, setRequesting] = useState({})
  const [requestErrors, setRequestErrors] = useState({})
  const refreshArticles = useRef(() => {})

  async function summarizeArticle(article) {
    if (requesting[article.id]) return
    setRequesting((previous) => ({ ...previous, [article.id]: true }))
    setRequestErrors((previous) => ({ ...previous, [article.id]: '' }))
    try {
      const result = await requestSummary(article.id)
      setArticles((previous) => previous.map((item) => item.id === article.id
        ? { ...item, summary_status: result.summary_status } : item))
      refreshArticles.current()
    } catch {
      setRequestErrors((previous) => ({ ...previous, [article.id]: 'Could not request a summary. Please try again.' }))
    } finally {
      setRequesting((previous) => ({ ...previous, [article.id]: false }))
    }
  }

  useEffect(() => {
    let active = true
    let pollTimer = null
    let hasPendingArticles = true
    let loadInProgress = false
    let refreshQueued = false
    setLoading(true)
    setError('')

    function schedulePoll(selectedCategories) {
      const delay = hasPendingArticles ? EMPTY_FEED_POLL_MS : POPULATED_FEED_POLL_MS
      pollTimer = window.setTimeout(
        () => loadArticles(selectedCategories, false),
        delay,
      )
    }

    async function loadArticles(selectedCategories, initialLoad) {
      if (loadInProgress) {
        refreshQueued = true
        return
      }
      loadInProgress = true
      try {
        const result = await getArticles(selectedCategories)
        if (!active) return
        hasPendingArticles = result.length === 0 || result.some((article) => article.summary_status === 'pending')
        setArticles(result)
        setError('')
      } catch {
        if (active && initialLoad) {
          setError('Your briefing could not be loaded.')
        }
      } finally {
        loadInProgress = false
        if (active) {
          if (initialLoad) setLoading(false)
          if (refreshQueued) {
            refreshQueued = false
            loadArticles(selectedCategories, false)
          } else {
            schedulePoll(selectedCategories)
          }
        }
      }
    }

    async function loadFeed() {
      try {
        const preferences = await getPreferences()
        if (!active) return
        setCategories(preferences.selected_categories)
        refreshArticles.current = () => {
          if (pollTimer !== null) window.clearTimeout(pollTimer)
          loadArticles(preferences.selected_categories, false)
        }
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
      refreshArticles.current = () => {}
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [reloadKey])

  return (
    <main className="feed-page">
      <header className="feed-header">
        <div>
          <p className="eyebrow">Local news</p>
          <h1>Your briefing</h1>
          <p className="lede">The four newest stories from each fetch get AI summaries. Choose which other stories to summarize.</p>
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
          <h2>No stories yet</h2>
          <p>The local pipeline may still be fetching headlines. Check back after the first refresh finishes.</p>
        </section>
      )}

      {!loading && !error && articles.length > 0 && (
        <section className="story-list" aria-label="Headlines">
          {articles.map((article) => article.summary_status !== 'done' ? (
            <article className="story-card story-card-pending" key={article.id}>
              <StoryCardContent article={article} />
              <p className="summary-pending" aria-live="polite">
                {article.summary_status === 'pending' ? 'Summary in progress'
                  : article.summary_status === 'failed' ? 'Summary could not be completed'
                    : 'Would you like an AI summary?'}
              </p>
              {article.summary_status !== 'pending' && (
                <button
                  type="button"
                  className="secondary-button summary-button"
                  disabled={Boolean(requesting[article.id])}
                  aria-label={`${article.summary_status === 'failed' ? 'Retry summary' : 'Summarize'}: ${article.title}`}
                  onClick={() => summarizeArticle(article)}
                >
                  {requesting[article.id] ? 'Requesting…' : article.summary_status === 'failed' ? 'Retry summary' : 'Summarize'}
                </button>
              )}
              {requestErrors[article.id] && <p role="alert">{requestErrors[article.id]}</p>}
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                Read original at {article.source} <span aria-hidden="true">↗</span>
              </a>
            </article>
          ) : (
            <Link
              aria-label={`Open summary: ${article.title}`}
              className="story-card"
              to={`/article/${article.id}`}
              key={article.id}
            >
              <article>
                <StoryCardContent article={article} />
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
