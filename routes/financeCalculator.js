const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();
const SETTINGS_KEY = "finance.calculator.offers.v2";
const DEFAULT_TIERS = [
  { minOrderAmount: 500, minFinancedAmount: 0, termMonths: 6, depositPercent: 0, interestRatePercent: 0 },
  { minOrderAmount: 1000, minFinancedAmount: 0, termMonths: 12, depositPercent: 0, interestRatePercent: 0 },
  { minOrderAmount: 2500, minFinancedAmount: 0, termMonths: 24, depositPercent: 30, interestRatePercent: 0 },
  { minOrderAmount: 7000, minFinancedAmount: 0, termMonths: 36, depositPercent: 50, interestRatePercent: 0 },
  { minOrderAmount: 500, minFinancedAmount: 0, termMonths: 36, depositPercent: 0, interestRatePercent: 9.99 },
  { minOrderAmount: 1000, minFinancedAmount: 0, termMonths: 48, depositPercent: 10, interestRatePercent: 9.99 },
  { minOrderAmount: 1700, minFinancedAmount: 0, termMonths: 60, depositPercent: 20, interestRatePercent: 9.99 },
];

let initialized = false;

async function ensureTable() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  initialized = true;
}

function tokenFrom(req) {
  const header = String(req.headers.authorization || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function requireSession(req, res, next) {
  const session = await getSession(tokenFrom(req));
  if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });
  req.session = session;
  next();
}

async function requireSettingsAccess(req, res, next) {
  try {
    const roleName =
      typeof req.session.activeRole === "string"
        ? req.session.activeRole
        : req.session.activeRole?.name;
    const result = await pool.query(
      "SELECT access FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [roleName || ""]
    );
    let access = result.rows[0]?.access || [];
    if (typeof access === "string") {
      try { access = JSON.parse(access); } catch { access = []; }
    }
    const allowed = (access || []).map((value) => String(value).toLowerCase());
    if (!allowed.includes("finance-settings") && !allowed.includes("admin")) {
      return res.status(403).json({ ok: false, error: "Finance settings access required" });
    }
    next();
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to validate access" });
  }
}

function number(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return parsed;
}

function normalizeTiers(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("Add at least one finance band");
  const tiers = value.map((tier) => {
    const normalized = {
      minOrderAmount: number(tier.minOrderAmount, "Minimum order amount"),
      minFinancedAmount: number(tier.minFinancedAmount ?? 0, "Minimum financed amount"),
      termMonths: number(tier.termMonths, "Term", { min: 1, max: 120 }),
      depositPercent: number(tier.depositPercent, "Deposit required", { max: 100 }),
      interestRatePercent: number(tier.interestRatePercent, "Interest rate", { max: 100 }),
    };
    return normalized;
  }).sort((a, b) => a.interestRatePercent - b.interestRatePercent || a.termMonths - b.termMonths || a.minOrderAmount - b.minOrderAmount);

  const duplicates = new Set();
  for (const tier of tiers) {
    const key = `${tier.minOrderAmount}:${tier.termMonths}:${tier.interestRatePercent}`;
    if (duplicates.has(key)) throw new Error("Finance bands must have a unique minimum amount, term and APR");
    duplicates.add(key);
  }
  return tiers;
}

async function loadTiers() {
  await ensureTable();
  const result = await pool.query("SELECT value FROM app_settings WHERE key = $1", [SETTINGS_KEY]);
  if (!result.rows[0]) return DEFAULT_TIERS;
  try { return normalizeTiers(JSON.parse(result.rows[0].value)); }
  catch { return DEFAULT_TIERS; }
}

router.get("/settings", requireSession, async (req, res) => {
  try {
    res.json({ ok: true, tiers: await loadTiers() });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load finance settings" });
  }
});

router.put("/settings", requireSession, requireSettingsAccess, async (req, res) => {
  try {
    const tiers = normalizeTiers(req.body?.tiers);
    await ensureTable();
    await pool.query(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [SETTINGS_KEY, JSON.stringify(tiers)]);
    res.json({ ok: true, tiers });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Failed to save finance settings" });
  }
});

module.exports = router;
