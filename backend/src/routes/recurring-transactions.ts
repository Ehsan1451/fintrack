import {
  Prisma,
  type RecurrenceFrequency,
  type TransactionCategory,
  type TransactionType,
} from "@prisma/client";
import { Router, type RequestHandler, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import prisma from "../prisma.js";
import {
  authenticateToken,
  type AuthenticatedRequest,
} from "../middleware/auth.js";
import {
  parseRecurringTransactionCreate,
  parseRecurringTransactionPatch,
  serializeRecurringDate,
  validateRecurringTransactionForReactivation,
  validateRecurringTransactionSchedule,
  type RecurringTransactionInput,
  type RecurringTransactionPatch,
} from "../utils/recurring-transaction-validation.js";

const scheduleFields = [
  "type",
  "category",
  "frequency",
  "interval",
  "startDate",
  "endDate",
  "timeZone",
] as const;

function getUserId(req: AuthenticatedRequest, res: Response): string | null {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    });
    return null;
  }
  return userId;
}

function getRuleId(req: AuthenticatedRequest): string | null {
  const param = req.params.id;
  const id = Array.isArray(param) ? param[0] : param;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function serializeRule(rule: {
  id: string;
  amount: Prisma.Decimal;
  type: TransactionType;
  category: TransactionCategory;
  description: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: Date;
  nextRunDate: Date;
  endDate: Date | null;
  timeZone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { occurrences: number };
}, hasGeneratedOccurrences = rule._count?.occurrences !== undefined
  ? rule._count.occurrences > 0
  : false, now: Date = new Date(), cursorIsUnoccupied = true) {
  const ruleFields = { ...rule };
  delete ruleFields._count;
  const endDate = rule.endDate ? serializeRecurringDate(rule.endDate) : null;
  const storedNextRunDate = serializeRecurringDate(rule.nextRunDate);
  const scheduleEnded =
    endDate !== null && storedNextRunDate > endDate;
  return {
    ...ruleFields,
    amount: rule.amount.toString(),
    startDate: serializeRecurringDate(rule.startDate),
    nextRunDate: scheduleEnded ? null : storedNextRunDate,
    endDate,
    hasGeneratedOccurrences,
    canReactivate:
      !rule.isActive &&
      cursorIsUnoccupied &&
      validateRecurringTransactionForReactivation(rule, now) === null,
  };
}

function validateCompleteRule(
  input: Pick<RecurringTransactionInput, "type" | "category" | "startDate" | "endDate">,
  res: Response,
): boolean {
  const message = validateRecurringTransactionSchedule(input);
  if (!message) return true;
  res.status(400).json({ success: false, message });
  return false;
}

export function createRecurringTransactionsRouter(
  db: PrismaClient = prisma,
  authenticate: RequestHandler = authenticateToken,
  getNow: () => Date = () => new Date(),
): Router {
const router = Router();

router.get(
  "/",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    try {
      const now = getNow();
      const rules = await db.recurringTransaction.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { _count: { select: { occurrences: true } } },
      });
      const eligibleRules = rules.filter(
        (rule) =>
          !rule.isActive &&
          validateRecurringTransactionForReactivation(rule, now) === null,
      );
      const occupiedCursorRuleIds = new Set<string>();
      for (let offset = 0; offset < eligibleRules.length; offset += 100) {
        const cursorRules = eligibleRules.slice(offset, offset + 100);
        const occurrences = await db.recurringOccurrence.findMany({
          where: {
            OR: cursorRules.map((rule) => ({
              recurringTransactionId: rule.id,
              scheduledDate: rule.nextRunDate,
            })),
          },
          select: { recurringTransactionId: true },
        });
        for (const occurrence of occurrences) {
          occupiedCursorRuleIds.add(occurrence.recurringTransactionId);
        }
      }
      return res.status(200).json({
        success: true,
        recurringTransactions: rules.map((rule) =>
          serializeRule(
            rule,
            (rule._count?.occurrences ?? 0) > 0,
            now,
            !occupiedCursorRuleIds.has(rule.id),
          ),
        ),
      });
    } catch {
      console.error("Get recurring transactions failed");
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

router.post(
  "/",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const parsed = parseRecurringTransactionCreate(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.message,
      });
    }
    if (!validateCompleteRule(parsed.value, res)) return;

    try {
      const rule = await db.recurringTransaction.create({
        data: {
          userId,
          ...parsed.value,
          nextRunDate: parsed.value.startDate,
        },
      });
      return res.status(201).json({
        success: true,
        recurringTransaction: serializeRule(rule, false, getNow()),
      });
    } catch {
      console.error("Create recurring transaction failed");
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

router.patch(
  "/:id",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const ruleId = getRuleId(req);
    if (!ruleId) {
      return res.status(400).json({
        success: false,
        message: "Recurring transaction ID is required",
      });
    }

    const parsed = parseRecurringTransactionPatch(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.message,
      });
    }
    const patch = parsed.value;
    const scheduleChanged = scheduleFields.some((field) =>
      Object.hasOwn(patch, field),
    );

    try {
      const updatedRule = await db.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "RecurringTransaction"
          WHERE "id" = ${ruleId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        if (lockedRows.length === 0) return { kind: "not-found" as const };

        const current = await tx.recurringTransaction.findFirst({
          where: { id: ruleId, userId },
        });
        if (!current) return { kind: "not-found" as const };
        if (!current.isActive) return { kind: "inactive" as const };

        const occurrenceCount = await tx.recurringOccurrence.count({
          where: { recurringTransactionId: ruleId },
        });
        if (occurrenceCount > 0) return { kind: "has-occurrences" as const };

        const nextType = patch.type ?? current.type;
        const nextCategory = patch.category ?? current.category;
        const nextStartDate = patch.startDate ?? current.startDate;
        const nextEndDate =
          patch.endDate === undefined ? current.endDate : patch.endDate;
        const scheduleError = validateRecurringTransactionSchedule({
          type: nextType,
          category: nextCategory,
          startDate: nextStartDate,
          endDate: nextEndDate,
        });
        if (scheduleError) return { kind: "invalid-schedule" as const };

        const data: Prisma.RecurringTransactionUpdateInput = {
          ...patch,
          ...(scheduleChanged ? { nextRunDate: nextStartDate } : {}),
        };
        const rule = await tx.recurringTransaction.update({
          where: { id: ruleId },
          data,
        });
        return { kind: "updated" as const, rule };
      });

      if (updatedRule.kind === "not-found") {
        return res.status(404).json({
          success: false,
          message: "Recurring transaction not found",
        });
      }
      if (updatedRule.kind === "inactive") {
        return res.status(409).json({
          success: false,
          message: "Inactive recurring transactions cannot be updated",
        });
      }
      if (updatedRule.kind === "has-occurrences") {
        return res.status(409).json({
          success: false,
          message: "Recurring transactions with generated occurrences cannot be updated",
        });
      }
      if (updatedRule.kind === "invalid-schedule") {
        return res.status(400).json({
          success: false,
          message: "Category must match the transaction type and endDate cannot precede startDate",
        });
      }
      return res.status(200).json({
        success: true,
        recurringTransaction: serializeRule(updatedRule.rule),
      });
    } catch {
      console.error("Update recurring transaction failed");
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

router.post(
  "/:id/reactivate",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const ruleId = getRuleId(req);
    if (!ruleId) {
      return res.status(400).json({
        success: false,
        message: "Recurring transaction ID is required",
      });
    }

    try {
      const result = await db.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "RecurringTransaction"
          WHERE "id" = ${ruleId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        if (lockedRows.length === 0) return { kind: "not-found" as const };

        const rule = await tx.recurringTransaction.findFirst({
          where: { id: ruleId, userId },
        });
        if (!rule) return { kind: "not-found" as const };
        const occurrenceCount = await tx.recurringOccurrence.count({
          where: { recurringTransactionId: ruleId },
        });
        if (rule.isActive) {
          return {
            kind: "already-active" as const,
            rule,
            hasGeneratedOccurrences: occurrenceCount > 0,
          };
        }

        const scheduleError =
          validateRecurringTransactionForReactivation(rule, getNow());
        if (scheduleError) {
          return { kind: "invalid-schedule" as const, message: scheduleError };
        }

        const cursorOccurrence = await tx.recurringOccurrence.findUnique({
          where: {
            recurringTransactionId_scheduledDate: {
              recurringTransactionId: ruleId,
              scheduledDate: rule.nextRunDate,
            },
          },
          select: { id: true },
        });
        if (cursorOccurrence) return { kind: "cursor-occupied" as const };

        const reactivatedRule = await tx.recurringTransaction.update({
          where: { id: ruleId, userId },
          data: { isActive: true },
        });
        return {
          kind: "reactivated" as const,
          rule: reactivatedRule,
          hasGeneratedOccurrences: occurrenceCount > 0,
        };
      });

      if (result.kind === "not-found") {
        return res.status(404).json({
          success: false,
          message: "Recurring transaction not found",
        });
      }
      if (result.kind === "invalid-schedule") {
        return res.status(409).json({
          success: false,
          message: `Recurring transaction cannot be reactivated: ${result.message}`,
        });
      }
      if (result.kind === "cursor-occupied") {
        return res.status(409).json({
          success: false,
          message: "The next scheduled date already has an occurrence; the rule remains inactive",
        });
      }
      return res.status(200).json({
        success: true,
        recurringTransaction: serializeRule(
          result.rule,
          "hasGeneratedOccurrences" in result
            ? result.hasGeneratedOccurrences
            : false,
          getNow(),
        ),
        ...(result.kind === "already-active"
          ? { message: "Recurring transaction is already active" }
          : {}),
      });
    } catch {
      console.error("Reactivate recurring transaction failed");
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

router.delete(
  "/:id/permanent",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const ruleId = getRuleId(req);
    if (!ruleId) {
      return res.status(400).json({
        success: false,
        message: "Recurring transaction ID is required",
      });
    }

    try {
      const result = await db.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "RecurringTransaction"
          WHERE "id" = ${ruleId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        if (lockedRows.length === 0) return { kind: "not-found" as const };

        const rule = await tx.recurringTransaction.findFirst({
          where: { id: ruleId, userId },
          select: { id: true, isActive: true },
        });
        if (!rule) return { kind: "not-found" as const };
        if (rule.isActive) return { kind: "active" as const };

        const occurrenceCount = await tx.recurringOccurrence.count({
          where: { recurringTransactionId: ruleId },
        });
        if (occurrenceCount > 0) return { kind: "has-occurrences" as const };

        const deleted = await tx.recurringTransaction.deleteMany({
          where: { id: ruleId, userId, isActive: false },
        });
        return deleted.count === 1
          ? { kind: "deleted" as const }
          : { kind: "not-found" as const };
      });

      if (result.kind === "not-found") {
        return res.status(404).json({
          success: false,
          message: "Recurring transaction not found",
        });
      }
      if (result.kind === "active") {
        return res.status(409).json({
          success: false,
          message: "Deactivate the recurring transaction before permanently deleting it",
        });
      }
      if (result.kind === "has-occurrences") {
        return res.status(409).json({
          success: false,
          message: "This rule has generated occurrences and cannot be permanently deleted; it remains inactive",
        });
      }
      return res.status(200).json({
        success: true,
        message: "Recurring transaction permanently deleted",
      });
    } catch {
      console.error("Permanently delete recurring transaction failed");
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

router.delete(
  "/:id",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const ruleId = getRuleId(req);
    if (!ruleId) {
      return res.status(400).json({
        success: false,
        message: "Recurring transaction ID is required",
      });
    }

    try {
      const result = await db.recurringTransaction.updateMany({
        where: { id: ruleId, userId },
        data: { isActive: false },
      });
      if (result.count === 0) {
        return res.status(404).json({
          success: false,
          message: "Recurring transaction not found",
        });
      }
      return res.status(200).json({
        success: true,
        message: "Recurring transaction deactivated",
      });
    } catch {
      console.error("Deactivate recurring transaction failed");
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

return router;
}

export default createRecurringTransactionsRouter();
