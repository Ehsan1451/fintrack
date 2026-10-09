import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../App.css'

type TransactionType = 'INCOME' | 'EXPENSE'
type TransactionDateFilter = 'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'THIS_MONTH'
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
type BudgetCategory = (typeof categoryOptions.EXPENSE)[number]['value']

const categoryOptions = {
  INCOME: [
    { value: 'SALARY', label: 'Salary' },
    { value: 'FREELANCE', label: 'Freelance' },
    { value: 'GIFT', label: 'Gift' },
    { value: 'OTHER_INCOME', label: 'Other Income' },
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
    { value: 'OTHER_EXPENSE', label: 'Other Expense' },
  ],
} as const

type Transaction = {
  id: string
  amount: number | string
  type: TransactionType
  category: TransactionCategory
  description: string | null
  date: string
}

type TransactionsResponse = {
  success: true
  transactions: Transaction[]
}

type CategorySummary = {
  category: string
  total: number
}

type TransactionSummary = {
  totalIncome: number
  totalExpenses: number
  balance: number
  transactionCount: number
  incomeByCategory: CategorySummary[]
  expensesByCategory: CategorySummary[]
}

type TransactionSummaryResponse = {
  success: true
  data: TransactionSummary
}

type TransactionTrend = {
  date: string
  income: number
  expenses: number
}

type TransactionTrendsResponse = {
  success: true
  data: TransactionTrend[]
}

type BudgetStatus = 'On track' | 'Close to limit' | 'Over budget'

type Budget = {
  id: string
  month: string
  category: BudgetCategory
  limit: string
  spent: string
  remaining: string
  status: BudgetStatus
}

type BudgetsResponse = {
  success: true
  month: string
  budgets: Budget[]
}

type BudgetMutationResponse = {
  success: true
  budget: Budget
}

type CreateTransactionResponse = {
  success: true
  transaction: Transaction
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCategoryForType(type: unknown, category: unknown): category is TransactionCategory {
  return (
    (type === 'INCOME' || type === 'EXPENSE') &&
    typeof category === 'string' &&
    categoryOptions[type].some((option) => option.value === category)
  )
}

function getCategoryLabel(category: string): string {
  const options = [...categoryOptions.INCOME, ...categoryOptions.EXPENSE]
  return options.find((option) => option.value === category)?.label ?? category
}

function getTransactionDateTimestamp(value: string): number {
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value
  return Date.parse(dateValue)
}

function isTransaction(value: unknown): value is Transaction {
  if (!isRecord(value)) return false

  const amount = value.amount
  return (
    typeof value.id === 'string' &&
    (typeof amount === 'number' || typeof amount === 'string') &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    isCategoryForType(value.type, value.category) &&
    (typeof value.description === 'string' || value.description === null) &&
    typeof value.date === 'string' &&
    !Number.isNaN(Date.parse(value.date))
  )
}

function isTransactionsResponse(value: unknown): value is TransactionsResponse {
  return (
    isRecord(value) &&
    value.success === true &&
    Array.isArray(value.transactions) &&
    value.transactions.every(isTransaction)
  )
}

function isCategorySummary(value: unknown): value is CategorySummary {
  return (
    isRecord(value) &&
    typeof value.category === 'string' &&
    typeof value.total === 'number' &&
    Number.isFinite(value.total)
  )
}

function isTransactionSummaryResponse(value: unknown): value is TransactionSummaryResponse {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return false

  const { totalIncome, totalExpenses, balance, transactionCount, incomeByCategory, expensesByCategory } = value.data
  return (
    typeof totalIncome === 'number' &&
    Number.isFinite(totalIncome) &&
    typeof totalExpenses === 'number' &&
    Number.isFinite(totalExpenses) &&
    typeof balance === 'number' &&
    Number.isFinite(balance) &&
    typeof transactionCount === 'number' &&
    Number.isSafeInteger(transactionCount) &&
    transactionCount >= 0 &&
    Array.isArray(incomeByCategory) &&
    incomeByCategory.every(isCategorySummary) &&
    Array.isArray(expensesByCategory) &&
    expensesByCategory.every(isCategorySummary)
  )
}

function isTransactionTrend(value: unknown): value is TransactionTrend {
  return (
    isRecord(value) &&
    typeof value.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
    !Number.isNaN(Date.parse(value.date)) &&
    typeof value.income === 'number' &&
    Number.isFinite(value.income) &&
    typeof value.expenses === 'number' &&
    Number.isFinite(value.expenses)
  )
}

function isTransactionTrendsResponse(value: unknown): value is TransactionTrendsResponse {
  return (
    isRecord(value) &&
    value.success === true &&
    Array.isArray(value.data) &&
    value.data.every(isTransactionTrend)
  )
}

function isBudgetCategory(value: unknown): value is BudgetCategory {
  return (
    typeof value === 'string' &&
    categoryOptions.EXPENSE.some((option) => option.value === value)
  )
}

function isBudgetStatus(value: unknown): value is BudgetStatus {
  return value === 'On track' || value === 'Close to limit' || value === 'Over budget'
}

function isBudget(value: unknown): value is Budget {
  if (!isRecord(value)) return false
  const moneyValues = [value.limit, value.spent, value.remaining]
  return (
    typeof value.id === 'string' &&
    typeof value.month === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) &&
    isBudgetCategory(value.category) &&
    moneyValues.every(
      (amount) =>
        typeof amount === 'string' &&
        amount.trim() !== '' &&
        Number.isFinite(Number(amount)),
    ) &&
    Number(value.limit) > 0 &&
    isBudgetStatus(value.status)
  )
}

