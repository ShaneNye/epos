// routes/netsuiteSalesOrder.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const fetch = require("node-fetch");
const { getSession } = require("../sessions");
const {
  nsPost,
  nsGet,
  nsPostRaw,
  nsPatch,
  getAuthHeader,
} = require("../netsuiteClient");
const {
  getNetSuiteAccountDash,
  getNetSuiteAppBaseUrl,
} = require("../utils/netsuiteEnvironment");
const {
  loadTransactionCustomFieldValues,
  buildCustomFieldPatchPayload,
} = require("./customFields");

// =====================================================
// ✅ In-memory cache for GET /:id sales order payloads
// =====================================================
const SO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SO_CACHE_VERSION = "related-records-v4";
const soCache = new Map(); // key -> { expiresAt, data, inFlight }
const LOCATION_FEED_TTL_MS = 10 * 60 * 1000;
const locationFeedCache = { expiresAt: 0, rows: null, inFlight: null };
const inventoryNumberCache = new Map();
const SALES_ORDER_PENDING_APPROVAL_STATUS = { id: "A" };
const TRANSFER_ORDER_APPROVED_STATUS = { id: "B" };
const SALES_ORDER_PENDING_APPROVAL_LEGACY_STATUS = "A";

function sendNoStore(res) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });
}

function cachePrefix(id) {
  return `so:${String(id).trim()}`;
}

function cacheKey(id, { lite = false, includeDeposits = true } = {}) {
  return `${cachePrefix(id)}:${SO_CACHE_VERSION}:lite:${lite ? 1 : 0}:dep:${includeDeposits ? 1 : 0}`;
}

function cacheDeleteSalesOrder(id) {
  const prefix = `${cachePrefix(id)}:`;
  for (const key of soCache.keys()) {
    if (key === cachePrefix(id) || key.startsWith(prefix)) soCache.delete(key);
  }
}

function suiteQlUrl() {
  return `https://${getNetSuiteAccountDash()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

function normalizeLocationLookupName(value) {
  return String(value || "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function normalizeBroadLocationLookupName(value) {
  return String(value || "")
    .replace(/\b(store|warehouse)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

async function loadLocationFeedRows() {
  if (locationFeedCache.rows && locationFeedCache.expiresAt > Date.now()) {
    return locationFeedCache.rows;
  }

  if (locationFeedCache.inFlight) return locationFeedCache.inFlight;

  locationFeedCache.inFlight = (async () => {
    const baseUrl = process.env.SALES_ORD_LOCATION_URL;
    const token = process.env.SALES_ORDER_TKN_LOCATION;
    if (!baseUrl || !token) return [];

    const url = `${baseUrl}&token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Location feed response ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload.results) ? payload.results : Array.isArray(payload) ? payload : [];

    locationFeedCache.rows = rows;
    locationFeedCache.expiresAt = Date.now() + LOCATION_FEED_TTL_MS;
    locationFeedCache.inFlight = null;
    return rows;
  })();

  try {
    return await locationFeedCache.inFlight;
  } catch (err) {
    locationFeedCache.inFlight = null;
    console.warn("⚠️ Failed to load NetSuite location feed:", err.message);
    return [];
  }
}

async function resolveNetSuiteLocationIdByName(name) {
  const wanted = normalizeLocationLookupName(name);
  if (!wanted) return "";

  const rows = await loadLocationFeedRows();
  const rowNameFor = (row) => row.Name || row.name || row.Location || row.location;
  const exact = rows.find((row) => normalizeLocationLookupName(rowNameFor(row)) === wanted);
  const broadWanted = normalizeBroadLocationLookupName(name);
  const broad = exact || rows.find((row) => {
    const rowName = normalizeBroadLocationLookupName(rowNameFor(row));
    return rowName && broadWanted && rowName === broadWanted;
  });

  return String(broad?.["Internal ID"] || broad?.id || broad?.internalid || "").trim();
}

async function getInventoryNumberInfo(inventoryNumberId, userId) {
  const id = String(inventoryNumberId || "").trim();
  if (!id) return null;
  if (inventoryNumberCache.has(id)) return inventoryNumberCache.get(id);

  try {
    const record = await nsGet(`/inventoryNumber/${encodeURIComponent(id)}`, userId);
    const info = {
      id: String(record?.id || id),
      number: String(record?.inventoryNumber || record?.inventorynumber || record?.name || ""),
      itemId: String(record?.item?.id || record?.item || ""),
      itemName: String(record?.item?.refName || ""),
    };
    inventoryNumberCache.set(id, info);
    return info;
  } catch (err) {
    console.warn(`⚠️ Unable to validate inventory number ${id}:`, err.message);
  }
  return null;
}

async function getLinkedTransferOrders(salesOrderId, userId) {
  const numericId = Number(salesOrderId);
  if (!Number.isFinite(numericId) || numericId <= 0) return [];

  const query = `
    SELECT id, tranid, status
    FROM transaction
    WHERE custbody_sb_relatedsalesorder = ${numericId}
  `;

  const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
  return Array.isArray(result?.items) ? result.items : [];
}

async function approveLinkedTransferOrders(salesOrderId, userId) {
  const transfers = await getLinkedTransferOrders(salesOrderId, userId);
  const results = await Promise.all(transfers.map(async (transfer) => {
    const transferId = transfer?.id;
    if (!transferId) return null;

    try {
      await nsPatch(
        `/transferOrder/${transferId}`,
        { orderStatus: TRANSFER_ORDER_APPROVED_STATUS },
        userId
      );
      console.log(`✅ Linked Transfer Order ${transfer.tranid || transferId} approved`);
      return {
        ok: true,
        id: String(transferId),
        tranid: transfer.tranid || null,
      };
    } catch (err) {
      console.error(
        `❌ Failed to approve linked Transfer Order ${transfer.tranid || transferId}:`,
        err.message
      );
      return {
        ok: false,
        id: String(transferId),
        tranid: transfer.tranid || null,
        error: err.message,
      };
    }
  }));

  const approved = results
    .filter((result) => result?.ok)
    .map(({ id, tranid }) => ({ id, tranid }));
  const failed = results
    .filter((result) => result && !result.ok)
    .map(({ id, tranid, error }) => ({ id, tranid, error }));

  return {
    ok: failed.length === 0,
    found: transfers.length,
    approved,
    failed,
  };
}

async function forceSalesOrderPendingApproval(salesOrderId, userId) {
  const attempts = [
    { orderstatus: SALES_ORDER_PENDING_APPROVAL_LEGACY_STATUS },
    { orderStatus: SALES_ORDER_PENDING_APPROVAL_STATUS },
  ];

  let lastError = null;
  for (const body of attempts) {
    try {
      await nsPatch(`/salesOrder/${salesOrderId}`, body, userId);
      console.log(`✅ Sales Order ${salesOrderId} forced to Pending Approval`);
      return true;
    } catch (err) {
      lastError = err;
      console.warn(
        `⚠️ Pending Approval PATCH failed for Sales Order ${salesOrderId}:`,
        err.message
      );
    }
  }

  throw lastError || new Error("Unable to set Sales Order to Pending Approval");
}

function isProductionEnv() {
  return (process.env.ENVIRONMENT || "").toUpperCase() === "PRODUCTION";
}

