import './App.css'

function App() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <nav className="nav container" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="FinTrack home">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>Fin<span className="brand-accent">Track</span></span>
          </a>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#security">Security</a>
          </div>
          <div className="nav-actions">
            <a className="login-link" href="#login">Log in</a>
            <a className="button button-small button-dark" href="#get-started">Get started</a>
          </div>
        </nav>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero container">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-dot" /> Your money, made clear</div>
              <h1>Take control<br />of your <em>money.</em></h1>
              <p className="hero-description">A calmer, clearer way to understand your spending, build better habits, and make your money work harder for you.</p>
              <div className="hero-actions">
                <a className="button button-primary" href="#get-started">Get started <span aria-hidden="true">↗</span></a>
                <a className="button button-ghost" href="#demo"><span className="play-icon" aria-hidden="true">▶</span> View demo</a>
              </div>
              <p className="trust-note"><span className="avatars" aria-hidden="true"><i /> <i /> <i /></span> Trusted by 12,000+ people building a better financial future</p>
            </div>
            <div className="dashboard-wrap" id="demo" aria-label="FinTrack dashboard preview">
              <div className="dashboard-glow" />
              <div className="dashboard-card">
                <div className="dashboard-topbar"><span className="window-dots"><i /><i /><i /></span><span className="dashboard-label">Overview <b>⌄</b></span><span className="topbar-icon">•••</span></div>
                <div className="dashboard-content">
                  <div className="balance-row"><div><span className="muted-label">Total balance</span><strong>$24,680<span className="cents">.42</span></strong><span className="positive">↗ 12.8% <small>this month</small></span></div><div className="balance-icon">$</div></div>
                  <div className="chart-heading"><span>Spending overview</span><span className="chart-period">This month ⌄</span></div>
                  <div className="chart" aria-hidden="true"><div className="chart-grid"><i /><i /><i /><i /></div><svg viewBox="0 0 420 135" preserveAspectRatio="none"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0e9f6e" stopOpacity=".24" /><stop offset="1" stopColor="#0e9f6e" stopOpacity="0" /></linearGradient></defs><path className="chart-area" d="M0,107 C28,101 42,88 68,94 S105,82 128,88 S163,57 185,72 S225,74 245,54 S276,69 298,44 S332,51 350,36 S385,48 420,18 V135 H0Z" /><path className="chart-line" d="M0,107 C28,101 42,88 68,94 S105,82 128,88 S163,57 185,72 S225,74 245,54 S276,69 298,44 S332,51 350,36 S385,48 420,18" /></svg></div>
                  <div className="chart-labels"><span>May 01</span><span>May 08</span><span>May 15</span><span>May 22</span><span>May 31</span></div>
                  <div className="dashboard-bottom"><div><span className="muted-label">Monthly budget</span><div className="budget-value">$2,840 <small>of $4,000</small></div><div className="progress"><span /></div></div><div className="spending"><span className="muted-label">Top category</span><strong>Housing</strong><span className="category-dot" /></div></div>
                </div>
              </div>
              <div className="floating-card"><span className="mini-check">✓</span><div><strong>Payment received</strong><small>Acme Inc. · $2,400.00</small></div></div>
            </div>
          </div>
        </section>

        <section className="logo-strip" aria-label="FinTrack benefits">
          <div className="container logo-strip-inner"><span>Built for your <b>whole financial life</b></span><span className="strip-divider" /><span>Simple by design</span><span className="strip-divider" /><span>Private by default</span><span className="strip-divider" /><span>Always in your corner</span></div>
        </section>

        <section className="features-section section container" id="features">
          <div className="section-heading"><div><div className="eyebrow">Everything in one place</div><h2>Make every dollar<br /><em>count.</em></h2></div><p>FinTrack gives you the tools and clarity to move from wondering where your money went to knowing exactly where it’s going.</p></div>
          <div className="feature-grid">
            <article className="feature-card feature-green"><div className="feature-icon transactions-icon"><span>↗</span><span>↙</span></div><h3>Track transactions</h3><p>See every purchase, bill, and deposit in one beautifully organized view.</p><a href="#get-started" aria-label="Learn more about tracking transactions">Learn more <span>↗</span></a></article>
            <article className="feature-card feature-yellow"><div className="feature-icon budget-icon"><span>$</span><i /></div><h3>Manage budgets</h3><p>Set flexible spending limits that fit your life and keep you on course.</p><a href="#get-started" aria-label="Learn more about managing budgets">Learn more <span>↗</span></a></article>
            <article className="feature-card feature-lilac"><div className="feature-icon goal-icon"><span>◒</span></div><h3>Savings goals</h3><p>Turn what-if dreams into achievable milestones with a plan that works.</p><a href="#get-started" aria-label="Learn more about savings goals">Learn more <span>↗</span></a></article>
            <article className="feature-card feature-blue"><div className="feature-icon analytics-icon"><i /><i /><i /><i /></div><h3>Financial analytics</h3><p>Spot patterns, find opportunities, and make smarter decisions with confidence.</p><a href="#get-started" aria-label="Learn more about financial analytics">Learn more <span>↗</span></a></article>
          </div>
        </section>

        <section className="security-section" id="security"><div className="security-inner container"><div className="security-badge"><span>⌁</span><small>Protected<br />around the clock</small></div><div><div className="eyebrow">Your trust comes first</div><h2>Your financial life<br />stays <em>yours.</em></h2></div><p>We use bank-level encryption and thoughtful privacy controls to protect your data. Your information is never sold, and you always stay in control.</p><a className="text-link" href="#get-started">Learn about security <span>↗</span></a></div></section>

        <section className="cta-section container" id="get-started"><div className="cta-card"><div className="cta-sun" /><div className="eyebrow">A clearer path starts here</div><h2>Feel good about<br /><em>your money.</em></h2><p>Join thousands of people building a healthier financial future, one small step at a time.</p><a className="button button-light" href="#top">Get started for free <span aria-hidden="true">↗</span></a></div></section>
      </main>

      <footer className="site-footer"><div className="container footer-top"><a className="brand" href="#top"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>Fin<span className="brand-accent">Track</span></span></a><p>Clarity for your financial life.</p><div className="footer-links"><a href="#features">Features</a><a href="#security">Security</a><a href="#top">Privacy</a><a href="#top">Terms</a></div></div><div className="container footer-bottom"><span>© 2024 FinTrack. All rights reserved.</span><span>Made for a more confident tomorrow.</span></div></footer>
    </div>
  )
}

export default App
