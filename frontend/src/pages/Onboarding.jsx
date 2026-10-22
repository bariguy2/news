import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCategories, updatePreferences } from '../api.js'
import FocusedInterests from '../components/FocusedInterests.jsx'
import SummaryStylePicker, { DEFAULT_SUMMARY_STYLE } from '../components/SummaryStylePicker.jsx'


function Onboarding({ onComplete }) {
  const navigate = useNavigate()
  const [categories, setCategories] = useState([])
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [step, setStep] = useState(1)
  const [interests, setInterests] = useState({})
  const [summaryStyle, setSummaryStyle] = useState(DEFAULT_SUMMARY_STYLE)
  const heading = useRef(null)
  const submitting = useRef(false)

  useEffect(() => { heading.current?.focus() }, [step])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    getCategories()
      .then((result) => {
        if (active) setCategories(result)
      })
      .catch(() => {
        if (active) setError('Categories could not be loaded.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [reloadKey])

  function toggleCategory(category) {
    if (selected.includes(category)) {
      setInterests((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== category)))
    }
    setSelected((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (selected.length === 0 || submitting.current) return
    if (step < 3) { setStep((current) => current + 1); return }

    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const focused = Object.fromEntries(Object.entries(interests).filter(([category, value]) =>
        selected.includes(category) && value.topics.length > 0))
      const preferences = await updatePreferences(selected, focused, summaryStyle)
      onComplete(preferences)
      navigate('/feed', { replace: true })
    } catch {
      setError('Your preferences could not be saved. Try again.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-panel" aria-labelledby="onboarding-title">
        <p className="eyebrow">Your daily briefing · Step {step} of 3</p>
        <h1 id="onboarding-title" ref={heading} tabIndex={-1}>{step === 1
          ? 'What should make your front page?' : step === 2 ? 'Make it more your own.' : 'How do you like your news?'}</h1>
        <p className="lede">
          {step === 1 ? 'Choose at least one category. Next, pick the topics and teams you care about.'
            : step === 2 ? 'Choose a few interests within your categories. These choices are optional.'
              : 'Choose the tone, length, and layout of your AI summaries. Facts and Impact stay separate.'}
        </p>

        {loading && <p className="status-message" aria-live="polite">Loading categories…</p>}

        {!loading && error && categories.length === 0 && (
          <div className="error-panel" role="alert">
            <p>{error}</p>
            <button type="button" className="secondary-button" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </button>
          </div>
        )}

        {!loading && categories.length > 0 && (
          <form onSubmit={handleSubmit} aria-busy={saving}>
            {step === 1 ? <fieldset className="category-grid">
              <legend className="sr-only">News categories</legend>
              {categories.map((category) => (
                <label className={`category-choice ${selected.includes(category) ? 'selected' : ''}`} key={category}>
                  <input
                    type="checkbox"
                    checked={selected.includes(category)}
                    onChange={() => toggleCategory(category)}
                  />
                  <span>{category}</span>
                </label>
              ))}
            </fieldset> : step === 2 ? <>
              <p className="interest-notice">Your detailed interests will be saved for future topic filtering.
                For now, your briefing includes all news in your selected categories.</p>
              <FocusedInterests categories={selected} interests={interests} onChange={setInterests} disabled={saving} />
            </> : <>
              <p className="interest-notice">These preferences guide newly generated summaries.
                Published summaries are shared and keep their original style.</p>
              <SummaryStylePicker value={summaryStyle} onChange={setSummaryStyle} disabled={saving} />
            </>}

            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="onboarding-actions">
              {step > 1 && <button type="button" className="secondary-button" disabled={saving}
                onClick={() => { setStep((current) => current - 1); setError('') }}>{step === 2 ? 'Back to categories' : 'Back to topics'}</button>}
              <button className="primary-button onboarding-submit" type="submit" disabled={selected.length === 0 || saving}>
                {saving ? 'Saving…' : step < 3 ? 'Continue' : 'Build my briefing'}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}


export default Onboarding
