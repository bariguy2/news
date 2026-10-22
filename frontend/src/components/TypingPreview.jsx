import { useEffect, useState } from 'react'
import SummaryContent from './SummaryContent.jsx'

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function PreviewText({ fullText, visibleText, typing }) {
  return <div className="typing-preview-text">
    {/* Reserve the completed layout and expose complete sentences to screen readers. */}
    <div className="typing-preview-reserve"><SummaryContent text={fullText} /></div>
    <div className="typing-preview-visible" aria-hidden="true" data-typing={typing}>
      <SummaryContent text={visibleText} />
      {typing && !visibleText && <span className="preview-caret" />}
    </div>
  </div>
}

export default function TypingPreview({ factsText, impactText, children, onComplete, simultaneous = false }) {
  const facts = Array.from(factsText)
  const impact = Array.from(impactText)
  const total = facts.length + impact.length
  const [revealed, setRevealed] = useState(() => window.matchMedia?.(MOTION_QUERY).matches
    ? { facts: facts.length, impact: impact.length } : { facts: 0, impact: 0 })

  useEffect(() => {
    const motion = window.matchMedia?.(MOTION_QUERY)
    let timer
    let active = true
    const duration = Math.min(1_750, Math.max(600, total * 6))
    const factsDuration = Math.min(1_750, Math.max(600, facts.length * 6))
    const impactDuration = Math.min(1_750, Math.max(600, impact.length * 6))
    function start() {
      window.clearTimeout(timer)
      if (motion?.matches) { setRevealed({ facts: facts.length, impact: impact.length }); onComplete?.(); return }
      setRevealed({ facts: 0, impact: 0 })
      const started = Date.now()
      function tick() {
        if (!active) return
        const elapsed = Date.now() - started
        const count = Math.min(total, Math.floor(elapsed / duration * total))
        const next = simultaneous ? {
          facts: Math.min(facts.length, Math.floor(elapsed / factsDuration * facts.length)),
          impact: Math.min(impact.length, Math.floor(elapsed / impactDuration * impact.length)),
        } : { facts: Math.min(facts.length, count), impact: Math.max(0, count - facts.length) }
        setRevealed(next)
        if (next.facts < facts.length || next.impact < impact.length) timer = window.setTimeout(tick, 24)
        else onComplete?.()
      }
      timer = window.setTimeout(tick, 24)
    }
    start()
    motion?.addEventListener?.('change', start)
    return () => {
      active = false
      window.clearTimeout(timer)
      motion?.removeEventListener?.('change', start)
    }
  }, [factsText, impactText, facts.length, impact.length, total, onComplete, simultaneous])

  const factsContent = <PreviewText fullText={factsText} visibleText={facts.slice(0, revealed.facts).join('')} typing={revealed.facts < facts.length} />
  const impactContent = <PreviewText fullText={impactText} visibleText={impact.slice(0, revealed.impact).join('')}
      typing={(simultaneous || revealed.facts >= facts.length) && revealed.impact < impact.length} />
  if (children) return children(factsContent, impactContent)
  return <>
    <h3>Facts</h3>
    {factsContent}
    <h3>Impact</h3>
    {impactContent}
  </>
}
