// routes/netsuiteQuote.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsPost, nsGet, nsPostRaw, nsPatch } = require("../netsuiteClient");
const fetch = require("node-fetch");

/* =====================================================
   Helpers
===================================================== */
async function resolveUserIdFromAuth(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  let userId = null;

  if (token) {
    try {
      const session = await getSession(token);
      userId = session?.id || null;
    } catch (e) {
      console.warn("⚠️ Could not resolve session:", e.message);
    }
  }

  return userId;
}

async function resolveSalesExecNsId(appUserId) {
  if (!appUserId) return null;

  try {
    const result = await pool.query(
      "SELECT netsuiteid FROM users WHERE id = $1 LIMIT 1",
      [appUserId]
    );
    return result.rows[0]?.netsuiteid || null;
  } catch (err) {
    console.error("❌ Failed to lookup Sales Exec NetSuite ID:", err.message);
    return null;
  }
}

async function resolveStoreData(appStoreId) {
  if (!appStoreId) {
    return {
      storeNsId: null,
      invoiceLocationId: null,
    };
  }

  try {
    const result = await pool.query(
      `SELECT netsuite_internal_id, invoice_location_id
         FROM locations
        WHERE id = $1
        LIMIT 1`,
      [appStoreId]
    );

    if (!result.rows.length) {
      return {
        storeNsId: null,
        invoiceLocationId: null,
      };
    }

    return {
      storeNsId: result.rows[0].netsuite_internal_id || null,
      invoiceLocationId: result.rows[0].invoice_location_id || null,
    };
  } catch (err) {
    console.error("❌ Failed to lookup store NetSuite ID:", err.message);
    return {
      storeNsId: null,
      invoiceLocationId: null,
    };
  }
}

