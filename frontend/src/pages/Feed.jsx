import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getArticles, getPreferences, requestSummary, markArticleRead } from '../api.js'
import { formatRelativeTime } from '../time.js'
import ArticleProgress from '../components/ArticleProgress.jsx'


export const EMPTY_FEED_POLL_MS = 5_000
export const POPULATED_FEED_POLL_MS = 15_000


function StoryCardContent({ article }) {
  return (
    <>
      <div className="story-meta">
        <span className="category-badge">{article.category}</span>
        {article.read_at && <span className="read-badge">Read</span>}
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
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [requesting, setRequesting] = useState({})
  const [requestErrors, setRequestErrors] = useState({})
  const [readErrors, setReadErrors] = useState({})
  const savedReads = useRef({})
  const refreshArticles = useRef(() => {})
  const summaryUpdates = useRef({ revision: 0, articles: {} })

  const handleSummaryStatus = useCallback((articleId, status) => {
    if (status !== 'done' && status !== 'failed') return
    const updates = summaryUpdates.current
    updates.articles[articleId] = { status, revision: ++updates.revision }
    setArticles((previous) => previous.map((item) => item.id === articleId && item.summary_status === 'pending'
      ? { ...item, summary_status: status } : item))
    refreshArticles.current()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  async function recordRead(article) {
    if (article.read_at) return
    try {
      const result = await markArticleRead(article.id)
      savedReads.current[article.id] = result.read_at
      setArticles((previous) => previous.map((item) => item.id === article.id
        ? { ...item, read_at: result.read_at } : item))
      setReadErrors((previous) => ({ ...previous, [article.id]: '' }))
    } catch {
      setReadErrors((previous) => ({ ...previous, [article.id]: 'Could not save read status.' }))
    }
  }

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
      const requestRevision = summaryUpdates.current.revision
      try {
        const result = await getArticles(selectedCategories, query)
        if (!active) return
        const resolved = result.map((item) => {
          const update = summaryUpdates.current.articles[item.id]
          return { ...item,
            ...(savedReads.current[item.id] ? { read_at: savedReads.current[item.id] } : {}),
            ...(item.summary_status === 'pending' && update?.revision > requestRevision
              ? { summary_status: update.status } : {}),
          }
        })
        hasPendingArticles = resolved.length === 0 || resolved.some((article) => article.summary_status === 'pending')
        setArticles(resolved)
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
  }, [reloadKey, query])

  // Apply the same order immediately when progress reports completion,
  // including while the next API list response is still in flight.
  const orderedArticles = [...articles].sort((left, right) =>
    Number(right.summary_status === 'done') - Number(left.summary_status === 'done')
      || (right.published_at ?? '').localeCompare(left.published_at ?? '')
      || right.id - left.id)

  return (
    <main className="feed-page">
      <header className="feed-header">
        <button type="button" className="profile-button" aria-label="Profile" title="Profile settings coming soon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20a7 7 0 0 1 14 0" />
          </svg>
        </button>
        <div>
          <p className="eyebrow">Local news</p>
          <h1>Your briefing</h1>
          <p className="lede">Choose a story to summarize. Ready summaries are saved for everyone to read.</p>
        </div>
        {categories.length > 0 && (
          <div className="active-categories" aria-label="Selected categories">
            {categories.map((category) => <span key={category}>{category}</span>)}
          </div>
        )}
      </header>


      <div className="feed-search" role="search" aria-label="Article search">
        <label htmlFor="article-search">Search articles</label>
        <div className="search-controls">
          <input id="article-search" type="search" maxLength={200}
            placeholder="Search by keyword…" value={search}
            aria-describedby="search-help"
            onChange={(event) => setSearch(event.target.value)} />
          {search && <button type="button" className="secondary-button"
            onClick={() => { setSearch(''); setQuery('') }}>Clear search</button>}
        </div>
        <p id="search-help">Search fetched stories in your selected categories, including available AI summaries.</p>
      </div>

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
          <h2>{query ? 'No matching stories' : 'No stories yet'}</h2>
          <p>{query ? 'Try another keyword or clear your search.'
            : 'The local pipeline may still be fetching headlines. Check back after the first refresh finishes.'}</p>
        </section>
      )}

      {!loading && !error && articles.length > 0 && (
        <section className="story-list" aria-label="Headlines">
          {orderedArticles.map((article) => article.summary_status !== 'done' ? (
            <article className={`story-card story-card-pending${article.read_at ? ' story-card-read' : ''}`} key={article.id}>
              <StoryCardContent article={article} />
              <p className="summary-pending" aria-live="polite">
                {article.summary_status === 'pending' ? 'Summary in progress'
                  : article.summary_status === 'failed' ? 'Summary could not be completed'
                    : 'Would you like an AI summary?'}
              </p>
              <ArticleProgress article={article} onStatusChange={handleSummaryStatus} />
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
              <a href={article.url} target="_blank" rel="noopener noreferrer"
                onClick={() => recordRead(article)}
                onAuxClick={(event) => { if (event.button === 1) recordRead(article) }}>
                Read original at {article.source} <span aria-hidden="true">↗</span>
              </a>
              {readErrors[article.id] && <div role="alert"><p>{readErrors[article.id]}</p>
                <button type="button" className="secondary-button" onClick={() => recordRead(article)}>Retry saving read status</button>
              </div>}
            </article>
          ) : (
            <Link
              aria-label={`Open summary: ${article.title}`}
              className={`story-card${article.read_at ? ' story-card-read' : ''}`}
              to={`/article/${article.id}`}
              key={article.id}
            >
              <article>
                <StoryCardContent article={article} />
                <ArticleProgress article={article} onStatusChange={handleSummaryStatus} />
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
