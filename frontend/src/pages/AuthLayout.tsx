import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type AuthLayoutProps = {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}

function AuthLayout({ eyebrow, title, description, children }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link className="brand auth-brand" to="/" aria-label="FinTrack home">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>Fin<span className="brand-accent">Track</span></span>
        </Link>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
      </div>
    </main>
  )
}

export default AuthLayout