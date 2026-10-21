import TypingPreview from './TypingPreview.jsx'

export const DEFAULT_SUMMARY_STYLE = { tone: 'neutral', length: 'standard', format: 'paragraphs' }

const choices = [
  { key: 'tone', label: 'Tone', options: [
    ['neutral', 'Neutral', 'Clear and matter-of-fact.'],
    ['conversational', 'Conversational', 'Approachable, everyday language.'],
    ['analytical', 'Analytical', 'More emphasis on context and implications.'],
  ] },
  { key: 'length', label: 'Length', options: [
    ['brief', 'Brief', 'The essentials for a quick read.'],
    ['standard', 'Standard', 'Key facts with a little context.'],
    ['detailed', 'Detailed', 'More context, evidence, and caveats.'],
  ] },
  { key: 'format', label: 'Format', options: [
    ['bullets', 'Bullet points', 'Lists in both Facts and Impact.'],
    ['paragraphs', 'Paragraphs', 'Flowing text in both sections.'],
    ['mixed', 'Mixed', 'Facts in bullets; Impact in a paragraph.'],
  ] },
]

const examples = {
  neutral: {
    facts: ['City officials have proposed expanding bus services.', 'The plan adds routes and more frequent departures.', 'Council approval and funding are still required.'],
    impact: ['The expansion could improve access to work and services.', 'Its benefits depend on funding and the final route design.'],
  },
  conversational: {
    facts: ['The city wants to expand its bus services.', 'The proposal includes more routes and buses arriving more often.', 'It still needs the council’s approval and funding.'],
    impact: ['Getting to work or an appointment could become easier.', 'How much it helps will depend on the money available and where the routes go.'],
  },
  analytical: {
    facts: ['The proposed bus expansion would increase service coverage.', 'Additional routes and higher departure frequency are planned.', 'Implementation remains contingent on council approval and funding.'],
    impact: ['Broader coverage could improve access to employment and essential services.', 'The practical gains depend on the funding allocation and final route design.'],
  },
}

export default function SummaryStylePicker({ value, onChange, disabled }) {
  const example = examples[value.tone]
  const facts = example.facts.slice(0, { brief: 1, standard: 2, detailed: 3 }[value.length])
  const impact = example.impact.slice(0, value.length === 'brief' ? 1 : 2)
  const factsText = value.format === 'paragraphs' ? facts.join(' ') : facts.map((line) => `- ${line}`).join('\n')
  const impactText = value.format === 'bullets' ? impact.map((line) => `- ${line}`).join('\n') : impact.join(' ')
  return <>
    <fieldset className="style-settings" disabled={disabled}>
      <legend className="sr-only">Summary preferences</legend>
      {choices.map((group) => <fieldset className="style-group" key={group.key}>
        <legend>{group.label}</legend>
        <div className="style-grid">
          {group.options.map(([key, label, description]) => <label
            className={`style-choice ${value[group.key] === key ? 'selected' : ''}`} key={key}>
            <input type="radio" name={`summary-${group.key}`} value={key} aria-label={label}
              checked={value[group.key] === key} onChange={() => onChange({ ...value, [group.key]: key })} />
            <span><strong>{label}</strong><small>{description}</small></span>
          </label>)}
        </div>
      </fieldset>)}
    </fieldset>
    <section className="style-preview" aria-labelledby="style-preview-title">
      <p className="eyebrow">Illustrative preview</p>
      <h2 id="style-preview-title">Your summary, your way.</h2>
      <TypingPreview key={`${value.tone}-${value.length}-${value.format}`} factsText={factsText} impactText={impactText} />
      <p className="preview-note">This example changes with your choices. AI wording and length may vary.</p>
    </section>
  </>
}
