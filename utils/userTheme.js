const pool = require("../db");

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

async function ensureUserThemeColumns() {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS themeaccenthex VARCHAR(20)
  `);
}

function normalizeHexColor(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toUpperCase() : undefined;
}

module.exports = {
  ensureUserThemeColumns,
  normalizeHexColor,
};