function getComsSalesValueRestletUrl() {
  const configuredUrl =
    process.env.COMS_SALES_VALUE_RESTLET_URL ||
    process.env.NS_COMS_SALES_VALUE_RESTLET_URL ||
    "";

  if (configuredUrl) return configuredUrl;

  if (isProductionEnv()) return "";

  return "https://7972741-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=4193&deploy=1";
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isNetSuiteAuthError(payload) {
  const code = String(payload?.error?.code || payload?.code || "");
  const message = String(payload?.error?.message || payload?.message || payload?.raw || "");

  return (
    code === "INVALID_LOGIN_ATTEMPT" ||
    /invalid login attempt/i.test(message) ||
    /oauth|authentication|authorization/i.test(message)
  );
}

function publicNetSuiteError(payload, fallback = "NetSuite RESTlet call failed") {
  if (isNetSuiteAuthError(payload)) {
    return {
      error: "NetSuite authentication failed. Please contact support.",
      code: "NETSUITE_AUTH_FAILED",
      retryable: false,
    };
  }

  return {
    error: payload?.error?.message || payload?.error || payload?.message || fallback,
    code: payload?.error?.code || payload?.code || "NETSUITE_RESTLET_FAILED",
    retryable: true,
  };
}

async function loadSalesOrderComsFields(salesOrderId, userId) {
  const fields = [
    "id",
    "custbody_stc_total_after_discount",
    "custrecord_sb_coms_profit",
    "custbody_sb_bedspecialist",
  ].join(",");

  try {
    return await nsGet(
      `/salesOrder/${salesOrderId}?fields=${encodeURIComponent(fields)}`,
      userId,
      "sb"
    );
  } catch (err) {
    console.warn(
      "⚠️ Minimal COMS sales-order field load failed; falling back to full record:",
      err.message
    );
    return nsGet(`/salesOrder/${salesOrderId}`, userId, "sb");
  }
}

async function createComsSalesValueRecord(salesOrderId, userId) {
  const restletUrl = getComsSalesValueRestletUrl();

  if (!restletUrl) {
    return {
      ok: false,
      skipped: true,
      error: "COMS sales value RESTlet URL is not configured for production.",
    };
  }

  console.log("📊 Creating customrecord_sb_coms_sales_value for SO:", salesOrderId);

  const [soData, comsAuthHeader] = await Promise.all([
    loadSalesOrderComsFields(salesOrderId, userId),
    getAuthHeader(restletUrl, "POST", userId),
  ]);

  const soInternalId = soData?.id || soData?.internalId || salesOrderId;
  const grossValue = soData?.custbody_stc_total_after_discount || 0;
  const profitValue = soData?.custrecord_sb_coms_profit || 0;
  const salesRep = soData?.custbody_sb_bedspecialist?.id || null;

  const recordBody = {
    custrecord_sb_coms_date: new Date().toISOString().split("T")[0],
    custrecord_sb_coms_sales_order: { id: String(soInternalId) },
    custrecord_sb_coms_gross: parseFloat(grossValue) || 0,
    custrecord_sb_coms_profit: parseFloat(profitValue) || 0,
    ...(salesRep && { custrecord_sb_coms_sales_rep: { id: String(salesRep) } }),
  };

  console.log("🧾 Custom record payload:", recordBody);

  const resCreate = await fetch(restletUrl, {
    method: "POST",
    headers: {
      ...comsAuthHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(recordBody),
  });

  const text = await resCreate.text();
  const json = parseMaybeJson(text);
  if (!resCreate.ok || !json.ok) {
    return {
      ok: false,
      skipped: false,
      ...publicNetSuiteError(json, "COMS sales value record creation failed"),
    };
  }

  console.log(`✅ Custom record created successfully → ID ${json.id}`);
  return { ok: true, skipped: false, id: json.id || null };
}

function cacheGet(key) {
  const e = soCache.get(key);
  if (!e) return null;

  // in-flight promise exists
  if (e.inFlight) return e;

  // expired
  if (e.expiresAt && e.expiresAt < Date.now()) {
    soCache.delete(key);
    return null;
  }
  return e;
}

function cacheSet(key, data) {
  soCache.set(key, {
    data,
    expiresAt: Date.now() + SO_CACHE_TTL_MS,
    inFlight: null,
  });
}

// optional: prevent memory creep
function cachePrune(max = 300) {
  if (soCache.size <= max) return;
  const over = soCache.size - max;
  for (let i = 0; i < over; i++) {
    const first = soCache.keys().next().value;
    soCache.delete(first);
  }
}

// =====================================================
// ✅ Cached suitelet lookups (Item feed + Fulfilment map)
// =====================================================
const ITEM_FEED_TTL_MS = 60 * 60 * 1000; // 1 hour
const FULFIL_TTL_MS = 60 * 60 * 1000; // 1 hour

const itemFeedCache = {
  expiresAt: 0,
  data: null, // itemMap
  inFlight: null,
};

const fulfilmentCache = {
  expiresAt: 0,
  data: null, // fulfilmentMap
  inFlight: null,
};

function summarizePatchPayload(lines, headerUpdates, deletedLineIds) {
  return {
    lineCount: Array.isArray(lines) ? lines.length : 0,
    deletedLineCount: Array.isArray(deletedLineIds) ? deletedLineIds.length : 0,
    headerFields: Object.keys(headerUpdates || {}).filter(
      (field) => headerUpdates[field] !== null && headerUpdates[field] !== undefined
    ),
  };
}

function isFresh(expiresAt) {
  return expiresAt && expiresAt > Date.now();
}

async function getItemMapCached() {
  if (itemFeedCache.data && isFresh(itemFeedCache.expiresAt)) return itemFeedCache.data;
  if (itemFeedCache.inFlight) return itemFeedCache.inFlight;

  itemFeedCache.inFlight = (async () => {
    const baseUrlItems = process.env.SALES_ORDER_ITEMS_URL;
    const itemFeedToken = process.env.SALES_ORDER_ITEMS;

    if (!baseUrlItems || !itemFeedToken) {
      throw new Error("Missing SALES_ORDER_ITEMS_URL or SALES_ORDER_ITEMS in .env");
    }

    const nsUrlItems = `${baseUrlItems}&token=${encodeURIComponent(itemFeedToken)}`;
    console.log(`📡 [Cache] Fetching item feed from: ${nsUrlItems}`);

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
      const itemClass =
        i.class ||
        i.Class ||
        i.itemClass ||
        i["Item Class"] ||
        i.type ||
        i.Type ||
        i.itemType ||
        i["Item Type"] ||
        "";
      const baseprice = parseFloat(
        i.baseprice || i["Base Price"] || i["base price"] || i.price || 0
      );

      itemMap[id] = {
        name,
        baseprice: Number.isFinite(baseprice) ? baseprice : 0,
        class: itemClass,
      };
    }

    itemFeedCache.data = itemMap;
    itemFeedCache.expiresAt = Date.now() + ITEM_FEED_TTL_MS;
    itemFeedCache.inFlight = null;

    return itemMap;
  })();

  try {
    return await itemFeedCache.inFlight;
  } finally {
    // if it threw, clear inFlight so next request can retry
    if (itemFeedCache.inFlight && !itemFeedCache.data) itemFeedCache.inFlight = null;
  }
}

async function getFulfilmentMapCached() {
  if (fulfilmentCache.data && isFresh(fulfilmentCache.expiresAt)) return fulfilmentCache.data;
  if (fulfilmentCache.inFlight) return fulfilmentCache.inFlight;

  fulfilmentCache.inFlight = (async () => {
    const baseUrlFM = process.env.SALES_ORDER_FULFIL_METHOD_URL;
    const tokenFM = process.env.SALES_ORDER_FULFIL_METHOD;

    if (!baseUrlFM || !tokenFM) {
      console.warn("⚠️ Missing SALES_ORDER_FULFIL_METHOD environment variables.");
      fulfilmentCache.data = {};
      fulfilmentCache.expiresAt = Date.now() + FULFIL_TTL_MS;
      fulfilmentCache.inFlight = null;
      return {};
    }

    const nsUrlFM = `${baseUrlFM}&token=${encodeURIComponent(tokenFM)}`;
    console.log(`📡 [Cache] Fetching fulfilment methods from: ${nsUrlFM}`);

    const fmRes = await fetch(nsUrlFM);
    if (!fmRes.ok) {
      console.warn("⚠️ Fulfilment suitelet returned:", fmRes.status);
      fulfilmentCache.data = {};
      fulfilmentCache.expiresAt = Date.now() + FULFIL_TTL_MS;
      fulfilmentCache.inFlight = null;
      return {};
    }

    const fmJson = await fmRes.json();
    const fmList = fmJson.results || fmJson.data || [];

    const fulfilmentMap = {};
    for (const f of fmList) {
      const id = String(f["Internal ID"] || f.id || f.internalid || "").trim();
      const name = (f["Name"] || f.name || "").trim();
      if (id && name) fulfilmentMap[id] = name;
    }

    fulfilmentCache.data = fulfilmentMap;
    fulfilmentCache.expiresAt = Date.now() + FULFIL_TTL_MS;
    fulfilmentCache.inFlight = null;

    return fulfilmentMap;
  })();

  try {
    return await fulfilmentCache.inFlight;
  } finally {
    if (fulfilmentCache.inFlight && !fulfilmentCache.data) fulfilmentCache.inFlight = null;
  }
}

function map30NightTrialOptionId(raw) {
  const v = String(raw || "").trim().toLowerCase();

  if (v === "accepted") return "1";
  if (v === "declined") return "2";
  if (v === "n/a" || v === "na") return "3";

  return ""; // not provided / unknown
}

// =====================================================
// ✅ Helper: build “lite” fields lists for REST Record service
// =====================================================
function buildSalesOrderFields() {
  // NOTE: these must match *your* REST field IDs. This list is intentionally “safe-ish”.
  // If any field name is invalid, NetSuite can error. Remove/adjust using REST API Browser if needed.
  return [
    "id",
    "tranId",
    "trandate",
    "orderStatus",
    "entity",
    "location",
    "leadsource",
    "custbody_sb_bedspecialist",
    "custbody_sb_primarystore",
    "custbody_sb_paymentinfo",
    "custbody_sb_warehouse",
    "custbody_sb_is_web_order",
    "custbody_sb_pairedsalesorder",
    "custbody_sb_relatedpurchaseorders",
    "custbody_exported_to_dispatchtrack",
    "memo",
    // totals (field IDs vary; keep what works in your account)
    "subtotal",
    "discountTotal",
    "taxtotal",
    "total",
    "amountremaining",
    // addresses (again, may vary)
    "billAddress",
    "shipAddress",
  ].join(",");
}

function buildCustomerFields() {
  return [
    "id",
    "firstName",
    "lastName",
    "email",
    "phone",
    "altPhone",
    "custentity_title",
    // optional address-related fields if you rely on them
    "addressbook",
  ].join(",");
}

function netSuiteAppBaseUrl() {
  return getNetSuiteAppBaseUrl();
}

function splitNetSuiteMultiValue(value) {
  return String(value || "")
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function relatedRecordList(ids, names) {
  const idList = splitNetSuiteMultiValue(ids);
  const nameList = splitNetSuiteMultiValue(names);
  const length = Math.max(idList.length, nameList.length);

  return Array.from({ length }, (_, index) => ({
    id: idList[index] || "",
    refName: nameList[index] || idList[index] || "",
  })).filter((record) => record.id || record.refName);
}

async function getSalesOrderRelatedRecords(salesOrderId, userId) {
  const numericId = Number(salesOrderId);
  if (!Number.isFinite(numericId) || numericId <= 0) return {};

  const query = `
    SELECT
      custbody_sb_pairedsalesorder AS paired_sales_order_id,
      BUILTIN.DF(custbody_sb_pairedsalesorder) AS paired_sales_order_name,
      custbody_sb_relatedpurchaseorders AS related_purchase_order_ids,
      BUILTIN.DF(custbody_sb_relatedpurchaseorders) AS related_purchase_order_names,
      custbody_exported_to_dispatchtrack AS exported_to_dispatchtrack
    FROM transaction
    WHERE id = ${numericId}
  `;

  const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
  const row = Array.isArray(result?.items) ? result.items[0] : null;
  if (!row) return {};

  const pairedSalesOrder = relatedRecordList(
    row.paired_sales_order_id,
    row.paired_sales_order_name
  )[0] || null;

  const relatedPurchaseOrders = relatedRecordList(
    row.related_purchase_order_ids,
    row.related_purchase_order_names
  );

  return {
    custbody_sb_pairedsalesorder: pairedSalesOrder,
    custbody_sb_relatedpurchaseorders: relatedPurchaseOrders,
    custbody_exported_to_dispatchtrack:
      row.exported_to_dispatchtrack === true ||
      String(row.exported_to_dispatchtrack || "").trim().toUpperCase() === "T",
  };
}

async function getSalesOrderSalesExec(salesOrderId, userId) {
  const numericId = Number(salesOrderId);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;

  const query = `
    SELECT
      custbody_sb_bedspecialist AS sales_exec_id,
      BUILTIN.DF(custbody_sb_bedspecialist) AS sales_exec_name
    FROM transaction
    WHERE id = ${numericId}
  `;

  const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId, "sb");
  const row = Array.isArray(result?.items) ? result.items[0] : null;
  const id = String(row?.sales_exec_id || "").trim();
  const refName = String(row?.sales_exec_name || "").trim();
  if (!id && !refName) return null;
  return { id, refName };
}

async function resolveUserIdFromRequest(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  try {
    const session = await getSession(token);
    return session?.id || null;
  } catch (err) {
    console.warn("⚠️ Could not resolve session:", err.message);
    return null;
  }
}

function normalizeDepositReportKeys(obj) {
  const normalized = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const cleanKey = String(key || "").replace(/\u00A0/g, " ").trim();
    normalized[cleanKey] = value;
  }
  return normalized;
}

