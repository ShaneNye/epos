// routes/netsuiteQuote.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { nsPost, nsGet, nsPostRaw } = require("../netsuiteClient");

/* =====================================================
   === CREATE NEW QUOTE (Estimate) =====================
   ===================================================== */
router.post("/create", async (req, res) => {
  try {
    const { customer, order, items } = req.body;
    let customerId = customer?.id || null;

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
      const newCust = await nsPost("/customer", custBody);

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
        const [rows] = await pool.query(
          "SELECT netsuiteId FROM users WHERE id = ? LIMIT 1",
          [order.salesExec]
        );
        if (rows.length && rows[0].netsuiteId) {
          salesExecNsId = rows[0].netsuiteId;
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
        const [locRows] = await pool.query(
          `SELECT netsuite_internal_id, invoice_location_id
           FROM locations
           WHERE id = ? LIMIT 1`,
          [order.store]
        );
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
      custbody_sb_paymentinfo: order.paymentInfo
        ? { id: order.paymentInfo }
        : undefined,
      custbody_sb_bedspecialist: salesExecNsId
        ? { id: salesExecNsId }
        : undefined,
      custbody_sb_warehouse: order.warehouse ? { id: order.warehouse } : undefined,
      custbody_sb_primarystore: storeNsId ? { id: storeNsId } : undefined,
      item: {
        items: items.map((i) => {
          const line = {
            item: { id: i.item },
            quantity: i.quantity,
            amount: i.amount / 1.2, // send as NET
            custcol_sb_itemoptionsdisplay: i.options || "",
          };
          if (i.fulfilmentMethod && String(i.fulfilmentMethod).trim() !== "") {
            line.custcol_sb_fulfilmentlocation = { id: i.fulfilmentMethod };
          }
          return line;
        }),
      },
    };

    console.log("🧾 Quote payload for NetSuite:", JSON.stringify(estimateBody, null, 2));

    const quoteRes = await nsPost("/estimate", estimateBody);
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

    const quote = await nsGet(`/estimate/${id}`);
    if (!quote) throw new Error("No quote data returned from NetSuite");

    // 🔎 Expand the customer entity (so we can access custentity_title etc.)
    let expandedEntity = null;
    if (quote.entity?.id) {
      try {
        expandedEntity = await nsGet(`/customer/${quote.entity.id}`);
        console.log("🔎 Expanded entity loaded:", {
          id: expandedEntity.id,
          title: expandedEntity.custentity_title,
        });
      } catch (err) {
        console.warn(`⚠️ Could not expand entity ${quote.entity.id}:`, err.message);
      }
    }
    if (expandedEntity) {
      quote.entity = { ...quote.entity, ...expandedEntity };
    }

    /* -----------------------------------------------------
       1️⃣ Fetch Item Feed (Name + Base Price)
    ----------------------------------------------------- */
    const token = process.env.SALES_ORDER_ITEMS;
    const nsUrlItems = `https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4178&deploy=6&compid=7972741_SB1&ns-at=AAEJ7tMQlL2UP5SuRn6p9IsRJ-Rgkanx98uShulWU5RVHLRlgSs&token=${encodeURIComponent(
      token
    )}`;
    const respItems = await fetch(nsUrlItems);
    if (!respItems.ok)
      throw new Error(`NetSuite item feed returned ${respItems.status}`);
    const rawItems = await respItems.json();

    let itemList = [];
    if (Array.isArray(rawItems)) itemList = rawItems;
    else if (rawItems.results) itemList = rawItems.results;
    else if (rawItems.data) itemList = rawItems.data;

    const itemMap = {};
    for (const i of itemList) {
      const id = String(i.id || i.internalId || i.itemId || i["Internal ID"]);
      const name =
        i.name || i.itemName || i["Name"] || i["Item Name"] || "";
      const baseprice = parseFloat(
        i.baseprice || i["Base Price"] || i["base price"] || i.price || 0
      );
      if (id) itemMap[id] = { name, baseprice };
    }

    /* -----------------------------------------------------
       2️⃣ Fulfilment Method Map
    ----------------------------------------------------- */
    let fulfilmentMap = {};
    try {
      const tokenFM = process.env.SALES_ORDER_FULFIL_METHOD;
      const nsUrlFM = `https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4178&deploy=7&compid=7972741_SB1&ns-at=AAEJ7tMQoVD4xXVi2aftvr1c5rNpwUNCW2YHfMu7NXrzI9r6id4&token=${encodeURIComponent(
        tokenFM
      )}`;
      const fmRes = await fetch(nsUrlFM);
      if (fmRes.ok) {
        const fmJson = await fmRes.json();
        const fmList = fmJson.results || [];
        for (const f of fmList) {
          const id = String(f["Internal ID"] || f.id || f.internalid);
          const name = f["Name"] || f.name;
          if (id && name) fulfilmentMap[id] = name;
        }
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch fulfilment methods:", err.message);
    }

    /* -----------------------------------------------------
       3️⃣ Expand Item Lines via SuiteQL
    ----------------------------------------------------- */
    if (!quote.item?.items) {
      const query = `
        SELECT
          item,
          quantity,
          netamount,
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
        { q: query }
      );

      if (suiteql && Array.isArray(suiteql.items)) {
        const items = suiteql.items.map((r) => {
          const itemId = String(r.item);
          const info = itemMap[itemId] || {};
          const itemName = info.name || `Item ${itemId}`;
          const qty = Math.abs(Number(r.quantity) || 0);
          const net = Math.abs(Number(r.netamount) || 0);
          const retailNet = parseFloat(info.baseprice || 0);
          const retailGross = +(retailNet * 1.2).toFixed(2);

          const vat = net > 0 ? +(net * 0.2).toFixed(2) : 0;
          const saleprice = net > 0 ? +(net + vat).toFixed(2) : 0;

          const fulfilId =
            r.fulfilmentlocation ||
            r.custcol_sb_fulfilmentlocation ||
            r.CUSTCOL_SB_FULFILMENTLOCATION ||
            "";

          return {
            item: { id: itemId, refName: itemName },
            quantity: qty,
            amount: retailGross,
            vat,
            saleprice,
            discount: 0,
            custcol_sb_itemoptionsdisplay: r.options || "",
            custcol_sb_fulfilmentlocation: {
              id: fulfilId || null,
              refName: fulfilId
                ? fulfilmentMap[fulfilId] || `ID ${fulfilId}`
                : "",
            },
          };
        });

        quote.item = { items };
        console.log(`✅ Loaded ${items.length} item lines for Quote`);
      }
    }

    /* -----------------------------------------------------
       ✅ Respond with populated Quote
    ----------------------------------------------------- */
    console.log("✅ Quote fetched successfully:", quote.tranId || quote.id);
    return res.json({
      ok: true,
      salesOrderId: quote.id,
      salesOrder: quote,
      deposits: [],
    });
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

    const quote = await nsGet(`/estimate/${id}`);
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
      { q: query }
    );
    const quoteLines = Array.isArray(suiteql?.items) ? suiteql.items : [];
    if (!quoteLines.length) {
      throw new Error(`No line items found in quote ${id}`);
    }

    const cleanedItems = quoteLines.map(line => ({
      item: { id: String(line.item) },
      quantity: Number(line.quantity) || 1,
      rate: Number(line.rate) || 0,
      custcol_sb_itemoptionsdisplay: line.options || "",
      custcol_sb_fulfilmentlocation: line.custcol_sb_fulfilmentlocation
        ? { id: String(line.custcol_sb_fulfilmentlocation) }
        : undefined,
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
    const so = await nsPost("/salesOrder", orderBody);
    console.log("✅ Converted to Sales Order:", so);

    let salesOrderId = so.id || null;
    if (!salesOrderId && so._location) {
      const match = so._location.match(/salesorder\/(\d+)/);
      if (match) salesOrderId = match[1];
    }

    return res.json({
      ok: true,
      salesOrderId,
      response: so,
    });
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

    // You may need to adjust if it's "customer" or "entity"
    const entity = await nsGet(`/customer/${id}`);

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
