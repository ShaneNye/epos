const test = require("node:test");
const assert = require("node:assert/strict");
const { getPayPeriod, filterRowsToPayPeriod, normalizeRow, normalizeAdjustmentRow, normalizeLineValueChanges, summarize, summarizeRewards, COMMISSION_RATE, STORE_MANAGER_RATE, daysInMonth, calculateAnnualLeaveReward, applyAnnualLeaveRewards } = require("../utils/rewardsCalculator");
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

test("store managers receive 0.172 percent of revenue from their configured locations", () => {
  const rows = [
    normalizeRow({ bed_specialist: "Alex Smith", subsidiary: "Ashford", tranid: "SO1", amount_inc_tax: "1000" }),
    normalizeRow({ bed_specialist: "Sam Jones", subsidiary: "Ashford", tranid: "SO2", amount_inc_tax: "500" }),
    normalizeRow({ bed_specialist: "Sam Jones", subsidiary: "Canterbury", tranid: "SO3", amount_inc_tax: "200" }),
  ];
  const result = summarizeRewards(rows, [], [
    { locationName: "Ashford", managerName: "Emily Fellows" },
    { locationName: "Canterbury", managerName: "Sam Jones" },
  ]);
  const emily = result.leaderboard.find((person) => person.name === "Emily Fellows");
  const sam = result.leaderboard.find((person) => person.name === "Sam Jones");
  assert.equal(STORE_MANAGER_RATE, 0.00172);
  assert.deepEqual([emily.storeRevenue, emily.managerReward, emily.totalReward], [1500, 2.58, 2.58]);
  assert.deepEqual([sam.storeRevenue, sam.managerReward, sam.totalReward], [200, 0.34, 15.04]);
  assert.equal(result.totalManagerReward, 2.92);
});

test("rewards dashboard exposes the store manager reward column", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "rewards-dashboard.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "public", "js", "rewards-dashboard.js"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "rewards.js"), "utf8");
  assert.match(html, /<th>Store Manager reward<\/th>/);
  assert.match(client, /person\.managerReward \|\| 0/);
  assert.match(route, /LEFT JOIN users u ON u\.id = l\.store_manager/);
});

test("rewards dashboard hides order and qualifying-sales summary columns", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "rewards-dashboard.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "public", "js", "rewards-dashboard.js"), "utf8");
  assert.doesNotMatch(html, /<th>Orders<\/th>|<th>Qualifying sales<\/th>/);
  assert.doesNotMatch(client, /<td>\$\{person\.orderCount\}<\/td>|money\.format\(person\.sales\)/);
  assert.match(client, /state\.isHrManager \? 8 : 7/);
});

test("rewards dashboard excludes non-participating leaderboard users", () => {
  const client = fs.readFileSync(path.join(__dirname, "..", "public", "js", "rewards-dashboard.js"), "utf8");
  assert.match(client, /new Set\(\["internet user", "drew hopkins", "katrina colebourne"\]\)/);
  assert.match(client, /!excludedLeaderboardNames\.has\(person\.name\.trim\(\)\.toLowerCase\(\)\)/);
});

test("annual leave uplifts current-month reward using calendar days in the month", () => {
  const now = new Date(2026, 7, 19);
  assert.equal(daysInMonth(now), 31);
  assert.equal(calculateAnnualLeaveReward(225.8, 2, now), 15.57);
  assert.equal(calculateAnnualLeaveReward(776.81, 5, now), 149.39);
  const base = summarizeRewards([normalizeRow({ bed_specialist: "Emily Fellows", tranid: "SO1", amount_inc_tax: "1000" })], []);
  const result = applyAnnualLeaveRewards(base, [{ userId: 42, name: "Emily Fellows", quantity: 3 }], now);
  const emily = result.leaderboard[0];
  assert.deepEqual([emily.userId, emily.annualLeaveQuantity, emily.annualLeaveReward], [42, 3, 2.25]);
  assert.equal(emily.totalReward, 23.25);
});

test("annual leave controls are HR-only and persisted by calendar month", () => {
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "rewards.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "rewards-dashboard.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "public", "js", "rewards-dashboard.js"), "utf8");
  assert.match(route, /CREATE TABLE IF NOT EXISTS reward_annual_leave/);
  assert.match(route, /if \(!isHrManager\(session\)\) return res\.status\(403\)/);
  assert.match(route, /ON CONFLICT \(user_id, period_start\) DO UPDATE/);
  assert.match(html, /id="annualLeaveDaysHeader" hidden/);
  assert.match(html, /<th>Annual leave reward<\/th>/);
  assert.match(client, /state\.isHrManager \? `<td class="annual-leave-quantity/);
  assert.doesNotMatch(client, /person\.userId \? "" : "disabled"/);
  assert.match(client, /person\.userId \|\| "by-name"/);
  assert.match(route, /LOWER\(TRIM\(CONCAT\(firstname, ' ', lastname\)\)\) = LOWER\(\$1\)/);
  assert.match(client, /state\.isHrManager = String\(me\.activeRole \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "hr manager"/);
  assert.match(client, /state\.isHrManager = state\.isHrManager \|\| rewards\.canEditAnnualLeave === true/);
  assert.doesNotMatch(client, /state\.isHrManager = state\.isHrManager && rewards\.canEditAnnualLeave/);
});

test("HR Managers can load rewards even without the configurable dashboard permission", () => {
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "rewards.js"), "utf8");
  assert.match(route, /async function hasRewardsAccess\(session\) \{\s*[\s\S]*?if \(isHrManager\(session\)\) return true;/);
});
