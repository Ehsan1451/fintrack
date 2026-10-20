import assert from "node:assert/strict";
import test from "node:test";
import { getRecurringLifecycleState } from "../../frontend/src/utils/recurring-lifecycle.ts";

const shortSchedule = {
  isActive: false,
  nextRunDate: null,
  endDate: "2026-10-24",
  timeZone: "Europe/Paris",
};

test("distinguishes before, on, and after the end date in Europe/Paris", () => {
  assert.equal(
    getRecurringLifecycleState(
      shortSchedule,
      new Date("2026-10-23T21:59:00.000Z"),
    ),
    "no-future-occurrences",
  );
  assert.equal(
    getRecurringLifecycleState(
      shortSchedule,
      new Date("2026-10-23T22:00:00.000Z"),
    ),
    "no-future-occurrences",
  );
  assert.equal(
    getRecurringLifecycleState(
      shortSchedule,
      new Date("2026-10-24T22:00:00.000Z"),
    ),
    "ended",
  );
});

test("keeps stored active and manually inactive states distinct from ended schedules", () => {
  assert.equal(
    getRecurringLifecycleState(
      { ...shortSchedule, isActive: true, nextRunDate: "2026-10-20" },
      new Date("2026-10-20T12:00:00.000Z"),
    ),
    "active",
  );
  assert.equal(
    getRecurringLifecycleState(
      { ...shortSchedule, nextRunDate: "2026-10-20" },
      new Date("2026-10-20T12:00:00.000Z"),
    ),
    "inactive",
  );
});
