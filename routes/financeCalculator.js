const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();
const SETTINGS_KEY = "finance.calculator.tiers";
const DEFAULT_TIERS = [
  {
    minSaleAmount: 0,
    maxSaleAmount: 999999.99,
    minTermMonths: 6,
    maxTermMonths: 36,
    minimumDepositPercent: 10,
    interestBearing: false,
    interestRatePercent: 0,
  },
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
  if (!Array.isArray(value) || !value.length) throw new Error("Add at least one sale amount band");
  const tiers = value.map((tier) => {
    const normalized = {
      minSaleAmount: number(tier.minSaleAmount, "Minimum sale amount"),
      maxSaleAmount: number(tier.maxSaleAmount, "Maximum sale amount"),
      minTermMonths: number(tier.minTermMonths, "Minimum term", { min: 1, max: 120 }),
      maxTermMonths: number(tier.maxTermMonths, "Maximum term", { min: 1, max: 120 }),
      minimumDepositPercent: number(tier.minimumDepositPercent, "Minimum deposit", { max: 100 }),
      interestBearing: Boolean(tier.interestBearing),
      interestRatePercent: 0,
    };
    normalized.interestRatePercent = normalized.interestBearing
      ? number(tier.interestRatePercent, "Interest rate", { max: 100 })
      : 0;
    if (normalized.maxSaleAmount < normalized.minSaleAmount) {
      throw new Error("Maximum sale amount cannot be below its minimum");
    }
    if (normalized.maxTermMonths < normalized.minTermMonths) {
      throw new Error("Maximum term cannot be below its minimum");
    }
    return normalized;
  }).sort((a, b) => a.minSaleAmount - b.minSaleAmount);

  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].minSaleAmount <= tiers[index - 1].maxSaleAmount) {
      throw new Error("Sale amount bands cannot overlap");
    }
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
