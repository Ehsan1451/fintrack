import {
  Prisma,
  TransactionCategory,
  TransactionType,
  type PrismaClient,
} from "@prisma/client";
import {
  getRecurrenceDate,
  getRecurrenceIndex,
  type RecurrenceFrequency,
} from "../utils/recurrence-date.js";

const MAX_HANDLED_DATES_PER_PASS = 50;
const RULE_BATCH_SIZE = 50;
const MAX_TRANSACTION_AMOUNT = new Prisma.Decimal("9999999999.99");

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

export type GenerationIssue = {
  ruleId: string;
  message: string;
};

export type GenerationPassResult = {
  handledDates: number;
  deactivatedRules: number;
  issues: GenerationIssue[];
  continuationCursor: string | null;
};

type RuleOutcome =
  | { kind: "handled"; deactivated: boolean }
  | { kind: "unchanged" }
  | { kind: "deactivated" }
  | { kind: "issue"; message: string };

function toCalendarDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError("Stored date is invalid");
  }
  return value.toISOString().slice(0, 10);
}

function fromCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function nextUtcCalendarDate(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("Generation time is invalid");
  }
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

export function getLocalCalendarDate(now: Date, timeZone: string): string {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("Generation time is invalid");
  }

  const formatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  if (!year || !month || !day || values.get("era") === "BC") {
    throw new RangeError("Unable to determine a calendar date for the timezone");
  }

  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isValidRuleAmount(amount: Prisma.Decimal): boolean {
  return (
    amount.greaterThan(0) &&
    amount.decimalPlaces() <= 2 &&
    amount.lessThanOrEqualTo(MAX_TRANSACTION_AMOUNT)
  );
}

function isValidRuleCategory(
  type: TransactionType,
  category: TransactionCategory,
): boolean {
  return categoriesByType[type].includes(category);
}

function isOccurrenceDateUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return (
      target.length === 2 &&
      target.includes("recurringTransactionId") &&
      target.includes("scheduledDate")
    );
  }

  return (
    target === "RecurringOccurrence_recurringTransactionId_scheduledDate_key"
  );
}

