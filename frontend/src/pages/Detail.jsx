import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getArticle, markArticleRead, requestSummary } from '../api.js'
import { formatRelativeTime } from '../time.js'


function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [savingRead, setSavingRead] = useState(false)
  const currentId = useRef(id)
  currentId.current = id
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateError, setRegenerateError] = useState('')
  const regenerationRequest = useRef(null)
  const mounted = useRef(false)

  async function summarizeAgain() {
    if (regenerationRequest.current === id) return
    regenerationRequest.current = id
    setRegenerating(true)
    setRegenerateError('')
    try {
      await requestSummary(id, true)
      if (mounted.current && currentId.current === id) navigate('/feed')
    } catch {
      if (mounted.current && currentId.current === id) setRegenerateError('Could not request a new summary. Please try again.')
    } finally {
      if (regenerationRequest.current === id) regenerationRequest.current = null
      if (mounted.current && currentId.current === id) setRegenerating(false)
    }
  }

  async function retryRead() {
    setSavingRead(true)
    try {
      const result = await markArticleRead(id)
      if (currentId.current !== id) return
      setArticle((previous) => ({ ...previous, read_at: result.read_at }))
      setReadError('')
    } catch {
      if (currentId.current === id) setReadError('Could not save read status.')
    } finally {
      if (currentId.current === id) setSavingRead(false)
    }
  }

  useEffect(() => {
    let active = true
    mounted.current = true
    setLoading(true)
    setError('')
    setReadError('')
    setSavingRead(false)
    setRegenerating(false)
    setRegenerateError('')

    getArticle(id)
      .then((result) => {
        if (!active) return
        setArticle(result)
        if (!result.read_at) {
          markArticleRead(id).then((status) => {
            if (active) setArticle((previous) => ({ ...previous, read_at: status.read_at }))
          }).catch(() => {
            if (active) setReadError('Could not save read status.')
          })
        }
      })
      .catch(() => {
        if (active) setError('This summary is not available.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      mounted.current = false
    }
  }, [id])

  if (loading) {
    return (
      <main className="status-page" aria-busy="true">
        <p className="eyebrow">Article summary</p>
        <h1>Loading story…</h1>
      </main>
    )
  }

  if (error || !article) {
    return (
      <main className="status-page">
        <p className="eyebrow">Article summary</p>
        <h1>Summary unavailable</h1>
        <p>{error}</p>
        <Link className="secondary-button inline-button" to="/feed">Back to your briefing</Link>
      </main>
    )
  }

  return (
    <main className="detail-page">
      <Link className="back-link" to="/feed"><span aria-hidden="true">←</span> Your briefing</Link>

      <article className="summary-article">
        <header className="detail-header">
          <div className="story-meta">
            <span className="category-badge">{article.category}</span>
            {article.read_at && <span className="read-badge">Read</span>}
            <span>{article.source}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={article.published_at ?? undefined}>{formatRelativeTime(article.published_at)}</time>
          </div>
          <h1>{article.title}</h1>
          {readError && <div role="alert"><p>{readError}</p>
            <button type="button" className="secondary-button" disabled={savingRead} onClick={retryRead}>Retry saving read status</button>
          </div>}
        </header>

        <section className="facts-section" aria-labelledby="facts-title">
          <p className="section-label">Facts</p>
          <h2 id="facts-title">What happened</h2>
          <p>{article.summary_facts}</p>
        </section>

        <aside className="impact-panel" aria-labelledby="impact-title">
          <p className="section-label">Analysis</p>
          <h2 id="impact-title">Why it matters</h2>
          <p>{article.summary_impact}</p>
        </aside>

        <div className="resummary-actions">
          <button type="button" className="secondary-button" disabled={regenerating} onClick={summarizeAgain}>
            {regenerating ? 'Queuing new summary…' : 'Summarize again'}
          </button>
          <p>Generate a new FACTS and IMPACT summary. Follow its progress in your feed.</p>
          {regenerateError && <p role="alert">{regenerateError}</p>}
        </div>

        <a className="source-link" href={article.url} target="_blank" rel="noopener noreferrer">
          Read full article at {article.source} <span aria-hidden="true">↗</span>
        </a>
      </article>
    </main>
  )
}


export default Detail