function depositSalesOrderCandidates(row) {
  return [
    row["SO Id"],
    row["SO ID"],
    row["SO Internal ID"],
    row["Sales Order"],
    row["Sales Order #"],
    row["Sales Order Number"],
    row["Sales Order Id"],
    row["Sales Order ID"],
    row["Sales Order Internal ID"],
    row["Sales Order Internal Id"],
    row["Created From"],
    row["Created From Id"],
    row["Created From ID"],
    row["Created From Internal ID"],
    row["Created From Internal Id"],
    row["Applied To"],
    row["Applied To Id"],
    row["Applied To ID"],
    row["Applied To Transaction Id"],
    row["Applied To Transaction ID"],
    row.soId,
    row.soid,
    row.salesOrderId,
    row.salesorderid,
    row.salesOrder,
    row.createdFromId,
    row.createdfromid,
    row.createdFrom,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "").trim();
}

function depositCandidateMatchesWanted(candidate, wantedIds) {
  const raw = String(candidate || "").trim();
  if (!raw) return false;

  const plain = stripHtml(raw);
  if (wantedIds.has(raw) || wantedIds.has(plain)) return true;

  const hrefId = raw.match(/[?&]id=(\d+)/i)?.[1];
  if (hrefId && wantedIds.has(hrefId)) return true;

  for (const wanted of wantedIds) {
    if (!wanted) continue;
    if (/^\d+$/.test(wanted)) {
      if (new RegExp(`\\b${wanted}\\b`).test(plain)) return true;
    } else if (plain.toLowerCase().includes(String(wanted).toLowerCase())) {
      return true;
    }
  }

  return false;
}

function depositDocumentNumber(row) {
  return (
    row["Document Number"] ||
    row["Deposit #"] ||
    row["Number"] ||
    row.tranId ||
    row.tranid ||
    row.id ||
    "-"
  );
}

function normalizeDepositAmount(value) {
  return parseFloat(String(value || "0").replace(/[^\d.-]/g, "")) || 0;
}

function normalizeReportDeposit(row, salesOrderId) {
  return {
    link: depositDocumentNumber(row),
    amount: normalizeDepositAmount(row["Amount"] || row.amount || row.total),
    method: row["Payment Method"] || row.paymentMethod || row.paymentMethodText || "-",
    soId: String(row["SO Id"] || row.salesOrderId || salesOrderId || ""),
  };
}

