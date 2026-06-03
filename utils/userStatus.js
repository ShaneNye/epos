const pool = require("../db");

const VALID_USER_STATUSES = new Set(["available", "busy", "unavailable"]);

let initPromise;

function ensureUserStatusColumn() {
  if (!initPromise) {
    initPromise = (async () => {
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS epos_status TEXT NOT NULL DEFAULT 'available'");
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS epos_status_emoji TEXT");
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS epos_status_text TEXT");
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS epos_status_expires_at TIMESTAMPTZ");
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function cleanupExpiredUserStatuses() {
  await ensureUserStatusColumn();
  await pool.query(`
    UPDATE users
       SET epos_status = 'available',
           epos_status_emoji = NULL,
           epos_status_text = NULL,
           epos_status_expires_at = NULL
     WHERE epos_status_expires_at IS NOT NULL
       AND epos_status_expires_at <= NOW();
  `);
}

function normalizeUserStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return VALID_USER_STATUSES.has(status) ? status : "available";
}

function normalizeStatusText(value) {
  return String(value || "").trim().slice(0, 80);
}

function normalizeStatusEmoji(value) {
  return String(value || "").trim().slice(0, 12);
}

function statusExpirySql() {
  return `
    CASE
      WHEN (NOW() AT TIME ZONE 'Europe/London')::time >= TIME '17:00'
        THEN (((NOW() AT TIME ZONE 'Europe/London')::date + 1 + TIME '17:00') AT TIME ZONE 'Europe/London')
      ELSE (((NOW() AT TIME ZONE 'Europe/London')::date + TIME '17:00') AT TIME ZONE 'Europe/London')
    END
  `;
}

module.exports = {
  VALID_USER_STATUSES,
  cleanupExpiredUserStatuses,
  ensureUserStatusColumn,
  normalizeUserStatus,
  normalizeStatusEmoji,
  normalizeStatusText,
  statusExpirySql,
};
