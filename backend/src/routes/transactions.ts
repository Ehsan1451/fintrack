
import { Router, type RequestHandler, type Response } from "express";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import prisma from "../prisma.js";
import {
  authenticateToken,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

type TransactionType = "INCOME" | "EXPENSE";

const incomeCategories = ["SALARY", "FREELANCE", "GIFT", "OTHER_INCOME"] as const;
const expenseCategories = [
  "FOOD",
  "TRANSPORT",
  "HOUSING",
  "SHOPPING",
  "ENTERTAINMENT",
  "BILLS",
  "EDUCATION",
  "HEALTH",
  "OTHER_EXPENSE",
] as const;

type TransactionCategory =
  | (typeof incomeCategories)[number]
  | (typeof expenseCategories)[number];

type ReportTransaction = {
  date: Date;
  type: TransactionType;
  category: TransactionCategory;
  amount: Prisma.Decimal;
  description: string | null;
};

const categoriesByType: Record<TransactionType, readonly TransactionCategory[]> = {
  INCOME: incomeCategories,
  EXPENSE: expenseCategories,
};

const reportDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const maxReportRangeDays = 366 * 5;

function parseReportDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = reportDatePattern.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9998 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10) === value ? value : null;
}

function createReportTimeZoneFormatter(value: unknown): Intl.DateTimeFormat | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
      timeZone: value,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const resolvedTimeZone = formatter.resolvedOptions().timeZone;
    return /^(?:[+-]\d{2}|GMT[+-])/i.test(resolvedTimeZone) ? null : formatter;
  } catch {
    return null;
  }
}

function getLocalDateOrdinal(timestamp: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new RangeError("Unable to determine local date");
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function getZonedDayStart(
  date: string,
  formatter: Intl.DateTimeFormat,
  allowSkippedDate = false,
): Date {
  const target = new Date(`${date}T00:00:00.000Z`).getTime();
  let before = target - 36 * 60 * 60 * 1000;
  let after = target + 36 * 60 * 60 * 1000;
  if (
    getLocalDateOrdinal(before, formatter) >= target ||
    getLocalDateOrdinal(after, formatter) < target
  ) {
    throw new RangeError("Unable to determine local date boundary");
  }
  while (after - before > 1) {
    const midpoint = before + Math.floor((after - before) / 2);
    if (getLocalDateOrdinal(midpoint, formatter) >= target) after = midpoint;
    else before = midpoint;
  }
  const actualDate = getLocalDateOrdinal(after, formatter);
  if (actualDate !== target && !(allowSkippedDate && actualDate > target)) {
    throw new RangeError("The requested date does not exist in this time zone");
  }
  return new Date(after);
}

function getReportWindow(query: {
  from?: unknown;
  to?: unknown;
  timeZone?: unknown;
}) {
  const from = parseReportDate(query.from);
  const to = parseReportDate(query.to);
  const formatter = createReportTimeZoneFormatter(query.timeZone);
  if (!from || !to || from > to || !formatter) return null;
  const startOrdinal = new Date(`${from}T00:00:00.000Z`).getTime();
  const endOrdinal = new Date(`${to}T00:00:00.000Z`).getTime();
  if ((endOrdinal - startOrdinal) / 86_400_000 > maxReportRangeDays) return null;
  const afterTo = new Date(endOrdinal);
  afterTo.setUTCDate(afterTo.getUTCDate() + 1);
  const nextDate = afterTo.toISOString().slice(0, 10);
  try {
    return {
      from,
      to,
      formatter,
      start: getZonedDayStart(from, formatter),
      end: getZonedDayStart(nextDate, formatter, true),
    };
  } catch {
    return null;
  }
}

function getLocalMonthKey(date: Date, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new RangeError("Unable to determine local month");
  return `${year}-${month}`;
}

function monthKeysBetween(from: string, to: string): string[] {
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));
  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));
  const result: string[] = [];
  for (let value = fromYear * 12 + fromMonth - 1; value <= toYear * 12 + toMonth - 1; value += 1) {
    result.push(`${String(Math.floor(value / 12)).padStart(4, "0")}-${String(value % 12 + 1).padStart(2, "0")}`);
  }
  return result;
}

