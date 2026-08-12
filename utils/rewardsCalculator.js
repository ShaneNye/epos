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

module.exports = { COMMISSION_RATE, normalizeRow, summarize };
