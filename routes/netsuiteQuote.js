// routes/netsuiteQuote.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsPost, nsGet, nsPostRaw } = require("../netsuiteClient");

/* =====================================================
   === CREATE NEW QUOTE (Estimate) =====================
   ===================================================== */
router.post("/create", async (req, res) => {
  try {
    const { customer, order, items } = req.body;
    let customerId = customer?.id || null;

    // 🔐 Get user ID for per-user NetSuite token
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;
    if (token) {
      try {
        const session = await getSession(token);
        userId = session?.id || null;
        console.log("🔐 Authenticated user for quote creation:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve session:", e.message);
      }
    }

    // === 1️⃣ Create Customer if needed ===
    if (!customerId) {
      const custBody = {
        entityStatus: { id: "13" },
        companyName: `${customer.firstName} ${customer.lastName}`,
        custentity_title: customer.title,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.contactNumber,
        altPhone: customer.altContactNumber,
        subsidiary: { id: "1" },
        isPerson: true,
        addressbook: {
          items: [
            {
              defaultShipping: true,
              defaultBilling: true,
              label: "Main Address",
              addressbookAddress: {
                addr1: customer.address1,
                addr2: customer.address2,
                zip: customer.postcode,
              },
            },
          ],
        },
      };

      console.log("🧾 Creating new customer for quote:", custBody);
      const newCust = await nsPost("/customer", custBody, userId, "sb");

      customerId = newCust.id || newCust.internalId;
      if (!customerId && newCust._location) {
        const match = newCust._location.match(/customer\/(\d+)/);
        if (match) customerId = match[1];
      }

      if (!customerId) throw new Error("Failed to resolve new customer ID");
      console.log("✅ Created new customer → ID:", customerId);
    }

    console.log("🧩 Using Customer ID for Quote:", customerId);

    // === 2️⃣ Lookup Sales Executive’s NetSuite ID ===
    let salesExecNsId = null;
    if (order.salesExec) {
      try {
        const result = await pool.query(
          "SELECT netsuiteid FROM users WHERE id = $1 LIMIT 1",
          [order.salesExec]
        );
        const rows = result.rows;
        if (rows.length && rows[0].netsuiteid) {
          salesExecNsId = rows[0].netsuiteid;
          console.log("👤 Found NetSuite ID for Sales Exec:", salesExecNsId);
        } else {
          console.warn("⚠️ No NetSuite ID found for Sales Exec ID:", order.salesExec);
        }
      } catch (err) {
        console.error("❌ Failed to lookup Sales Exec NetSuite ID:", err.message);
      }
    }

    // === 3️⃣ Lookup Store NetSuite ID + Invoice Location ===
    let storeNsId = null;
    let invoiceLocationId = null;
    if (order.store) {
      try {
        const result = await pool.query(
          `SELECT netsuite_internal_id, invoice_location_id
             FROM locations
            WHERE id = $1
            LIMIT 1`,
          [order.store]
        );
        const locRows = result.rows;
        if (locRows.length) {
          storeNsId = locRows[0].netsuite_internal_id || null;
          invoiceLocationId = locRows[0].invoice_location_id || null;
          console.log("🏬 Store lookup →", {
            sqlId: order.store,
            netsuite_internal_id: storeNsId,
            invoice_location_id: invoiceLocationId,
          });
        } else {
          console.warn("⚠️ No store found for ID:", order.store);
        }
      } catch (err) {
        console.error("❌ Failed to lookup store NetSuite ID:", err.message);
      }
    }

    // === 4️⃣ Build Quote (Estimate) Payload ===
    const estimateBody = {
      entity: { id: customerId },
      trandate: new Date().toISOString().split("T")[0],
      orderstatus: "A",
      subsidiary: storeNsId ? { id: String(storeNsId) } : undefined,
      location: invoiceLocationId ? { id: String(invoiceLocationId) } : undefined,
      leadsource: order.leadSource ? { id: order.leadSource } : undefined,
      custbody_sb_paymentinfo: order.paymentInfo ? { id: order.paymentInfo } : undefined,
      custbody_sb_bedspecialist: salesExecNsId ? { id: salesExecNsId } : undefined,
      custbody_sb_warehouse: order.warehouse ? { id: order.warehouse } : undefined,
      custbody_sb_primarystore: storeNsId ? { id: storeNsId } : undefined,
      item: {
        items: items.map((i) => ({
          item: { id: i.item },
          quantity: i.quantity,
          amount: i.amount / 1.2, // send as NET
          custcol_sb_itemoptionsdisplay: i.options || "",
          ...(i.fulfilmentMethod && { custcol_sb_fulfilmentlocation: { id: i.fulfilmentMethod } }),
        })),
      },
    };

    console.log("🧾 Quote payload for NetSuite:", JSON.stringify(estimateBody, null, 2));
    const quoteRes = await nsPost("/estimate", estimateBody, userId, "sb");
    console.log("✅ Quote created successfully:", quoteRes);

    let quoteId = quoteRes.id || null;
    if (!quoteId && quoteRes._location) {
      const match = quoteRes._location.match(/estimate\/(\d+)/);
      if (match) quoteId = match[1];
    }

    return res.json({ ok: true, quoteId, response: quoteRes });
  } catch (err) {
    console.error("❌ Quote creation error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =====================================================
   === GET QUOTE DETAILS (read-only view) ===============
   ===================================================== */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📦 Fetching Quote ${id} from NetSuite...`);

    // 🔐 Resolve user for per-user token
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;
    if (token) {
      const session = await getSession(token);
      userId = session?.id || null;
      console.log("🔐 Authenticated user for quote view:", userId);
    }

    const quote = await nsGet(`/estimate/${id}`, userId, "sb");
    if (!quote) throw new Error("No quote data returned from NetSuite");

    // 🔎 Expand customer entity
    let expandedEntity = null;
    if (quote.entity?.id) {
      try {
        expandedEntity = await nsGet(`/customer/${quote.entity.id}`, userId, "sb");
        console.log("🔎 Expanded entity loaded:", {
          id: expandedEntity.id,
          title: expandedEntity.custentity_title,
        });
      } catch (err) {
        console.warn(`⚠️ Could not expand entity ${quote.entity.id}:`, err.message);
      }
    }
    if (expandedEntity) quote.entity = { ...quote.entity, ...expandedEntity };

    /* -----------------------------------------------------
       Expand Item Lines via SuiteQL with lookup + abs()
    ----------------------------------------------------- */
    const query = `
      SELECT
        t.item,
        i.itemid AS itemname,
        t.quantity,
        t.netamount,
        t.rate,
        t.custcol_sb_itemoptionsdisplay AS options,
        t.custcol_sb_fulfilmentlocation
      FROM transactionline t
      LEFT JOIN item i ON i.id = t.item
      WHERE t.transaction = ${id}
      AND t.mainline = 'F'
      AND t.taxline = 'F'
      ORDER BY t.linesequencenumber
    `;

    const suiteql = await nsPostRaw(
      `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
      { q: query },
      userId,
      "sb"
    );

    if (suiteql && Array.isArray(suiteql.items)) {
      const items = suiteql.items.map((r) => {
        const itemId = String(r.item);
        const itemName = r.itemname || `Item ${itemId}`;
        const qty = Math.abs(Number(r.quantity) || 0);
        const net = Math.abs(Number(r.netamount) || 0);
        const vat = +(net * 0.2).toFixed(2);
        const saleprice = +(net + vat).toFixed(2);

        return {
          item: { id: itemId, refName: itemName },
          quantity: qty,
          amount: +(net * 1.2).toFixed(2),
          vat,
          saleprice,
          custcol_sb_itemoptionsdisplay: r.options || "",
        };
      });

      quote.item = { items };
      console.log(`✅ Loaded ${items.length} item lines for Quote`);
    }

    console.log("✅ Quote fetched successfully:", quote.tranId || quote.id);
    return res.json({ ok: true, quote });
  } catch (err) {
    console.error("❌ GET /quote/:id error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =====================================================
   === CONVERT QUOTE → SALES ORDER =====================
   ===================================================== */
router.post("/:id/convert", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔁 Converting Quote ${id} → Sales Order...`);

    // 🔐 Resolve user for per-user token
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;
    if (token) {
      const session = await getSession(token);
      userId = session?.id || null;
    }

    const quote = await nsGet(`/estimate/${id}`, userId, "sb");
    if (!quote) throw new Error("Quote not found in NetSuite");

    const query = `
      SELECT
        item,
        quantity,
        rate,
        custcol_sb_itemoptionsdisplay AS options,
        custcol_sb_fulfilmentlocation
      FROM transactionline
      WHERE transaction = ${id}
      AND mainline = 'F'
      AND taxline = 'F'
      ORDER BY linesequencenumber
    `;
    const suiteql = await nsPostRaw(
      `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
      { q: query },
      userId,
      "sb"
    );

    const quoteLines = Array.isArray(suiteql?.items) ? suiteql.items : [];
    if (!quoteLines.length) throw new Error(`No line items found in quote ${id}`);

    const cleanedItems = quoteLines.map((line) => ({
      item: { id: String(line.item) },
      quantity: Number(line.quantity) || 1,
      rate: Number(line.rate) || 0,
      custcol_sb_itemoptionsdisplay: line.options || "",
      ...(line.custcol_sb_fulfilmentlocation && {
        custcol_sb_fulfilmentlocation: { id: String(line.custcol_sb_fulfilmentlocation) },
      }),
    }));

    const orderBody = {
      entity: quote.entity,
      subsidiary: quote.subsidiary,
      location: quote.location,
      trandate: new Date().toISOString().split("T")[0],
      orderstatus: "A",
      leadsource: quote.leadsource,
      custbody_sb_paymentinfo: quote.custbody_sb_paymentinfo,
      custbody_sb_bedspecialist: quote.custbody_sb_bedspecialist,
      custbody_sb_warehouse: quote.custbody_sb_warehouse,
      custbody_sb_primarystore: quote.custbody_sb_primarystore,
      item: { items: cleanedItems },
    };

    console.log("🧾 Final Sales Order payload:", JSON.stringify(orderBody, null, 2));
    const so = await nsPost("/salesOrder", orderBody, userId, "sb");

    let salesOrderId = so.id || null;
    if (!salesOrderId && so._location) {
      const match = so._location.match(/salesorder\/(\d+)/);
      if (match) salesOrderId = match[1];
    }

    return res.json({ ok: true, salesOrderId, response: so });
  } catch (err) {
    console.error("❌ Quote → Sales Order conversion failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =====================================================
   === GET FULL ENTITY RECORD ==========================
   ===================================================== */
router.get("/entity/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📦 Fetching Entity ${id} from NetSuite...`);

    // 🔐 Per-user auth
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;
    if (token) {
      const session = await getSession(token);
      userId = session?.id || null;
    }

    const entity = await nsGet(`/customer/${id}`, userId, "sb");
    if (!entity) throw new Error("No entity data returned from NetSuite");

    console.log("✅ Entity fetched successfully:", {
      id: entity.id,
      title: entity.custentity_title || entity.title || null,
    });

    return res.json({ ok: true, entity });
  } catch (err) {
    console.error("❌ GET /entity/:id error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
