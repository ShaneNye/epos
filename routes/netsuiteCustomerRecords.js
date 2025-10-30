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

    // === Map readable statuses ===
    const statusMap = {
      "A": "Pending Approval",
      "B": "Pending Fulfillment",
      "C": "Partially Fulfilled",
      "D": "Pending Billing",
      "E": "Billed",
      "F": "Closed",
      "G": "Cancelled",
      "H": "Pending Payment",
      "I": "Paid In Full",
      "J": "Refunded",
      "K": "Processing",
      "L": "Pending Return",
      "M": "Partially Returned",
      "N": "Returned",
      "O": "Open",
      "P": "Completed",
      "Q": "In Progress",
      "R": "Pending Approval (Credit Memo)",
      "S": "Pending Refund",
      "T": "Voided",
      "U": "On Hold",
      "V": "Pending Deposit",
      "W": "Pending Shipment",
      "X": "Awaiting Authorization",
      "Y": "Open",
      "Z": "Closed"
    };

    const items = (result.items || []).map(r => ({
      ...r,
      statusText: statusMap[r.status] || r.status || "Unknown"
    }));

    console.log(`📊 Total records: ${items.length}`);
    res.json({ ok: true, results: items });

  } catch (err) {
    console.error("❌ Customer transaction lookup failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
