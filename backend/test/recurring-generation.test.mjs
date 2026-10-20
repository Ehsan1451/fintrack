import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  generateRecurringTransactionsPass,
  getLocalCalendarDate,
} from "../src/services/recurring-generation.ts";

function makeRule({
  id = "rule-1",
  startDate = "2026-01-01",
  nextRunDate = startDate,
  endDate = null,
  frequency = "DAILY",
  interval = 1,
  timeZone = "UTC",
} = {}) {
  return {
    id,
    userId: `user-for-${id}`,
    amount: new Prisma.Decimal("50.00"),
    type: "EXPENSE",
    category: "HOUSING",
    description: "Rent",
    frequency,
    interval,
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    nextRunDate: new Date(`${nextRunDate}T00:00:00.000Z`),
    endDate: endDate ? new Date(`${endDate}T00:00:00.000Z`) : null,
    timeZone,
    isActive: true,
  };
}

function makeClient(initialRules, existingOccurrences = []) {
  const rules = new Map(initialRules.map((rule) => [rule.id, rule]));
  const occurrences = new Map(
    existingOccurrences.map((occurrence) => [
      `${occurrence.recurringTransactionId}|${occurrence.scheduledDate
        .toISOString()
        .slice(0, 10)}`,
      occurrence,
    ]),
  );
  const createdTransactions = [];
  const transactionOptions = [];
  const locks = [];
  let transactionCount = 0;

  const tx = {
    $queryRaw: async (strings, ruleId) => {
      locks.push({ sql: strings.join("?"), ruleId });
      return rules.has(ruleId) ? [{ id: ruleId }] : [];
    },
    recurringTransaction: {
      findUnique: async ({ where }) => rules.get(where.id) ?? null,
      update: async ({ where, data }) => {
        const rule = rules.get(where.id);
        Object.assign(rule, data);
        return rule;
      },
    },
    recurringOccurrence: {
      findUnique: async ({ where }) => {
        const { recurringTransactionId, scheduledDate } =
          where.recurringTransactionId_scheduledDate;
        return (
          occurrences.get(
            `${recurringTransactionId}|${scheduledDate.toISOString().slice(0, 10)}`,
          ) ?? null
        );
      },
      create: async ({ data }) => {
        const occurrence = { id: `occurrence-${occurrences.size + 1}`, ...data };
        occurrences.set(
          `${data.recurringTransactionId}|${data.scheduledDate
            .toISOString()
            .slice(0, 10)}`,
          occurrence,
        );
        return occurrence;
      },
    },
    transaction: {
      create: async ({ data }) => {
        const transaction = { id: `transaction-${++transactionCount}`, ...data };
        createdTransactions.push(transaction);
        return transaction;
      },
    },
  };

  return {
    rules,
    occurrences,
    createdTransactions,
    transactionOptions,
    locks,
    client: {
      recurringTransaction: {
        findMany: async ({ where, take }) => {
          const matchesId = (rule, condition) => {
            if (condition.gt !== undefined && !(rule.id > condition.gt)) return false;
            if (condition.lte !== undefined && !(rule.id <= condition.lte)) return false;
            return true;
          };

          return [...rules.values()]
            .filter((rule) => {
              const matchesCandidateCondition = where.OR.some((condition) => {
                if (condition.nextRunDate) {
                  return rule.nextRunDate <= condition.nextRunDate.lte;
                }
                return condition.endDate?.not === null && rule.endDate !== null;
              });
              return (
                rule.isActive &&
                matchesCandidateCondition &&
                (!where.AND || where.AND.every((condition) => matchesId(rule, condition.id)))
              );
            })
            .sort((first, second) => first.id.localeCompare(second.id))
            .slice(0, take)
            .map(({ id }) => ({ id }));
        },
      },
      $transaction: async (callback, options) => {
        transactionOptions.push(options);
        return callback(tx);
      },
    },
  };
}

test("uses timezone-local calendar dates and rejects invalid IANA timezones", () => {
  const instant = new Date("2026-03-01T00:30:00.000Z");
  assert.equal(getLocalCalendarDate(instant, "Europe/Paris"), "2026-03-01");
  assert.equal(getLocalCalendarDate(instant, "America/Los_Angeles"), "2026-02-28");
  assert.equal(
    getLocalCalendarDate(new Date("2026-03-29T22:30:00.000Z"), "Europe/Paris"),
    "2026-03-30",
  );
  assert.throws(
    () => getLocalCalendarDate(instant, "Not/A_Timezone"),
    RangeError,
  );
});