async function lockRule(
  tx: Prisma.TransactionClient,
  ruleId: string,
) {
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "RecurringTransaction"
    WHERE "id" = ${ruleId}
    FOR UPDATE
  `;
  if (lockedRows.length === 0) return null;

  return tx.recurringTransaction.findUnique({ where: { id: ruleId } });
}

async function deactivateRule(
  tx: Prisma.TransactionClient,
  ruleId: string,
): Promise<void> {
  await tx.recurringTransaction.update({
    where: { id: ruleId },
    data: { isActive: false },
  });
}

async function advanceRule(
  tx: Prisma.TransactionClient,
  ruleId: string,
  nextDate: string,
  endDate: string | null,
): Promise<"active" | "deactivated"> {
  const hasMoreAllowedDates = endDate === null || nextDate <= endDate;
  await tx.recurringTransaction.update({
    where: { id: ruleId },
    data: {
      nextRunDate: fromCalendarDate(nextDate),
      isActive: hasMoreAllowedDates,
    },
  });
  return hasMoreAllowedDates ? "active" : "deactivated";
}

async function processLockedRule(
  client: PrismaClient,
  ruleId: string,
  now: Date,
): Promise<RuleOutcome> {
  return client.$transaction(
    async (tx): Promise<RuleOutcome> => {
      const rule = await lockRule(tx, ruleId);
      if (!rule || !rule.isActive) return { kind: "unchanged" };

      let scheduledDate: string;
      let endDate: string | null;
      try {
        scheduledDate = toCalendarDate(rule.nextRunDate);
        endDate = rule.endDate === null ? null : toCalendarDate(rule.endDate);
      } catch (error) {
        if (error instanceof RangeError) {
          return {
            kind: "issue",
            message: `Invalid calendar date: ${error.message}`,
          };
        }
        throw error;
      }

      if (endDate !== null && scheduledDate > endDate) {
        await deactivateRule(tx, rule.id);
        return { kind: "deactivated" };
      }

      let localToday: string;
      try {
        localToday = getLocalCalendarDate(now, rule.timeZone);
      } catch (error) {
        if (error instanceof RangeError) {
          return { kind: "issue", message: `Invalid timezone: ${error.message}` };
        }
        throw error;
      }

      if (scheduledDate > localToday) return { kind: "unchanged" };

      let occurrenceIndex: number | null;
      try {
        occurrenceIndex = getRecurrenceIndex(
          toCalendarDate(rule.startDate),
          rule.frequency as RecurrenceFrequency,
          rule.interval,
          scheduledDate,
        );
      } catch (error) {
        if (error instanceof RangeError) {
          return { kind: "issue", message: `Invalid recurrence rule: ${error.message}` };
        }
        throw error;
      }
      if (occurrenceIndex === null) {
        return {
          kind: "issue",
          message: "nextRunDate is not on the anchored recurrence sequence",
        };
      }

      if (
        !isValidRuleAmount(rule.amount) ||
        !isValidRuleCategory(rule.type, rule.category)
      ) {
        return {
          kind: "issue",
          message: "Rule amount or transaction type/category is invalid",
        };
      }

      const existingOccurrence = await tx.recurringOccurrence.findUnique({
        where: {
          recurringTransactionId_scheduledDate: {
            recurringTransactionId: rule.id,
            scheduledDate: fromCalendarDate(scheduledDate),
          },
        },
        select: { id: true },
      });

      let nextDate: string;
      try {
        nextDate = getRecurrenceDate(
          toCalendarDate(rule.startDate),
          rule.frequency as RecurrenceFrequency,
          rule.interval,
          occurrenceIndex + 1,
        );
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;

        if (!existingOccurrence) {
          const transaction = await tx.transaction.create({
            data: {
              amount: rule.amount,
              type: rule.type,
              category: rule.category,
              description: rule.description,
              date: fromCalendarDate(scheduledDate),
              userId: rule.userId,
            },
          });
          await tx.recurringOccurrence.create({
            data: {
              recurringTransactionId: rule.id,
              scheduledDate: fromCalendarDate(scheduledDate),
              transactionId: transaction.id,
            },
          });
        }
        await deactivateRule(tx, rule.id);
        return { kind: "handled", deactivated: true };
      }

      if (!existingOccurrence) {
        const transaction = await tx.transaction.create({
          data: {
            amount: rule.amount,
            type: rule.type,
            category: rule.category,
            description: rule.description,
            date: fromCalendarDate(scheduledDate),
            userId: rule.userId,
          },
        });
        await tx.recurringOccurrence.create({
          data: {
            recurringTransactionId: rule.id,
            scheduledDate: fromCalendarDate(scheduledDate),
            transactionId: transaction.id,
          },
        });
      }

      const state = await advanceRule(tx, rule.id, nextDate, endDate);
      return { kind: "handled", deactivated: state === "deactivated" };
    },
    { maxWait: 5000, timeout: 10000 },
  ).catch(async (error: unknown) => {
    if (!isOccurrenceDateUniqueConflict(error)) throw error;

    const recovered = await client.$transaction(
      async (tx) => {
        const rule = await lockRule(tx, ruleId);
        if (!rule || !rule.isActive) return null;

        let localToday: string;
        let scheduledDate: string;
        let endDate: string | null;
        try {
          localToday = getLocalCalendarDate(now, rule.timeZone);
          scheduledDate = toCalendarDate(rule.nextRunDate);
          endDate = rule.endDate === null ? null : toCalendarDate(rule.endDate);
        } catch (dateError) {
          if (dateError instanceof RangeError) return null;
          throw dateError;
        }
        if (scheduledDate > localToday || (endDate !== null && scheduledDate > endDate)) {
          return null;
        }

        let index: number | null;
        try {
          index = getRecurrenceIndex(
            toCalendarDate(rule.startDate),
            rule.frequency as RecurrenceFrequency,
            rule.interval,
            scheduledDate,
          );
        } catch (dateError) {
          if (dateError instanceof RangeError) return null;
          throw dateError;
        }
        if (index === null) return null;

        const occurrence = await tx.recurringOccurrence.findUnique({
          where: {
            recurringTransactionId_scheduledDate: {
              recurringTransactionId: rule.id,
              scheduledDate: fromCalendarDate(scheduledDate),
            },
          },
          select: { id: true },
        });
        if (!occurrence) return null;

        let nextDate: string;
        try {
          nextDate = getRecurrenceDate(
            toCalendarDate(rule.startDate),
            rule.frequency as RecurrenceFrequency,
            rule.interval,
            index + 1,
          );
        } catch (dateError) {
          if (!(dateError instanceof RangeError)) throw dateError;
          await deactivateRule(tx, rule.id);
          return { deactivated: true };
        }
        const state = await advanceRule(tx, rule.id, nextDate, endDate);
        return { deactivated: state === "deactivated" };
      },
      { maxWait: 5000, timeout: 10000 },
    );
    if (recovered === null) throw error;
    return { kind: "handled", deactivated: recovered.deactivated } as const;
  });
}

export async function generateRecurringTransactionsPass(
  client: PrismaClient,
  now: Date = new Date(),
  startingCursor?: string | null,
): Promise<GenerationPassResult> {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("Generation time is invalid");
  }

  const result: GenerationPassResult = {
    handledDates: 0,
    deactivatedRules: 0,
    issues: [],
    continuationCursor: startingCursor ?? null,
  };
  const dueBefore = nextUtcCalendarDate(now);
  const pendingRuleIds: string[] = [];
  let pageCursor = startingCursor ?? undefined;

  const recordOutcome = (ruleId: string, outcome: RuleOutcome): boolean => {
    result.continuationCursor = ruleId;
    if (outcome.kind === "handled") {
      result.handledDates += 1;
      if (outcome.deactivated) result.deactivatedRules += 1;
      return !outcome.deactivated;
    }
    if (outcome.kind === "deactivated") {
      result.deactivatedRules += 1;
    } else if (outcome.kind === "issue") {
      result.issues.push({ ruleId, message: outcome.message });
    }
    return false;
  };

  const scanRange = async (
    range: "after-start" | "wrap" | "all",
  ): Promise<void> => {
    pageCursor = range === "after-start" ? startingCursor ?? undefined : undefined;

    while (result.handledDates < MAX_HANDLED_DATES_PER_PASS) {
      const idFilters: Prisma.RecurringTransactionWhereInput[] = [];
      const afterId = pageCursor ?? (range === "after-start" ? startingCursor : undefined);
      if (afterId !== undefined && afterId !== null) {
        idFilters.push({ id: { gt: afterId } });
      }
      if (range === "wrap" && startingCursor !== undefined && startingCursor !== null) {
        idFilters.push({ id: { lte: startingCursor } });
      }
      const candidates = await client.recurringTransaction.findMany({
        where: {
          isActive: true,
          OR: [
            { nextRunDate: { lte: dueBefore } },
            { endDate: { not: null } },
          ],
          ...(idFilters.length > 0 ? { AND: idFilters } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: RULE_BATCH_SIZE,
      });
      if (candidates.length === 0) break;

      for (const candidate of candidates) {
        pageCursor = candidate.id;
        result.continuationCursor = candidate.id;
        const outcome = await processLockedRule(client, candidate.id, now);
        if (recordOutcome(candidate.id, outcome)) {
          pendingRuleIds.push(candidate.id);
        }
        if (result.handledDates >= MAX_HANDLED_DATES_PER_PASS) break;
      }
      if (candidates.length < RULE_BATCH_SIZE) break;
    }
  };

  if (startingCursor !== undefined && startingCursor !== null) {
    await scanRange("after-start");
    if (result.handledDates < MAX_HANDLED_DATES_PER_PASS) {
      await scanRange("wrap");
    }
  } else {
    await scanRange("all");
  }

  for (let index = 0; index < pendingRuleIds.length; index += 1) {
    if (result.handledDates >= MAX_HANDLED_DATES_PER_PASS) break;
    const ruleId = pendingRuleIds[index];
    if (ruleId === undefined) continue;
    const outcome = await processLockedRule(client, ruleId, now);
    if (recordOutcome(ruleId, outcome)) pendingRuleIds.push(ruleId);
  }

  return result;
}
