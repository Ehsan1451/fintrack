import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

process.env.JWT_SECRET = "recurring-routes-test-secret";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unused";

const { createRecurringTransactionsRouter } = await import(
  "../src/routes/recurring-transactions.ts"
);

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
    rule,
    deleted: false,
    updateCalls: [],
    deleteCalls: [],
    lockValues: [],
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
        assert.equal(where.userId, ownerId);
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
  };

  return { db, state };
}

async function requestWith(harness, path, method = "POST") {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/recurring-transactions",
    createRecurringTransactionsRouter(harness.db, (req, _res, next) => {
      req.user = { userId: "user-1", email: "test@example.invalid" };
      next();
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/recurring-transactions${path}`,
      { method },
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
  assert.equal(harness.state.rule.nextRunDate, originalNextRunDate);
  assert.deepEqual(harness.state.updateCalls[0].data, { isActive: true });
  assert.deepEqual(harness.state.updateCalls[0].where, {
    id: "rule-1",
    userId: "user-1",
  });
  assert.deepEqual(harness.state.lockValues, [["rule-1", "user-1"]]);
});

test("does not reactivate a rule owned by another user", async () => {
  const harness = createHarness({ ownerId: "another-user" });
  const { response, body } = await requestWith(
    harness,
    "/rule-1/reactivate",
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(harness.state.updateCalls.length, 0);
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

test("rejects reactivation when the next scheduled date already has an occurrence", async () => {
  const harness = createHarness({
    cursorOccurrence: { id: "existing-occurrence" },
  });
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
  const harness = createHarness({ ownerId: "another-user" });
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
