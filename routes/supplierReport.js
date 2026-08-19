const express = require("express");
const { getSession } = require("../sessions");
const { nsPostRaw } = require("../netsuiteClient");
const { getNetSuiteAccountDash } = require("../utils/netsuiteEnvironment");

const router = express.Router();

const SUPPLIER_QUERY = `
SELECT
    id,
    companyName,
    phone AS 'Supplier Mainline',
    email AS 'Supplier Email',
    BUILTIN.DF(custentity1) AS 'Lead Time',
    custentity_sb_sup_rep_mob AS 'Rep No',
    custentitysb_sup_rep_email AS 'Rep Email',
    custentity_sb_supplier_sales_rep AS 'Supplier Rep'
FROM Vendor
WHERE custentity_sb_sup_ltd = 'T'
ORDER BY companyName`;

function value(row, ...keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row[key] !== null) return String(row[key]).trim();
  }
  return "";
}

router.get("/", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const session = token ? await getSession(token) : null;
    if (!session?.id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const url = `https://${getNetSuiteAccountDash()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0`;
    const result = await nsPostRaw(url, { q: SUPPLIER_QUERY }, session.id);
    const suppliers = (Array.isArray(result?.items) ? result.items : []).map((row) => ({
      id: value(row, "id"),
      companyName: value(row, "companyname", "companyName"),
      supplierMainline: value(row, "supplier mainline", "Supplier Mainline", "supplier_mainline"),
      supplierEmail: value(row, "supplier email", "Supplier Email", "supplier_email"),
      leadTime: value(row, "lead time", "Lead Time", "lead_time"),
      repNumber: value(row, "rep no", "Rep No", "rep_no"),
      repEmail: value(row, "rep email", "Rep Email", "rep_email"),
      supplierRep: value(row, "supplier rep", "Supplier Rep", "supplier_rep"),
    }));

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, suppliers, totalResults: suppliers.length });
  } catch (err) {
    console.error("Supplier report failed:", err.message || err);
    return res.status(500).json({ ok: false, error: err.message || "Unable to load suppliers" });
  }
});

router.get("/:vendorId/items", async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const session = token ? await getSession(token) : null;
    if (!session?.id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const vendorId = String(req.params.vendorId || "").trim();
    if (!/^\d+$/.test(vendorId)) {
      return res.status(400).json({ ok: false, error: "Invalid supplier ID" });
    }

    const query = `
SELECT
    Item.id,
    Item.itemid,
    Item.displayname
FROM ItemVendor
INNER JOIN Item
    ON Item.id = ItemVendor.item
WHERE ItemVendor.vendor = ${vendorId}
    AND ItemVendor.preferredvendor = 'T'
ORDER BY Item.itemid`;
    const url = `https://${getNetSuiteAccountDash()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0`;
    const result = await nsPostRaw(url, { q: query }, session.id);
    const items = (Array.isArray(result?.items) ? result.items : []).map((row) => ({
      id: value(row, "id"),
      itemCode: value(row, "itemid", "itemId"),
      displayName: value(row, "displayname", "displayName"),
    }));

    res.set("Cache-Control", "no-store");
    return res.json({ ok: true, items, totalResults: items.length });
  } catch (err) {
    console.error("Supplier preferred-item report failed:", err.message || err);
    return res.status(500).json({ ok: false, error: err.message || "Unable to load supplier items" });
  }
});

module.exports = router;
