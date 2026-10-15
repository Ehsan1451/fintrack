export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function parseCalendarDate(value: string): CalendarDate {
  const match = datePattern.exec(value);
  if (!match) {
    throw new RangeError("Date must use the YYYY-MM-DD format");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) {
    throw new RangeError("Date must be a valid calendar date");
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Date must be a valid calendar date");
  }

  return { year, month, day };
}

function createUtcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    !Number.isFinite(date.getTime()) ||
    year < 1 ||
    year > 9999 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1
  ) {
    throw new RangeError("Calculated recurrence date is outside the supported range");
  }
  return date;
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRecurrenceFrequency(value: string): value is RecurrenceFrequency {
  return ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value);
}

function getCalendarDayNumber({ year, month, day }: CalendarDate): number {
  const previousYear = year - 1;
  const daysBeforeYear =
    previousYear * 365 +
    Math.floor(previousYear / 4) -
    Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysBeforeMonth =
    Math.floor((275 * month) / 9) -
    30 -
    (month > 2 ? (isLeapYear ? 1 : 2) : 0);

  return daysBeforeYear + daysBeforeMonth + day - 1;
}

export function getRecurrenceDate(
  startDate: string,
  frequency: RecurrenceFrequency,
  interval: number,
  occurrenceIndex: number,
): string {
  const anchor = parseCalendarDate(startDate);
  if (!isRecurrenceFrequency(frequency)) {
    throw new RangeError("Frequency must be DAILY, WEEKLY, MONTHLY, or YEARLY");
  }
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new RangeError("Interval must be a positive integer");
  }
  if (!Number.isSafeInteger(occurrenceIndex) || occurrenceIndex < 0) {
    throw new RangeError("Occurrence index must be a non-negative integer");
  }

  const step = interval * occurrenceIndex;
  if (!Number.isSafeInteger(step)) {
    throw new RangeError("Recurrence interval is too large");
  }

  if (frequency === "DAILY" || frequency === "WEEKLY") {
    const dayOffset = step * (frequency === "WEEKLY" ? 7 : 1);
    if (!Number.isSafeInteger(dayOffset)) {
      throw new RangeError("Recurrence interval is too large");
    }

    const date = createUtcDate(anchor.year, anchor.month, anchor.day);
    date.setUTCDate(date.getUTCDate() + dayOffset);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) {
      throw new RangeError("Calculated recurrence date is outside the supported range");
    }
    return formatCalendarDate(date);
  }

  if (frequency === "MONTHLY") {
    const monthIndex = (anchor.year - 1) * 12 + anchor.month - 1 + step;
    const year = Math.floor(monthIndex / 12) + 1;
    const month = monthIndex - (year - 1) * 12 + 1;
    const day = Math.min(anchor.day, daysInMonth(year, month));
    return formatCalendarDate(createUtcDate(year, month, day));
  }

  const year = anchor.year + step;
  const day = Math.min(anchor.day, daysInMonth(year, anchor.month));
  return formatCalendarDate(createUtcDate(year, anchor.month, day));
  return formatCalendarDate(createUtcDate(year, anchor.month, day));
}
export function getRecurrenceIndex(
  startDate: string,
  frequency: RecurrenceFrequency,
  interval: number,
  nextRunDate: string,
): number | null {
  const anchor = parseCalendarDate(startDate);
  const nextRun = parseCalendarDate(nextRunDate);
  if (!isRecurrenceFrequency(frequency)) {
    throw new RangeError("Frequency must be DAILY, WEEKLY, MONTHLY, or YEARLY");
  }
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new RangeError("Interval must be a positive integer");
  }
  if (nextRunDate < startDate) return null;

  let step: number;
  if (frequency === "DAILY" || frequency === "WEEKLY") {
    const dayDifference = getCalendarDayNumber(nextRun) - getCalendarDayNumber(anchor);
    const daysPerOccurrence = interval * (frequency === "WEEKLY" ? 7 : 1);
    step = dayDifference / daysPerOccurrence;
  } else if (frequency === "MONTHLY") {
    const monthDifference =
      (nextRun.year - anchor.year) * 12 + nextRun.month - anchor.month;
    step = monthDifference / interval;
  } else {
    if (nextRun.month !== anchor.month) return null;
    step = (nextRun.year - anchor.year) / interval;
  }

  if (!Number.isSafeInteger(step) || step < 0) return null;
  return getRecurrenceDate(startDate, frequency, interval, step) === nextRunDate
    ? step
    : null;
}
