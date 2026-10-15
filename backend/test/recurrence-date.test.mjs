import assert from "node:assert/strict";
import test from "node:test";
import {
  getRecurrenceDate,
  getRecurrenceIndex,
} from "../src/utils/recurrence-date.ts";

test("calculates daily recurrences at intervals", () => {
  assert.equal(getRecurrenceDate("2026-10-12", "DAILY", 1, 0), "2026-10-12");
  assert.equal(getRecurrenceDate("2026-10-12", "DAILY", 2, 3), "2026-10-18");
});

test("calculates weekly recurrences at intervals and across year boundaries", () => {
  assert.equal(getRecurrenceDate("2026-12-20", "WEEKLY", 1, 2), "2027-01-03");
  assert.equal(getRecurrenceDate("2026-10-12", "WEEKLY", 3, 2), "2026-11-23");
});

test("clamps monthly recurrences to month end without drifting from the anchor", () => {
  assert.equal(getRecurrenceDate("2025-01-31", "MONTHLY", 1, 1), "2025-02-28");
  assert.equal(getRecurrenceDate("2025-01-31", "MONTHLY", 1, 2), "2025-03-31");
  assert.equal(getRecurrenceDate("2024-01-31", "MONTHLY", 1, 1), "2024-02-29");
  assert.equal(getRecurrenceDate("2026-11-30", "MONTHLY", 2, 1), "2027-01-30");
});

test("returns leap-day yearly recurrences to February 29 in leap years", () => {
  assert.equal(getRecurrenceDate("2024-02-29", "YEARLY", 1, 1), "2025-02-28");
  assert.equal(getRecurrenceDate("2024-02-29", "YEARLY", 1, 4), "2028-02-29");
  assert.equal(getRecurrenceDate("2024-02-29", "YEARLY", 4, 1), "2028-02-29");
});

test("rejects invalid dates, frequencies, intervals, and occurrence indexes", () => {
  assert.throws(() => getRecurrenceDate("2025-02-29", "DAILY", 1, 0), RangeError);
  assert.throws(() => getRecurrenceDate("0000-01-01", "DAILY", 1, 0), RangeError);
  assert.throws(() => getRecurrenceDate("2025-2-01", "DAILY", 1, 0), RangeError);
  assert.throws(() => getRecurrenceDate("2026-01-01", "DAILY", 0, 0), RangeError);
  assert.throws(() => getRecurrenceDate("2026-01-01", "DAILY", 1.5, 0), RangeError);
  assert.throws(() => getRecurrenceDate("2026-01-01", "DAILY", 1, -1), RangeError);
  assert.throws(() => getRecurrenceDate("2026-01-01", "HOURLY", 1, 0), RangeError);
  assert.throws(() => getRecurrenceDate("9999-12-31", "DAILY", 1, 1), RangeError);
});

test("finds occurrence indexes for all frequencies with intervals greater than one", () => {
  const cases = [
    ["2026-10-12", "DAILY", 3, 4],
    ["2026-12-20", "WEEKLY", 2, 5],
    ["2026-01-31", "MONTHLY", 3, 8],
    ["2024-02-29", "YEARLY", 4, 3],
  ];

  for (const [startDate, frequency, interval, index] of cases) {
    const scheduledDate = getRecurrenceDate(startDate, frequency, interval, index);
    assert.equal(
      getRecurrenceIndex(startDate, frequency, interval, scheduledDate),
      index,
    );
  }
});

test("returns null for dates before the anchor or off the recurrence sequence", () => {
  assert.equal(getRecurrenceIndex("2026-10-12", "DAILY", 2, "2026-10-11"), null);
  assert.equal(getRecurrenceIndex("2026-10-12", "DAILY", 2, "2026-10-15"), null);
  assert.equal(getRecurrenceIndex("2026-10-12", "WEEKLY", 2, "2026-10-19"), null);
  assert.equal(getRecurrenceIndex("2026-10-12", "MONTHLY", 2, "2026-11-12"), null);
  assert.equal(getRecurrenceIndex("2026-10-12", "YEARLY", 2, "2027-10-12"), null);
  assert.equal(getRecurrenceIndex("2026-01-12", "YEARLY", 1, "2027-02-12"), null);
});

test("matches monthly end-of-month clamping and restores the anchor day", () => {
  for (const [startDate, february, march] of [
    ["2025-01-29", "2025-02-28", "2025-03-29"],
    ["2025-01-30", "2025-02-28", "2025-03-30"],
    ["2025-01-31", "2025-02-28", "2025-03-31"],
  ]) {
    assert.equal(getRecurrenceIndex(startDate, "MONTHLY", 1, february), 1);
    assert.equal(getRecurrenceIndex(startDate, "MONTHLY", 1, march), 2);
  }

  assert.equal(getRecurrenceIndex("2024-01-31", "MONTHLY", 1, "2024-02-29"), 1);
  assert.equal(getRecurrenceIndex("2024-02-29", "MONTHLY", 1, "2025-02-28"), 12);
  assert.equal(getRecurrenceIndex("2024-02-29", "MONTHLY", 1, "2025-03-29"), 13);
});

test("matches yearly February 29 dates in leap and non-leap years", () => {
  assert.equal(getRecurrenceIndex("2024-02-29", "YEARLY", 1, "2025-02-28"), 1);
  assert.equal(getRecurrenceIndex("2024-02-29", "YEARLY", 1, "2028-02-29"), 4);
  assert.equal(getRecurrenceIndex("2024-02-29", "YEARLY", 4, "2028-02-29"), 1);
  assert.equal(getRecurrenceIndex("2024-02-29", "YEARLY", 4, "2025-02-28"), null);
});

test("handles month/year boundaries and far-future indexes directly", () => {
  assert.equal(getRecurrenceIndex("2026-12-31", "MONTHLY", 1, "2027-01-31"), 1);
  assert.equal(getRecurrenceIndex("2026-12-31", "YEARLY", 1, "2027-12-31"), 1);
  assert.equal(
    getRecurrenceIndex("0001-01-01", "DAILY", 1, "9999-12-31"),
    3_652_058,
  );
});

test("rejects invalid dates, formats, frequencies, and intervals for inverse lookup", () => {
  assert.throws(() => getRecurrenceIndex("2025-02-29", "DAILY", 1, "2025-03-01"), RangeError);
  assert.throws(() => getRecurrenceIndex("2025-01-01", "DAILY", 1, "2025-02-30"), RangeError);
  assert.throws(() => getRecurrenceIndex("2025-1-01", "DAILY", 1, "2025-02-01"), RangeError);
  assert.throws(() => getRecurrenceIndex("2025-01-01", "DAILY", 1, "2025-2-01"), RangeError);
  assert.throws(() => getRecurrenceIndex("2025-01-01", "HOURLY", 1, "2025-01-02"), RangeError);
  assert.throws(() => getRecurrenceIndex("2025-01-01", "DAILY", 0, "2025-01-02"), RangeError);
  assert.throws(() => getRecurrenceIndex("2025-01-01", "DAILY", 1.5, "2025-01-02"), RangeError);
});
