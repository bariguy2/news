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

export default function TypingPreview({ factsText, impactText }) {
  const facts = Array.from(factsText)
  const impact = Array.from(impactText)
  const total = facts.length + impact.length
  const [revealed, setRevealed] = useState(() => window.matchMedia?.(MOTION_QUERY).matches ? total : 0)

  useEffect(() => {
    const motion = window.matchMedia?.(MOTION_QUERY)
    let timer
    let active = true
    const duration = Math.min(1_750, Math.max(600, total * 6))
    function start() {
      window.clearTimeout(timer)
      if (motion?.matches) { setRevealed(total); return }
      setRevealed(0)
      const started = Date.now()
      function tick() {
        if (!active) return
        const count = Math.min(total, Math.floor((Date.now() - started) / duration * total))
        setRevealed(count)
        if (count < total) timer = window.setTimeout(tick, 24)
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
  }, [factsText, impactText, total])

  return <>
    <h3>Facts</h3>
    <PreviewText fullText={factsText} visibleText={facts.slice(0, revealed).join('')} typing={revealed < facts.length} />
    <h3>Impact</h3>
    <PreviewText fullText={impactText} visibleText={impact.slice(0, Math.max(0, revealed - facts.length)).join('')}
      typing={revealed >= facts.length && revealed < total} />
  </>
}
