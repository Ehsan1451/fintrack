import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../App.css'

type TransactionType = 'INCOME' | 'EXPENSE'
type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
type TransactionCategory =
  | 'SALARY'
  | 'FREELANCE'
  | 'GIFT'
  | 'OTHER_INCOME'
  | 'FOOD'
  | 'TRANSPORT'
  | 'HOUSING'
  | 'SHOPPING'
  | 'ENTERTAINMENT'
  | 'BILLS'
  | 'EDUCATION'
  | 'HEALTH'
  | 'OTHER_EXPENSE'

type RecurringTransaction = {
  id: string
  amount: string
  type: TransactionType
  category: TransactionCategory
  description: string | null
  frequency: RecurrenceFrequency
  interval: number
  startDate: string
  nextRunDate: string
  endDate: string | null
  timeZone: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type RuleResponse = { success: true; recurringTransaction: RecurringTransaction }
type ListResponse = { success: true; recurringTransactions: RecurringTransaction[] }
type ModalMode = 'create' | 'edit' | 'deactivate' | 'permanent-delete' | null
type PendingRuleAction = {
  id: string
  action: 'deactivate' | 'reactivate' | 'permanent-delete'
} | null
type RuleForm = {
  amount: string
  type: TransactionType
  category: TransactionCategory
  description: string
  frequency: RecurrenceFrequency
  interval: string
  startDate: string
  endDate: string
  timeZone: string
}

const apiBaseUrl = 'http://localhost:5000/api/recurring-transactions'
const amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const maximumAmountInCents = 999_999_999_999n
const maximumDescriptionLength = 500

const categoryOptions: Record<TransactionType, { value: TransactionCategory; label: string }[]> = {
  INCOME: [
    { value: 'SALARY', label: 'Salary' },
    { value: 'FREELANCE', label: 'Freelance' },
    { value: 'GIFT', label: 'Gift' },
    { value: 'OTHER_INCOME', label: 'Other income' },
  ],
  EXPENSE: [
    { value: 'FOOD', label: 'Food' },
    { value: 'TRANSPORT', label: 'Transport' },
    { value: 'HOUSING', label: 'Housing' },
    { value: 'SHOPPING', label: 'Shopping' },
    { value: 'ENTERTAINMENT', label: 'Entertainment' },
    { value: 'BILLS', label: 'Bills' },
    { value: 'EDUCATION', label: 'Education' },
    { value: 'HEALTH', label: 'Health' },
    { value: 'OTHER_EXPENSE', label: 'Other expense' },
  ],
}

const allCategories = [...categoryOptions.INCOME, ...categoryOptions.EXPENSE]
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

function isTransactionType(value: unknown): value is TransactionType {
  return value === 'INCOME' || value === 'EXPENSE'
}

function isFrequency(value: unknown): value is RecurrenceFrequency {
  return value === 'DAILY' || value === 'WEEKLY' || value === 'MONTHLY' || value === 'YEARLY'
}

function isCategory(value: unknown): value is TransactionCategory {
  return typeof value === 'string' && allCategories.some((option) => option.value === value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isRecurringTransaction(value: unknown): value is RecurringTransaction {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.amount === 'string' &&
    Number.isFinite(Number(value.amount)) &&
    Number(value.amount) > 0 &&
    isTransactionType(value.type) &&
    isCategory(value.category) &&
    (value.description === null || typeof value.description === 'string') &&
    isFrequency(value.frequency) &&
    Number.isInteger(value.interval) &&
    Number(value.interval) >= 1 &&
    isValidDateOnly(value.startDate) &&
    isValidDateOnly(value.nextRunDate) &&
    (value.endDate === null || isValidDateOnly(value.endDate)) &&
    typeof value.timeZone === 'string' &&
    typeof value.isActive === 'boolean' &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  )
}

function isListResponse(value: unknown): value is ListResponse {
  return (
    isRecord(value) &&
    value.success === true &&
    Array.isArray(value.recurringTransactions) &&
    value.recurringTransactions.every(isRecurringTransaction)
  )
}

function isRuleResponse(value: unknown): value is RuleResponse {
  return isRecord(value) && value.success === true && isRecurringTransaction(value.recurringTransaction)
}

function getResponseMessage(value: unknown): string | undefined {
  return isRecord(value) && typeof value.message === 'string' ? value.message : undefined
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

function getCategoryLabel(value: TransactionCategory): string {
  return allCategories.find((option) => option.value === value)?.label ?? value
}

function getFrequencyLabel(frequency: RecurrenceFrequency, interval: number): string {
  const labels: Record<RecurrenceFrequency, [string, string]> = {
    DAILY: ['day', 'days'],
    WEEKLY: ['week', 'weeks'],
    MONTHLY: ['month', 'months'],
    YEARLY: ['year', 'years'],
  }
  const [singular, plural] = labels[frequency]
  return `Every ${interval} ${interval === 1 ? singular : plural}`
}

function getInitialForm(rule?: RecurringTransaction): RuleForm {
  return rule
    ? {
        amount: rule.amount,
        type: rule.type,
        category: rule.category,
        description: rule.description ?? '',
        frequency: rule.frequency,
        interval: String(rule.interval),
        startDate: rule.startDate,
        endDate: rule.endDate ?? '',
        timeZone: rule.timeZone,
      }
    : {
        amount: '',
        type: 'EXPENSE',
        category: 'FOOD',
        description: '',
        frequency: 'MONTHLY',
        interval: '1',
        startDate: '',
        endDate: '',
        timeZone: 'Europe/Paris',
      }
}

function RecurringTransactionsPage() {
  const navigate = useNavigate()
  const sessionExpired = useRef(false)
  const ruleActionLock = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const [rules, setRules] = useState<RecurringTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [selectedRule, setSelectedRule] = useState<RecurringTransaction | null>(null)
  const [form, setForm] = useState<RuleForm>(() => getInitialForm())
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingRuleAction, setPendingRuleAction] = useState<PendingRuleAction>(null)

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

    let response: Response
    try {
      response = await fetch(url, { ...init, headers })
    } catch {
      throw new Error('Unable to connect to the server. Please try again.')
    }
    if (response.status === 401) {
      handleUnauthorized()
      throw new Error('Your sign-in has expired. Please sign in again.')
    }
    return response
  }, [handleUnauthorized, navigate])

  useEffect(() => {
    const controller = new AbortController()

    async function loadRules() {
      setIsLoading(true)
      setLoadError('')
      try {
        const response = await fetchWithAuth(apiBaseUrl, { signal: controller.signal })
        const result: unknown = await response.json().catch(() => null)
        if (!response.ok || !isListResponse(result)) {
          throw new Error(
            response.ok
              ? 'The server returned recurring transactions in an unexpected format.'
              : 'Unable to load recurring transactions. Please try again.',
          )
        }
        setRules(result.recurringTransactions)
      } catch (error) {
        if (controller.signal.aborted || sessionExpired.current) return
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to connect to the server. Please try again.',
        )
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void loadRules()
    return () => controller.abort()
  }, [fetchWithAuth, refreshVersion])

  useEffect(() => {
    if (!modalMode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting && !pendingRuleAction) {
        setModalMode(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSubmitting, modalMode, pendingRuleAction])

  const categories = useMemo(() => categoryOptions[form.type], [form.type])
  const activeCount = rules.filter((rule) => rule.isActive).length

  const openCreateForm = () => {
    setForm(getInitialForm())
    setSelectedRule(null)
    setFormError('')
    setSuccessMessage('')
    setModalMode('create')
  }

  const openEditForm = (rule: RecurringTransaction) => {
    setForm(getInitialForm(rule))
    setSelectedRule(rule)
    setFormError('')
    setActionError('')
    setSuccessMessage('')
    setModalMode('edit')
  }

  const closeModal = () => {
    if (isSubmitting || pendingRuleAction) return
    setModalMode(null)
    setSelectedRule(null)
    setFormError('')
  }

  const updateForm = <K extends keyof RuleForm>(field: K, value: RuleForm[K]) => {
    setForm((current) => {
      if (field === 'type') {
        const nextType = value as TransactionType
        const firstCategory = categoryOptions[nextType][0].value
        const nextCategory = categoryOptions[nextType].some((option) => option.value === current.category)
          ? current.category
          : firstCategory
        return { ...current, type: nextType, category: nextCategory }
      }
      return { ...current, [field]: value }
    })
  }

  const validateForm = (): string | null => {
    if (getAmountInCents(form.amount) === null) {
      return 'Enter a positive amount with no more than two decimal places, up to €9,999,999,999.99.'
    }
    if (!categories.some((option) => option.value === form.category)) {
      return 'Choose a category that matches the transaction type.'
    }
    const interval = Number(form.interval)
    if (!/^\d+$/.test(form.interval) || !Number.isInteger(interval) || interval < 1 || interval > 365) {
      return 'Interval must be a whole number from 1 through 365.'
    }
    if (!isValidDateOnly(form.startDate)) return 'Enter a valid start date.'
    if (form.endDate && !isValidDateOnly(form.endDate)) return 'Enter a valid end date.'
    if (form.endDate && form.endDate < form.startDate) return 'End date cannot be before the start date.'
    if (form.description.length > maximumDescriptionLength) {
      return `Description must be ${maximumDescriptionLength} characters or fewer.`
    }
    try {
      const zone = new Intl.DateTimeFormat('en-US', { timeZone: form.timeZone }).resolvedOptions().timeZone
      if (/^(?:[+-]\d{2}|GMT[+-])/i.test(zone)) return 'Enter a valid IANA time zone.'
    } catch {
      return 'Enter a valid IANA time zone.'
    }
    return null
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    const validationError = validateForm()
    if (validationError) {
      setFormError(validationError)
      return
    }
    if (modalMode !== 'create' && modalMode !== 'edit') return
    if (modalMode === 'edit' && !selectedRule) {
      setFormError('Choose a recurring transaction to edit.')
      return
    }

    const payload = {
      amount: form.amount,
      type: form.type,
      category: form.category,
      description: form.description.trim(),
      frequency: form.frequency,
      interval: Number(form.interval),
      startDate: form.startDate,
      endDate: form.endDate || null,
      timeZone: form.timeZone,
    }

    setIsSubmitting(true)
    try {
      const isEditing = modalMode === 'edit' && selectedRule !== null
      const response = await fetchWithAuth(
        isEditing ? `${apiBaseUrl}/${encodeURIComponent(selectedRule.id)}` : apiBaseUrl,
        {
          method: isEditing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRuleResponse(result)) {
        setFormError(
          response.status === 409
            ? getResponseMessage(result) ?? 'This rule can no longer be edited because it is inactive or has generated transactions.'
            : response.status === 400
              ? getResponseMessage(result) ?? 'Review the rule details and try again.'
              : response.ok
                ? 'The server returned an unexpected response.'
                : 'Unable to save this recurring transaction. Please try again.',
        )
        return
      }

      setModalMode(null)
      setSelectedRule(null)
      setSuccessMessage(isEditing ? 'Recurring transaction updated.' : 'Recurring transaction created.')
      setRefreshVersion((version) => version + 1)
    } catch (error) {
      if (sessionExpired.current) return
      setFormError(
        error instanceof Error
          ? error.message
          : 'Unable to connect to the server. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const deactivateRule = async () => {
    if (!selectedRule || ruleActionLock.current) return
    ruleActionLock.current = true
    setActionError('')
    setPendingRuleAction({ id: selectedRule.id, action: 'deactivate' })
    try {
      const response = await fetchWithAuth(
        `${apiBaseUrl}/${encodeURIComponent(selectedRule.id)}`,
        { method: 'DELETE' },
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRecord(result) || result.success !== true) {
        setActionError(
          response.status === 404
            ? 'This recurring transaction was not found.'
            : 'Unable to deactivate this recurring transaction. Please try again.',
        )
        return
      }
      setRules((current) =>
        current.map((rule) =>
          rule.id === selectedRule.id ? { ...rule, isActive: false } : rule,
        ),
      )
      setModalMode(null)
      setSelectedRule(null)
      setSuccessMessage('Recurring transaction deactivated.')
    } catch {
      if (!sessionExpired.current) {
        setActionError('Unable to connect to the server. Please try again.')
      }
    } finally {
      ruleActionLock.current = false
      setPendingRuleAction(null)
    }
  }

  const reactivateRule = async (rule: RecurringTransaction) => {
    if (ruleActionLock.current) return
    ruleActionLock.current = true
    setActionError('')
    setSuccessMessage('')
    setPendingRuleAction({ id: rule.id, action: 'reactivate' })
    try {
      const response = await fetchWithAuth(
        `${apiBaseUrl}/${encodeURIComponent(rule.id)}/reactivate`,
        { method: 'POST' },
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRuleResponse(result)) {
        setActionError(
          response.status === 404 || response.status === 409
            ? getResponseMessage(result) ?? 'This recurring transaction cannot be reactivated.'
            : 'Unable to reactivate this recurring transaction. Please try again.',
        )
        return
      }
      setRules((current) =>
        current.map((currentRule) =>
          currentRule.id === rule.id ? result.recurringTransaction : currentRule,
        ),
      )
      setSuccessMessage('Recurring transaction reactivated.')
    } catch (error) {
      if (!sessionExpired.current) {
        setActionError(
          error instanceof Error
            ? error.message
            : 'Unable to connect to the server. Please try again.',
        )
      }
    } finally {
      ruleActionLock.current = false
      setPendingRuleAction(null)
    }
  }

  const permanentlyDeleteRule = async () => {
    if (!selectedRule || ruleActionLock.current) return
    ruleActionLock.current = true
    setActionError('')
    setPendingRuleAction({ id: selectedRule.id, action: 'permanent-delete' })
    try {
      const response = await fetchWithAuth(
        `${apiBaseUrl}/${encodeURIComponent(selectedRule.id)}/permanent`,
        { method: 'DELETE' },
      )
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRecord(result) || result.success !== true) {
        setActionError(
          response.status === 404 || response.status === 409
            ? getResponseMessage(result) ?? 'This recurring transaction cannot be permanently deleted.'
            : 'Unable to permanently delete this recurring transaction. Please try again.',
        )
        return
      }
      setRules((current) => current.filter((rule) => rule.id !== selectedRule.id))
      setModalMode(null)
      setSelectedRule(null)
      setSuccessMessage('Recurring transaction permanently deleted.')
    } catch {
      if (!sessionExpired.current) {
        setActionError('Unable to connect to the server. Please try again.')
      }
    } finally {
      ruleActionLock.current = false
      setPendingRuleAction(null)
    }
  }

  const logOut = () => {
    try {
      window.localStorage.removeItem('token')
    } catch {
      // Redirect even if browser storage is unavailable.
    }
    navigate('/login', { replace: true })
  }

  return (
    <main className="dashboard-page recurring-transactions-page">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <Link className="brand" to="/" aria-label="FinTrack home">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>Fin<span className="brand-accent">Track</span></span>
          </Link>
          <nav className="recurring-page-nav" aria-label="Account navigation">
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/savings-goals">Savings goals</Link>
          </nav>
          <button className="button button-primary" type="button" onClick={logOut}>Log out</button>
        </header>

        <section className="dashboard-intro">
          <div className="eyebrow">Plan ahead</div>
          <h1>Recurring Transactions</h1>
          <p>Keep scheduled income and expenses organized in one place.</p>
        </section>

        <section className="monthly-budgets-section" aria-label="Recurring transactions">
          <div className="monthly-budgets-heading">
            <div>
              <div className="eyebrow">Your schedules</div>
              <h2>{rules.length} rules · {activeCount} active</h2>
            </div>
            <button className="button button-primary add-transaction-button" type="button" onClick={openCreateForm}>
              Create rule <span aria-hidden="true">+</span>
            </button>
          </div>

          {actionError && <p className="dashboard-message dashboard-error" role="alert">{actionError}</p>}
          {successMessage && <p className="recurring-success-message" role="status">{successMessage}</p>}

          {isLoading ? (
            <p className="budget-list-message" role="status">Loading recurring transactions...</p>
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
          ) : rules.length === 0 ? (
            <p className="budget-list-message">No recurring transactions yet. Create a rule to get started.</p>
          ) : (
            <ul className="budget-list recurring-rules-list">
              {rules.map((rule) => (
                <li className="budget-card recurring-rule-card" key={rule.id}>
                  <div className="budget-card-heading">
                    <h3>{rule.description?.trim() || 'Recurring transaction'}</h3>
                    <span className={`recurring-status${rule.isActive ? ' recurring-status-active' : ''}`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="recurring-rule-amounts">
                    <strong className={rule.type === 'INCOME' ? 'income-value' : 'expense-value'}>
                      {currencyFormatter.format(Number(rule.amount))}
                    </strong>
                    <span className={`transaction-type ${rule.type === 'INCOME' ? 'income-type' : 'expense-type'}`}>
                      {rule.type === 'INCOME' ? 'Income' : 'Expense'}
                    </span>
                    <span className="transaction-category">{getCategoryLabel(rule.category)}</span>
                  </div>
                  <dl className="recurring-rule-details">
                    <div><dt>Schedule</dt><dd>{getFrequencyLabel(rule.frequency, rule.interval)}</dd></div>
                    <div><dt>Start date</dt><dd><time dateTime={rule.startDate}>{formatDate(rule.startDate)}</time></dd></div>
                    <div><dt>Next run</dt><dd><time dateTime={rule.nextRunDate}>{formatDate(rule.nextRunDate)}</time></dd></div>
                    <div><dt>End date</dt><dd>{rule.endDate ? <time dateTime={rule.endDate}>{formatDate(rule.endDate)}</time> : 'No end date'}</dd></div>
                    <div><dt>Time zone</dt><dd>{rule.timeZone}</dd></div>
                  </dl>
                  <div className="budget-card-footer recurring-rule-footer">
                    <span>{rule.description ? `Description: ${rule.description}` : 'No description'}</span>
                    {rule.isActive ? (
                      <div className="transaction-row-controls">
                        <button
                          className="budget-edit-button"
                          type="button"
                          onClick={() => openEditForm(rule)}
                          disabled={pendingRuleAction !== null}
                          aria-label={`Edit ${rule.description || 'recurring transaction'}`}
                        >
                          Edit
                        </button>
                        <button
                          className="transaction-delete-button"
                          type="button"
                          onClick={() => {
                            setSelectedRule(rule)
                            setActionError('')
                            setSuccessMessage('')
                            setModalMode('deactivate')
                          }}
                          disabled={pendingRuleAction !== null}
                          aria-label={`Deactivate ${rule.description || 'recurring transaction'}`}
                        >
                          Deactivate
                        </button>
                      </div>
                    ) : (
                      <div className="transaction-row-controls">
                        <button
                          className="budget-edit-button"
                          type="button"
                          onClick={() => void reactivateRule(rule)}
                          disabled={pendingRuleAction !== null}
                          aria-label={`Reactivate ${rule.description || 'recurring transaction'}`}
                        >
                          {pendingRuleAction?.id === rule.id && pendingRuleAction.action === 'reactivate'
                            ? 'Reactivating...'
                            : 'Reactivate'}
                        </button>
                        <button
                          className="transaction-delete-button"
                          type="button"
                          onClick={() => {
                            setSelectedRule(rule)
                            setActionError('')
                            setSuccessMessage('')
                            setModalMode('permanent-delete')
                          }}
                          disabled={pendingRuleAction !== null}
                          aria-label={`Permanently delete ${rule.description || 'recurring transaction'}`}
                        >
                          Delete permanently
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="budget-list-message recurring-back-links">
            <Link className="text-link" to="/dashboard">Back to dashboard <span aria-hidden="true">→</span></Link>
            <Link className="text-link" to="/savings-goals">Savings goals <span aria-hidden="true">→</span></Link>
          </p>
        </section>
      </div>

      {modalMode && (
        <div
          className="dashboard-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal()
          }}
        >
          <section
            ref={dialogRef}
            className={`dashboard-modal recurring-rule-modal${modalMode === 'deactivate' || modalMode === 'permanent-delete' ? ' delete-confirmation' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recurring-modal-title"
            tabIndex={-1}
          >
            <div className="dashboard-modal-heading">
              <div>
                <div className="eyebrow">Recurring transactions</div>
                <h2 id="recurring-modal-title">
                  {modalMode === 'create' && 'Create a rule'}
                  {modalMode === 'edit' && 'Edit rule'}
                  {modalMode === 'deactivate' && 'Deactivate this rule?'}
                  {modalMode === 'permanent-delete' && 'Delete this rule permanently?'}
                </h2>
              </div>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeModal}
                disabled={isSubmitting || pendingRuleAction !== null}
                aria-label="Close"
              >×</button>
            </div>

            {modalMode === 'deactivate' || modalMode === 'permanent-delete' ? (
              <>
                <p className="delete-confirmation-copy" role={modalMode === 'permanent-delete' ? 'alert' : undefined}>
                  {modalMode === 'deactivate'
                    ? 'This rule will remain in your list as inactive. It will no longer generate transactions.'
                    : 'This action is permanent and cannot be undone. Rules with generated occurrences cannot be deleted, and their transaction history will never be removed.'}
                </p>
                {selectedRule && (
                  <div className="delete-transaction-summary">
                    <strong>{selectedRule.description || 'Recurring transaction'}</strong>
                    <span>{getFrequencyLabel(selectedRule.frequency, selectedRule.interval)}</span>
                    <b>{currencyFormatter.format(Number(selectedRule.amount))}</b>
                  </div>
                )}
                {actionError && <p className="dashboard-message dashboard-error transaction-form-error" role="alert">{actionError}</p>}
                <div className="transaction-form-actions">
                  <button className="button modal-cancel-button" type="button" onClick={closeModal} disabled={pendingRuleAction !== null}>Cancel</button>
                  <button
                    className="delete-confirm-button"
                    type="button"
                    onClick={() => void (modalMode === 'deactivate' ? deactivateRule() : permanentlyDeleteRule())}
                    disabled={pendingRuleAction !== null}
                  >
                    {pendingRuleAction?.action === 'deactivate'
                      ? 'Deactivating...'
                      : pendingRuleAction?.action === 'permanent-delete'
                        ? 'Deleting...'
                        : modalMode === 'deactivate'
                          ? 'Deactivate rule'
                          : 'Delete permanently'}
                  </button>
                </div>
              </>
            ) : (
              <form className="transaction-form recurring-rule-form" onSubmit={(event) => void handleSave(event)} noValidate>
                <label className="transaction-field" htmlFor="recurring-amount">
                  Amount
                  <span className="amount-input-wrap"><span aria-hidden="true">€</span><input id="recurring-amount" name="amount" type="text" inputMode="decimal" autoComplete="off" value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} required aria-describedby="recurring-amount-help" /></span>
                  <span className="recurring-field-help" id="recurring-amount-help">Positive amount, up to two decimal places.</span>
                </label>
                <div className="recurring-form-grid">
                  <label className="transaction-field" htmlFor="recurring-type">
                    Type
                    <select id="recurring-type" name="type" value={form.type} onChange={(event) => updateForm('type', event.target.value as TransactionType)}>
                      <option value="EXPENSE">Expense</option>
                      <option value="INCOME">Income</option>
                    </select>
                  </label>
                  <label className="transaction-field" htmlFor="recurring-category">
                    Category
                    <select id="recurring-category" name="category" value={form.category} onChange={(event) => updateForm('category', event.target.value as TransactionCategory)}>
                      {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                    </select>
                  </label>
                  <label className="transaction-field" htmlFor="recurring-frequency">
                    Frequency
                    <select id="recurring-frequency" name="frequency" value={form.frequency} onChange={(event) => updateForm('frequency', event.target.value as RecurrenceFrequency)}>
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="YEARLY">Yearly</option>
                    </select>
                  </label>
                  <label className="transaction-field" htmlFor="recurring-interval">
                    Interval
                    <input id="recurring-interval" name="interval" type="number" min="1" max="365" step="1" value={form.interval} onChange={(event) => updateForm('interval', event.target.value)} required />
                  </label>
                  <label className="transaction-field" htmlFor="recurring-start-date">
                    Start date
                    <input id="recurring-start-date" name="startDate" type="date" value={form.startDate} onChange={(event) => updateForm('startDate', event.target.value)} required />
                  </label>
                  <label className="transaction-field" htmlFor="recurring-end-date">
                    End date <span className="optional-label">Optional</span>
                    <input id="recurring-end-date" name="endDate" type="date" value={form.endDate} onChange={(event) => updateForm('endDate', event.target.value)} />
                  </label>
                </div>
                <label className="transaction-field" htmlFor="recurring-description">
                  Description <span className="optional-label">Optional</span>
                  <input id="recurring-description" name="description" type="text" maxLength={maximumDescriptionLength} value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
                </label>
                <label className="transaction-field" htmlFor="recurring-time-zone">
                  Time zone
                  <input id="recurring-time-zone" name="timeZone" type="text" value={form.timeZone} onChange={(event) => updateForm('timeZone', event.target.value)} required />
                  <span className="recurring-field-help">Use an IANA time zone, such as Europe/Paris.</span>
                </label>
                {formError && <p className="dashboard-message dashboard-error transaction-form-error" role="alert">{formError}</p>}
                <div className="transaction-form-actions">
                  <button className="button modal-cancel-button" type="button" onClick={closeModal} disabled={isSubmitting}>Cancel</button>
                  <button className="button button-primary transaction-submit-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : modalMode === 'create' ? 'Create rule' : 'Save changes'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

export default RecurringTransactionsPage
