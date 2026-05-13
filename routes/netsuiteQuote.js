// routes/netsuiteQuote.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsPost, nsGet, nsPostRaw, nsPatch } = require("../netsuiteClient");
const fetch = require("node-fetch");
const { getNetSuiteAppBaseUrl } = require("../utils/netsuiteEnvironment");
const { buildCustomFieldPatchPayload } = require("./customFields");

/* =====================================================
   Helpers
===================================================== */
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const lookupCache = new Map();
const ITEM_FEED_TTL_MS = 10 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const quoteCache = new Map();
const itemFeedCache = {
  data: null,
  expiresAt: 0,
  inFlight: null,
};

function hasExplicitValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isVatFreeTaxCode(value) {
  const raw =
    value && typeof value === "object"
      ? value.id || value.value || value.refName || ""
      : value;
  const code = String(raw || "").trim().toLowerCase();
  return code === "10" || code.includes("vat free") || code.includes("zero");
}

function sendNoStore(res) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
}

function getCachedLookup(key) {
  const cached = lookupCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    lookupCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedLookup(key, value) {
  lookupCache.set(key, {
    value,
    expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
  });
  return value;
}

function quoteCacheKey(id) {
  return `quote:${String(id || "").trim()}:v1`;
}

function quoteCacheGet(id) {
  const key = quoteCacheKey(id);
  const cached = quoteCache.get(key);
  if (!cached) return null;
  if (cached.inFlight) return cached;
  if (cached.expiresAt <= Date.now()) {
    quoteCache.delete(key);
    return null;
  }
  return cached;
}

function quoteCacheSet(id, data) {
  quoteCache.set(quoteCacheKey(id), {
    data,
    expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
    inFlight: null,
  });
}

function quoteCacheDelete(id) {
  quoteCache.delete(quoteCacheKey(id));
}

async function getItemMapCached() {
  if (itemFeedCache.data && itemFeedCache.expiresAt > Date.now()) {
    return itemFeedCache.data;
  }

  if (itemFeedCache.inFlight) return itemFeedCache.inFlight;

  itemFeedCache.inFlight = (async () => {
    const baseUrlItems = process.env.SALES_ORDER_ITEMS_URL;
    const itemFeedToken = process.env.SALES_ORDER_ITEMS;

    if (!baseUrlItems || !itemFeedToken) {
      throw new Error("Missing SALES_ORDER_ITEMS_URL or SALES_ORDER_ITEMS in .env");
    }

    const nsUrlItems = `${baseUrlItems}&token=${encodeURIComponent(itemFeedToken)}`;
    const respItems = await fetch(nsUrlItems);
    if (!respItems.ok) throw new Error(`NetSuite item feed returned ${respItems.status}`);

    const rawItems = await respItems.json();
    let itemList = [];
    if (Array.isArray(rawItems)) itemList = rawItems;
    else if (rawItems.results) itemList = rawItems.results;
    else if (rawItems.data) itemList = rawItems.data;

    const itemMap = {};
    for (const i of itemList) {
      const id = String(i.id || i.internalId || i.itemId || i["Internal ID"] || "").trim();
      if (!id) continue;

      const name = i.name || i.itemName || i["Name"] || i["Item Name"] || "";
      const baseprice = parseFloat(
        i.baseprice || i["Base Price"] || i["base price"] || i.price || 0
      );

      itemMap[id] = { name, baseprice: Number.isFinite(baseprice) ? baseprice : 0 };
    }

    itemFeedCache.data = itemMap;
    itemFeedCache.expiresAt = Date.now() + ITEM_FEED_TTL_MS;
    itemFeedCache.inFlight = null;
    return itemMap;
  })();

  try {
    return await itemFeedCache.inFlight;
  } finally {
    if (itemFeedCache.inFlight && !itemFeedCache.data) itemFeedCache.inFlight = null;
  }
}

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
  const cacheKey = `salesExec:${appUserId}`;
  const cached = getCachedLookup(cacheKey);
  if (cached !== null) return cached;

  try {
    const result = await pool.query(
      "SELECT netsuiteid FROM users WHERE id = $1 LIMIT 1",
      [appUserId]
    );
    return setCachedLookup(cacheKey, result.rows[0]?.netsuiteid || null);
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
  const cacheKey = `store:${appStoreId}`;
  const cached = getCachedLookup(cacheKey);
  if (cached !== null) return cached;

  try {
    const result = await pool.query(
      `SELECT netsuite_internal_id, invoice_location_id
         FROM locations
        WHERE id = $1
        LIMIT 1`,
      [appStoreId]
    );

    if (!result.rows.length) {
      return setCachedLookup(cacheKey, {
        storeNsId: null,
        invoiceLocationId: null,
      });
    }

    return setCachedLookup(cacheKey, {
      storeNsId: result.rows[0].netsuite_internal_id || null,
      invoiceLocationId: result.rows[0].invoice_location_id || null,
    });
  } catch (err) {
    console.error("❌ Failed to lookup store NetSuite ID:", err.message);
    return {
      storeNsId: null,
      invoiceLocationId: null,
    };
  }
}

function netSuiteAppBaseUrl() {
  return getNetSuiteAppBaseUrl();
}

function assignCustomerTitleIfPresent(body, title) {
  const titleId = String(title || "").trim();
  if (titleId) body.custentity_title = titleId;
}

function normalizeCustomerPhone(value) {
  const phone = String(value || "").trim();
  return phone || "00000";
}

/* =====================================================
   === CREATE NEW QUOTE (Estimate) =====================
===================================================== */
router.post("/create", async (req, res) => {
  try {
    const { customer, order, items, customFields = [] } = req.body;
    let customerId = customer?.noAddressRequired ? null : customer?.id || null;

    const userId = await resolveUserIdFromAuth(req);
    console.log("🔐 Authenticated user for quote creation:", userId);

    if (!customerId) {
      const noAddressRequired = customer?.noAddressRequired === true;
      const custBody = {
        entityStatus: { id: "13" },
        companyName: `${customer.firstName} ${customer.lastName}`,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: normalizeCustomerPhone(customer.contactNumber),
        altPhone: customer.altContactNumber,
        subsidiary: { id: "1" },
        isPerson: true,
      };
      assignCustomerTitleIfPresent(custBody, customer?.title);

      if (!noAddressRequired) {
        custBody.addressbook = {
          items: [
            {
              defaultShipping: true,
              defaultBilling: true,
              label: "Main Address",
              addressbookAddress: {
                addr1: customer.address1 || "",
                addr2: customer.address2 || "",
                city: customer.address3 || "",
                state: customer.county || "",
                zip: customer.postcode || "",
              },
            },
          ],
        };
      }

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

    const [salesExecNsId, storeData] = await Promise.all([
      resolveSalesExecNsId(order?.salesExec),
      resolveStoreData(order?.store),
    ]);
    const { storeNsId, invoiceLocationId } = storeData;

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
        items: (items || []).map((i) => {
          const itemClass = String(i.class || "").trim().toLowerCase();
          const isServiceItem = itemClass.includes("service");
          const grossToSave = hasExplicitValue(i.saleprice)
            ? numberOrZero(i.saleprice)
            : numberOrZero(i.amount);
          const qty = Number(i.quantity) || 1;
          const netLineTotal = +(grossToSave / (isVatFreeTaxCode(i.taxCode) ? 1 : 1.2)).toFixed(2);
          const netUnitRate = qty > 0 ? +(netLineTotal / qty).toFixed(2) : 0;

          return {
            item: { id: String(i.item) },
            quantity: qty,
            price: { id: "-1" },
            rate: netUnitRate,
            amount: netLineTotal,
            custcol_sb_itemoptionsdisplay: i.options || "",
            ...(!isServiceItem && i.fulfilmentMethod && {
              custcol_sb_fulfilmentlocation: { id: String(i.fulfilmentMethod) },
            }),
            ...(i.taxCode && {
              taxCode: { id: String(i.taxCode) },
            }),
          };
        }),
      },
    };

    if (Array.isArray(customFields) && customFields.length) {
      const { patch, error } = await buildCustomFieldPatchPayload({
        recordType: "quote",
        userId,
        updates: customFields,
      });

      if (error) {
        return res.status(400).json({ ok: false, error });
      }

      Object.assign(estimateBody, patch);
      console.log("Custom Quote fields included on create:", Object.keys(patch));
    }

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
  let cacheKey;
  let rejectInflight = null;

  try {
    sendNoStore(res);
    const { id } = req.params;
    console.log(`📦 Fetching Quote ${id} from NetSuite...`);

    cacheKey = quoteCacheKey(id);

    quoteCache.delete(cacheKey);

    const userId = await resolveUserIdFromAuth(req);
    console.log("🔐 Authenticated user for quote view:", userId);

    const quote = await nsGet(`/estimate/${id}`, userId, "sb");
    if (!quote) throw new Error("No quote data returned from NetSuite");

    const expandedEntityPromise = quote.entity?.id
      ? nsGet(`/customer/${quote.entity.id}`, userId, "sb")
          .then((expandedEntity) => {
            console.log("🔎 Expanded entity loaded:", {
              id: expandedEntity.id,
              title: expandedEntity.custentity_title,
            });
            return expandedEntity;
          })
          .catch((err) => {
            console.warn(
              `⚠️ Could not expand entity ${quote.entity.id}:`,
              err.message
            );
            return null;
          })
      : Promise.resolve(null);

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

    const [expandedEntity, suiteql, itemMap] = await Promise.all([
      expandedEntityPromise,
      nsPostRaw(
        `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
        { q: query },
        userId,
        "sb"
      ),
      getItemMapCached().catch((err) => {
        console.warn("⚠️ Could not load item retail map for quote:", err.message);
        return {};
      }),
    ]);

    if (expandedEntity) {
      quote.entity = { ...quote.entity, ...expandedEntity };
    }

    if (suiteql && Array.isArray(suiteql.items)) {
      const items = suiteql.items.map((r) => {
        const itemId = String(r.item || "");
        const itemInfo = itemMap[itemId] || {};
        const itemName = itemInfo.name || r.itemname || `Item ${itemId}`;
        const qty = Math.abs(Number(r.quantity) || 0);

        const itemNameLower = String(itemName || "").toLowerCase();

        let saleNet = Number(r.netamount) || 0;
        let saleGross = Number(r.grossamt) || 0;
        let vat = Number(r.tax1amt) || 0;
        let saleNetPerUnit = Number(r.rate) || 0;

        const isNegativeValueLine =
          itemNameLower.includes("discount") ||
          itemNameLower.includes("blue light") ||
          itemNameLower.includes("promo") ||
          itemNameLower.includes("promotion") ||
          itemNameLower.includes("voucher") ||
          itemNameLower.includes("trade in") ||
          itemNameLower.includes("trade-in");

        // NetSuite can return normal estimate lines as negative internally.
        // Only discount/trade-in style item names should display as negative.
        if (isNegativeValueLine) {
          saleNet = -Math.abs(saleNet);
          saleGross = saleGross ? -Math.abs(saleGross) : +(saleNet * 1.2).toFixed(2);
          vat = vat ? -Math.abs(vat) : +(saleGross - saleGross / 1.2).toFixed(2);
          saleNetPerUnit = -Math.abs(saleNetPerUnit);
        } else {
          saleNet = Math.abs(saleNet);
          saleGross = saleGross ? Math.abs(saleGross) : +(saleNet * 1.2).toFixed(2);
          vat = vat ? Math.abs(vat) : +(saleGross - saleGross / 1.2).toFixed(2);
          saleNetPerUnit = Math.abs(saleNetPerUnit);
        }

        const baseRetailNetPerUnit = Number(itemInfo.baseprice || 0);
        const fallbackRetailNetPerUnit = Math.abs(saleNetPerUnit);
        const retailNetPerUnit =
          baseRetailNetPerUnit > 0 ? baseRetailNetPerUnit : fallbackRetailNetPerUnit;
        let retailGross = +(retailNetPerUnit * qty * 1.2).toFixed(2);
        if (isNegativeValueLine) retailGross = -Math.abs(retailGross || saleGross);

        return {
          lineId: r.lineid ? String(r.lineid) : "",
          item: { id: itemId, refName: itemName },
          quantity: qty,
          amount: retailGross,
          vat: +vat.toFixed(2),
          saleprice: +saleGross.toFixed(2),
          retailNetPerUnit: +retailNetPerUnit.toFixed(2),
          saleNetPerUnit: +saleNetPerUnit.toFixed(2),
          taxCode: r.taxcode ? String(r.taxcode) : "",
          custcol_sb_itemoptionsdisplay: r.options || "",
          custcol_sb_fulfilmentlocation: r.custcol_sb_fulfilmentlocation || null,
        };
      });

      quote.item = { items };
      console.log(`✅ Loaded ${items.length} item lines for Quote`);
    }

    console.log("✅ Quote fetched successfully:", quote.tranId || quote.id);
    quote._netSuiteAppBaseUrl = netSuiteAppBaseUrl();
    const payload = { ok: true, quote };
    quoteCache.delete(cacheKey);
    return res.json({ ...payload, _cache: "BYPASS" });
  } catch (err) {
    console.error("❌ GET /quote/:id error:", err.message);
    try {
      if (typeof rejectInflight === "function") rejectInflight(err);
      if (cacheKey) quoteCache.delete(cacheKey);
    } catch {}
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
    console.log("Quote save payload summary:", {
      updates: Array.isArray(updates) ? updates.length : 0,
      headerFields: Object.keys(headerUpdates || {}).filter((key) => headerUpdates[key] != null),
    });

    if (!id || !Array.isArray(updates)) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing Quote ID or updates array." });
    }

    const userId = await resolveUserIdFromAuth(req);
    console.log("🔐 Quote save request for user:", userId);

    const [salesExecNsId, storeData] = await Promise.all([
      resolveSalesExecNsId(headerUpdates.salesExec),
      resolveStoreData(headerUpdates.store),
    ]);
    const { storeNsId } = storeData;
    const mappedHeaderUpdates = {
      ...headerUpdates,
      salesExec: salesExecNsId || "",
      store: storeNsId || "",
    };

    console.log("Mapped quote header fields for NetSuite:", {
      headerFields: Object.keys(mappedHeaderUpdates).filter((key) => mappedHeaderUpdates[key] != null),
    });

    const restletUrl =
      `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl` +
      `?script=${process.env.NS_QUOTE_SAVE_RESTLET_SCRIPT}` +
      `&deploy=${process.env.NS_QUOTE_SAVE_RESTLET_DEPLOY}`;

    if (!process.env.NS_QUOTE_SAVE_RESTLET_SCRIPT || !process.env.NS_QUOTE_SAVE_RESTLET_DEPLOY) {
      throw new Error("Missing NS_QUOTE_SAVE_RESTLET_SCRIPT or NS_QUOTE_SAVE_RESTLET_DEPLOY in environment");
    }

    const { getAuthHeader } = require("../netsuiteClient");
    const authHeader = await getAuthHeader(restletUrl, "POST", userId, "sb");

    const normalizedUpdates = updates.map((line) => {
      const quantity = numberOrZero(line.quantity) || 1;
      const retailGrossLine = numberOrZero(
        line.grossAmount ?? line.amountGrossLine ?? line.retailGrossLine ?? 0
      );
      const saleGrossLine = hasExplicitValue(line.grossSaleprice)
        ? numberOrZero(line.grossSaleprice)
        : hasExplicitValue(line.saleGrossLine)
          ? numberOrZero(line.saleGrossLine)
          : hasExplicitValue(line.saleprice)
            ? numberOrZero(line.saleprice)
            : +(numberOrZero(line.amount) * 1.2).toFixed(2);
      const discountPct = hasExplicitValue(line.discountPct)
        ? numberOrZero(line.discountPct)
        : hasExplicitValue(line.discount)
          ? numberOrZero(line.discount)
          : retailGrossLine > 0
            ? Math.max(0, ((retailGrossLine - saleGrossLine) / retailGrossLine) * 100)
            : 0;

      return {
        ...line,
        quantity,
        saleprice: saleGrossLine,
        grossSaleprice: saleGrossLine,
        saleGrossLine,
        amountGrossLine: retailGrossLine,
        grossAmount: retailGrossLine,
        discountPct,
        discount: discountPct,
      };
    });

    const response = await fetch(restletUrl, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: String(id),
        updates: normalizedUpdates,
        headerUpdates: mappedHeaderUpdates,
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
    quoteCacheDelete(id);

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

    const [existingQuote, existingLinesRes, salesExecNsId, storeData] = await Promise.all([
      nsGet(`/estimate/${id}`, userId, "sb"),
      nsPostRaw(
        `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
        { q: existingLinesQuery },
        userId,
        "sb"
      ),
      resolveSalesExecNsId(order.salesExec),
      resolveStoreData(order.store),
    ]);

    if (!existingQuote) throw new Error("Quote not found");

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

    const { storeNsId, invoiceLocationId } = storeData;

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

          const grossToSave = hasExplicitValue(i.saleprice)
            ? numberOrZero(i.saleprice)
            : numberOrZero(i.amount);

          const taxCode = i.taxCode || "";
          const netLineTotal = +(grossToSave / (isVatFreeTaxCode(taxCode) ? 1 : 1.2)).toFixed(2);
          const netUnitRate =
            qty > 0 ? +(netLineTotal / qty).toFixed(2) : 0;

          const existingLine = existingByIndex[index] || null;

          const lineTaxCode = taxCode || existingLine?.taxCode || "";

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
            ...(lineTaxCode && {
              taxCode: { id: String(lineTaxCode) },
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
    quoteCacheDelete(id);

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

    const orderBody = {
      trandate: new Date().toISOString().split("T")[0],
      orderstatus: "A",
      leadsource: quote.leadsource,
      custbody_sb_paymentinfo: quote.custbody_sb_paymentinfo,
      custbody_sb_bedspecialist: quote.custbody_sb_bedspecialist,
      custbody_sb_warehouse: quote.custbody_sb_warehouse,
      custbody_sb_primarystore: quote.custbody_sb_primarystore,
    };

    console.log("🧾 Final Sales Order payload:", JSON.stringify(orderBody, null, 2));
    const so = await nsPost(`/estimate/${id}/!transform/salesOrder`, orderBody, userId, "sb");
    quoteCacheDelete(id);

    let salesOrderId = so.id || null;
    if (!salesOrderId && so._location) {
      const match = so._location.match(/salesorder\/(\d+)/i);
      if (match) salesOrderId = match[1];
    }

    return res.json({
      ok: true,
      salesOrderId,
      quoteStatusUpdated: true,
      quoteStatusResult: {
        ok: true,
        method: "estimate_transform_salesOrder",
      },
      response: so,
    });
  } catch (err) {
    console.error("❌ Quote → Sales Order conversion failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
