import {
  Prisma,
  RecurrenceFrequency,
  TransactionCategory,
  TransactionType,
} from "@prisma/client";
import { getRecurrenceIndex } from "./recurrence-date.js";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const amountPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const maximumAmount = new Prisma.Decimal("9999999999.99");
const maximumDescriptionLength = 500;
const forbiddenFields = ["userId", "isActive", "nextRunDate"] as const;
const allowedFields = [
  "amount",
  "type",
  "category",
  "frequency",
  "interval",
  "startDate",
  "endDate",
  "description",
  "timeZone",
] as const;

const categoriesByType: Record<TransactionType, readonly TransactionCategory[]> = {
  INCOME: [
    TransactionCategory.SALARY,
    TransactionCategory.FREELANCE,
    TransactionCategory.GIFT,
    TransactionCategory.OTHER_INCOME,
  ],
  EXPENSE: [
    TransactionCategory.FOOD,
    TransactionCategory.TRANSPORT,
    TransactionCategory.HOUSING,
    TransactionCategory.SHOPPING,
    TransactionCategory.ENTERTAINMENT,
    TransactionCategory.BILLS,
    TransactionCategory.EDUCATION,
    TransactionCategory.HEALTH,
    TransactionCategory.OTHER_EXPENSE,
  ],
};

export type RecurringTransactionInput = {
  amount: Prisma.Decimal;
  type: TransactionType;
  category: TransactionCategory;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  endDate: Date | null;
  description: string | null;
  timeZone: string;
};

export type RecurringTransactionPatch = Partial<RecurringTransactionInput>;

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAmount(value: unknown): Prisma.Decimal | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const amountString = String(value);
  if (!amountPattern.test(amountString)) return null;

  const amount = new Prisma.Decimal(amountString);
  if (
    !amount.isFinite() ||
    amount.lessThanOrEqualTo(0) ||
    amount.greaterThan(maximumAmount)
  ) {
    return null;
  }
  return amount;
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = datePattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return null;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;

  try {
    const resolvedTimeZone = new Intl.DateTimeFormat("en-US", {
      timeZone: value,
    }).resolvedOptions().timeZone;
    return !/^(?:[+-]\d{2}|GMT[+-])/i.test(resolvedTimeZone);
  } catch {
    return false;
  }
}

function isTransactionType(value: unknown): value is TransactionType {
  return (
    typeof value === "string" &&
    Object.values(TransactionType).some((type) => type === value)
  );
}

function isTransactionCategory(value: unknown): value is TransactionCategory {
  return (
    typeof value === "string" &&
    Object.values(TransactionCategory).some((category) => category === value)
  );
}

function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return (
    typeof value === "string" &&
    Object.values(RecurrenceFrequency).some((frequency) => frequency === value)
  );
}

function validateObjectFields(
  body: unknown,
): ValidationResult<Record<string, unknown>> {
  if (!isRecord(body)) {
    return { success: false, message: "A JSON object is required" };
  }

  const forbidden = forbiddenFields.filter((field) =>
    Object.hasOwn(body, field),
  );
  if (forbidden.length > 0) {
    return {
      success: false,
      message: `${forbidden.join(", ")} must not be provided`,
    };
  }

  const unsupported = Object.keys(body).filter(
    (field) => !allowedFields.some((allowed) => allowed === field),
  );
  if (unsupported.length > 0) {
    return { success: false, message: "Request contains unsupported fields" };
  }

  if (Object.keys(body).length === 0) {
    return { success: false, message: "At least one supported field is required" };
  }

  return { success: true, value: body };
}

export function parseRecurringTransactionPatch(
  body: unknown,
): ValidationResult<RecurringTransactionPatch> {
  const objectResult = validateObjectFields(body);
  if (!objectResult.success) return objectResult;

  const fields = objectResult.value;
  const patch: RecurringTransactionPatch = {};

  if (Object.hasOwn(fields, "amount")) {
    const amount = parseAmount(fields.amount);
    if (!amount) {
      return {
        success: false,
        message: "Amount must be positive, have at most 2 decimal places, and not exceed 9999999999.99",
      };
    }
    patch.amount = amount;
  }

  if (Object.hasOwn(fields, "type")) {
    if (!isTransactionType(fields.type)) {
      return { success: false, message: "Type must be INCOME or EXPENSE" };
    }
    patch.type = fields.type;
  }

  if (Object.hasOwn(fields, "category")) {
    if (!isTransactionCategory(fields.category)) {
      return { success: false, message: "Category is invalid" };
    }
    patch.category = fields.category;
  }

  if (Object.hasOwn(fields, "frequency")) {
    if (!isRecurrenceFrequency(fields.frequency)) {
      return {
        success: false,
        message: "Frequency must be DAILY, WEEKLY, MONTHLY, or YEARLY",
      };
    }
    patch.frequency = fields.frequency;
  }

  if (Object.hasOwn(fields, "interval")) {
    if (
      typeof fields.interval !== "number" ||
      !Number.isInteger(fields.interval) ||
      fields.interval < 1 ||
      fields.interval > 365
    ) {
      return {
        success: false,
        message: "Interval must be an integer from 1 through 365",
      };
    }
    patch.interval = fields.interval;
  }

  if (Object.hasOwn(fields, "startDate")) {
    const startDate = parseDateOnly(fields.startDate);
    if (!startDate) {
      return {
        success: false,
        message: "startDate must be a valid YYYY-MM-DD calendar date",
      };
    }
    patch.startDate = startDate;
  }

  if (Object.hasOwn(fields, "endDate")) {
    if (fields.endDate === null) {
      patch.endDate = null;
    } else {
      const endDate = parseDateOnly(fields.endDate);
      if (!endDate) {
        return {
          success: false,
          message: "endDate must be null or a valid YYYY-MM-DD calendar date",
        };
      }
      patch.endDate = endDate;
    }
  }

  if (Object.hasOwn(fields, "description")) {
    if (
      typeof fields.description !== "string" ||
      fields.description.length > maximumDescriptionLength
    ) {
      return {
        success: false,
        message: `description must be a string no longer than ${maximumDescriptionLength} characters`,
      };
    }
    patch.description = fields.description.trim() || null;
  }

  if (Object.hasOwn(fields, "timeZone")) {
    if (!isValidTimeZone(fields.timeZone)) {
      return { success: false, message: "timeZone must be a valid IANA time zone" };
    }
    patch.timeZone = fields.timeZone;
  }

  return { success: true, value: patch };
}

