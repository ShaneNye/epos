const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsPostRaw } = require("../netsuiteClient");
const { getNetSuiteAccountDash } = require("../utils/netsuiteEnvironment");
const { COMMISSION_RATE, getPayPeriod, filterRowsToPayPeriod, normalizeRow, normalizeAdjustmentRow, normalizeLineValueChanges, summarizeRewards } = require("../utils/rewardsCalculator");

const router = express.Router();
const PAGE_SIZE = 1000;
const MAX_ROWS = 10000;

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

router.get("/", async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });
    if (!(await hasRewardsAccess(session))) {
      return res.status(403).json({ ok: false, error: "Rewards Dashboard access required" });
    }

    const userId = session.id || session.user_id || null;
    const baseUrl = `https://${getNetSuiteAccountDash()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
    const [rawRows, rawAdjustmentRows, rawLineValueChanges] = await Promise.all([
      fetchSuiteQLRows(baseUrl, REWARDS_SUITEQL, userId),
      fetchSuiteQLRows(baseUrl, ADJUSTMENTS_SUITEQL, userId),
      fetchLineValueChanges(),
    ]);

    const period = getPayPeriod();
    const rows = rawRows.slice(0, MAX_ROWS).map(normalizeRow);
    const closedLineAdjustments = rawAdjustmentRows.slice(0, MAX_ROWS).map(normalizeAdjustmentRow);
    const currentLineValueChanges = filterRowsToPayPeriod(rawLineValueChanges.slice(0, MAX_ROWS), period);
    const lineValueAdjustments = normalizeLineValueChanges(currentLineValueChanges);
    const adjustmentRows = [...closedLineAdjustments, ...lineValueAdjustments];
    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      commissionRate: COMMISSION_RATE,
      period: "This month",
      adjustmentPeriod: { start: period.start.toISOString(), end: period.end.toISOString() },
      lastUpdated: new Date().toISOString(),
      capped: rawRows.length >= MAX_ROWS || rawAdjustmentRows.length >= MAX_ROWS || rawLineValueChanges.length >= MAX_ROWS,
      summary: summarizeRewards(rows, adjustmentRows),
      rows,
      adjustmentRows,
    });
  } catch (error) {
    console.error("Rewards dashboard SuiteQL failed:", error.message);
    return res.status(502).json({ ok: false, error: "Could not load rewards from NetSuite", details: error.responseBody || null });
  }
});

module.exports = { router };
