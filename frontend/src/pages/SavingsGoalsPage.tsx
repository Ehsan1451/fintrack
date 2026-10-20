import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../App.css'

type Contribution = {
  id: string
  amount: string
  date: string
  createdAt: string
}

type SavingsGoal = {
  id: string
  name: string
  targetAmount: string
  targetDate: string | null
  createdAt: string
  updatedAt: string
  contributions: Contribution[]
  totalSaved: string
  remainingAmount: string
  progressPercentage: number
}

type ModalMode = 'create' | 'edit' | 'contribute' | 'delete' | null

const apiBaseUrl = 'http://localhost:5000/api/savings-goals'
const amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const maximumAmountInCents = 999_999_999_999n

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(0)
  parsed.setUTCFullYear(year, month - 1, day)
  parsed.setUTCHours(0, 0, 0, 0)
  return year > 0 && parsed.toISOString().slice(0, 10) === value
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isMoney(value: unknown): value is string {
  return (
    (typeof value === 'string' || typeof value === 'number') &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  )
}

function isContribution(value: unknown): value is Contribution {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isMoney(value.amount) &&
    typeof value.amount === 'string' &&
    isValidDateOnly(value.date) &&
    isTimestamp(value.createdAt)
  )
}

function isSavingsGoal(value: unknown): value is SavingsGoal {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isMoney(value.targetAmount) &&
    typeof value.targetAmount === 'string' &&
    (value.targetDate === null || isValidDateOnly(value.targetDate)) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    Array.isArray(value.contributions) &&
    value.contributions.every(isContribution) &&
    typeof value.totalSaved === 'string' &&
    Number.isFinite(Number(value.totalSaved)) &&
    Number(value.totalSaved) >= 0 &&
    typeof value.remainingAmount === 'string' &&
    Number.isFinite(Number(value.remainingAmount)) &&
    Number(value.remainingAmount) >= 0 &&
    typeof value.progressPercentage === 'number' &&
    Number.isFinite(value.progressPercentage) &&
    value.progressPercentage >= 0 &&
    value.progressPercentage <= 100
  )
}

function isGoalsResponse(value: unknown): value is { success: true; goals: SavingsGoal[] } {
  return (
    isRecord(value) &&
    value.success === true &&
    Array.isArray(value.goals) &&
    value.goals.every(isSavingsGoal)
  )
}

function isGoalResponse(value: unknown): value is { success: true; goal: SavingsGoal } {
  return isRecord(value) && value.success === true && isSavingsGoal(value.goal)
}

function getResponseMessage(value: unknown): string | undefined {
  return isRecord(value) && typeof value.message === 'string' ? value.message : undefined
}

function getTodayDate(): string {
  const today = new Date()
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return dateFormatter.format(date)
}

