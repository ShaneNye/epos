const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const CASE_SUMMARY_KEY = "ai.cases.summary.enabled";

let initialized = false;

function parseAuthToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return String(req.query.token || "").trim();
}

async function requireSession(req, res, next) {
  try {
    const token = parseAuthToken(req);
    if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const session = await getSession(token);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

    req.session = session;
    next();
  } catch (err) {
    console.error("AI manager auth error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to validate session" });
  }
}

async function ensureTables() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  initialized = true;
}

function settingBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

async function getCaseSettings() {
  await ensureTables();
  const result = await pool.query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [CASE_SUMMARY_KEY]);
  return {
    caseSummaryEnabled: settingBool(result.rows[0]?.value, false),
  };
}

async function saveCaseSettings(payload = {}) {
  await ensureTables();
  const caseSummaryEnabled = settingBool(payload.caseSummaryEnabled, false);
  await pool.query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [CASE_SUMMARY_KEY, caseSummaryEnabled ? "true" : "false"]
  );
  return getCaseSettings();
}

router.get("/cases/settings", requireSession, async (req, res) => {
  try {
    res.json({ ok: true, settings: await getCaseSettings() });
  } catch (err) {
    console.error("GET /api/ai-manager/cases/settings error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load AI case settings" });
  }
});

router.put("/cases/settings", requireSession, async (req, res) => {
  try {
    res.json({ ok: true, settings: await saveCaseSettings(req.body?.settings || req.body || {}) });
  } catch (err) {
    console.error("PUT /api/ai-manager/cases/settings error:", err.message);
    res.status(400).json({ ok: false, error: err.message || "Failed to save AI case settings" });
  }
});

module.exports = router;
