import { BudgetCategory, Prisma } from "@prisma/client";
import { Router, type Response } from "express";
import prisma from "../prisma.js";
import {
  authenticateToken,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const router = Router();
const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const budgetCategories = Object.values(BudgetCategory);
const millisecondsPerDay = 24 * 60 * 60 * 1000;

type BudgetRecord = {
  id: string;
  month: string;
  category: BudgetCategory;
  limit: Prisma.Decimal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBudgetCategory(value: unknown): value is BudgetCategory {
  return (
    typeof value === "string" &&
    budgetCategories.some((category) => category === value)
  );
}

function parseMonth(value: unknown): { year: number; month: number } | null {
  if (typeof value !== "string") return null;
  const match = monthPattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  if (year === 0) return null;

  return { year, month: Number(match[2]) };
}

function createTimeZoneFormatter(value: unknown): Intl.DateTimeFormat | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: value,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      era: "short",
    });
    const resolvedTimeZone = formatter.resolvedOptions().timeZone;
    if (/^(?:[+-]\d{2}|GMT[+-])/i.test(resolvedTimeZone)) return null;
    return formatter;
  } catch {
    return null;
  }
}

function getLocalDateOrdinal(
  timestamp: number,
  formatter: Intl.DateTimeFormat,
): number {
  const parts = formatter.formatToParts(new Date(timestamp));
  const getPart = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`Missing ${type} date component`);
    return value;
  };

  const yearOfEra = Number(getPart("year"));
  const year = getPart("era") === "BC" ? 1 - yearOfEra : yearOfEra;
  const localDate = new Date(0);
  localDate.setUTCFullYear(year, Number(getPart("month")) - 1, Number(getPart("day")));
  localDate.setUTCHours(0, 0, 0, 0);
  return localDate.getTime();
}

function getLocalMonthStart(
  year: number,
  month: number,
  formatter: Intl.DateTimeFormat,
): Date {
  const utcMidnight = new Date(0);
  utcMidnight.setUTCFullYear(year, month - 1, 1);
  utcMidnight.setUTCHours(0, 0, 0, 0);

  const targetDate = utcMidnight.getTime();
  let before = utcMidnight.getTime() - 3 * millisecondsPerDay;
  let after = utcMidnight.getTime() + 3 * millisecondsPerDay;

  if (
    getLocalDateOrdinal(before, formatter) >= targetDate ||
    getLocalDateOrdinal(after, formatter) < targetDate
  ) {
    throw new RangeError("Unable to determine local month boundary");
  }

  while (after - before > 1) {
    const midpoint = before + Math.floor((after - before) / 2);
    if (getLocalDateOrdinal(midpoint, formatter) >= targetDate) {
      after = midpoint;
    } else {
      before = midpoint;
    }
  }

  return new Date(after);
}

function getLocalMonthRange(
  month: { year: number; month: number },
  formatter: Intl.DateTimeFormat,
): { start: Date; end: Date } {
  const nextMonth =
    month.month === 12
      ? { year: month.year + 1, month: 1 }
      : { year: month.year, month: month.month + 1 };

  return {
    start: getLocalMonthStart(month.year, month.month, formatter),
    end: getLocalMonthStart(nextMonth.year, nextMonth.month, formatter),
  };
}

function getSpendingStatus(
  spent: Prisma.Decimal,
  limit: Prisma.Decimal,
): "On track" | "Close to limit" | "Over budget" {
  if (spent.greaterThanOrEqualTo(limit)) return "Over budget";
  if (spent.greaterThanOrEqualTo(limit.mul("0.8"))) return "Close to limit";
  return "On track";
}

function serializeBudget(budget: BudgetRecord, spent: Prisma.Decimal) {
  const remaining = budget.limit.minus(spent);
  return {
    id: budget.id,
    month: budget.month,
    category: budget.category,
    limit: budget.limit.toString(),
    spent: spent.toString(),
    remaining: remaining.toString(),
    status: getSpendingStatus(spent, budget.limit),
  };
}

router.get(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const month = parseMonth(req.query.month);
    if (!month) {
      return res.status(400).json({
        success: false,
        message: "Month must be a valid YYYY-MM value",
      });
    }

    const formatter = createTimeZoneFormatter(req.query.timeZone);
    if (!formatter) {
      return res.status(400).json({
        success: false,
        message: "A valid IANA time zone is required",
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    try {
      const monthKey = `${String(month.year).padStart(4, "0")}-${String(month.month).padStart(2, "0")}`;
      const { start, end } = getLocalMonthRange(month, formatter);
      const budgets = await prisma.budget.findMany({
        where: { userId, month: monthKey },
        orderBy: { category: "asc" },
        select: {
          id: true,
          month: true,
          category: true,
          limit: true,
        },
      });

      if (budgets.length === 0) {
        return res.status(200).json({
          success: true,
          month: monthKey,
          budgets: [],
        });
      }

      const spendingByCategory = await prisma.transaction.groupBy({
        by: ["category"],
        where: {
          userId,
          type: "EXPENSE",
          category: { in: budgets.map((budget) => budget.category) },
          date: { gte: start, lt: end },
        },
        _sum: { amount: true },
      });
      const spending = new Map(
        spendingByCategory.map((group) => [
          group.category,
          group._sum.amount ?? new Prisma.Decimal(0),
        ]),
      );

      return res.status(200).json({
        success: true,
        month: monthKey,
        budgets: budgets.map((budget) =>
          serializeBudget(
            budget,
            spending.get(budget.category) ?? new Prisma.Decimal(0),
          ),
        ),
      });
    } catch (error) {
      console.error("Get budgets error:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

router.put(
  "/",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    const body: unknown = req.body;
    if (!isRecord(body)) {
      return res.status(400).json({
        success: false,
        message: "A valid budget body is required",
      });
    }

    const month = parseMonth(body.month);
    if (!month) {
      return res.status(400).json({
        success: false,
        message: "Month must be a valid YYYY-MM value",
      });
    }

    const formatter = createTimeZoneFormatter(body.timeZone);
    if (!formatter) {
      return res.status(400).json({
        success: false,
        message: "A valid IANA time zone is required",
      });
    }

    if (!isBudgetCategory(body.category)) {
      return res.status(400).json({
        success: false,
        message: "Category must be a valid expense budget category",
      });
    }

    if (
      typeof body.limit !== "number" ||
      !Number.isFinite(body.limit) ||
      body.limit <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Limit must be a positive finite number",
      });
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    try {
      const monthKey = `${String(month.year).padStart(4, "0")}-${String(month.month).padStart(2, "0")}`;
      const { start, end } = getLocalMonthRange(month, formatter);
      const limit = new Prisma.Decimal(body.limit);
      const budget = await prisma.budget.upsert({
        where: {
          userId_month_category: {
            userId,
            month: monthKey,
            category: body.category,
          },
        },
        create: {
          userId,
          month: monthKey,
          category: body.category,
          limit,
        },
        update: { limit },
        select: {
          id: true,
          month: true,
          category: true,
          limit: true,
        },
      });
      const spending = await prisma.transaction.aggregate({
        where: {
          userId,
          type: "EXPENSE",
          category: budget.category,
          date: { gte: start, lt: end },
        },
        _sum: { amount: true },
      });

      return res.status(200).json({
        success: true,
        budget: serializeBudget(
          budget,
          spending._sum.amount ?? new Prisma.Decimal(0),
        ),
      });
    } catch (error) {
      console.error("Upsert budget error:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong",
      });
    }
  },
);

export default router;