function getAmountInCents(value: string): bigint | null {
  if (!amountPattern.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return cents > 0n && cents <= maximumAmountInCents ? cents : null
}

function SavingsGoalsPage() {
  const navigate = useNavigate()
  const sessionExpired = useRef(false)
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null)
  const [name, setName] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [contributionAmount, setContributionAmount] = useState('')
  const [contributionDate, setContributionDate] = useState(getTodayDate)
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleUnauthorized = useCallback(() => {
    if (sessionExpired.current) return
    sessionExpired.current = true
    try {
      window.localStorage.removeItem('token')
    } catch {
      // Redirect even if browser storage is unavailable.
    }
    navigate('/login', { replace: true })
  }, [navigate])

  const fetchWithAuth = useCallback(async (url: string, init: RequestInit = {}) => {
    let token: string | null
    try {
      token = window.localStorage.getItem('token')
    } catch {
      throw new Error('Unable to access your saved sign-in. Please sign in again.')
    }

    if (!token) {
      navigate('/login', { replace: true })
      throw new Error("You're not signed in. Please sign in again.")
    }

    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')

    const response = await fetch(url, { ...init, headers })
    if (response.status === 401) {
      handleUnauthorized()
      throw new Error('Your sign-in has expired. Please sign in again.')
    }
    return response
  }, [handleUnauthorized, navigate])

  useEffect(() => {
    const controller = new AbortController()

    async function loadGoals() {
      setIsLoading(true)
      setLoadError('')

      try {
        const response = await fetchWithAuth(apiBaseUrl, { signal: controller.signal })
        const result: unknown = await response.json().catch(() => null)
        if (!response.ok || !isGoalsResponse(result)) {
          throw new Error(
            getResponseMessage(result) ??
              (response.ok
                ? 'The server returned savings goals in an unexpected format.'
                : 'Unable to load your savings goals. Please try again.'),
          )
        }
        setGoals(result.goals)
      } catch (error) {
        if (controller.signal.aborted || sessionExpired.current) return
        setLoadError(
          error instanceof Error ? error.message : 'Unable to connect to the server. Please try again.',
        )
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void loadGoals()
    return () => controller.abort()
  }, [fetchWithAuth, refreshVersion])

  const resetForm = () => {
    setName('')
    setTargetAmount('')
    setTargetDate('')
    setContributionAmount('')
    setContributionDate(getTodayDate())
    setFormError('')
  }

  const closeModal = () => {
    if (isSubmitting) return
    setModalMode(null)
    setSelectedGoal(null)
    resetForm()
  }

  const openCreateForm = () => {
    resetForm()
    setSelectedGoal(null)
    setModalMode('create')
  }

  const openEditForm = (goal: SavingsGoal) => {
    resetForm()
    setSelectedGoal(goal)
    setName(goal.name)
    setTargetAmount(goal.targetAmount)
    setTargetDate(goal.targetDate ?? '')
    setModalMode('edit')
  }

  const openContributionForm = (goal: SavingsGoal) => {
    resetForm()
    setSelectedGoal(goal)
    setContributionDate(getTodayDate())
    setModalMode('contribute')
  }

  const openDeleteConfirmation = (goal: SavingsGoal) => {
    setFormError('')
    setSelectedGoal(goal)
    setModalMode('delete')
  }

  const handleSaveGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('Enter a name for this savings goal.')
      return
    }
    if (trimmedName.length > 100) {
      setFormError('Goal names must be 100 characters or fewer.')
      return
    }
    if (getAmountInCents(targetAmount) === null) {
      setFormError('Enter a positive amount with no more than two decimal places (up to 9,999,999,999.99).')
      return
    }
    if (targetDate && !isValidDateOnly(targetDate)) {
      setFormError('Enter a valid target date.')
      return
    }

    setIsSubmitting(true)
    try {
      const isEditing = modalMode === 'edit' && selectedGoal !== null
      const response = await fetchWithAuth(
        isEditing ? `${apiBaseUrl}/${encodeURIComponent(selectedGoal.id)}` : apiBaseUrl,
        {
          method: isEditing ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: trimmedName,
            targetAmount,
            targetDate: targetDate || null,
          }),
        },
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok || !isGoalResponse(result)) {
        setFormError(
          getResponseMessage(result) ??
            (response.ok
              ? 'The server returned an unexpected response. Please try again.'
              : `Unable to ${isEditing ? 'update' : 'create'} this goal. Please check the details and try again.`),
        )
        return
      }

      setModalMode(null)
      setSelectedGoal(null)
      resetForm()
      setRefreshVersion((version) => version + 1)
    } catch (error) {
      if (sessionExpired.current) return
      setFormError(error instanceof Error ? error.message : 'Unable to connect to the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddContribution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')

    if (getAmountInCents(contributionAmount) === null) {
      setFormError('Enter a positive contribution with no more than two decimal places (up to 9,999,999,999.99).')
      return
    }
    if (!isValidDateOnly(contributionDate)) {
      setFormError('Enter a valid contribution date.')
      return
    }
    if (!selectedGoal) {
      setFormError('Select a savings goal before adding a contribution.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetchWithAuth(
        `${apiBaseUrl}/${encodeURIComponent(selectedGoal.id)}/contributions`,
        {
          method: 'POST',
          body: JSON.stringify({ amount: contributionAmount, date: contributionDate }),
        },
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok || !isGoalResponse(result)) {
        setFormError(
          getResponseMessage(result) ??
            (response.ok
              ? 'The server returned an unexpected response. Please try again.'
              : 'Unable to add this contribution. Please check the details and try again.'),
        )
        return
      }

      setModalMode(null)
      setSelectedGoal(null)
      resetForm()
      setRefreshVersion((version) => version + 1)
    } catch (error) {
      if (sessionExpired.current) return
      setFormError(error instanceof Error ? error.message : 'Unable to connect to the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteGoal = async () => {
    if (!selectedGoal) return

    setFormError('')
    setIsSubmitting(true)
    try {
      const response = await fetchWithAuth(
        `${apiBaseUrl}/${encodeURIComponent(selectedGoal.id)}`,
        { method: 'DELETE' },
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRecord(result) || result.success !== true) {
        setFormError(
          getResponseMessage(result) ?? 'Unable to delete this savings goal. Please try again.',
        )
        return
      }

      setModalMode(null)
      setSelectedGoal(null)
      setRefreshVersion((version) => version + 1)
    } catch (error) {
      if (sessionExpired.current) return
      setFormError(error instanceof Error ? error.message : 'Unable to connect to the server. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="dashboard-page savings-goals-page">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <Link className="brand" to="/" aria-label="FinTrack home">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>Fin<span className="brand-accent">Track</span></span>
          </Link>
          <nav className="dashboard-page-nav" aria-label="Account navigation">
            <Link to="/dashboard">Overview</Link>
            <Link to="/savings-goals" aria-current="page">Savings goals</Link>
            <Link to="/recurring-transactions">Recurring</Link>
          </nav>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              try {
                window.localStorage.removeItem('token')
              } catch {
                // Redirect even if browser storage is unavailable.
              }
              navigate('/login', { replace: true })
            }}
          >
            Log out
          </button>
        </header>

        <section className="dashboard-intro">
          <div className="eyebrow">Plan for what matters</div>
          <h1>Savings Goals</h1>
          <p>Track your progress one contribution at a time.</p>
        </section>

        <section className="monthly-budgets-section" aria-label="Savings goals">
          <div className="monthly-budgets-heading">
            <div className="eyebrow">Your plans</div>
            <button className="button button-primary add-transaction-button" type="button" onClick={openCreateForm}>
              Create goal <span aria-hidden="true">+</span>
            </button>
          </div>

          {isLoading ? (
            <p className="budget-list-message" role="status">Loading your savings goals...</p>
          ) : loadError ? (
            <div>
              <p className="dashboard-message dashboard-error" role="alert">{loadError}</p>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setRefreshVersion((version) => version + 1)}
              >
                Try again
              </button>
            </div>
          ) : goals.length === 0 ? (
            <p className="budget-list-message">No savings goals yet. Create one to start tracking your progress.</p>
          ) : (
            <ul className="budget-list savings-goals-list">
              {goals.map((goal) => (
                <li className="budget-card savings-goal-card" key={goal.id}>
                  <div className="budget-card-heading">
                    <h3>{goal.name}</h3>
                    <span className="transaction-count savings-goal-target-date">
                      {goal.targetDate ? `Target ${formatDate(goal.targetDate)}` : 'No target date'}
                    </span>
                  </div>

                  <div className="budget-amounts">
                    <span>Saved <strong>{currencyFormatter.format(Number(goal.totalSaved))}</strong> of {currencyFormatter.format(Number(goal.targetAmount))}</span>
                    <span>Remaining <strong>{currencyFormatter.format(Number(goal.remainingAmount))}</strong></span>
                  </div>

                  <progress
                    className="budget-progress"
                    value={goal.progressPercentage}
                    max={100}
                    aria-label={`${goal.name}: ${Math.round(goal.progressPercentage)}% saved`}
                  />
                  <div className="budget-card-footer">
                    <span>{Math.round(goal.progressPercentage)}% saved</span>
                    <div className="transaction-row-controls">
                      <button
                        className="budget-edit-button"
                        type="button"
                        onClick={() => openContributionForm(goal)}
                        aria-label={`Add contribution to ${goal.name}`}
                      >
                        Add contribution
                      </button>
                      <button
                        className="budget-edit-button"
                        type="button"
                        onClick={() => openEditForm(goal)}
                        aria-label={`Edit ${goal.name}`}
                      >
                        Edit
                      </button>
                      <button
                        className="transaction-delete-button"
                        type="button"
                        onClick={() => openDeleteConfirmation(goal)}
                        aria-label={`Delete ${goal.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="savings-goal-history">
                    <h4 className="eyebrow">Contribution history</h4>
                    {goal.contributions.length === 0 ? (
                      <p className="budget-list-message">No contributions yet.</p>
                    ) : (
                      <ul className="transaction-list savings-goal-contributions">
                        {goal.contributions.map((contribution) => (
                          <li className="transaction-row" key={contribution.id}>
                            <span className="transaction-description">Contribution</span>
                            <span className="transaction-meta">
                              <time dateTime={contribution.date}>{formatDate(contribution.date)}</time>
                            </span>
                            <span className="transaction-amount income-value">
                              +{currencyFormatter.format(Number(contribution.amount))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="budget-list-message">
            <Link className="text-link" to="/dashboard">Back to dashboard <span aria-hidden="true">→</span></Link>
          </p>
        </section>
      </div>

      {modalMode && (
        <div className="dashboard-modal-backdrop">
          <section
            className={`dashboard-modal${modalMode === 'delete' ? ' delete-confirmation' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="savings-goal-modal-title"
          >
            <div className="dashboard-modal-heading">
              <div>
                <div className="eyebrow">Savings goals</div>
                <h2 id="savings-goal-modal-title">
                  {modalMode === 'create' && 'Create a goal'}
                  {modalMode === 'edit' && 'Edit goal'}
                  {modalMode === 'contribute' && 'Add a contribution'}
                  {modalMode === 'delete' && 'Delete this goal?'}
                </h2>
              </div>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeModal}
                disabled={isSubmitting}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {(modalMode === 'create' || modalMode === 'edit') && (
              <form className="transaction-form" onSubmit={handleSaveGoal} noValidate>
                <label className="transaction-field" htmlFor="savings-goal-name">
                  Goal name
                  <input
                    id="savings-goal-name"
                    name="name"
                    type="text"
                    maxLength={100}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </label>
                <label className="transaction-field" htmlFor="savings-goal-target">
                  Target amount
                  <span className="amount-input-wrap">
                    <span aria-hidden="true">€</span>
                    <input
                      id="savings-goal-target"
                      name="targetAmount"
                      type="number"
                      min="0.01"
                      max="9999999999.99"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={targetAmount}
                      onChange={(event) => setTargetAmount(event.target.value)}
                      required
                    />
                  </span>
                </label>
                <label className="transaction-field" htmlFor="savings-goal-date">
                  Target date <span className="optional-label">(optional)</span>
                  <input
                    id="savings-goal-date"
                    name="targetDate"
                    type="date"
                    value={targetDate}
                    onChange={(event) => setTargetDate(event.target.value)}
                  />
                </label>
                {formError && <p className="dashboard-message dashboard-error transaction-form-error" role="alert">{formError}</p>}
                <div className="transaction-form-actions">
                  <button className="button modal-cancel-button" type="button" onClick={closeModal} disabled={isSubmitting}>
                    Cancel
                  </button>
                  <button className="button button-primary transaction-submit-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : modalMode === 'edit' ? 'Save changes' : 'Create goal'}
                  </button>
                </div>
              </form>
            )}

            {modalMode === 'contribute' && (
              <form className="transaction-form" onSubmit={handleAddContribution} noValidate>
                <p className="delete-confirmation-copy">Add a contribution to <strong>{selectedGoal?.name}</strong>.</p>
                <label className="transaction-field" htmlFor="contribution-amount">
                  Contribution amount
                  <span className="amount-input-wrap">
                    <span aria-hidden="true">€</span>
                    <input
                      id="contribution-amount"
                      name="amount"
                      type="number"
                      min="0.01"
                      max="9999999999.99"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={contributionAmount}
                      onChange={(event) => setContributionAmount(event.target.value)}
                      required
                    />
                  </span>
                </label>
                <label className="transaction-field" htmlFor="contribution-date">
                  Contribution date
                  <input
                    id="contribution-date"
                    name="date"
                    type="date"
                    value={contributionDate}
                    onChange={(event) => setContributionDate(event.target.value)}
                    required
                  />
                </label>
                {formError && <p className="dashboard-message dashboard-error transaction-form-error" role="alert">{formError}</p>}
                <div className="transaction-form-actions">
                  <button className="button modal-cancel-button" type="button" onClick={closeModal} disabled={isSubmitting}>
                    Cancel
                  </button>
                  <button className="button button-primary transaction-submit-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : 'Add contribution'}
                  </button>
                </div>
              </form>
            )}

            {modalMode === 'delete' && (
              <>
                <p className="delete-confirmation-copy">
                  Deleting <strong>{selectedGoal?.name}</strong> will permanently delete this goal and its entire contribution history.
                </p>
                {formError && <p className="dashboard-message dashboard-error transaction-form-error" role="alert">{formError}</p>}
                <div className="transaction-form-actions">
                  <button className="button modal-cancel-button" type="button" onClick={closeModal} disabled={isSubmitting}>
                    Cancel
                  </button>
                  <button className="button delete-confirm-button" type="button" onClick={() => void handleDeleteGoal()} disabled={isSubmitting}>
                    {isSubmitting ? 'Deleting...' : 'Delete goal'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default SavingsGoalsPage