function sqlNumberList(values) {
  const ids = [...new Set(
    values
      .map((value) => Number(String(value || "").trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
  )];
  return ids.length ? ids.join(",") : "";
}

function normalizeSuiteQlDeposit(row, salesOrderId) {
  const depositId = String(row.id || row.internalid || "").trim();
  const amount = Math.abs(normalizeDepositAmount(
    row.amount || row.foreigntotal || row.total || row.fxamount
  ));
  const method =
    row.paymentmethod_text ||
    row.payment_method ||
    row.paymentmethod ||
    row["Payment Method"] ||
    "-";
  const label = row.tranid || row.documentnumber || (depositId ? `CD${depositId}` : "-");
  const link = depositId
    ? `<a href="${netSuiteAppBaseUrl()}/app/accounting/transactions/custdep.nl?id=${encodeURIComponent(depositId)}" target="_blank">${label}</a>`
    : label;

  return {
    link,
    amount,
    method,
    soId: String(row.createdfrom || salesOrderId || ""),
  };
}

function depositKey(deposit) {
  const link = String(deposit?.link || "").replace(/<[^>]*>/g, "").trim();
  return `${link || "deposit"}:${Number(deposit?.amount || 0).toFixed(2)}:${String(deposit?.method || "")}`;
}

function mergeDeposits(...depositGroups) {
  const merged = [];
  const seen = new Set();

  depositGroups.flat().forEach((deposit) => {
    if (!deposit) return;
    const key = depositKey(deposit);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(deposit);
  });

  return merged;
}

async function fetchReportDepositsForSalesOrder(req, salesOrderId, headers = {}, alternateSalesOrderIds = []) {
  const baseUrl = String(process.env.CUSTOMER_DEPOSITS_URL || "").replace(/^"|"$/g, "");
  const token = process.env.CUSTOMER_DEPOSITS;
  if (!baseUrl || !token) {
    throw new Error("Missing CUSTOMER_DEPOSITS_URL or CUSTOMER_DEPOSITS in environment");
  }

  const joiner = String(baseUrl).includes("?") ? "&" : "?";
  const depUrl = `${baseUrl}${joiner}token=${encodeURIComponent(token)}&refresh=1&_=${Date.now()}`;
  const depRes = await fetch(depUrl, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!depRes.ok) throw new Error(`Customer deposits endpoint returned ${depRes.status}`);

  const depJson = await depRes.json();
  const allDeposits = depJson.results || depJson.data || [];
  const wantedIds = new Set(
    [salesOrderId, ...alternateSalesOrderIds]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  return allDeposits
    .map(normalizeDepositReportKeys)
    .filter((row) =>
      depositSalesOrderCandidates(row).some((candidate) =>
        depositCandidateMatchesWanted(candidate, wantedIds)
      )
    )
    .map((row) => normalizeReportDeposit(row, salesOrderId));
}

async function fetchSuiteQlDepositsForSalesOrder(salesOrderId, userId, alternateSalesOrderIds = []) {
  const idList = sqlNumberList([salesOrderId, ...alternateSalesOrderIds]);
  if (!idList) return [];

  const queries = [
    `
      SELECT
        t.id,
        t.tranid,
        t.trandate,
        t.createdfrom,
        t.total,
        t.foreigntotal,
        t.paymentmethod,
        BUILTIN.DF(t.paymentmethod) AS paymentmethod_text
      FROM transaction t
      WHERE t.recordtype = 'customerdeposit'
        AND t.createdfrom IN (${idList})
      ORDER BY t.trandate DESC, t.id DESC
    `,
    `
      SELECT
        t.id,
        t.tranid,
        t.trandate,
        t.createdfrom,
        t.total
      FROM transaction t
      WHERE t.recordtype = 'customerdeposit'
        AND t.createdfrom IN (${idList})
      ORDER BY t.trandate DESC, t.id DESC
    `,
  ];

  let lastError = null;
  for (const query of queries) {
    try {
      const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId, "sb");
      const rows = Array.isArray(result?.items) ? result.items : [];
      return rows.map((row) => normalizeSuiteQlDeposit(row, salesOrderId));
    } catch (err) {
      lastError = err;
      console.warn("Customer deposit SuiteQL attempt failed:", err.message);
    }
  }

  throw lastError || new Error("Customer deposit SuiteQL failed");
}

async function loadSalesOrderDeposits(req, salesOrderId, {
  bearerToken = null,
  userId = null,
  prewarmHeaders = null,
  alternateSalesOrderIds = [],
} = {}) {
  let reportDeposits = [];
  let suiteQlDeposits = [];

  try {
    reportDeposits = await fetchReportDepositsForSalesOrder(
      req,
      salesOrderId,
      {
        ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        ...(prewarmHeaders || {}),
      },
      alternateSalesOrderIds
    );
  } catch (err) {
    console.warn(`Could not fetch customer deposit report for SO ${salesOrderId}:`, err.message);
  }

  try {
    suiteQlDeposits = await fetchSuiteQlDepositsForSalesOrder(
      salesOrderId,
      userId,
      alternateSalesOrderIds
    );
  } catch (err) {
    console.warn(`Could not fetch customer deposits via SuiteQL for SO ${salesOrderId}:`, err.message);
  }

  return mergeDeposits(reportDeposits, suiteQlDeposits);
}

/* =====================================================
   === CREATE NEW SALES ORDER ===========================
   ===================================================== */
router.post("/create", async (req, res) => {
  try {
    // 🔐 Get user session
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
    if (token) {
      const session = await getSession(token);
      console.log("🧠 Session returned from getSession():", session);
      userId = session?.id || null;
      console.log("🔐 Authenticated session for SO creation:", userId);
    }

    const { customer, order, items } = req.body;
    let customerId = customer?.noAddressRequired ? null : customer?.id || null;

    /* ======================================================
   1️⃣ CREATE CUSTOMER IF NEEDED
====================================================== */
    if (!customerId) {
      const noAddressRequired = customer?.noAddressRequired === true;

      const custBody = {
        entityStatus: { id: "13" },
        companyName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
        custentity_title: customer.title,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.contactNumber,
        altPhone: customer.altContactNumber,
        subsidiary: { id: "1" },
        isPerson: true,
      };

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
                //country: "United Kingdom",//
              },
            },
          ],
        };
      } else {
        console.log(
          "🏷 No address required enabled — creating NEW customer without addressbook"
        );
      }

      console.log("🧾 Creating new customer:", JSON.stringify(custBody, null, 2));
      const newCustomer = await nsPost("/customer", custBody, userId, "sb");

      let match;
      if (
        newCustomer._location &&
        (match = newCustomer._location.match(/customer\/(\d+)/))
      ) {
        customerId = match[1];
      } else if (newCustomer.id) {
        customerId = newCustomer.id;
      }

      if (!customerId) throw new Error("Failed to resolve new customer ID");

      console.log("✅ Created new customer, resolved ID:", customerId);
    }

    /* ======================================================
       2️⃣ LOOKUP SALES EXEC + STORE INFORMATION
    ====================================================== */
    const [salesExecLookup, storeLookup] = await Promise.all([
      order.salesExec
        ? pool
            .query("SELECT netsuiteid FROM users WHERE id = $1", [order.salesExec])
            .then((resultExec) => resultExec.rows[0]?.netsuiteid || null)
            .catch((err) => {
              console.error("❌ Sales Exec lookup failed:", err.message);
              return null;
            })
        : Promise.resolve(null),
      order.store
        ? pool
            .query(
              `SELECT name, netsuite_internal_id, invoice_location_id
               FROM locations WHERE id = $1`,
              [order.store]
            )
            .then((resultLoc) => resultLoc.rows[0] || null)
            .catch((err) => {
              console.error("❌ Store lookup failed:", err.message);
              return null;
            })
        : Promise.resolve(null),
    ]);

    const salesExecNsId = salesExecLookup;
    const invoiceLocationId = storeLookup?.invoice_location_id || null;
    const storeNsId = storeLookup?.netsuite_internal_id || null;
    const storeName = storeLookup?.name || "";

    console.log("👤 Sales Executive NS ID:", salesExecNsId);
    console.log("🏬 Store lookup →", {
      storeNsId,
      invoiceLocationId,
      storeName,
    });

    /* ======================================================
       4️⃣ BUILD ORDER BODY (BEFORE INTERCOPO + WEB ORDER)
    ====================================================== */
    const orderBody = {
      entity: { id: customerId },
      subsidiary: storeNsId ? { id: String(storeNsId) } : undefined,
      trandate: new Date().toISOString().split("T")[0],
      orderStatus: SALES_ORDER_PENDING_APPROVAL_STATUS,
      orderstatus: SALES_ORDER_PENDING_APPROVAL_LEGACY_STATUS,
      location: invoiceLocationId ? { id: String(invoiceLocationId) } : undefined,
      custbody_sb_bedspecialist: salesExecNsId ? { id: salesExecNsId } : undefined,
      custbody_sb_primarystore: storeNsId ? { id: storeNsId } : undefined,
      leadsource: { id: order.leadSource },
      custbody_sb_paymentinfo: { id: order.paymentInfo },
      custbody_sb_warehouse: { id: order.warehouse },
      memo: order.memo,

      item: {
        items: items.map((i, idx) => {
          const itemClass = String(i.class || "").trim().toLowerCase();
          const isServiceItem = itemClass.includes("service");
          const line = {
            item: { id: i.item },
            quantity: i.quantity,
            amount: i.amount / 1.2,
            custcol_sb_itemoptionsdisplay: i.options || "",
          };

          // ✅ 60 Night Trial → custcol_sb_30nighttrialoption (List/Record)
          // accepted = 1, declined = 2, n/a = 3
          const trial = String(i.trialOption || "").trim().toLowerCase();
          if (trial === "accepted") {
            line.custcol_sb_30nighttrialoption = { id: "1" };
          } else if (trial === "declined") {
            line.custcol_sb_30nighttrialoption = { id: "2" };
          } else if (trial === "n/a" || trial === "na") {
            line.custcol_sb_30nighttrialoption = { id: "3" };
          }
          // (optional default if blank)
          // else {
          //   line.custcol_sb_30nighttrialoption = { id: "3" };
          // }

          // Fulfilment Method → custcol_sb_fulfilmentlocation
          if (i.fulfilmentMethod && !isServiceItem) {
            line.custcol_sb_fulfilmentlocation = { id: i.fulfilmentMethod };
          }

          if (i.taxCode) {
            line.taxCode = { id: String(i.taxCode) };
          }

          /* ======================================================
             createpo logic — ONLY for subsidiary 6
          ====================================================== */
          const fulfilId = String(i.fulfilmentMethod || "").trim();

          if (String(storeNsId) === "6") {
            if (fulfilId === "3") {
              line.createpo = "SpecOrd";
              console.log(`🟦 Line ${idx + 1} createpo = SpecOrd (Special Order)`);
            } else {
              line.createpo = "";
              console.log(`⬜ Line ${idx + 1} createpo = "" (default/warehouse)`);
            }
          } else {
            console.log(`🚫 Subsidiary ${storeNsId} → createpo removed`);
          }

          /* ======================================================
             LOT / META ALLOCATION
          ====================================================== */
          if (i.lotnumber) {
            line.custcol_sb_lotnumber = { id: i.lotnumber };
          } else if (i.inventoryMeta) {
            line.custcol_sb_epos_inventory_meta = i.inventoryMeta;
            line.orderallocationstrategy = null;
          }

          return line;
        }),
      },
    };

    /* ======================================================
       5️⃣ DISTRIBUTION ORDER TYPE (custbody_sb_is_web_order)
    ====================================================== */
    const isDistributionStore = /distribution\s*ltd/i.test(String(storeName || "").trim());
    const distributionOrderTypeId = String(order?.distributionOrderType || "").trim();
    const allowedDistributionTypeIds = new Set(["1", "2", "3"]);

    if (isDistributionStore) {
      const selectedId = allowedDistributionTypeIds.has(distributionOrderTypeId)
        ? distributionOrderTypeId
        : "1"; // default Web Order for Distribution Ltd

      orderBody.custbody_sb_is_web_order = { id: selectedId };
      console.log(
        `🏷 Distribution order type set: custbody_sb_is_web_order = ${selectedId}`
      );
    }

    /* ======================================================
       6️⃣ FINAL PAYLOAD PREVIEW (AFTER ALL MODIFICATIONS)
    ====================================================== */
    console.log("Final Sales Order payload summary:", {
      customerId,
      itemCount: orderBody.item?.items?.length || 0,
      hasDistributionOrderType: !!orderBody.custbody_sb_is_web_order,
    });

    /* ======================================================
       7️⃣ CREATE SALES ORDER IN NETSUITE
    ====================================================== */
    const so = await nsPost("/salesOrder", orderBody, userId, "sb");

    let salesOrderId = so.id || null;
    if (!salesOrderId && so._location) {
      const match = so._location.match(/salesorder\/(\d+)/i);
      if (match) salesOrderId = match[1];
    }

    if (!salesOrderId)
      return res.status(500).json({
        ok: false,
        error: "Failed to resolve Sales Order ID",
      });

    console.log("✅ Sales Order created successfully with ID:", salesOrderId);
    try {
      await forceSalesOrderPendingApproval(salesOrderId, userId);
    } catch (err) {
      console.error(
        `Sales Order ${salesOrderId} was created but could not be forced to Pending Approval:`,
        err.message
      );
    }

    // ==========================================================
    // 💰 Create Customer Deposit(s) if provided in payload
    //    via NetSuite RESTlet instead of /customerDeposit REST Record
    // ==========================================================
    const allDeposits = Array.isArray(order?.deposits)
      ? order.deposits
      : Array.isArray(req.body?.deposits)
        ? req.body.deposits
        : [];

    if (Array.isArray(allDeposits) && allDeposits.length > 0) {
      console.log(
        `💰 Found ${allDeposits.length} deposit(s) in payload — creating via RESTlet...`
      );
      console.table(
        allDeposits.map((d) => ({
          MethodID: d.id,
          MethodName: d.name,
          Amount: d.amount,
        }))
      );

      // 🔍 Fetch account mapping from store
      let currentAccountId = null;
      let pettyCashAccountId = null;
      try {
        const accResult = await pool.query(
          `SELECT current_account, petty_cash_account 
       FROM locations 
       WHERE id = $1 
       LIMIT 1`,
          [order.store]
        );
        const accRows = accResult.rows;

        if (accRows.length) {
          currentAccountId = accRows[0].current_account || null;
          pettyCashAccountId = accRows[0].petty_cash_account || null;
          console.log("🏦 Store account mapping →", {
            currentAccountId,
            pettyCashAccountId,
          });
        } else {
          console.warn("⚠️ No account mapping found for store:", order.store);
        }
      } catch (accErr) {
        console.error("❌ Failed to load store account mapping:", accErr.message);
      }

      for (const [index, dep] of allDeposits.entries()) {
        try {
          const isCash = /cash/i.test(dep.name || "");
          const selectedAccountId = isCash ? pettyCashAccountId : currentAccountId;

          if (!selectedAccountId) {
            console.warn(
              `⚠️ [Deposit ${index + 1}] No ${isCash ? "petty cash" : "current"} account ID found — skipping account assignment.`
            );
          }

          const restletBody = {
            salesOrderId: String(salesOrderId),
            customerId: String(customerId),
            subsidiaryId: storeNsId ? String(storeNsId) : "",
            payment: parseFloat(dep.amount || 0),
            paymentMethodId: String(dep.id || ""),
            paymentMethodName: dep.name || "",
            accountId: selectedAccountId ? String(selectedAccountId) : "",
            tranDate: new Date().toISOString().split("T")[0],
            memo: dep.name || "",
            undepfunds: false,
            debug: true,
          };

          console.log(`🧾 [Deposit ${index + 1}] Creating Customer Deposit via RESTlet:`);
          console.dir(restletBody, { depth: null });

          const restletUrl = process.env.NS_CUSTOMER_DEPOSIT_RESTLET_URL;
          if (!restletUrl) {
            throw new Error("Missing NS_CUSTOMER_DEPOSIT_RESTLET_URL in environment.");
          }

          const authHeader = await getAuthHeader(restletUrl, "POST", userId, "sb");
          const depositResRaw = await fetch(restletUrl, {
            method: "POST",
            headers: {
              ...authHeader,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(restletBody),
          });

          const depositResText = await depositResRaw.text();

          let depositRes;
          try {
            depositRes = depositResText ? JSON.parse(depositResText) : {};
          } catch {
            throw new Error(
              `RESTlet returned non-JSON response (${depositResRaw.status}): ${depositResText}`
            );
          }

          if (!depositResRaw.ok || depositRes?.success === false) {
            throw new Error(
              depositRes?.error?.message ||
              depositRes?.message ||
              `RESTlet call failed with HTTP ${depositResRaw.status}`
            );
          }

          const depositId = depositRes?.depositId || null;
          const requestedMethodId = depositRes?.requested?.paymentMethodId || "";
          const requestedMethodName = depositRes?.requested?.paymentMethodName || "";
          const savedMethodId = depositRes?.saved?.paymentMethodId || "";
          const savedMethodText = depositRes?.saved?.paymentMethodText || "";
          const matched = depositRes?.matched === true;

          if (depositId) {
            console.log(`✅ Deposit ${index + 1} created successfully → ID ${depositId}`);
          } else {
            console.warn(`⚠️ Deposit ${index + 1} created but no depositId returned.`);
          }

          console.log(`💳 [Deposit ${index + 1}] Payment Method Check →`, {
            requestedMethodId,
            requestedMethodName,
            savedMethodId,
            savedMethodText,
            matched,
          });

          if (!matched) {
            console.warn(
              `⚠️ [Deposit ${index + 1}] Requested payment method "${requestedMethodName}" (${requestedMethodId}) but NetSuite saved "${savedMethodText}" (${savedMethodId}).`
            );
          }
        } catch (err) {
          console.error(`❌ Failed to create Customer Deposit ${index + 1}:`, err.message);
        }
      }
    } else {
      console.log("ℹ️ No customer deposits found in request — skipping deposit creation.");
    }

    // ==========================================================
    //  🔁 Create Transfer Orders for cross-location lines
    // ==========================================================
    const createdTransfers = [];
    try {
      const salesOrderTranId = so.tranId || so.tranid || so.id || "";

      // 🔍 Fetch full store record to get distribution location
      let storeDistributionLocId = null;
      try {
        const storeRes = await pool.query(
          `SELECT 
             netsuite_internal_id, 
             invoice_location_id, 
             distribution_location_id 
           FROM locations 
           WHERE id = $1 
           LIMIT 1`,
          [order.store]
        );

        if (storeRes.rows.length) {
          const row = storeRes.rows[0];

          const dist = (row.distribution_location_id || "").toString().trim();
          const inv = (row.invoice_location_id || "").toString().trim();
          const main = (row.netsuite_internal_id || "").toString().trim();

          storeDistributionLocId =
            dist !== "" ? dist : inv !== "" ? inv : main !== "" ? main : null;

          console.log("🏬 Store location mapping →", {
            storeNsId: main,
            invoiceLocationId: inv,
            distributionLocationId: dist,
            usedTransferDest: storeDistributionLocId,
          });
        } else {
          console.warn("⚠️ No store record found for store ID:", order.store);
        }
      } catch (err) {
        console.error("❌ Failed to load store distribution location:", err.message);
      }

      for (const [idx, line] of items.entries()) {
        const fulfilMethod = String(line.fulfilmentMethod || "").trim();
        console.log(`📦 Line ${idx + 1} fulfilMethod =`, fulfilMethod);

        let skipTransfer = false;

        if (line.lotnumber && !line.inventoryMeta) {
          console.log(`🔍 Resolving LOT source for LOT ${line.lotnumber}`);

          try {
            const lotTable = await pool.query(
              `SELECT to_regclass('public.epos_lots') AS table_name`
            );

            if (!lotTable.rows[0]?.table_name) {
              console.warn("⚠️ epos_lots table missing; cannot resolve lot-only transfer source");
              skipTransfer = true;
            } else {
              const lotRes = await pool.query(
                `SELECT location_name, location_id, distribution_location_id
                 FROM epos_lots
                 WHERE lot_id = $1
                 LIMIT 1`,
                [line.lotnumber]
              );

              if (lotRes.rows.length) {
                const row = lotRes.rows[0];
                const srcName = row.location_name || "";
                const srcInv = row.location_id || "";
                const srcDist = row.distribution_location_id || srcInv;

                console.log(`📦 LOT ${line.lotnumber} → ${srcName} (dist ${srcDist})`);
                line.inventoryMeta = `1|${srcName}|${srcInv}|||LOT|${line.lotnumber}`;
              } else {
                console.warn(`⚠️ No LOT source found → cannot create transfer`);
                skipTransfer = true;
              }
            }
          } catch (err) {
            console.error("❌ LOT lookup failed:", err.message);
            skipTransfer = true;
          }
        }

        if (!line.inventoryMeta) {
          console.log(`⛔ [Line ${idx + 1}] No metadata → skip transfer`);
          skipTransfer = true;
        }

        const metaParts = (line.inventoryMeta || "")
          .split(";")
          .map((p) => p.trim())
          .filter(Boolean);

        if (metaParts.length === 0) {
          console.log(`⛔ [Line ${idx + 1}] No valid meta parts → skip transfer`);
          skipTransfer = true;
        }

        if (fulfilMethod === "1") {
          console.log(`🛒 In-Store fulfilment for line ${idx + 1}`);
          try {
            const [qty, locName] = metaParts[0].split("|");
            const metaLoc = (locName || "").trim().toLowerCase();
            const storeLower = String(storeName || "").toLowerCase();

            const alreadyInStore =
              metaLoc === storeLower ||
              metaLoc.includes(storeLower) ||
              storeLower.includes(metaLoc);

            if (alreadyInStore) {
              console.log(`🟢 Already in store → skip transfer`);
              skipTransfer = true;
            }
          } catch { }
        }

        if (fulfilMethod === "2") {
          console.log(`🏭 Warehouse fulfilment for line ${idx + 1}`);
          try {
            const [, , locIdRaw] = metaParts[0].split("|");
            if (String(locIdRaw || "") === String(order.warehouse)) {
              console.log(`🟢 Already in warehouse → skip transfer`);
              skipTransfer = true;
            }
          } catch { }
        }

        if (skipTransfer) {
          console.log(`🚫 [Line ${idx + 1}] Transfer skipped`);
          continue;
        }

        for (const part of metaParts) {
          let sourceLocId = null;

          const [qty, locName, locIdRaw, , statusIdRaw, , invIdRaw] = part.split("|");

          const quantity = parseFloat(qty || 0) || 0;
          const invId = (invIdRaw || "").trim();
          const locId = (locIdRaw || "").trim();
          const statusId = (statusIdRaw || "").trim();
          let transferItemId = String(line.item || "").trim();

          if (!quantity || !invId) {
            console.log(`⚠️ [Line ${idx + 1}] Invalid meta row → skip`);
            continue;
          }

          const invInfo = await getInventoryNumberInfo(invId, userId);
          if (invInfo?.itemId && invInfo.itemId !== transferItemId) {
            console.warn(
              `⚠️ [Line ${idx + 1}] Inventory number ${invId} belongs to item ${invInfo.itemId}, ` +
              `but sales line item is ${transferItemId}; using inventory-number item for transfer`
            );
            transferItemId = invInfo.itemId;
          }

          try {
            if (locId) {
              const q = await pool.query(
                `SELECT distribution_location_id
                 FROM locations
                 WHERE netsuite_internal_id = $1
                    OR distribution_location_id = $1
                    OR invoice_location_id::text = $1
                 LIMIT 1`,
                [locId]
              );
              sourceLocId = (q.rows[0]?.distribution_location_id || "").trim();
            }

            if (!sourceLocId && locName) {
              sourceLocId = await resolveNetSuiteLocationIdByName(locName);
              if (sourceLocId) {
                console.log(
                  `📍 Source location resolved from NetSuite feed: ${locName} → ${sourceLocId}`
                );
              }
            }

            if (!sourceLocId && locId) {
              sourceLocId = locId;
              console.log(
                `📍 Source location using inventory meta location ID: ${locName || "(unknown)"} → ${sourceLocId}`
              );
            }

            if (!sourceLocId && locName) {
              const q2 = await pool.query(
                `SELECT distribution_location_id
                 FROM locations
                 WHERE name ILIKE $1
                 LIMIT 1`,
                [locName]
              );
              sourceLocId = (q2.rows[0]?.distribution_location_id || "").trim();
            }

            if (!sourceLocId && locName) {
              sourceLocId = await resolveNetSuiteLocationIdByName(locName);
              if (sourceLocId) {
                console.log(
                  `📍 Source location resolved from NetSuite feed: ${locName} → ${sourceLocId}`
                );
              }
            }
          } catch (err) {
            console.error("❌ Source lookup failed:", err.message);
          }

          if (!sourceLocId) {
            if (locId) {
              sourceLocId = locId;
              console.log(
                `⚠️ No local source mapping for ${locId}; using inventory meta location ID as source`
              );
            } else {
              console.log(`⚠️ No source location resolved → skip`);
              continue;
            }
          }

          let destinationLocId = "";

          if (fulfilMethod === "1") {
            destinationLocId = storeDistributionLocId;
            console.log(`🏪 STORE fulfilment → dest ${destinationLocId}`);
          } else if (fulfilMethod === "2") {
            try {
              const w = await pool.query(
                `SELECT distribution_location_id
                 FROM locations
                 WHERE netsuite_internal_id = $1
                 LIMIT 1`,
                [order.warehouse]
              );
              destinationLocId = (w.rows[0]?.distribution_location_id || order.warehouse).toString();
            } catch {
              destinationLocId = order.warehouse;
            }
            console.log(`🏭 WAREHOUSE fulfilment → dest ${destinationLocId}`);
          }

          if (!destinationLocId) continue;

          console.log("🔎 Transfer preflight:", {
            line: idx + 1,
            salesLineItem: line.item,
            transferItem: transferItemId,
            inventoryNumberId: invId,
            inventoryNumber: invInfo?.number || "",
            sourceLocation: sourceLocId,
            destinationLocation: destinationLocId,
            inventoryStatusId: statusId,
            quantity,
          });

          const inventoryAssignment = {
            issueInventoryNumber: { id: invId },
            receiptInventoryNumber: invInfo?.number || "",
            quantity: quantity,
            toLocation: { id: destinationLocId },
          };
          if (statusId) {
            inventoryAssignment.inventoryStatus = { id: statusId };
            inventoryAssignment.toInventoryStatus = { id: statusId };
          }

          const transferBody = {
            subsidiary: { id: "6" },
            custbody_sb_needed_by: new Date(Date.now() + 3 * 86400000)
              .toISOString()
              .split("T")[0],
            transferlocation: { id: destinationLocId },
            location: { id: sourceLocId },
            custbody_sb_transfer_order_type: { id: "2" },
            custbody_sb_relatedsalesorder: { id: String(salesOrderId) },
            item: {
              items: [
                {
                  item: { id: transferItemId },
                  location: { id: sourceLocId },
                  quantity: quantity,
                  inventoryDetail: {
                    inventoryAssignment: {
                      items: [inventoryAssignment],
                    },
                  },
                },
              ],
            },
          };

          console.log(`🔁 Creating Transfer Order for line ${idx + 1}:`);
          console.dir(transferBody, { depth: null });

          try {
            const tr = await nsPost("/transferOrder", transferBody, userId, "sb");
            let transferId = tr?.id || null;
            if (!transferId && tr?._location) {
              const m = tr._location.match(/transferorder\/(\d+)/i);
              if (m) transferId = m[1];
            }

            console.log(`✅ Transfer Order created → ${transferId}`);

            createdTransfers.push({
              itemId: line.item,
              transferOrderId: transferId,
              sourceLocation: sourceLocId,
              destinationWarehouse: destinationLocId,
            });
          } catch (err) {
            console.error(`❌ Failed to create TO for line ${idx + 1}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error("⚠️ Transfer Order creation block failed:", err.message);
    }

    return res.json({
      ok: true,
      salesOrderId,
      createdTransfers,
      response: so,
    });
  } catch (err) {
    console.error("❌ Sales Order creation error:", err.message);
    if (err.stack) console.error(err.stack);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* =====================================================
   === GET SALES ORDER RELATED RECORDS ==================
   ===================================================== */
router.get("/:id/related-records", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = await resolveUserIdFromRequest(req);
    const [relatedRecords, customFields] = await Promise.all([
      getSalesOrderRelatedRecords(id, userId),
      loadTransactionCustomFieldValues({
        recordType: "sales_order",
        transactionId: id,
        userId,
        nsPostRaw,
        suiteQlUrl,
      }),
    ]);

    return res.json({
      ok: true,
      salesOrderId: id,
      netSuiteAppBaseUrl: netSuiteAppBaseUrl(),
      relatedRecords,
      customFields,
    });
  } catch (err) {
    console.error("❌ GET /salesorder/:id/related-records error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch related records",
    });
  }
});

/* =====================================================
   === SAVE SALES ORDER CUSTOM FIELDS ===================
   ===================================================== */
router.post("/:id/custom-fields", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = await resolveUserIdFromRequest(req);
    const { fields = [] } = req.body || {};

    const { patch, updated, error } = await buildCustomFieldPatchPayload({
      recordType: "sales_order",
      userId,
      updates: fields,
    });

    if (error) {
      return res.status(400).json({ ok: false, error });
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({
        ok: false,
        error: "No permitted custom fields were supplied.",
      });
    }

    await nsPatch(`/salesOrder/${encodeURIComponent(id)}`, patch, userId, "sb");
    cacheDeleteSalesOrder(id);

    const customFields = await loadTransactionCustomFieldValues({
      recordType: "sales_order",
      transactionId: id,
      userId,
      nsPostRaw,
      suiteQlUrl,
    });

    return res.json({
      ok: true,
      salesOrderId: id,
      updatedFields: updated,
      customFields,
    });
  } catch (err) {
    console.error("❌ POST /salesorder/:id/custom-fields error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to save custom fields",
    });
  }
});

/* =====================================================
   === GET SALES ORDER DEPOSITS ========================
   ===================================================== */
router.get("/:id/deposits", async (req, res) => {
  try {
    sendNoStore(res);
    const { id } = req.params;
    const auth = req.headers.authorization || "";
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const userId = await resolveUserIdFromRequest(req);
    const alternateSalesOrderIds = [];

    try {
      const so = await nsGet(
        `/salesOrder/${encodeURIComponent(id)}?fields=${encodeURIComponent("id,tranId")}`,
        userId,
        "sb"
      );
      alternateSalesOrderIds.push(so?.id, so?.tranId, so?.tranid);
    } catch (err) {
      console.warn(`Could not load SO ${id} identifiers for deposit matching:`, err.message);
    }

    const deposits = await loadSalesOrderDeposits(req, id, {
      bearerToken,
      userId,
      alternateSalesOrderIds,
    });

    return res.json({ ok: true, salesOrderId: id, deposits });
  } catch (err) {
    console.error("❌ GET /salesorder/:id/deposits error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch deposits",
    });
  }
});

/* =====================================================
   === GET SALES ORDER (for read-only view) =============
   ===================================================== */
router.get("/:id", async (req, res) => {
  let key;
  let rejectInflight = null;

  try {
    sendNoStore(res);
    const { id } = req.params;
    console.log(`📦 Fetching Sales Order ${id} from NetSuite...`);

    // Optional: lite mode (still returns lines via suiteql; just reduces base record payload)
    const lite =
      String(req.query.lite || "") === "1" ||
      String(req.query.lite || "") === "true";

    // Optional: allow skipping deposits fetch for faster initial paint
    // Default true to avoid breaking existing UI
    const includeDeposits =
      !(
        String(req.query.deposits || "") === "0" ||
        String(req.query.deposits || "") === "false"
      );

    key = cacheKey(id, { lite, includeDeposits });

    soCache.delete(key);

    // 🔐 Resolve user session for per-user NetSuite token
    const auth = req.headers.authorization || "";
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;

    if (bearerToken) {
      try {
        const session = await getSession(bearerToken);
        userId = session?.id || null;
        console.log("🔐 Authenticated user for SO view:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve user session for SO view:", e.message);
      }
    }

    // ✅ Server-side prewarm (no browser session needed)
    const prewarmKey = req.headers["x-prewarm-key"];
    const prewarmUserId = req.headers["x-prewarm-user-id"];

    const allowPrewarm =
      prewarmKey &&
      process.env.PREWARM_KEY &&
      String(prewarmKey) === String(process.env.PREWARM_KEY) &&
      prewarmUserId;

    if (!bearerToken && allowPrewarm) {
      userId = Number(prewarmUserId) || null;
      console.log("🔥 Prewarm auth accepted. Using userId:", userId);
    }

    // ✅ Load cached maps in parallel
    const [itemMap, fulfilmentMap] = await Promise.all([
      getItemMapCached(),
      getFulfilmentMapCached(),
    ]);

    // ✅ Pull a smaller SO record when lite is enabled
    const soPath = lite
      ? `/salesOrder/${id}?fields=${encodeURIComponent(buildSalesOrderFields())}`
      : `/salesOrder/${id}`;

    const so = await nsGet(soPath, userId, "sb");
    so._netSuiteAppBaseUrl = netSuiteAppBaseUrl();

    try {
      const salesExec = await getSalesOrderSalesExec(so.id || id, userId);
      if (salesExec) {
        so.custbody_sb_bedspecialist = {
          ...(typeof so.custbody_sb_bedspecialist === "object"
            ? so.custbody_sb_bedspecialist
            : {}),
          ...salesExec,
        };
      }
    } catch (err) {
      console.warn("Could not enrich sales order Sales Executive:", err.message);
    }

    if (!lite) {
      try {
        const relatedRecords = await getSalesOrderRelatedRecords(id, userId);
        Object.assign(so, relatedRecords);
      } catch (err) {
        console.warn("⚠️ Could not enrich sales order related records:", err.message);
      }
    }

    // 🔎 Fetch *minimal* entity/customer record
    let entityFull = null;
    if (so.entity?.id) {
      try {
        const custPath = `/customer/${so.entity.id}?fields=${encodeURIComponent(
          buildCustomerFields()
        )}`;
        entityFull = await nsGet(custPath, userId, "sb");
        console.log("✅ Entity fetched for SO:", {
          id: entityFull.id,
          title:
            entityFull.custentity_title?.refName ||
            entityFull.custentity_title?.text,
        });
      } catch (err) {
        console.warn("⚠️ Could not fetch full entity:", err.message);
      }
    }
    if (entityFull) so.entityFull = entityFull;

    /* -----------------------------------------------------
       3️⃣ Expand Item Lines via SuiteQL
    ----------------------------------------------------- */
    {
      const query = `
        SELECT
          id AS lineid,
          item,
          quantity,
          netamount,
          rate,
          custcol_sb_itemoptionsdisplay AS options,
          custcol_sb_fulfilmentlocation,
          custcol_sb_epos_inventory_meta,
          custcol_sb_lotnumber,
          custcol_sb_30nighttrialoption
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

      if (suiteql && Array.isArray(suiteql.items)) {
        const items = suiteql.items.map((r) => {
          const itemId = String(r.item);
          const lineId = String(r.lineid || "");
          const info = itemMap[itemId] || {};
          const itemName = info.name || `Item ${itemId}`;

          // ✅ Keep display quantity positive
          const qty = Math.abs(Number(r.quantity) || 0);

          const rawNet = Number(r.netamount) || 0;
          const rawRate = Number(r.rate) || 0;

          // ✅ Financial sign comes from the transaction values, not qty
          let net = rawNet;
          if (rawRate < 0 && rawNet > 0) {
            net = -rawNet;
          }

          const sign = net < 0 || rawRate < 0 ? -1 : 1;

          // amount is the full displayed retail gross line total, signed.
          const retailNet = parseFloat(info.baseprice || 0);
          const retailGross = +(retailNet * 1.2).toFixed(2);
          const amount = +(retailGross * qty * sign).toFixed(2);

          const vat = +(net * 0.2).toFixed(2);
          const saleprice = +(net + vat).toFixed(2);

          const fulfilId =
            r.fulfilmentlocation ||
            r.custcol_sb_fulfilmentlocation ||
            r.CUSTCOL_SB_FULFILMENTLOCATION ||
            "";

          const inventoryMeta =
            r.custcol_sb_epos_inventory_meta ||
            r.CUSTCOL_SB_EPOS_INVENTORY_META ||
            "";

          const lotNumber =
            r.custcol_sb_lotnumber ||
            r.CUSTCOL_SB_LOTNUMBER ||
            "";

          const trialOptionId =
            r.custcol_sb_30nighttrialoption ||
            r.CUSTCOL_SB_30NIGHTTRIALOPTION ||
            "";

          let trialOption = { id: null, refName: "" };
          if (String(trialOptionId) === "1") {
            trialOption = { id: "1", refName: "Accepted" };
          } else if (String(trialOptionId) === "2") {
            trialOption = { id: "2", refName: "Declined" };
          } else if (String(trialOptionId) === "3") {
            trialOption = { id: "3", refName: "N/A" };
          }

          let inventoryDetail = "";

          if (inventoryMeta) {
            inventoryDetail = String(inventoryMeta).trim();
          } else if (lotNumber) {
            const warehouseId =
              so?.custbody_sb_warehouse?.id ||
              so?.location?.id ||
              "";

            const warehouseName =
              so?.custbody_sb_warehouse?.refName ||
              so?.custbody_sb_warehouse?.name ||
              so?.location?.refName ||
              "";

            inventoryDetail = `${qty || 1}|${warehouseName}|${warehouseId}|||LOT|${lotNumber}`;
          }

          return {
            lineId,
            item: { id: itemId, refName: itemName, class: info.class || "" },
            itemClass: info.class || "",
            quantity: qty,
            amount,
            vat,
            saleprice,
            discount: 0,
            inventoryDetail,
            custcol_sb_epos_inventory_meta: inventoryMeta || "",
            custcol_sb_lotnumber: lotNumber || "",
            custcol_sb_30nighttrialoption: trialOption,
            custcol_sb_itemoptionsdisplay: r.options || "",
            custcol_sb_fulfilmentlocation: {
              id: fulfilId || null,
              refName: fulfilId
                ? fulfilmentMap[fulfilId] || `ID ${fulfilId}`
                : "",
            },
          };
        });

        so.item = { items };
        console.log(`✅ Loaded ${items.length} item lines`);
      } else {
        so.item = { items: [] };
      }
    }

    /* -----------------------------------------------------
       💰 Fetch Customer Deposits (optional)
    ----------------------------------------------------- */
    let deposits = [];
    if (includeDeposits) {
      deposits = await loadSalesOrderDeposits(req, so.id || id, {
        bearerToken,
        alternateSalesOrderIds: [id, so.tranId, so.tranid],
        userId,
        prewarmHeaders: allowPrewarm
          ? {
              "x-prewarm-key": String(prewarmKey),
              "x-prewarm-user-id": String(prewarmUserId),
            }
          : null,
      });
      console.log(`✅ Found ${deposits.length} deposit(s) for Sales Order ${id}`);
    }

    /* -----------------------------------------------------
       ✅ Respond + cache
    ----------------------------------------------------- */
    console.log("✅ Sales Order fetched successfully:", so.tranId || so.id);

    const payload = {
      ok: true,
      salesOrderId: so.id,
      salesOrder: so,
      deposits,
      _mode: lite ? "LITE" : "FULL",
    };

    return res.json({ ...payload, _cache: "BYPASS" });
  } catch (err) {
    console.error("❌ GET /salesorder/:id error:", err.message);

    try {
      if (typeof rejectInflight === "function") rejectInflight(err);
      if (key) soCache.delete(key);
    } catch {}

    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// === COMMIT SALES ORDER (Approve via RESTlet only) ===
// =====================================================
router.post("/:id/commit", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      lines = [],
      headerUpdates = {},
      deletedLineIds = [],
    } = req.body;

    console.log(`🔁 Approving Sales Order ${id} via NetSuite RESTlet`);
    console.log(
      "Patch payload summary:",
      summarizePatchPayload(lines, headerUpdates, deletedLineIds)
    );

    if (!id || !Array.isArray(lines) || !Array.isArray(deletedLineIds)) {
      return res.status(400).json({
        ok: false,
        error: "Missing Sales Order ID, lines array, or deletedLineIds array.",
      });
    }

    // 🔐 Get session from Authorization header
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
    if (token) {
      try {
        const session = await getSession(token);
        userId = session?.id || null;
        console.log("🔐 Commit request for user:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve session for commit:", e.message);
      }
    }

    // 🔗 RESTlet URL
    const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;

    // ✅ Build OAuth headers using per-user tokens
    const authHeader = await getAuthHeader(restletUrl, "POST", userId, "sb");
    const headers = {
      ...authHeader,
      "Content-Type": "application/json",
    };

    // 🔁 Prevent rapid double-submit
    if (!global._recentCommits) global._recentCommits = {};
    const now = Date.now();
    if (global._recentCommits[id] && now - global._recentCommits[id] < 1000) {
      console.warn(`⚠️ Duplicate commit request ignored for Sales Order ${id}`);
      return res.json({
        ok: false,
        warning: "Duplicate commit ignored (too soon)",
      });
    }
    global._recentCommits[id] = now;

    const normalizedLines = (Array.isArray(lines) ? lines : []).map((line) => {
      const grossAmount = Number(
        line.grossAmount ?? line.amountGrossLine ?? line.amount ?? line.saleGrossLine ?? line.grossSaleprice ?? 0
      );
      const grossSaleprice = Number(
        line.grossSaleprice ?? line.saleGrossLine ?? line.saleprice ?? line.amountGrossLine ?? line.grossAmount ?? 0
      );
      const quantity = Number(line.quantity) || 0;
      const qty = quantity || 1;
      const netAmount = Number.isFinite(grossAmount)
        ? Number((grossAmount / 1.2).toFixed(2))
        : 0;
      const rate = Number.isFinite(netAmount)
        ? Number((netAmount / qty).toFixed(2))
        : 0;

      return {
        ...line,
        lineId: line.lineId || line.lineid || "",
        item: line.item || (line.itemId ? { id: String(line.itemId) } : undefined),
        quantity: qty,
        amount: grossAmount,
        saleprice: grossSaleprice,
        netAmount,
        rate,
        discountPct: Number(line.discountPct ?? line.discount ?? 0),
        inventoryMeta: line.inventoryMeta ?? line.inventoryDetail ?? null,
        grossAmount,
        grossSaleprice,
      };
    });

    const payload = {
      id,
      lines: normalizedLines,
      headerUpdates,
      deletedLineIds,
      commit: true,
    };
    const payloadText = JSON.stringify(payload);
    console.log("Calling NetSuite RESTlet with payload bytes:", payloadText.length);

    const response = await fetch(restletUrl, {
      method: "POST",
      headers,
      body: payloadText,
    });

    const text = await response.text();
    const data = parseMaybeJson(text);

    if (!response.ok || !data.ok) {
      console.error("❌ RESTlet returned error:", text);
      const safeError = publicNetSuiteError(data);
      return res.status(500).json({
        ok: false,
        ...safeError,
      });
    }

    console.log(`✅ Sales Order ${id} approved via RESTlet`);
    cacheDeleteSalesOrder(id);
    const linkedTransferOrdersPromise = approveLinkedTransferOrders(id, userId).catch((err) => {
      console.error("Failed to approve linked Transfer Orders:", err.message);
      return {
        ok: false,
        found: 0,
        approved: [],
        failed: [{ id: null, tranid: null, error: err.message }],
      };
    });

    const comsSalesValuePromise = createComsSalesValueRecord(id, userId).catch((err) => {
      console.error("Failed to create customrecord_sb_coms_sales_value:", err.message);
      return {
        ok: false,
        skipped: false,
        error: err.message || "COMS sales value record was not created.",
      };
    });

    const [linkedTransferOrders, comsSalesValue] = await Promise.all([
      linkedTransferOrdersPromise,
      comsSalesValuePromise,
    ]);
    return res.json({
      ok: true,
      message: data.message || "Sales Order approved",
      restletResult: data,
      warnings: [
        ...(linkedTransferOrders.ok
          ? []
          : [
              `Linked Transfer Order approval failed for ${
                linkedTransferOrders.failed.length || 1
              } order(s).`,
            ]),
        ...(comsSalesValue.ok ? [] : [comsSalesValue.error]),
      ],
      linkedTransferOrders,
      comsSalesValue,
    });
  } catch (err) {
    console.error("❌ Commit Sales Order failed:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unexpected server error",
    });
  }
});

// ==========================================================
// 💰 Add Deposit from Popup (Frontend -> RESTlet -> NetSuite)
// ==========================================================
router.post("/:id/add-deposit", async (req, res) => {
  try {
    const { id } = req.params;
    const dep = req.body;
    console.log(`💰 [Popup] Creating deposit for Sales Order ${id}`, dep);

    if (!dep?.id || !dep?.amount || !dep?.name) {
      return res.status(400).json({ ok: false, error: "Missing deposit fields" });
    }

    // 🔐 Resolve logged-in user → userId for per-user NetSuite tokens
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;

    if (token) {
      try {
        const session = await getSession(token);
        userId = session?.id || null;
        console.log("🔐 Authenticated user for deposit creation:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve session:", e.message);
      }
    }

    // ==========================================================
    // 🔎 Load Sales Order first so RESTlet gets full context
    // ==========================================================
    let so = null;
    try {
      so = await nsGet(`/salesOrder/${id}`, userId, "sb");
    } catch (err) {
      console.warn("⚠️ Could not fetch Sales Order from NetSuite:", err.message);
    }

    // 🔍 Determine store ID
    let storeId = dep.storeId || null;

    if (!storeId && so) {
      storeId = so?.location?.id || so?.custbody_sb_primarystore?.id || null;
      console.log("🏬 Store determined from NetSuite SO:", storeId);
    }

    if (!storeId) {
      console.warn("⚠️ No store ID provided or found; using fallback location 1");
      storeId = 1;
    }

    // ==========================================================
    // 🔎 Fetch account mapping for that store
    // ==========================================================
    let accRows = [];
    try {
      const query = `
        SELECT id, name, netsuite_internal_id, invoice_location_id, current_account, petty_cash_account
        FROM locations
        WHERE id::text = $1::text 
           OR netsuite_internal_id::text = $1::text
           OR invoice_location_id::text = $1::text
        LIMIT 1
      `;
      const result = await pool.query(query, [String(storeId)]);
      accRows = result.rows || [];

      if (
        accRows.length &&
        accRows[0].invoice_location_id?.toString() === String(storeId)
      ) {
        const realStoreNsId = accRows[0].netsuite_internal_id;
        console.log(
          `🔁 Matched invoice location ${storeId}, resolving real store netsuite_internal_id → ${realStoreNsId}`
        );

        const storeRes = await pool.query(
          `
          SELECT id, name, netsuite_internal_id, current_account, petty_cash_account
          FROM locations
          WHERE netsuite_internal_id::text = $1::text
          LIMIT 1
          `,
          [String(realStoreNsId)]
        );

        if (storeRes.rows.length) accRows = storeRes.rows;
      }

      if (accRows.length) console.log("🏪 Store match found:", accRows[0]);
      else console.warn("⚠️ No location match found for storeId:", storeId);
    } catch (dbErr) {
      console.error("❌ Failed to fetch account mapping:", dbErr.message);
    }

    const currentAccountId = accRows?.[0]?.current_account || null;
    const pettyCashAccountId = accRows?.[0]?.petty_cash_account || null;
    const storeNsId = accRows?.[0]?.netsuite_internal_id || null;

    const isCash = /cash/i.test(dep.name || dep.method || "");
    const selectedAccountId = isCash ? pettyCashAccountId : currentAccountId;

    console.log("🏦 Account mapping resolved →", {
      storeId,
      storeNsId,
      currentAccountId,
      pettyCashAccountId,
      selectedAccountId,
      isCash,
    });

    // ==========================================================
    // ✅ Build RESTlet body
    // ==========================================================
    const restletBody = {
      salesOrderId: String(id),
      customerId: String(
        so?.entity?.id ||
        so?.customer?.id ||
        so?.entity ||
        ""
      ),
      subsidiaryId: String(
        so?.subsidiary?.id ||
        storeNsId ||
        ""
      ),
      payment: parseFloat(dep.amount || 0),
      paymentMethodId: String(dep.id || ""),
      paymentMethodName: dep.name || "",
      accountId: selectedAccountId ? String(selectedAccountId) : "",
      tranDate: new Date().toISOString().split("T")[0],
      memo: dep.name || "",
      undepfunds: false,
      debug: true,
    };

    console.log("🧾 [AddDeposit] Creating Customer Deposit via RESTlet:");
    console.dir(restletBody, { depth: null });

    const restletUrl = process.env.NS_CUSTOMER_DEPOSIT_RESTLET_URL;
    if (!restletUrl) {
      throw new Error("Missing NS_CUSTOMER_DEPOSIT_RESTLET_URL in environment.");
    }

    const authHeader = await getAuthHeader(restletUrl, "POST", userId, "sb");
    const restletResRaw = await fetch(restletUrl, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(restletBody),
    });

    const restletText = await restletResRaw.text();

    let restletRes;
    try {
      restletRes = restletText ? JSON.parse(restletText) : {};
    } catch {
      throw new Error(
        `RESTlet returned non-JSON response (${restletResRaw.status}): ${restletText}`
      );
    }

    console.log("💰 RESTlet Deposit response:", restletRes);

    if (!restletResRaw.ok || restletRes?.success === false) {
      throw new Error(
        restletRes?.error?.message ||
        restletRes?.message ||
        `RESTlet call failed with HTTP ${restletResRaw.status}`
      );
    }

    const depositId = restletRes?.depositId || null;
    const requestedMethodId = restletRes?.requested?.paymentMethodId || "";
    const requestedMethodName = restletRes?.requested?.paymentMethodName || "";
    const savedMethodId = restletRes?.saved?.paymentMethodId || "";
    const savedMethodText = restletRes?.saved?.paymentMethodText || "";
    const matched = restletRes?.matched === true;

    console.log("💳 [AddDeposit] Payment Method Check →", {
      requestedMethodId,
      requestedMethodName,
      savedMethodId,
      savedMethodText,
      matched,
    });

    if (!matched) {
      console.warn(
        `⚠️ [AddDeposit] Requested payment method "${requestedMethodName}" (${requestedMethodId}) but NetSuite saved "${savedMethodText}" (${savedMethodId}).`
      );
    }

    if (!depositId) {
      throw new Error("Deposit created but depositId not returned by RESTlet");
    }

    const accountDash = getNetSuiteAccountDash();
    const depositLink = `https://${accountDash}.app.netsuite.com/app/accounting/transactions/custdep.nl?id=${depositId}`;

    return res.json({
      ok: true,
      id: depositId,
      matched,
      requestedPaymentMethodId: requestedMethodId,
      requestedPaymentMethodName: requestedMethodName,
      savedPaymentMethodId: savedMethodId,
      savedPaymentMethodText: savedMethodText,
      link: `<a href="${depositLink}" target="_blank">CD${depositId}</a>`,
    });
  } catch (err) {
    console.error("❌ Add Deposit (Popup) failed:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Deposit creation failed" });
  }
});

