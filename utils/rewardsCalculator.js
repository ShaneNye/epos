const COMMISSION_RATE = 0.021;
const STORE_MANAGER_RATE = 0.00172;

function getPayPeriod(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - (now.getDate() < 14 ? 1 : 0), 14);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 14);
  return { start, end };
}

function parseNetSuiteDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value ?? "").trim();
  const ukDate = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (ukDate) {
    let hour = Number(ukDate[4] || 0);
    const meridiem = String(ukDate[7] || "").toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    return new Date(Number(ukDate[3]), Number(ukDate[2]) - 1, Number(ukDate[1]), hour, Number(ukDate[5] || 0), Number(ukDate[6] || 0));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function filterRowsToPayPeriod(rows = [], period = getPayPeriod(), dateKeys = ["Date", "date"]) {
  return rows.filter((row) => {
    const value = dateKeys.map((key) => row?.[key]).find((candidate) => candidate != null && candidate !== "");
    const date = parseNetSuiteDate(value);
    return date && date >= period.start && date < period.end;
  });
}

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

function locationKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function daysInMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

function calculateAnnualLeaveReward(currentReward, leaveDays, now = new Date()) {
  const reward = Number(currentReward) || 0;
  const quantity = Math.max(0, Number(leaveDays) || 0);
  const totalDays = daysInMonth(now);
  const workedDays = totalDays - quantity;
  if (!reward || !quantity || workedDays <= 0) return 0;
  return money((reward / workedDays) * totalDays - reward);
}

function applyAnnualLeaveRewards(summary, leaveEntries = [], now = new Date()) {
  const leaveByName = new Map(leaveEntries.map((row) => [locationKey(row.name), row]));
  let totalAnnualLeaveReward = 0;
  const leaderboard = summary.leaderboard.map((person) => {
    const leave = leaveByName.get(locationKey(person.name));
    const annualLeaveQuantity = Math.max(0, Number(leave?.quantity) || 0);
    const annualLeaveReward = calculateAnnualLeaveReward(person.reward, annualLeaveQuantity, now);
    totalAnnualLeaveReward += annualLeaveReward;
    return {
      ...person,
      userId: leave?.userId || null,
      annualLeaveQuantity,
      annualLeaveReward,
      totalReward: money(person.totalReward + annualLeaveReward),
    };
  });
  totalAnnualLeaveReward = money(totalAnnualLeaveReward);
  return {
    ...summary,
    leaderboard,
    totalAnnualLeaveReward,
    totalRewardAfterAdjustments: money(summary.totalRewardAfterAdjustments + totalAnnualLeaveReward),
  };
}

function summarizeRewards(rows, adjustmentRows, storeManagers = []) {
  const rewards = summarize(rows);
  const people = new Map(rewards.leaderboard.map((person) => [person.name, { ...person, adjustment: 0 }]));
  let totalAdjustment = 0;
  for (const row of adjustmentRows) {
    totalAdjustment += row.amountIncTax * COMMISSION_RATE;
    const current = people.get(row.bedSpecialist) || { name: row.bedSpecialist, sales: 0, reward: 0, orderCount: 0, lineCount: 0, adjustment: 0 };
    current.adjustment += row.amountIncTax * COMMISSION_RATE;
    people.set(row.bedSpecialist, current);
  }
  const revenueByLocation = new Map();
  for (const row of rows) {
    const key = locationKey(row.subsidiary);
    if (key) revenueByLocation.set(key, (revenueByLocation.get(key) || 0) + row.amountIncTax);
  }
  const personNames = new Map([...people.keys()].map((name) => [locationKey(name), name]));
  for (const store of storeManagers) {
    const managerName = String(store.managerName || "").trim();
    if (!managerName) continue;
    const storeRevenue = revenueByLocation.get(locationKey(store.locationName)) || 0;
    if (!storeRevenue) continue;
    const existingName = personNames.get(locationKey(managerName));
    const personKey = existingName || managerName;
    const current = people.get(personKey) || { name: managerName, sales: 0, reward: 0, orderCount: 0, lineCount: 0, adjustment: 0 };
    current.storeRevenue = (current.storeRevenue || 0) + storeRevenue;
    current.managerReward = (current.managerReward || 0) + storeRevenue * STORE_MANAGER_RATE;
    people.set(personKey, current);
    personNames.set(locationKey(managerName), personKey);
  }
  const leaderboard = [...people.values()].map((person) => ({
    ...person,
    adjustment: money(person.adjustment),
    storeRevenue: money(person.storeRevenue),
    managerReward: money(person.managerReward),
    totalReward: money(person.reward - person.adjustment + (person.managerReward || 0)),
  })).sort((a, b) => b.totalReward - a.totalReward || a.name.localeCompare(b.name));
  const totalManagerReward = money(leaderboard.reduce((total, person) => total + person.managerReward, 0));
  return { ...rewards, totalAdjustment: money(totalAdjustment), totalManagerReward, totalRewardAfterAdjustments: money(rewards.totalReward - totalAdjustment + totalManagerReward), specialistCount: leaderboard.length, leaderboard };
}

module.exports = { COMMISSION_RATE, STORE_MANAGER_RATE, getPayPeriod, parseNetSuiteDate, filterRowsToPayPeriod, normalizeRow, normalizeAdjustmentRow, normalizeLineValueChanges, summarize, summarizeRewards, daysInMonth, calculateAnnualLeaveReward, applyAnnualLeaveRewards };
