// Render plain model text safely, recognizing simple lists without interpreting HTML.
export default function SummaryContent({ text }) {
  const blocks = []
  let current = null
  for (const line of (text ?? '').split('\n')) {
    if (!line.trim()) { current = null; continue }
    const bullet = line.trim().match(/^(?:[-*•]|\d+[.)])\s+(.+)$/)
    const type = bullet ? 'list' : 'paragraph'
    if (!current || current.type !== type) {
      current = { type, lines: [] }
      blocks.push(current)
    }
    current.lines.push(bullet ? bullet[1] : line.trim())
  }
  return <div className="summary-content">
    {blocks.map((block, index) => block.type === 'list'
      ? <ul key={index}>{block.lines.map((line, item) => <li key={item}>{line}</li>)}</ul>
      : <p key={index}>{block.lines.join(' ')}</p>)}
  </div>
}
