const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const CUSTOMER_SERVICE_KEY = "releases.customer_service.enabled";

let initialized = false;

function parseAuthToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return String(req.query.token || "").trim();
}

async function requireSession(req, res, next) {
  try {
    const token = parseAuthToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    req.session = session;
    next();
  } catch (err) {
    console.error("Releases auth error:", err.message);
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

function settingBool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

function currentEnvironment() {
  return String(process.env.ENVIROMENT || process.env.ENVIRONMENT || "sandbox").trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

async function getReleaseSettings() {
  await ensureTables();
  const result = await pool.query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [CUSTOMER_SERVICE_KEY]);
  const customerServiceEnabled = settingBool(result.rows[0]?.value, true);
  const environment = currentEnvironment();

  return {
    environment,
    settings: {
      customerServiceEnabled,
      customerServiceVisible: environment !== "production" || customerServiceEnabled,
    },
  };
}

async function saveReleaseSettings(payload = {}) {
  await ensureTables();
  const customerServiceEnabled = settingBool(payload.customerServiceEnabled, true);
  await pool.query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [CUSTOMER_SERVICE_KEY, customerServiceEnabled ? "true" : "false"]
  );
  return getReleaseSettings();
}

router.get("/settings", requireSession, async (req, res) => {
  try {
    res.json({ ok: true, ...(await getReleaseSettings()) });
  } catch (err) {
    console.error("GET /api/releases/settings error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load release settings" });
  }
});

router.put("/settings", requireSession, async (req, res) => {
  try {
    res.json({ ok: true, ...(await saveReleaseSettings(req.body?.settings || req.body || {})) });
  } catch (err) {
    console.error("PUT /api/releases/settings error:", err.message);
    res.status(400).json({ ok: false, error: err.message || "Failed to save release settings" });
  }
});

module.exports = router;
