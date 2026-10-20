import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRecurringTransactionCreate,
  parseRecurringTransactionPatch,
  validateRecurringTransactionForReactivation,
  validateRecurringTransactionSchedule,
} from "../src/utils/recurring-transaction-validation.ts";
import { Prisma } from "@prisma/client";

const validRule = {
  amount: "125.50",
  type: "EXPENSE",
  category: "HOUSING",
  frequency: "MONTHLY",
  interval: 1,
  startDate: "2026-01-31",
};

test("parses valid creation input and applies server-side defaults", () => {
  const result = parseRecurringTransactionCreate(validRule);
  assert.equal(result.success, true);
  if (!result.success) return;

  assert.equal(result.value.amount.toString(), "125.5");
  assert.equal(result.value.startDate.toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(result.value.endDate, null);
  assert.equal(result.value.description, null);
  assert.equal(result.value.timeZone, "Europe/Paris");
});

test("rejects invalid amount, enum values, interval, and calendar dates", () => {
  for (const amount of ["0", "-1", "1.001", "10000000000", "1e2"]) {
    assert.equal(
      parseRecurringTransactionCreate({ ...validRule, amount }).success,
      false,
    );
  }
  assert.equal(
    parseRecurringTransactionCreate({ ...validRule, type: "OTHER" }).success,
    false,
  );
  assert.equal(
    parseRecurringTransactionCreate({ ...validRule, frequency: "HOURLY" }).success,
    false,
  );
  assert.equal(
    parseRecurringTransactionCreate({ ...validRule, interval: 366 }).success,
    false,
  );
  assert.equal(
    parseRecurringTransactionCreate({ ...validRule, startDate: "2026-02-30" }).success,
    false,
  );
});

test("rejects mismatched categories, inverted dates, and invalid time zones", () => {
  const incomeHousing = parseRecurringTransactionCreate({
    ...validRule,
    type: "INCOME",
  });
  assert.equal(incomeHousing.success, true);
  if (incomeHousing.success) {
    assert.match(
      validateRecurringTransactionSchedule(incomeHousing.value),
      /Category/,
    );
  }

  const invertedDates = parseRecurringTransactionCreate({
    ...validRule,
    endDate: "2026-01-30",
  });
  assert.equal(invertedDates.success, true);
  if (invertedDates.success) {
    assert.match(
      validateRecurringTransactionSchedule(invertedDates.value),
      /endDate/,
    );
  }

  assert.equal(
    parseRecurringTransactionCreate({ ...validRule, timeZone: "Not/A_Timezone" })
      .success,
    false,
  );
});

test("PATCH rejects server-managed fields and requires an update field", () => {
  assert.deepEqual(parseRecurringTransactionPatch({ nextRunDate: "2026-02-01" }), {
    success: false,
    message: "nextRunDate must not be provided",
  });
  assert.equal(parseRecurringTransactionPatch({ userId: "someone-else" }).success, false);
  assert.equal(parseRecurringTransactionPatch({ isActive: false }).success, false);
  assert.equal(parseRecurringTransactionPatch({}).success, false);
});

test("PATCH accepts a valid schedule change and nullable end date", () => {
  const patch = parseRecurringTransactionPatch({
    startDate: "2026-02-01",
    endDate: null,
    interval: 2,
  });
  assert.equal(patch.success, true);
  if (!patch.success) return;

  assert.equal(patch.value.startDate?.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(patch.value.endDate, null);
  assert.equal(patch.value.interval, 2);
});

test("reactivation eligibility follows the inclusive end date in the rule timezone", () => {
  const rule = {
    amount: new Prisma.Decimal("1.00"),
    type: "EXPENSE",
    category: "FOOD",
    frequency: "MONTHLY",
    interval: 1,
    startDate: new Date("2026-10-19T00:00:00.000Z"),
    nextRunDate: new Date("2026-10-19T00:00:00.000Z"),
    endDate: new Date("2026-10-24T00:00:00.000Z"),
    timeZone: "Europe/Paris",
  };

  assert.equal(
    validateRecurringTransactionForReactivation(
      rule,
      new Date("2026-10-23T21:59:00.000Z"),
    ),
    null,
  );
  assert.equal(
    validateRecurringTransactionForReactivation(
      rule,
      new Date("2026-10-23T22:00:00.000Z"),
    ),
    null,
  );
  assert.match(
    validateRecurringTransactionForReactivation(
      rule,
      new Date("2026-10-24T22:00:00.000Z"),
    ),
    /schedule has already ended/,
  );
});
