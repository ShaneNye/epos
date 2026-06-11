// routes/intercompany.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
const fetch = require("node-fetch");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");
const { nsPatch, nsGet } = require("../netsuiteClient");
const logger = require("../utils/logging");

// Middleware: log all route hits
router.use((req, res, next) => {
  console.log(`➡️ [${req.method}] Intercompany route hit → ${req.originalUrl}`);
  next();
});

router.post("/create", async (req, res) => {
  console.log("========================================");
  console.log("🚀 Starting Intercompany Sales Order Creation (via PO Transform)");

  try {
    const { salesOrderId, tranId, customerId, storeId } = req.body;
    logger.apiPayload("Intercompany create request", req.body);

    if (!salesOrderId || !tranId || !customerId) {
      console.error("❌ Missing required fields");
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    console.log(`🔁 Preparing Intercompany SO for Sales Order ${tranId} (ID ${salesOrderId})`);

    // === 1️⃣ Lookup store details ===
    console.log("🏬 Fetching store info from SQL...");
    const [locRows] = await pool.query(
      `SELECT id, intercompany_customer, netsuite_internal_id, invoice_location_id, intercompany_location
       FROM locations WHERE id = ? LIMIT 1`,
      [storeId]
    );

    if (!locRows.length) throw new Error(`Store ${storeId} not found`);
    const { intercompany_customer, intercompany_location } = locRows[0];

    if (!intercompany_customer)
      throw new Error(`Store ${storeId} missing intercompany_customer`);
    if (!intercompany_location)
      throw new Error(`Store ${storeId} missing intercompany_location`);

    console.log(
      `✅ Store resolved → Intercompany Customer: ${intercompany_customer}, Intercompany Location: ${intercompany_location}`
    );

    // === 2️⃣ Fetch original SO to get warehouse info ===
    console.log(`📡 Fetching original Sales Order ${salesOrderId} from NetSuite...`);
    let sourceWarehouseId = null;
    try {
      const soRecord = await nsGet(`/salesOrder/${salesOrderId}`);
      sourceWarehouseId =
        soRecord?.custbody_sb_warehouse?.id ||
        soRecord?.body?.custbody_sb_warehouse?.id ||
        null;
      if (sourceWarehouseId) {
        console.log(`🏗️ Extracted Warehouse ID from original SO: ${sourceWarehouseId}`);
      } else {
        console.warn("⚠️ No custbody_sb_warehouse found on original SO.");
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch original SO for warehouse mapping:", err.message);
    }

// === 3️⃣ Fetch Intercompany Purchase Orders from Suitelet ===
console.log("🌐 Fetching Intercompany Purchase Orders from Suitelet...");

const baseUrl = process.env.SALES_PRDER_INTERCO_PO_URL;
const token = process.env.SALES_ORDER_INTERCO_PO;

if (!baseUrl || !token) {
  throw new Error("Missing SALES_PRDER_INTERCO_PO_URL or SALES_ORDER_INTERCO_PO in .env");
}

const nsUrl = `${baseUrl}&token=${encodeURIComponent(token)}`;
console.log(`📡 Fetching from: ${nsUrl}`);

const poRes = await fetch(nsUrl);
if (!poRes.ok) throw new Error(`Suitelet responded ${poRes.status}`);
const poJson = await poRes.json();


    console.log(`📦 Suitelet returned ${poJson?.results?.length || 0} records`);
    console.log(`🎯 Looking for SO ID match: ${salesOrderId}`);

    const filtered = (poJson.results || []).filter(
      (l) => String(l["SO ID"] || "").trim() === String(salesOrderId)
    );

    console.log(`🎯 Filtered to ${filtered.length} matching lines for SO ID ${salesOrderId}`);
    if (!filtered.length)
      return res.json({ ok: false, error: "No Intercompany PO lines found for this order" });

    // === 4️⃣ Extract the existing Intercompany PO ID ===
    const pairedPOId = filtered[0]?.["PO ID"] || null;
    if (pairedPOId) {
      console.log(`🔗 Found existing Intercompany PO ID: ${pairedPOId}`);
    } else {
      throw new Error("No valid Intercompany PO ID found for this SO.");
    }

    // === 5️⃣ Call NetSuite RESTlet (Token-Based Auth) to transform PO → SO ===
    console.log(`🔁 Calling NetSuite RESTlet (TBA) to transform PO ${pairedPOId} → Intercompany SO...`);

    const oauth = OAuth({
      consumer: {
        key: process.env.NS_CONSUMER_KEY,
        secret: process.env.NS_CONSUMER_SECRET,
      },
      signature_method: "HMAC-SHA256",
      hash_function(base_string, key) {
        return crypto.createHmac("sha256", key).update(base_string).digest("base64");
      },
    });

    const tokenData = {
      key: process.env.NS_TOKEN_ID,
      secret: process.env.NS_TOKEN_SECRET,
    };

    const nsTransformUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_epos_transform_int_po&deploy=customdeploy_sb_epos_transform_int_po`;

    const restletBody = { poId: pairedPOId };

    const authHeader = oauth.toHeader(oauth.authorize({ url: nsTransformUrl, method: "POST" }, tokenData));
    authHeader.Authorization += `, realm="${process.env.NS_ACCOUNT}"`;

    const resTransform = await fetch(nsTransformUrl, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(restletBody),
    });

    const text = await resTransform.text();
    let dataTransform;
    try {
      dataTransform = JSON.parse(text);
    } catch {
      dataTransform = { ok: false, error: text };
    }

    logger.netSuiteResponse("Intercompany transform RESTlet", dataTransform);

    if (!resTransform.ok || !dataTransform.ok) {
      throw new Error(dataTransform.error || `RESTlet returned HTTP ${resTransform.status}`);
    }

    const intercoId = dataTransform.intercoSalesOrderId;
    console.log(`✅ Intercompany SO created successfully from PO ${pairedPOId}: ${intercoId}`);

    // === 6️⃣ Update SQL PO record ===
    try {
      console.log("🛠 Updating SQL PO record to mark as processed...");
      const [res1] = await pool.query(
        `UPDATE purchase_orders
         SET intercostatus = 2,
             intercotransaction = ?,
             custbody_intercompcust = ?
         WHERE order_number = ?`,
        [intercoId, customerId, tranId]
      );
      console.log(`🧮 SQL PO Update → ${res1.affectedRows} rows affected`);
    } catch (err) {
      console.warn("⚠️ SQL update failed:", err.message);
    }

    // === 7️⃣ Link original SO back to Intercompany SO ===
    try {
      console.log("🔗 Linking original SO to Intercompany SO...");
      await nsPatch(`/salesOrder/${salesOrderId}`, {
        custbody_sb_pairedsalesorder: String(intercoId),
      });
      console.log("✅ Linked Original SO → Intercompany SO");
    } catch (err) {
      console.warn("⚠️ Failed to link Original SO:", err.message);
    }

    console.log("🎉 Intercompany SO process complete!");
    console.log("========================================");

    return res.json({ ok: true, intercoSalesOrderId: intercoId });
  } catch (err) {
    console.error("❌ Intercompany create failed:", err.message);
    if (err.responseBody) {
      console.error("🧾 NetSuite error body:", JSON.stringify(err.responseBody, null, 2));
    }
    console.error(err.stack);
    console.log("========================================");
    return res
      .status(500)
      .json({ ok: false, error: err.message, details: err.responseBody || null });
  }
});

module.exports = router;
