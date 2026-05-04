const assert = require("node:assert/strict");
const test = require("node:test");
const { getBusinessDate } = require("../utils/businessDate");

test("getBusinessDate uses Europe/London rather than UTC by default", () => {
  const lateUtcBeforeLondonMidnight = new Date("2026-05-01T23:30:00.000Z");

  assert.equal(getBusinessDate(lateUtcBeforeLondonMidnight), "2026-05-02");
});

test("getBusinessDate can be evaluated in a specific timezone", () => {
  const instant = new Date("2026-01-01T01:00:00.000Z");

  assert.equal(getBusinessDate(instant, "UTC"), "2026-01-01");
  assert.equal(getBusinessDate(instant, "America/New_York"), "2025-12-31");
});