function csvCell(value: string): string {
  const safe = /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function serializeReportCsv(transactions: ReportTransaction[]): string {
  const header = ["Date (UTC)", "Type", "Category", "Description", "Amount (EUR)"];
  const rows = transactions.map((transaction) => [
    transaction.date.toISOString(),
    transaction.type,
    transaction.category,
    transaction.description ?? "",
    transaction.amount.toString(),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function isTransactionType(value: unknown): value is TransactionType {
  return value === "INCOME" || value === "EXPENSE";
}

function isExpenseCategory(
  value: TransactionCategory,
): value is (typeof expenseCategories)[number] {
  return expenseCategories.some((category) => category === value);
}

function isCategoryForType(type: unknown, category: unknown): category is TransactionCategory {
  return (
    isTransactionType(type) &&
    typeof category === "string" &&
    categoriesByType[type].some((allowedCategory) => allowedCategory === category)
  );
}

export function createTransactionsRouter(
  db: PrismaClient = prisma,
  authenticate: RequestHandler = authenticateToken,
): Router {
  const router = Router();

  router.get(
    "/reports",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }

        const window = getReportWindow({
          from: req.query.from,
          to: req.query.to,
          timeZone: req.query.timeZone,
        });
        if (!window) {
          return res.status(400).json({
            success: false,
            message: "Provide a valid date range and IANA time zone (maximum 5 years)",
          });
        }

        const transactions = await db.transaction.findMany({
          where: {
            userId,
            date: { gte: window.start, lt: window.end },
          },
          orderBy: { date: "asc" },
          select: {
            date: true,
            type: true,
            category: true,
            amount: true,
            description: true,
          },
        });

        const zero = () => new Prisma.Decimal(0);
        const monthly = new Map(
          monthKeysBetween(window.from, window.to).map((month) => [
            month,
            { income: zero(), expenses: zero() },
          ]),
        );
        const expensesByCategory = new Map(
          expenseCategories.map((category) => [category, zero()]),
        );
        let totalIncome = zero();
        let totalExpenses = zero();

        for (const transaction of transactions) {
          if (transaction.type === "INCOME") {
            totalIncome = totalIncome.plus(transaction.amount);
            const month = getLocalMonthKey(transaction.date, window.formatter);
            const totals = monthly.get(month);
            if (totals) totals.income = totals.income.plus(transaction.amount);
          } else {
            totalExpenses = totalExpenses.plus(transaction.amount);
            const month = getLocalMonthKey(transaction.date, window.formatter);
            const totals = monthly.get(month);
            if (totals) totals.expenses = totals.expenses.plus(transaction.amount);
            if (isExpenseCategory(transaction.category)) {
              const category = expensesByCategory.get(transaction.category);
              if (category !== undefined) {
                expensesByCategory.set(
                  transaction.category,
                  category.plus(transaction.amount),
                );
              }
            }
          }
        }

        return res.status(200).json({
          success: true,
          data: {
            from: window.from,
            to: window.to,
            timeZone: window.formatter.resolvedOptions().timeZone,
            totalIncome: totalIncome.toString(),
            totalExpenses: totalExpenses.toString(),
            netCashFlow: totalIncome.minus(totalExpenses).toString(),
            transactionCount: transactions.length,
            monthly: Array.from(monthly, ([month, totals]) => ({
              month,
              income: totals.income.toString(),
              expenses: totals.expenses.toString(),
            })),
            expensesByCategory: expenseCategories.map((category) => {
              const total = expensesByCategory.get(category) ?? zero();
              return {
                category,
                total: total.toString(),
                share: totalExpenses.isZero()
                  ? "0"
                  : total.dividedBy(totalExpenses).times(100).toString(),
              };
            }),
          },
        });
      } catch (error) {
        console.error("Get financial report error:", error);
        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    },
  );

  router.get(
    "/reports/export",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;
        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }
        const window = getReportWindow({
          from: req.query.from,
          to: req.query.to,
          timeZone: req.query.timeZone,
        });
        if (!window) {
          return res.status(400).json({
            success: false,
            message: "Provide a valid date range and IANA time zone (maximum 5 years)",
          });
        }

        const transactions = await db.transaction.findMany({
          where: {
            userId,
            date: { gte: window.start, lt: window.end },
          },
          orderBy: { date: "asc" },
          select: {
            date: true,
            type: true,
            category: true,
            amount: true,
            description: true,
          },
        });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="fintrack-report.csv"',
        );
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).send(serializeReportCsv(transactions));
      } catch (error) {
        console.error("Export financial report error:", error);
        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    },
  );

  router.get(
    "/summary",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }

        const groupedTransactions = await db.transaction.groupBy({
          by: ["type", "category"],
          where: { userId },
          _sum: { amount: true },
          _count: { _all: true },
        });

        let totalIncome = new Prisma.Decimal(0);
        let totalExpenses = new Prisma.Decimal(0);
        let transactionCount = 0;
        const incomeByCategory: { category: string; total: number }[] = [];
        const expensesByCategory: { category: string; total: number }[] = [];

        for (const group of groupedTransactions) {
          const categoryTotal = group._sum.amount ?? new Prisma.Decimal(0);
          transactionCount += group._count._all;

          if (group.type === "INCOME") {
            totalIncome = totalIncome.plus(categoryTotal);
            incomeByCategory.push({
              category: group.category,
              total: categoryTotal.toNumber(),
            });
          } else {
            totalExpenses = totalExpenses.plus(categoryTotal);
            expensesByCategory.push({
              category: group.category,
              total: categoryTotal.toNumber(),
            });
          }
        }

        return res.status(200).json({
          success: true,
          data: {
            totalIncome: totalIncome.toNumber(),
            totalExpenses: totalExpenses.toNumber(),
            balance: totalIncome.minus(totalExpenses).toNumber(),
            transactionCount,
            incomeByCategory,
            expensesByCategory,
          },
        });
      } catch (error) {
        console.error("Get transaction summary error:", error);

        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    }
  );

  router.get(
    "/trends",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }

        const transactions = await db.transaction.findMany({
          where: { userId },
          orderBy: { date: "asc" },
          select: {
            date: true,
            type: true,
            amount: true,
          },
        });

        const totalsByDate = new Map<
          string,
          { income: Prisma.Decimal; expenses: Prisma.Decimal }
        >();

        for (const transaction of transactions) {
          const date = transaction.date.toISOString().slice(0, 10);
          let totals = totalsByDate.get(date);

          if (!totals) {
            totals = {
              income: new Prisma.Decimal(0),
              expenses: new Prisma.Decimal(0),
            };
            totalsByDate.set(date, totals);
          }

          if (transaction.type === "INCOME") {
            totals.income = totals.income.plus(transaction.amount);
          } else {
            totals.expenses = totals.expenses.plus(transaction.amount);
          }
        }

        const data = Array.from(totalsByDate, ([date, totals]) => ({
          date,
          income: totals.income.toNumber(),
          expenses: totals.expenses.toNumber(),
        })).sort((first, second) => first.date.localeCompare(second.date));

        return res.status(200).json({
          success: true,
          data,
        });
      } catch (error) {
        console.error("Get transaction trends error:", error);

        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    }
  );

  router.get(
    "/",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }

        const transactions = await db.transaction.findMany({
          where: {
            userId,
          },
          orderBy: {
            date: "desc",
          },
          select: {
            id: true,
            amount: true,
            type: true,
            category: true,
            description: true,
            date: true,
            createdAt: true,
            updatedAt: true,
            userId: true,
          },
        });

        return res.status(200).json({
          success: true,
          transactions,
        });
      } catch (error) {
        console.error("Get transactions error:", error);

        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    }
  );

  router.post(
    "/",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }

        const body: unknown = req.body;
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return res.status(400).json({
            success: false,
            message: "A valid transaction body is required",
          });
        }

        const { amount, type, category, description, date } = body as Record<string, unknown>;

        if (amount === undefined || amount === null || amount === "") {
          return res.status(400).json({
            success: false,
            message: "Amount is required",
          });
        }

        const numericAmount = Number(amount);

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({
            success: false,
            message: "Amount must be a positive number",
          });
        }

        if (!isTransactionType(type)) {
          return res.status(400).json({
            success: false,
            message: "Type must be INCOME or EXPENSE",
          });
        }

        if (!isCategoryForType(type, category)) {
          return res.status(400).json({
            success: false,
            message: "Category must be valid for the selected transaction type",
          });
        }

        if (description !== undefined && description !== null && typeof description !== "string") {
          return res.status(400).json({
            success: false,
            message: "Description must be a string",
          });
        }

        let parsedDate: Date | undefined;
        if (date !== undefined) {
          if (typeof date !== "string") {
            return res.status(400).json({
              success: false,
              message: "Invalid date",
            });
          }

          parsedDate = new Date(date);

          if (Number.isNaN(parsedDate.getTime())) {
            return res.status(400).json({
              success: false,
              message: "Invalid date",
            });
          }
        }

        const transaction = await db.transaction.create({
          data: {
            amount: numericAmount,
            type,
            category,
            description: typeof description === "string" ? description.trim() || null : null,
            date: parsedDate ?? new Date(),
            userId,
          },
          select: {
            id: true,
            amount: true,
            type: true,
            category: true,
            description: true,
            date: true,
            createdAt: true,
            updatedAt: true,
            userId: true,
          },
        });

        return res.status(201).json({
          success: true,
          message: "Transaction created successfully",
          transaction,
        });
      } catch (error) {
        console.error("Create transaction error:", error);

        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    }
  );

  router.put(
    "/:id",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }

        const transactionParam = req.params.id;
        const transactionId = Array.isArray(transactionParam)
          ? transactionParam[0]
          : transactionParam;
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: "Transaction ID is required",
          });
        }

        const body: unknown = req.body;
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return res.status(400).json({
            success: false,
            message: "A valid transaction body is required",
          });
        }

        const { amount, type, category, description, date } = body as Record<string, unknown>;

        if (amount === undefined || amount === null || amount === "") {
          return res.status(400).json({
            success: false,
            message: "Amount is required",
          });
        }

        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({
            success: false,
            message: "Amount must be a positive number",
          });
        }

        if (!isTransactionType(type)) {
          return res.status(400).json({
            success: false,
            message: "Type must be INCOME or EXPENSE",
          });
        }

        if (!isCategoryForType(type, category)) {
          return res.status(400).json({
            success: false,
            message: "Category must be valid for the selected transaction type",
          });
        }

        if (description !== undefined && description !== null && typeof description !== "string") {
          return res.status(400).json({
            success: false,
            message: "Description must be a string",
          });
        }

        let parsedDate: Date | undefined;
        if (date !== undefined) {
          if (typeof date !== "string") {
            return res.status(400).json({
              success: false,
              message: "Invalid date",
            });
          }

          parsedDate = new Date(date);
          if (Number.isNaN(parsedDate.getTime())) {
            return res.status(400).json({
              success: false,
              message: "Invalid date",
            });
          }
        }

        const updateData: {
          amount: number;
          type: TransactionType;
          category: TransactionCategory;
          description?: string | null;
          date?: Date;
        } = {
          amount: numericAmount,
          type,
          category,
        };

        if (description !== undefined) {
          updateData.description = typeof description === "string"
            ? description.trim() || null
            : null;
        }
        if (parsedDate) updateData.date = parsedDate;

        const updateResult = await db.transaction.updateMany({
          where: {
            id: transactionId,
            userId,
          },
          data: updateData,
        });

        if (updateResult.count === 0) {
          return res.status(404).json({
            success: false,
            message: "Transaction not found",
          });
        }

        const transaction = await db.transaction.findFirst({
          where: {
            id: transactionId,
            userId,
          },
          select: {
            id: true,
            amount: true,
            type: true,
            category: true,
            description: true,
            date: true,
            createdAt: true,
            updatedAt: true,
            userId: true,
          },
        });

        if (!transaction) {
          return res.status(404).json({
            success: false,
            message: "Transaction not found",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Transaction updated successfully",
          transaction,
        });
      } catch (error) {
        console.error("Update transaction error:", error);

        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    }
  );

  router.delete(
    "/:id",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.user?.userId;

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required",
          });
        }

        const transactionParam = req.params.id;
        const transactionId = Array.isArray(transactionParam)
          ? transactionParam[0]
          : transactionParam;
        if (!transactionId) {
          return res.status(400).json({
            success: false,
            message: "Transaction ID is required",
          });
        }

        const deleteResult = await db.transaction.deleteMany({
          where: {
            id: transactionId,
            userId,
          },
        });

        if (deleteResult.count === 0) {
          return res.status(404).json({
            success: false,
            message: "Transaction not found",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Transaction deleted successfully",
        });
      } catch (error) {
        console.error("Delete transaction error:", error);

        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    }
  );

  return router;
}

export default createTransactionsRouter();
