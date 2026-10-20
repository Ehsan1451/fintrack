import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../App.css'

type PeriodPreset = 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_3_MONTHS' | 'LAST_6_MONTHS' | 'THIS_YEAR' | 'CUSTOM'

type ReportData = {
  from: string
  to: string
  timeZone: string
  totalIncome: string
  totalExpenses: string
  netCashFlow: string
  transactionCount: number
  monthly: { month: string; income: string; expenses: string }[]
  expensesByCategory: { category: string; total: string; share: string }[]
}

type DateRange = { from: string; to: string }

const categoryLabels: Record<string, string> = {
  FOOD: 'Food',
  TRANSPORT: 'Transport',
  HOUSING: 'Housing',
  SHOPPING: 'Shopping',
  ENTERTAINMENT: 'Entertainment',
  BILLS: 'Bills',
  EDUCATION: 'Education',
  HEALTH: 'Health',
  OTHER_EXPENSE: 'Other expense',
}

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})
const monthFormatter = new Intl.DateTimeFormat('fr-FR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function localDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')) }
}

function dateString(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function shiftMonth(year: number, month: number, offset: number) {
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}

function getRange(preset: PeriodPreset, timeZone: string, now = new Date()): DateRange {
  const today = localDateParts(now, timeZone)
  const todayString = dateString(today.year, today.month, today.day)
  const thisMonth = dateString(today.year, today.month, 1)

  if (preset === 'LAST_MONTH') {
    const previous = shiftMonth(today.year, today.month, -1)
    const previousMonthEnd = new Date(Date.UTC(today.year, today.month - 1, 0))
    return {
      from: dateString(previous.year, previous.month, 1),
      to: dateString(previousMonthEnd.getUTCFullYear(), previousMonthEnd.getUTCMonth() + 1, previousMonthEnd.getUTCDate()),
    }
  }
  if (preset === 'LAST_3_MONTHS' || preset === 'LAST_6_MONTHS') {
    const count = preset === 'LAST_3_MONTHS' ? 3 : 6
    const start = shiftMonth(today.year, today.month, 1 - count)
    return { from: dateString(start.year, start.month, 1), to: todayString }
  }
  if (preset === 'THIS_YEAR') return { from: `${today.year}-01-01`, to: todayString }
  if (preset === 'CUSTOM') return { from: thisMonth, to: todayString }
  return { from: thisMonth, to: todayString }
}

function isReportData(value: unknown): value is ReportData {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  const isAmount = (amount: unknown) => typeof amount === 'string' && Number.isFinite(Number(amount))
  return (
    typeof data.from === 'string' &&
    typeof data.to === 'string' &&
    typeof data.timeZone === 'string' &&
    isAmount(data.totalIncome) &&
    isAmount(data.totalExpenses) &&
    isAmount(data.netCashFlow) &&
    typeof data.transactionCount === 'number' &&
    Array.isArray(data.monthly) &&
    data.monthly.every((item) => {
      if (!item || typeof item !== 'object') return false
      const month = item as Record<string, unknown>
      return typeof month.month === 'string' && isAmount(month.income) && isAmount(month.expenses)
    }) &&
    Array.isArray(data.expensesByCategory) &&
    data.expensesByCategory.every((item) => {
      if (!item || typeof item !== 'object') return false
      const category = item as Record<string, unknown>
      return typeof category.category === 'string' && isAmount(category.total) && isAmount(category.share)
    })
  )
}

function formatMoney(amount: string | number) {
  const value = Number(amount)
  return Number.isFinite(value) ? currencyFormatter.format(value) : currencyFormatter.format(0)
}

function getErrorMessage(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string' ? message : null
}

export default function ReportsPage() {
  const navigate = useNavigate()
  const [timeZone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  })
  const [preset, setPreset] = useState<PeriodPreset>('THIS_MONTH')
  const [range, setRange] = useState<DateRange>(() => getRange('THIS_MONTH', timeZone))
  const [todayString] = useState(() => {
    const today = localDateParts(new Date(), timeZone)
    return dateString(today.year, today.month, today.day)
  })
  const [report, setReport] = useState<ReportData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadReport() {
      setIsLoading(true)
      setError('')
      try {
        const token = window.localStorage.getItem('token')
        if (!token) {
          navigate('/login', { replace: true })
          return
        }
        const params = new URLSearchParams({
          from: range.from,
          to: range.to,
          timeZone,
        })
        const response = await fetch(`http://localhost:5000/api/transactions/reports?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        const result: unknown = await response.json().catch(() => null)
        if (response.status === 401) {
          window.localStorage.removeItem('token')
          navigate('/login', { replace: true })
          return
        }
        if (!response.ok || !result || typeof result !== 'object' || (result as Record<string, unknown>).success !== true || !isReportData((result as Record<string, unknown>).data)) {
          throw new Error(getErrorMessage(result) ?? 'Unable to load your financial report.')
        }
        setReport((result as { data: ReportData }).data)
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to load your financial report.')
          setReport(null)
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }
    void loadReport()
    return () => controller.abort()
  }, [navigate, range.from, range.to, refreshCount, timeZone])

  const maxMonthlyAmount = useMemo(() => {
    if (!report) return 0
    return Math.max(0, ...report.monthly.flatMap(({ income, expenses }) => [Number(income), Number(expenses)]))
  }, [report])

  function changePreset(next: PeriodPreset) {
    setPreset(next)
    if (next !== 'CUSTOM') setRange(getRange(next, timeZone))
  }

  async function exportCsv() {
    setIsExporting(true)
    setExportError('')
    try {
      const token = window.localStorage.getItem('token')
      if (!token) {
        navigate('/login', { replace: true })
        return
      }
      const params = new URLSearchParams({ from: range.from, to: range.to, timeZone })
      const response = await fetch(`http://localhost:5000/api/transactions/reports/export?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (response.status === 401) {
        window.localStorage.removeItem('token')
        navigate('/login', { replace: true })
        return
      }
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null)
        throw new Error(getErrorMessage(result) ?? 'Unable to export transactions.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'fintrack-report.csv'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (requestError) {
      setExportError(requestError instanceof Error ? requestError.message : 'Unable to export transactions.')
    } finally {
      setIsExporting(false)
    }
  }

  function logOut() {
    try {
      window.localStorage.removeItem('token')
    } finally {
      navigate('/login')
    }
  }

  return (
    <main className="dashboard-page reports-page">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <Link className="brand" to="/" aria-label="FinTrack home">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>Fin<span className="brand-accent">Track</span></span>
          </Link>
          <nav className="dashboard-page-nav" aria-label="Account navigation">
            <Link to="/dashboard">Overview</Link>
            <Link to="/savings-goals">Savings goals</Link>
            <Link to="/recurring-transactions">Recurring</Link>
            <Link to="/reports" aria-current="page">Reports</Link>
          </nav>
          <button className="button button-primary" type="button" onClick={logOut}>Log out</button>
        </header>

        <section className="dashboard-intro">
          <div className="eyebrow">Your finances, in perspective</div>
          <h1>Reports &amp; insights</h1>
          <p>Review income, spending, and cash flow across a period you choose.</p>
        </section>

        <section className="reports-content" aria-label="Financial reports">
          <div className="reports-toolbar">
            <div className="reports-period-fields">
              <label>
                <span>Period</span>
                <select value={preset} onChange={(event) => changePreset(event.target.value as PeriodPreset)}>
                  <option value="THIS_MONTH">This month</option>
                  <option value="LAST_MONTH">Last month</option>
                  <option value="LAST_3_MONTHS">Last 3 months</option>
                  <option value="LAST_6_MONTHS">Last 6 months</option>
                  <option value="THIS_YEAR">This year</option>
                  <option value="CUSTOM">Custom range</option>
                </select>
              </label>
              {preset === 'CUSTOM' && (
                <>
                  <label>
                    <span>From</span>
                    <input type="date" value={range.from} max={range.to} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} />
                  </label>
                  <label>
                    <span>To</span>
                    <input type="date" value={range.to} min={range.from} max={todayString} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} />
                  </label>
                </>
              )}
            </div>
            <button className="button button-primary reports-export" type="button" onClick={() => void exportCsv()} disabled={isLoading || isExporting || !report}>
              {isExporting ? 'Preparing CSV…' : 'Export CSV'}
            </button>
          </div>
          <p className="reports-timezone-note">Calendar dates use {timeZone}. Custom ranges can include up to five years.</p>
          {exportError && <p className="dashboard-message dashboard-error" role="alert">{exportError}</p>}

          {isLoading ? (
            <p className="budget-list-message" role="status">Loading your report…</p>
          ) : error ? (
            <div className="reports-error">
              <p className="dashboard-message dashboard-error" role="alert">{error}</p>
              <button className="button button-primary" type="button" onClick={() => setRefreshCount((count) => count + 1)}>Try again</button>
            </div>
          ) : report ? (
            <>
              <div className="reports-summary-grid" aria-label="Selected period summary">
                <article><span>Total income</span><strong className="reports-income">{formatMoney(report.totalIncome)}</strong></article>
                <article><span>Total expenses</span><strong className="reports-expense">{formatMoney(report.totalExpenses)}</strong></article>
                <article><span>Net cash flow</span><strong className={Number(report.netCashFlow) < 0 ? 'reports-expense' : 'reports-income'}>{formatMoney(report.netCashFlow)}</strong></article>
              </div>
              <p className="reports-period-caption">
                {range.from} – {range.to} · {report.transactionCount} {report.transactionCount === 1 ? 'transaction' : 'transactions'}
              </p>

              <div className="reports-panels">
                <section className="reports-panel" aria-labelledby="reports-trends-title">
                  <div className="reports-panel-heading">
                    <div><div className="eyebrow">Period comparison</div><h2 id="reports-trends-title">Income vs expenses</h2></div>
                    <div className="reports-legend"><span><i className="reports-legend-income" />Income</span><span><i className="reports-legend-expense" />Expenses</span></div>
                  </div>
                  {report.monthly.length === 0 ? (
                    <p className="reports-empty">No months are available for this period.</p>
                  ) : (
                    <div className="reports-month-list">
                      {report.monthly.map((month) => {
                        const income = Number(month.income)
                        const expenses = Number(month.expenses)
                        return (
                          <div className="reports-month-row" key={month.month}>
                            <div className="reports-month-label">{monthFormatter.format(new Date(`${month.month}-01T00:00:00Z`))}</div>
                            <div className="reports-month-bars">
                              <div className="reports-bar-track" role="img" aria-label={`${monthFormatter.format(new Date(`${month.month}-01T00:00:00Z`))} income ${formatMoney(month.income)}`}>
                                <span className="reports-bar reports-bar-income" style={{ width: `${maxMonthlyAmount ? (income / maxMonthlyAmount) * 100 : 0}%` }} />
                              </div>
                              <div className="reports-bar-track" role="img" aria-label={`${monthFormatter.format(new Date(`${month.month}-01T00:00:00Z`))} expenses ${formatMoney(month.expenses)}`}>
                                <span className="reports-bar reports-bar-expense" style={{ width: `${maxMonthlyAmount ? (expenses / maxMonthlyAmount) * 100 : 0}%` }} />
                              </div>
                            </div>
                            <div className="reports-month-values">
                              <span>{formatMoney(month.income)}</span>
                              <span>{formatMoney(month.expenses)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>

                <section className="reports-panel" aria-labelledby="reports-category-title">
                  <div className="eyebrow">Where it goes</div>
                  <h2 id="reports-category-title">Spending by category</h2>
                  {Number(report.totalExpenses) === 0 ? (
                    <p className="reports-empty">No expenses in this period.</p>
                  ) : (
                    <ul className="reports-category-list">
                      {report.expensesByCategory.filter(({ total }) => Number(total) > 0).map((category) => (
                        <li key={category.category}>
                          <div className="reports-category-heading">
                            <span>{categoryLabels[category.category] ?? category.category}</span>
                            <strong>{formatMoney(category.total)}</strong>
                          </div>
                          <div className="reports-category-track" role="progressbar" aria-label={`${categoryLabels[category.category] ?? category.category} share of expenses`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Number(category.share))}>
                            <span style={{ width: `${Math.min(100, Math.max(0, Number(category.share)))}%` }} />
                          </div>
                          <span className="reports-category-share">{Number(category.share).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}% of expenses</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
              {report.transactionCount === 0 && <p className="reports-empty reports-empty-period">No transactions were recorded in this period.</p>}
            </>
          ) : null}
        </section>
      </div>
    </main>
  )
}
