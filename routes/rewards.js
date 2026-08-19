const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsPostRaw } = require("../netsuiteClient");
const { getNetSuiteAccountDash } = require("../utils/netsuiteEnvironment");
const { COMMISSION_RATE, STORE_MANAGER_RATE, getPayPeriod, filterRowsToPayPeriod, normalizeRow, normalizeAdjustmentRow, normalizeLineValueChanges, summarizeRewards, applyAnnualLeaveRewards } = require("../utils/rewardsCalculator");

const router = express.Router();
const PAGE_SIZE = 1000;
const MAX_ROWS = 10000;
const ADJUSTMENTS_CACHE_TTL_MS = Number(process.env.REWARDS_ADJUSTMENTS_CACHE_TTL_MS || 60 * 60 * 1000);
const adjustmentsCache = new Map();
const commissionHistoryCache = new Map();
let annualLeaveTableReady = false;

const REWARDS_SUITEQL = `
SELECT
    t.trandate AS date,
    BUILTIN.DF(t.custbody_sb_bedspecialist) AS bed_specialist,
    t.tranid,
    BUILTIN.DF(tl.subsidiary) AS subsidiary,
    BUILTIN.DF(tl.item) AS item,
    tl.taxrate,

    ROUND(
        (tl.amount * -1) * (1 + NVL(tl.taxrate, 0)),
        2
    ) AS amount_inc_tax

FROM
    Transaction t

INNER JOIN TransactionLine tl
    ON tl.transaction = t.id

WHERE
    t.type = 'SalesOrd'
    AND tl.mainline = 'F'
    AND tl.isclosed = 'F'

    AND UPPER(BUILTIN.DF(t.entity)) NOT LIKE '%I/C -%'

    AND NVL(t.customform, 0) <> 245

    AND BUILTIN.DF(t.status)
        NOT IN ('Pending Approval')

    AND t.trandate BETWEEN
        BUILTIN.RELATIVE_RANGES('TM', 'START')
        AND BUILTIN.RELATIVE_RANGES('TM', 'END')

    AND BUILTIN.DF(tl.item)
        NOT IN ('S-GB', 'E-GB')

ORDER BY
    t.trandate DESC,
    t.tranid`;

const ADJUSTMENTS_SUITEQL = `
SELECT t.trandate AS date,
    BUILTIN.DF(t.custbody_sb_bedspecialist) AS bed_specialist,
    t.tranid, BUILTIN.DF(tl.subsidiary) AS subsidiary,
    BUILTIN.DF(tl.item) AS item, tl.taxrate, tl.isclosed,
    tl.custcol_sb_ln_close_date,
    ROUND(ABS(tl.custcol_sb_precancelledamount) * (1 + NVL(tl.taxrate, 0)), 2) AS amount_inc_tax
FROM Transaction t
INNER JOIN TransactionLine tl ON tl.transaction = t.id
WHERE t.type = 'SalesOrd' AND tl.mainline = 'F' AND tl.isclosed = 'T'
    AND t.trandate >= ADD_MONTHS(TRUNC(SYSDATE), -6)
    AND tl.custcol_sb_ln_close_date >=
        ADD_MONTHS(TRUNC(SYSDATE, 'MM'), CASE WHEN EXTRACT(DAY FROM SYSDATE) >= 14 THEN 0 ELSE -1 END) + 13
    AND tl.custcol_sb_ln_close_date <= SYSDATE
    AND tl.custcol_sb_ln_close_date <
        ADD_MONTHS(ADD_MONTHS(TRUNC(SYSDATE, 'MM'), CASE WHEN EXTRACT(DAY FROM SYSDATE) >= 14 THEN 0 ELSE -1 END) + 13, 1)
    AND TRUNC(tl.custcol_sb_ln_close_date, 'MM') <> TRUNC(t.trandate, 'MM')
    AND UPPER(BUILTIN.DF(t.entity)) NOT LIKE '%I/C -%'
    AND NVL(t.customform, 0) <> 245
    AND NVL(t.custbody_sb_order_rebuilt, 'F') <> 'T'
    AND BUILTIN.DF(t.status) NOT IN ('Pending Approval')
    AND BUILTIN.DF(tl.item) NOT IN ('S-GB', 'E-GB')
ORDER BY t.trandate DESC, t.tranid`;

