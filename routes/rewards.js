const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsPostRaw } = require("../netsuiteClient");
const { getNetSuiteAccountDash } = require("../utils/netsuiteEnvironment");
const { COMMISSION_RATE, normalizeRow, summarize } = require("../utils/rewardsCalculator");

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
        NOT IN ('Cancelled', 'Pending Approval')

    AND t.trandate BETWEEN
        BUILTIN.RELATIVE_RANGES('TM', 'START')
        AND BUILTIN.RELATIVE_RANGES('TM', 'END')

    AND BUILTIN.DF(tl.item)
        NOT IN ('S-GB', 'E-GB')

ORDER BY
    t.trandate DESC,
    t.tranid`;

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
    const rawRows = [];

    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const result = await nsPostRaw(`${baseUrl}?limit=${PAGE_SIZE}&offset=${offset}`, { q: REWARDS_SUITEQL }, userId);
      const page = Array.isArray(result?.items) ? result.items : [];
      rawRows.push(...page);
      if (!result?.hasMore || page.length < PAGE_SIZE) break;
    }

    const rows = rawRows.slice(0, MAX_ROWS).map(normalizeRow);
    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      commissionRate: COMMISSION_RATE,
      period: "This month",
      lastUpdated: new Date().toISOString(),
      capped: rawRows.length >= MAX_ROWS,
      summary: summarize(rows),
      rows,
    });
  } catch (error) {
    console.error("Rewards dashboard SuiteQL failed:", error.message);
    return res.status(502).json({ ok: false, error: "Could not load rewards from NetSuite", details: error.responseBody || null });
  }
});

module.exports = { router };
