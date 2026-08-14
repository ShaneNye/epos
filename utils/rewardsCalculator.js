const COMMISSION_RATE = 0.021;

function money(value) {
  const amount = Number(value) || 0;
  return Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100) / 100;
}

function normalizeRow(row = {}) {
  const amount = money(row.amount_inc_tax ?? row.AMOUNT_INC_TAX);
  return {
    date: row.date ?? row.DATE ?? null,
    bedSpecialist: String(row.bed_specialist ?? row.BED_SPECIALIST ?? "Unassigned").trim() || "Unassigned",
    transaction: String(row.tranid ?? row.TRANID ?? "").trim(),
    subsidiary: String(row.subsidiary ?? row.SUBSIDIARY ?? "").trim(),
    item: String(row.item ?? row.ITEM ?? "").trim(),
    amountIncTax: amount,
    reward: money(amount * COMMISSION_RATE),
  };
}

function normalizeAdjustmentRow(row = {}) {
  const amount = money(row.amount_inc_tax ?? row.AMOUNT_INC_TAX);
  return {
    date: row.date ?? row.DATE ?? null,
    closeDate: row.custcol_sb_ln_close_date ?? row.CUSTCOL_SB_LN_CLOSE_DATE ?? null,
    bedSpecialist: String(row.bed_specialist ?? row.BED_SPECIALIST ?? "Unassigned").trim() || "Unassigned",
    transaction: String(row.tranid ?? row.TRANID ?? "").trim(),
    subsidiary: String(row.subsidiary ?? row.SUBSIDIARY ?? "").trim(),
    item: String(row.item ?? row.ITEM ?? "").trim(),
    amountIncTax: amount,
    adjustment: money(amount * COMMISSION_RATE),
    reason: "Line closed",
  };
}

function numberValue(value) {
  return Number(String(value ?? "0").replace(/,/g, "")) || 0;
}

function normalizeLineValueChanges(rows = []) {
  const changes = new Map();
  for (const row of rows) {
    const bedSpecialist = String(row["Bed Specialist"] ?? row.bedSpecialist ?? "Unassigned").trim() || "Unassigned";
    const transaction = String(row["Document Number"] ?? row.transaction ?? "").trim();
    const item = String(row.Item ?? row.item ?? "").trim();
    const internalId = String(row["Internal ID"] ?? row.internalId ?? "").trim();
    const key = [bedSpecialist, transaction, internalId || item].join("\u0000");
    const oldValue = numberValue(row["Old Value"] ?? row.oldValue);
    const newValue = numberValue(row["New Value"] ?? row.newValue);
    const current = changes.get(key) || {
      date: row.Date ?? row.date ?? null,
      bedSpecialist,
      transaction,
      subsidiary: "",
      item,
      amountIncTax: 0,
      source: "line-value-change",
      reason: "Value changed after payout",
    };
    // A decrease is a deduction; an increase is a negative deduction (credit).
    current.amountIncTax += oldValue - newValue;
    current.adjustment = money(current.amountIncTax * COMMISSION_RATE);
    changes.set(key, current);
  }
  return [...changes.values()]
    .map((row) => ({ ...row, amountIncTax: money(row.amountIncTax), adjustment: money(row.amountIncTax * COMMISSION_RATE) }))
    .filter((row) => row.amountIncTax !== 0);
}

function summarize(rows) {
  const people = new Map();
  const orders = new Set();
  let sales = 0;

  for (const row of rows) {
    sales += row.amountIncTax;
    if (row.transaction) orders.add(row.transaction);
    const current = people.get(row.bedSpecialist) || { name: row.bedSpecialist, sales: 0, reward: 0, orderIds: new Set(), lineCount: 0 };
    current.sales += row.amountIncTax;
    current.reward += row.amountIncTax * COMMISSION_RATE;
    current.lineCount += 1;
    if (row.transaction) current.orderIds.add(row.transaction);
    people.set(row.bedSpecialist, current);
  }

  const leaderboard = [...people.values()]
    .map((person) => ({ name: person.name, sales: money(person.sales), reward: money(person.reward), orderCount: person.orderIds.size, lineCount: person.lineCount }))
    .sort((a, b) => b.reward - a.reward || a.name.localeCompare(b.name));

  return { totalSales: money(sales), totalReward: money(sales * COMMISSION_RATE), orderCount: orders.size, specialistCount: leaderboard.length, leaderboard };
}

function summarizeRewards(rows, adjustmentRows) {
  const rewards = summarize(rows);
  const people = new Map(rewards.leaderboard.map((person) => [person.name, { ...person, adjustment: 0 }]));
  let totalAdjustment = 0;
  for (const row of adjustmentRows) {
    totalAdjustment += row.amountIncTax * COMMISSION_RATE;
    const current = people.get(row.bedSpecialist) || { name: row.bedSpecialist, sales: 0, reward: 0, orderCount: 0, lineCount: 0, adjustment: 0 };
    current.adjustment += row.amountIncTax * COMMISSION_RATE;
    people.set(row.bedSpecialist, current);
  }
  const leaderboard = [...people.values()].map((person) => ({
    ...person,
    adjustment: money(person.adjustment),
    totalReward: money(person.reward - person.adjustment),
  })).sort((a, b) => b.totalReward - a.totalReward || a.name.localeCompare(b.name));
  return { ...rewards, totalAdjustment: money(totalAdjustment), totalRewardAfterAdjustments: money(rewards.totalReward - totalAdjustment), specialistCount: leaderboard.length, leaderboard };
}

module.exports = { COMMISSION_RATE, normalizeRow, normalizeAdjustmentRow, normalizeLineValueChanges, summarize, summarizeRewards };
