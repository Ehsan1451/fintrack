import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "recurring-routes-test-secret";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unused";

const { createRecurringTransactionsRouter } = await import(
  "../src/routes/recurring-transactions.ts"
);
const { authenticateToken } = await import("../src/middleware/auth.ts");

function createRule(overrides = {}) {
  return {
    id: "rule-1",
    userId: "user-1",
    amount: {
      toString: () => "12.34",
      isFinite: () => true,
      lessThanOrEqualTo: () => false,
      greaterThan: () => false,
    },
    type: "EXPENSE",
    category: "FOOD",
    description: "Monthly groceries",
    frequency: "MONTHLY",
    interval: 1,
    startDate: new Date("2026-01-31T00:00:00.000Z"),
    nextRunDate: new Date("2026-03-31T00:00:00.000Z"),
    endDate: null,
    timeZone: "Europe/Paris",
    isActive: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createHarness({
  rule = createRule(),
  ownerId = "user-1",
  occurrenceCount = 0,
  cursorOccurrence = null,
} = {}) {
  const state = {
    rule: { ...rule, userId: ownerId },
    deleted: false,
    updateCalls: [],
    deleteCalls: [],
    lockValues: [],
    createCalls: [],
    updateManyCalls: [],
    findManyCalls: [],
  };
  const tx = {
    $queryRaw: async (_strings, ...values) => {
      state.lockValues.push(values);
      return !state.deleted &&
        values[0] === rule.id &&
        values[1] === ownerId
        ? [{ id: rule.id }]
        : [];
    },
    recurringTransaction: {
      findFirst: async ({ where }) =>
        !state.deleted &&
        where.id === rule.id &&
        where.userId === ownerId
          ? { ...state.rule }
          : null,
      update: async ({ where, data }) => {
        if (where.userId !== undefined) assert.equal(where.userId, ownerId);
        state.updateCalls.push({ where, data });
        state.rule = { ...state.rule, ...data };
        return { ...state.rule };
      },
      deleteMany: async ({ where }) => {
        state.deleteCalls.push(where);
        if (
          !state.deleted &&
          where.id === rule.id &&
          where.userId === ownerId &&
          where.isActive === false
        ) {
          state.deleted = true;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    recurringOccurrence: {
      findUnique: async ({ where }) => {
        assert.equal(
          where.recurringTransactionId_scheduledDate.recurringTransactionId,
          rule.id,
        );
        return cursorOccurrence;
      },
      count: async ({ where }) => {
        assert.deepEqual(where, { recurringTransactionId: rule.id });
        return occurrenceCount;
      },
    },
  };
  const db = {
    $transaction: async (callback) => callback(tx),
    recurringTransaction: {
      findMany: async ({ where }) => {
        state.findManyCalls.push(where);
        return !state.deleted && where.userId === ownerId
          ? [{ ...state.rule, _count: { occurrences: occurrenceCount } }]
          : [];
      },
      create: async ({ data }) => {
        state.createCalls.push(data);
        state.rule = createRule({ ...data, id: "created-rule" });
        state.deleted = false;
        return { ...state.rule };
      },
      updateMany: async ({ where, data }) => {
        state.updateManyCalls.push({ where, data });
        if (
          !state.deleted &&
          where.id === state.rule.id &&
          where.userId === ownerId
        ) {
          state.rule = { ...state.rule, ...data };
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    recurringOccurrence: {
      findMany: async ({ where }) => {
        const matchesCursor = where.OR?.some(
          (cursor) =>
            cursor.recurringTransactionId === rule.id &&
            cursor.scheduledDate.getTime() === state.rule.nextRunDate.getTime(),
        );
        return matchesCursor && cursorOccurrence
          ? [{ recurringTransactionId: rule.id }]
          : [];
      },
    },
  };

  return { db, state };
}

async function requestWith(
  harness,
  path,
  method = "POST",
  { userId = "user-1", body, token = undefined, now = new Date() } = {},
) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/recurring-transactions",
    createRecurringTransactionsRouter(harness.db, authenticateToken, () => now),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const headers = {};
    const requestToken =
      token === undefined
        ? jwt.sign(
            { userId, email: `${userId}@example.invalid` },
            process.env.JWT_SECRET,
            { expiresIn: "5m" },
          )
        : token;
    if (requestToken) headers.authorization = `Bearer ${requestToken}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/recurring-transactions${path}`,
      {
        method,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return { response, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("reactivates an owned rule without changing its schedule cursor", async () => {
  const harness = createHarness();
  const originalNextRunDate = harness.state.rule.nextRunDate;
  const { response, body } = await requestWith(
    harness,
    "/rule-1/reactivate",
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.recurringTransaction.isActive, true);
  assert.equal(body.recurringTransaction.nextRunDate, "2026-03-31");
  assert.equal(body.recurringTransaction.canReactivate, false);
  assert.equal(harness.state.rule.nextRunDate, originalNextRunDate);
  assert.deepEqual(harness.state.updateCalls[0].data, { isActive: true });
  assert.deepEqual(harness.state.updateCalls[0].where, {
    id: "rule-1",
    userId: "user-1",
  });
  assert.deepEqual(harness.state.lockValues, [["rule-1", "user-1"]]);
});

test("does not reactivate a rule owned by another user", async () => {
  const harness = createHarness({ ownerId: "user-2" });
  const { response, body } = await requestWith(
    harness,
    "/rule-1/reactivate",
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(harness.state.updateCalls.length, 0);
});

test("lists only the authenticated user's recurring rules", async () => {
  const harness = createHarness({ ownerId: "user-2" });
  const { response, body } = await requestWith(harness, "/", "GET", {
    userId: "user-2",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.recurringTransactions.map(({ id }) => id),
    ["rule-1"],
  );
  assert.deepEqual(harness.state.findManyCalls, [{ userId: "user-2" }]);

  const otherUserResult = await requestWith(harness, "/", "GET", {
    userId: "user-1",
  });
  assert.equal(otherUserResult.response.status, 200);
  assert.deepEqual(otherUserResult.body.recurringTransactions, []);
});

test("serializes ended schedules without exposing a next run after the end date", async () => {
  const harness = createHarness({
    rule: createRule({
      nextRunDate: new Date("2026-03-31T00:00:00.000Z"),
      endDate: new Date("2026-03-30T00:00:00.000Z"),
    }),
    occurrenceCount: 2,
  });
  const { response, body } = await requestWith(harness, "/", "GET");

  assert.equal(response.status, 200);
  assert.equal(body.recurringTransactions[0].nextRunDate, null);
  assert.equal(body.recurringTransactions[0].hasGeneratedOccurrences, true);
  assert.equal("_count" in body.recurringTransactions[0], false);
});

test("creates recurring rules for the authenticated user only", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(harness, "/", "POST", {
    userId: "user-2",
    body: {
      amount: "25.00",
      type: "EXPENSE",
      category: "FOOD",
      frequency: "MONTHLY",
      interval: 1,
      startDate: "2026-01-31",
    },
  });

  assert.equal(response.status, 201);
  assert.equal(body.recurringTransaction.id, "created-rule");
  assert.equal(harness.state.createCalls.length, 1);
  assert.equal(harness.state.createCalls[0].userId, "user-2");
});

test("does not patch another user's recurring rule", async () => {
  const harness = createHarness({ ownerId: "user-2" });
  const originalRule = { ...harness.state.rule };
  const { response, body } = await requestWith(
    harness,
    "/rule-1",
    "PATCH",
    { body: { amount: "40.00" } },
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.state.rule, originalRule);
  assert.equal(harness.state.updateCalls.length, 0);
  assert.deepEqual(harness.state.lockValues, [["rule-1", "user-1"]]);
});

test("prevents editing rules with generated occurrence history", async () => {
  const harness = createHarness({
    rule: createRule({ isActive: true }),
    occurrenceCount: 1,
  });
  const { response, body } = await requestWith(
    harness,
    "/rule-1",
    "PATCH",
    { body: { amount: "40.00" } },
  );

  assert.equal(response.status, 409);
  assert.match(body.message, /generated occurrences/);
  assert.equal(harness.state.updateCalls.length, 0);
});

test("does not deactivate another user's recurring rule", async () => {
  const harness = createHarness({ ownerId: "user-2" });
  const originalRule = { ...harness.state.rule };
  const { response, body } = await requestWith(
    harness,
    "/rule-1",
    "DELETE",
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.state.rule, originalRule);
  assert.deepEqual(harness.state.updateManyCalls, [
    {
      where: { id: "rule-1", userId: "user-1" },
      data: { isActive: false },
    },
  ]);
});

test("deactivates a rule with generated occurrences without removing its history", async () => {
  const harness = createHarness({
    rule: createRule({ isActive: true }),
    occurrenceCount: 2,
  });
  const { response, body } = await requestWith(
    harness,
    "/rule-1",
    "DELETE",
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(harness.state.rule.isActive, false);
  assert.equal(harness.state.deleted, false);
  assert.equal(harness.state.deleteCalls.length, 0);
  assert.deepEqual(harness.state.updateManyCalls, [
    {
      where: { id: "rule-1", userId: "user-1" },
      data: { isActive: false },
    },
  ]);
});

test("does not reactivate a rule with an invalid stored schedule", async () => {
  const harness = createHarness({
    rule: createRule({ nextRunDate: new Date("2026-03-30T00:00:00.000Z") }),
  });
  const { response, body } = await requestWith(
    harness,
    "/rule-1/reactivate",
  );

  assert.equal(response.status, 409);
  assert.match(body.message, /recurrence schedule/);
  assert.equal(harness.state.rule.isActive, false);
  assert.equal(harness.state.updateCalls.length, 0);
});

test("rejects reactivation when the schedule has ended", async () => {
  const harness = createHarness({
    rule: createRule({
      endDate: new Date("2026-03-30T00:00:00.000Z"),
      nextRunDate: new Date("2026-03-31T00:00:00.000Z"),
    }),
  });
  const { response, body } = await requestWith(
    harness,
    "/rule-1/reactivate",
  );

  assert.equal(response.status, 409);
  assert.match(body.message, /schedule has already ended/);
  assert.equal(harness.state.rule.isActive, false);
  assert.equal(harness.state.updateCalls.length, 0);
});

test("does not advertise or permit reactivation after the timezone-local end date", async () => {
  const harness = createHarness({
    rule: createRule({
      endDate: new Date("2026-10-24T00:00:00.000Z"),
      nextRunDate: new Date("2026-03-31T00:00:00.000Z"),
    }),
  });
  const now = new Date("2026-10-24T22:00:00.000Z");
  const onEndDate = await requestWith(harness, "/", "GET", {
    now: new Date("2026-10-23T22:00:00.000Z"),
  });
  assert.equal(onEndDate.body.recurringTransactions[0].canReactivate, true);

  const listResult = await requestWith(harness, "/", "GET", { now });

  assert.equal(listResult.response.status, 200);
  assert.equal(listResult.body.recurringTransactions[0].canReactivate, false);

  const result = await requestWith(harness, "/rule-1/reactivate", "POST", {
    now,
  });
  assert.equal(result.response.status, 409);
  assert.match(result.body.message, /schedule has already ended/);
  assert.equal(harness.state.rule.isActive, false);
  assert.equal(harness.state.updateCalls.length, 0);
});

test("rejects reactivation when the next scheduled date already has an occurrence", async () => {
  const harness = createHarness({
    cursorOccurrence: { id: "existing-occurrence" },
  });
  const listResult = await requestWith(harness, "/", "GET");
  assert.equal(listResult.body.recurringTransactions[0].canReactivate, false);

  const { response, body } = await requestWith(
    harness,
    "/rule-1/reactivate",
  );

  assert.equal(response.status, 409);
  assert.match(body.message, /already has an occurrence/);
  assert.equal(harness.state.rule.isActive, false);
  assert.equal(harness.state.updateCalls.length, 0);
});

test("prevents permanent deletion when a rule has occurrence history", async () => {
  const harness = createHarness({ occurrenceCount: 1 });
  const { response, body } = await requestWith(
    harness,
    "/rule-1/permanent",
    "DELETE",
  );

  assert.equal(response.status, 409);
  assert.match(body.message, /generated occurrences/);
  assert.equal(harness.state.deleted, false);
  assert.equal(harness.state.deleteCalls.length, 0);
});

test("does not permanently delete a rule owned by another user", async () => {
  const harness = createHarness({ ownerId: "user-2" });
  const { response, body } = await requestWith(
    harness,
    "/rule-1/permanent",
    "DELETE",
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(harness.state.deleted, false);
  assert.equal(harness.state.deleteCalls.length, 0);
});

test("rejects unauthenticated requests on every recurring-rule endpoint", async () => {
  const harness = createHarness();
  const endpoints = [
    ["/", "GET"],
    ["/", "POST"],
    ["/rule-1", "PATCH"],
    ["/rule-1/reactivate", "POST"],
    ["/rule-1", "DELETE"],
    ["/rule-1/permanent", "DELETE"],
  ];

  for (const [path, method] of endpoints) {
    const { response, body } = await requestWith(harness, path, method, {
      token: null,
      body:
        method === "POST" && path === "/"
          ? {
              amount: "25.00",
              type: "EXPENSE",
              category: "FOOD",
              frequency: "MONTHLY",
              interval: 1,
              startDate: "2026-01-31",
            }
          : method === "PATCH"
            ? { amount: "40.00" }
            : undefined,
    });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(body.success, false, `${method} ${path}`);
  }

  assert.deepEqual(harness.state.findManyCalls, []);
  assert.deepEqual(harness.state.createCalls, []);
  assert.deepEqual(harness.state.lockValues, []);
  assert.deepEqual(harness.state.updateManyCalls, []);
  assert.deepEqual(harness.state.deleteCalls, []);
});

test("requires an active rule to be deactivated before permanent deletion", async () => {
  const harness = createHarness({ rule: createRule({ isActive: true }) });
  const { response, body } = await requestWith(
    harness,
    "/rule-1/permanent",
    "DELETE",
  );

  assert.equal(response.status, 409);
  assert.match(body.message, /Deactivate/);
  assert.equal(harness.state.deleted, false);
  assert.equal(harness.state.deleteCalls.length, 0);
});

test("permanently deletes only an owned inactive rule with no occurrences", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(
    harness,
    "/rule-1/permanent",
    "DELETE",
  );

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(harness.state.deleted, true);
  assert.deepEqual(harness.state.deleteCalls, [
    { id: "rule-1", userId: "user-1", isActive: false },
  ]);
});
