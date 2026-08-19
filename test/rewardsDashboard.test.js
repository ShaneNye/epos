const test = require("node:test");
const assert = require("node:assert/strict");
const { getPayPeriod, filterRowsToPayPeriod, normalizeRow, normalizeAdjustmentRow, normalizeLineValueChanges, summarize, summarizeRewards, COMMISSION_RATE } = require("../utils/rewardsCalculator");
const fs = require("node:fs");
const path = require("node:path");

test("pay period runs from the 14th inclusive to the next 14th exclusive", () => {
  const period = getPayPeriod(new Date(2026, 7, 14, 12));
  assert.deepEqual([period.start.getFullYear(), period.start.getMonth(), period.start.getDate()], [2026, 7, 14]);
  assert.deepEqual([period.end.getFullYear(), period.end.getMonth(), period.end.getDate()], [2026, 8, 14]);
  const rows = filterRowsToPayPeriod([
    { Date: "13/08/2026 11:59 PM" },
    { Date: "14/08/2026 12:00 AM" },
    { Date: "13/09/2026 11:59 PM" },
    { Date: "14/09/2026 12:00 AM" },
  ], period);
  assert.deepEqual(rows.map((row) => row.Date), ["14/08/2026 12:00 AM", "13/09/2026 11:59 PM"]);
});

test("dates before the 14th use the pay period beginning in the previous month", () => {
  const period = getPayPeriod(new Date(2026, 7, 13, 12));
  assert.deepEqual([period.start.getFullYear(), period.start.getMonth(), period.start.getDate()], [2026, 6, 14]);
  assert.deepEqual([period.end.getFullYear(), period.end.getMonth(), period.end.getDate()], [2026, 7, 14]);
});

test("rewards dashboard applies a 2.1 percent reward and groups specialists", () => {
  const rows = [
    normalizeRow({ date: "01/08/2026", bed_specialist: "Alex Smith", tranid: "SO1", amount_inc_tax: "100.00" }),
    normalizeRow({ date: "02/08/2026", bed_specialist: "Alex Smith", tranid: "SO1", amount_inc_tax: "50.00" }),
    normalizeRow({ date: "03/08/2026", bed_specialist: "Sam Jones", tranid: "SO2", amount_inc_tax: "200.00" }),
  ];
  const result = summarize(rows);
  assert.equal(COMMISSION_RATE, 0.021);
  assert.equal(result.totalSales, 350);
  assert.equal(result.totalReward, 7.35);
  assert.equal(result.orderCount, 2);
  assert.deepEqual(result.leaderboard.map((person) => [person.name, person.reward]), [["Sam Jones", 4.2], ["Alex Smith", 3.15]]);
});

test("adjustments are deducted from reward and include adjustment-only specialists", () => {
  const rows = [normalizeRow({ bed_specialist: "Alex Smith", tranid: "SO1", amount_inc_tax: "1000" })];
  const adjustments = [
    normalizeAdjustmentRow({ bed_specialist: "Alex Smith", tranid: "SO0", amount_inc_tax: "100" }),
    normalizeAdjustmentRow({ bed_specialist: "Sam Jones", tranid: "SO2", amount_inc_tax: "50" }),
  ];
  const result = summarizeRewards(rows, adjustments);
  assert.equal(adjustments[0].reason, "Line closed");
  assert.equal(adjustments[0].adjustment, 2.1);
  assert.equal(result.totalAdjustment, 3.15);
  assert.equal(result.totalRewardAfterAdjustments, 17.85);
  assert.deepEqual(result.leaderboard.map(({ name, adjustment, totalReward }) => [name, adjustment, totalReward]), [["Alex Smith", 2.1, 18.9], ["Sam Jones", 1.05, -1.05]]);
});

test("negative qualifying lines reduce sales and rewards", () => {
  const rows = [
    normalizeRow({ bed_specialist: "Alex Smith", tranid: "SO1", amount_inc_tax: "100.00" }),
    normalizeRow({ bed_specialist: "Alex Smith", tranid: "SO1", amount_inc_tax: "-25.00" }),
  ];
  const result = summarize(rows);

  assert.equal(rows[1].amountIncTax, -25);
  assert.equal(rows[1].reward, -0.53);
  assert.equal(result.totalSales, 75);
  assert.equal(result.totalReward, 1.58);
  assert.equal(result.leaderboard[0].reward, 1.58);
});

test("line value changes net repeated changes and retain positive or negative adjustments", () => {
  const changes = normalizeLineValueChanges([
    { "Internal ID": "1", Date: "03/07/2026 3:30 PM", "Bed Specialist": "Justin Parnell", "Document Number": "SO1", "Old Value": "0.00", "New Value": "1,267.50", Item: "Mattress" },
    { "Internal ID": "1", Date: "03/07/2026 2:37 PM", "Bed Specialist": "Justin Parnell", "Document Number": "SO1", "Old Value": "1267.50", "New Value": "0.00", Item: "Mattress" },
    { "Internal ID": "2", Date: "25/07/2026 9:18 AM", "Bed Specialist": "Fay Hodson", "Document Number": "SO2", "Old Value": "2876.50", "New Value": "2528.16", Item: "Base" },
    { "Internal ID": "2", Date: "25/07/2026 11:50 AM", "Bed Specialist": "Fay Hodson", "Document Number": "SO2", "Old Value": "2528.16", "New Value": "775.47", Item: "Base" },
    { "Internal ID": "3", "Bed Specialist": "Alex Smith", "Document Number": "SO3", "Old Value": "100", "New Value": "200", Item: "Bed" },
  ]);

  assert.equal(changes.length, 2);
  assert.equal(changes[0].reason, "Value changed after payout");
  assert.deepEqual(changes.map(({ bedSpecialist, amountIncTax, adjustment }) => [bedSpecialist, amountIncTax, adjustment]), [
    ["Fay Hodson", 2101.03, 44.12],
    ["Alex Smith", -100, -2.1],
  ]);
});

test("rewards keep sales live while caching adjustment feeds for one hour", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "rewards.js"), "utf8");
  assert.match(source, /REWARDS_ADJUSTMENTS_CACHE_TTL_MS \|\| 60 \* 60 \* 1000/);
  assert.match(source, /fetchSuiteQLRows\(baseUrl, REWARDS_SUITEQL, userId\)/);
  assert.match(source, /getCachedAdjustments\(baseUrl, userId, period\)/);
  assert.match(source, /cached\?\.value && cached\.expiresAt > now/);
  assert.match(source, /if \(cached\?\.inFlight\) return cached\.inFlight/);
});
