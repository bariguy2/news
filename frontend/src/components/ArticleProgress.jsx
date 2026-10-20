import { useEffect, useState } from 'react'
import { getArticleProgress } from '../api.js'

const labels = { queued: 'Waiting to start', extracting: 'Reading article', summarizing: 'Generating summary',
  retrying: 'Retrying summary format', saving: 'Saving summary', done: 'Summary ready',
  failed: 'Summary failed', interrupted: 'Processing interrupted' }

export default function ArticleProgress({ article, onStatusChange }) {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  useEffect(() => {
    let active = true
    let timer
    setSnapshot(null)
    setError(false)
    if (article.summary_status !== 'pending' && article.summary_status !== 'failed') return
    async function refresh() {
      let pollAgain = article.summary_status === 'pending'
      try {
        const result = await getArticleProgress(article.id)
        if (!active) return
        setSnapshot(result)
        setError(false)
        if (result.stage === 'done' || result.stage === 'failed') {
          pollAgain = false
          if (article.summary_status === 'pending') onStatusChange?.(article.id, result.stage)
        }
      } catch {
        if (active) setError(true)
      } finally {
        if (active && pollAgain) timer = window.setTimeout(refresh, 1_000)
      }
    }
    refresh()
    return () => { active = false; window.clearTimeout(timer) }
  }, [article.id, article.summary_status, retryKey, onStatusChange])

  if (article.summary_status === 'unrequested') return null
  const done = article.summary_status === 'done' || snapshot?.stage === 'done'
  const failed = article.summary_status === 'failed' || snapshot?.stage === 'failed'
  const value = done ? 100 : Math.min(99, snapshot?.percentage ?? 0)
  const stage = done ? 'done' : failed ? 'failed' : snapshot?.stage ?? 'queued'
  return <div className="article-progress">
    {error && !done ? <div role="status">
      <p>Progress unavailable. The summary may still be processing.</p>
      <button type="button" className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>Retry progress</button>
    </div> : <>
      <div className="article-progress-heading">
        <span>{labels[stage]}</span>
        <strong>{done || failed ? '' : 'Estimated '}{value}%</strong>
      </div>
      <div className="article-progress-track" role="progressbar"
        aria-label={`Summary progress for ${article.title}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <div className="article-progress-fill" style={{ width: `${value}%` }} />
      </div>
      {!done && <p className="article-progress-note">{snapshot?.elapsed_seconds ?? 0}s elapsed{!failed && ' · Progress is estimated; remaining time varies.'}</p>}
    </>}
  </div>
}
