import { Link } from 'react-router-dom'
import '../App.css'

function DashboardPage() {
  return (
    <main className="placeholder-page">
      <div className="placeholder-card dashboard-placeholder">
        <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>Fin<span className="brand-accent">Track</span></span></Link>
        <div className="eyebrow">Your personal workspace</div>
        <h1>Welcome to FinTrack</h1>
        <p>Your dashboard is ready to take shape. We will add your financial overview here next.</p>
        <Link className="button button-primary" to="/">Back to home</Link>
      </div>
    </main>
  )
}

export default DashboardPage