const COMMISSION_HISTORY_SUITEQL = `
SELECT BUILTIN.DF(t.custbody_sb_bedspecialist) AS bed_specialist,
       ROUND(SUM((tl.amount * -1) * (1 + NVL(tl.taxrate, 0))), 2) AS amount_inc_tax
FROM Transaction t
INNER JOIN TransactionLine tl ON tl.transaction = t.id
WHERE t.type = 'SalesOrd' AND tl.mainline = 'F' AND tl.isclosed = 'F'
  AND t.trandate BETWEEN ADD_MONTHS(TRUNC(SYSDATE), -6) AND SYSDATE
  AND UPPER(BUILTIN.DF(t.entity)) NOT LIKE '%I/C -%'
  AND NVL(t.customform, 0) <> 245
  AND BUILTIN.DF(t.status) NOT IN ('Pending Approval')
  AND BUILTIN.DF(tl.item) NOT IN ('S-GB', 'E-GB')
GROUP BY BUILTIN.DF(t.custbody_sb_bedspecialist)`;

async function fetchSuiteQLRows(baseUrl, query, userId) {
  const rawRows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const result = await nsPostRaw(`${baseUrl}?limit=${PAGE_SIZE}&offset=${offset}`, { q: query }, userId);
    const page = Array.isArray(result?.items) ? result.items : [];
    rawRows.push(...page);
    if (!result?.hasMore || page.length < PAGE_SIZE) break;
  }
  return rawRows;
}

