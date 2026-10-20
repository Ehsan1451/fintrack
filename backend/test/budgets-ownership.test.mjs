import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "budgets-ownership-test-only";
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test-only";

const { createBudgetsRouter } = await import("../src/routes/budgets.ts");
const { authenticateToken } = await import("../src/middleware/auth.ts");

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

function createFakeDatabase(seed, spending = []) {
  const budgets = seed.map((budget) => ({ ...budget }));
  const calls = {
    findMany: [],
    groupBy: [],
    upsert: [],
    aggregate: [],
    deleteMany: [],
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
      deleteMany: async ({ where }) => {
        calls.deleteMany.push({ ...where });
        const index = budgets.findIndex(
          (budget) => budget.id === where.id && budget.userId === where.userId,
        );
        if (index === -1) return { count: 0 };
        budgets.splice(index, 1);
        return { count: 1 };
      },
    },
    transaction: {
      groupBy: async ({ where }) => {
        calls.groupBy.push({ where: { ...where } });
        assert.equal(typeof where.userId, "string");
        return spending.map(({ category, amount }) => ({
          category,
          _sum: { amount: new Prisma.Decimal(amount) },
        }));
      },
      aggregate: async ({ where }) => {
        calls.aggregate.push({ where: { ...where } });
        assert.equal(typeof where.userId, "string");
        const categorySpending = spending.find(
          (entry) => entry.category === where.category,
        );
        return {
          _sum: {
            amount: categorySpending
              ? new Prisma.Decimal(categorySpending.amount)
              : null,
          },
        };
      },
    },
  };

  return { db, budgets, calls };
}

function createHarness({
  authenticated = true,
  spending = [],
  foodLimit = "300.00",
} = {}) {
  const database = createFakeDatabase([
    createBudget("budget-A", "user-A", "FOOD", foodLimit),
    createBudget("budget-B", "user-B", "TRANSPORT", "700.00"),
    createBudget("budget-B-food", "user-B", "FOOD", "900.00"),
  ], spending);
  return {
    ...database,
    authenticated,
    router: createBudgetsRouter(database.db, authenticateToken),
  };
}

async function requestWith(
  harness,
  path,
  method = "GET",
  body,
  userId = authenticatedUserId,
) {
  const app = express();
  app.use(express.json());
  app.use("/api/budgets", harness.router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const headers = {};
    if (harness.authenticated) {
      headers.authorization = `Bearer ${jwt.sign(
        { userId, email: `${userId}@example.invalid` },
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      )}`;
    }
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(`http://127.0.0.1:${address.port}/api/budgets${path}`, {
      method,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = null;
    }
    return { response, body: responseBody };
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
    body.budgets.slice(0, 2).map(({ id, category }) => ({ id, category })),
    [
      { id: "budget-A", category: "FOOD" },
      { id: null, category: "TRANSPORT" },
    ],
  );
  assert.equal(body.budgets.length, 9);
  assert.equal(body.budgets[1].status, "No limit set");
  assert.equal(body.budgets[1].spent, "0");
  assert.deepEqual(harness.calls.findMany, [
    { where: { userId: "user-A", month } },
  ]);
  assert.equal(harness.calls.groupBy.length, 1);
  assert.equal(harness.calls.groupBy[0].where.userId, "user-A");

  const userBResult = await requestWith(
    harness,
    `/?month=${month}&timeZone=${timeZone}`,
    "GET",
    undefined,
    "user-B",
  );
  assert.equal(userBResult.response.status, 200);
  assert.deepEqual(
    userBResult.body.budgets.slice(0, 2).map(({ id, category }) => ({ id, category })),
    [
      { id: "budget-B-food", category: "FOOD" },
      { id: "budget-B", category: "TRANSPORT" },
    ],
  );
});

