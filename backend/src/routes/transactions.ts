
import { Router, type Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import {
  authenticateToken,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const router = Router();

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

const categoriesByType: Record<TransactionType, readonly TransactionCategory[]> = {
  INCOME: incomeCategories,
  EXPENSE: expenseCategories,
};

function isTransactionType(value: unknown): value is TransactionType {
  return value === "INCOME" || value === "EXPENSE";
}

function isCategoryForType(type: unknown, category: unknown): category is TransactionCategory {
  return (
    isTransactionType(type) &&
    typeof category === "string" &&
    categoriesByType[type].some((allowedCategory) => allowedCategory === category)
  );
}

router.get(
  "/summary",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const groupedTransactions = await prisma.transaction.groupBy({
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
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const transactions = await prisma.transaction.findMany({
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
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const transactions = await prisma.transaction.findMany({
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
  authenticateToken,
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

      const transaction = await prisma.transaction.create({
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
  authenticateToken,
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

      const updateResult = await prisma.transaction.updateMany({
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

      const transaction = await prisma.transaction.findFirst({
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
  authenticateToken,
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

      const deleteResult = await prisma.transaction.deleteMany({
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

export default router;

