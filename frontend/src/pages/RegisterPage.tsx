import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from './AuthLayout'
import '../App.css'

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

function isRegistrationSuccess(response: unknown): boolean {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === true &&
    'user' in response &&
    typeof response.user === 'object' &&
    response.user !== null &&
    'id' in response.user &&
    typeof response.user.id === 'string'
  )
}

function RegisterPage() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; password?: string; confirmPassword?: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRegistered, setIsRegistered] = useState(false)
  const [status, setStatus] = useState('')

  const validate = () => {
    const nextErrors: { fullName?: string; email?: string; password?: string; confirmPassword?: string } = {}
    const nameParts = fullName.trim().split(/\s+/)
    if (!fullName.trim()) nextErrors.fullName = 'Full name is required.'
    else if (nameParts.length < 2) nextErrors.fullName = 'Enter both your first and last name.'
    if (!email.trim()) nextErrors.email = 'Email is required.'
    else if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (!password) nextErrors.password = 'Password is required.'
    else if (password.length < 8) nextErrors.password = 'Password must be at least 8 characters.'
    if (!confirmPassword) nextErrors.confirmPassword = 'Please confirm your password.'
    else if (password !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.'
    return nextErrors
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting || isRegistered) return
    setStatus('')
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const [firstName, ...lastNameParts] = fullName.trim().split(/\s+/)
    setIsSubmitting(true)
    try {
      const response = await fetch('http://localhost:5000/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          firstName,
          lastName: lastNameParts.join(' '),
        }),
      })
      const result: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const backendMessage = getResponseMessage(result)
        if (response.status === 409) {
          setStatus(backendMessage ?? 'An account with this email already exists.')
        } else if (response.status === 400 && backendMessage) {
          setStatus(backendMessage)
        } else {
          setStatus('Unable to create your account right now. Please try again.')
        }
        return
      }

      if (!isRegistrationSuccess(result)) {
        setStatus('The server returned an unexpected response. Please try again.')
        return
      }

      setIsRegistered(true)
      setStatus('Your account has been created successfully. Redirecting to sign in...')
      window.setTimeout(() => navigate('/login'), 1200)
    } catch {
      setStatus('Unable to connect to the server. Please check your connection and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthLayout eyebrow="Start your journey" title="Create your account" description="Set up your FinTrack workspace and start building a clearer financial future.">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="field-group"><label htmlFor="register-name">Full name</label><input id="register-name" name="fullName" type="text" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? 'register-name-error' : undefined} placeholder="Jordan Lee" />{errors.fullName && <span className="field-error" id="register-name-error" role="alert">{errors.fullName}</span>}</div>
        <div className="field-group"><label htmlFor="register-email">Email address</label><input id="register-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'register-email-error' : undefined} placeholder="you@example.com" />{errors.email && <span className="field-error" id="register-email-error" role="alert">{errors.email}</span>}</div>
        <div className="field-group"><label htmlFor="register-password">Password</label><div className="password-field"><input id="register-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'register-password-error' : undefined} placeholder="At least 8 characters" /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div>{errors.password && <span className="field-error" id="register-password-error" role="alert">{errors.password}</span>}</div>
        <div className="field-group"><label htmlFor="register-confirm-password">Confirm password</label><div className="password-field"><input id="register-confirm-password" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? 'register-confirm-password-error' : undefined} placeholder="Repeat your password" /><button className="password-toggle" type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>{showConfirmPassword ? 'Hide' : 'Show'}</button></div>{errors.confirmPassword && <span className="field-error" id="register-confirm-password-error" role="alert">{errors.confirmPassword}</span>}</div>
        <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || isRegistered}>{isSubmitting ? 'Creating account...' : 'Create account'}{isSubmitting && <span className="spinner" aria-hidden="true" />}</button>
        {status && <p className="form-status" role="status">{status}</p>}
      </form>
      <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthLayout>
  )
}

export default RegisterPage