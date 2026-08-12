const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRow, summarize, COMMISSION_RATE } = require("../utils/rewardsCalculator");

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
