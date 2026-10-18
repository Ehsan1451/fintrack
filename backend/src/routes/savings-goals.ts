import { Prisma } from "@prisma/client";
import { Router, type RequestHandler, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import prisma from "../prisma.js";
import {
  authenticateToken,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const maximumAmount = new Prisma.Decimal("9999999999.99");

const goalInclude = {
  contributions: {
    orderBy: [{ date: "desc" as const }, { id: "desc" as const }],
    select: {
      id: true,
      amount: true,
      date: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SavingsGoalInclude;

type SavingsGoalWithContributions = Prisma.SavingsGoalGetPayload<{
  include: typeof goalInclude;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAmount(value: unknown): Prisma.Decimal | null {
  if (typeof value !== "number" && typeof value !== "string") return null;

  const amountString = String(value);
  if (
    amountString.length > 13 ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amountString)
  ) {
    return null;
  }

  const amount = new Prisma.Decimal(amountString);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0) || amount.greaterThan(maximumAmount)) {
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

function serializeDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function serializeGoal(goal: SavingsGoalWithContributions) {
  const totalSaved = goal.contributions.reduce(
    (total, contribution) => total.plus(contribution.amount),
    new Prisma.Decimal(0),
  );
  const remainingAmount = Prisma.Decimal.max(
    goal.targetAmount.minus(totalSaved),
    new Prisma.Decimal(0),
  );
  const progressPercentage = totalSaved.greaterThanOrEqualTo(goal.targetAmount)
    ? 100
    : totalSaved.dividedBy(goal.targetAmount).times(100).toNumber();

  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount.toString(),
    targetDate: goal.targetDate ? serializeDateOnly(goal.targetDate) : null,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    contributions: goal.contributions.map((contribution) => ({
      id: contribution.id,
      amount: contribution.amount.toString(),
      date: serializeDateOnly(contribution.date),
      createdAt: contribution.createdAt,
    })),
    totalSaved: totalSaved.toString(),
    remainingAmount: remainingAmount.toString(),
    progressPercentage,
  };
}

function parseGoalBody(body: unknown): {
  name: string;
  targetAmount: Prisma.Decimal;
  targetDate?: Date | null;
} | null {
  if (
    !isRecord(body) ||
    Object.hasOwn(body, "userId") ||
    Object.hasOwn(body, "goalId")
  ) {
    return null;
  }

  if (typeof body.name !== "string") return null;
  const name = body.name.trim();
  if (!name || name.length > 100) return null;

  const targetAmount = parseAmount(body.targetAmount);
  if (!targetAmount) return null;

  let targetDate: Date | null | undefined;
  if (body.targetDate !== undefined) {
    if (body.targetDate === null) {
      targetDate = null;
    } else {
      targetDate = parseDateOnly(body.targetDate);
      if (!targetDate) return null;
    }
  }

  return targetDate === undefined
    ? { name, targetAmount }
    : { name, targetAmount, targetDate };
}

function getGoalId(req: AuthenticatedRequest): string | null {
  const param = req.params.id;
  const goalId = Array.isArray(param) ? param[0] : param;
  return typeof goalId === "string" && goalId.length > 0 ? goalId : null;
}

export function createSavingsGoalsRouter(
  db: PrismaClient = prisma,
  authenticate: RequestHandler = authenticateToken,
): Router {
  const router = Router();

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

        const goals = await db.savingsGoal.findMany({
          where: { userId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: goalInclude,
        });

        return res.status(200).json({
          success: true,
          goals: goals.map(serializeGoal),
        });
      } catch (error) {
        console.error("Get savings goals error:", error);
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
      const input = parseGoalBody(req.body);
      if (!input) {
        return res.status(400).json({
          success: false,
          message: "A valid name, positive target amount, and optional YYYY-MM-DD target date are required",
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
        const goal = await db.savingsGoal.create({
          data: {
            userId,
            name: input.name,
            targetAmount: input.targetAmount,
            targetDate: input.targetDate ?? null,
          },
          include: goalInclude,
        });

        return res.status(201).json({
          success: true,
          message: "Savings goal created successfully",
          goal: serializeGoal(goal),
        });
      } catch (error) {
        console.error("Create savings goal error:", error);
        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    },
  );

  router.get(
    "/:id",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const goalId = getGoalId(req);
      if (!goalId) {
        return res.status(400).json({
          success: false,
          message: "Savings goal ID is required",
        });
      }

      try {
        const goal = await db.savingsGoal.findFirst({
          where: { id: goalId, userId },
          include: goalInclude,
        });

        if (!goal) {
          return res.status(404).json({
            success: false,
            message: "Savings goal not found",
          });
        }

        return res.status(200).json({
          success: true,
          goal: serializeGoal(goal),
        });
      } catch (error) {
        console.error("Get savings goal error:", error);
        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    },
  );

  router.put(
    "/:id",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      const input = parseGoalBody(req.body);
      if (!input) {
        return res.status(400).json({
          success: false,
          message: "A valid name, positive target amount, and optional YYYY-MM-DD target date are required",
        });
      }

      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const goalId = getGoalId(req);
      if (!goalId) {
        return res.status(400).json({
          success: false,
          message: "Savings goal ID is required",
        });
      }

      try {
        const result = await db.$transaction(async (transaction) => {
          const updateData: {
            name: string;
            targetAmount: Prisma.Decimal;
            targetDate?: Date | null;
          } = {
            name: input.name,
            targetAmount: input.targetAmount,
          };
          if (input.targetDate !== undefined) updateData.targetDate = input.targetDate;

          const updated = await transaction.savingsGoal.updateMany({
            where: { id: goalId, userId },
            data: updateData,
          });
          if (updated.count === 0) return null;

          return transaction.savingsGoal.findFirst({
            where: { id: goalId, userId },
            include: goalInclude,
          });
        });

        if (!result) {
          return res.status(404).json({
            success: false,
            message: "Savings goal not found",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Savings goal updated successfully",
          goal: serializeGoal(result),
        });
      } catch (error) {
        console.error("Update savings goal error:", error);
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
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const goalId = getGoalId(req);
      if (!goalId) {
        return res.status(400).json({
          success: false,
          message: "Savings goal ID is required",
        });
      }

      try {
        const result = await db.savingsGoal.deleteMany({
          where: { id: goalId, userId },
        });
        if (result.count === 0) {
          return res.status(404).json({
            success: false,
            message: "Savings goal not found",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Savings goal deleted successfully",
        });
      } catch (error) {
        console.error("Delete savings goal error:", error);
        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    },
  );

  router.post(
    "/:id/contributions",
    authenticate,
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const goalId = getGoalId(req);
      if (!goalId) {
        return res.status(400).json({
          success: false,
          message: "Savings goal ID is required",
        });
      }

      const body: unknown = req.body;
      if (!isRecord(body) || Object.hasOwn(body, "userId") || Object.hasOwn(body, "goalId")) {
        return res.status(400).json({
          success: false,
          message: "A valid contribution body is required",
        });
      }

      const amount = parseAmount(body.amount);
      if (!amount) {
        return res.status(400).json({
          success: false,
          message: "Amount must be a positive monetary amount with at most two decimal places",
        });
      }

      const date = parseDateOnly(body.date);
      if (!date) {
        return res.status(400).json({
          success: false,
          message: "Date must be a valid YYYY-MM-DD calendar date",
        });
      }

      try {
        const goal = await db.$transaction(async (transaction) => {
          const ownedGoal = await transaction.savingsGoal.findFirst({
            where: { id: goalId, userId },
            select: { id: true },
          });
          if (!ownedGoal) return null;

          await transaction.savingsContribution.create({
            data: {
              goalId: ownedGoal.id,
              amount,
              date,
            },
          });

          return transaction.savingsGoal.findFirst({
            where: { id: ownedGoal.id, userId },
            include: goalInclude,
          });
        });

        if (!goal) {
          return res.status(404).json({
            success: false,
            message: "Savings goal not found",
          });
        }

        return res.status(201).json({
          success: true,
          message: "Savings contribution added successfully",
          goal: serializeGoal(goal),
        });
      } catch (error) {
        console.error("Add savings contribution error:", error);
        return res.status(500).json({
          success: false,
          message: "Something went wrong",
        });
      }
    },
  );

  return router;
}

export default createSavingsGoalsRouter();
