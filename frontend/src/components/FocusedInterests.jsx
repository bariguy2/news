import { useState } from 'react'
import { TEAMS, TOPICS } from '../interests.js'


function Choices({ label, options, selected, onToggle }) {
  return <fieldset className="interest-choices">
    <legend>{label}</legend>
    <div className="interest-chips">
      {options.map((option) => <label className={`interest-chip ${selected.includes(option) ? 'selected' : ''}`} key={option}>
        <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} />
        <span>{option}</span>
      </label>)}
    </div>
  </fieldset>
}


function TeamChoices({ sport, selected, onToggle }) {
  const [team, setTeam] = useState('')
  const [error, setError] = useState('')
  const options = [...new Set([...(TEAMS[sport] ?? []), ...selected])]
  function toggleTeam(teamName) {
    if (!selected.includes(teamName) && selected.length >= 20) {
      setError('Choose up to 20 teams per sport.')
      return
    }
    onToggle(teamName)
    setError('')
  }
  function addTeam() {
    const name = options.find((item) => item.toLowerCase() === team.trim().toLowerCase()) ?? team.trim()
    if (!name) { setError('Enter a team name.'); return }
    if (selected.length >= 20 && !selected.includes(name)) { setError('Choose up to 20 teams per sport.'); return }
    if (!selected.some((item) => item.toLowerCase() === name.toLowerCase())) onToggle(name)
    setTeam('')
    setError('')
  }
  return <div className="sport-teams">
    <Choices label={`${sport} teams`} options={options} selected={selected} onToggle={toggleTeam} />
    <div className="custom-team">
      <label htmlFor={`team-${sport.replaceAll(' ', '-')}`}>Add another {sport.toLowerCase()} team</label>
      <div className="custom-team-controls">
        <input id={`team-${sport.replaceAll(' ', '-')}`} value={team} maxLength={80} placeholder="Team name"
          onChange={(event) => { setTeam(event.target.value); setError('') }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTeam() } }} />
        <button type="button" className="secondary-button" onClick={addTeam}>Add team</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </div>
}


export default function FocusedInterests({ categories, interests, onChange, disabled }) {
  function toggleTopic(category, topic) {
    const current = interests[category] ?? { topics: [], teams: {} }
    const removing = current.topics.includes(topic)
    const teams = { ...current.teams }
    if (removing) delete teams[topic]
    onChange({ ...interests, [category]: {
      topics: removing ? current.topics.filter((item) => item !== topic) : [...current.topics, topic], teams,
    } })
  }
  function toggleTeam(sport, team) {
    const current = interests.Sports
    const selected = current.teams[sport] ?? []
    const teams = { ...current.teams, [sport]: selected.includes(team)
      ? selected.filter((item) => item !== team) : [...selected, team] }
    if (!teams[sport].length) delete teams[sport]
    onChange({ ...interests, Sports: { ...current, teams } })
  }
  return <fieldset className="focused-interests" disabled={disabled}>
    <legend className="sr-only">Focused interests</legend>
    {categories.map((category) => {
      const config = TOPICS[category]
      const current = interests[category] ?? { topics: [], teams: {} }
      return <section className="interest-section" key={category} aria-labelledby={`interest-${category}`}>
        <h2 id={`interest-${category}`}>{category}</h2>
        {config ? <Choices label={config.label} options={config.options} selected={current.topics}
          onToggle={(topic) => toggleTopic(category, topic)} />
          : <p className="interest-help">More topic choices for this category are coming later.</p>}
        {category === 'Sports' && current.topics.map((sport) => <TeamChoices key={sport} sport={sport}
          selected={current.teams[sport] ?? []} onToggle={(team) => toggleTeam(sport, team)} />)}
      </section>
    })}
  </fieldset>
}