async function fetchLineValueChanges() {
  const endpoint = String(process.env.COMS_LINE_ADJ_URL || "").trim().replace(/^['"]|['"]$/g, "");
  const token = String(process.env.COMS_LINE_ADJ || "").trim().replace(/^['"]|['"]$/g, "");
  if (!endpoint || !token) throw new Error("COMS_LINE_ADJ_URL or COMS_LINE_ADJ is not configured");
  const url = new URL(endpoint);
  url.searchParams.set("token", token);
  const response = await fetch(url.toString());
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("COMS_LINE_ADJ_URL returned invalid JSON"); }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `COMS_LINE_ADJ_URL returned ${response.status}`);
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function adjustmentCacheKey(baseUrl, period) {
  return `${baseUrl}:${period.start.toISOString()}:${period.end.toISOString()}`;
}

async function loadAdjustments(baseUrl, userId, period) {
  const [rawAdjustmentRows, rawLineValueChanges] = await Promise.all([
    fetchSuiteQLRows(baseUrl, ADJUSTMENTS_SUITEQL, userId),
    fetchLineValueChanges(),
  ]);
  const closedLineAdjustments = rawAdjustmentRows.slice(0, MAX_ROWS).map(normalizeAdjustmentRow);
  const currentLineValueChanges = filterRowsToPayPeriod(rawLineValueChanges.slice(0, MAX_ROWS), period);
  return {
    rows: [...closedLineAdjustments, ...normalizeLineValueChanges(currentLineValueChanges)],
    capped: rawAdjustmentRows.length >= MAX_ROWS || rawLineValueChanges.length >= MAX_ROWS,
    refreshedAt: new Date().toISOString(),
  };
}

async function getCachedAdjustments(baseUrl, userId, period) {
  const key = adjustmentCacheKey(baseUrl, period);
  const now = Date.now();
  const cached = adjustmentsCache.get(key);
  if (cached?.value && cached.expiresAt > now) {
    return { ...cached.value, source: "cache" };
  }
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = loadAdjustments(baseUrl, userId, period)
    .then((value) => {
      adjustmentsCache.set(key, { value, expiresAt: Date.now() + ADJUSTMENTS_CACHE_TTL_MS });
      return { ...value, source: "live" };
    })
    .catch((error) => {
      if (cached?.value) {
        console.warn("Rewards adjustments refresh failed; using stale cache:", error.message);
        adjustmentsCache.set(key, { value: cached.value, expiresAt: Date.now() + Math.min(5 * 60 * 1000, ADJUSTMENTS_CACHE_TTL_MS) });
        return { ...cached.value, source: "stale" };
      }
      adjustmentsCache.delete(key);
      throw error;
    });
  adjustmentsCache.set(key, { value: cached?.value, expiresAt: cached?.expiresAt || 0, inFlight });
  return inFlight;
}

async function getCachedCommissionHistory(baseUrl, userId) {
  const key = baseUrl;
  const now = Date.now();
  const cached = commissionHistoryCache.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.inFlight) return cached.inFlight;
  const inFlight = fetchSuiteQLRows(baseUrl, COMMISSION_HISTORY_SUITEQL, userId)
    .then((rows) => rows.map((row) => ({
      name: String(row.bed_specialist ?? row.BED_SPECIALIST ?? "").trim(),
      commission: (Number(row.amount_inc_tax ?? row.AMOUNT_INC_TAX) || 0) * COMMISSION_RATE,
    })).filter((row) => row.name))
    .then((value) => {
      commissionHistoryCache.set(key, { value, expiresAt: Date.now() + ADJUSTMENTS_CACHE_TTL_MS });
      return value;
    })
    .catch((error) => {
      if (cached?.value) return cached.value;
      commissionHistoryCache.delete(key);
      throw error;
    });
  commissionHistoryCache.set(key, { value: cached?.value, expiresAt: cached?.expiresAt || 0, inFlight });
  return inFlight;
}

async function ensureAnnualLeaveTable() {
  if (annualLeaveTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reward_annual_leave (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, period_start)
    )
  `);
  annualLeaveTableReady = true;
}

async function fetchAnnualLeaveEntries(period) {
  await ensureAnnualLeaveTable();
  const result = await pool.query(`
    SELECT u.id AS user_id, TRIM(CONCAT(u.firstname, ' ', u.lastname)) AS name,
           COALESCE(l.quantity, 0) AS quantity
      FROM users u
      LEFT JOIN reward_annual_leave l ON l.user_id = u.id AND l.period_start = $1::date
     ORDER BY u.lastname, u.firstname
  `, [localDateKey(period.start)]);
  return result.rows.map((row) => ({ userId: Number(row.user_id), name: row.name, quantity: Number(row.quantity) || 0 }));
}

function isHrManager(session) {
  const role = typeof session?.activeRole === "string" ? session.activeRole : session?.activeRole?.name;
  return String(role || "").trim().toLowerCase() === "hr manager";
}

function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

async function getSessionFromRequest(req) {
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return token ? getSession(token) : null;
}

async function hasRewardsAccess(session) {
  const roleName = typeof session?.activeRole === "string"
    ? session.activeRole
    : session?.activeRole?.name;
  if (!roleName) return false;

  const result = await pool.query(
    "SELECT access FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
    [roleName]
  );
  let access = result.rows[0]?.access || [];
  if (typeof access === "string") {
    try { access = JSON.parse(access); } catch { access = []; }
  }
  const allowed = Array.isArray(access)
    ? access.map((value) => String(value || "").trim().toLowerCase())
    : [];
  return allowed.includes("rewards-dashboard");
}

async function fetchStoreManagers() {
  const result = await pool.query(`
    SELECT l.name AS location_name,
           TRIM(CONCAT(u.firstname, ' ', u.lastname)) AS manager_name
      FROM locations l
      LEFT JOIN users u ON u.id = l.store_manager
     WHERE l.store_manager IS NOT NULL
     ORDER BY l.name
  `);
  return result.rows.map((row) => ({
    locationName: String(row.location_name || "").trim(),
    managerName: String(row.manager_name || "").trim(),
  })).filter((row) => row.locationName && row.managerName);
}

router.get("/", async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });
    if (!(await hasRewardsAccess(session))) {
      return res.status(403).json({ ok: false, error: "Rewards Dashboard access required" });
    }

    const userId = session.id || session.user_id || null;
    const baseUrl = `https://${getNetSuiteAccountDash()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
    const period = getPayPeriod();
    const [rawRows, adjustments, storeManagers, commissionHistory, leaveEntries] = await Promise.all([
      fetchSuiteQLRows(baseUrl, REWARDS_SUITEQL, userId),
      getCachedAdjustments(baseUrl, userId, period),
      fetchStoreManagers(),
      getCachedCommissionHistory(baseUrl, userId),
      fetchAnnualLeaveEntries(period),
    ]);

    const rows = rawRows.slice(0, MAX_ROWS).map(normalizeRow);
    const adjustmentRows = adjustments.rows;
    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      commissionRate: COMMISSION_RATE,
      storeManagerRate: STORE_MANAGER_RATE,
      canEditAnnualLeave: isHrManager(session),
      period: "This month",
      adjustmentPeriod: { start: period.start.toISOString(), end: period.end.toISOString() },
      lastUpdated: new Date().toISOString(),
      adjustmentsCache: { source: adjustments.source, refreshedAt: adjustments.refreshedAt, ttlMs: ADJUSTMENTS_CACHE_TTL_MS },
      capped: rawRows.length >= MAX_ROWS || adjustments.capped,
      summary: applyAnnualLeaveRewards(summarizeRewards(rows, adjustmentRows, storeManagers), commissionHistory, leaveEntries),
      rows,
      adjustmentRows,
    });
  } catch (error) {
    console.error("Rewards dashboard SuiteQL failed:", error.message);
    return res.status(502).json({ ok: false, error: "Could not load rewards from NetSuite", details: error.responseBody || null });
  }
});

