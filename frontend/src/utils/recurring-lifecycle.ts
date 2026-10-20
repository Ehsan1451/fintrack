export type RecurringLifecycleState =
  | 'active'
  | 'inactive'
  | 'no-future-occurrences'
  | 'ended'
  | 'invalid-time-zone'

type RecurringLifecycleRule = {
  isActive: boolean
  nextRunDate: string | null
  endDate: string | null
  timeZone: string
}

function getLocalCalendarDate(now: Date, timeZone: string): string {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('Current time is invalid')
  }

  const parts = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = new Map(parts.map(({ type, value }) => [type, value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  if (!year || !month || !day || values.get('era') === 'BC') {
    throw new RangeError('Unable to determine the local calendar date')
  }

  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export function getRecurringLifecycleState(
  rule: RecurringLifecycleRule,
  now: Date,
): RecurringLifecycleState {
  let today: string
  try {
    today = getLocalCalendarDate(now, rule.timeZone)
  } catch (error) {
    if (error instanceof RangeError) return 'invalid-time-zone'
    throw error
  }

  if (rule.endDate !== null && rule.endDate < today) return 'ended'
  if (rule.nextRunDate === null) return 'no-future-occurrences'
  return rule.isActive ? 'active' : 'inactive'
}