test("honors end dates before, on, and after the next scheduled occurrence", async () => {
  const beforeNext = makeRule({
    id: "before-next",
    startDate: "2026-01-01",
    nextRunDate: "2026-01-02",
    endDate: "2026-01-01",
  });
  const onNext = makeRule({
    id: "on-next",
    startDate: "2026-01-01",
    nextRunDate: "2026-01-02",
    endDate: "2026-01-02",
  });
  const afterNext = makeRule({
    id: "after-next",
    startDate: "2026-01-01",
    nextRunDate: "2026-01-02",
    endDate: "2026-01-03",
  });
  const beforeClient = makeClient([beforeNext]);
  const onClient = makeClient([onNext]);
  const afterClient = makeClient([afterNext]);

  await generateRecurringTransactionsPass(
    beforeClient.client,
    new Date("2026-01-02T12:00:00.000Z"),
  );
  assert.equal(beforeClient.createdTransactions.length, 0);
  assert.equal(beforeNext.isActive, false);

  await generateRecurringTransactionsPass(
    onClient.client,
    new Date("2026-01-02T12:00:00.000Z"),
  );
  assert.equal(onClient.createdTransactions.length, 1);
  assert.equal(onClient.createdTransactions[0].date.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.equal(onNext.isActive, false);
  assert.equal(onNext.nextRunDate.toISOString().slice(0, 10), "2026-01-03");

  await generateRecurringTransactionsPass(
    afterClient.client,
    new Date("2026-01-02T12:00:00.000Z"),
  );
  assert.equal(afterClient.createdTransactions.length, 1);
  assert.equal(afterNext.isActive, true);
  await generateRecurringTransactionsPass(
    afterClient.client,
    new Date("2026-01-03T12:00:00.000Z"),
  );
  assert.equal(afterClient.createdTransactions.length, 2);
  assert.deepEqual(
    afterClient.createdTransactions.map(({ date }) => date.toISOString()),
    ["2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
  );
  assert.equal(afterNext.isActive, false);
});

test("does not generate duplicate transactions when a generation pass repeats", async () => {
  const rule = makeRule({ startDate: "2026-01-01" });
  const client = makeClient([rule]);
  const now = new Date("2026-01-01T12:00:00.000Z");

  const firstPass = await generateRecurringTransactionsPass(client.client, now);
  const repeatedPass = await generateRecurringTransactionsPass(client.client, now);

  assert.equal(firstPass.handledDates, 1);
  assert.equal(repeatedPass.handledDates, 0);
  assert.equal(client.createdTransactions.length, 1);
  assert.equal(client.occurrences.size, 1);
});

test("leaves inactive rules unchanged and does not generate their overdue dates", async () => {
  const rule = makeRule({ startDate: "2026-01-01" });
  rule.isActive = false;
  const client = makeClient([rule]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-01-05T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 0);
  assert.equal(client.createdTransactions.length, 0);
  assert.equal(rule.nextRunDate.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(rule.isActive, false);
});

test("processes a due date in the rule timezone and waits for the local date otherwise", async () => {
  const now = new Date("2026-03-01T00:30:00.000Z");
  const futureInLosAngeles = makeRule({
    id: "la-rule",
    startDate: "2026-03-01",
    timeZone: "America/Los_Angeles",
  });
  const client = makeClient([futureInLosAngeles]);

  const firstPass = await generateRecurringTransactionsPass(client.client, now);
  assert.equal(firstPass.handledDates, 0);
  assert.equal(client.createdTransactions.length, 0);

  const secondPass = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-03-01T08:30:00.000Z"),
  );
  assert.equal(secondPass.handledDates, 1);
  assert.equal(client.createdTransactions.length, 1);
});

test("includes endDate and deactivates after its final allowed occurrence", async () => {
  const rule = makeRule({
    startDate: "2026-01-31",
    nextRunDate: "2026-02-28",
    endDate: "2026-02-28",
    frequency: "MONTHLY",
  });
  const client = makeClient([rule]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-02-28T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 1);
  assert.equal(result.deactivatedRules, 1);
  assert.equal(rule.isActive, false);
  assert.equal(rule.nextRunDate.toISOString().slice(0, 10), "2026-03-31");
  assert.equal(client.createdTransactions[0].date.toISOString(), "2026-02-28T00:00:00.000Z");
});

test("keeps the October occurrence and ends future runs before a later October end date", async () => {
  const rule = makeRule({
    startDate: "2026-10-20",
    nextRunDate: "2026-10-20",
    endDate: "2026-10-25",
    frequency: "MONTHLY",
    timeZone: "Europe/Paris",
  });
  const client = makeClient([rule]);
  const now = new Date("2026-10-20T12:00:00.000Z");

  const result = await generateRecurringTransactionsPass(client.client, now);

  assert.equal(result.handledDates, 1);
  assert.equal(result.deactivatedRules, 1);
  assert.equal(rule.isActive, false);
  assert.equal(rule.nextRunDate.toISOString().slice(0, 10), "2026-11-20");
  assert.equal(client.createdTransactions.length, 1);
  assert.equal(
    client.createdTransactions[0].date.toISOString(),
    "2026-10-20T00:00:00.000Z",
  );
  assert.equal(client.occurrences.size, 1);

  const laterPass = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-11-20T12:00:00.000Z"),
  );
  assert.equal(laterPass.handledDates, 0);
  assert.equal(client.createdTransactions.length, 1);
  assert.equal(client.occurrences.size, 1);
});

test("keeps the October 19 occurrence for a monthly schedule ending October 24", async () => {
  const rule = makeRule({
    id: "short-monthly-rule",
    amount: new Prisma.Decimal("1.00"),
    startDate: "2026-10-19",
    nextRunDate: "2026-10-19",
    endDate: "2026-10-24",
    frequency: "MONTHLY",
    timeZone: "Europe/Paris",
  });
  const client = makeClient([rule]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-10-19T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 1);
  assert.equal(result.deactivatedRules, 1);
  assert.equal(rule.isActive, false);
  assert.equal(rule.nextRunDate.toISOString().slice(0, 10), "2026-11-19");
  assert.equal(client.createdTransactions.length, 1);
  assert.equal(
    client.createdTransactions[0].date.toISOString(),
    "2026-10-19T00:00:00.000Z",
  );
  assert.equal(client.occurrences.size, 1);
});

test("allows an occurrence on the inclusive end date using the rule's local calendar day", async () => {
  const rule = makeRule({
    startDate: "2026-10-14",
    nextRunDate: "2026-10-25",
    endDate: "2026-10-25",
    frequency: "DAILY",
    timeZone: "Europe/Paris",
  });
  const client = makeClient([rule]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-10-24T22:30:00.000Z"),
  );

  assert.equal(getLocalCalendarDate(
    new Date("2026-10-24T22:30:00.000Z"),
    "Europe/Paris",
  ), "2026-10-25");
  assert.equal(result.handledDates, 1);
  assert.equal(client.createdTransactions.length, 1);
  assert.equal(
    client.createdTransactions[0].date.toISOString(),
    "2026-10-25T00:00:00.000Z",
  );
  assert.equal(rule.isActive, false);
});

test("deactivates a due rule whose next date is beyond its inclusive endDate", async () => {
  const rule = makeRule({
    startDate: "2026-01-01",
    nextRunDate: "2026-01-03",
    endDate: "2026-01-02",
  });
  const client = makeClient([rule]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-01-03T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 0);
  assert.equal(result.deactivatedRules, 1);
  assert.equal(rule.isActive, false);
  assert.equal(client.createdTransactions.length, 0);
});

test("deactivates an expired rule before its next date is due", async () => {
  const rule = makeRule({
    startDate: "2026-01-01",
    nextRunDate: "2026-01-10",
    endDate: "2026-01-05",
  });
  const client = makeClient([rule]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-01-03T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 0);
  assert.equal(result.deactivatedRules, 1);
  assert.equal(rule.isActive, false);
  assert.equal(client.createdTransactions.length, 0);
  assert.equal(client.occurrences.size, 0);
});

test("reports invalid timezones and recurrence dates without advancing rules", async () => {
  const invalidTimezone = makeRule({ id: "bad-timezone", timeZone: "Not/A_Timezone" });
  const invalidDate = makeRule({
    id: "off-sequence",
    startDate: "2026-01-01",
    nextRunDate: "2026-01-15",
    frequency: "MONTHLY",
  });
  const client = makeClient([invalidTimezone, invalidDate]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-02-01T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 0);
  assert.equal(result.issues.length, 2);
  assert.match(
    result.issues.find(({ ruleId }) => ruleId === "bad-timezone").message,
    /Invalid timezone/,
  );
  assert.match(
    result.issues.find(({ ruleId }) => ruleId === "off-sequence").message,
    /not on the anchored recurrence sequence/,
  );
  assert.equal(invalidTimezone.nextRunDate.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(invalidDate.nextRunDate.toISOString().slice(0, 10), "2026-01-15");
});

test("an existing occurrence, including one with a deleted transaction, advances without recreation", async () => {
  const rule = makeRule();
  const client = makeClient([rule], [
    {
      id: "historical-occurrence",
      recurringTransactionId: rule.id,
      scheduledDate: new Date("2026-01-01T00:00:00.000Z"),
      transactionId: null,
    },
  ]);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-01-01T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 1);
  assert.equal(client.createdTransactions.length, 0);
  assert.equal(rule.nextRunDate.toISOString().slice(0, 10), "2026-01-02");
});

test("caps each pass at 50 dates and resumes from the atomically advanced next date", async () => {
  const rule = makeRule({
    startDate: "2026-01-01",
    nextRunDate: "2026-01-01",
  });
  const client = makeClient([rule]);
  const now = new Date("2026-12-31T12:00:00.000Z");

  const firstPass = await generateRecurringTransactionsPass(client.client, now);
  assert.equal(firstPass.handledDates, 50);
  assert.equal(client.createdTransactions.length, 50);
  assert.equal(firstPass.continuationCursor, "rule-1");
  assert.equal(rule.nextRunDate.toISOString().slice(0, 10), "2026-02-20");

  const secondPass = await generateRecurringTransactionsPass(
    client.client,
    now,
    firstPass.continuationCursor,
  );
  assert.equal(secondPass.handledDates, 50);
  assert.equal(client.createdTransactions.length, 100);
  assert.equal(rule.nextRunDate.toISOString().slice(0, 10), "2026-04-11");
  assert.ok(client.locks.length === 100);
  assert.ok(
    client.transactionOptions.every(
      (options) => options.maxWait === 5000 && options.timeout === 10000,
    ),
  );
  assert.ok(
    client.locks.every(({ sql }) => /FOR UPDATE/.test(sql) && sql.includes("?")),
  );
});

test("rotates and wraps through more than 50 overdue rules across passes", async () => {
  const rules = Array.from({ length: 60 }, (_, index) =>
    makeRule({
      id: `rule-${String(index).padStart(2, "0")}`,
      startDate: "2026-01-01",
      nextRunDate: "2026-01-01",
      endDate: "2026-01-01",
    }),
  );
  const client = makeClient(rules);
  const now = new Date("2026-01-01T12:00:00.000Z");

  const firstPass = await generateRecurringTransactionsPass(client.client, now);
  assert.equal(firstPass.handledDates, 50);
  assert.equal(firstPass.continuationCursor, "rule-49");
  assert.equal(client.createdTransactions.length, 50);

  const secondPass = await generateRecurringTransactionsPass(
    client.client,
    now,
    firstPass.continuationCursor,
  );
  assert.equal(secondPass.handledDates, 10);
  assert.equal(client.createdTransactions.length, 60);
  assert.equal(rules.filter((rule) => !rule.isActive).length, 60);
});

test("rejects invalid recurring amounts and accepts the Decimal(12,2) maximum", async () => {
  const invalidAmounts = [
    ["too-many-decimals", "1.001"],
    ["zero", "0.00"],
    ["negative", "-1.00"],
  ];
  const rules = invalidAmounts.map(([id, amount]) => ({
    ...makeRule({ id, endDate: "2026-01-01" }),
    amount: new Prisma.Decimal(amount),
  }));
  rules.push({
    ...makeRule({ id: "maximum", endDate: "2026-01-01" }),
    amount: new Prisma.Decimal("9999999999.99"),
  });
  const client = makeClient(rules);

  const result = await generateRecurringTransactionsPass(
    client.client,
    new Date("2026-01-01T12:00:00.000Z"),
  );

  assert.equal(result.handledDates, 1);
  assert.equal(result.issues.length, 3);
  assert.deepEqual(
    result.issues.map(({ ruleId }) => ruleId).sort(),
    ["negative", "too-many-decimals", "zero"],
  );
  assert.equal(client.createdTransactions.length, 1);
  assert.equal(client.createdTransactions[0].amount.toString(), "9999999999.99");
  assert.equal(client.createdTransactions[0].amount instanceof Prisma.Decimal, true);
});