export function parseRecurringTransactionCreate(
  body: unknown,
): ValidationResult<RecurringTransactionInput> {
  const parsed = parseRecurringTransactionPatch(body);
  if (!parsed.success) return parsed;

  const value = parsed.value;
  if (
    value.amount === undefined ||
    value.type === undefined ||
    value.category === undefined ||
    value.frequency === undefined ||
    value.interval === undefined ||
    value.startDate === undefined
  ) {
    return {
      success: false,
      message: "amount, type, category, frequency, interval, and startDate are required",
    };
  }

  return {
    success: true,
    value: {
      amount: value.amount,
      type: value.type,
      category: value.category,
      frequency: value.frequency,
      interval: value.interval,
      startDate: value.startDate,
      endDate: value.endDate ?? null,
      description: value.description ?? null,
      timeZone: value.timeZone ?? "Europe/Paris",
    },
  };
}

export function validateRecurringTransactionSchedule(
  input: Pick<
    RecurringTransactionInput,
    "type" | "category" | "startDate" | "endDate"
  >,
): string | null {
  if (!categoriesByType[input.type].includes(input.category)) {
    return "Category is not valid for the selected transaction type";
  }
  if (input.endDate !== null && input.endDate < input.startDate) {
    return "endDate cannot precede startDate";
  }
  return null;
}

export function validateRecurringTransactionForReactivation(input: {
  amount: Prisma.Decimal;
  type: TransactionType;
  category: TransactionCategory;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  nextRunDate: Date;
  endDate: Date | null;
  timeZone: string;
}, now: Date = new Date()): string | null {
  if (
    !input.amount.isFinite() ||
    input.amount.lessThanOrEqualTo(0) ||
    input.amount.greaterThan(maximumAmount)
  ) {
    return "Rule amount is invalid";
  }
  if (
    !Number.isInteger(input.interval) ||
    input.interval < 1 ||
    input.interval > 365
  ) {
    return "Rule interval is invalid";
  }

  const scheduleError = validateRecurringTransactionSchedule(input);
  if (scheduleError) return scheduleError;
  if (!isValidTimeZone(input.timeZone)) return "Rule time zone is invalid";

  try {
    const startDate = serializeRecurringDate(input.startDate);
    const nextRunDate = serializeRecurringDate(input.nextRunDate);
    const endDate =
      input.endDate === null ? null : serializeRecurringDate(input.endDate);
    if (!Number.isFinite(now.getTime())) {
      return "Current time is invalid";
    }
    const localDateParts = new Intl.DateTimeFormat(
      "en-CA-u-ca-iso8601-nu-latn",
      {
        timeZone: input.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(now);
    const localDateValues = new Map(
      localDateParts.map(({ type, value }) => [type, value]),
    );
    const year = localDateValues.get("year");
    const month = localDateValues.get("month");
    const day = localDateValues.get("day");
    if (!year || !month || !day || localDateValues.get("era") === "BC") {
      return "Unable to determine the current date in the rule's time zone";
    }
    const localToday = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (endDate !== null && endDate < localToday) {
      return "The recurring schedule has already ended";
    }
    const occurrenceIndex = getRecurrenceIndex(
      startDate,
      input.frequency,
      input.interval,
      nextRunDate,
    );
    if (occurrenceIndex === null) {
      return "Next run date is not on the rule's recurrence schedule";
    }
    if (endDate !== null && nextRunDate > endDate) {
      return "The recurring schedule has already ended";
    }
  } catch {
    return "Rule contains an invalid schedule date";
  }

  return null;
}

export function serializeRecurringDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
