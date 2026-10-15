import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateRecurringTransactionsPass } from "../src/services/recurring-generation.ts";

const integrationEnabled = process.env.RUN_RECURRING_INTEGRATION === "1";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function normalizedDatabaseTarget(connectionUrl) {
  const parsedUrl = new URL(connectionUrl);
  const parameters = [...parsedUrl.searchParams.entries()];
  const parameterValues = (name) =>
    parameters
      .filter(([key]) => key.toLowerCase() === name)
      .map(([, value]) => value);
  const firstParameter = (name) => parameterValues(name)[0];
  const normalizedPort = (port) => {
    if (!port) return "5432";
    const numericPort = Number(port);
    return Number.isInteger(numericPort) && numericPort > 0
      ? String(numericPort)
      : port;
  };
  const host = firstParameter("host") ?? parsedUrl.hostname;
  const port = normalizedPort(
    firstParameter("port") ?? parsedUrl.port,
  );
  const database =
    firstParameter("dbname") ??
    decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));

  return JSON.stringify({
    protocol:
      parsedUrl.protocol.toLowerCase() === "postgres:"
        ? "postgresql:"
        : parsedUrl.protocol.toLowerCase(),
    host: host.toLowerCase(),
    port,
    database,
  });
}

if (integrationEnabled && !testDatabaseUrl) {
  throw new Error(
    "RUN_RECURRING_INTEGRATION=1 requires an explicit TEST_DATABASE_URL",
  );
}

if (integrationEnabled) {
  let parsedTestDatabaseUrl;
  try {
    parsedTestDatabaseUrl = new URL(testDatabaseUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsedTestDatabaseUrl.protocol)) {
    throw new Error("TEST_DATABASE_URL must use the PostgreSQL protocol");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    let normalizedTestTarget;
    let normalizedDatabaseTargetValue;
    try {
      normalizedTestTarget = normalizedDatabaseTarget(testDatabaseUrl);
      normalizedDatabaseTargetValue = normalizedDatabaseTarget(databaseUrl);
    } catch {
      throw new Error(
        "Unable to safely compare TEST_DATABASE_URL and DATABASE_URL targets",
      );
    }

    if (normalizedTestTarget === normalizedDatabaseTargetValue) {
      throw new Error(
        "TEST_DATABASE_URL must target a different database than DATABASE_URL",
      );
    }
  }
}

function calendarDate(date) {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarDate(date);
}

function makePrismaClient() {
  if (!integrationEnabled || !testDatabaseUrl) {
    throw new Error("Integration database client requested without explicit opt-in");
  }

  const adapter = new PrismaPg({ connectionString: testDatabaseUrl });
  return new PrismaClient({ adapter });
}