router.patch("/annual-leave/:userId", async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });
    if (!isHrManager(session)) return res.status(403).json({ ok: false, error: "HR Manager access required" });
    let userId = Number(req.params.userId);
    const delta = Number(req.body?.delta);
    if ((!Number.isInteger(userId) || userId <= 0) && req.params.userId === "by-name") {
      const name = String(req.body?.name || "").trim();
      const userResult = await pool.query(`
        SELECT id FROM users
         WHERE LOWER(TRIM(CONCAT(firstname, ' ', lastname))) = LOWER($1)
         ORDER BY id LIMIT 2
      `, [name]);
      if (userResult.rows.length === 1) userId = Number(userResult.rows[0].id);
    }
    if (!Number.isInteger(userId) || userId <= 0 || ![-1, 1].includes(delta)) {
      return res.status(400).json({ ok: false, error: "This specialist could not be matched to a unique EPOS user" });
    }
    await ensureAnnualLeaveTable();
    const period = getPayPeriod();
    const result = await pool.query(`
      INSERT INTO reward_annual_leave (user_id, period_start, quantity, updated_by)
      VALUES ($1, $2::date, GREATEST(0, $3), $4)
      ON CONFLICT (user_id, period_start) DO UPDATE
        SET quantity = GREATEST(0, reward_annual_leave.quantity + $3),
            updated_by = $4, updated_at = NOW()
      RETURNING quantity
    `, [userId, localDateKey(period.start), delta, session.id || session.user_id]);
    return res.json({ ok: true, userId, quantity: Number(result.rows[0].quantity) });
  } catch (error) {
    console.error("Rewards annual leave update failed:", error.message);
    return res.status(500).json({ ok: false, error: "Could not update annual leave" });
  }
});

module.exports = { router, ADJUSTMENTS_CACHE_TTL_MS };
