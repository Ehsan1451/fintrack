import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from './AuthLayout'
import '../App.css'

function isLoginSuccess(response: unknown): response is { success: true; token: string } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === true &&
    'token' in response &&
    typeof response.token === 'string'
  )
}

function getResponseMessage(response: unknown): string | undefined {
  if (
    typeof response === 'object' &&
    response !== null &&
    'message' in response &&
    typeof response.message === 'string'
  ) {
    return response.message
  }
  return undefined
}

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState('')

  const validate = () => {
    const nextErrors: { email?: string; password?: string } = {}
    if (!email.trim()) nextErrors.email = 'Email is required.'
    else if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (!password) nextErrors.password = 'Password is required.'
    return nextErrors
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('')
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setIsSubmitting(true)
    try {
      const response = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const result: unknown = await response.json().catch(() => null)

      if (!response.ok || !isLoginSuccess(result)) {
        setStatus(getResponseMessage(result) ?? 'Email or password is incorrect.')
        return
      }

      try {
        window.localStorage.setItem('token', result.token)
      } catch {
        setStatus('Login succeeded, but this browser could not save your session. Enable local storage and try again.')
        return
      }

      navigate('/dashboard')
    } catch {
      setStatus('Unable to connect to the server. Please check your connection and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout eyebrow="Welcome back" title="Welcome back" description="Sign in to keep your finances clear, organized, and moving forward.">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field-group">
          <label htmlFor="login-email">Email address</label>
          <input id="login-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'login-email-error' : undefined} placeholder="you@example.com" />
          {errors.email && <span className="field-error" id="login-email-error" role="alert">{errors.email}</span>}
        </div>
        <div className="field-group">
          <div className="label-row"><label htmlFor="login-password">Password</label><a className="form-link" href="#forgot-password">Forgot password?</a></div>
          <div className="password-field"><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'login-password-error' : undefined} placeholder="Enter your password" /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div>
          {errors.password && <span className="field-error" id="login-password-error" role="alert">{errors.password}</span>}
        </div>
        <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Sign in'}{isSubmitting && <span className="spinner" aria-hidden="true" />}</button>
        {status && <p className="form-status form-error" role="alert">{status}</p>}
      </form>
      <p className="auth-switch">New to FinTrack? <Link to="/register">Create account</Link></p>
    </AuthLayout>
  )
}

export default LoginPage