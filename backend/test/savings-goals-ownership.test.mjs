import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "savings-goals-ownership-test-only";
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test-only";

const { createSavingsGoalsRouter } = await import(
  "../src/routes/savings-goals.ts"
);
const { authenticateToken } = await import("../src/middleware/auth.ts");

const authenticatedUserId = "user-A";
const otherUserGoalId = "goal-B";

function createGoal(id, userId, overrides = {}) {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    userId,
    name: `Goal ${id}`,
    targetAmount: new Prisma.Decimal("1000.00"),
    targetDate: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createFakeDatabase() {
  const goals = [
    createGoal("goal-A", "user-A"),
    createGoal(otherUserGoalId, "user-B"),
  ];
  const contributions = [];
  const calls = {
    findMany: [],
    findFirst: [],
    createGoal: [],
    updateMany: [],
    deleteMany: [],
    createContribution: [],
  };

  function matchesGoal(goal, where) {
    return (
      goal.id === where.id &&
      (!Object.hasOwn(where, "userId") || goal.userId === where.userId)
    );
  }

  function goalWithContributions(goal) {
    return {
      ...goal,
      contributions: contributions
        .filter((contribution) => contribution.goalId === goal.id)
        .map((contribution) => ({ ...contribution })),
    };
  }

  const transaction = {
    savingsGoal: {
      findMany: async ({ where }) => {
        calls.findMany.push({ where: { ...where } });
        return goals
          .filter((goal) => goal.userId === where.userId)
          .map(goalWithContributions);
      },
      findFirst: async ({ where, select }) => {
        calls.findFirst.push({ where: { ...where } });
        const goal = goals.find((candidate) => matchesGoal(candidate, where));
        if (!goal) return null;
        return select ? { id: goal.id } : goalWithContributions(goal);
      },
      create: async ({ data }) => {
        calls.createGoal.push({ data: { ...data } });
        const goal = createGoal(`goal-${goals.length + 1}`, data.userId, data);
        goals.push(goal);
        return goalWithContributions(goal);
      },
      updateMany: async ({ where, data }) => {
        calls.updateMany.push({
          where: { ...where },
          data: { ...data },
        });
        const goal = goals.find((candidate) => matchesGoal(candidate, where));
        if (!goal) return { count: 0 };
        Object.assign(goal, data, { updatedAt: new Date() });
        return { count: 1 };
      },
      deleteMany: async ({ where }) => {
        calls.deleteMany.push({ where: { ...where } });
        const index = goals.findIndex((goal) => matchesGoal(goal, where));
        if (index < 0) return { count: 0 };
        goals.splice(index, 1);
        return { count: 1 };
      },
    },
    savingsContribution: {
      create: async ({ data }) => {
        calls.createContribution.push({ data: { ...data } });
        const contribution = {
          id: `contribution-${contributions.length + 1}`,
          ...data,
          amount: new Prisma.Decimal(data.amount),
          createdAt: new Date(),
        };
        contributions.push(contribution);
        return contribution;
      },
    },
  };

  return {
    db: { ...transaction, $transaction: async (callback) => callback(transaction) },
    goals,
    contributions,
    calls,
  };
}

function createHarness({ authenticated = true } = {}) {
  const database = createFakeDatabase();

  return {
    ...database,
    authenticated,
    router: createSavingsGoalsRouter(database.db, authenticateToken),
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
  app.use("/api/savings-goals", harness.router);
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

    const requestOptions = { method };
    if (Object.keys(headers).length > 0) requestOptions.headers = headers;
    if (body !== undefined) requestOptions.body = JSON.stringify(body);

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/savings-goals${path}`,
      requestOptions,
    );
    return { response, body: await response.json() };
  } finally {
    server.close();
    await once(server, "close");
  }
}

const validGoalBody = {
  name: "Updated goal",
  targetAmount: 1250,
  targetDate: "2026-12-31",
};
const validContributionBody = {
  amount: 25.5,
  date: "2026-04-14",
};

test("GET /:id cannot read another user's savings goal", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(
    harness,
    `/${otherUserGoalId}`,
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.calls.findFirst, [
    { where: { id: otherUserGoalId, userId: "user-A" } },
  ]);
});

test("GET / returns only savings goals owned by the authenticated user", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(harness, "/");

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.goals.map(({ id }) => id),
    ["goal-A"],
  );
  assert.deepEqual(harness.calls.findMany, [
    { where: { userId: "user-A" } },
  ]);

  const userBResult = await requestWith(
    harness,
    "/",
    "GET",
    undefined,
    "user-B",
  );
  assert.equal(userBResult.response.status, 200);
  assert.deepEqual(
    userBResult.body.goals.map(({ id }) => id),
    [otherUserGoalId],
  );
});

test("PUT /:id cannot update another user's savings goal", async () => {
  const harness = createHarness();
  const goalBefore = { ...harness.goals.find(({ id }) => id === otherUserGoalId) };
  const { response, body } = await requestWith(
    harness,
    `/${otherUserGoalId}`,
    "PUT",
    validGoalBody,
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.calls.updateMany, [
    {
      where: { id: otherUserGoalId, userId: "user-A" },
      data: {
        name: validGoalBody.name,
        targetAmount: new Prisma.Decimal(validGoalBody.targetAmount),
        targetDate: new Date("2026-12-31T00:00:00.000Z"),
      },
    },
  ]);
  assert.deepEqual(
    harness.goals.find(({ id }) => id === otherUserGoalId),
    goalBefore,
  );
});

test("DELETE /:id cannot delete another user's savings goal", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(
    harness,
    `/${otherUserGoalId}`,
    "DELETE",
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.calls.deleteMany, [
    { where: { id: otherUserGoalId, userId: "user-A" } },
  ]);
  assert.ok(harness.goals.some(({ id, userId }) =>
    id === otherUserGoalId && userId === "user-B",
  ));
});

test("POST /:id/contributions cannot add a contribution to another user's goal", async () => {
  const harness = createHarness();
  const { response, body } = await requestWith(
    harness,
    `/${otherUserGoalId}/contributions`,
    "POST",
    validContributionBody,
  );

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.deepEqual(harness.calls.findFirst, [
    { where: { id: otherUserGoalId, userId: "user-A" } },
  ]);
  assert.deepEqual(harness.calls.createContribution, []);
  assert.deepEqual(harness.contributions, []);
});

test("client-supplied goal identity fields cannot override authenticated identity", async () => {
  const harness = createHarness();
  const createResponse = await requestWith(harness, "/", "POST", {
    name: "Injected owner",
    targetAmount: 100,
    userId: "user-B",
  });
  const updateResponse = await requestWith(
    harness,
    `/${otherUserGoalId}`,
    "PUT",
    { ...validGoalBody, goalId: "goal-A" },
  );
  const contributionWithUserId = await requestWith(
    harness,
    "/goal-A/contributions",
    "POST",
    { ...validContributionBody, userId: "user-B" },
  );
  const contributionWithGoalId = await requestWith(
    harness,
    "/goal-A/contributions",
    "POST",
    { ...validContributionBody, goalId: otherUserGoalId },
  );

  assert.equal(createResponse.response.status, 400);
  assert.equal(updateResponse.response.status, 400);
  assert.equal(contributionWithUserId.response.status, 400);
  assert.equal(contributionWithGoalId.response.status, 400);
  assert.equal(harness.calls.createGoal.length, 0);
  assert.equal(harness.calls.updateMany.length, 0);
  assert.equal(harness.calls.createContribution.length, 0);
  assert.deepEqual(harness.contributions, []);
});

test("savings-goal routes reject requests without an authenticated user", async () => {
  const harness = createHarness({ authenticated: false });
  const { response, body } = await requestWith(harness, "/");

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.equal(harness.calls.findMany.length, 0);
  assert.equal(harness.calls.createGoal.length, 0);
  assert.equal(harness.calls.findFirst.length, 0);
  assert.equal(harness.calls.updateMany.length, 0);
  assert.equal(harness.calls.deleteMany.length, 0);
  assert.equal(harness.calls.createContribution.length, 0);
});