// =====================================================
// === SAVE SALES ORDER (Patch via RESTlet, NO approval) ===
// =====================================================
router.post("/:id/save", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      lines = [],
      headerUpdates = {},
      deletedLineIds = [],
    } = req.body;

    console.log(`💾 Saving (patch only) Sales Order ${id} via NetSuite RESTlet`);
    console.log(
      "Patch payload summary:",
      summarizePatchPayload(lines, headerUpdates, deletedLineIds)
    );

    if (!id || !Array.isArray(lines) || !Array.isArray(deletedLineIds)) {
      return res.status(400).json({
        ok: false,
        error: "Missing Sales Order ID, lines array, or deletedLineIds array.",
      });
    }

    // 🔐 Get session from Authorization header
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
    if (token) {
      try {
        const session = await getSession(token);
        userId = session?.id || null;
        console.log("🔐 Save request for user:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve session for save:", e.message);
      }
    }

    // 🔗 RESTlet URL (same one used for commit)
    const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;

    // ✅ Build OAuth headers using per-user tokens
    const authHeader = await getAuthHeader(restletUrl, "POST", userId, "sb");
    const headers = {
      ...authHeader,
      "Content-Type": "application/json",
    };

    // 🔁 Prevent rapid double-submit (separate key from commit)
    if (!global._recentSaves) global._recentSaves = {};
    const now = Date.now();
    if (global._recentSaves[id] && now - global._recentSaves[id] < 800) {
      console.warn(`⚠️ Duplicate save request ignored for Sales Order ${id}`);
      return res.json({
        ok: false,
        warning: "Duplicate save ignored (too soon)",
      });
    }
    global._recentSaves[id] = now;

    const normalizedLines = (Array.isArray(lines) ? lines : []).map((line) => {
      const grossAmount = Number(
        line.grossAmount ?? line.amountGrossLine ?? line.amount ?? line.saleGrossLine ?? line.grossSaleprice ?? 0
      );
      const grossSaleprice = Number(
        line.grossSaleprice ?? line.saleGrossLine ?? line.saleprice ?? line.amountGrossLine ?? line.grossAmount ?? 0
      );
      const quantity = Number(line.quantity) || 0;
      const qty = quantity || 1;
      const netAmount = Number.isFinite(grossAmount)
        ? Number((grossAmount / 1.2).toFixed(2))
        : 0;
      const rate = Number.isFinite(netAmount)
        ? Number((netAmount / qty).toFixed(2))
        : 0;

      return {
        ...line,
        lineId: line.lineId || line.lineid || "",
        item: line.item || (line.itemId ? { id: String(line.itemId) } : undefined),
        quantity: qty,
        amount: grossAmount,
        saleprice: grossSaleprice,
        netAmount,
        rate,
        discountPct: Number(line.discountPct ?? line.discount ?? 0),
        inventoryMeta: line.inventoryMeta ?? line.inventoryDetail ?? null,
        grossAmount,
        grossSaleprice,
      };
    });

    // ✅ IMPORTANT: tell RESTlet NOT to approve
    const payload = {
      id,
      lines: normalizedLines,
      headerUpdates,
      deletedLineIds,
      commit: false,
    };

    const payloadText = JSON.stringify(payload);
    console.log("Calling NetSuite RESTlet (save-only) with payload bytes:", payloadText.length);

    const response = await fetch(restletUrl, {
      method: "POST",
      headers,
      body: payloadText,
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok || !data.ok) {
      console.error("❌ RESTlet returned error (save-only):", text);
      return res.status(500).json({
        ok: false,
        error: data?.error || "NetSuite RESTlet call failed",
        raw: text,
      });
    }

    console.log(`✅ Sales Order ${id} patched via RESTlet (save-only)`);

    // ✅ Invalidate cached SO payload so next view is always fresh
    try {
      cacheDeleteSalesOrder(id);
      console.log("Cleared SO cache after save:", id);
    } catch (e) {
      console.warn("⚠️ Failed to clear SO cache after save:", e.message);
    }

    return res.json({
      ok: true,
      message: data.message || "Sales Order saved (not committed)",
      restletResult: data,
    });
  } catch (err) {
    console.error("❌ Save Sales Order failed:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unexpected server error",
    });
  }
});

module.exports = router;
