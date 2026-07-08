import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getArticle } from '../api.js'
import { formatRelativeTime } from '../time.js'


function Detail() {
  const { id } = useParams()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    getArticle(id)
      .then((result) => {
        if (active) setArticle(result)
      })
      .catch(() => {
        if (active) setError('This summary is not available.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
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
            <span>{article.source}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={article.published_at ?? undefined}>{formatRelativeTime(article.published_at)}</time>
          </div>
          <h1>{article.title}</h1>
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

        <a className="source-link" href={article.url} target="_blank" rel="noopener noreferrer">
          Read full article at {article.source} <span aria-hidden="true">↗</span>
        </a>
      </article>
    </main>
  )
}


export default Detail
