import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma } from "@prisma/client";

process.env.JWT_SECRET = "budgets-ownership-test-only";
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test-only";

const { createBudgetsRouter } = await import("../src/routes/budgets.ts");

const authenticatedUserId = "user-A";
const month = "2026-04";
const timeZone = "UTC";

function createBudget(id, userId, category, limit) {
  return {
    id,
    userId,
    month,
    category,
    limit: new Prisma.Decimal(limit),
  };
}

function createFakeDatabase(seed) {
  const budgets = seed.map((budget) => ({ ...budget }));
  const calls = {
    findMany: [],
    groupBy: [],
    upsert: [],
    aggregate: [],
  };

  function selectFields(record, select) {
    if (!select) return { ...record };
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, selected]) => selected)
        .map(([field]) => [field, record[field]]),
    );
  }

  const db = {
    budget: {
      findMany: async ({ where, orderBy, select }) => {
        calls.findMany.push({ where: { ...where } });
        assert.equal(typeof where.userId, "string");
        return budgets
          .filter(
            (budget) =>
              budget.userId === where.userId && budget.month === where.month,
          )
          .sort((first, second) =>
            orderBy.category === "asc"
              ? first.category.localeCompare(second.category)
              : second.category.localeCompare(first.category),
          )
          .map((budget) => selectFields(budget, select));
      },
      upsert: async ({ where, create, update, select }) => {
        calls.upsert.push({
          where: { ...where.userId_month_category },
          create: { ...create },
          update: { ...update },
        });

        const key = where.userId_month_category;
        const existing = budgets.find(
          (budget) =>
            budget.userId === key.userId &&
            budget.month === key.month &&
            budget.category === key.category,
        );
        if (existing) {
          existing.limit = update.limit;
          return selectFields(existing, select);
        }

        const created = {
          id: `created-${budgets.length + 1}`,
          ...create,
        };
        budgets.push(created);
        return selectFields(created, select);
      },
    },
    transaction: {
      groupBy: async ({ where }) => {
        calls.groupBy.push({ where: { ...where } });
        assert.equal(typeof where.userId, "string");
        return [];
      },
      aggregate: async ({ where }) => {
        calls.aggregate.push({ where: { ...where } });
        assert.equal(typeof where.userId, "string");
        return { _sum: { amount: null } };
      },
    },
  };

  return { db, budgets, calls };
}

function createHarness({ authenticated = true } = {}) {
  const database = createFakeDatabase([
    createBudget("budget-A", "user-A", "FOOD", "300.00"),
    createBudget("budget-B", "user-B", "TRANSPORT", "700.00"),
    createBudget("budget-B-food", "user-B", "FOOD", "900.00"),
  ]);
  const authenticate = (req, _res, next) => {
    if (authenticated) {
      req.user = {
        userId: authenticatedUserId,
        email: "user-a@example.invalid",
      };
    }
    next();
  };

  return {
    ...database,
    router: createBudgetsRouter(database.db, authenticate),
  };
}

async function requestWith(harness, path, method = "GET", body) {
  const app = express();
  app.use(express.json());
  app.use("/api/budgets", harness.router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/budgets${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    return { response, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("GET / returns only budgets and spending for the authenticated user", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(
    harness,
    `/?month=${month}&timeZone=${timeZone}`,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.budgets.map(({ id, category }) => ({ id, category })),
    [{ id: "budget-A", category: "FOOD" }],
  );
  assert.deepEqual(harness.calls.findMany, [
    { where: { userId: "user-A", month } },
  ]);
  assert.equal(harness.calls.groupBy.length, 1);
  assert.equal(harness.calls.groupBy[0].where.userId, "user-A");
});

test("PUT / uses the authenticated user's ID and leaves another user's budget unchanged", async () => {
  const harness = createHarness();
  const otherUserBudgetBefore = {
    ...harness.budgets.find(({ id }) => id === "budget-B-food"),
  };
  const { response, body } = await requestWith(
    harness,
    "/",
    "PUT",
    {
      month,
      timeZone,
      category: "FOOD",
      limit: 450,
      userId: "user-B",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(body.budget.id, "budget-A");
  assert.deepEqual(harness.calls.upsert, [
    {
      where: {
        userId: "user-A",
        month,
        category: "FOOD",
      },
      create: {
        userId: "user-A",
        month,
        category: "FOOD",
        limit: new Prisma.Decimal(450),
      },
      update: { limit: new Prisma.Decimal(450) },
    },
  ]);
  assert.deepEqual(
    harness.budgets.find(({ id }) => id === "budget-B-food"),
    otherUserBudgetBefore,
  );
  assert.equal(harness.calls.aggregate[0].where.userId, "user-A");
});

test("budget routes reject requests without an authenticated user", async () => {
  const harness = createHarness({ authenticated: false });
  const { response, body } = await requestWith(
    harness,
    `/?month=${month}&timeZone=${timeZone}`,
  );

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.equal(harness.calls.findMany.length, 0);
  assert.equal(harness.calls.groupBy.length, 0);
  assert.equal(harness.calls.upsert.length, 0);
});