/* =====================================================
   === CREATE NEW QUOTE (Estimate) =====================
===================================================== */
router.post("/create", async (req, res) => {
  try {
    const { customer, order, items } = req.body;
    let customerId = customer?.id || null;

    const userId = await resolveUserIdFromAuth(req);
    console.log("🔐 Authenticated user for quote creation:", userId);

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
        const match = newCust._location.match(/customer\/(\d+)/i);
        if (match) customerId = match[1];
      }

      if (!customerId) throw new Error("Failed to resolve new customer ID");
      console.log("✅ Created new customer → ID:", customerId);
    }

    console.log("🧩 Using Customer ID for Quote:", customerId);

    const salesExecNsId = await resolveSalesExecNsId(order?.salesExec);
    const { storeNsId, invoiceLocationId } = await resolveStoreData(order?.store);

    const estimateBody = {
      entity: { id: String(customerId) },
      trandate: new Date().toISOString().split("T")[0],
      orderstatus: "A",
      subsidiary: storeNsId ? { id: String(storeNsId) } : undefined,
      location: invoiceLocationId ? { id: String(invoiceLocationId) } : undefined,
      leadsource: order?.leadSource ? { id: String(order.leadSource) } : undefined,
      custbody_sb_paymentinfo: order?.paymentInfo
        ? { id: String(order.paymentInfo) }
        : undefined,
      custbody_sb_bedspecialist: salesExecNsId
        ? { id: String(salesExecNsId) }
        : undefined,
      custbody_sb_warehouse: order?.warehouse
        ? { id: String(order.warehouse) }
        : undefined,
      custbody_sb_primarystore: storeNsId
        ? { id: String(storeNsId) }
        : undefined,
      item: {
        items: (items || []).map((i) => ({
          item: { id: String(i.item) },
          quantity: Number(i.quantity) || 1,
          amount: Number(i.saleprice || i.amount || 0) / 1.2,
          custcol_sb_itemoptionsdisplay: i.options || "",
          ...(i.fulfilmentMethod && {
            custcol_sb_fulfilmentlocation: { id: String(i.fulfilmentMethod) },
          }),
          ...(i.taxCode && {
            taxCode: { id: String(i.taxCode) },
          }),
        })),
      },
    };

    console.log(
      "🧾 Quote payload for NetSuite:",
      JSON.stringify(estimateBody, null, 2)
    );

    const quoteRes = await nsPost("/estimate", estimateBody, userId, "sb");
    console.log("✅ Quote created successfully:", quoteRes);

    let quoteId = quoteRes.id || null;
    if (!quoteId && quoteRes._location) {
      const match = quoteRes._location.match(/estimate\/(\d+)/i);
      if (match) quoteId = match[1];
    }

    return res.json({ ok: true, quoteId, response: quoteRes });
  } catch (err) {
    console.error("❌ Quote creation error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =====================================================
   === GET FULL ENTITY RECORD ==========================
   IMPORTANT: keep this ABOVE "/:id"
===================================================== */
router.get("/entity/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📦 Fetching Entity ${id} from NetSuite...`);

    const userId = await resolveUserIdFromAuth(req);

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

/* =====================================================
   === GET QUOTE DETAILS ===============================
===================================================== */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📦 Fetching Quote ${id} from NetSuite...`);

    const userId = await resolveUserIdFromAuth(req);
    console.log("🔐 Authenticated user for quote view:", userId);

    const quote = await nsGet(`/estimate/${id}`, userId, "sb");
    if (!quote) throw new Error("No quote data returned from NetSuite");

    let expandedEntity = null;
    if (quote.entity?.id) {
      try {
        expandedEntity = await nsGet(`/customer/${quote.entity.id}`, userId, "sb");
        console.log("🔎 Expanded entity loaded:", {
          id: expandedEntity.id,
          title: expandedEntity.custentity_title,
        });
      } catch (err) {
        console.warn(
          `⚠️ Could not expand entity ${quote.entity.id}:`,
          err.message
        );
      }
    }

    if (expandedEntity) {
      quote.entity = { ...quote.entity, ...expandedEntity };
    }

    /* -----------------------------------------------------
       Expand Item Lines via SuiteQL
       Preserve tax code so PATCH replace=item can resend it
    ----------------------------------------------------- */
    const query = `
      SELECT
        t.id AS lineid,
        t.item,
        i.itemid AS itemname,
        t.quantity,
        t.netamount,
        t.grossamt,
        t.tax1amt,
        t.rate,
        t.taxcode,
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
        const itemId = String(r.item || "");
        const itemName = r.itemname || `Item ${itemId}`;
        const qty = Math.abs(Number(r.quantity) || 0);

        const itemNameLower = String(itemName || "").toLowerCase();

        const isNegativeValueLine =
          itemNameLower.includes("discount") ||
          itemNameLower.includes("blue light") ||
          itemNameLower.includes("promo") ||
          itemNameLower.includes("promotion") ||
          itemNameLower.includes("voucher") ||
          itemNameLower.includes("trade in") ||
          itemNameLower.includes("trade-in");

        let saleNet = Number(r.netamount) || 0;
        let saleGross = Number(r.grossamt) || 0;
        let vat = Number(r.tax1amt) || 0;
        let retailNetPerUnit = Number(r.rate) || 0;

        // NetSuite can return quote sales lines as negative internally.
        // Normal items should display positive; trade-ins/discounts should display negative.
        if (isNegativeValueLine) {
          saleNet = -Math.abs(saleNet);
          saleGross = saleGross ? -Math.abs(saleGross) : +(saleNet * 1.2).toFixed(2);
          vat = vat ? -Math.abs(vat) : +(saleGross - saleGross / 1.2).toFixed(2);
          retailNetPerUnit = -Math.abs(retailNetPerUnit);
        } else {
          saleNet = Math.abs(saleNet);
          saleGross = saleGross ? Math.abs(saleGross) : +(saleNet * 1.2).toFixed(2);
          vat = vat ? Math.abs(vat) : +(saleGross - saleGross / 1.2).toFixed(2);
          retailNetPerUnit = Math.abs(retailNetPerUnit);
        }

        const retailGross = +(retailNetPerUnit * qty * 1.2).toFixed(2);

        return {
          lineId: r.lineid ? String(r.lineid) : "",
          item: { id: itemId, refName: itemName },
          quantity: qty,
          amount: retailGross,
          vat: +vat.toFixed(2),
          saleprice: +saleGross.toFixed(2),
          retailNetPerUnit: +retailNetPerUnit.toFixed(2),
          taxCode: r.taxcode ? String(r.taxcode) : "",
          custcol_sb_itemoptionsdisplay: r.options || "",
          custcol_sb_fulfilmentlocation: r.custcol_sb_fulfilmentlocation || null,
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
   === SAVE QUOTE (RESTlet, NO replace=item) ===========
===================================================== */
router.post("/:id/save", async (req, res) => {
  try {
    const { id } = req.params;
    const { updates = [], headerUpdates = {} } = req.body;

    console.log(`💾 Saving Quote ${id} via NetSuite RESTlet`);
    console.log("📦 Incoming updates:", JSON.stringify(updates, null, 2));
    console.log("🧾 Incoming headerUpdates:", JSON.stringify(headerUpdates, null, 2));

    if (!id || !Array.isArray(updates)) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing Quote ID or updates array." });
    }

    const userId = await resolveUserIdFromAuth(req);
    console.log("🔐 Quote save request for user:", userId);

    const restletUrl =
      `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl` +
      `?script=${process.env.NS_QUOTE_SAVE_RESTLET_SCRIPT}` +
      `&deploy=${process.env.NS_QUOTE_SAVE_RESTLET_DEPLOY}`;

    if (!process.env.NS_QUOTE_SAVE_RESTLET_SCRIPT || !process.env.NS_QUOTE_SAVE_RESTLET_DEPLOY) {
      throw new Error("Missing NS_QUOTE_SAVE_RESTLET_SCRIPT or NS_QUOTE_SAVE_RESTLET_DEPLOY in environment");
    }

    const { getAuthHeader } = require("../netsuiteClient");
    const authHeader = await getAuthHeader(restletUrl, "POST", userId, "sb");

    const response = await fetch(restletUrl, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: String(id),
        updates,
        headerUpdates,
        commit: false,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok || !data.ok) {
      console.error("❌ Quote RESTlet returned error:", text);
      return res.status(500).json({
        ok: false,
        error: data?.error || "NetSuite Quote RESTlet call failed",
        raw: text,
      });
    }

    console.log(`✅ Quote ${id} saved via RESTlet`);

    return res.json({
      ok: true,
      message: data.message || "Quote saved successfully",
      restletResult: data,
    });
  } catch (err) {
    console.error("❌ Save Quote failed:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unexpected server error",
    });
  }
});


/* =====================================================
   === UPDATE QUOTE (Estimate) ==========================
===================================================== */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { order = {}, items = [] } = req.body || {};

    console.log(`📝 Updating Quote ${id}...`);

    const userId = await resolveUserIdFromAuth(req);
    console.log("🔐 Authenticated user for quote save:", userId);

    const existingQuote = await nsGet(`/estimate/${id}`, userId, "sb");
    if (!existingQuote) throw new Error("Quote not found");

    /* -----------------------------------------------------
       Pull current line metadata from NetSuite so we can
       preserve required fields like taxCode when doing
       PATCH ?replace=item
    ----------------------------------------------------- */
    const existingLinesQuery = `
      SELECT
        t.id AS lineid,
        t.item,
        t.taxcode,
        t.custcol_sb_itemoptionsdisplay AS options,
        t.custcol_sb_fulfilmentlocation
      FROM transactionline t
      WHERE t.transaction = ${id}
        AND t.mainline = 'F'
        AND t.taxline = 'F'
      ORDER BY t.linesequencenumber
    `;

    const existingLinesRes = await nsPostRaw(
      `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
      { q: existingLinesQuery },
      userId,
      "sb"
    );

    const existingLines = Array.isArray(existingLinesRes?.items)
      ? existingLinesRes.items
      : [];

    const existingByIndex = existingLines.map((line) => ({
      lineId: line.lineid ? String(line.lineid) : "",
      itemId: line.item ? String(line.item) : "",
      taxCode: line.taxcode ? String(line.taxcode) : "",
      options: line.options || "",
      fulfilmentMethod: line.custcol_sb_fulfilmentlocation
        ? String(line.custcol_sb_fulfilmentlocation)
        : "",
    }));

    const salesExecNsId = await resolveSalesExecNsId(order.salesExec);
    const { storeNsId, invoiceLocationId } = await resolveStoreData(order.store);

    const patchBody = {
      leadsource: order.leadSource
        ? { id: String(order.leadSource) }
        : undefined,
      custbody_sb_paymentinfo: order.paymentInfo
        ? { id: String(order.paymentInfo) }
        : undefined,
      custbody_sb_bedspecialist: salesExecNsId
        ? { id: String(salesExecNsId) }
        : undefined,
      custbody_sb_warehouse: order.warehouse
        ? { id: String(order.warehouse) }
        : undefined,
      custbody_sb_primarystore: storeNsId
        ? { id: String(storeNsId) }
        : undefined,
      location: invoiceLocationId
        ? { id: String(invoiceLocationId) }
        : undefined,
      subsidiary: storeNsId
        ? { id: String(storeNsId) }
        : undefined,
      item: {
        items: (items || []).map((i, index) => {
          const qty = Number(i.quantity) || 1;

          const grossToSave =
            i.saleprice !== undefined &&
              i.saleprice !== null &&
              i.saleprice !== ""
              ? Number(i.saleprice)
              : Number(i.amount || 0);

          const netLineTotal = +(grossToSave / 1.2).toFixed(2);
          const netUnitRate =
            qty > 0 ? +(netLineTotal / qty).toFixed(2) : 0;

          const existingLine = existingByIndex[index] || null;

          const taxCode =
            i.taxCode ||
            existingLine?.taxCode ||
            "";

          const fulfilmentMethod =
            i.fulfilmentMethod ||
            existingLine?.fulfilmentMethod ||
            "";

          const optionsValue =
            i.options !== undefined
              ? i.options
              : existingLine?.options || "";

          return {
            item: { id: String(i.item) },
            quantity: qty,
            price: { id: "-1" },
            rate: netUnitRate,
            amount: netLineTotal,
            ...(taxCode && {
              taxCode: { id: String(taxCode) },
            }),
            custcol_sb_itemoptionsdisplay: optionsValue || "",
            ...(fulfilmentMethod && {
              custcol_sb_fulfilmentlocation: { id: String(fulfilmentMethod) },
            }),
          };
        }),
      },
    };

    console.log("🧾 Quote PATCH payload:", JSON.stringify(patchBody, null, 2));

    const result = await nsPatch(
      `/estimate/${id}?replace=item`,
      patchBody,
      userId,
      "sb"
    );

    return res.json({
      ok: true,
      quoteId: id,
      response: result,
      message: "Quote updated successfully",
    });
  } catch (err) {
    console.error("❌ Quote update error:", err.message);
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

    const userId = await resolveUserIdFromAuth(req);

    const quote = await nsGet(`/estimate/${id}`, userId, "sb");
    if (!quote) throw new Error("Quote not found in NetSuite");

    const query = `
      SELECT
        item,
        quantity,
        rate,
        taxcode,
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
      ...(line.taxcode && {
        taxCode: { id: String(line.taxcode) },
      }),
      custcol_sb_itemoptionsdisplay: line.options || "",
      ...(line.custcol_sb_fulfilmentlocation && {
        custcol_sb_fulfilmentlocation: {
          id: String(line.custcol_sb_fulfilmentlocation),
        },
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
      const match = so._location.match(/salesorder\/(\d+)/i);
      if (match) salesOrderId = match[1];
    }

    return res.json({ ok: true, salesOrderId, response: so });
  } catch (err) {
    console.error("❌ Quote → Sales Order conversion failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;