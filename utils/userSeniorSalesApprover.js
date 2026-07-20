const pool = require("../db");

let initPromise;

function ensureUserSeniorSalesApproverColumn() {
  if (!initPromise) {
    initPromise = pool
      .query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS senior_sales_approver BOOLEAN NOT NULL DEFAULT FALSE"
      )
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

function normalizeSeniorSalesApproverFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

module.exports = {
  ensureUserSeniorSalesApproverColumn,
  normalizeSeniorSalesApproverFlag,
};
