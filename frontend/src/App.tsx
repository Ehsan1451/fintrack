import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'

function DashboardRoute() {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'unauthenticated' | 'error'>('checking')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function verifyToken() {
      let token: string | null
      try {
        token = window.localStorage.getItem('token')
      } catch {
        setStatus('error')
        return
      }

      if (!token) {
        setStatus('unauthenticated')
        return
      }

      setStatus('checking')
      try {
        const response = await fetch('http://localhost:5000/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (response.status === 401) {
          try {
            window.localStorage.removeItem('token')
          } catch {
            // Redirect regardless; the API has already rejected this token.
          }
          setStatus('unauthenticated')
          return
        }

        if (!response.ok) {
          setStatus('error')
          return
        }

        setStatus('authenticated')
      } catch {
        if (!controller.signal.aborted) setStatus('error')
      }
    }

    void verifyToken()
    return () => controller.abort()
  }, [retryCount])

  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  if (status === 'checking') {
    return <p className="dashboard-message" role="status">Checking your sign-in...</p>
  }
  if (status === 'error') {
    return (
      <div>
        <p className="dashboard-message dashboard-error" role="alert">
          Unable to verify your sign-in. Check your connection and try again.
        </p>
        <button className="button button-primary" type="button" onClick={() => setRetryCount((count) => count + 1)}>
          Retry
        </button>
      </div>
    )
  }

  return <DashboardPage />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<DashboardRoute />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
