const pool = require("../db");
const { getSession } = require("../sessions");

let initPromise;

function ensureCashBalanceAuditTable() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS cash_balance_audit (
        id SERIAL PRIMARY KEY,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        balance_type TEXT NOT NULL CHECK (balance_type IN ('float', 'safe')),
        change_source TEXT NOT NULL CHECK (change_source IN ('manual', 'eod')),
        old_balance NUMERIC(12,2) NOT NULL,
        adjustment_amount NUMERIC(12,2) NOT NULL,
        new_balance NUMERIC(12,2) NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by_name TEXT,
        reference_type TEXT,
        reference_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_cash_balance_audit_location_created
        ON cash_balance_audit(location_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_cash_balance_audit_reference
        ON cash_balance_audit(reference_type, reference_id);
    `);
  }

  return initPromise;
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(2));
}

function sessionUserId(session) {
  return session?.id || session?.user_id || null;
}

async function resolveUserContextFromRequest(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { id: null, name: null };

  const session = await getSession(token);
  if (!session) return { id: null, name: null };

  return {
    id: sessionUserId(session),
    name: session.name || session.email || null,
  };
}

async function logCashBalanceChange(client, change) {
  await ensureCashBalanceAuditTable();

  const oldBalance = money(change.oldBalance);
  const newBalance = money(change.newBalance);
  const adjustmentAmount = money(
    change.adjustmentAmount ?? newBalance - oldBalance
  );

  if (oldBalance === newBalance && adjustmentAmount === 0) return;

  await client.query(
    `INSERT INTO cash_balance_audit
      (
        location_id,
        balance_type,
        change_source,
        old_balance,
        adjustment_amount,
        new_balance,
        updated_by,
        updated_by_name,
        reference_type,
        reference_id
      )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      change.locationId,
      change.balanceType,
      change.changeSource,
      oldBalance,
      adjustmentAmount,
      newBalance,
      change.updatedBy || null,
      change.updatedByName || null,
      change.referenceType || null,
      change.referenceId || null,
    ]
  );
}

module.exports = {
  ensureCashBalanceAuditTable,
  logCashBalanceChange,
  resolveUserContextFromRequest,
  money,
};
