import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCategories, updatePreferences } from '../api.js'


function Onboarding({ onComplete }) {
  const navigate = useNavigate()
  const [categories, setCategories] = useState([])
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

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
    setSelected((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (selected.length === 0 || saving) return

    setSaving(true)
    setError('')
    try {
      const preferences = await updatePreferences(selected)
      onComplete(preferences)
      navigate('/feed', { replace: true })
    } catch {
      setError('Your interests could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-panel" aria-labelledby="onboarding-title">
        <p className="eyebrow">Your daily briefing</p>
        <h1 id="onboarding-title">What should make your front page?</h1>
        <p className="lede">
          Choose at least one topic. Your selection stays on this device and only controls which headlines you see.
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
          <form onSubmit={handleSubmit}>
            <fieldset className="category-grid">
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
            </fieldset>

            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button onboarding-submit" type="submit" disabled={selected.length === 0 || saving}>
              {saving ? 'Saving…' : 'Build my briefing'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}


export default Onboarding