test("PUT / uses the authenticated user's ID and leaves another user's budget unchanged", async () => {
  const harness = createHarness({
    foodLimit: "350.00",
    spending: [{ category: "FOOD", amount: "221.00" }],
  });
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
      limit: 300,
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
        limit: new Prisma.Decimal(300),
      },
      update: { limit: new Prisma.Decimal(300) },
    },
  ]);
  assert.deepEqual(
    harness.budgets.find(({ id }) => id === "budget-B-food"),
    otherUserBudgetBefore,
  );
  assert.equal(harness.calls.aggregate[0].where.userId, "user-A");
  assert.equal(body.budget.limit, "300");
  assert.equal(body.budget.spent, "221");
  assert.equal(body.budget.remaining, "79");
  assert.equal(body.budget.status, "On track");
});

test("GET / calculates monthly status at the near-limit and over-budget boundaries", async () => {
  const onTrackHarness = createHarness({
    spending: [{ category: "FOOD", amount: "221.00" }],
  });
  const onTrack = await requestWith(
    onTrackHarness,
    `/?month=${month}&timeZone=${timeZone}`,
  );
  assert.equal(onTrack.response.status, 200);
  assert.equal(onTrack.body.budgets[0].status, "On track");
  assert.equal(onTrack.body.budgets[0].remaining, "79");

  const nearHarness = createHarness({
    spending: [{ category: "FOOD", amount: "240.00" }],
  });
  const near = await requestWith(
    nearHarness,
    `/?month=${month}&timeZone=${timeZone}`,
  );
  assert.equal(near.response.status, 200);
  assert.equal(near.body.budgets[0].status, "Near limit");
  assert.equal(near.body.budgets[0].remaining, "60");

  const overHarness = createHarness({
    spending: [{ category: "FOOD", amount: "301.00" }],
  });
  const over = await requestWith(
    overHarness,
    `/?month=${month}&timeZone=${timeZone}`,
  );
  assert.equal(over.response.status, 200);
  assert.equal(over.body.budgets[0].status, "Over budget");
  assert.equal(over.body.budgets[0].remaining, "-1");
});

test("GET / returns spending for unbudgeted categories and all categories in an empty month", async () => {
  const harness = createHarness({
    spending: [{ category: "TRANSPORT", amount: "15.25" }],
  });
  const { response, body } = await requestWith(
    harness,
    "/?month=2026-05&timeZone=UTC",
  );

  assert.equal(response.status, 200);
  assert.equal(body.budgets.length, 9);
  assert.equal(body.budgets[0].month, "2026-05");
  const transport = body.budgets.find(({ category }) => category === "TRANSPORT");
  assert.equal(transport.limit, null);
  assert.equal(transport.spent, "15.25");
  assert.equal(transport.status, "No limit set");
});

test("DELETE / without a budget ID does not remove budget records", async () => {
  const harness = createHarness();
  const userBBudgetsBefore = harness.budgets
    .filter(({ userId }) => userId === "user-B")
    .map((budget) => ({ ...budget }));
  const { response } = await requestWith(
    harness,
    "/",
    "DELETE",
    undefined,
  );

  assert.equal(response.status, 404);
  assert.deepEqual(
    harness.budgets.filter(({ userId }) => userId === "user-B"),
    userBBudgetsBefore,
  );
});

test("DELETE /:id removes only the authenticated user's budget limit", async () => {
  const harness = createHarness();
  const before = harness.budgets.map((budget) => ({ ...budget }));
  const { response, body } = await requestWith(
    harness,
    "/budget-A",
    "DELETE",
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(harness.budgets.some(({ id }) => id === "budget-A"), false);
  assert.deepEqual(
    harness.budgets.filter(({ userId }) => userId === "user-B"),
    before.filter(({ userId }) => userId === "user-B"),
  );
  assert.deepEqual(harness.calls.deleteMany, [{ id: "budget-A", userId: "user-A" }]);
});

test("DELETE /:id cannot remove another user's budget", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(
    harness,
    "/budget-B",
    "DELETE",
  );
  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(harness.budgets.some(({ id }) => id === "budget-B"), true);
  assert.deepEqual(harness.calls.deleteMany, [{ id: "budget-B", userId: "user-A" }]);
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
