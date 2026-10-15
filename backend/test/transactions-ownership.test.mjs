import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma } from "@prisma/client";

process.env.JWT_SECRET = "transactions-ownership-test-only";
process.env.DATABASE_URL = "postgresql://test-only:test-only@127.0.0.1:1/test-only";

const { createTransactionsRouter } = await import(
  "../src/routes/transactions.ts"
);

const authenticatedUserId = "user-A";

function createTransaction(id, userId, amount, type, category, date) {
  const timestamp = new Date(date);
  return {
    id,
    userId,
    amount: new Prisma.Decimal(amount),
    type,
    category,
    description: `${id} description`,
    date: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createFakeDatabase(seed) {
  const records = seed.map((record) => ({ ...record }));
  const calls = { create: [], update: [], delete: [] };

  function matches(record, where) {
    return (
      (!Object.hasOwn(where, "userId") || record.userId === where.userId) &&
      (!Object.hasOwn(where, "id") || record.id === where.id)
    );
  }

  function selectFields(record, select) {
    if (!select) return { ...record };
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, selected]) => selected)
        .map(([field]) => [field, record[field]]),
    );
  }

  const transaction = {
    findMany: async ({ where, orderBy, select }) => {
      assert.equal(typeof where.userId, "string");
      const result = records
        .filter((record) => matches(record, where))
        .sort((first, second) => {
          const direction = orderBy?.date === "asc" ? 1 : -1;
          return direction * (first.date - second.date);
        });
      return result.map((record) => selectFields(record, select));
    },

    findFirst: async ({ where, select }) => {
      assert.equal(typeof where.userId, "string");
      assert.equal(typeof where.id, "string");
      const record = records.find((candidate) => matches(candidate, where));
      return record ? selectFields(record, select) : null;
    },

    groupBy: async ({ by, where }) => {
      assert.equal(typeof where.userId, "string");
      const groups = new Map();
      for (const record of records.filter((candidate) => matches(candidate, where))) {
        const key = by.map((field) => record[field]).join("\u0000");
        const group = groups.get(key) ?? {
          ...Object.fromEntries(by.map((field) => [field, record[field]])),
          _sum: { amount: new Prisma.Decimal(0) },
          _count: { _all: 0 },
        };
        group._sum.amount = group._sum.amount.plus(record.amount);
        group._count._all += 1;
        groups.set(key, group);
      }
      return [...groups.values()];
    },

    create: async ({ data, select }) => {
      assert.equal(typeof data.userId, "string");
      calls.create.push({ data: { ...data } });
      const timestamp = new Date();
      const record = {
        id: `created-${records.length + 1}`,
        ...data,
        amount: new Prisma.Decimal(data.amount),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      records.push(record);
      return selectFields(record, select);
    },

    updateMany: async ({ where, data }) => {
      assert.equal(typeof where.userId, "string");
      assert.equal(typeof where.id, "string");
      calls.update.push({ where: { ...where }, data: { ...data } });
      let count = 0;
      for (const record of records) {
        if (!matches(record, where)) continue;
        Object.assign(record, data, { updatedAt: new Date() });
        if (Object.hasOwn(data, "amount")) {
          record.amount = new Prisma.Decimal(data.amount);
        }
        count += 1;
      }
      return { count };
    },

    deleteMany: async ({ where }) => {
      assert.equal(typeof where.userId, "string");
      assert.equal(typeof where.id, "string");
      calls.delete.push({ where: { ...where } });
      const remaining = records.filter((record) => !matches(record, where));
      const count = records.length - remaining.length;
      records.splice(0, records.length, ...remaining);
      return { count };
    },
  };

  return { db: { transaction }, records, calls };
}

function createHarness({ authenticated = true } = {}) {
  const database = createFakeDatabase([
    createTransaction(
      "transaction-A",
      "user-A",
      "100.00",
      "INCOME",
      "SALARY",
      "2026-04-10T00:00:00.000Z",
    ),
    createTransaction(
      "transaction-B",
      "user-B",
      "900.00",
      "INCOME",
      "SALARY",
      "2026-04-11T00:00:00.000Z",
    ),
    createTransaction(
      "expense-A",
      "user-A",
      "25.00",
      "EXPENSE",
      "FOOD",
      "2026-04-12T00:00:00.000Z",
    ),
    createTransaction(
      "expense-B",
      "user-B",
      "700.00",
      "EXPENSE",
      "FOOD",
      "2026-04-13T00:00:00.000Z",
    ),
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

  return { ...database, router: createTransactionsRouter(database.db, authenticate) };
}

async function requestWith(harness, path, method = "GET", body) {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", harness.router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/transactions${path}`,
      {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      },
    );
    return { response, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("GET / returns only transactions owned by the authenticated user", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(harness, "/");

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.transactions.map(({ id, userId }) => ({ id, userId })),
    [
      { id: "expense-A", userId: "user-A" },
      { id: "transaction-A", userId: "user-A" },
    ],
  );
});

test("PUT /:id cannot modify another user's transaction", async () => {
  const harness = createHarness();
  const original = { ...harness.records.find(({ id }) => id === "transaction-B") };
  const { response, body } = await requestWith(
    harness,
    "/transaction-B",
    "PUT",
    {
      amount: 1,
      type: "INCOME",
      category: "SALARY",
      description: "attempted cross-user update",
    },
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.calls.update, [
    { where: { id: "transaction-B", userId: "user-A" }, data: {
      amount: 1,
      type: "INCOME",
      category: "SALARY",
      description: "attempted cross-user update",
    } },
  ]);
  assert.deepEqual(harness.records.find(({ id }) => id === "transaction-B"), original);
});

test("DELETE /:id cannot delete another user's transaction", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(
    harness,
    "/transaction-B",
    "DELETE",
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.calls.delete, [
    { where: { id: "transaction-B", userId: "user-A" } },
  ]);
  assert.ok(harness.records.some(({ id, userId }) =>
    id === "transaction-B" && userId === "user-B",
  ));
});

test("POST / stores the authenticated user's ID, not a client-supplied ID", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(harness, "/", "POST", {
    amount: 42.5,
    type: "INCOME",
    category: "SALARY",
    description: "test income",
    date: "2026-04-14T00:00:00.000Z",
    userId: "user-B",
  });

  assert.equal(response.status, 201);
  assert.equal(body.transaction.userId, "user-A");
  assert.equal(harness.calls.create.length, 1);
  assert.equal(harness.calls.create[0].data.userId, "user-A");
});

test("GET /summary totals only the authenticated user's transactions", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(harness, "/summary");

  assert.equal(response.status, 200);
  assert.equal(body.data.totalIncome, 100);
  assert.equal(body.data.totalExpenses, 25);
  assert.equal(body.data.balance, 75);
  assert.equal(body.data.transactionCount, 2);
});

test("GET /trends returns only the authenticated user's transaction dates and totals", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(harness, "/trends");

  assert.equal(response.status, 200);
  assert.deepEqual(body.data, [
    { date: "2026-04-10", income: 100, expenses: 0 },
    { date: "2026-04-12", income: 0, expenses: 25 },
  ]);
});

test("protected routes reject requests without an authenticated user", async () => {
  const harness = createHarness({ authenticated: false });
  const { response, body } = await requestWith(harness, "/");

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.equal(harness.calls.create.length, 0);
  assert.equal(harness.calls.update.length, 0);
  assert.equal(harness.calls.delete.length, 0);
});