function isBudgetsResponse(value: unknown): value is BudgetsResponse {
  return (
    isRecord(value) &&
    value.success === true &&
    typeof value.month === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month) &&
    Array.isArray(value.budgets) &&
    value.budgets.every(isBudget) &&
    value.budgets.every((budget) => budget.month === value.month)
  )
}

function isBudgetMutationResponse(value: unknown): value is BudgetMutationResponse {
  return isRecord(value) && value.success === true && isBudget(value.budget)
}

function isTransactionMutationResponse(value: unknown): value is CreateTransactionResponse {
  return isRecord(value) && value.success === true && isTransaction(value.transaction)
}

function isDeleteResponse(value: unknown): value is { success: true } {
  return isRecord(value) && value.success === true
}

function getResponseMessage(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.message === 'string') return value.message
  return undefined
}

function getLocalMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})
const currencySymbol = currencyFormatter.formatToParts(0).find((part) => part.type === 'currency')?.value ?? ''

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function DashboardPage() {
  const navigate = useNavigate()
  const sessionExpired = useRef(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'ALL' | TransactionType>('ALL')
  const [transactionSort, setTransactionSort] = useState<'NEWEST' | 'OLDEST' | 'AMOUNT_DESC' | 'AMOUNT_ASC'>('NEWEST')
  const [transactionCategoryFilter, setTransactionCategoryFilter] = useState<'ALL' | TransactionCategory>('ALL')
  const [transactionDateFilter, setTransactionDateFilter] = useState<TransactionDateFilter>('ALL')
  const [trends, setTrends] = useState<TransactionTrend[]>([])
  const [isTrendsLoading, setIsTrendsLoading] = useState(true)
  const [trendsError, setTrendsError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<TransactionSummary | null>(null)
  const [isSummaryLoading, setIsSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState('')
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [isBudgetsLoading, setIsBudgetsLoading] = useState(true)
  const [budgetsError, setBudgetsError] = useState('')
  const [budgetCategory, setBudgetCategory] = useState<BudgetCategory>('FOOD')
  const [budgetLimit, setBudgetLimit] = useState('')
  const [isSavingBudget, setIsSavingBudget] = useState(false)
  const [budgetSaveMessage, setBudgetSaveMessage] = useState('')
  const [budgetSaveError, setBudgetSaveError] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<TransactionType>('EXPENSE')
  const [category, setCategory] = useState<TransactionCategory>('OTHER_EXPENSE')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => {
    const today = new Date()
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
    return localDate.toISOString().slice(0, 10)
  })
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  const handleUnauthorized = useCallback(() => {
    if (sessionExpired.current) return
    sessionExpired.current = true
    try {
      window.localStorage.removeItem('token')
    } catch {
      // Redirect even if storage is unavailable.
    }
    navigate('/login', { replace: true })
  }, [navigate])

  useEffect(() => {
    const controller = new AbortController()

    async function loadDashboardData() {
      let token: string | null
      try {
        token = window.localStorage.getItem('token')
      } catch {
        const message = 'Unable to access your saved sign-in. Please sign in again.'
        setError(message)
        setSummaryError(message)
        setBudgetsError(message)
        setTrends([])
        setTrendsError(message)
        setIsLoading(false)
        setIsSummaryLoading(false)
        setIsBudgetsLoading(false)
        setIsTrendsLoading(false)
        return
      }

      if (!token) {
        const message = "You're not signed in. Please sign in to view your dashboard."
        setError(message)
        setSummaryError(message)
        setBudgetsError(message)
        setTrends([])
        setTrendsError(message)
        setIsLoading(false)
        setIsSummaryLoading(false)
        setIsBudgetsLoading(false)
        setIsTrendsLoading(false)
        return
      }

      setIsLoading(true)
      setError('')
      setIsSummaryLoading(true)
      setSummaryError('')
      setIsBudgetsLoading(true)
      setBudgetsError('')
      setTrends([])
      setIsTrendsLoading(true)
      setTrendsError('')

      const headers = { Authorization: `Bearer ${token}` }
      const month = getLocalMonthKey(new Date())
      const timeZone = getBrowserTimeZone()

      async function loadTransactions() {
        try {
        const response = await fetch('http://localhost:5000/api/transactions', {
          headers,
          signal: controller.signal,
        })
        if (response.status === 401) {
          handleUnauthorized()
          return
        }
        const result: unknown = await response.json().catch(() => null)

        if (!response.ok || !isTransactionsResponse(result)) {
          throw new Error(
            getResponseMessage(result) ??
              (response.ok
                ? 'The server returned transaction data in an unexpected format.'
                : 'Unable to load your transactions. Please try again.'),
          )
        }

        setTransactions(result.transactions)
        } catch (requestError) {
          if (controller.signal.aborted || sessionExpired.current) return
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to connect to the server. Please try again.',
          )
        } finally {
          if (!controller.signal.aborted) setIsLoading(false)
        }
      }

      async function loadSummary() {
        try {
          const response = await fetch('http://localhost:5000/api/transactions/summary', {
            headers,
            signal: controller.signal,
          })
          if (response.status === 401) {
            handleUnauthorized()
            return
          }
          const result: unknown = await response.json().catch(() => null)

          if (!response.ok || !isTransactionSummaryResponse(result)) {
            throw new Error(
              getResponseMessage(result) ??
                (response.ok
                  ? 'The server returned summary data in an unexpected format.'
                  : 'Unable to load your transaction summary. Please try again.'),
            )
          }

          setSummary(result.data)
        } catch (requestError) {
          if (controller.signal.aborted || sessionExpired.current) return
          setSummaryError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to connect to the server. Please try again.',
          )
        } finally {
          if (!controller.signal.aborted) setIsSummaryLoading(false)
        }
      }

      async function loadTrends() {
        try {
          const response = await fetch('http://localhost:5000/api/transactions/trends', {
            headers,
            signal: controller.signal,
          })
          if (response.status === 401) {
            handleUnauthorized()
            return
          }
          const result: unknown = await response.json().catch(() => null)

          if (!response.ok || !isTransactionTrendsResponse(result)) {
            throw new Error(
              getResponseMessage(result) ??
                (response.ok
                  ? 'The server returned trend data in an unexpected format.'
                  : 'Unable to load your transaction trends. Please try again.'),
            )
          }

          setTrends(result.data)
        } catch (requestError) {
          if (controller.signal.aborted || sessionExpired.current) return
          setTrendsError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to connect to the server. Please try again.',
          )
        } finally {
          if (!controller.signal.aborted) setIsTrendsLoading(false)
        }
      }

      async function loadBudgets() {
        try {
          const query = new URLSearchParams({ month, timeZone })
          const response = await fetch(`http://localhost:5000/api/budgets?${query.toString()}`, {
            headers,
            signal: controller.signal,
          })
          if (response.status === 401) {
            handleUnauthorized()
            return
          }
          const result: unknown = await response.json().catch(() => null)

          if (
            !response.ok ||
            !isBudgetsResponse(result) ||
            result.month !== month
          ) {
            throw new Error(
              response.ok
                ? 'The server returned monthly budget data in an unexpected format.'
                : 'Unable to load your monthly budgets. Please try again.',
            )
          }

          setBudgets(result.budgets)
        } catch (requestError) {
          if (controller.signal.aborted || sessionExpired.current) return
          setBudgetsError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to connect to the server. Please try again.',
          )
        } finally {
          if (!controller.signal.aborted) setIsBudgetsLoading(false)
        }
      }

      await Promise.all([loadTransactions(), loadSummary(), loadTrends(), loadBudgets()])
    }

    void loadDashboardData()
    return () => controller.abort()
  }, [handleUnauthorized, refreshVersion])

  const resetForm = () => {
    setAmount('')
    setType('EXPENSE')
    setCategory('OTHER_EXPENSE')
    setDescription('')
    const today = new Date()
    const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
    setDate(localDate.toISOString().slice(0, 10))
    setFormError('')
  }

  const openAddForm = () => {
    setEditingTransaction(null)
    resetForm()
    setIsFormOpen(true)
  }

  const openEditForm = (transaction: Transaction) => {
    setEditingTransaction(transaction)
    setAmount(String(transaction.amount))
    setType(transaction.type)
    setCategory(transaction.category)
    setDescription(transaction.description ?? '')
    setDate(transaction.date.slice(0, 10))
    setFormError('')
    setIsFormOpen(true)
  }

  const handleTypeChange = (nextType: string) => {
    if (nextType !== 'INCOME' && nextType !== 'EXPENSE') return

    setType(nextType)
    if (!categoryOptions[nextType].some((option) => option.value === category)) {
      setCategory(nextType === 'INCOME' ? 'OTHER_INCOME' : 'OTHER_EXPENSE')
    }
  }

  const closeForm = () => {
    if (isSubmitting) return
    setIsFormOpen(false)
    setEditingTransaction(null)
    setFormError('')
  }

  const handleSubmitTransaction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')

    const numericAmount = Number(amount)
    if (!amount.trim()) {
      setFormError('Amount is required.')
      return
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('Enter an amount greater than zero.')
      return
    }
    if (type !== 'INCOME' && type !== 'EXPENSE') {
      setFormError('Select Income or Expense.')
      return
    }
    if (!date || Number.isNaN(Date.parse(date))) {
      setFormError('Enter a valid date.')
      return
    }

    setIsSubmitting(true)
    try {
      const token = window.localStorage.getItem('token')
      if (!token) {
        setFormError("You're not signed in. Please sign in before saving a transaction.")
        return
      }

      const isEditing = editingTransaction !== null
      const endpoint = isEditing
        ? `http://localhost:5000/api/transactions/${encodeURIComponent(editingTransaction.id)}`
        : 'http://localhost:5000/api/transactions'
      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: numericAmount,
          type,
          category,
          description: description.trim() || null,
          date: new Date(`${date}T12:00:00`).toISOString(),
        }),
      })
      if (response.status === 401) {
        handleUnauthorized()
        return
      }
      const result: unknown = await response.json().catch(() => null)

      if (!response.ok || !isTransactionMutationResponse(result)) {
        setFormError(
          getResponseMessage(result) ??
            (response.ok
              ? 'The server returned an unexpected response. Please try again.'
              : `Unable to ${isEditing ? 'update' : 'add'} this transaction. Please try again.`),
        )
        return
      }

      setIsFormOpen(false)
      setEditingTransaction(null)
      resetForm()
      setRefreshVersion((version) => version + 1)
    } catch (requestError) {
      if (sessionExpired.current) return
      setFormError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to connect to the server. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteTransaction = async () => {
    if (!deletingTransaction || isDeleting) return

    setDeleteError('')
    setIsDeleting(true)
    try {
      const token = window.localStorage.getItem('token')
      if (!token) {
        setDeleteError("You're not signed in. Please sign in before deleting a transaction.")
        return
      }

      const response = await fetch(
        `http://localhost:5000/api/transactions/${encodeURIComponent(deletingTransaction.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      if (response.status === 401) {
        handleUnauthorized()
        return
      }
      const result: unknown = await response.json().catch(() => null)

      if (!response.ok || !isDeleteResponse(result)) {
        setDeleteError(
          getResponseMessage(result) ?? 'Unable to delete this transaction. Please try again.',
        )
        return
      }

      setDeletingTransaction(null)
      setRefreshVersion((version) => version + 1)
    } catch (requestError) {
      if (sessionExpired.current) return
      setDeleteError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to connect to the server. Please try again.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSaveBudget = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBudgetSaveMessage('')
    setBudgetSaveError('')

    const numericLimit = Number(budgetLimit)
    if (!budgetLimit.trim() || !Number.isFinite(numericLimit) || numericLimit <= 0) {
      setBudgetSaveError('Enter a monthly limit greater than zero.')
      return
    }

    setIsSavingBudget(true)
    try {
      const token = window.localStorage.getItem('token')
      if (!token) {
        setBudgetSaveError("You're not signed in. Please sign in before saving a budget.")
        return
      }

      const month = getLocalMonthKey(new Date())
      const response = await fetch('http://localhost:5000/api/budgets', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          month,
          timeZone: getBrowserTimeZone(),
          category: budgetCategory,
          limit: numericLimit,
        }),
      })
      if (response.status === 401) {
        handleUnauthorized()
        return
      }
      const result: unknown = await response.json().catch(() => null)

      if (
        !response.ok ||
        !isBudgetMutationResponse(result) ||
        result.budget.month !== month ||
        result.budget.category !== budgetCategory
      ) {
        setBudgetSaveError(
          response.status === 400
            ? 'Check the category and enter a valid positive monthly limit.'
            : 'Unable to save your monthly budget. Please try again.',
        )
        return
      }

      setBudgetLimit('')
      setBudgetSaveMessage(`${getCategoryLabel(budgetCategory)} monthly budget saved.`)
      setRefreshVersion((version) => version + 1)
    } catch {
      if (sessionExpired.current) return
      setBudgetSaveError('Unable to connect to the server. Please try again.')
    } finally {
      setIsSavingBudget(false)
    }
  }

  const expenseCategoryRows = [...(summary?.expensesByCategory ?? [])]
    .filter((category) => Number.isFinite(category.total) && category.total > 0)
    .map((category) => ({
      ...category,
      percentage: summary && summary.totalExpenses > 0
        ? Math.min(100, Math.max(0, (category.total / summary.totalExpenses) * 100))
        : 0,
    }))
    .sort((first, second) => second.total - first.total)
  const currentBudgetMonth = getLocalMonthKey(new Date())
  const budgetMonthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${currentBudgetMonth}-01T12:00:00`))
  const getBudgetProgress = (budget: Budget) => {
    const limit = Number(budget.limit)
    const spent = Number(budget.spent)
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(spent)) return 0
    return Math.min(100, Math.max(0, (spent / limit) * 100))
  }
  const maxValue = Math.max(summary?.totalIncome ?? 0, summary?.totalExpenses ?? 0)
  const getSharedPercentage = (value: number) =>
    maxValue > 0 ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : 0
  const incomePercentage = getSharedPercentage(summary?.totalIncome ?? 0)
  const expensesPercentage = getSharedPercentage(summary?.totalExpenses ?? 0)
  const trendMaxValue = Math.max(0, ...trends.flatMap((trend) => [trend.income, trend.expenses]))
  const chartScaleMax = trendMaxValue > 0 ? trendMaxValue : 1
  const chartLeft = 64
  const chartRight = 776
  const chartTop = 24
  const chartBottom = 205
  const chartWidth = chartRight - chartLeft
  const chartHeight = chartBottom - chartTop
  const trendPoints = trends.map((trend, index) => {
    const x = trends.length === 1
      ? chartLeft + chartWidth / 2
      : chartLeft + (index / (trends.length - 1)) * chartWidth

    return {
      ...trend,
      x,
      incomeY: chartBottom - (Math.max(0, trend.income) / chartScaleMax) * chartHeight,
      expensesY: chartBottom - (Math.max(0, trend.expenses) / chartScaleMax) * chartHeight,
    }
  })
  const incomeLine = trendPoints.map((point) => `${point.x},${point.incomeY}`).join(' ')
  const expensesLine = trendPoints.map((point) => `${point.x},${point.expensesY}`).join(' ')
  const dateTickIndexes = trends.length <= 5
    ? trends.map((_, index) => index)
    : Array.from({ length: 5 }, (_, index) => Math.round((index * (trends.length - 1)) / 4))
  const trendDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const formatTrendDate = (value: string) => trendDateFormatter.format(new Date(`${value}T00:00:00Z`))
  const currentDate = new Date()
  const todayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
  const tomorrowStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1)
  const dateFilterStart =
    transactionDateFilter === 'THIS_MONTH'
      ? new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
      : transactionDateFilter === 'LAST_7_DAYS'
        ? new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 6)
        : transactionDateFilter === 'LAST_30_DAYS'
          ? new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 29)
          : todayStart
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const matchingTransactions = transactions.filter((transaction) => {
    const matchesType = transactionTypeFilter === 'ALL' || transaction.type === transactionTypeFilter
    const matchesCategory =
      transactionCategoryFilter === 'ALL' || transaction.category === transactionCategoryFilter
    const transactionTimestamp = getTransactionDateTimestamp(transaction.date)
    const matchesDate =
      transactionDateFilter === 'ALL' ||
      (transactionTimestamp >= dateFilterStart.getTime() && transactionTimestamp < tomorrowStart.getTime())
    const matchesSearch =
      !normalizedSearchQuery ||
      [
        transaction.description ?? '',
        transaction.category,
        getCategoryLabel(transaction.category),
        transaction.type,
      ].some((field) => field.toLowerCase().includes(normalizedSearchQuery))

    return matchesType && matchesCategory && matchesDate && matchesSearch
  })
  const filteredTransactions = [...matchingTransactions].sort((first, second) => {
    switch (transactionSort) {
      case 'NEWEST':
        return Date.parse(second.date) - Date.parse(first.date)
      case 'OLDEST':
        return Date.parse(first.date) - Date.parse(second.date)
      case 'AMOUNT_DESC':
        return Number(second.amount) - Number(first.amount)
      case 'AMOUNT_ASC':
        return Number(first.amount) - Number(second.amount)
    }
  })

  return (
    <main className="dashboard-page">
      <div className="dashboard-container">
        <header className="dashboard-header">
          <Link className="brand" to="/" aria-label="FinTrack home">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>Fin<span className="brand-accent">Track</span></span>
          </Link>
          <span className="dashboard-header-label">Personal finance</span>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              window.localStorage.removeItem('token')
              navigate('/login')
            }}
          >
            Log out
          </button>
        </header>

        <section className="dashboard-intro">
          <div className="eyebrow">Your personal workspace</div>
          <h1>Overview</h1>
          <p>Your income, spending, and recent transactions in one place.</p>
        </section>

        {summaryError && !error && <p className="dashboard-message dashboard-error" role="alert">Unable to load summary: {summaryError}</p>}

        <section className="summary-grid" aria-label="Transaction summary">
          <article className="summary-item">
            <h2>Total income</h2>
            <p className="summary-value income-value">
              {summary ? currencyFormatter.format(summary.totalIncome) : isSummaryLoading ? 'Loading...' : '—'}
            </p>
          </article>
          <article className="summary-item">
            <h2>Total expenses</h2>
            <p className="summary-value expense-value">
              {summary ? currencyFormatter.format(summary.totalExpenses) : isSummaryLoading ? 'Loading...' : '—'}
            </p>
          </article>
          <article className="summary-item">
            <h2>Balance</h2>
            <p className={`summary-value${summary && summary.balance < 0 ? ' expense-value' : ''}`}>
              {summary ? currencyFormatter.format(summary.balance) : isSummaryLoading ? 'Loading...' : '—'}
            </p>
          </article>
        </section>

        <section className="trends-section" aria-labelledby="trends-title">
          <div className="trends-heading">
            <div className="eyebrow">Daily cash flow</div>
            <h2 id="trends-title">Income &amp; Expenses Over Time</h2>
          </div>

          {isTrendsLoading ? (
            <p className="trends-message" role="status">Loading trend data...</p>
          ) : trendsError ? (
            <p className="trends-message trends-error" role="alert">{trendsError}</p>
          ) : trends.length === 0 ? (
            <p className="trends-message">No trend data available yet.</p>
          ) : (
            <>
              <div className="trends-legend" aria-hidden="true">
                <span><i className="trends-legend-income" />Income</span>
                <span><i className="trends-legend-expenses" />Expenses</span>
              </div>

              <div className="trends-chart-scroll">
                <svg
                  className="trends-chart"
                  viewBox="0 0 800 260"
                  role="img"
                  aria-label={`Income and expenses over ${trends.length} ${trends.length === 1 ? 'day' : 'days'}. Exact daily amounts are listed below.`}
                  preserveAspectRatio="xMinYMin meet"
                >
                  {[0, 0.5, 1].map((fraction) => {
                    const y = chartBottom - fraction * chartHeight
                    const value = trendMaxValue * fraction
                    return (
                      <g key={fraction}>
                        <line className="trends-grid-line" x1={chartLeft} x2={chartRight} y1={y} y2={y} />
                        <text className="trends-axis-value" x={chartLeft - 10} y={y + 4} textAnchor="end">
                          {currencyFormatter.format(value)}
                        </text>
                      </g>
                    )
                  })}

                  <polyline className="trends-line trends-line-income" points={incomeLine} />
                  <polyline className="trends-line trends-line-expenses" points={expensesLine} />

                  {trendPoints.map((point) => (
                    <g key={point.date}>
                      <circle className="trends-point-income" cx={point.x} cy={point.incomeY} r="4" />
                      <rect className="trends-point-expenses" x={point.x - 3.5} y={point.expensesY - 3.5} width="7" height="7" />
                    </g>
                  ))}

                  {dateTickIndexes.map((index) => {
                    const point = trendPoints[index]
                    if (!point) return null
                    return (
                      <text
                        className="trends-axis-date"
                        key={point.date}
                        x={point.x}
                        y="238"
                        textAnchor={index === 0 ? 'start' : index === trendPoints.length - 1 ? 'end' : 'middle'}
                      >
                        {formatTrendDate(point.date)}
                      </text>
                    )
                  })}
                </svg>
              </div>

              <div className="trends-data-table-wrap">
                <table className="trends-data-table">
                  <caption>Daily income and expense amounts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Income</th>
                      <th scope="col">Expenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trends.map((trend) => (
                      <tr key={trend.date}>
                        <th scope="row">{formatTrendDate(trend.date)}</th>
                        <td>{currencyFormatter.format(trend.income)}</td>
                        <td>{currencyFormatter.format(trend.expenses)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="income-expenses-section" aria-labelledby="income-expenses-title">
          <div className="income-expenses-heading">
            <div className="eyebrow">Cash flow comparison</div>
            <h2 id="income-expenses-title">Income vs Expenses</h2>
          </div>

          {isSummaryLoading && !summary ? (
            <p className="income-expenses-empty" role="status">Loading income and expenses...</p>
          ) : !summary ? (
            <p className="income-expenses-empty">Income and expenses are unavailable.</p>
          ) : (
            <ul className="income-expenses-list">
              <li className="income-expenses-row">
                <div className="income-expenses-labels">
                  <span>Income</span>
                  <span>{currencyFormatter.format(summary.totalIncome)}</span>
                </div>
                <progress
                  className="income-expenses-progress income-progress"
                  value={incomePercentage}
                  max={100}
                  aria-hidden="true"
                />
              </li>
              <li className="income-expenses-row">
                <div className="income-expenses-labels">
                  <span>Expenses</span>
                  <span>{currencyFormatter.format(summary.totalExpenses)}</span>
                </div>
                <progress
                  className="income-expenses-progress expenses-progress"
                  value={expensesPercentage}
                  max={100}
                  aria-hidden="true"
                />
              </li>
            </ul>
          )}
        </section>

        <section className="expense-category-section" aria-labelledby="expense-category-title">
          <div className="expense-category-heading">
            <div className="eyebrow">Spending breakdown</div>
            <h2 id="expense-category-title">Expenses by Category</h2>
          </div>

          {isSummaryLoading && !summary ? (
            <p className="expense-category-empty" role="status">Loading expense categories...</p>
          ) : !summary ? (
            <p className="expense-category-empty">Expense categories are unavailable.</p>
          ) : summary.totalExpenses <= 0 || expenseCategoryRows.length === 0 ? (
            <p className="expense-category-empty">No expenses to analyze yet.</p>
          ) : (
            <ul className="expense-category-list">
              {expenseCategoryRows.map((category) => (
                <li className="expense-category-row" key={category.category}>
                  <div className="expense-category-labels">
                    <span>{getCategoryLabel(category.category)}</span>
                    <span>{currencyFormatter.format(category.total)}</span>
                  </div>
                  <progress
                    className="expense-category-progress"
                    value={category.percentage}
                    max={100}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="monthly-budgets-section" aria-labelledby="monthly-budgets-title">
          <div className="monthly-budgets-heading">
            <div>
              <div className="eyebrow">{budgetMonthLabel}</div>
              <h2 id="monthly-budgets-title">Monthly Budgets</h2>
            </div>
          </div>

          <form className="budget-form" onSubmit={handleSaveBudget} noValidate>
            <label className="transaction-field" htmlFor="budget-category">
              Expense category
              <select
                id="budget-category"
                name="category"
                value={budgetCategory}
                onChange={(event) => setBudgetCategory(event.target.value as BudgetCategory)}
              >
                {categoryOptions.EXPENSE.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="transaction-field" htmlFor="budget-limit">
              Monthly limit
              <span className="amount-input-wrap">
                <span aria-hidden="true">{currencySymbol}</span>
                <input
                  id="budget-limit"
                  name="limit"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={budgetLimit}
                  onChange={(event) => setBudgetLimit(event.target.value)}
                  aria-describedby={budgetSaveError ? 'budget-save-error' : undefined}
                  required
                />
              </span>
            </label>
            <button className="button button-primary budget-submit-button" type="submit" disabled={isSavingBudget}>
              {isSavingBudget
                ? 'Saving...'
                : budgets.some((budget) => budget.month === currentBudgetMonth && budget.category === budgetCategory)
                  ? 'Update limit'
                  : 'Save budget'}
            </button>
          </form>

          {budgetSaveMessage && <p className="budget-save-message" role="status">{budgetSaveMessage}</p>}
          {budgetSaveError && <p className="dashboard-message dashboard-error budget-form-error" id="budget-save-error" role="alert">{budgetSaveError}</p>}

          {isBudgetsLoading ? (
            <p className="budget-list-message" role="status">Loading your monthly budgets...</p>
          ) : budgetsError ? (
            <p className="budget-list-message budget-list-error" role="alert">{budgetsError}</p>
          ) : budgets.length === 0 ? (
            <p className="budget-list-message">No monthly budgets yet. Set a limit above to get started.</p>
          ) : (
            <ul className="budget-list">
              {budgets.map((budget) => {
                const percentage = getBudgetProgress(budget)
                const statusModifier =
                  budget.status === 'Over budget'
                    ? 'over'
                    : budget.status === 'Close to limit'
                      ? 'close'
                      : 'on-track'

                return (
                  <li className="budget-card" key={budget.id}>
                    <div className="budget-card-heading">
                      <h3>{getCategoryLabel(budget.category)}</h3>
                      <span className={`budget-status budget-status-${statusModifier}`}>{budget.status}</span>
                    </div>
                    <div className="budget-amounts">
                      <span>Spent <strong>{currencyFormatter.format(Number(budget.spent))}</strong>{' '}of {currencyFormatter.format(Number(budget.limit))}</span>
                      <span>Remaining <strong>{currencyFormatter.format(Number(budget.remaining))}</strong></span>
                    </div>
                    <progress
                      className={`budget-progress budget-progress-${statusModifier}`}
                      value={percentage}
                      max={100}
                      aria-label={`${getCategoryLabel(budget.category)} budget ${Math.round(percentage)}% used`}
                    />
                    <div className="budget-card-footer">
                      <span>{Math.round(percentage)}% used</span>
                      <button
                        className="budget-edit-button"
                        type="button"
                        onClick={() => {
                          setBudgetCategory(budget.category)
                          setBudgetLimit(budget.limit)
                          setBudgetSaveMessage('')
                          setBudgetSaveError('')
                        }}
                        aria-label={`Edit ${getCategoryLabel(budget.category)} monthly budget`}
                      >
                        Edit limit
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="transactions-section" aria-labelledby="transactions-title">
          <div className="transactions-heading">
            <div>
              <div className="eyebrow">Your activity</div>
              <h2 id="transactions-title">Transactions</h2>
            </div>
            <div className="transactions-actions">
              {!isSummaryLoading && !summaryError && summary && (
                <span className="transaction-count">
                  {summary.transactionCount} {summary.transactionCount === 1 ? 'transaction' : 'transactions'}
                </span>
              )}
              <button className="button button-primary add-transaction-button" type="button" onClick={openAddForm}>
                Add Transaction <span aria-hidden="true">+</span>
              </button>
            </div>
          </div>

          <div className="transaction-filters">
            <div className="transaction-field transaction-search-field">
              <label htmlFor="transaction-search">Search transactions</label>
              <div className="transaction-search-control">
                <input
                  id="transaction-search"
                  type="search"
                  aria-label="Search transactions"
                  placeholder="Search transactions..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery && (
                  <button
                    className="transaction-search-clear"
                    type="button"
                    aria-label="Clear transaction search"
                    onClick={() => setSearchQuery('')}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
            </div>
            <label className="transaction-field" htmlFor="transaction-type-filter">
              Transaction type
              <select
                id="transaction-type-filter"
                value={transactionTypeFilter}
                onChange={(event) => setTransactionTypeFilter(event.target.value as 'ALL' | TransactionType)}
              >
                <option value="ALL">All transactions</option>
                <option value="INCOME">Income</option>
                <option value="EXPENSE">Expenses</option>
              </select>
            </label>
            <label className="transaction-field" htmlFor="transaction-category-filter">
              Category
              <select
                id="transaction-category-filter"
                aria-label="Filter transactions by category"
                value={transactionCategoryFilter}
                onChange={(event) => setTransactionCategoryFilter(event.target.value as 'ALL' | TransactionCategory)}
              >
                <option value="ALL">All categories</option>
                <optgroup label="Income">
                  {categoryOptions.INCOME.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Expenses">
                  {categoryOptions.EXPENSE.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="transaction-field" htmlFor="transaction-date-filter">
              Date
              <select
                id="transaction-date-filter"
                aria-label="Filter transactions by date"
                value={transactionDateFilter}
                onChange={(event) => setTransactionDateFilter(event.target.value as TransactionDateFilter)}
              >
                <option value="ALL">All dates</option>
                <option value="TODAY">Today</option>
                <option value="LAST_7_DAYS">Last 7 days</option>
                <option value="LAST_30_DAYS">Last 30 days</option>
                <option value="THIS_MONTH">This month</option>
              </select>
            </label>
            <label className="transaction-field" htmlFor="transaction-sort">
              Sort transactions
              <select
                id="transaction-sort"
                aria-label="Sort transactions"
                value={transactionSort}
                onChange={(event) => setTransactionSort(event.target.value as typeof transactionSort)}
              >
                <option value="NEWEST">Newest first</option>
                <option value="OLDEST">Oldest first</option>
                <option value="AMOUNT_DESC">Amount: highest to lowest</option>
                <option value="AMOUNT_ASC">Amount: lowest to highest</option>
              </select>
            </label>
          </div>

          {isLoading ? (
            <p className="dashboard-message" role="status">Loading your transactions...</p>
          ) : error ? (
            <p className="dashboard-message dashboard-error" role="alert">{error}</p>
          ) : transactions.length === 0 ? (
            <p className="dashboard-message">No transactions yet.</p>
          ) : filteredTransactions.length === 0 ? (
            <p className="dashboard-message">No transactions match your filters.</p>
          ) : (
            <ul className="transaction-list">
              {filteredTransactions.map((transaction) => {
                const isIncome = transaction.type === 'INCOME'
                return (
                  <li className="transaction-row" key={transaction.id}>
                    <span className="transaction-description">
                      {transaction.description?.trim() || 'Untitled transaction'}
                    </span>
                    <span className="transaction-meta">
                      <span className={`transaction-type${isIncome ? ' income-type' : ' expense-type'}`}>
                        {isIncome ? 'Income' : 'Expense'}
                      </span>
                      <span className="transaction-category">{getCategoryLabel(transaction.category)}</span>
                      <time dateTime={transaction.date}>
                        {dateFormatter.format(new Date(transaction.date))}
                      </time>
                    </span>
                    <span className={`transaction-amount${isIncome ? ' income-value' : ' expense-value'}`}>
                      {isIncome ? '+' : '-'}{currencyFormatter.format(Number(transaction.amount))}
                    </span>
                    <div className="transaction-row-controls">
                      <button
                        className="transaction-edit-button"
                        type="button"
                        onClick={() => openEditForm(transaction)}
                        aria-label={`Edit ${transaction.description?.trim() || 'untitled transaction'}`}
                      >
                        Edit
                      </button>
                      <button
                        className="transaction-delete-button"
                        type="button"
                        onClick={() => { setDeleteError(''); setDeletingTransaction(transaction) }}
                        aria-label={`Delete ${transaction.description?.trim() || 'untitled transaction'}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {isFormOpen && (
        <div className="dashboard-modal-backdrop">
          <section className="dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-form-title">
            <div className="dashboard-modal-heading">
              <div>
                <div className="eyebrow">{editingTransaction ? 'Update activity' : 'New activity'}</div>
                <h2 id="transaction-form-title">{editingTransaction ? 'Edit transaction' : 'Add transaction'}</h2>
              </div>
              <button
                className="modal-close-button"
                type="button"
                aria-label="Close add transaction form"
                disabled={isSubmitting}
                onClick={closeForm}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <form className="transaction-form" onSubmit={handleSubmitTransaction} noValidate>
              <label className="transaction-field" htmlFor="transaction-amount">
                Amount
                <span className="amount-input-wrap">
                  <span aria-hidden="true">{currencySymbol}</span>
                  <input
                    id="transaction-amount"
                    name="amount"
                    aria-label="Transaction amount in euros"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                </span>
              </label>

              <label className="transaction-field" htmlFor="transaction-type">
                Type
                <select id="transaction-type" name="type" value={type} onChange={(event) => handleTypeChange(event.target.value)}>
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
              </label>

              <label className="transaction-field" htmlFor="transaction-category">
                Category
                <select id="transaction-category" name="category" value={category} onChange={(event) => setCategory(event.target.value as TransactionCategory)}>
                  {categoryOptions[type].map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="transaction-field" htmlFor="transaction-description">
                Description <span className="optional-label">Optional</span>
                <input
                  id="transaction-description"
                  name="description"
                  type="text"
                  maxLength={250}
                  placeholder="e.g. Groceries"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="transaction-field" htmlFor="transaction-date">
                Date
                <input
                  id="transaction-date"
                  name="date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </label>

              {formError && <p className="dashboard-message dashboard-error transaction-form-error" role="alert">{formError}</p>}

              <div className="transaction-form-actions">
                <button className="button modal-cancel-button" type="button" disabled={isSubmitting} onClick={closeForm}>
                  Cancel
                </button>
                <button className="button button-primary transaction-submit-button" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : editingTransaction ? 'Save changes' : 'Save transaction'}
                  {isSubmitting && <span className="spinner" aria-hidden="true" />}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deletingTransaction && (
        <div className="dashboard-modal-backdrop">
          <section className="dashboard-modal delete-confirmation" role="dialog" aria-modal="true" aria-labelledby="delete-confirmation-title">
            <div className="dashboard-modal-heading">
              <div>
                <div className="eyebrow">Remove activity</div>
                <h2 id="delete-confirmation-title">Delete transaction?</h2>
              </div>
              <button
                className="modal-close-button"
                type="button"
                aria-label="Close delete confirmation"
                disabled={isDeleting}
                onClick={() => { setDeletingTransaction(null); setDeleteError('') }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <p className="delete-confirmation-copy">This transaction will be permanently deleted.</p>
            <div className="delete-transaction-summary">
              <strong>{deletingTransaction.description?.trim() || 'Untitled transaction'}</strong>
              <span>{deletingTransaction.type === 'INCOME' ? 'Income' : 'Expense'} · {dateFormatter.format(new Date(deletingTransaction.date))}</span>
              <b className={deletingTransaction.type === 'INCOME' ? 'income-value' : 'expense-value'}>
                {deletingTransaction.type === 'INCOME' ? '+' : '-'}{currencyFormatter.format(Number(deletingTransaction.amount))}
              </b>
            </div>

            {deleteError && <p className="dashboard-message dashboard-error transaction-form-error" role="alert">{deleteError}</p>}

            <div className="transaction-form-actions">
              <button
                className="button modal-cancel-button"
                type="button"
                disabled={isDeleting}
                onClick={() => { setDeletingTransaction(null); setDeleteError('') }}
              >
                Cancel
              </button>
              <button
                className="button delete-confirm-button"
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDeleteTransaction()}
              >
                {isDeleting ? 'Deleting...' : 'Delete transaction'}
                {isDeleting && <span className="spinner" aria-hidden="true" />}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default DashboardPage