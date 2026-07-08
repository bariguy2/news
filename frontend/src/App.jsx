import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { getPreferences } from './api.js'
import Detail from './pages/Detail.jsx'
import Feed from './pages/Feed.jsx'
import Onboarding from './pages/Onboarding.jsx'


function App() {
  const [preferences, setPreferences] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    setError('')

    getPreferences()
      .then((result) => {
        if (active) setPreferences(result)
      })
      .catch(() => {
        if (active) setError('Could not connect to the news service.')
      })

    return () => {
      active = false
    }
  }, [reloadKey])

  if (error) {
    return (
      <main className="status-page">
        <p className="eyebrow">Local news</p>
        <h1>Service unavailable</h1>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={() => setReloadKey((key) => key + 1)}>
          Try again
        </button>
      </main>
    )
  }

  if (!preferences) {
    return (
      <main className="status-page" aria-busy="true">
        <p className="eyebrow">Local news</p>
        <h1>Loading your briefing…</h1>
      </main>
    )
  }

  const defaultRoute = preferences.onboarded ? '/feed' : '/onboarding'

  return (
    <Routes>
      <Route path="/" element={<Navigate to={defaultRoute} replace />} />
      <Route
        path="/onboarding"
        element={preferences.onboarded
          ? <Navigate to="/feed" replace />
          : <Onboarding onComplete={setPreferences} />}
      />
      <Route
        path="/feed"
        element={preferences.onboarded ? <Feed /> : <Navigate to="/onboarding" replace />}
      />
      <Route
        path="/article/:id"
        element={preferences.onboarded ? <Detail /> : <Navigate to="/onboarding" replace />}
      />
      <Route path="*" element={<Navigate to={defaultRoute} replace />} />
    </Routes>
  )
}


export default App