async function createFixture() {
  const prisma = makePrismaClient();
  const userId = randomUUID();
  const recurringRuleId = randomUUID();
  const scheduledDate = calendarDate(new Date());
  const userWasCreated = { value: false };
  const ruleWasCreated = { value: false };
  const occurrenceIds = new Set();
  const transactionIds = new Set();

  try {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@integration.invalid`,
        passwordHash: "integration-test-only",
      },
    });
    userWasCreated.value = true;

    await prisma.recurringTransaction.create({
      data: {
        id: recurringRuleId,
        userId,
        amount: new Prisma.Decimal("19.99"),
        type: "EXPENSE",
        category: "OTHER_EXPENSE",
        description: `Recurring integration test ${recurringRuleId}`,
        frequency: "DAILY",
        interval: 1,
        startDate: new Date(`${scheduledDate}T00:00:00.000Z`),
        nextRunDate: new Date(`${scheduledDate}T00:00:00.000Z`),
        timeZone: "UTC",
      },
    });
    ruleWasCreated.value = true;
  } catch (error) {
    try {
      if (ruleWasCreated.value) {
        await prisma.recurringTransaction.deleteMany({
          where: { id: recurringRuleId },
        });
      }
      if (userWasCreated.value) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await prisma.$disconnect();
    }
    throw error;
  }

  const fixture = {
    prisma,
    userId,
    recurringRuleId,
    scheduledDate,
    occurrenceIds,
    transactionIds,
    userWasCreated,
    ruleWasCreated,
  };

  return fixture;
}

async function collectCreatedRecordIds(fixture) {
  const occurrences = await fixture.prisma.recurringOccurrence.findMany({
    where: { recurringTransactionId: fixture.recurringRuleId },
    select: { id: true, transactionId: true },
  });
  for (const occurrence of occurrences) {
    fixture.occurrenceIds.add(occurrence.id);
    if (occurrence.transactionId) {
      fixture.transactionIds.add(occurrence.transactionId);
    }
  }

  const transactions = await fixture.prisma.transaction.findMany({
    where: { userId: fixture.userId },
    select: { id: true },
  });
  for (const transaction of transactions) {
    fixture.transactionIds.add(transaction.id);
  }
}

async function cleanupFixture(fixture) {
  await collectCreatedRecordIds(fixture);

  if (fixture.occurrenceIds.size > 0) {
    await fixture.prisma.recurringOccurrence.deleteMany({
      where: { id: { in: [...fixture.occurrenceIds] } },
    });
  }
  if (fixture.transactionIds.size > 0) {
    await fixture.prisma.transaction.deleteMany({
      where: { id: { in: [...fixture.transactionIds] } },
    });
  }
  if (fixture.ruleWasCreated.value) {
    await fixture.prisma.recurringTransaction.deleteMany({
      where: { id: fixture.recurringRuleId },
    });
  }
  if (fixture.userWasCreated.value) {
    await fixture.prisma.user.deleteMany({ where: { id: fixture.userId } });
  }
}

async function withFixture(run) {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    try {
      await cleanupFixture(fixture);
    } finally {
      await fixture.prisma.$disconnect();
    }
  }
}

function createFailureInjectingClient(prisma, failurePoint) {
  const state = {
    occurrenceCreated: false,
    failureInjected: false,
    error: new Error(`Injected ${failurePoint} failure`),
  };

  function wrapDelegate(delegate, delegateName) {
    return new Proxy(delegate, {
      get(target, property) {
        const method = Reflect.get(target, property, target);
        if (typeof method !== "function") return method;

        return async (...args) => {
          if (
            failurePoint === "occurrence creation" &&
            delegateName === "recurringOccurrence" &&
            property === "create"
          ) {
            state.failureInjected = true;
            throw state.error;
          }

          if (
            failurePoint === "schedule advancement" &&
            state.occurrenceCreated &&
            delegateName === "recurringTransaction" &&
            property === "update" &&
            Object.hasOwn(args[0]?.data ?? {}, "nextRunDate")
          ) {
            state.failureInjected = true;
            throw state.error;
          }

          const result = await Reflect.apply(method, target, args);
          if (
            delegateName === "recurringOccurrence" &&
            property === "create"
          ) {
            state.occurrenceCreated = true;
          }
          return result;
        };
      },
    });
  }

  function wrapTransactionClient(transactionClient) {
    return new Proxy(transactionClient, {
      get(target, property) {
        if (
          property === "recurringOccurrence" ||
          property === "recurringTransaction"
        ) {
          return wrapDelegate(Reflect.get(target, property, target), property);
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  const client = new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return (callback, options) =>
          target.$transaction(
            (transactionClient) =>
              callback(wrapTransactionClient(transactionClient)),
            options,
          );
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { client, state };
}

async function findFixtureRecords(fixture) {
  const [occurrences, transactions] = await Promise.all([
    fixture.prisma.recurringOccurrence.findMany({
      where: { recurringTransactionId: fixture.recurringRuleId },
      orderBy: { scheduledDate: "asc" },
    }),
    fixture.prisma.transaction.findMany({
      where: { userId: fixture.userId },
      orderBy: { date: "asc" },
    }),
  ]);
  return { occurrences, transactions };
}

async function assertCompoundUniqueIndex(prisma) {
  const expectedConstraintName =
    "RecurringOccurrence_recurringTransactionId_scheduledDate_key";
  const indexes = await prisma.$queryRaw`
    SELECT
      index_class.relname AS "indexName",
      table_class.relname AS "tableName",
      index_info.indisunique AS "isUnique",
      array_agg(attribute.attname ORDER BY key.ordinality)::text[] AS "columns"
    FROM pg_catalog.pg_index AS index_info
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_info.indexrelid
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = index_info.indrelid
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_class.relnamespace
    CROSS JOIN LATERAL pg_catalog.unnest(index_info.indkey)
      WITH ORDINALITY AS key(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = table_class.oid
      AND attribute.attnum = key.attnum
    WHERE table_namespace.nspname = current_schema()
      AND table_class.relname = 'RecurringOccurrence'
      AND index_class.relname = ${expectedConstraintName}
      AND index_info.indisunique
    GROUP BY
      index_class.relname,
      table_class.relname,
      index_info.indisunique
  `;

  assert.equal(
    indexes.length,
    1,
    `Expected exactly one unique index named ${expectedConstraintName}`,
  );
  assert.equal(indexes[0].indexName, expectedConstraintName);
  assert.equal(indexes[0].tableName, "RecurringOccurrence");
  assert.equal(indexes[0].isUnique, true);
  assert.deepEqual(indexes[0].columns, [
    "recurringTransactionId",
    "scheduledDate",
  ]);
}

function assertPrismaP2002(error) {
  assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
  assert.equal(error.code, "P2002");
}

function integrationTest(name, run) {
  test(name, { skip: !integrationEnabled }, async () => {
    await withFixture(run);
  });
}

integrationTest(
  "serializes two concurrent passes for the same recurring rule",
  async (fixture) => {
    const now = new Date(`${fixture.scheduledDate}T12:00:00.000Z`);
    const passes = await Promise.allSettled([
      generateRecurringTransactionsPass(fixture.prisma, now),
      generateRecurringTransactionsPass(fixture.prisma, now),
    ]);
    const firstPass = passes[0];
    const secondPass = passes[1];
    if (firstPass.status === "rejected") throw firstPass.reason;
    if (secondPass.status === "rejected") throw secondPass.reason;

    const { occurrences, transactions } = await findFixtureRecords(fixture);

    assert.equal(
      firstPass.value.handledDates + secondPass.value.handledDates,
      1,
    );
    assert.equal(occurrences.length, 1);
    assert.equal(transactions.length, 1);
    assert.equal(
      calendarDate(
        (
          await fixture.prisma.recurringTransaction.findUniqueOrThrow({
            where: { id: fixture.recurringRuleId },
            select: { nextRunDate: true },
          })
        ).nextRunDate,
      ),
      addCalendarDays(fixture.scheduledDate, 1),
    );
  },
);

integrationTest(
  "rolls back the transaction when occurrence creation fails",
  async (fixture) => {
    const { client, state } = createFailureInjectingClient(
      fixture.prisma,
      "occurrence creation",
    );

    await assert.rejects(
      generateRecurringTransactionsPass(
        client,
        new Date(`${fixture.scheduledDate}T12:00:00.000Z`),
      ),
      (error) => error === state.error,
    );
    assert.equal(state.failureInjected, true);

    const { occurrences, transactions } = await findFixtureRecords(fixture);
    assert.equal(occurrences.length, 0);
    assert.equal(transactions.length, 0);
    const rule = await fixture.prisma.recurringTransaction.findUniqueOrThrow({
      where: { id: fixture.recurringRuleId },
      select: { nextRunDate: true },
    });
    assert.equal(calendarDate(rule.nextRunDate), fixture.scheduledDate);
  },
);

integrationTest(
  "rolls back occurrence and transaction when schedule advancement fails",
  async (fixture) => {
    const { client, state } = createFailureInjectingClient(
      fixture.prisma,
      "schedule advancement",
    );

    await assert.rejects(
      generateRecurringTransactionsPass(
        client,
        new Date(`${fixture.scheduledDate}T12:00:00.000Z`),
      ),
      (error) => error === state.error,
    );
    assert.equal(state.occurrenceCreated, true);
    assert.equal(state.failureInjected, true);

    const { occurrences, transactions } = await findFixtureRecords(fixture);
    assert.equal(occurrences.length, 0);
    assert.equal(transactions.length, 0);
    const rule = await fixture.prisma.recurringTransaction.findUniqueOrThrow({
      where: { id: fixture.recurringRuleId },
      select: { nextRunDate: true },
    });
    assert.equal(calendarDate(rule.nextRunDate), fixture.scheduledDate);
  },
);

integrationTest(
  "enforces the recurring rule/date unique index and reports Prisma P2002",
  async (fixture) => {
    await assertCompoundUniqueIndex(fixture.prisma);

    const occurrenceData = {
      recurringTransactionId: fixture.recurringRuleId,
      scheduledDate: new Date(`${fixture.scheduledDate}T00:00:00.000Z`),
    };

    await fixture.prisma.recurringOccurrence.create({ data: occurrenceData });
    await assert.rejects(
      fixture.prisma.recurringOccurrence.create({ data: occurrenceData }),
      (error) => {
        assertPrismaP2002(error);
        return true;
      },
    );
  },
);

integrationTest(
  "does not regenerate a scheduled date after its transaction is deleted",
  async (fixture) => {
    const now = new Date(`${fixture.scheduledDate}T12:00:00.000Z`);
    await generateRecurringTransactionsPass(fixture.prisma, now);

    const initialOccurrence =
      await fixture.prisma.recurringOccurrence.findUniqueOrThrow({
        where: {
          recurringTransactionId_scheduledDate: {
            recurringTransactionId: fixture.recurringRuleId,
            scheduledDate: new Date(`${fixture.scheduledDate}T00:00:00.000Z`),
          },
        },
      });
    assert.ok(initialOccurrence.transactionId);

    fixture.transactionIds.add(initialOccurrence.transactionId);
    await fixture.prisma.transaction.delete({
      where: { id: initialOccurrence.transactionId },
    });
    const retainedOccurrence =
      await fixture.prisma.recurringOccurrence.findUniqueOrThrow({
        where: { id: initialOccurrence.id },
      });
    assert.equal(retainedOccurrence.transactionId, null);

    await fixture.prisma.recurringTransaction.update({
      where: { id: fixture.recurringRuleId },
      data: {
        nextRunDate: new Date(`${fixture.scheduledDate}T00:00:00.000Z`),
      },
    });
    const result = await generateRecurringTransactionsPass(fixture.prisma, now);
    const { occurrences, transactions } = await findFixtureRecords(fixture);

    assert.equal(result.handledDates, 1);
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].id, initialOccurrence.id);
    assert.equal(occurrences[0].transactionId, null);
    assert.equal(transactions.length, 0);
  },
);
