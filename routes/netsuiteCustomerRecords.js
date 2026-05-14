const express = require("express");
const router = express.Router();
const { getSession } = require("../sessions");
const { nsPostRaw } = require("../netsuiteClient");

/**
 * Consolidated transaction lookup — returns all related docs
 * (sales orders, deposits, refunds, credit memos, return auths)
 * plus readable status labels.
 */
router.get("/customer-transactions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🧠 Received customer-transactions request for ID ${id}`);

    // === Verify session ===
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Missing session token" });

    const session = await getSession(token);
    const userId = session?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Invalid session" });
    console.log("👤 Authenticated user:", userId);

    // === SuiteQL URL ===
    const suiteqlUrl = `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

    // === Consolidated query ===
    const query = `
  SELECT
    t.id             AS internalid,
    t.tranid         AS documentnumber,
    t.trandate       AS date,
    t.recordtype     AS recordtype,
    t.status         AS status,
    BUILTIN.DF(t.status) AS statustext,
    t.total          AS amount
  FROM transaction AS t
  WHERE t.recordtype IN (
    'salesorder',
    'invoice',
    'customerdeposit',
    'customerrefund',
    'creditmemo',
    'returnauthorization',
    'itemfulfillment'
  )
  AND t.entity = ${id}
  ORDER BY t.trandate DESC
`;


    console.log("🧾 Running consolidated SuiteQL query...");
    console.log(query);

    const result = await nsPostRaw(suiteqlUrl, { q: query }, userId, "sb");

    const items = (result.items || []).map(r => ({
      ...r,
      statusText: r.statustext || r.statusText || r.status || "Unknown"
    }));

    console.log(`📊 Total records: ${items.length}`);
    res.json({ ok: true, results: items });

  } catch (err) {
    console.error("❌ Customer transaction lookup failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
