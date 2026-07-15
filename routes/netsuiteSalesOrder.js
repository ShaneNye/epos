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
  nsRestlet,
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
const { recordDocumentCreated } = require("./salesOrderExperience");
const {
  getEmailAlertUserIds,
  sendSalesQuoteCreatedEmail,
} = require("../utils/salesQuoteEmailAlerts");
const { createNetSuiteCustomer } = require("../utils/netsuiteCustomerCreate");

// =====================================================
// ✅ In-memory cache for GET /:id sales order payloads
// =====================================================
const SO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SO_CACHE_VERSION = "closed-lines-v1";
const soCache = new Map(); // key -> { expiresAt, data, inFlight }
let workflowProgressTableReady = false;
let workflowProgressTableInit = null;
const LOCATION_FEED_TTL_MS = 10 * 60 * 1000;
const locationFeedCache = { expiresAt: 0, rows: null, inFlight: null };
const inventoryStatusFeedCache = { expiresAt: 0, rows: null, inFlight: null };
const inventoryNumberCache = new Map();
const lineOptionsProgress = new Map();
const SALES_ORDER_PENDING_APPROVAL_STATUS = { id: "A" };
const TRANSFER_ORDER_APPROVED_STATUS = { id: "B" };
const SALES_ORDER_PENDING_APPROVAL_LEGACY_STATUS = "A";
const AI_CASE_SUMMARY_KEY = "ai.cases.summary.enabled";

let appSettingsTableReady = false;

async function ensureAppSettingsTable() {
  if (appSettingsTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  appSettingsTableReady = true;
}

function settingBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

async function isAiCaseSummaryEnabled() {
  await ensureAppSettingsTable();
  const result = await pool.query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AI_CASE_SUMMARY_KEY]);
  return settingBool(result.rows[0]?.value, false);
}

function openAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    model:
      process.env.OPENAI_CASE_SUMMARY_MODEL ||
      process.env.OPENAI_VSA_MODEL ||
      process.env.OPENAI_SUITEPIM_MODEL ||
      "gpt-4.1-mini",
  };
}

function parseJsonText(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function parseAiJsonObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return parseJsonText(cleaned);
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
      else if (typeof content?.text === "string" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function extractOpenAIUsage(payload) {
  const usage = payload?.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}

function normaliseCheckText(value) {
  return String(value || "").trim().toLowerCase();
}

function firstMatchingRule(text, rules) {
  return rules.find((rule) => rule.pattern.test(text)) || null;
}

function findDraftCaseConsistencyIssues(draft = {}) {
  const subject = normaliseCheckText(draft.subject);
  const type = normaliseCheckText(draft.typeName);
  const subType = normaliseCheckText(draft.subTypeName);
  const item = normaliseCheckText(draft.itemName);
  const salesOrderId = normaliseCheckText(draft.salesOrderId);
  const issueText = [subject, type, subType].filter(Boolean).join(" ");
  const selectedText = [type, subType, item].filter(Boolean).join(" ");
  const classificationText = [type, subType].filter(Boolean).join(" ");
  const issues = [];

  const productRules = [
    { label: "mattress", pattern: /\b(mattress|sleep surface|spring|foam|tuft|tufting)\b/ },
    { label: "bed frame/base", pattern: /\b(bed frame|frame|base|ottoman|divan|slat|slats|side rail|rail|rails|drawer|leg)\b/ },
    { label: "headboard", pattern: /\b(headboard)\b/ },
    { label: "pillow/topper", pattern: /\b(pillow|topper|protector)\b/ },
    { label: "furniture", pattern: /\b(sofa|chair|wardrobe|cabinet|table|chest|drawer unit)\b/ },
  ];

  const issueRules = [
    {
      label: "product fault or damage",
      pattern: /\b(cracked|crack|broken|split|damaged|damage|fault|faulty|defect|defective|collapsed|torn|rip|ripped|stain|stained|mark|marked|missing part|rail|slat|leg)\b/,
      expectedClassification: /\b(product|fault|damage|quality|defect|warranty|repair|replacement|manufactur|broken|crack|split|part)\b/,
      mismatch: "Subject describes a product fault or damage, but the selected type/sub-type does not look product, quality, damage or warranty related.",
    },
    {
      label: "comfort or mattress feel",
      pattern: /\b(dipping|dip|sagging|sag|comfort|too firm|too soft|firm|soft|lumpy|lump|roll together|sleep surface)\b/,
      expectedClassification: /\b(comfort|dipping|sag|firm|soft|mattress|quality|fault|warranty)\b/,
      mismatch: "Subject describes a comfort or mattress feel issue, but the selected type/sub-type does not look comfort, mattress or quality related.",
    },
    {
      label: "temperature or height",
      pattern: /\b(too hot|too cold|heat|temperature|height|too high|too low|thick|thin)\b/,
      expectedClassification: /\b(heat|temperature|height|comfort|mattress|quality)\b/,
      mismatch: "Subject describes a temperature or height issue, but the selected type/sub-type does not reflect that.",
    },
    {
      label: "delivery or logistics",
      pattern: /\b(delivery|delivered|driver|late|missing delivery|wrong item|not received|collection|collect|courier|dispatch)\b/,
      expectedClassification: /\b(delivery|logistic|dispatch|collection|wrong item|missing|service)\b/,
      mismatch: "Subject describes a delivery or logistics issue, but the selected type/sub-type does not reflect that.",
    },
    {
      label: "access, assembly or service",
      pattern: /\b(access|assembly|assemble|fitting|installation|install|service|technician|inspection)\b/,
      expectedClassification: /\b(access|assembly|fitting|install|service|inspection|technician)\b/,
      mismatch: "Subject describes an access, assembly or service issue, but the selected type/sub-type does not reflect that.",
    },
    {
      label: "payment, refund or account",
      pattern: /\b(payment|paid|refund|invoice|finance|deposit|balance|discount|price|charged|overcharged)\b/,
      expectedClassification: /\b(payment|refund|invoice|finance|deposit|balance|price|account|customer)\b/,
      mismatch: "Subject describes a payment, refund or account issue, but the selected type/sub-type does not reflect that.",
    },
  ];

  const subjectProduct = firstMatchingRule(subject, productRules);
  const itemProduct = firstMatchingRule(item, productRules);
  const subjectIssue = firstMatchingRule(subject, issueRules);

  if (subjectProduct && item && !itemProduct) {
    issues.push(`Subject appears ${subjectProduct.label}-related, but selected item '${draft.itemName}' does not look like a ${subjectProduct.label}.`);
  }

  if (subjectProduct && itemProduct && subjectProduct.label !== itemProduct.label) {
    issues.push(`Subject appears ${subjectProduct.label}-related, but selected item '${draft.itemName}' looks ${itemProduct.label}-related.`);
  }

  if (subjectProduct && (type || subType) && !new RegExp(subjectProduct.pattern.source, "i").test(selectedText)) {
    const productMentionOptionalIssue = subjectIssue && subjectIssue.expectedClassification.test(classificationText);
    if (!productMentionOptionalIssue) {
      issues.push(`Subject appears ${subjectProduct.label}-related, but selected type/sub-type does not look ${subjectProduct.label}-related.`);
    }
  }

  if (subjectIssue && classificationText && !subjectIssue.expectedClassification.test(classificationText)) {
    issues.push(subjectIssue.mismatch);
  }

  if (salesOrderId && /\bbought elsewhere\b/.test(subType)) {
    issues.push("Sub-type says 'Bought Elsewhere', but this case is being raised from an existing sales order.");
  }

  if (salesOrderId && /\b(customer supplied|own item|not purchased|not bought|third party|bought elsewhere)\b/.test(subType)) {
    issues.push("Sub-type suggests the item was not bought from us, but this case is being raised from an existing sales order.");
  }

  if (subjectIssue && subjectIssue.label !== "payment, refund or account" && (type === "customer" || /\bcustomer issue\b/.test(type))) {
    issues.push(`Subject describes a ${subjectIssue.label} issue, but the selected type is customer-related.`);
  }

  [
    ["subject", "Subject is missing."],
    ["typeName", "Type is missing."],
    ["subTypeName", "Sub-type is missing."],
    ["itemName", "Item is missing."],
  ].forEach(([key, message]) => {
    if (!String(draft[key] || "").trim()) issues.push(message);
  });

  return issues.filter((issue, index, list) => list.indexOf(issue) === index);
}

function setLineOptionsProgress(requestId, stage, error = "") {
  const key = String(requestId || "").trim();
  if (!key) return;
  lineOptionsProgress.set(key, { stage, error, updatedAt: Date.now() });
  setTimeout(() => {
    const current = lineOptionsProgress.get(key);
    if (current && Date.now() - current.updatedAt >= 60_000) lineOptionsProgress.delete(key);
  }, 61_000);
}

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

function restletPairedMemoSyncResult(data) {
  return data?.pairedMemoSync || {
    ok: false,
    skipped: true,
    reason: "restlet-did-not-return-paired-memo-sync",
  };
}

async function ensurePairedSalesOrderMemoSync(salesOrderId, headerUpdates = {}, userId, restletData = {}) {
  const restletResult = restletPairedMemoSyncResult(restletData);
  if (
    restletResult.ok &&
    restletResult.reason !== "restlet-did-not-return-paired-memo-sync"
  ) {
    return restletResult;
  }

  try {
    const fallbackResult = await syncPairedSalesOrderMemo(salesOrderId, headerUpdates, userId);
    return {
      ...fallbackResult,
      fallback: true,
      restletResult,
    };
  } catch (err) {
    console.error("Failed to sync paired Sales Order memo:", err.message || err);
    return {
      ok: false,
      skipped: false,
      fallback: true,
      restletResult,
      error: err.message || String(err),
    };
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

function isVatFreeTaxCode(value) {
  const raw =
    value && typeof value === "object"
      ? value.id || value.value || value.refName || ""
      : value;
  const code = String(raw || "").trim().toLowerCase();
  return code === "10" || code.includes("vat free") || code.includes("zero");
}

function isDistributionStoreName(value) {
  return /distribution\s*ltd/i.test(String(value || "").trim());
}

function addLocationId(target, value) {
  const id = String(value || "").trim();
  if (id) target.add(id);
}

function locationNamesMatch(a, b) {
  const left = normalizeLocationLookupName(a);
  const right = normalizeLocationLookupName(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;

  const broadLeft = normalizeBroadLocationLookupName(a);
  const broadRight = normalizeBroadLocationLookupName(b);
  return (
    !!broadLeft &&
    !!broadRight &&
    (broadLeft === broadRight ||
      broadLeft.includes(broadRight) ||
      broadRight.includes(broadLeft))
  );
}

async function resolveStoreLocationContext(order = {}, storeName = "") {
  const ids = new Set();
  let name = String(storeName || "").trim();
  let transferLocationId = null;

  addLocationId(ids, order.store);

  try {
    const storeRes = await pool.query(
      `SELECT
         name,
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
      const dist = String(row.distribution_location_id || "").trim();
      const inv = String(row.invoice_location_id || "").trim();
      const main = String(row.netsuite_internal_id || "").trim();

      name = name || String(row.name || "").trim();
      [dist, inv, main].forEach((id) => addLocationId(ids, id));
      transferLocationId = dist || inv || main || null;
    } else {
      console.warn("No store record found for store ID:", order.store);
    }
  } catch (err) {
    console.error("Failed to load store location context:", err.message);
  }

  return {
    name,
    transferLocationId,
    ids,
  };
}

function inventoryDetailIsAtStore(part, storeContext) {
  const detail = parseInventoryDetailPart(part);
  const locId = String(detail.locationId || "").trim();
  const locName = String(detail.locationName || "").trim();

  if (locId && storeContext?.ids?.has(locId)) return true;
  return locationNamesMatch(locName, storeContext?.name);
}

async function lookupStoreNameByAppId(storeId) {
  const id = String(storeId || "").trim();
  if (!id) return "";

  try {
    const result = await pool.query("SELECT name FROM locations WHERE id = $1", [id]);
    return result.rows[0]?.name || "";
  } catch (err) {
    console.warn("⚠️ Failed to lookup store name:", err.message);
    return "";
  }
}

async function resolvePatchStoreName(salesOrderId, headerUpdates, userId) {
  const suppliedName = String(headerUpdates?.storeName || "").trim();
  if (suppliedName) return suppliedName;

  const appStoreName = await lookupStoreNameByAppId(headerUpdates?.store);
  if (appStoreName) return appStoreName;

  try {
    const fields = "custbody_sb_primarystore,subsidiary,location";
    const so = await nsGet(
      `/salesOrder/${encodeURIComponent(salesOrderId)}?fields=${encodeURIComponent(fields)}`,
      userId,
      "sb"
    );
    return (
      so?.custbody_sb_primarystore?.refName ||
      so?.custbody_sb_primarystore?.name ||
      so?.subsidiary?.refName ||
      so?.subsidiary?.name ||
      so?.location?.refName ||
      so?.location?.name ||
      ""
    );
  } catch (err) {
    console.warn("⚠️ Failed to resolve existing SO store name:", err.message);
    return "";
  }
}

function applyDistributionLineLocation(line, warehouseId, storeName) {
  const id = String(warehouseId || "").trim();
  if (!id || !isDistributionStoreName(storeName)) return line;
  line.location = { id };
  return line;
}

function normalizeLotNumberId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = raw.includes("|") ? raw.split("|").pop().trim() : raw;
  return /^\d+$/.test(candidate) ? candidate : "";
}

function lotNumberIdFromInventoryDetail(value) {
  const firstPart = String(value || "").split(";")[0] || "";
  return normalizeLotNumberId(firstPart);
}

function parseInventoryDetailPart(part) {
  const tokens = String(part || "").trim().split("|");
  return {
    qty: tokens[0] || "",
    locationName: tokens[1] || "",
    locationId: tokens[2] || "",
    statusName: tokens[3] || "",
    statusId: tokens[4] || "",
    inventoryNumberName: tokens.length > 7 ? tokens.slice(5, -1).join("|") : tokens[5] || "",
    inventoryNumberId: tokens.length > 6 ? tokens[tokens.length - 1] || "" : tokens[6] || "",
  };
}

function normalizeInventoryDetailString(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .split(";")
    .map((part) => {
      const detail = parseInventoryDetailPart(part);
      return [
        detail.qty,
        detail.locationName,
        detail.locationId,
        detail.statusName,
        detail.statusId,
        String(detail.inventoryNumberName || "").replace(/\|/g, " - ").trim(),
        detail.inventoryNumberId,
      ].join("|");
    })
    .join(";");
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

async function loadInventoryStatusFeedRows() {
  if (inventoryStatusFeedCache.rows && inventoryStatusFeedCache.expiresAt > Date.now()) {
    return inventoryStatusFeedCache.rows;
  }

  if (inventoryStatusFeedCache.inFlight) return inventoryStatusFeedCache.inFlight;

  inventoryStatusFeedCache.inFlight = (async () => {
    const baseUrl = process.env.SALES_ORDER_INV_STATUS_URL;
    const token = process.env.SALES_ORDER_INV_STATUS;
    if (!baseUrl || !token) return [];

    const separator = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Inventory status feed response ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload.results) ? payload.results : Array.isArray(payload) ? payload : [];

    inventoryStatusFeedCache.rows = rows;
    inventoryStatusFeedCache.expiresAt = Date.now() + LOCATION_FEED_TTL_MS;
    inventoryStatusFeedCache.inFlight = null;
    return rows;
  })();

  try {
    return await inventoryStatusFeedCache.inFlight;
  } catch (err) {
    inventoryStatusFeedCache.inFlight = null;
    console.warn("⚠️ Failed to load NetSuite inventory status feed:", err.message);
    return [];
  }
}

async function buildLocationNameById() {
  const rows = await loadLocationFeedRows();
  const entries = rows
    .map((row) => [
      String(row["Internal ID"] || row.id || row.internalid || "").trim(),
      String(row.Name || row.name || row.Location || row.location || "").trim(),
    ])
    .filter(([id, name]) => id && name);

  try {
    const dbRows = await pool.query(
      `SELECT name, distribution_location_id, netsuite_internal_id, invoice_location_id
       FROM locations`
    );
    dbRows.rows.forEach((row) => {
      [
        row.distribution_location_id,
        row.netsuite_internal_id,
        row.invoice_location_id,
      ].forEach((id) => {
        const value = String(id || "").trim();
        const name = String(row.name || "").trim();
        if (value && name) entries.push([value, name]);
      });
    });
  } catch (err) {
    console.warn("⚠️ Failed to load app location names:", err.message);
  }

  return Object.fromEntries(entries);
}

async function buildInventoryStatusNameById() {
  const rows = await loadInventoryStatusFeedRows();
  return Object.fromEntries(
    rows
      .map((row) => [
        String(row["Internal ID"] || row.id || row.internalid || "").trim(),
        String(row.Name || row.name || row.status || "").trim(),
      ])
      .filter(([id, name]) => id && name)
  );
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

function normalizeLotDetailsString(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .split(";")
    .map((part) =>
      String(part || "")
        .split("|")
        .slice(0, 3)
        .map((token) => String(token || "").trim())
        .join("|")
    )
    .filter((part) => part.replace(/\|/g, "").trim())
    .join(";");
}

function lotDetailsFromInventoryDetail(value) {
  return String(value || "")
    .split(";")
    .map((part) => {
      const detail = parseInventoryDetailPart(part);
      return [
        detail.locationId,
        detail.statusId,
        detail.inventoryNumberId,
      ]
        .map((token) => String(token || "").trim())
        .join("|");
    })
    .filter((part) => part.replace(/\|/g, "").trim())
    .join(";");
}

function fillMissingLotDetailLocations(lotDetails, inventoryDetail) {
  const normalized = normalizeLotDetailsString(lotDetails);
  if (!normalized) return lotDetailsFromInventoryDetail(inventoryDetail);

  const inventoryParts = String(inventoryDetail || "")
    .split(";")
    .map((part) => parseInventoryDetailPart(part));

  return normalized
    .split(";")
    .map((part, index) => {
      const tokens = String(part || "").split("|");
      const locationId = String(tokens[0] || inventoryParts[index]?.locationId || "").trim();
      const statusId = String(tokens[1] || inventoryParts[index]?.statusId || "").trim();
      const inventoryNumberId = String(tokens[2] || inventoryParts[index]?.inventoryNumberId || "").trim();
      return [locationId, statusId, inventoryNumberId].join("|");
    })
    .filter((part) => part.replace(/\|/g, "").trim())
    .join(";");
}

async function displayLotDetailsFromIds(
  lotDetails,
  { locationNameById = {}, statusNameById = {}, inventoryNumberNameById = {}, userId } = {}
) {
  const normalized = normalizeLotDetailsString(lotDetails);
  if (!normalized) return "";

  const displayParts = await Promise.all(
    normalized.split(";").map(async (part) => {
      const [locationId, statusId, inventoryNumberId] = String(part || "").split("|");
      const resolvedInventoryNumber =
        inventoryNumberNameById[String(inventoryNumberId || "").trim()] || "";
      const lotInfo = resolvedInventoryNumber
        ? null
        : await getInventoryNumberInfo(inventoryNumberId, userId).catch(() => null);
      return [
        locationNameById[String(locationId || "").trim()] || locationId,
        statusNameById[String(statusId || "").trim()] || statusId,
        resolvedInventoryNumber || lotInfo?.number || inventoryNumberId,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("|");
    })
  );

  return displayParts.filter(Boolean).join("; ");
}

function numericIds(values) {
  return [
    ...new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter((value) => /^\d+$/.test(value))
    ),
  ];
}

async function suiteQlIdNameMap({ table, ids, nameExpression, userId }) {
  const safeIds = numericIds(ids);
  if (!safeIds.length) return {};

  try {
    const query = `
      SELECT id, ${nameExpression} AS name
      FROM ${table}
      WHERE id IN (${safeIds.join(",")})
    `;
    const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
    return Object.fromEntries(
      (result?.items || [])
        .map((row) => [
          String(row.id || row.ID || "").trim(),
          String(row.name || row.NAME || "").trim(),
        ])
        .filter(([id, name]) => id && name)
    );
  } catch (err) {
    console.warn(`⚠️ Failed to resolve ${table} names from SuiteQL:`, err.message);
    return {};
  }
}

function lotDetailIdSets(lotDetailsValues) {
  const locationIds = [];
  const statusIds = [];
  const inventoryNumberIds = [];

  (lotDetailsValues || []).forEach((value) => {
    normalizeLotDetailsString(value)
      .split(";")
      .filter(Boolean)
      .forEach((part) => {
        const [locationId, statusId, inventoryNumberId] = String(part || "").split("|");
        locationIds.push(locationId);
        statusIds.push(statusId);
        inventoryNumberIds.push(inventoryNumberId);
      });
  });

  return {
    locationIds: numericIds(locationIds),
    statusIds: numericIds(statusIds),
    inventoryNumberIds: numericIds(inventoryNumberIds),
  };
}

function isUnknownSuiteQlIdentifierError(err, identifier) {
  const wanted = String(identifier || "").trim().toLowerCase();
  if (!wanted) return false;

  const details = Array.isArray(err?.responseBody?.["o:errorDetails"])
    ? err.responseBody["o:errorDetails"]
    : [];
  return details.some((detail) => {
    const message = String(detail?.detail || "").toLowerCase();
    return message.includes("unknown identifier") && message.includes(wanted);
  });
}

function buildSalesOrderLineSuiteQl(id, { includeLotDetails = true } = {}) {
  const lotDetailsSelect = includeLotDetails
    ? "custcol_sb_lot_details,"
    : "NULL AS custcol_sb_lot_details,";

  return `
    SELECT
      id AS lineid,
      item,
      quantity,
      isclosed,
      netamount,
      rate,
      taxcode,
      custcol_sb_itemoptionsdisplay AS options,
      custcol_sb_fulfilmentlocation,
      ${lotDetailsSelect}
      custcol_sb_epos_inventory_meta,
      custcol_sb_lotnumber,
      BUILTIN.DF(custcol_sb_lotnumber) AS lotnumber_name,
      custcol_sb_taken_from_store,
      custcol_sb_30nighttrialoption
    FROM transactionline
    WHERE transaction = ${id}
      AND mainline = 'F'
      AND taxline = 'F'
    ORDER BY linesequencenumber
  `;
}

async function fetchSalesOrderLineSuiteQl(id, userId) {
  const url = suiteQlUrl();
  const query = buildSalesOrderLineSuiteQl(id);

  try {
    return await nsPostRaw(url, { q: query }, userId, "sb");
  } catch (err) {
    if (!isUnknownSuiteQlIdentifierError(err, "custcol_sb_lot_details")) {
      throw err;
    }

    console.warn(
      "⚠️ custcol_sb_lot_details is not available in SuiteQL; loading sales order lines without it."
    );
    return nsPostRaw(
      url,
      { q: buildSalesOrderLineSuiteQl(id, { includeLotDetails: false }) },
      userId,
      "sb"
    );
  }
}

async function getSalesOrderSupportCases(salesOrderId, userId) {
  const numericId = Number(salesOrderId);
  if (!Number.isFinite(numericId) || numericId <= 0) return [];

  const mapRows = (result) => (Array.isArray(result?.items) ? result.items : []).map((row) => ({
    id: String(row.id || row.ID || "").trim(),
    caseNumber: String(row.caseNumber || row.casenumber || row.CASENUMBER || "").trim(),
    title: String(row.title || row.TITLE || "").trim(),
    status: String(row.statusName || row.statusname || row.STATUSNAME || row.status || row.STATUS || "").trim(),
    priority: String(row.priorityName || row.priorityname || row.PRIORITYNAME || row.priority || row.PRIORITY || "").trim(),
    assignedTo: String(row.assignedName || row.assignedname || row.ASSIGNEDNAME || row.assigned || row.ASSIGNED || "").trim(),
    startDate: String(row.startDate || row.startdate || row.STARTDATE || "").trim(),
    createdDate: String(row.createdDate || row.createddate || row.CREATEDDATE || "").trim(),
    lastModifiedDate: String(row.lastModifiedDate || row.lastmodifieddate || row.LASTMODIFIEDDATE || "").trim(),
    type: String(row.supportCaseTypeName || row.supportcasetypename || row.SUPPORTCASETYPENAME || row.custevent_sb_support_case_type || "").trim(),
    subType: String(row.caseSubTypeName || row.casesubtypename || row.CASESUBTYPENAME || row.custevent_sb_casesubtype || "").trim(),
  })).filter((row) => row.id || row.caseNumber || row.title);

  const detailedQuery = `
    SELECT
      id,
      caseNumber,
      title,
      status,
      BUILTIN.DF(status) AS statusName,
      priority,
      BUILTIN.DF(priority) AS priorityName,
      assigned,
      BUILTIN.DF(assigned) AS assignedName,
      startDate,
      createdDate,
      lastModifiedDate,
      custevent_sb_casesubtype,
      BUILTIN.DF(custevent_sb_casesubtype) AS caseSubTypeName,
      custevent_sb_support_case_type,
      BUILTIN.DF(custevent_sb_support_case_type) AS supportCaseTypeName
    FROM supportCase
    WHERE custevent_sb_relatedsalesorder = ${numericId}
    ORDER BY id DESC
  `;

  try {
    return mapRows(await nsPostRaw(suiteQlUrl(), { q: detailedQuery }, userId));
  } catch (err) {
    console.warn("Support case detail query failed; falling back to case number and title only.", err.message);
  }

  const fallbackQuery = `
    SELECT
      id,
      caseNumber,
      title
    FROM supportCase
    WHERE custevent_sb_relatedsalesorder = ${numericId}
    ORDER BY id DESC
  `;

  return mapRows(await nsPostRaw(suiteQlUrl(), { q: fallbackQuery }, userId));
}

async function generateSupportCaseDraftSummary({ draft }) {
  const openai = openAIConfig();
  if (!openai.apiKey) throw new Error("Missing OPENAI_API_KEY");
  const consistencyIssues = findDraftCaseConsistencyIssues(draft);

  const input = [
    "Draft support case currently being raised:",
    JSON.stringify(draft, null, 2),
    "System-detected consistency issues:",
    consistencyIssues.length ? consistencyIssues.map((issue) => `- ${issue}`).join("\n") : "None detected.",
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openai.model,
      instructions: [
        "You summarise the current draft support case for a retail EPOS user before it is created.",
        "Return valid JSON only with keys summary and pleaseCheck.",
        "summary must be a conversational paragraph, not a list.",
        "pleaseCheck must be an array of short strings.",
        "Be concise and factual. Mention the customer, store, subject, status, assignee, incident date, type, sub-type and item when present.",
        "Actively check whether the selected type, sub-type and item are consistent with the subject.",
        "Infer the broad issue category from the subject: product fault/damage, comfort/mattress feel, heat/height, delivery/logistics, access/assembly/service, or payment/account.",
        "Infer the broad product family from the subject and item: mattress, bed frame/base, headboard, pillow/topper, or furniture.",
        "The selected type and sub-type should align with the inferred issue category, and the selected item should align with the inferred product family.",
        "If the draft has a salesOrderId, treat sub-types suggesting the customer bought elsewhere, supplied their own item, used a third party, or did not buy from us as inconsistent unless the draft clearly explains why.",
        "If the subject describes a product fault or damage, customer/admin classifications are usually inconsistent unless the type/sub-type also clearly indicates product, quality, damage, warranty, repair or replacement.",
        "Treat the system-detected consistency issues as important unless the draft clearly disproves them.",
        "If anything looks inconsistent, put each inconsistent datapoint in pleaseCheck.",
        "If important details are missing, include them in pleaseCheck too.",
        "If everything looks consistent and complete, return an empty pleaseCheck array.",
        "Do not invent facts. Use British English.",
      ].join(" "),
      input,
      max_output_tokens: 220,
    }),
  });

  const payload = parseJsonText(await response.text());
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI request failed: ${response.status}`);
  }

  const text = extractOpenAIText(payload);
  if (!text) throw new Error("OpenAI did not return a draft case summary");

  const parsed = parseAiJsonObject(text);
  const summary = String(parsed?.summary || text).trim();
  const modelIssues = Array.isArray(parsed?.pleaseCheck)
    ? parsed.pleaseCheck.map((issue) => String(issue || "").trim()).filter(Boolean)
    : [];
  const pleaseCheck = [...modelIssues, ...consistencyIssues]
    .filter(Boolean)
    .filter((issue, index, list) => list.indexOf(issue) === index);

  return {
    text: summary,
    pleaseCheck,
    model: openai.model,
    usage: extractOpenAIUsage(payload),
  };
}

function cleanDraftValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function refId(value) {
  if (value && typeof value === "object") {
    return cleanDraftValue(value.id || value.internalId || value.value || value.internalid);
  }
  return cleanDraftValue(value);
}

function refName(value) {
  if (value && typeof value === "object") {
    return cleanDraftValue(value.refName || value.name || value.text || value.value || value.displayName);
  }
  return "";
}

function normaliseDateInputValue(value) {
  const text = cleanDraftValue(value);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const gb = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (gb) {
    const [, day, month, year] = gb;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function nsRef(id) {
  const clean = cleanDraftValue(id);
  return clean ? { id: clean } : null;
}

function addRefField(target, fieldId, id) {
  const ref = nsRef(id);
  if (ref) target[fieldId] = ref;
}

function appendQueryParams(url, params = {}) {
  const cleanUrl = cleanDraftValue(url);
  if (!cleanUrl) return "";
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const clean = cleanDraftValue(value);
    if (clean) query.set(key, clean);
  });
  if (!query.toString()) return cleanUrl;
  return `${cleanUrl}${cleanUrl.includes("?") ? "&" : "?"}${query.toString()}`;
}

function supportCaseRestletUrl() {
  return cleanDraftValue(process.env.SUPPORT_CASE_RESTLET_URL || process.env.CASE_RESTLET_URL);
}

function buildSupportCasePayload(draft = {}) {
  const salesOrderId = cleanDraftValue(draft.salesOrderId);
  const subject = cleanDraftValue(draft.subject);
  const customerId = cleanDraftValue(draft.customerId);

  if (!salesOrderId) throw new Error("Sales order ID is required to raise a case");
  if (!subject) throw new Error("Subject is required to raise a case");
  if (!customerId) throw new Error("Customer is required to raise a case");

  const payload = {
    title: subject,
  };

  addRefField(payload, "company", customerId);
  addRefField(payload, "status", draft.statusId);
  addRefField(payload, "assigned", draft.assignedToId);
  addRefField(payload, "category", draft.typeId);
  addRefField(payload, "item", draft.itemId);
  addRefField(payload, "custevent_sb_casesubtype", draft.subTypeId);
  addRefField(payload, "custevent_sb_relatedsalesorder", salesOrderId);

  const incidentDate = cleanDraftValue(draft.incidentDate);
  if (incidentDate) payload.startDate = incidentDate;

  const storeName = cleanDraftValue(draft.storeName);
  if (storeName) payload.custevent_sb_cas_showroom = storeName;

  const caseStoreId =
    cleanDraftValue(draft.storeNetSuiteId) ||
    cleanDraftValue(draft.storeDistributionLocationId);
  if (caseStoreId) addRefField(payload, "custevent1", caseStoreId);

  return payload;
}

async function createSupportCaseFromDraft(draft, userId) {
  const payload = buildSupportCasePayload(draft);
  const created = await nsPost("/supportCase", payload, userId);
  const id = created?.id || "";
  const salesOrderId = cleanDraftValue(draft.salesOrderId);
  let attachResult = { ok: false, skipped: true, reason: "support-case-restlet-not-configured" };

  let caseNumber = "";
  if (id) {
    attachResult = await attachSupportCaseToTransaction(id, salesOrderId, userId).catch((err) => ({
      ok: false,
      error: err.message || "Failed to attach support case to sales order",
      details: err.responseBody || null,
    }));

    try {
      const record = await nsGet(`/supportCase/${encodeURIComponent(id)}?fields=caseNumber,title`, userId);
      caseNumber = cleanDraftValue(record?.caseNumber || record?.casenumber);
    } catch (err) {
      console.warn("Created support case but could not read case number:", err.message);
    }
  }

  return {
    id,
    caseNumber,
    payload,
    attachResult,
    location: created?._location || "",
  };
}

async function updateSupportCaseFromDraft(caseId, draft, userId) {
  const id = cleanDraftValue(caseId);
  if (!/^\d+$/.test(id)) throw new Error("Valid case ID is required");

  const payload = buildSupportCasePayload(draft);
  await nsPatch(`/supportCase/${encodeURIComponent(id)}`, payload, userId);

  let caseNumber = "";
  try {
    const record = await nsGet(`/supportCase/${encodeURIComponent(id)}?fields=caseNumber,title`, userId);
    caseNumber = cleanDraftValue(record?.caseNumber || record?.casenumber);
  } catch (err) {
    console.warn("Updated support case but could not read case number:", err.message);
  }

  return {
    id,
    caseNumber,
    payload,
  };
}

async function attachSupportCaseToTransaction(caseId, transactionId, userId) {
  const url = supportCaseRestletUrl();
  if (!url) return { ok: false, skipped: true, reason: "support-case-restlet-not-configured" };

  const result = await nsRestlet(
    url,
    {
      action: "attachTransaction",
      caseId,
      transactionId,
      salesOrderId: transactionId,
    },
    userId,
    "POST"
  );

  if (result?.ok === false) {
    throw new Error(result.error || "Support case attach RESTlet failed");
  }

  return result || { ok: true };
}

function normaliseSupportCaseRecord(record = {}) {
  const salesOrderRef = record.custevent_sb_relatedsalesorder;
  const customerRef = record.company || record.companyid || record.customer;
  const statusRef = record.status;
  const assignedRef = record.assigned;
  const typeRef = record.category;
  const subTypeRef = record.custevent_sb_casesubtype;
  const itemRef = record.item;
  const storeRef = record.custevent1 || record.custevent_sb_case_store;

  return {
    id: cleanDraftValue(record.id),
    caseNumber: cleanDraftValue(record.caseNumber || record.casenumber || record.eventnumber || record.origCaseNumber),
    subject: cleanDraftValue(record.title),
    salesOrderId: refId(salesOrderRef),
    customerId: refId(customerRef),
    customerName: refName(customerRef) || cleanDraftValue(record.companyName || record.companyname),
    statusId: refId(statusRef),
    statusName: refName(statusRef),
    assignedToId: refId(assignedRef),
    assignedToName: refName(assignedRef),
    incidentDate: normaliseDateInputValue(record.startDate || record.startdate),
    typeId: refId(typeRef),
    typeName: refName(typeRef),
    subTypeId: refId(subTypeRef),
    subTypeName: refName(subTypeRef),
    itemId: refId(itemRef),
    itemName: refName(itemRef),
    storeNetSuiteId: refId(storeRef),
    storeName: cleanDraftValue(record.custevent_sb_cas_showroom),
  };
}

async function getSupportCaseDetail(caseId, userId) {
  const id = cleanDraftValue(caseId);
  if (!/^\d+$/.test(id)) throw new Error("Valid case ID is required");

  const fields = [
    "id",
    "caseNumber",
    "title",
    "company",
    "companyName",
    "status",
    "assigned",
    "startDate",
    "category",
    "custevent_sb_casesubtype",
    "item",
    "custevent1",
    "custevent_sb_cas_showroom",
    "custevent_sb_relatedsalesorder",
  ].join(",");

  const record = await nsGet(`/supportCase/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, userId);
  return normaliseSupportCaseRecord(record);
}

function workflowCheckFieldLabel(fieldId) {
  return ({
    quantity: "Quantity",
    quantitycommitted: "Quantity Committed",
    location: "Where is this being fulfilled from",
    item: "Item",
    rate: "Rate",
    amount: "Amount",
    expectedshipdate: "Expected Ship Date",
    custcol_sb_lot_details: "Lot Details",
  })[fieldId] || fieldId;
}

function workflowCheckRecordLabel(recordType = "") {
  return ({
    returnAuthorization: "Return Authorisation",
    creditMemo: "Credit Memo",
    customerRefund: "Customer Refund",
    customerDeposit: "Customer Deposit",
    salesOrder: "Sales Order",
  })[recordType] || recordType || "Record";
}

function normaliseWorkflowCheckRecordType(value = "") {
  const raw = cleanDraftValue(value);
  return raw.replace(/^record:/i, "");
}

async function resolveWorkflowCheckRecordType(recordType = "") {
  const raw = cleanDraftValue(recordType);
  const recordIdMatch = raw.match(/^record:(\d+)$/i);
  if (!recordIdMatch) return raw;
  const result = await pool.query(
    `SELECT id, label, internal_id FROM cs_workflow_record_types WHERE id = $1 LIMIT 1`,
    [recordIdMatch[1]]
  );
  const record = result.rows[0];
  return cleanDraftValue(record?.internal_id) || raw;
}

function workflowCheckTransactionType(recordType = "") {
  const clean = normaliseWorkflowCheckRecordType(recordType);
  return ({
    returnAuthorization: "RtnAuth",
    returnauthorization: "RtnAuth",
    return_authorization: "RtnAuth",
    returnauthorisation: "RtnAuth",
    return_authorisation: "RtnAuth",
    creditMemo: "CustCred",
    creditmemo: "CustCred",
    customerRefund: "CustRfnd",
    customerrefund: "CustRfnd",
    customerDeposit: "CustDep",
    customerdeposit: "CustDep",
    salesOrder: "SalesOrd",
    salesorder: "SalesOrd",
  })[clean] || "";
}

function workflowCheckRecordPage(recordType = "") {
  const clean = normaliseWorkflowCheckRecordType(recordType);
  return ({
    returnAuthorization: "rtnauth.nl",
    returnauthorization: "rtnauth.nl",
    return_authorization: "rtnauth.nl",
    returnauthorisation: "rtnauth.nl",
    return_authorisation: "rtnauth.nl",
    creditMemo: "custcred.nl",
    creditmemo: "custcred.nl",
    customerRefund: "custrfnd.nl",
    customerrefund: "custrfnd.nl",
    customerDeposit: "custdep.nl",
    customerdeposit: "custdep.nl",
    salesOrder: "salesord.nl",
    salesorder: "salesord.nl",
  })[clean] || "";
}

function normaliseWorkflowCheckRecordCandidate(row = {}, recordType = "") {
  const id = cleanDraftValue(rowValue(row, "id", "ID"));
  const tranId = cleanDraftValue(rowValue(row, "tranid", "TRANID", "number", "NUMBER")) || id;
  const page = workflowCheckRecordPage(recordType);
  return {
    id,
    tranId,
    date: cleanDraftValue(rowValue(row, "trandate", "TRANDATE")),
    status: cleanDraftValue(rowValue(row, "status_display", "STATUS_DISPLAY", "status", "STATUS")),
    total: cleanDraftValue(rowValue(row, "total", "TOTAL", "foreigntotal", "FOREIGNTOTAL")),
    url: page && id ? `${netSuiteAppBaseUrl().replace(/\/$/, "")}/app/accounting/transactions/${page}?id=${encodeURIComponent(id)}` : "",
  };
}

function workflowCheckLineValue(row = {}, fieldId = "") {
  const key = String(fieldId || "").toLowerCase();
  const absoluteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.abs(num) : value;
  };
  const valueMap = {
    quantity: absoluteNumber(row.quantity ?? row.QUANTITY),
    quantitycommitted: absoluteNumber(row.quantitycommitted ?? row.QUANTITYCOMMITTED),
    quantityfulfilled: absoluteNumber(row.quantityfulfilled ?? row.QUANTITYFULFILLED),
    quantitybackordered: absoluteNumber(row.quantitybackordered ?? row.QUANTITYBACKORDERED),
    location: row.fulfilmentlocationname || row.FULFILMENTLOCATIONNAME || row.custcol_sb_fulfilmentlocation || row.CUSTCOL_SB_FULFILMENTLOCATION,
    item: row.itemname || row.ITEMNAME || row.item || row.ITEM,
    rate: row.rate ?? row.RATE,
    amount: row.amount ?? row.AMOUNT ?? row.netamount ?? row.NETAMOUNT,
    expectedshipdate: row.expectedshipdate ?? row.EXPECTEDSHIPDATE,
    custcol_sb_lot_details: row.custcol_sb_lot_details ?? row.CUSTCOL_SB_LOT_DETAILS,
  };
  return valueMap[key] ?? row[fieldId] ?? row[key] ?? "";
}

function workflowCheckLineSourceMappings(rules = []) {
  const fields = new Set();
  (Array.isArray(rules) ? rules : []).forEach((rule) => {
    const field = cleanDraftValue(rule?.field);
    if (field) fields.add(field);
    if (rule?.compareType === "field") {
      const compareField = cleanDraftValue(rule?.compareField);
      if (compareField) fields.add(compareField);
    }
  });
  return Array.from(fields).map((field) => ({
    sourceSublist: "item",
    sourceField: field,
  }));
}

async function getWorkflowCheckSalesOrderEntityId(salesOrderId, userId) {
  const salesOrderNumeric = Number(salesOrderId);
  if (!Number.isFinite(salesOrderNumeric) || salesOrderNumeric <= 0) return "";
  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT entity
        FROM transaction
        WHERE id = ${salesOrderNumeric}
      `,
    },
    userId
  );
  const row = Array.isArray(result?.items) ? result.items[0] || {} : {};
  return cleanDraftValue(row.entity || row.ENTITY);
}

async function getWorkflowCheckRecordCandidates({ recordType, salesOrderId }, userId) {
  const transactionType = workflowCheckTransactionType(recordType);
  const salesOrderEntityId = await getWorkflowCheckSalesOrderEntityId(salesOrderId, userId);
  const customerNumeric = Number(salesOrderEntityId);
  if (!transactionType || !Number.isFinite(customerNumeric) || customerNumeric <= 0) return [];
  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT
          id,
          tranid,
          trandate,
          status,
          BUILTIN.DF(status) AS status_display,
          total,
          foreigntotal
        FROM transaction
        WHERE entity = ${customerNumeric}
          AND type = '${transactionType}'
        ORDER BY trandate DESC, id DESC
      `,
    },
    userId
  );
  return (Array.isArray(result?.items) ? result.items : [])
    .map((row) => normaliseWorkflowCheckRecordCandidate(row, recordType))
    .filter((candidate) => candidate.id);
}

async function loadWorkflowCheckTransactionRecord({ recordType, recordId, fields }, userId) {
  const id = Number(recordId);
  if (!Number.isFinite(id) || id <= 0) throw new Error(`Could not resolve ${workflowCheckRecordLabel(recordType)} record`);
  const safeFields = Array.from(new Set(fields.filter(Boolean))).map(safeSuiteQlIdentifier);
  const selectFields = safeFields.flatMap((field) => [
    field,
    `BUILTIN.DF(${field}) AS ${field}_display`,
  ]);
  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT
          id,
          tranid
          ${selectFields.length ? `,\n          ${selectFields.join(",\n          ")}` : ""}
        FROM transaction
        WHERE id = ${id}
      `,
    },
    userId
  );
  return Array.isArray(result?.items) ? result.items[0] || {} : {};
}

function evaluateWorkflowRecordRules(rules = [], row = {}) {
  return (Array.isArray(rules) ? rules : []).map((rule) => {
    const actual = workflowCriteriaValue(row, rule.field || "");
    const expected = rule.compareType === "field"
      ? workflowCriteriaValue(row, rule.compareField || "")
      : { raw: cleanDraftValue(rule.staticValue), display: cleanDraftValue(rule.staticValueLabel) };
    const passed = compareWorkflowCriteriaValues(actual, rule.operator || "equals", expected);
    return {
      field: rule.field,
      fieldLabel: workflowCheckFieldLabel(rule.field),
      operator: rule.operator || "equals",
      compareType: rule.compareType || "static",
      compareField: rule.compareField || "",
      compareFieldLabel: workflowCheckFieldLabel(rule.compareField),
      staticValue: rule.staticValue || "",
      staticValueLabel: rule.staticValueLabel || "",
      actualValue: actual.display || actual.raw,
      actualRawValue: actual.raw,
      expectedValue: expected.display || expected.raw,
      expectedRawValue: expected.raw,
      passed,
    };
  });
}

function normaliseWorkflowLineQuantities(row = {}) {
  const output = { ...row };
  ["quantity", "quantitycommitted", "quantityfulfilled", "quantitybackordered"].forEach((key) => {
    const upperKey = key.toUpperCase();
    const value = output[key] ?? output[upperKey];
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    output[key] = Math.abs(num);
    if (upperKey in output) output[upperKey] = Math.abs(num);
  });
  return output;
}

function compareWorkflowCheckValues(left, operator, right) {
  const leftText = String(left ?? "").trim();
  const rightText = String(right ?? "").trim();
  const leftNum = Number(leftText);
  const rightNum = Number(rightText);
  const bothNumeric = Number.isFinite(leftNum) && Number.isFinite(rightNum);

  if (operator === "isSet") return leftText !== "";
  if (operator === "isNotSet") return leftText === "";
  if (operator === "notEquals") return bothNumeric ? leftNum !== rightNum : leftText.toLowerCase() !== rightText.toLowerCase();
  if (operator === "greaterThan") return bothNumeric ? leftNum > rightNum : leftText > rightText;
  if (operator === "lessThan") return bothNumeric ? leftNum < rightNum : leftText < rightText;
  return bothNumeric ? leftNum === rightNum : leftText.toLowerCase() === rightText.toLowerCase();
}

async function getPairedIntercompanySalesOrderId(salesOrderId, userId) {
  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT
          custbody_sb_pairedsalesorder,
          BUILTIN.DF(custbody_sb_pairedsalesorder) AS pairedsalesordername
        FROM transaction
        WHERE id = ${salesOrderId}
      `,
    },
    userId
  );
  const row = Array.isArray(result?.items) ? result.items[0] : null;
  const pairedId = Number(row?.custbody_sb_pairedsalesorder ?? row?.CUSTBODY_SB_PAIREDSALESORDER);
  if (!Number.isFinite(pairedId) || pairedId <= 0) {
    throw new Error("Related sales order does not have a paired intercompany sales order");
  }
  return {
    id: pairedId,
    name: String(row?.pairedsalesordername || row?.PAIREDSALESORDERNAME || "").trim(),
  };
}

async function getSalesOrderDocumentInfo(salesOrderId, userId) {
  const id = Number(salesOrderId);
  if (!Number.isFinite(id) || id <= 0) return { id: String(salesOrderId || ""), documentNumber: "", url: "" };
  let documentNumber = "";
  let documentName = "";

  try {
    const record = await nsGet(
      `/salesOrder/${encodeURIComponent(id)}?fields=${encodeURIComponent("tranId")}`,
      userId
    );
    documentNumber = normaliseTransactionDocumentNumber(
      record?.tranId || record?.tranid || record?.tranID || record?.transactionNumber,
      ""
    );
    documentName = cleanDraftValue(record?.tranId || record?.tranid || record?.tranID || documentNumber);
  } catch (err) {
    console.warn("[workflow-actions] Could not read Sales Order document number via REST record:", {
      salesOrderId: id,
      error: err.message || String(err),
    });
  }

  if (!documentNumber || documentNumber === String(id)) {
    const result = await nsPostRaw(
      suiteQlUrl(),
      {
        q: `
          SELECT
            id,
            tranid,
            BUILTIN.DF(id) AS documentname
          FROM transaction
          WHERE id = ${id}
        `,
      },
      userId
    );
    const row = Array.isArray(result?.items) ? result.items[0] : null;
    documentNumber = normaliseTransactionDocumentNumber(
      rowValue(row, "tranid", "tran_id", "documentnumber", "documentname", "name"),
      id
    );
    documentName = cleanDraftValue(rowValue(row, "documentname", "name") || documentNumber);
  }

  return {
    id: String(id),
    documentNumber,
    name: documentName || documentNumber,
    url: salesOrderNetSuiteUrl(id),
  };
}

const BASE_WORKFLOW_LINE_FIELD_ALIASES = new Set([
  "lineid",
  "item",
  "itemname",
  "quantity",
  "quantitycommitted",
  "quantityfulfilled",
  "quantitybackordered",
  "rate",
  "taxcode",
  "taxcodedisplay",
  "taxcode_display",
  "amount",
  "expectedshipdate",
  "createpo",
  "createponame",
  "custcol_sb_fulfilmentlocation",
  "fulfilmentlocationname",
  "custcol_sb_lot_details",
  "custcol_sb_taken_from_store",
  "takenfromstorename",
  "linesequencenumber",
]);

function workflowLineSourceFieldsFromMappings(mappings = []) {
  return Array.from(new Set((Array.isArray(mappings) ? mappings : [])
    .filter((mapping) => cleanDraftValue(mapping.sourceSublist))
    .map((mapping) => cleanDraftValue(mapping.sourceField))
    .filter((field) => {
      const clean = field.toLowerCase();
      return field && safeSuiteQlIdentifier(field) && !BASE_WORKFLOW_LINE_FIELD_ALIASES.has(clean) && !["id", "lineid"].includes(clean);
    })));
}

function buildAffectedItemWorkflowLineSuiteQl(salesOrderId, itemId, { includeLotDetails = true, includeCreatePo = false, sourceFields = [] } = {}) {
  const lotDetailsSelect = includeLotDetails
    ? "tl.custcol_sb_lot_details,"
    : "NULL AS custcol_sb_lot_details,";
  const createPoSelect = includeCreatePo
    ? "tl.createdpo AS createpo, BUILTIN.DF(tl.createdpo) AS createponame,"
    : "NULL AS createpo, NULL AS createponame,";
  const extraSourceSelect = workflowLineSourceFieldsFromMappings(sourceFields).map((field) => `
      tl.${field} AS ${field},`).join("");

  return `
    SELECT
      tl.id AS lineid,
      tl.item,
      BUILTIN.DF(tl.item) AS itemname,
      tl.quantity,
      tl.quantitycommitted,
      tl.quantityshiprecv AS quantityfulfilled,
      tl.quantitybackordered,
      tl.rate,
      tl.taxcode,
      BUILTIN.DF(tl.taxcode) AS taxcodedisplay,
      BUILTIN.DF(tl.taxcode) AS taxcode_display,
      tl.netamount AS amount,
      tl.expectedshipdate,
      ${createPoSelect}
      tl.custcol_sb_fulfilmentlocation,
      BUILTIN.DF(tl.custcol_sb_fulfilmentlocation) AS fulfilmentlocationname,
      ${lotDetailsSelect}
      tl.custcol_sb_taken_from_store,
      BUILTIN.DF(tl.custcol_sb_taken_from_store) AS takenfromstorename,
      ${extraSourceSelect}
      tl.linesequencenumber
    FROM transactionline tl
    WHERE tl.transaction = ${salesOrderId}
      AND tl.item = ${itemId}
      AND tl.mainline = 'F'
      AND tl.taxline = 'F'
    ORDER BY tl.linesequencenumber
  `;
}

async function fetchWorkflowLineSuiteQl({ salesOrderId, itemId, sourceMappings = [], includeLotDetails = true, userId }) {
  try {
    return await nsPostRaw(
      suiteQlUrl(),
      { q: buildAffectedItemWorkflowLineSuiteQl(salesOrderId, itemId, { includeLotDetails, sourceFields: sourceMappings }) },
      userId
    );
  } catch (err) {
    const hasDynamicFields = workflowLineSourceFieldsFromMappings(sourceMappings).length > 0;
    if (!hasDynamicFields) throw err;
    console.warn("[workflow-item-line-action] Dynamic source line field SuiteQL failed; retrying without dynamic fields.", err.message);
    return nsPostRaw(
      suiteQlUrl(),
      { q: buildAffectedItemWorkflowLineSuiteQl(salesOrderId, itemId, { includeLotDetails, sourceFields: [] }) },
      userId
    );
  }
}

async function loadAffectedItemSalesOrderLineForCase(caseId, userId, source = "storeSalesOrder", sourceMappings = []) {
  const supportCase = await getSupportCaseDetail(caseId, userId);
  const salesOrderId = Number(supportCase.salesOrderId);
  const itemId = Number(supportCase.itemId);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    throw new Error("Case does not have a related sales order");
  }
  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new Error("Case does not have an affected item");
  }

  const sourceKey = source === "intercompanySalesOrder" ? "intercompanySalesOrder" : "storeSalesOrder";
  const targetOrder = sourceKey === "intercompanySalesOrder"
    ? await getPairedIntercompanySalesOrderId(salesOrderId, userId)
    : { id: salesOrderId, name: "" };
  const targetDocument = await getSalesOrderDocumentInfo(targetOrder.id, userId);

  let result;
  try {
    result = await fetchWorkflowLineSuiteQl({ salesOrderId: targetOrder.id, itemId, sourceMappings, userId });
  } catch (err) {
    if (!isUnknownSuiteQlIdentifierError(err, "custcol_sb_lot_details")) throw err;
    console.warn("custcol_sb_lot_details is not available in SuiteQL; evaluating workflow check without it.");
    result = await fetchWorkflowLineSuiteQl({ salesOrderId: targetOrder.id, itemId, sourceMappings, includeLotDetails: false, userId });
  }
  const line = Array.isArray(result?.items) ? result.items[0] : null;
  if (!line) {
    throw new Error(
      sourceKey === "intercompanySalesOrder"
        ? "Affected item was not found on the paired intercompany sales order"
        : "Affected item was not found on the related sales order"
    );
  }
  return {
    supportCase,
    line: normaliseWorkflowLineQuantities(line),
    source: {
      type: sourceKey,
      storeSalesOrderId: salesOrderId,
      checkedSalesOrderId: targetOrder.id,
      checkedSalesOrderName: targetDocument.documentNumber || targetOrder.name,
      checkedSalesOrderDocumentNumber: targetDocument.documentNumber,
      checkedSalesOrderUrl: targetDocument.url,
    },
  };
}

async function loadInputItemSalesOrderLineForCase(caseId, itemIdValue, userId, source = "storeSalesOrder", sourceMappings = []) {
  const supportCase = await getSupportCaseDetail(caseId, userId);
  const salesOrderId = Number(supportCase.salesOrderId);
  const itemId = Number(itemIdValue);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    throw new Error("Case does not have a related sales order");
  }
  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new Error("Selected input is not a valid sales order item");
  }

  const sourceKey = source === "intercompanySalesOrder" ? "intercompanySalesOrder" : "storeSalesOrder";
  const targetOrder = sourceKey === "intercompanySalesOrder"
    ? await getPairedIntercompanySalesOrderId(salesOrderId, userId)
    : { id: salesOrderId, name: "" };
  const targetDocument = await getSalesOrderDocumentInfo(targetOrder.id, userId);

  let result;
  try {
    result = await fetchWorkflowLineSuiteQl({ salesOrderId: targetOrder.id, itemId, sourceMappings, userId });
  } catch (err) {
    if (!isUnknownSuiteQlIdentifierError(err, "custcol_sb_lot_details")) throw err;
    console.warn("custcol_sb_lot_details is not available in SuiteQL; evaluating workflow input item check without it.");
    result = await fetchWorkflowLineSuiteQl({ salesOrderId: targetOrder.id, itemId, sourceMappings, includeLotDetails: false, userId });
  }
  const line = Array.isArray(result?.items) ? result.items[0] : null;
  if (!line) {
    throw new Error(
      sourceKey === "intercompanySalesOrder"
        ? "Selected input item was not found on the paired intercompany sales order"
        : "Selected input item was not found on the related sales order"
    );
  }
  return {
    supportCase,
    line: normaliseWorkflowLineQuantities(line),
    source: {
      type: "inputSalesOrderItem",
      inputSource: sourceKey,
      storeSalesOrderId: salesOrderId,
      checkedSalesOrderId: targetOrder.id,
      checkedSalesOrderName: targetDocument.documentNumber || targetOrder.name,
      checkedSalesOrderDocumentNumber: targetDocument.documentNumber,
      checkedSalesOrderUrl: targetDocument.url,
      itemId,
      itemName: String(line.itemname || line.ITEMNAME || "").trim(),
    },
  };
}

function evaluateWorkflowLineRules(rules = [], line = {}) {
  return rules.map((rule) => {
    const actualValue = workflowCheckLineValue(line, rule.field);
    const expectedValue = rule.compareType === "static"
      ? rule.staticValue
      : workflowCheckLineValue(line, rule.compareField);
    const passed = compareWorkflowCheckValues(actualValue, rule.operator || "equals", expectedValue);
    return {
      field: rule.field,
      fieldLabel: workflowCheckFieldLabel(rule.field),
      operator: rule.operator || "equals",
      compareType: rule.compareType || "field",
      compareField: rule.compareField,
      compareFieldLabel: workflowCheckFieldLabel(rule.compareField),
      staticValue: rule.staticValue || "",
      actualValue,
      expectedValue,
      passed,
    };
  });
}

function safeSuiteQlIdentifier(value = "") {
  const clean = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(clean)) {
    throw new Error(`Invalid SuiteQL field identifier '${clean}'`);
  }
  return clean;
}

function workflowRecordCriteriaTable(source = "case") {
  return source === "case" ? "supportCase" : "transaction";
}

function workflowCriteriaSourceLabel(source = "case") {
  return ({
    case: "Case",
    salesOrder: "Sales Order",
    intercompanySalesOrder: "Intercompany Sales Order",
  })[source] || "Case";
}

function workflowCriteriaValue(row = {}, fieldId = "") {
  const key = String(fieldId || "");
  const raw = rowValue(row, key, key.toLowerCase(), key.toUpperCase());
  const display = rowValue(row, `${key}_display`, `${key.toLowerCase()}_display`, `${key.toUpperCase()}_DISPLAY`);
  if (raw && typeof raw === "object") {
    return {
      raw: refId(raw) || cleanDraftValue(raw.id || raw.value),
      display: refName(raw) || cleanDraftValue(raw.name || raw.text || raw.refName),
    };
  }
  return {
    raw: cleanDraftValue(raw),
    display: cleanDraftValue(display),
  };
}

function workflowCriteriaComparable(value = {}) {
  return [value.raw, value.display].map((item) => String(item ?? "").trim()).filter(Boolean);
}

function compareWorkflowCriteriaValues(actual, operator, expected) {
  if (operator === "isSet") return workflowCriteriaComparable(actual).length > 0;
  if (operator === "isNotSet") return workflowCriteriaComparable(actual).length === 0;
  const actualValues = workflowCriteriaComparable(actual);
  const expectedValues = workflowCriteriaComparable(expected);
  if (!expectedValues.length) expectedValues.push("");
  if (!actualValues.length) actualValues.push("");
  if (operator === "notEquals") {
    return actualValues.every((left) => expectedValues.every((right) => compareWorkflowCheckValues(left, "notEquals", right)));
  }
  if (operator === "greaterThan" || operator === "lessThan") {
    return compareWorkflowCheckValues(actualValues[0], operator, expectedValues[0]);
  }
  return actualValues.some((left) => expectedValues.some((right) => compareWorkflowCheckValues(left, "equals", right)));
}

async function loadWorkflowCriteriaRecord({ caseId, source, fields }, userId) {
  const supportCase = await getSupportCaseDetail(caseId, userId);
  let recordId = Number(caseId);
  let table = workflowRecordCriteriaTable(source);
  if (source === "salesOrder" || source === "intercompanySalesOrder") {
    const salesOrderId = Number(supportCase.salesOrderId);
    if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) throw new Error("Case does not have a related sales order");
    recordId = source === "intercompanySalesOrder"
      ? Number((await getPairedIntercompanySalesOrderId(salesOrderId, userId)).id)
      : salesOrderId;
  }
  if (!Number.isFinite(recordId) || recordId <= 0) throw new Error(`Could not resolve ${workflowCriteriaSourceLabel(source)} record`);

  const safeFields = Array.from(new Set(fields.filter(Boolean))).map(safeSuiteQlIdentifier);
  if (!safeFields.length) return { supportCase, recordId, row: {}, source };
  const selectFields = safeFields.flatMap((field) => [
    field,
    `BUILTIN.DF(${field}) AS ${field}_display`,
  ]);
  let result;
  try {
    result = await nsPostRaw(
      suiteQlUrl(),
      {
        q: `
          SELECT
            ${selectFields.join(",\n          ")}
          FROM ${table}
          WHERE id = ${recordId}
        `,
      },
      userId
    );
  } catch (err) {
    const text = `${err.message || ""} ${JSON.stringify(err.responseBody || {})}`;
    const invalidMatch = text.match(/Unknown identifier '([^']+)'/i);
    const invalidField = invalidMatch ? invalidMatch[1] : "";
    if (!invalidField) throw err;
    const retryFields = safeFields.filter((field) => field.toLowerCase() !== invalidField.toLowerCase());
    if (!retryFields.length) {
      result = { items: [{}] };
    } else {
    const retrySelectFields = retryFields.flatMap((field) => [
      field,
      `BUILTIN.DF(${field}) AS ${field}_display`,
    ]);
    result = await nsPostRaw(
      suiteQlUrl(),
      {
        q: `
          SELECT
            ${retrySelectFields.join(",\n          ")}
          FROM ${table}
          WHERE id = ${recordId}
        `,
      },
      userId
    );
    }
  }
  return {
    supportCase,
    recordId,
    row: Array.isArray(result?.items) ? result.items[0] || {} : {},
    source,
  };
}

async function evaluateWorkflowCriteria({ caseId, criteria }, userId) {
  const rules = Array.isArray(criteria) ? criteria : [];
  if (!rules.length) return { available: true, results: [] };

  const grouped = new Map();
  rules.forEach((rule) => {
    const source = ["case", "salesOrder", "intercompanySalesOrder"].includes(rule?.source) ? rule.source : "case";
    const fields = grouped.get(source) || new Set();
    if (rule?.field) fields.add(rule.field);
    if (rule?.compareType === "field" && rule?.compareField) fields.add(rule.compareField);
    grouped.set(source, fields);
  });

  const records = {};
  for (const [source, fields] of grouped.entries()) {
    records[source] = await loadWorkflowCriteriaRecord({ caseId, source, fields: Array.from(fields) }, userId);
  }

  const results = rules.map((rule) => {
    const source = ["case", "salesOrder", "intercompanySalesOrder"].includes(rule?.source) ? rule.source : "case";
    const record = records[source] || {};
    const actual = workflowCriteriaValue(record.row || {}, rule.field || "");
    const expected = rule.compareType === "field"
      ? workflowCriteriaValue(record.row || {}, rule.compareField || "")
      : { raw: cleanDraftValue(rule.staticValue), display: cleanDraftValue(rule.staticValueLabel) };
    return {
      source,
      sourceLabel: workflowCriteriaSourceLabel(source),
      recordId: record.recordId ? String(record.recordId) : "",
      field: rule.field || "",
      operator: rule.operator || "equals",
      compareType: rule.compareType || "static",
      compareField: rule.compareField || "",
      staticValue: rule.staticValue || "",
      staticValueLabel: rule.staticValueLabel || "",
      actualValue: actual.raw,
      actualDisplay: actual.display,
      expectedValue: expected.raw,
      expectedDisplay: expected.display,
      passed: compareWorkflowCriteriaValues(actual, rule.operator || "equals", expected),
    };
  });

  return {
    available: results.every((result) => result.passed),
    results,
  };
}

async function evaluateWorkflowCheck({ caseId, node, inputValue, inputLabel, inputSource, selectedRecordId }, userId) {
  const config = node?.checkConfig || {};
  const configuredRecordType = config.recordType || "affectedItem";
  const recordType = ["affectedItem", "input"].includes(configuredRecordType)
    ? configuredRecordType
    : await resolveWorkflowCheckRecordType(configuredRecordType);
  const affectedItemSource = config.affectedItemSource || "storeSalesOrder";
  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (!rules.length) {
    return {
      result: "Fail",
      recordType,
      affectedItemSource,
      message: "No check rules configured",
      checks: [],
      data: {},
    };
  }

  if (recordType === "input" && inputSource === "salesOrderItems") {
    const { supportCase, line, source } = await loadInputItemSalesOrderLineForCase(
      caseId,
      inputValue,
      userId,
      affectedItemSource,
      workflowCheckLineSourceMappings(rules)
    );
    const checks = evaluateWorkflowLineRules(rules, line);
    return {
      result: checks.every((check) => check.passed) ? "Pass" : "Fail",
      recordType,
      affectedItemSource,
      source: {
        ...source,
        inputNodeId: config.inputNodeId || "",
        label: inputLabel || "Input",
      },
      case: {
        id: supportCase.id,
        caseNumber: supportCase.caseNumber,
        salesOrderId: supportCase.salesOrderId,
        itemId: source.itemId,
        itemName: source.itemName,
      },
      data: line,
      checks,
    };
  }

  if (recordType !== "affectedItem") {
    if (!workflowCheckTransactionType(recordType)) {
      return {
        result: "Fail",
        recordType: configuredRecordType,
        affectedItemSource,
        message: `${configuredRecordType} checks are framework-only and not wired yet`,
        checks: rules.map((rule) => ({ ...rule, passed: false, note: "Not wired yet" })),
        data: {},
      };
    }

    const supportCase = await getSupportCaseDetail(caseId, userId);
    let recordId = cleanDraftValue(selectedRecordId);
    let candidates = [];
    if (recordType === "salesOrder") {
      recordId = recordId || cleanDraftValue(supportCase.salesOrderId);
      candidates = recordId ? [normaliseWorkflowCheckRecordCandidate({ id: recordId, tranid: recordId }, recordType)] : [];
    } else {
      candidates = await getWorkflowCheckRecordCandidates({ recordType, salesOrderId: supportCase.salesOrderId }, userId);
      if (!recordId && candidates.length === 1) recordId = candidates[0].id;
      if (!recordId && candidates.length > 1) {
        return {
          result: "Fail",
          recordType,
          affectedItemSource,
          needsInput: "workflowCheckRecordSelection",
          message: `Select which ${workflowCheckRecordLabel(recordType)} to check.`,
          candidates,
          checks: [],
          data: {},
          case: {
            id: supportCase.id,
            caseNumber: supportCase.caseNumber,
            salesOrderId: supportCase.salesOrderId,
            customerId: supportCase.customerId,
            customerName: supportCase.customerName,
          },
        };
      }
    }

    if (!recordId) {
      return {
        result: "Fail",
        recordType,
        affectedItemSource,
        message: `No ${workflowCheckRecordLabel(recordType)} was found for the Sales Order customer.`,
        checks: rules.map((rule) => ({ ...rule, passed: false, note: "No record found" })),
        candidates,
        data: {},
      };
    }

    const fields = Array.from(new Set(rules.flatMap((rule) => [
      rule.field,
      rule.compareType === "field" ? rule.compareField : "",
    ]).filter(Boolean)));
    const row = await loadWorkflowCheckTransactionRecord({ recordType, recordId, fields }, userId);
    const checks = evaluateWorkflowRecordRules(rules, row);
    const selected = normaliseWorkflowCheckRecordCandidate(row, recordType);
    return {
      result: checks.every((check) => check.passed) ? "Pass" : "Fail",
      recordType,
      affectedItemSource,
      source: {
        type: recordType,
        recordId: String(recordId),
        label: workflowCheckRecordLabel(recordType),
        documentNumber: selected.tranId || String(recordId),
        url: selected.url || "",
      },
      case: {
        id: supportCase.id,
        caseNumber: supportCase.caseNumber,
        salesOrderId: supportCase.salesOrderId,
        customerId: supportCase.customerId,
        customerName: supportCase.customerName,
      },
      data: row,
      checks,
      candidates,
    };
  }

  const { supportCase, line, source } = await loadAffectedItemSalesOrderLineForCase(
    caseId,
    userId,
    affectedItemSource,
    workflowCheckLineSourceMappings(rules)
  );
  const checks = evaluateWorkflowLineRules(rules, line);

  return {
    result: checks.every((check) => check.passed) ? "Pass" : "Fail",
    recordType,
    affectedItemSource,
    source,
    case: {
      id: supportCase.id,
      caseNumber: supportCase.caseNumber,
      salesOrderId: supportCase.salesOrderId,
      itemId: supportCase.itemId,
      itemName: supportCase.itemName,
    },
    data: line,
    checks,
  };
}

function workflowActionTypeLabel(type = "") {
  return ({
    setCaseStatus: "Set Case Status",
    itemLineAction: "Item Line Action",
    addItemLine: "Add Item Line",
    email: "Email",
    closeSalesLine: "Close Sales Line",
    closeIntercompanyLine: "Close Intercompany Line",
    closeSupplierPurchaseOrderLine: "Close Supplier Purchase Order Line",
    refundCreditMemo: "Refund Credit Memo",
    creditRma: "Credit RMA",
    receiveRma: "Receive RMA",
    createRecord: "Create Record",
  })[type] || "Action message only";
}

const CREATE_RECORD_ENDPOINTS = {
  salesOrder: { endpoint: "/salesOrder", recordType: "salesOrder", documentPath: "/app/accounting/transactions/salesord.nl" },
  customerDeposit: { endpoint: "/customerDeposit", recordType: "customerDeposit", documentPath: "/app/accounting/transactions/custdep.nl" },
  customerRefund: { endpoint: "/customerRefund", recordType: "customerRefund", documentPath: "/app/accounting/transactions/custrfnd.nl" },
  creditMemo: { endpoint: "/creditMemo", recordType: "creditMemo", documentPath: "/app/accounting/transactions/custcred.nl" },
  returnAuthorization: { endpoint: "/returnAuthorization", recordType: "returnAuthorization", documentPath: "/app/accounting/transactions/rtnauth.nl" },
};

function normaliseRecordTypeKey(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createRecordConfig(targetRecord = "") {
  const direct = CREATE_RECORD_ENDPOINTS[targetRecord];
  if (direct) return direct;
  const clean = normaliseRecordTypeKey(targetRecord);
  const canonicalKey = Object.keys(CREATE_RECORD_ENDPOINTS).find((key) => normaliseRecordTypeKey(key) === clean);
  if (canonicalKey) return CREATE_RECORD_ENDPOINTS[canonicalKey];
  const raw = cleanDraftValue(targetRecord);
  if (!raw) return null;
  return { endpoint: `/${raw}`, recordType: raw, documentPath: "" };
}

function fieldTypeUsesRef(fieldType = "") {
  const clean = String(fieldType || "").trim().toLowerCase();
  return clean === "list/record" || clean === "multiple select";
}

function fieldTypeUsesCheckbox(fieldType = "") {
  const clean = String(fieldType || "").trim().toLowerCase();
  return clean === "checkbox" || clean === "boolean";
}

function coerceCheckboxValue(value) {
  const raw = cleanDraftValue(value);
  if (/^(true|t|yes|y|1|checked|check|on)$/i.test(raw)) return true;
  if (/^(false|f|no|n|0|unchecked|uncheck|off)$/i.test(raw)) return false;
  return raw ? true : false;
}

function fieldTypeUsesDecimal(fieldType = "") {
  const clean = String(fieldType || "").trim().toLowerCase();
  return ["decimal", "currency", "integer", "number", "float"].includes(clean);
}

function coerceDecimalValue(value) {
  const raw = cleanDraftValue(value).replace(/,/g, "");
  if (!raw) return "";
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function coerceMappedValueForTarget(value, mapping = {}) {
  const clean = cleanDraftValue(value);
  if (value === undefined || value === null || clean === "") return "";
  const cast = cleanDraftValue(mapping.valueCast).toLowerCase();
  if (cast === "checkbox") return coerceCheckboxValue(clean);
  if (cast === "decimal") return coerceDecimalValue(clean);
  if (cast === "reference") return { id: clean };
  if (cast === "text") return clean;
  if (fieldTypeUsesCheckbox(mapping.targetFieldType)) return coerceCheckboxValue(clean);
  if (fieldTypeUsesDecimal(mapping.targetFieldType)) return coerceDecimalValue(clean);
  if (fieldTypeUsesRef(mapping.targetFieldType)) return { id: clean };
  return clean;
}

function setNestedRecordValue(target, fieldId, value) {
  const cleanField = cleanDraftValue(fieldId);
  if (!cleanField || value === "") return;
  target[cleanField] = value;
}

function workflowAnswerValue(answers = [], inputNodeId = "", inputFieldId = "", valueMode = "id") {
  const step = (Array.isArray(answers) ? answers : []).find((item) => String(item.questionId) === String(inputNodeId));
  if (!step) return "";
  const key = inputFieldId || "answer";
  if (valueMode === "name" && step.answerLabels && Object.prototype.hasOwnProperty.call(step.answerLabels, key)) {
    return cleanDraftValue(step.answerLabels[key]);
  }
  if (step.answers && Object.prototype.hasOwnProperty.call(step.answers, key)) return cleanDraftValue(step.answers[key]);
  return cleanDraftValue(step.answer);
}

function parseWorkflowMultiSelectValue(value) {
  const raw = cleanDraftValue(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (item && typeof item === "object") {
            return {
              id: cleanDraftValue(item.id || item.itemId || item.value),
              lineId: cleanDraftValue(item.lineId || item.line || item.lineuniquekey),
              name: cleanDraftValue(item.name || item.label || item.text),
              quantity: coerceDecimalValue(item.quantity || item.qty || 1) || 1,
              rate: cleanDraftValue(item.rate),
              amount: cleanDraftValue(item.amount),
              grossamt: cleanDraftValue(item.grossamt || item.grossAmount),
            };
          }
          return { id: cleanDraftValue(item), lineId: "", name: "", quantity: 1, rate: "", amount: "", grossamt: "" };
        })
        .filter((item) => item.id);
    }
  } catch {}
  return raw.split(",")
    .map((item) => cleanDraftValue(item))
    .filter(Boolean)
    .map((id) => ({ id, lineId: "", name: "", quantity: 1, rate: "", amount: "", grossamt: "" }));
}

function workflowAnswerMultiSelectValues(answers = [], inputNodeId = "", inputFieldId = "") {
  return parseWorkflowMultiSelectValue(workflowAnswerValue(answers, inputNodeId, inputFieldId, "id"));
}

function multiSelectSelectionLine(selection = {}) {
  return {
    id: selection.id || "",
    item: selection.id || "",
    itemId: selection.id || "",
    item_display: selection.name || "",
    itemName: selection.name || "",
    line: selection.lineId || "",
    lineuniquekey: selection.lineId || "",
    quantity: selection.quantity || 1,
    rate: selection.rate || "",
    amount: selection.amount || "",
    grossamt: selection.grossamt || selection.amount || "",
  };
}

function multiSelectSelectionValueForTarget(selection = {}, mapping = {}) {
  const targetField = cleanDraftValue(mapping.targetField).toLowerCase();
  if (["quantity", "qty"].includes(targetField)) return selection.quantity || 1;
  if (["rate"].includes(targetField)) return selection.rate || "";
  if (["amount", "netamount"].includes(targetField)) return selection.amount || "";
  if (["grossamt", "grossamount"].includes(targetField)) return selection.grossamt || selection.amount || "";
  if (["line", "lineuniquekey", "lineid"].includes(targetField)) return selection.lineId || "";
  if (mapping.valueMode === "name" || mapping.valueCast === "text") return selection.name || selection.id || "";
  return selection.id || "";
}

function workflowAnswerValueByLabel(answers = [], labelPattern) {
  const matcher = labelPattern instanceof RegExp ? labelPattern : new RegExp(String(labelPattern || ""), "i");
  for (const step of Array.isArray(answers) ? answers : []) {
    const answerText = cleanDraftValue(step.answer);
    const labels = step.answerLabels && typeof step.answerLabels === "object" ? step.answerLabels : {};
    const values = step.answers && typeof step.answers === "object" ? step.answers : {};

    const answerParts = answerText.split(";").map((part) => part.trim()).filter(Boolean);
    for (const part of answerParts) {
      const match = part.match(/^([^:]+):\s*(.*)$/);
      if (!match || !matcher.test(match[1])) continue;
      const displayValue = cleanDraftValue(match[2]);
      const key = Object.keys(labels).find((itemKey) => cleanDraftValue(labels[itemKey]) === displayValue);
      if (key && cleanDraftValue(values[key])) return cleanDraftValue(values[key]);
      if (displayValue) return displayValue;
    }

    for (const [key, displayValue] of Object.entries(labels)) {
      if (matcher.test(key) || matcher.test(displayValue)) {
        return cleanDraftValue(values[key] || displayValue);
      }
    }
  }
  return "";
}

function recordValueByMode(record = {}, fieldId = "", valueMode = "id") {
  const value = record?.[fieldId] ?? record?.[String(fieldId).toLowerCase()] ?? record?.[String(fieldId).toUpperCase()];
  if (valueMode === "name") return refName(value) || cleanDraftValue(value);
  return refId(value) || cleanDraftValue(value);
}

async function loadRecordFieldValue(recordType, recordId, fieldId, valueMode, userId) {
  const cleanType = cleanDraftValue(recordType);
  const cleanId = cleanDraftValue(recordId);
  const cleanField = cleanDraftValue(fieldId);
  if (!cleanType || !cleanId || !cleanField) return "";
  const record = await nsGet(`/${cleanType}/${encodeURIComponent(cleanId)}?fields=${encodeURIComponent(cleanField)}`, userId);
  return recordValueByMode(record, cleanField, valueMode);
}

async function resolveCreateRecordMappingValue(mapping = {}, context = {}, userId) {
  if (mapping.mode === "static") return cleanDraftValue(mapping.staticValue);
  if (mapping.mode === "calculation") return resolveWorkflowCalculation(mapping, context, userId);
  if (mapping.sourceType === "workflowInput") {
    return workflowAnswerValue(context.answers, mapping.sourceInputId, mapping.sourceInputFieldId, mapping.valueMode);
  }

  const mappingSourceRecord = cleanDraftValue(mapping.sourceRecord || context.sourceRecord || "storeSalesOrder");
  const sourceField = cleanDraftValue(mapping.sourceField);
  if (!sourceField) return "";

  if (cleanDraftValue(mapping.sourceSublist) && context.line && typeof context.line === "object") {
    if (mapping.valueMode === "name" || mapping.valueCast === "text") {
      const displayValue = rowValue(
        context.line,
        `${sourceField}_display`,
        `${sourceField}display`,
        `${sourceField}name`,
        `${sourceField}_name`,
        `${sourceField}Name`,
        `${sourceField}Display`
      );
      if (cleanDraftValue(displayValue)) return displayValue;
    }
    return rowValue(context.line, sourceField, sourceField.toLowerCase(), sourceField.toUpperCase());
  }

  let sourceRecord = null;
  let parentValue = "";
  if (mappingSourceRecord === "case") {
    sourceRecord = context.caseDetail || {};
    parentValue = recordValueByMode(sourceRecord, sourceField, mapping.valueMode);
  } else {
    const salesOrderId = mappingSourceRecord === "intercompanySalesOrder"
      ? context.intercompanySalesOrderId
      : context.salesOrderId;
    if (!salesOrderId) return "";
    sourceRecord = await nsGet(`/salesOrder/${encodeURIComponent(salesOrderId)}?fields=${encodeURIComponent(sourceField)}`, userId);
    parentValue = recordValueByMode(sourceRecord, sourceField, mapping.valueMode);
  }

  if (mapping.sourceChildField && mapping.sourceChildRecord) {
    const parentId = recordValueByMode(sourceRecord, sourceField, "id") || parentValue;
    return loadRecordFieldValue(mapping.sourceChildRecord, parentId, mapping.sourceChildField, mapping.valueMode, userId);
  }
  return parentValue;
}

function calculationNumber(value, options = {}) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return options.absolute ? Math.abs(value) : value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  const raw = cleanDraftValue(value).replace(/,/g, "");
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return 0;
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric)) return 0;
  return options.absolute ? Math.abs(numeric) : numeric;
}

function isAmountLikeLineField(fieldId = "") {
  const clean = cleanDraftValue(fieldId).toLowerCase();
  return [
    "amount",
    "grossamt",
    "grossamount",
    "netamount",
    "rate",
    "price",
    "taxamount",
    "tax1amt",
  ].includes(clean);
}

function lineCalculationValue(line = {}, fieldId = "") {
  const cleanField = cleanDraftValue(fieldId);
  const direct = rowValue(line, cleanField, cleanField.toLowerCase(), cleanField.toUpperCase());
  if (cleanDraftValue(direct) !== "") return direct;

  const clean = cleanField.toLowerCase();
  if (["grossamt", "grossamount"].includes(clean)) {
    return rowValue(
      line,
      "grossamt",
      "grossAmt",
      "grossamount",
      "grossAmount",
      "amountgrossline",
      "amountGrossLine",
      "salegrossline",
      "saleGrossLine",
      "grosssaleprice",
      "grossSaleprice",
      "amount",
      "AMOUNT",
      "netamount",
      "NETAMOUNT"
    );
  }
  if (["amount", "netamount"].includes(clean)) {
    return rowValue(
      line,
      "amount",
      "AMOUNT",
      "netamount",
      "NETAMOUNT",
      "grossamt",
      "grossAmt",
      "grossamount",
      "grossAmount"
    );
  }
  return direct;
}

async function resolveCalculationToken(token = "", mapping = {}, context = {}, userId) {
  const cleanToken = cleanDraftValue(token);
  const lower = cleanToken.toLowerCase();
  if (lower === "wf.input") {
    return calculationNumber(workflowAnswerValue(context.answers, mapping.sourceInputId, mapping.sourceInputFieldId, "id"));
  }
  if (lower.startsWith("wf.")) {
    const fieldId = cleanToken.slice(3);
    return calculationNumber(workflowAnswerValue(context.answers, mapping.sourceInputId, fieldId, "id"));
  }
  if (lower.startsWith("line.")) {
    const fieldId = cleanToken.slice(5);
    const line = context.line || {};
    return calculationNumber(
      lineCalculationValue(line, fieldId),
      { absolute: isAmountLikeLineField(fieldId) }
    );
  }
  if (lower.startsWith("source.") || lower.startsWith("record.")) {
    const path = cleanToken.slice(cleanToken.indexOf(".") + 1).split(".").filter(Boolean);
    const fieldId = path[0] || "";
    const childFieldId = path[1] || "";
    const childSource = (Array.isArray(context.records) ? context.records : [])
      .flatMap((record) => record?.fields || [])
      .find((field) => String(field.internalId) === String(fieldId));
    return calculationNumber(await resolveCreateRecordMappingValue({
      ...mapping,
      mode: "source",
      sourceType: "record",
      sourceField: fieldId,
      sourceChildField: childFieldId,
      sourceChildRecord: childFieldId ? cleanDraftValue(childSource?.listRecord || childSource?.listRecordId || childSource?.recordType || childSource?.sourceRecord) : "",
      sourceFieldPath: childFieldId ? [fieldId, childFieldId] : [],
    }, context, userId));
  }
  return 0;
}

async function resolveCalculationTokenRaw(token = "", mapping = {}, context = {}, userId) {
  const cleanToken = cleanDraftValue(token);
  const lower = cleanToken.toLowerCase();
  if (lower === "wf.input") {
    return workflowAnswerValue(context.answers, mapping.sourceInputId, mapping.sourceInputFieldId, "id");
  }
  if (lower.startsWith("wf.")) {
    const fieldId = cleanToken.slice(3);
    return workflowAnswerValue(context.answers, mapping.sourceInputId, fieldId, "id");
  }
  if (lower.startsWith("line.")) {
    const fieldId = cleanToken.slice(5);
    const line = context.line || {};
    return lineCalculationValue(line, fieldId);
  }
  if (lower.startsWith("source.") || lower.startsWith("record.")) {
    const path = cleanToken.slice(cleanToken.indexOf(".") + 1).split(".").filter(Boolean);
    const fieldId = path[0] || "";
    const childFieldId = path[1] || "";
    const childSource = (Array.isArray(context.records) ? context.records : [])
      .flatMap((record) => record?.fields || [])
      .find((field) => String(field.internalId) === String(fieldId));
    return resolveCreateRecordMappingValue({
      ...mapping,
      mode: "source",
      sourceType: "record",
      sourceField: fieldId,
      sourceChildField: childFieldId,
      sourceChildRecord: childFieldId ? cleanDraftValue(childSource?.listRecord || childSource?.listRecordId || childSource?.recordType || childSource?.sourceRecord) : "",
      sourceFieldPath: childFieldId ? [fieldId, childFieldId] : [],
    }, context, userId);
  }
  return "";
}

async function resolveCalculationExpression(expression = "", mapping = {}, context = {}, userId) {
  let resolved = expression;
  const tokens = [...expression.matchAll(/\{([^}]+)\}/g)];
  const resolvedTokens = [];
  for (const match of tokens) {
    const value = await resolveCalculationToken(match[1], mapping, context, userId);
    resolvedTokens.push({ token: match[1], value });
    resolved = resolved.replace(match[0], String(value));
  }
  if (!/^[\d+\-*/().\s]+$/.test(resolved)) {
    throw new Error(`Calculation contains unsupported values: ${expression}`);
  }
  let result;
  try {
    result = Function(`"use strict"; return (${resolved});`)();
  } catch {
    throw new Error(`Calculation could not be evaluated: ${expression}`);
  }
  if (!Number.isFinite(Number(result))) {
    throw new Error(`Calculation did not return a numeric value: ${expression}`);
  }
  return { result: Number(result), resolved, tokens: resolvedTokens };
}

function parseCaseCalculation(expression = "") {
  const match = String(expression || "").trim().match(/^case\s+when\s+([\s\S]+?)\s+then\s+([\s\S]+?)\s+else\s+([\s\S]+?)\s+end\s*$/i);
  if (!match) return null;
  return {
    condition: match[1].trim(),
    thenExpression: match[2].trim(),
    elseExpression: match[3].trim(),
  };
}

async function evaluateCalculationCondition(condition = "", mapping = {}, context = {}, userId) {
  const match = String(condition || "").trim().match(/^\{([^}]+)\}\s*(=|==|!=|<>|>=|<=|>|<)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))\s*$/i);
  if (!match) throw new Error(`Calculation condition is not supported: ${condition}`);
  const actualRaw = await resolveCalculationTokenRaw(match[1], mapping, context, userId);
  const operator = match[2];
  const expectedRaw = match[3] ?? match[4] ?? match[5] ?? "";
  const actualNumber = calculationNumber(actualRaw);
  const expectedNumber = calculationNumber(expectedRaw);
  const compareAsNumber = /^-?\d+(\.\d+)?$/.test(cleanDraftValue(expectedRaw)) && cleanDraftValue(actualRaw).match(/-?\d+(\.\d+)?/);
  const actual = compareAsNumber ? actualNumber : cleanDraftValue(actualRaw).toLowerCase();
  const expected = compareAsNumber ? expectedNumber : cleanDraftValue(expectedRaw).toLowerCase();
  switch (operator) {
    case "=":
    case "==":
      return actual === expected;
    case "!=":
    case "<>":
      return actual !== expected;
    case ">":
      return Number(actual) > Number(expected);
    case "<":
      return Number(actual) < Number(expected);
    case ">=":
      return Number(actual) >= Number(expected);
    case "<=":
      return Number(actual) <= Number(expected);
    default:
      return false;
  }
}

function splitCalculationArguments(value = "") {
  const args = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (const char of String(value || "")) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function parseRoundCalculation(expression = "") {
  const clean = String(expression || "").trim();
  if (!/^round\s*\(/i.test(clean) || !clean.endsWith(")")) return null;
  const openIndex = clean.indexOf("(");
  const inner = clean.slice(openIndex + 1, -1);
  const args = splitCalculationArguments(inner);
  if (!args.length || args.length > 2) throw new Error(`ROUND expects value and optional decimals: ${expression}`);
  const decimals = args.length === 2 ? Number(args[1]) : 0;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    throw new Error(`ROUND decimals must be an integer from 0 to 8: ${expression}`);
  }
  return { expression: args[0], decimals };
}

function roundCalculationValue(value, decimals = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error("ROUND did not receive a numeric value.");
  const factor = 10 ** decimals;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

async function resolveWorkflowCalculation(mapping = {}, context = {}, userId) {
  const expression = cleanDraftValue(mapping.calculationExpression);
  if (!expression) return "";

  const roundExpression = parseRoundCalculation(expression);
  if (roundExpression) {
    const unrounded = await resolveWorkflowCalculation({
      ...mapping,
      calculationExpression: roundExpression.expression,
    }, context, userId);
    const rounded = roundCalculationValue(unrounded, roundExpression.decimals);
    console.log("[workflow-calculation] resolved round", {
      expression,
      innerExpression: roundExpression.expression,
      decimals: roundExpression.decimals,
      unrounded,
      result: rounded,
    });
    return rounded;
  }

  const caseExpression = parseCaseCalculation(expression);
  if (caseExpression) {
    const passed = await evaluateCalculationCondition(caseExpression.condition, mapping, context, userId);
    const branch = passed ? caseExpression.thenExpression : caseExpression.elseExpression;
    const evaluated = await resolveCalculationExpression(branch, mapping, context, userId);
    console.log("[workflow-calculation] resolved case", {
      expression,
      condition: caseExpression.condition,
      conditionPassed: passed,
      branch,
      resolved: evaluated.resolved,
      tokens: evaluated.tokens,
      result: evaluated.result,
    });
    return evaluated.result;
  }

  const evaluated = await resolveCalculationExpression(expression, mapping, context, userId);
  console.log("[workflow-calculation] resolved", {
    expression,
    resolved: evaluated.resolved,
    tokens: evaluated.tokens,
    result: evaluated.result,
  });
  return evaluated.result;
}

async function buildCreateRecordPayload(action = {}, context = {}, userId) {
  const createRecord = action.createRecord && typeof action.createRecord === "object" ? action.createRecord : {};
  const mappings = Array.isArray(createRecord.mappings) ? createRecord.mappings : [];
  const body = {};
  const sublistRows = new Map();
  const debugMappings = [];

  const expandedSublists = new Map();
  for (const mapping of mappings) {
    const targetSublist = cleanDraftValue(mapping.targetSublist);
    if (
      targetSublist &&
      mapping.sourceType === "workflowInput" &&
      cleanDraftValue(mapping.sourceInputType).toLowerCase() === "multiselect"
    ) {
      const selections = workflowAnswerMultiSelectValues(context.answers, mapping.sourceInputId, mapping.sourceInputFieldId);
      if (selections.length) {
        expandedSublists.set(targetSublist, { mapping, selections });
      }
    }
  }

  for (const mapping of mappings) {
    const targetSublist = cleanDraftValue(mapping.targetSublist);
    if (targetSublist && expandedSublists.has(targetSublist)) continue;

    const value = await resolveCreateRecordMappingValue(mapping, context, userId);
    debugMappings.push({
      targetField: mapping.targetSublist ? `${mapping.targetSublist}.${mapping.targetField}` : mapping.targetField,
      sourceType: mapping.sourceType || "record",
      sourceRecord: mapping.sourceRecord || createRecord.sourceRecord || context.sourceRecord || "",
      sourceField: mapping.sourceType === "workflowInput" ? `${mapping.sourceInputId || ""}:${mapping.sourceInputFieldId || ""}` : mapping.sourceField || "",
      value,
      valueMode: mapping.valueMode || "id",
    });
    const coerced = coerceMappedValueForTarget(value, mapping);
    if (coerced === "") continue;
    if (mapping.targetSublist) {
      const key = targetSublist;
      const rows = sublistRows.get(key) || [{}];
      const row = rows[0] || {};
      setNestedRecordValue(row, mapping.targetField, coerced);
      rows[0] = row;
      sublistRows.set(key, rows);
    } else {
      setNestedRecordValue(body, mapping.targetField, coerced);
    }
  }

  for (const [sublistId, expansion] of expandedSublists.entries()) {
    const sublistMappings = mappings.filter((mapping) => cleanDraftValue(mapping.targetSublist) === sublistId);
    const rows = [];
    for (const selection of expansion.selections) {
      const row = {};
      const lineContext = {
        ...context,
        line: multiSelectSelectionLine(selection),
        currentMultiSelectItem: selection,
      };
      for (const mapping of sublistMappings) {
        const isExpander =
          mapping.sourceType === "workflowInput" &&
          cleanDraftValue(mapping.sourceInputType).toLowerCase() === "multiselect" &&
          String(mapping.sourceInputId || "") === String(expansion.mapping.sourceInputId || "") &&
          String(mapping.sourceInputFieldId || "") === String(expansion.mapping.sourceInputFieldId || "");
        const value = isExpander
          ? multiSelectSelectionValueForTarget(selection, mapping)
          : await resolveCreateRecordMappingValue(mapping, lineContext, userId);
        debugMappings.push({
          targetField: mapping.targetSublist ? `${mapping.targetSublist}.${mapping.targetField}` : mapping.targetField,
          sourceType: mapping.sourceType || "record",
          sourceRecord: mapping.sourceRecord || createRecord.sourceRecord || context.sourceRecord || "",
          sourceField: mapping.sourceType === "workflowInput" ? `${mapping.sourceInputId || ""}:${mapping.sourceInputFieldId || ""}` : mapping.sourceField || "",
          value,
          valueMode: mapping.valueMode || "id",
          expandedFromMultiSelect: true,
          selectedItemId: selection.id || "",
          selectedLineId: selection.lineId || "",
        });
        const coerced = coerceMappedValueForTarget(value, mapping);
        if (coerced === "") continue;
        setNestedRecordValue(row, mapping.targetField, coerced);
      }
      if (row.item && !Object.prototype.hasOwnProperty.call(row, "quantity") && selection.quantity) {
        row.quantity = coerceDecimalValue(selection.quantity);
      }
      if (row.item && !Object.prototype.hasOwnProperty.call(row, "rate") && selection.rate !== "") {
        row.rate = coerceDecimalValue(selection.rate);
      }
      if (row.item && !Object.prototype.hasOwnProperty.call(row, "amount") && selection.amount !== "") {
        row.amount = coerceDecimalValue(selection.amount);
      }
      if (row.item && !Object.prototype.hasOwnProperty.call(row, "grossamt") && selection.grossamt !== "") {
        row.grossamt = coerceDecimalValue(selection.grossamt);
      }
      if (
        row.item &&
        !Object.prototype.hasOwnProperty.call(row, "price") &&
        (Object.prototype.hasOwnProperty.call(row, "rate") || Object.prototype.hasOwnProperty.call(row, "amount"))
      ) {
        row.price = { id: "-1" };
      }
      if (Object.keys(row).length) rows.push(row);
    }
    sublistRows.set(sublistId, rows);
  }

  for (const [sublistId, rows] of sublistRows.entries()) {
    body[sublistId] = { items: rows };
  }
  Object.defineProperty(body, "__debugMappings", {
    value: debugMappings,
    enumerable: false,
    configurable: true,
  });
  return body;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function safeWorkflowDebugJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function logCreateRecordDebug(label, data = {}) {
  console.warn(`[workflow-create-record] ${label}`, safeWorkflowDebugJson(data));
}

function isSublistPayload(value) {
  return !!value && typeof value === "object" && Array.isArray(value.items);
}

function splitCustomerRefundCreatePayload(payload = {}) {
  const initial = {};
  const deferred = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (isSublistPayload(value)) deferred[key] = cloneJson(value);
    else initial[key] = cloneJson(value);
  });
  return { initial, deferred };
}

function netSuiteErrorText(err = {}) {
  const details = err.responseBody?.["o:errorDetails"];
  if (Array.isArray(details)) return details.map((item) => item.detail || item.message || "").join(" ");
  return cleanDraftValue(err.message || err.responseBody?.message || "");
}

function isMissingRefundMethodError(err = {}) {
  return /refund method/i.test(netSuiteErrorText(err));
}

function customerRefundMethodIdFromPayload(payload = {}) {
  const candidates = [
    payload.paymentMethod,
    payload.paymentOption,
    payload.paymentoption,
    payload.paymentmethod,
    payload.refundmethod,
    payload.refundMethod,
  ];
  for (const candidate of candidates) {
    const id = refId(candidate);
    if (id) return id;
  }
  return "";
}

function customerRefundMethodInteger(value) {
  const id = refId(value);
  if (!/^\d+$/.test(id)) return null;
  const numericId = Number(id);
  return Number.isSafeInteger(numericId) ? numericId : null;
}

function stripCustomerRefundMethodAliases(payload = {}) {
  const output = cloneJson(payload);
  ["paymentmethod", "paymentMethod", "paymentoption", "paymentOption", "refundmethod", "refundMethod"].forEach((key) => {
    delete output[key];
  });
  return output;
}

async function postCustomerRefundWithRefundMethodFallback(config, createPayload, userId) {
  const refundMethodId = customerRefundMethodIdFromPayload(createPayload);
  if (!refundMethodId) return nsPost(config.endpoint, createPayload, userId);

  const basePayload = stripCustomerRefundMethodAliases(createPayload);
  const refundMethodInteger = customerRefundMethodInteger(refundMethodId);
  const attempts = [
    ...(refundMethodInteger == null ? [] : [{ field: "paymentMethod", value: refundMethodInteger }]),
    { field: "paymentMethod", value: refundMethodId },
    { field: "paymentOption", value: { id: refundMethodId } },
    { field: "paymentOption", value: refundMethodId },
    { field: "paymentmethod", value: refundMethodId },
    { field: "paymentmethod", value: { id: refundMethodId } },
    { field: "paymentoption", value: { id: refundMethodId } },
    { field: "paymentoption", value: refundMethodId },
  ];
  let lastErr = null;
  for (const attempt of attempts) {
    const payload = { ...cloneJson(basePayload), [attempt.field]: attempt.value };
    logCreateRecordDebug("posting customer refund attempt", {
      endpoint: config.endpoint,
      refundMethodField: attempt.field,
      payload,
    });
    try {
      const created = await nsPost(config.endpoint, payload, userId);
      Object.keys(createPayload).forEach((key) => delete createPayload[key]);
      Object.assign(createPayload, payload);
      return created;
    } catch (err) {
      lastErr = err;
      logCreateRecordDebug("customer refund attempt failed", {
        refundMethodField: attempt.field,
        error: err.message || String(err),
        responseBody: err.responseBody || null,
      });
      if (!isMissingRefundMethodError(err)) throw err;
    }
  }
  throw lastErr || new Error("Customer Refund creation failed.");
}

function workflowRestletUrl() {
  return `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
}

async function getCustomerDepositCandidatesForRefund({ salesOrderId, customerId }, userId) {
  const salesOrderNumeric = Number(salesOrderId);
  const customerNumeric = Number(customerId);
  const filters = [];
  if (Number.isFinite(salesOrderNumeric) && salesOrderNumeric > 0) {
    filters.push(`tl.createdfrom = ${salesOrderNumeric}`);
  }
  if (Number.isFinite(customerNumeric) && customerNumeric > 0) {
    filters.push(`t.entity = ${customerNumeric}`);
  }
  if (!filters.length) return [];

  const query = `
    SELECT DISTINCT
      t.id,
      t.tranid,
      t.entity,
      tl.createdfrom,
      ABS(t.foreigntotal) AS total,
      ABS(t.total) AS base_total
    FROM transaction t
    JOIN transactionline tl ON tl.transaction = t.id
    WHERE t.recordtype = 'customerdeposit'
      AND (${filters.join(" OR ")})
    ORDER BY t.id DESC
  `;

  try {
    const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
    return (Array.isArray(result?.items) ? result.items : []).map((row) => ({
      id: cleanDraftValue(row.id || row.ID),
      tranId: cleanDraftValue(row.tranid || row.TRANID),
      customerId: cleanDraftValue(row.entity || row.ENTITY),
      salesOrderId: cleanDraftValue(row.createdfrom || row.CREATEDFROM),
      total: cleanDraftValue(row.total || row.TOTAL || row.base_total || row.BASE_TOTAL),
    })).filter((row) => row.id);
  } catch (err) {
    console.warn("[workflow-create-record] Customer Deposit candidate lookup failed:", err.message || err);
    return [];
  }
}

async function getCreditMemoCandidatesForRefund({ customerId }, userId) {
  const customerNumeric = Number(customerId);
  if (!Number.isFinite(customerNumeric) || customerNumeric <= 0) return [];

  const queries = [
    `
      SELECT DISTINCT
        t.id,
        t.tranid,
        t.entity,
        ABS(t.foreigntotal) AS total,
        ABS(t.total) AS base_total
      FROM transaction t
      WHERE t.recordtype = 'creditmemo'
        AND t.entity = ${customerNumeric}
      ORDER BY t.id DESC
    `,
    `
      SELECT
        id,
        tranid,
        entity,
        ABS(foreigntotal) AS total,
        ABS(total) AS base_total
      FROM creditMemo
      WHERE entity = ${customerNumeric}
      ORDER BY id DESC
    `,
  ];

  for (const query of queries) {
    try {
      const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
      const rows = (Array.isArray(result?.items) ? result.items : []).map((row) => ({
        id: cleanDraftValue(row.id || row.ID),
        tranId: cleanDraftValue(row.tranid || row.TRANID),
        customerId: cleanDraftValue(row.entity || row.ENTITY),
        total: cleanDraftValue(row.total || row.TOTAL || row.base_total || row.BASE_TOTAL),
      })).filter((row) => row.id);
      if (rows.length) return rows;
    } catch (err) {
      console.warn("[workflow-create-record] Credit Memo candidate lookup attempt failed:", err.message || err);
    }
  }
  return [];
}

async function createCustomerRefundViaRestlet(payload, userId, context = {}) {
  const restletUrl = workflowRestletUrl();
  const result = await nsRestlet(restletUrl, {
    action: "createCustomerRefund",
    payload,
    refundSource: cleanDraftValue(context.refundSource),
    salesOrderId: cleanDraftValue(context.salesOrderId),
    refundAmount: cleanDraftValue(context.refundAmount),
    candidateDeposits: Array.isArray(context.candidateDeposits) ? context.candidateDeposits : [],
    depositAllocations: Array.isArray(context.depositAllocations) ? context.depositAllocations : [],
    candidateCredits: Array.isArray(context.candidateCredits) ? context.candidateCredits : [],
    creditAllocations: Array.isArray(context.creditAllocations) ? context.creditAllocations : [],
  }, userId, "POST");
  if (!result || result.ok === false) {
    const err = new Error(result?.error || result?.message || "Customer Refund RESTlet create failed.");
    err.responseBody = result || null;
    throw err;
  }
  return {
    id: result.id || "",
    tranId: result.tranId || result.tranid || "",
    _restlet: result,
  };
}

function selectedDepositAllocations(context = {}) {
  return (Array.isArray(context.depositAllocations) ? context.depositAllocations : [])
    .map((allocation) => ({
      id: cleanDraftValue(allocation.id || allocation.depositId || allocation.doc),
      tranId: cleanDraftValue(allocation.tranId || allocation.refNum || allocation.refnum),
      amount: cleanDraftValue(allocation.amount),
    }))
    .filter((allocation) => allocation.id && Number(allocation.amount) > 0);
}

function selectedCreditAllocations(context = {}) {
  return (Array.isArray(context.creditAllocations) ? context.creditAllocations : [])
    .map((allocation) => ({
      id: cleanDraftValue(allocation.id || allocation.creditId || allocation.doc),
      tranId: cleanDraftValue(allocation.tranId || allocation.refNum || allocation.refnum),
      amount: cleanDraftValue(allocation.amount),
    }))
    .filter((allocation) => allocation.id && Number(allocation.amount) > 0);
}

function uniqueDepositCandidates(candidates = []) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : [])
    .filter((deposit) => {
      const id = cleanDraftValue(deposit.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

async function createRecordWithOptionalStaging(config, payload, targetRecord, userId, context = {}) {
  if (config.recordType !== "customerRefund") {
    logCreateRecordDebug("posting record", {
      targetRecord,
      endpoint: config.endpoint,
      payload,
    });
    return { created: await nsPost(config.endpoint, payload, userId), createPayload: payload, deferredPayload: null };
  }

  const refundSource = context.refundSource === "creditMemo" ? "creditMemo" : "customerDeposit";
  const candidateDeposits = uniqueDepositCandidates(context.candidateDeposits);
  const candidateCredits = uniqueCreditCandidates(context.candidateCredits);
  const candidates = refundSource === "creditMemo" ? candidateCredits : candidateDeposits;
  const allocations = refundSource === "creditMemo" ? selectedCreditAllocations(context) : selectedDepositAllocations(context);
  const needsInputName = refundSource === "creditMemo" ? "customerCreditMemoAllocation" : "customerDepositAllocation";
  const needsInputMessage = refundSource === "creditMemo"
    ? "Select which credit memo(s) to refund."
    : "Select which customer deposit(s) to refund.";
  const expectedRefundAmount = Number(String(context.refundAmount || "").replace(/,/g, ""));
  if (candidates.length > 1 && !allocations.length) {
    return {
      created: {
        ok: false,
        needsInput: needsInputName,
        message: needsInputMessage,
        expectedAmount: Number.isFinite(expectedRefundAmount) ? expectedRefundAmount : null,
        deposits: candidates,
      },
      createPayload: payload,
      deferredPayload: null,
      needsInput: true,
    };
  }
  const totalAllocated = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
  if (allocations.length && Number.isFinite(expectedRefundAmount) && expectedRefundAmount > 0 && totalAllocated - expectedRefundAmount > 0.0001) {
    return {
      created: {
        ok: false,
        needsInput: needsInputName,
        message: "The selected refund allocation exceeds the workflow refund amount.",
        expectedAmount: expectedRefundAmount,
        deposits: candidates,
        allocations,
      },
      createPayload: payload,
      deferredPayload: null,
      needsInput: true,
    };
  }

  logCreateRecordDebug("posting customer refund via RESTlet", {
    payload,
    restletContext: {
      salesOrderId: cleanDraftValue(context.salesOrderId),
      refundAmount: cleanDraftValue(context.refundAmount),
      refundSource,
      candidateDeposits,
      depositAllocations: refundSource === "customerDeposit" ? allocations : [],
      candidateCredits,
      creditAllocations: refundSource === "creditMemo" ? allocations : [],
    },
  });
  const created = await createCustomerRefundViaRestlet(payload, userId, {
    ...context,
    refundSource,
    candidateDeposits,
    depositAllocations: refundSource === "customerDeposit" ? allocations : [],
    candidateCredits,
    creditAllocations: refundSource === "creditMemo" ? allocations : [],
  });
  return { created, createPayload: payload, deferredPayload: null };
}

async function approveReturnAuthorizationViaRestlet(returnAuthorizationId, userId) {
  const id = cleanDraftValue(returnAuthorizationId);
  if (!id) return null;
  const result = await nsRestlet(workflowRestletUrl(), {
    action: "approveReturnAuthorization",
    returnAuthorizationId: id,
    orderstatus: "B",
  }, userId, "POST");
  if (!result || result.ok === false) {
    const err = new Error(result?.error || result?.message || "Return Authorisation approval failed.");
    err.responseBody = result || null;
    throw err;
  }
  return result;
}

async function executeCreateRecordAction({ caseId, action, checks = [], answers = [] }, userId) {
  const createRecord = action.createRecord && typeof action.createRecord === "object" ? action.createRecord : {};
  const config = createRecordConfig(createRecord.targetRecord);
  if (!config) throw new Error(`Create Record target is not supported: ${createRecord.targetRecord || "(blank)"}`);
  const targetRecordType = config.recordType || createRecord.targetRecord || "";
  console.warn("[workflow-create-record] action start", {
    caseId,
    nodeId: action.nodeId || "",
    targetRecord: createRecord.targetRecord || "",
    mappingCount: Array.isArray(createRecord.mappings) ? createRecord.mappings.length : 0,
    answerCount: Array.isArray(answers) ? answers.length : 0,
  });
  const caseDetail = await getSupportCaseDetail(caseId, userId);
  const salesOrderId = caseDetail.salesOrderId;
  const intercompany = salesOrderId ? await getPairedIntercompanySalesOrderId(salesOrderId, userId).catch(() => null) : null;
  const payload = await buildCreateRecordPayload(action, {
    caseDetail,
    salesOrderId,
    intercompanySalesOrderId: intercompany?.id || "",
    sourceRecord: createRecord.sourceRecord || "storeSalesOrder",
    checks,
    answers,
  }, userId);
  if (targetRecordType === "returnAuthorization" && !payload.entity && caseDetail.customerId) {
    payload.entity = { id: caseDetail.customerId };
  }
  if (targetRecordType === "customerRefund" && !payload.customer && caseDetail.customerId) {
    payload.customer = { id: caseDetail.customerId };
  }
  if (
    targetRecordType === "customerRefund" &&
    !payload.paymentOption &&
    !payload.paymentoption &&
    !payload.paymentmethod &&
    !payload.paymentMethod
  ) {
    const refundMethodId = workflowAnswerValueByLabel(answers, /refund method/i);
    if (refundMethodId) {
      payload.paymentMethod = customerRefundMethodInteger(refundMethodId) ?? refundMethodId;
    }
  }
  const mappingDebug = payload.__debugMappings || [];
  logCreateRecordDebug("resolved mappings", {
    caseId,
    actionNodeId: action.nodeId || "",
    targetRecord: createRecord.targetRecord || "",
    sourceRecord: createRecord.sourceRecord || "",
    answers,
    mappings: mappingDebug,
  });
  logCreateRecordDebug("payload before staging", payload);
  let created;
  let createPayload = payload;
  let deferredPayload = null;
  try {
    const candidateDeposits = targetRecordType === "customerRefund"
      ? await getCustomerDepositCandidatesForRefund({
        salesOrderId,
        customerId: caseDetail.customerId,
      }, userId)
      : [];
    const createResult = await createRecordWithOptionalStaging(config, payload, createRecord.targetRecord, userId, {
      salesOrderId,
      refundAmount: workflowAnswerValueByLabel(answers, /refund amount/i),
      candidateDeposits,
      depositAllocations: action.depositAllocations,
    });
    created = createResult.created;
    createPayload = createResult.createPayload || payload;
    deferredPayload = createResult.deferredPayload || null;
    logCreateRecordDebug("staged payloads", {
      targetRecord: createRecord.targetRecord || "",
      createPayload,
      deferredPayload,
      created,
    });
  } catch (err) {
    logCreateRecordDebug("failed payloads", {
      targetRecord: createRecord.targetRecord || "",
      payload,
      createPayload,
      deferredPayload,
      error: err.message || String(err),
      responseBody: err.responseBody || null,
      mappings: mappingDebug,
    });
    err.workflowDebug = {
      ...(err.workflowDebug || {}),
      createRecordTarget: createRecord.targetRecord || "",
      payload,
      createPayload,
      deferredPayload,
      mappings: mappingDebug,
    };
    throw err;
  }
  const id = cleanDraftValue(created.id);
  let approvalResult = null;
  if (created.needsInput) {
    return {
      created,
      payload,
      mappingDebug,
      createPayload,
      deferredPayload,
      needsInput: created.needsInput,
      document: { id: "", number: "", url: "" },
    };
  }
  if (targetRecordType === "returnAuthorization" && id) {
    approvalResult = await approveReturnAuthorizationViaRestlet(id, userId);
    created.approval = approvalResult;
  }
  let documentNumber = cleanDraftValue(created.tranId || created.tranid) || id;
  if (id) {
    if (targetRecordType === "salesOrder") {
      const doc = await getSalesOrderDocumentInfo(id, userId).catch(() => null);
      documentNumber = doc?.documentNumber || documentNumber || id;
    }
  }
  return {
    created,
    payload,
    mappingDebug,
    createPayload,
    deferredPayload,
    document: {
      id,
      number: documentNumber,
      url: id && config.documentPath ? `${netSuiteAppBaseUrl().replace(/\/$/, "")}${config.documentPath}?id=${encodeURIComponent(id)}` : "",
    },
  };
}

async function executeRefundCreditMemoAction({ caseId, action, checks = [], answers = [] }, userId) {
  const createRecord = {
    ...(action.createRecord && typeof action.createRecord === "object" ? action.createRecord : {}),
    targetRecord: "customerRefund",
    sourceRecord: action.createRecord?.sourceRecord || "storeSalesOrder",
  };
  const config = createRecordConfig("customerRefund");
  const caseDetail = await getSupportCaseDetail(caseId, userId);
  const salesOrderId = caseDetail.salesOrderId;
  const intercompany = salesOrderId ? await getPairedIntercompanySalesOrderId(salesOrderId, userId).catch(() => null) : null;
  const payload = await buildCreateRecordPayload({
    ...action,
    createRecord,
  }, {
    caseDetail,
    salesOrderId,
    intercompanySalesOrderId: intercompany?.id || "",
    sourceRecord: createRecord.sourceRecord || "storeSalesOrder",
    checks,
    answers,
  }, userId);

  if (!payload.customer && caseDetail.customerId) {
    payload.customer = { id: caseDetail.customerId };
  }
  if (!payload.paymentOption && !payload.paymentoption && !payload.paymentmethod && !payload.paymentMethod) {
    const refundMethodId = workflowAnswerValueByLabel(answers, /refund method/i);
    if (refundMethodId) {
      payload.paymentMethod = customerRefundMethodInteger(refundMethodId) ?? refundMethodId;
    }
  }

  const mappingDebug = payload.__debugMappings || [];
  logCreateRecordDebug("refund credit memo resolved mappings", {
    caseId,
    actionNodeId: action.nodeId || "",
    sourceRecord: createRecord.sourceRecord || "",
    answers,
    mappings: mappingDebug,
  });

  let created;
  let createPayload = payload;
  let deferredPayload = null;
  try {
    const candidateCredits = await getCreditMemoCandidatesForRefund({
      customerId: caseDetail.customerId,
    }, userId);
    const createResult = await createRecordWithOptionalStaging(config, payload, "customerRefund", userId, {
      refundSource: "creditMemo",
      salesOrderId,
      refundAmount: workflowAnswerValueByLabel(answers, /refund amount/i),
      candidateCredits,
      creditAllocations: action.creditAllocations,
    });
    created = createResult.created;
    createPayload = createResult.createPayload || payload;
    deferredPayload = createResult.deferredPayload || null;
  } catch (err) {
    err.workflowDebug = {
      ...(err.workflowDebug || {}),
      createRecordTarget: "customerRefund",
      refundSource: "creditMemo",
      payload,
      createPayload,
      deferredPayload,
      mappings: mappingDebug,
    };
    throw err;
  }

  const id = cleanDraftValue(created.id);
  if (created.needsInput) {
    return {
      created,
      payload,
      mappingDebug,
      createPayload,
      deferredPayload,
      needsInput: created.needsInput,
      document: { id: "", number: "", url: "" },
    };
  }

  const documentNumber = cleanDraftValue(created.tranId || created.tranid) || id;
  return {
    created,
    payload,
    mappingDebug,
    createPayload,
    deferredPayload,
    document: {
      id,
      number: documentNumber,
      url: id ? `${netSuiteAppBaseUrl().replace(/\/$/, "")}/app/accounting/transactions/custrfnd.nl?id=${encodeURIComponent(id)}` : "",
    },
  };
}

async function updateSupportCaseStatus(caseId, statusId, userId) {
  const id = cleanDraftValue(caseId);
  const cleanStatusId = cleanDraftValue(statusId);
  if (!/^\d+$/.test(id)) throw new Error("Valid case ID is required");
  if (!cleanStatusId) throw new Error("Case status is required");
  const payload = {};
  addRefField(payload, "status", cleanStatusId);
  await nsPatch(`/supportCase/${encodeURIComponent(id)}`, payload, userId);
  return { id, statusId: cleanStatusId };
}

function latestWorkflowActionItemId(checks = []) {
  const list = Array.isArray(checks) ? checks.slice().reverse() : [];
  for (const check of list) {
    const sourceItem = check?.source?.itemId;
    const caseItem = check?.case?.itemId;
    const itemId = Number(sourceItem || caseItem);
    if (Number.isFinite(itemId) && itemId > 0) return itemId;
  }
  return null;
}

async function resolveWorkflowActionLine({ caseId, actionType, checks }, userId) {
  const source = actionType === "closeIntercompanyLine" ? "intercompanySalesOrder" : "storeSalesOrder";
  const itemId = latestWorkflowActionItemId(checks);
  if (itemId) return loadInputItemSalesOrderLineForCase(caseId, itemId, userId, source);
  return loadAffectedItemSalesOrderLineForCase(caseId, userId, source);
}

function workflowAnswerPrimaryValue(answers = [], inputNodeId = "") {
  const step = (Array.isArray(answers) ? answers : []).find((item) => String(item.questionId) === String(inputNodeId));
  if (!step) return "";
  const values = step.answers && typeof step.answers === "object" ? Object.values(step.answers) : [];
  return cleanDraftValue(values.find((value) => cleanDraftValue(value)) || step.answer);
}

function coerceWorkflowLineValue(value) {
  if (typeof value === "number" || typeof value === "boolean") return value;
  const raw = cleanDraftValue(value);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (/^(true|t|yes|y|checked|check|on)$/i.test(raw)) return true;
  if (/^(false|f|no|n|unchecked|uncheck|off)$/i.test(raw)) return false;
  return raw;
}

async function itemLinePatchFromMappings(mappings = [], context = {}, userId) {
  const patch = {};
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const field = cleanDraftValue(mapping.field || mapping.targetField);
    if (!field) continue;
    const value = mapping.sourceType || mapping.mode
      ? await resolveCreateRecordMappingValue(mapping, context, userId)
      : (mapping.value ?? mapping.staticValue);
    const coerced = coerceMappedValueForTarget(value, mapping);
    if (coerced === "") continue;
    let finalValue = typeof coerced === "object" && coerced && Object.prototype.hasOwnProperty.call(coerced, "id")
      ? coerced
      : coerceWorkflowLineValue(coerced);
    if (isAmountLikeLineField(field) && typeof finalValue === "number") {
      finalValue = Math.abs(finalValue);
    }
    patch[field] = finalValue;
  }
  return patch;
}

async function patchSalesOrderItemLineFields(salesOrderId, targetLine, patch, userId) {
  const cleanSalesOrderId = cleanDraftValue(salesOrderId);
  if (!cleanSalesOrderId) throw new Error("Missing Sales Order ID for item line action.");
  if (!patch || !Object.keys(patch).length) throw new Error("No item line field mappings were configured.");

  const line = targetLine && typeof targetLine === "object" ? targetLine : {};
  const wantedLineId = cleanDraftValue(line.lineId || line.lineid);
  const wantedItemId = cleanDraftValue(line.itemId || line.item);
  const wantedLineUniqueKey = cleanDraftValue(line.lineUniqueKey || line.lineuniquekey);
  const wantedSequence = Number(rowValue(line, "linesequencenumber", "LINESEQUENCENUMBER", "sequence"));
  const wantedIndex = Number.isFinite(Number(line.index))
    ? Number(line.index)
    : Number.isFinite(wantedSequence) && wantedSequence > 0
      ? wantedSequence - 1
      : null;

  if (!wantedLineId && !wantedItemId && wantedIndex === null && !wantedLineUniqueKey) {
    throw new Error("Missing Sales Order line details for item line action.");
  }

  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const buildRestletHeaders = async () => ({
    ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
    "Content-Type": "application/json",
  });
  const payload = {
    id: cleanSalesOrderId,
    recordType: "salesOrder",
    optionsOnly: true,
    commit: false,
    lines: [
      {
        ...patch,
        lineId: wantedLineId,
        suiteQlLineId: wantedLineId,
        lineUniqueKey: wantedLineUniqueKey,
        lineIndex: wantedIndex,
        itemId: wantedItemId,
      },
    ],
    deletedLineIds: [],
    headerUpdates: {},
  };

  const { response, text, data } = await postRestletWithRecordChangedRetry(
    restletUrl,
    buildRestletHeaders,
    JSON.stringify(payload),
    "Patch Sales Order line",
    { maxAttempts: 5, baseDelayMs: 750 }
  );

  if (!response.ok || !data?.ok) {
    const failure = Array.isArray(data?.failures) ? data.failures[0] : null;
    const err = new Error(failure?.error || data?.error || text || "NetSuite RESTlet failed to update Sales Order line.");
    err.responseBody = data || text;
    throw err;
  }

  const updatedLine = Array.isArray(data.updatedLines) ? data.updatedLines[0] : null;
  cacheDeleteSalesOrder(cleanSalesOrderId);
  return {
    result: data,
    endpoint: "RESTlet salesOrder optionsOnly",
    patch,
    matchedRestLine: updatedLine || null,
  };
}

function uniqueCreditCandidates(candidates = []) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : [])
    .filter((credit) => {
      const id = cleanDraftValue(credit.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

async function addSalesOrderItemLineFields(salesOrderId, patch, userId) {
  const cleanSalesOrderId = cleanDraftValue(salesOrderId);
  if (!cleanSalesOrderId) throw new Error("Missing Sales Order ID for add item line action.");
  if (!patch || !Object.keys(patch).length) throw new Error("No item line field mappings were configured.");

  const mappedItem = patch.itemId || patch.item;
  const itemId = cleanDraftValue(mappedItem && typeof mappedItem === "object" ? mappedItem.id || mappedItem.value : mappedItem);
  if (!itemId) throw new Error("Add Item Line requires a mapped Item field.");

  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const buildRestletHeaders = async () => ({
    ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
    "Content-Type": "application/json",
  });
  const payload = {
    id: cleanSalesOrderId,
    recordType: "salesOrder",
    optionsOnly: false,
    commit: false,
    lines: [
      {
        ...patch,
        itemId,
        isNew: true,
        clientLineKey: `workflow_add_${Date.now()}`,
      },
    ],
    deletedLineIds: [],
    headerUpdates: {},
  };

  const { response, text, data } = await postRestletWithRecordChangedRetry(
    restletUrl,
    buildRestletHeaders,
    JSON.stringify(payload),
    "Add Sales Order line",
    { maxAttempts: 5, baseDelayMs: 750 }
  );

  if (!response.ok || !data?.ok) {
    const failure = Array.isArray(data?.failures) ? data.failures[0] : null;
    const err = new Error(failure?.error || data?.error || text || "NetSuite RESTlet failed to add Sales Order line.");
    err.responseBody = data || text;
    throw err;
  }

  const updatedLine = Array.isArray(data.updatedLines) ? data.updatedLines[0] : null;
  cacheDeleteSalesOrder(cleanSalesOrderId);
  return {
    result: data,
    endpoint: "RESTlet salesOrder add line",
    patch,
    matchedRestLine: updatedLine || null,
  };
}

async function patchPurchaseOrderItemLineFields(purchaseOrderId, targetLine, patch, userId) {
  const cleanPurchaseOrderId = String(purchaseOrderId || "").trim();
  const line = targetLine && typeof targetLine === "object"
    ? targetLine
    : { lineId: String(targetLine || "").trim() };
  const wantedLineId = String(line.lineId || line.lineid || "").trim();
  const wantedItemId = String(line.itemId || line.item || "").trim();
  const wantedLineUniqueKey = String(line.lineUniqueKey || line.lineuniquekey || "").trim();
  const wantedSequence = Number(line.linesequencenumber || line.sequence || "");
  const wantedIndex = Number.isFinite(Number(line.index))
    ? Number(line.index)
    : Number.isFinite(wantedSequence) && wantedSequence > 0
      ? wantedSequence - 1
      : null;

  if (!cleanPurchaseOrderId || (!wantedLineId && !wantedItemId && wantedIndex === null)) {
    throw new Error("Missing Purchase Order line details for item line action.");
  }
  if (!patch || !Object.keys(patch).length) {
    throw new Error("No item line field mappings were configured.");
  }

  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const buildRestletHeaders = async () => ({
    ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
    "Content-Type": "application/json",
  });
  const payload = {
    id: cleanPurchaseOrderId,
    recordType: "purchaseOrder",
    optionsOnly: true,
    commit: false,
    lines: [
      {
        ...patch,
        lineId: wantedLineId,
        suiteQlLineId: wantedLineId,
        lineUniqueKey: wantedLineUniqueKey,
        lineIndex: wantedIndex,
        itemId: wantedItemId,
      },
    ],
    deletedLineIds: [],
    headerUpdates: {},
  };

  const { response, text, data } = await postRestletWithRecordChangedRetry(
    restletUrl,
    buildRestletHeaders,
    JSON.stringify(payload),
    "Patch Purchase Order line",
    { maxAttempts: 5, baseDelayMs: 750 }
  );

  if (!response.ok || !data?.ok) {
    const failure = Array.isArray(data?.failures) ? data.failures[0] : null;
    throw new Error(failure?.error || data?.error || text || "NetSuite RESTlet failed to update Purchase Order line.");
  }

  const updatedLine = Array.isArray(data.updatedLines) ? data.updatedLines[0] : null;
  return {
    result: data,
    endpoint: "RESTlet purchaseOrder optionsOnly",
    lineId: wantedLineId || updatedLine?.lineId || "",
    itemId: wantedItemId || updatedLine?.itemId || "",
    matchedRestLine: updatedLine,
    patch,
  };
}

async function executeItemLineAction({ caseId, action, checks = [], answers = [] }, userId) {
  const config = action.itemLineAction && typeof action.itemLineAction === "object" ? action.itemLineAction : {};
  const target = ["intercompanySalesOrder", "supplierPurchaseOrder"].includes(config.target || config.source)
    ? (config.target || config.source)
    : "storeSalesOrder";
  const inputItemId = config.itemSource === "input" ? workflowAnswerPrimaryValue(answers, config.inputNodeId) : "";
  const caseDetail = await getSupportCaseDetail(caseId, userId);
  const salesOrderId = cleanDraftValue(caseDetail.salesOrderId);
  const intercompanySalesOrder = await getPairedIntercompanySalesOrderId(Number(salesOrderId), userId).catch(() => null);
  const mappingContext = {
    caseDetail,
    salesOrderId,
    intercompanySalesOrderId: intercompanySalesOrder?.id || "",
    sourceRecord: config.sourceRecord || "storeSalesOrder",
    answers,
  };

  if (target === "supplierPurchaseOrder") {
    const resolved = await loadSupplierPurchaseOrderLineForCase(caseId, userId, checks, inputItemId);
    const patch = await itemLinePatchFromMappings(config.mappings, { ...mappingContext, line: resolved.line }, userId);
    console.log("[workflow-item-line-action] resolved patch", {
      caseId,
      nodeId: action.nodeId || "",
      target,
      itemSource: config.itemSource || "caseAffectedItem",
      inputItemId,
      patch,
      mappings: Array.isArray(config.mappings)
        ? config.mappings.map((mapping) => ({
          targetField: mapping.targetField || mapping.field || "",
          targetFieldType: mapping.targetFieldType || "",
          valueCast: mapping.valueCast || "",
          mode: mapping.mode || "",
          staticValue: mapping.staticValue,
          calculationExpression: mapping.calculationExpression,
          sourceType: mapping.sourceType || "",
          sourceField: mapping.sourceField || "",
        }))
        : [],
    });
    const patchResult = await patchPurchaseOrderItemLineFields(resolved.source.supplierPurchaseOrderId, resolved.line, patch, userId);
    return {
      patchResult,
      source: resolved.source,
      line: resolved.line,
      patch,
      document: resolved.document,
    };
  }

  const resolved = inputItemId
    ? await loadInputItemSalesOrderLineForCase(caseId, inputItemId, userId, target, config.mappings)
    : await loadAffectedItemSalesOrderLineForCase(caseId, userId, target, config.mappings);
  const patch = await itemLinePatchFromMappings(config.mappings, { ...mappingContext, line: resolved.line }, userId);
  console.log("[workflow-item-line-action] resolved patch", {
    caseId,
    nodeId: action.nodeId || "",
    target,
    itemSource: config.itemSource || "caseAffectedItem",
    inputItemId,
    patch,
    mappings: Array.isArray(config.mappings)
      ? config.mappings.map((mapping) => ({
        targetField: mapping.targetField || mapping.field || "",
        targetFieldType: mapping.targetFieldType || "",
        valueCast: mapping.valueCast || "",
        mode: mapping.mode || "",
        staticValue: mapping.staticValue,
        calculationExpression: mapping.calculationExpression,
        sourceType: mapping.sourceType || "",
        sourceField: mapping.sourceField || "",
      }))
      : [],
  });
  const patchResult = await patchSalesOrderItemLineFields(resolved.source.checkedSalesOrderId, resolved.line, patch, userId);
  const document = await getSalesOrderDocumentInfo(resolved.source.checkedSalesOrderId, userId);
  return {
    patchResult,
    source: resolved.source,
    line: resolved.line,
    patch,
    document,
  };
}

async function executeAddItemLineAction({ caseId, action, answers = [] }, userId) {
  const config = action.itemLineAction && typeof action.itemLineAction === "object" ? action.itemLineAction : {};
  const target = (config.target || config.source) === "intercompanySalesOrder" ? "intercompanySalesOrder" : "storeSalesOrder";
  const caseDetail = await getSupportCaseDetail(caseId, userId);
  const salesOrderId = cleanDraftValue(caseDetail.salesOrderId);
  const intercompanySalesOrder = target === "intercompanySalesOrder"
    ? await getPairedIntercompanySalesOrderId(Number(salesOrderId), userId)
    : null;
  const targetSalesOrderId = target === "intercompanySalesOrder" ? intercompanySalesOrder?.id : salesOrderId;
  if (!targetSalesOrderId) {
    throw new Error(target === "intercompanySalesOrder"
      ? "No paired Sales Order was found for this case."
      : "No Sales Order was found for this case.");
  }

  const mappingContext = {
    caseDetail,
    salesOrderId,
    intercompanySalesOrderId: intercompanySalesOrder?.id || "",
    sourceRecord: config.sourceRecord || "storeSalesOrder",
    answers,
    line: {},
  };
  const patch = await itemLinePatchFromMappings(config.mappings, mappingContext, userId);
  console.log("[workflow-add-item-line] resolved patch", {
    caseId,
    nodeId: action.nodeId || "",
    target,
    patch,
    mappingCount: Array.isArray(config.mappings) ? config.mappings.length : 0,
  });
  const patchResult = await addSalesOrderItemLineFields(targetSalesOrderId, patch, userId);
  const document = await getSalesOrderDocumentInfo(targetSalesOrderId, userId);
  return {
    patchResult,
    source: {
      ...caseDetail,
      checkedSalesOrderId: targetSalesOrderId,
      checkedSalesOrderDocumentNumber: document.documentNumber || document.number || "",
      checkedSalesOrderUrl: document.url || salesOrderNetSuiteUrl(targetSalesOrderId),
    },
    line: patchResult.matchedRestLine || {},
    patch,
    document,
  };
}

async function executeEmailAction({ caseId, action, checks = [] }, userId) {
  const config = action.emailAction && typeof action.emailAction === "object" ? action.emailAction : {};
  const target = config.target === "supplier" ? "supplier" : "customer";
  const message = cleanDraftValue(config.message || action.message);
  if (!message) throw new Error("Email action message is required.");

  let recordType = "salesOrder";
  let recordId = "";
  let document = null;

  if (target === "supplier") {
    const resolved = await loadSupplierPurchaseOrderLineForCase(caseId, userId, checks);
    recordType = "purchaseOrder";
    recordId = cleanDraftValue(resolved.source?.supplierPurchaseOrderId || resolved.document?.id);
    document = resolved.document || await getPurchaseOrderDocumentInfo(recordId, userId);
  } else {
    const caseDetail = await getSupportCaseDetail(caseId, userId);
    recordId = cleanDraftValue(caseDetail.salesOrderId);
    document = await getSalesOrderDocumentInfo(recordId, userId);
  }

  if (!recordId) {
    throw new Error(target === "supplier"
      ? "No Supplier Purchase Order was found for this case."
      : "No Sales Order was found for this case.");
  }

  const patch = {
    message,
    tobeemailed: true,
  };
  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const buildRestletHeaders = async () => ({
    ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
    "Content-Type": "application/json",
  });
  const payload = {
    id: recordId,
    recordType,
    workflowEmailAction: true,
    message,
  };
  const { response, text, data } = await postRestletWithRecordChangedRetry(
    restletUrl,
    buildRestletHeaders,
    JSON.stringify(payload),
    "Trigger workflow email action",
    { maxAttempts: 5, baseDelayMs: 750 }
  );
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || text || `NetSuite RESTlet failed to update ${recordType} email fields.`);
  }
  return {
    target,
    recordType,
    recordId,
    patch,
    result: data,
    document: {
      id: String(recordId),
      number: String(document?.number || document?.documentNumber || document?.tranId || recordId),
      url: document?.url || (
        recordType === "purchaseOrder"
          ? `${netSuiteAppBaseUrl().replace(/\/$/, "")}/app/accounting/transactions/purchord.nl?id=${encodeURIComponent(recordId)}`
          : salesOrderNetSuiteUrl(recordId)
      ),
    },
  };
}

function returnAuthorizationIdFromChecks(checks = []) {
  const matches = (Array.isArray(checks) ? checks : [])
    .filter((check) => {
      const recordType = cleanDraftValue(check.recordType || check.source?.type).toLowerCase();
      return recordType === "returnauthorization" ||
        recordType === "return_authorization" ||
        recordType === "returnauthorisation" ||
        recordType === "return_authorisation";
    });
  const latest = matches[matches.length - 1] || null;
  return cleanDraftValue(latest?.source?.recordId || latest?.data?.id || latest?.data?.ID);
}

async function resolveReturnAuthorizationForCase(caseId, checks = [], userId) {
  const checkedId = returnAuthorizationIdFromChecks(checks);
  if (checkedId) return { id: checkedId, source: "check" };
  const caseDetail = await getSupportCaseDetail(caseId, userId);
  const candidates = await getWorkflowCheckRecordCandidates({
    recordType: "returnAuthorization",
    salesOrderId: caseDetail.salesOrderId,
  }, userId);
  if (candidates.length === 1) return { ...candidates[0], source: "lookup" };
  if (candidates.length > 1) {
    const err = new Error("Multiple Return Authorisations were found. Run a Return Authorisation check first so the workflow knows which RMA to credit.");
    err.responseBody = { candidates };
    throw err;
  }
  throw new Error("No Return Authorisation was found to credit.");
}

function workflowLotAssignmentsFromLine(line = {}) {
  const quantity = Number(rowValue(line, "quantity", "QUANTITY") || 0) || 1;
  const itemId = cleanDraftValue(rowValue(line, "item", "ITEM"));
  const lineId = cleanDraftValue(rowValue(line, "lineid", "LINEID", "id", "ID"));
  const inventoryMeta = cleanDraftValue(rowValue(line, "custcol_sb_epos_inventory_meta", "CUSTCOL_SB_EPOS_INVENTORY_META"));
  const lotDetails = fillMissingLotDetailLocations(
    rowValue(line, "custcol_sb_lot_details", "CUSTCOL_SB_LOT_DETAILS"),
    inventoryMeta
  );
  const detailParts = inventoryMeta
    ? String(inventoryMeta).split(";").map((part) => parseInventoryDetailPart(part))
    : [];
  const lotParts = lotDetails
    ? String(lotDetails).split(";").map((part) => {
        const tokens = String(part || "").split("|");
        return {
          locationId: cleanDraftValue(tokens[0]),
          statusId: cleanDraftValue(tokens[1]),
          inventoryNumberId: cleanDraftValue(tokens[2]),
        };
      })
    : [];
  const assignments = (detailParts.length ? detailParts : lotParts).map((part, index) => {
    const detail = detailParts[index] || {};
    const lot = lotParts[index] || {};
    return {
      itemId,
      sourceLineId: lineId,
      quantity: Number(detail.qty || quantity) || quantity,
      locationId: cleanDraftValue(detail.locationId || lot.locationId),
      inventoryStatusId: cleanDraftValue(detail.statusId || lot.statusId),
      inventoryNumberId: cleanDraftValue(detail.inventoryNumberId || lot.inventoryNumberId),
      inventoryNumberName: cleanDraftValue(detail.inventoryNumberName),
    };
  });
  return assignments.filter((assignment) => assignment.itemId && assignment.inventoryNumberId);
}

async function enrichWorkflowLotAssignmentNames(assignments = [], userId) {
  const source = Array.isArray(assignments) ? assignments : [];
  const missingNameIds = source
    .filter((assignment) => assignment.inventoryNumberId && !assignment.inventoryNumberName)
    .map((assignment) => assignment.inventoryNumberId);
  const inventoryNumberNameById = await suiteQlIdNameMap({
    table: "inventorynumber",
    ids: missingNameIds,
    nameExpression: "inventorynumber",
    userId,
  });
  return source.map((assignment) => ({
    ...assignment,
    inventoryNumberName: assignment.inventoryNumberName || inventoryNumberNameById[String(assignment.inventoryNumberId || "").trim()] || "",
  }));
}

async function pairedSalesOrderLotAssignmentsForCase(caseId, userId) {
  const caseDetail = await getSupportCaseDetail(caseId, userId);
  const salesOrderId = Number(caseDetail.salesOrderId);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    throw new Error("Case does not have a related sales order.");
  }
  const paired = await getPairedIntercompanySalesOrderId(salesOrderId, userId);
  const result = await fetchSalesOrderLineSuiteQl(paired.id, userId);
  const rows = Array.isArray(result?.items) ? result.items : [];
  const assignments = await enrichWorkflowLotAssignmentNames(
    rows.flatMap((line) => workflowLotAssignmentsFromLine(line)),
    userId
  );
  return {
    pairedSalesOrder: paired,
    assignments,
    source: assignments.length ? "suiteql" : "restlet-inventorydetail",
  };
}

async function executeCreditRmaAction({ caseId, action, checks = [] }, userId) {
  const rma = await resolveReturnAuthorizationForCase(caseId, checks, userId);
  const returnAuthorizationId = cleanDraftValue(rma.id);
  if (!returnAuthorizationId) throw new Error("Return Authorisation ID is required to create the Credit Memo.");
  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const result = await nsRestlet(restletUrl, {
    action: "creditReturnAuthorization",
    returnAuthorizationId,
    memo: action.response || action.message || "",
  }, userId, "POST");
  if (!result || result.ok === false) {
    const err = new Error(result?.error || result?.message || "Credit RMA RESTlet failed.");
    err.responseBody = result || null;
    throw err;
  }
  const id = cleanDraftValue(result.id);
  const number = cleanDraftValue(result.tranId || result.tranid || id);
  return {
    created: result,
    returnAuthorization: rma,
    document: {
      id,
      number,
      url: id ? `${netSuiteAppBaseUrl().replace(/\/$/, "")}/app/accounting/transactions/custcred.nl?id=${encodeURIComponent(id)}` : "",
    },
  };
}

async function executeReceiveRmaAction({ caseId, action, checks = [] }, userId) {
  const rma = await resolveReturnAuthorizationForCase(caseId, checks, userId);
  const returnAuthorizationId = cleanDraftValue(rma.id);
  if (!returnAuthorizationId) throw new Error("Return Authorisation ID is required to create the Item Receipt.");
  const lotSource = await pairedSalesOrderLotAssignmentsForCase(caseId, userId);
  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const result = await nsRestlet(restletUrl, {
    action: "receiveReturnAuthorization",
    returnAuthorizationId,
    memo: action.response || action.message || "",
    lotAssignments: lotSource.assignments,
    pairedSalesOrderId: lotSource.pairedSalesOrder.id,
  }, userId, "POST");
  if (!result || result.ok === false) {
    const err = new Error(result?.error || result?.message || "Receive RMA RESTlet failed.");
    err.responseBody = result || null;
    throw err;
  }
  const id = cleanDraftValue(result.id);
  const number = cleanDraftValue(result.tranId || result.tranid || id);
  return {
    created: result,
    returnAuthorization: rma,
    pairedSalesOrder: lotSource.pairedSalesOrder,
    lotAssignments: lotSource.assignments,
    document: {
      id,
      number,
      url: id ? `${netSuiteAppBaseUrl().replace(/\/$/, "")}/app/accounting/transactions/itemrcpt.nl?id=${encodeURIComponent(id)}` : "",
    },
  };
}

async function getPurchaseOrderDocumentInfo(purchaseOrderId, userId) {
  const id = Number(purchaseOrderId);
  if (!Number.isFinite(id) || id <= 0) return { id: String(purchaseOrderId || ""), documentNumber: "", url: "" };
  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT
          id,
          tranid,
          BUILTIN.DF(id) AS documentname
        FROM transaction
        WHERE id = ${id}
      `,
    },
    userId
  );
  const row = Array.isArray(result?.items) ? result.items[0] : null;
  const documentNumber = normaliseTransactionDocumentNumber(
    rowValue(row, "tranid", "documentnumber", "documentname", "name"),
    id
  );
  return {
    id: String(id),
    documentNumber,
    name: cleanDraftValue(rowValue(row, "documentname", "name") || documentNumber),
    url: `${netSuiteAppBaseUrl().replace(/\/$/, "")}/app/accounting/transactions/purchord.nl?id=${encodeURIComponent(id)}`,
  };
}

async function closePurchaseOrderLineViaRestlet(purchaseOrderId, targetLine, userId) {
  const cleanPurchaseOrderId = String(purchaseOrderId || "").trim();
  const line = targetLine && typeof targetLine === "object"
    ? targetLine
    : { lineId: String(targetLine || "").trim() };
  const wantedLineId = String(line.lineId || line.lineid || "").trim();
  const wantedItemId = String(line.itemId || line.item || "").trim();
  const wantedLineUniqueKey = String(line.lineUniqueKey || line.lineuniquekey || "").trim();
  const wantedSequence = Number(line.linesequencenumber || line.sequence || "");
  const wantedIndex = Number.isFinite(Number(line.index))
    ? Number(line.index)
    : Number.isFinite(wantedSequence) && wantedSequence > 0
      ? wantedSequence - 1
      : null;

  if (!cleanPurchaseOrderId || (!wantedLineId && !wantedItemId && wantedIndex === null)) {
    throw new Error("Missing Purchase Order line details for close line action.");
  }

  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const buildRestletHeaders = async () => ({
    ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
    "Content-Type": "application/json",
  });
  const payload = {
    id: cleanPurchaseOrderId,
    recordType: "purchaseOrder",
    optionsOnly: true,
    commit: false,
    lines: [
      {
        lineId: wantedLineId,
        suiteQlLineId: wantedLineId,
        lineUniqueKey: wantedLineUniqueKey,
        lineIndex: wantedIndex,
        itemId: wantedItemId,
        closed: true,
      },
    ],
    deletedLineIds: [],
    headerUpdates: {},
  };

  const { response, text, data } = await postRestletWithRecordChangedRetry(
    restletUrl,
    buildRestletHeaders,
    JSON.stringify(payload),
    "Close Purchase Order line",
    { maxAttempts: 5, baseDelayMs: 750 }
  );

  if (!response.ok || !data?.ok) {
    const failure = Array.isArray(data?.failures) ? data.failures[0] : null;
    throw new Error(failure?.error || data?.error || text || "NetSuite RESTlet failed to close Purchase Order line.");
  }

  const updatedLine = Array.isArray(data.updatedLines) ? data.updatedLines[0] : null;
  if (!updatedLine) {
    throw new Error("NetSuite did not confirm which Purchase Order line was closed.");
  }

  return {
    result: data,
    endpoint: "RESTlet purchaseOrder optionsOnly",
    lineId: wantedLineId || updatedLine.lineId || "",
    itemId: wantedItemId || updatedLine.itemId || "",
    matchedRestLine: updatedLine,
    patch: { closed: true },
  };
}

function purchaseOrderIdFromCreatePo(line = {}) {
  const value = rowValue(line, "createpo", "CREATEPO");
  const numeric = Number(refId(value) || value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function suiteQlString(value = "") {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

async function resolvePurchaseOrderFromCreatePoValue(value, userId) {
  const raw = cleanDraftValue(refId(value) || value);
  const display = cleanDraftValue(refName(value));
  const numeric = Number(raw || display);
  if (Number.isFinite(numeric) && numeric > 0) {
    return { id: numeric, name: display || raw };
  }

  const candidates = Array.from(new Set([
    raw,
    display,
    normaliseTransactionDocumentNumber(raw),
    normaliseTransactionDocumentNumber(display),
  ].map(cleanDraftValue).filter(Boolean)));
  if (!candidates.length) return null;

  const where = candidates.map((candidate) => {
    const valueSql = suiteQlString(candidate);
    return `UPPER(t.tranid) = UPPER(${valueSql}) OR UPPER(BUILTIN.DF(t.id)) = UPPER(${valueSql})`;
  }).join(" OR ");
  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT
          t.id,
          t.tranid,
          BUILTIN.DF(t.id) AS documentname
        FROM transaction t
        WHERE t.type = 'PurchOrd'
          AND (${where})
        ORDER BY t.id DESC
      `,
    },
    userId
  );
  const row = Array.isArray(result?.items) ? result.items[0] : null;
  const id = Number(rowValue(row, "id", "ID"));
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    name: cleanDraftValue(rowValue(row, "tranid", "documentname", "name") || candidates[0]),
  };
}

async function loadCreatePoForSalesOrderLine({ salesOrderId, line, itemId }, userId) {
  const numericSalesOrderId = Number(salesOrderId);
  const numericItemId = Number(itemId || rowValue(line, "item", "ITEM"));
  const numericLineId = Number(rowValue(line, "lineid", "LINEID", "id", "ID"));
  if (!Number.isFinite(numericSalesOrderId) || numericSalesOrderId <= 0) {
    throw new Error("Could not resolve the paired Sales Order for Supplier Purchase Order lookup.");
  }
  if (!Number.isFinite(numericItemId) || numericItemId <= 0) {
    throw new Error("Could not resolve the item for Supplier Purchase Order lookup.");
  }
  const lineFilter = Number.isFinite(numericLineId) && numericLineId > 0
    ? `AND tl.id = ${numericLineId}`
    : `AND tl.item = ${numericItemId}`;
  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT
          tl.createdpo AS createpo,
          BUILTIN.DF(tl.createdpo) AS createponame
        FROM transactionline tl
        WHERE tl.transaction = ${numericSalesOrderId}
          ${lineFilter}
          AND tl.mainline = 'F'
          AND tl.taxline = 'F'
        ORDER BY tl.linesequencenumber
      `,
    },
    userId
  );
  const row = Array.isArray(result?.items) ? result.items[0] : null;
  const purchaseOrder = await resolvePurchaseOrderFromCreatePoValue(
    rowValue(row, "createpo", "CREATEPO") || rowValue(row, "createponame", "CREATEPONAME"),
    userId
  );
  if (!purchaseOrder?.id) {
    throw new Error("The matching paired Sales Order line does not have a Supplier Purchase Order in createpo.");
  }
  return {
    id: purchaseOrder.id,
    name: purchaseOrder.name || cleanDraftValue(rowValue(row, "createponame", "CREATEPONAME")),
  };
}

function normaliseItemMatchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function workflowPoLineFromRestLine(line = {}) {
  const raw = line.raw || {};
  const itemValue = raw.item && typeof raw.item === "object" ? raw.item : {};
  return {
    lineid: line.lineId || line.line || line.lineUniqueKey || "",
    item: line.itemId || itemValue.id || raw.itemId || raw.itemid || "",
    itemname: itemValue.refName || itemValue.name || raw.itemName || raw.itemname || raw.displayName || raw.displayname || "",
    quantity: raw.quantity ?? raw.QUANTITY ?? "",
    rate: raw.rate ?? raw.RATE ?? "",
    amount: raw.amount ?? raw.AMOUNT ?? raw.netamount ?? raw.NETAMOUNT ?? "",
    linesequencenumber: Number.isFinite(Number(line.index)) ? Number(line.index) + 1 : "",
    index: line.index,
    endpoint: line.endpoint,
    lineId: line.lineId,
    itemId: line.itemId,
    raw,
  };
}

function decodeXmlText(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function xmlTagValue(xml = "", tag = "") {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlText(match[1]).trim() : "";
}

function parsePurchaseOrderXmlItemLines(xml = "") {
  const machineMatch = String(xml || "").match(/<machine\b[^>]*name=["']item["'][^>]*>([\s\S]*?)<\/machine>/i);
  if (!machineMatch) return [];
  const lines = [];
  const lineRegex = /<line>([\s\S]*?)<\/line>/gi;
  let match;
  while ((match = lineRegex.exec(machineMatch[1]))) {
    const lineXml = match[1];
    lines.push({
      lineid: xmlTagValue(lineXml, "id"),
      lineuniquekey: xmlTagValue(lineXml, "lineuniquekey"),
      item: xmlTagValue(lineXml, "item"),
      itemname: xmlTagValue(lineXml, "item_display") || xmlTagValue(lineXml, "custcol_sb_itemdisplayname") || xmlTagValue(lineXml, "custcol_sb_parentitemname"),
      quantity: xmlTagValue(lineXml, "quantity"),
      rate: xmlTagValue(lineXml, "rate"),
      amount: xmlTagValue(lineXml, "amount"),
      linesequencenumber: xmlTagValue(lineXml, "line"),
      isclosed: xmlTagValue(lineXml, "isclosed"),
      rawXml: lineXml,
    });
  }
  return lines;
}

async function getPurchaseOrderXmlItemLines(purchaseOrderId, userId) {
  const id = String(purchaseOrderId || "").trim();
  if (!id) return [];
  const base = netSuiteAppBaseUrl().replace(/\/$/, "");
  const url = `${base}/app/accounting/transactions/purchord.nl?id=${encodeURIComponent(id)}&xml=t`;
  try {
    const headers = await getAuthHeader(url, "GET", userId);
    const response = await fetch(url, { method: "GET", headers });
    const text = await response.text();
    if (!response.ok) {
      console.warn("[workflow-actions] Purchase Order XML fallback failed:", response.status, text.slice(0, 300));
      return [];
    }
    const lines = parsePurchaseOrderXmlItemLines(text);
    if (!lines.length) {
      console.warn("[workflow-actions] Purchase Order XML fallback returned no item machine lines.", {
        purchaseOrderId: id,
        hasItemMachine: /<machine\b[^>]*name=["']item["']/i.test(text),
      });
    }
    return lines;
  } catch (err) {
    console.warn("[workflow-actions] Purchase Order XML fallback failed:", err.message || err);
    return [];
  }
}

function extractRestItemSublistLines(record = {}) {
  const candidates = [
    record?.item?.items,
    record?.item,
    record?.items,
    record?.itemList?.items,
    record?.itemList,
    record?.sublists?.item?.items,
    record?.sublists?.item,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

async function getExpandedRestTransactionItemLines(recordType, transactionId, userId) {
  const cleanRecordType = String(recordType || "").trim();
  const cleanTransactionId = String(transactionId || "").trim();
  if (!cleanRecordType || !cleanTransactionId) return [];
  const record = await nsGet(
    `/${cleanRecordType}/${encodeURIComponent(cleanTransactionId)}?expandSubResources=true`,
    userId
  ).catch((err) => {
    console.warn(`[workflow-actions] Expanded ${cleanRecordType} item lines fallback failed:`, err.message || err);
    return null;
  });
  const lines = extractRestItemSublistLines(record);
  return lines.map((line, index) => ({
    raw: line,
    index,
    endpoint: sublistLineSelfEndpoint(line) || `/${cleanRecordType}/${encodeURIComponent(cleanTransactionId)}/item/${encodeURIComponent(line?.id || index)}`,
    itemId: String(
      line?.item?.id ||
        line?.item ||
        line?.itemId ||
        line?.itemid ||
        ""
    ).trim(),
    lineId: String(line?.id || line?.line || line?.lineuniquekey || line?.lineUniqueKey || "").trim(),
    line: String(line?.line || "").trim(),
    lineUniqueKey: String(line?.lineuniquekey || line?.lineUniqueKey || "").trim(),
  }));
}

async function loadPurchaseOrderItemLinesForWorkflow(purchaseOrderId, userId) {
  const id = Number(purchaseOrderId);
  if (!Number.isFinite(id) || id <= 0) return [];
  const queries = [
    `
      SELECT
        tl.id AS lineid,
        tl.item,
        BUILTIN.DF(tl.item) AS itemname,
        tl.quantity,
        tl.rate,
        tl.netamount AS amount,
        tl.linesequencenumber
      FROM transactionline tl
      WHERE tl.transaction = ${id}
        AND tl.item IS NOT NULL
      ORDER BY tl.linesequencenumber
    `,
    `
      SELECT
        tl.id AS lineid,
        tl.item,
        BUILTIN.DF(tl.item) AS itemname,
        tl.quantity,
        tl.rate,
        tl.netamount AS amount,
        tl.linesequencenumber
      FROM transactionline tl
      WHERE tl.transaction = ${id}
        AND tl.mainline = 'F'
        AND tl.taxline = 'F'
      ORDER BY tl.linesequencenumber
    `,
    `
      SELECT
        tl.id AS lineid,
        tl.item,
        BUILTIN.DF(tl.item) AS itemname,
        tl.quantity,
        tl.rate,
        tl.netamount AS amount,
        tl.linesequencenumber,
        tl.custcol521
      FROM transactionline tl
      WHERE tl.custcol521 = ${id}
        AND tl.item IS NOT NULL
      ORDER BY tl.linesequencenumber
    `,
  ];

  for (const query of queries) {
    try {
      const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
      const rows = Array.isArray(result?.items) ? result.items : [];
      if (rows.length) return rows;
    } catch (err) {
      console.warn("[workflow-actions] Purchase Order line SuiteQL fallback failed:", err.message || err);
    }
  }

  const restLines = await getRestTransactionItemLines("purchaseOrder", id, userId).catch((err) => {
    console.warn("[workflow-actions] Purchase Order REST item lines fallback failed:", err.message || err);
    return [];
  });
  if (restLines.length) return restLines.map(workflowPoLineFromRestLine);

  const expandedRestLines = await getExpandedRestTransactionItemLines("purchaseOrder", id, userId);
  if (expandedRestLines.length) return expandedRestLines.map(workflowPoLineFromRestLine);

  return getPurchaseOrderXmlItemLines(id, userId);
}

function findWorkflowPurchaseOrderLine(lines = [], { targetItemId = "", targetItemName = "" } = {}) {
  const wantedId = String(targetItemId || "").trim();
  const wantedName = normaliseItemMatchText(targetItemName);
  const exactId = lines.find((line) => String(rowValue(line, "item", "ITEM") || line.itemId || "").trim() === wantedId);
  if (exactId) return exactId;
  if (!wantedName) return null;
  return lines.find((line) => {
    const itemName = normaliseItemMatchText(rowValue(line, "itemname", "ITEMNAME") || line.itemName || "");
    return itemName === wantedName || itemName.includes(wantedName) || wantedName.includes(itemName);
  }) || null;
}

async function loadSupplierPurchaseOrderLineForCase(caseId, userId, checks = [], selectedItemId = "") {
  const itemId = cleanDraftValue(selectedItemId) || latestWorkflowActionItemId(checks);
  const { line: pairedLine, source } = itemId
    ? await loadInputItemSalesOrderLineForCase(caseId, itemId, userId, "intercompanySalesOrder")
    : await loadAffectedItemSalesOrderLineForCase(caseId, userId, "intercompanySalesOrder");
  const purchaseOrder = await loadCreatePoForSalesOrderLine({
    salesOrderId: source.checkedSalesOrderId,
    line: pairedLine,
    itemId: rowValue(pairedLine, "item", "ITEM") || source.itemId || itemId,
  }, userId);
  const purchaseOrderId = purchaseOrder.id;

  const targetItemId = String(rowValue(pairedLine, "item", "ITEM") || source.itemId || itemId || "").trim();
  const targetItemNumber = Number(targetItemId);
  if (!Number.isFinite(targetItemNumber) || targetItemNumber <= 0) {
    throw new Error("Could not resolve the item to match on the Supplier Purchase Order.");
  }
  const targetItemName = source.itemName || cleanDraftValue(rowValue(pairedLine, "itemname", "ITEMNAME"));
  const purchaseOrderLines = await loadPurchaseOrderItemLinesForWorkflow(purchaseOrderId, userId);
  const purchaseOrderLine = findWorkflowPurchaseOrderLine(purchaseOrderLines, {
    targetItemId,
    targetItemName,
  });
  if (!purchaseOrderLine) {
    const document = await getPurchaseOrderDocumentInfo(purchaseOrderId, userId);
    const availableItems = purchaseOrderLines.map((row) => ({
      lineId: cleanDraftValue(rowValue(row, "lineid", "LINEID")),
      lineUniqueKey: cleanDraftValue(rowValue(row, "lineuniquekey", "LINEUNIQUEKEY")),
      isClosed: cleanDraftValue(rowValue(row, "isclosed", "ISCLOSED")),
      itemId: cleanDraftValue(rowValue(row, "item", "ITEM")),
      itemName: cleanDraftValue(rowValue(row, "itemname", "ITEMNAME")),
      quantity: cleanDraftValue(rowValue(row, "quantity", "QUANTITY")),
      amount: cleanDraftValue(rowValue(row, "amount", "AMOUNT")),
      lineSequenceNumber: cleanDraftValue(rowValue(row, "linesequencenumber", "LINESEQUENCENUMBER")),
    }));
    const err = new Error("Matching item was not found on the Supplier Purchase Order.");
    err.workflowDebug = {
      supplierPurchaseOrder: {
        id: String(purchaseOrderId),
        documentNumber: document.documentNumber || purchaseOrder.name || String(purchaseOrderId),
        url: document.url,
      },
      expectedItem: {
        id: targetItemId,
        name: targetItemName,
      },
      pairedSalesOrder: {
        id: String(source.checkedSalesOrderId || ""),
        documentNumber: String(source.checkedSalesOrderDocumentNumber || source.checkedSalesOrderName || ""),
        lineId: cleanDraftValue(rowValue(pairedLine, "lineid", "LINEID")),
      },
      availableItems,
    };
    throw err;
  }
  const document = await getPurchaseOrderDocumentInfo(purchaseOrderId, userId);
  return {
    line: normaliseWorkflowLineQuantities(purchaseOrderLine),
    source: {
      ...source,
      type: "supplierPurchaseOrder",
      supplierPurchaseOrderId: purchaseOrderId,
      supplierPurchaseOrderDocumentNumber: document.documentNumber,
      supplierPurchaseOrderUrl: document.url,
      supplierPurchaseOrderName: document.name,
      pairedSalesOrderLine: pairedLine,
      itemId: targetItemId,
      itemName: String(rowValue(purchaseOrderLine, "itemname", "ITEMNAME") || source.itemName || "").trim(),
    },
    document,
  };
}

async function loadLatestWorkflowActions(workflowId, actions = []) {
  const cleanWorkflowId = cleanDraftValue(workflowId);
  const sourceActions = Array.isArray(actions) ? actions : [];
  if (!cleanWorkflowId || !sourceActions.length) return sourceActions;

  try {
    const result = await pool.query("SELECT definition FROM cs_workflows WHERE id = $1 LIMIT 1", [cleanWorkflowId]);
    const definition = result.rows[0]?.definition || {};
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
    if (!nodes.length) return sourceActions;

    return sourceActions.map((action) => {
      const node = nodes.find((item) => String(item.id) === String(action?.nodeId));
      const actionConfig = node?.actionConfig && typeof node.actionConfig === "object" ? node.actionConfig : null;
      if (!actionConfig) return action;
      if (action.actionType === "itemLineAction" || action.actionType === "addItemLine" || actionConfig.type === "itemLineAction" || actionConfig.type === "addItemLine") {
        const actionType = actionConfig.type === "addItemLine" || action.actionType === "addItemLine" ? "addItemLine" : "itemLineAction";
        return {
          ...action,
          actionType,
          itemLineAction: {
            ...(action.itemLineAction || {}),
            ...(actionConfig.itemLineAction || {}),
          },
        };
      }
      if (action.actionType === "createRecord" || action.actionType === "refundCreditMemo" || actionConfig.type === "createRecord" || actionConfig.type === "refundCreditMemo") {
        return {
          ...action,
          actionType: actionConfig.type === "refundCreditMemo" || action.actionType === "refundCreditMemo" ? "refundCreditMemo" : "createRecord",
          createRecord: {
            ...(action.createRecord || {}),
            ...(actionConfig.createRecord || {}),
          },
        };
      }
      if (action.actionType === "creditRma" || action.actionType === "receiveRma" || actionConfig.type === "creditRma" || actionConfig.type === "receiveRma") {
        return {
          ...action,
          actionType: actionConfig.type || action.actionType,
        };
      }
      if (action.actionType === "email" || actionConfig.type === "email") {
        return {
          ...action,
          actionType: "email",
          emailAction: {
            ...(action.emailAction || {}),
            ...(actionConfig.emailAction || {}),
          },
        };
      }
      return action;
    });
  } catch (err) {
    console.warn("[workflow-actions] Could not refresh workflow action config:", err.message);
    return sourceActions;
  }
}

async function executeWorkflowActions({ caseId, workflowId = "", actions = [], approvals = [], checks = [], answers = [] }, userId) {
  const latestActions = await loadLatestWorkflowActions(workflowId, actions);
  const approvedActions = latestActions
    .filter((action, index) => approvals[index] === true || approvals[index] === "true")
    .filter((action) => ["setCaseStatus", "itemLineAction", "addItemLine", "email", "closeSalesLine", "closeIntercompanyLine", "closeSupplierPurchaseOrderLine", "refundCreditMemo", "creditRma", "receiveRma", "createRecord"].includes(action.actionType));

  const results = [];
  for (const action of approvedActions) {
    try {
      if (action.actionType === "setCaseStatus") {
        const statusResult = await updateSupportCaseStatus(caseId, action.statusId, userId);
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: `Case status changed to ${action.statusName || action.statusId}.`,
          result: statusResult,
        });
        continue;
      }

      if (action.actionType === "createRecord") {
        const createResult = await executeCreateRecordAction({ caseId, action, checks, answers }, userId);
        if (createResult.needsInput) {
          results.push({
            ok: false,
            needsInput: createResult.needsInput,
            nodeId: action.nodeId || "",
            label: action.label || workflowActionTypeLabel(action.actionType),
            actionType: action.actionType,
            message: createResult.created?.message || "More information is needed before this action can run.",
            deposits: createResult.created?.deposits || [],
            expectedAmount: createResult.created?.expectedAmount ?? null,
            allocations: createResult.created?.allocations || [],
            debug: {
              payload: createResult.payload,
              createPayload: createResult.createPayload || createResult.payload,
              mappings: createResult.mappingDebug || [],
            },
          });
          continue;
        }
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: createResult.approvalResult?.approved
            ? `${workflowActionTypeLabel(action.actionType)} created and approved ${createResult.document.number || createResult.document.id || "record"}.`
            : `${workflowActionTypeLabel(action.actionType)} created ${createResult.document.number || createResult.document.id || "record"}.`,
          document: createResult.document,
          result: createResult.created,
          debug: {
            payload: createResult.payload,
            createPayload: createResult.createPayload || createResult.payload,
            deferredPayload: createResult.deferredPayload || null,
            approval: createResult.approvalResult || null,
            mappings: createResult.mappingDebug || [],
          },
        });
        continue;
      }

      if (action.actionType === "refundCreditMemo") {
        const createResult = await executeRefundCreditMemoAction({ caseId, action, checks, answers }, userId);
        if (createResult.needsInput) {
          results.push({
            ok: false,
            needsInput: createResult.needsInput,
            nodeId: action.nodeId || "",
            label: action.label || workflowActionTypeLabel(action.actionType),
            actionType: action.actionType,
            message: createResult.created?.message || "More information is needed before this action can run.",
            deposits: createResult.created?.deposits || [],
            expectedAmount: createResult.created?.expectedAmount ?? null,
            allocations: createResult.created?.allocations || [],
            debug: {
              payload: createResult.payload,
              createPayload: createResult.createPayload || createResult.payload,
              mappings: createResult.mappingDebug || [],
            },
          });
          continue;
        }
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: `Refund Credit Memo created ${createResult.document.number || createResult.document.id || "customer refund"}.`,
          document: createResult.document,
          result: createResult.created,
          debug: {
            payload: createResult.payload,
            createPayload: createResult.createPayload || createResult.payload,
            deferredPayload: createResult.deferredPayload || null,
            mappings: createResult.mappingDebug || [],
          },
        });
        continue;
      }

      if (action.actionType === "itemLineAction") {
        const lineResult = await executeItemLineAction({ caseId, action, checks, answers }, userId);
        const documentNumber = lineResult.document?.number || lineResult.document?.documentNumber || lineResult.document?.id || "";
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: `Item line updated for item ${lineResult.source.itemName || lineResult.source.itemId || ""} on order ${documentNumber}.`,
          document: {
            id: String(lineResult.document?.id || lineResult.source?.supplierPurchaseOrderId || lineResult.source?.checkedSalesOrderId || ""),
            number: String(documentNumber || ""),
            url: lineResult.document?.url || lineResult.source?.supplierPurchaseOrderUrl || lineResult.source?.checkedSalesOrderUrl || "",
          },
          result: lineResult.patchResult,
          debug: {
            patch: lineResult.patch,
            source: lineResult.source,
            matchedRestLine: lineResult.patchResult?.matchedRestLine || null,
          },
        });
        continue;
      }

      if (action.actionType === "addItemLine") {
        const lineResult = await executeAddItemLineAction({ caseId, action, answers }, userId);
        const documentNumber = lineResult.document?.number || lineResult.document?.documentNumber || lineResult.document?.id || "";
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: `Item line added to order ${documentNumber}.`,
          document: {
            id: String(lineResult.document?.id || lineResult.source?.checkedSalesOrderId || ""),
            number: String(documentNumber || ""),
            url: lineResult.document?.url || lineResult.source?.checkedSalesOrderUrl || "",
          },
          result: lineResult.patchResult,
          debug: {
            patch: lineResult.patch,
            source: lineResult.source,
            addedRestLine: lineResult.patchResult?.matchedRestLine || null,
          },
        });
        continue;
      }

      if (action.actionType === "email") {
        const emailResult = await executeEmailAction({ caseId, action, checks }, userId);
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: `${emailResult.target === "supplier" ? "Supplier" : "Customer"} email queued from ${emailResult.document.number || emailResult.recordId}.`,
          document: emailResult.document,
          result: emailResult.result,
          debug: {
            target: emailResult.target,
            recordType: emailResult.recordType,
            recordId: emailResult.recordId,
            patch: emailResult.patch,
          },
        });
        continue;
      }

      if (action.actionType === "creditRma") {
        const creditResult = await executeCreditRmaAction({ caseId, action, checks }, userId);
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: `Credit RMA created ${creditResult.document.number || creditResult.document.id || "credit memo"}.`,
          document: creditResult.document,
          result: creditResult.created,
          debug: {
            returnAuthorization: creditResult.returnAuthorization,
          },
        });
        continue;
      }

      if (action.actionType === "receiveRma") {
        const receiptResult = await executeReceiveRmaAction({ caseId, action, checks }, userId);
        results.push({
          ok: true,
          nodeId: action.nodeId || "",
          label: action.label || workflowActionTypeLabel(action.actionType),
          actionType: action.actionType,
          message: `Receive RMA created ${receiptResult.document.number || receiptResult.document.id || "item receipt"}.`,
          document: receiptResult.document,
          result: receiptResult.created,
          debug: {
            returnAuthorization: receiptResult.returnAuthorization,
            pairedSalesOrder: receiptResult.pairedSalesOrder,
            lotAssignments: receiptResult.lotAssignments,
          },
        });
        continue;
      }

      const supplierPoAction = action.actionType === "closeSupplierPurchaseOrderLine";
      const { line, source, document } = supplierPoAction
        ? await loadSupplierPurchaseOrderLineForCase(caseId, userId, checks)
        : await resolveWorkflowActionLine({ caseId, actionType: action.actionType, checks }, userId);
      const closeResult = supplierPoAction
        ? await closePurchaseOrderLineViaRestlet(source.supplierPurchaseOrderId, line, userId)
        : await closeSalesOrderLineViaRestlet(source.checkedSalesOrderId, line, userId);
      const documentNumber = supplierPoAction
        ? document.documentNumber || source.supplierPurchaseOrderDocumentNumber || source.supplierPurchaseOrderId
        : source.checkedSalesOrderDocumentNumber || source.checkedSalesOrderName || source.checkedSalesOrderId;
      const documentUrl = supplierPoAction
        ? document.url || source.supplierPurchaseOrderUrl
        : source.checkedSalesOrderUrl || salesOrderNetSuiteUrl(source.checkedSalesOrderId);
      results.push({
        ok: true,
        nodeId: action.nodeId || "",
        label: action.label || workflowActionTypeLabel(action.actionType),
        actionType: action.actionType,
        message: `${workflowActionTypeLabel(action.actionType)} executed for item ${source.itemName || source.itemId || closeResult.itemId || ""} on order ${documentNumber}.`,
        document: {
          id: String(supplierPoAction ? source.supplierPurchaseOrderId || "" : source.checkedSalesOrderId || ""),
          number: String(documentNumber || ""),
          url: documentUrl,
        },
        source,
        result: closeResult,
      });
    } catch (err) {
      const actionError = netSuiteErrorText(err) || err.message || "Action failed";
      console.warn("[workflow-actions] Action failed", {
        caseId,
        nodeId: action.nodeId || "",
        actionType: action.actionType,
        error: actionError,
        details: err.responseBody || null,
      });
      results.push({
        ok: false,
        nodeId: action.nodeId || "",
        label: action.label || workflowActionTypeLabel(action.actionType),
        actionType: action.actionType,
        message: `${workflowActionTypeLabel(action.actionType)} failed.`,
        error: actionError,
        details: err.responseBody || null,
        debug: err.workflowDebug || null,
      });
    }
  }

  return { results };
}

async function ensureWorkflowProgressTable() {
  if (workflowProgressTableReady) return;
  if (workflowProgressTableInit) return workflowProgressTableInit;
  workflowProgressTableInit = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cs_case_workflow_progress (
        case_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        state JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (case_id, workflow_id)
      );
    `);
    workflowProgressTableReady = true;
  })();
  try {
    await workflowProgressTableInit;
  } finally {
    workflowProgressTableInit = null;
  }
}

async function getCaseWorkflowProgress(caseId, workflowId) {
  const cleanCaseId = cleanDraftValue(caseId);
  const cleanWorkflowId = cleanDraftValue(workflowId);
  if (!cleanCaseId || !cleanWorkflowId) return null;
  await ensureWorkflowProgressTable();
  const result = await pool.query(
    `SELECT state, updated_at FROM cs_case_workflow_progress WHERE case_id = $1 AND workflow_id = $2 LIMIT 1`,
    [cleanCaseId, cleanWorkflowId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...(row.state && typeof row.state === "object" ? row.state : {}),
    updatedAt: row.updated_at,
  };
}

async function listCaseWorkflowProgress(caseId) {
  const cleanCaseId = cleanDraftValue(caseId);
  if (!cleanCaseId) return [];
  await ensureWorkflowProgressTable();
  const result = await pool.query(
    `SELECT workflow_id, state, updated_at
       FROM cs_case_workflow_progress
      WHERE case_id = $1
      ORDER BY updated_at DESC`,
    [cleanCaseId]
  );
  return result.rows.map((row) => ({
    workflowId: cleanDraftValue(row.workflow_id),
    ...(row.state && typeof row.state === "object" ? row.state : {}),
    updatedAt: row.updated_at,
  }));
}

async function saveCaseWorkflowProgress(caseId, workflowId, state = {}) {
  const cleanCaseId = cleanDraftValue(caseId);
  const cleanWorkflowId = cleanDraftValue(workflowId);
  if (!cleanCaseId || !cleanWorkflowId) throw new Error("Case ID and workflow ID are required");
  await ensureWorkflowProgressTable();
  const cleanState = state && typeof state === "object" ? state : {};
  const result = await pool.query(
    `INSERT INTO cs_case_workflow_progress (case_id, workflow_id, state, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (case_id, workflow_id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
       RETURNING state, updated_at`,
    [cleanCaseId, cleanWorkflowId, JSON.stringify(cleanState)]
  );
  return {
    ...(result.rows[0]?.state || {}),
    updatedAt: result.rows[0]?.updated_at,
  };
}

async function deleteCaseWorkflowProgress(caseId, workflowId) {
  const cleanCaseId = cleanDraftValue(caseId);
  const cleanWorkflowId = cleanDraftValue(workflowId);
  if (!cleanCaseId || !cleanWorkflowId) return;
  await ensureWorkflowProgressTable();
  await pool.query(
    `DELETE FROM cs_case_workflow_progress WHERE case_id = $1 AND workflow_id = $2`,
    [cleanCaseId, cleanWorkflowId]
  );
}

function normaliseCaseNote(row = {}) {
  return {
    id: cleanDraftValue(row.id || row.ID || row.internalid),
    "Internal ID": cleanDraftValue(row["Internal ID"] || row.internalId || row.activity || row.Activity),
    date: cleanDraftValue(row.Date || row.date || row.noteDate || row.notedate || row.NOTEDATE),
    author: cleanDraftValue(row.Author || row.authorName || row.authorname || row.AUTHORNAME || row.author || row.AUTHOR),
    title: cleanDraftValue(row.Title || row.title || row.TITLE),
    memo: cleanDraftValue(row.Memo || row.memo || row.Note || row.note || row.NOTE),
  };
}

async function enrichCaseNotes(notes = [], userId) {
  const output = [];

  for (const note of notes) {
    if ((note.title && note.memo) || !note.id) {
      output.push(note);
      continue;
    }

    try {
      const record = await nsGet(
        `/note/${encodeURIComponent(note.id)}?fields=${encodeURIComponent("id,title,note,notedate,author")}`,
        userId
      );
      output.push({
        ...note,
        ...normaliseCaseNote(record),
      });
    } catch (err) {
      console.warn(`Could not enrich support case note ${note.id}:`, err.message);
      output.push(note);
    }
  }

  return output;
}

function dedupeCaseNotes(notes = []) {
  const seen = new Set();
  const output = [];
  for (const note of notes) {
    const key = cleanDraftValue(note.id || `${note.date}|${note.author}|${note.title}|${note.memo}`);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    output.push(note);
  }
  return output;
}

async function getSupportCaseNotes(caseId, userId) {
  const id = cleanDraftValue(caseId);
  if (!/^\d+$/.test(id)) throw new Error("Valid case ID is required");
  const restletUrl = supportCaseRestletUrl();
  if (restletUrl) {
    try {
      const result = await nsRestlet(
        appendQueryParams(restletUrl, { action: "getNotes", caseId: id, activityId: id }),
        null,
        userId,
        "GET"
      );
      if (result?.ok !== false && Array.isArray(result?.results)) {
        return enrichCaseNotes(result.results.map(normaliseCaseNote), userId);
      }
      if (result?.ok === false) throw new Error(result.error || "Support case notes RESTlet failed");
    } catch (restletErr) {
      console.error("Error fetching support case notes via RESTlet:", restletErr.message || restletErr);
    }
  }

  const suiteletBase = process.env.USER_NOTES_URL;
  const suiteletToken = process.env.USER_NOTES;
  let suiteletNotes = [];

  if (suiteletBase && suiteletToken) {
    try {
      const suiteletUrl = `${suiteletBase}&token=${suiteletToken}`;
      const resp = await fetch(suiteletUrl);
      const text = await resp.text();
      if (!text.startsWith("<")) {
        const data = JSON.parse(text);
        if (data.ok && Array.isArray(data.results)) {
          suiteletNotes = data.results
            .filter((note) => {
              const linkedId =
                note["Internal ID"] ||
                note["Activity"] ||
                note["Activity ID"] ||
                note.activity ||
                note.activityId ||
                note.record ||
                note.recordId;
              return String(linkedId || "") === id;
            })
            .map(normaliseCaseNote);
        }
      }
    } catch (suiteletErr) {
      console.error("Error fetching support case notes via Suitelet:", suiteletErr);
    }
  }

  const queries = [
    `
      SELECT
        id,
        title,
        note AS memo
      FROM Note
      WHERE activity = ${id}
      ORDER BY id DESC
    `,
    `
      SELECT
        id,
        note AS memo
      FROM Note
      WHERE activity = ${id}
      ORDER BY id DESC
    `,
    `
      SELECT
        id
      FROM Note
      WHERE activity = ${id}
      ORDER BY id DESC
    `,
  ];

  let lastError = null;
  for (const query of queries) {
    try {
      const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
      return enrichCaseNotes(dedupeCaseNotes([
        ...suiteletNotes,
        ...(Array.isArray(result?.items) ? result.items : []).map(normaliseCaseNote),
      ]), userId);
    } catch (err) {
      lastError = err;
      console.warn("Support case notes query failed; trying next candidate.", err.message);
    }
  }

  if (suiteletNotes.length) return enrichCaseNotes(dedupeCaseNotes(suiteletNotes), userId);
  if (lastError) {
    console.warn("Support case notes unavailable via SuiteQL; returning empty Suitelet result.", lastError.message);
  }
  return [];
}

async function createSupportCaseNote(caseId, payload = {}, userId) {
  const id = cleanDraftValue(caseId);
  const memo = cleanDraftValue(payload.memo || payload.note);
  const title = cleanDraftValue(payload.title) || "Case Note";

  if (!/^\d+$/.test(id)) throw new Error("Valid case ID is required");
  if (!memo) throw new Error("Note is required");

  const restletUrl = supportCaseRestletUrl() || process.env.MEMO_RESTLET_URL;
  if (!restletUrl) throw new Error("SUPPORT_CASE_RESTLET_URL or MEMO_RESTLET_URL is not configured");

  const body = {
    action: "createNote",
    caseId: id,
    activityId: id,
    title,
    type: cleanDraftValue(payload.type) || "In-Person",
    note: memo,
    memo,
  };

  const created = await nsRestlet(restletUrl, body, userId, "POST");
  if (created?.ok === false) throw new Error(created.error || "Failed to create support case note");
  return {
    id: created?.id || "",
    title,
    memo,
    location: created?._location || "",
  };
}

async function getSupportCaseStatuses(userId) {
  const query = `
    SELECT
      id,
      name
    FROM supportCaseStatus
    WHERE isInactive = 'F'
    ORDER BY sortOrder, name
  `;

  const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
  return (Array.isArray(result?.items) ? result.items : []).map((row) => ({
    id: String(row.id || row.ID || "").trim(),
    name: String(row.name || row.NAME || "").trim(),
  })).filter((row) => row.id && row.name);
}

async function getSupportCaseTypes(userId) {
  const query = `
    SELECT
      id,
      name
    FROM supportCaseType
    WHERE isInactive = 'F'
    ORDER BY sortOrder, name
  `;

  const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
  return (Array.isArray(result?.items) ? result.items : []).map((row) => ({
    id: String(row.id || row.ID || "").trim(),
    name: String(row.name || row.NAME || "").trim(),
  })).filter((row) => row.id && row.name);
}

async function getSupportCaseSubTypes(userId, caseTypeId = "") {
  const numericCaseTypeId = Number(caseTypeId);
  const parentFilter = Number.isFinite(numericCaseTypeId) && numericCaseTypeId > 0
    ? `AND custrecord_cst_parenttype = ${numericCaseTypeId}`
    : "";
  const query = `
    SELECT
      id,
      name,
      custrecord_cst_parenttype
    FROM customrecord_sb_casesubtype
    WHERE isInactive = 'F'
      ${parentFilter}
    ORDER BY name
  `;

  const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
  return (Array.isArray(result?.items) ? result.items : []).map((row) => ({
    id: String(row.id || row.ID || "").trim(),
    name: String(row.name || row.NAME || "").trim(),
  })).filter((row) => row.id && row.name);
}

async function resolveDistributionLocationIdByName(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return "";

  try {
    const broadName = normalizeBroadLocationLookupName(cleanName);
    const searchTerm = broadName || normalizeLocationLookupName(cleanName);
    const result = await pool.query(
      `SELECT name, distribution_location_id, netsuite_internal_id, invoice_location_id
       FROM locations
       WHERE name ILIKE $1
       LIMIT 25`,
      [`%${searchTerm}%`]
    );
    const match =
      result.rows.find((row) => locationNamesMatch(row.name, cleanName)) ||
      result.rows[0] ||
      null;

    return String(
      match?.distribution_location_id ||
        match?.netsuite_internal_id ||
        match?.invoice_location_id ||
        ""
    ).trim();
  } catch (err) {
    console.warn(`Could not resolve distribution location by name "${cleanName}":`, err.message);
    return "";
  }
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

async function resolveSalesOrderInternalId(salesOrderId, userId) {
  const id = String(salesOrderId || "").trim();
  if (!id) return "";
  if (/^\d+$/.test(id)) return id;

  try {
    const so = await nsGet(
      `/salesOrder/${encodeURIComponent(id)}?fields=${encodeURIComponent("id,tranId")}`,
      userId,
      "sb"
    );
    return String(so?.id || so?.internalId || id);
  } catch (err) {
    console.warn("Unable to resolve Sales Order internal ID for transfers:", err.message);
    return id;
  }
}

function resolveLineItemId(line) {
  const item = line?.item;
  if (item && typeof item === "object") {
    return String(item.id || item.value || item.internalId || line.itemId || "").trim();
  }
  return String(item || line?.itemId || "").trim();
}

async function createLinkedTransferOrdersForSalesOrder({
  salesOrderId,
  order = {},
  items = [],
  storeName = "",
  userId,
  skipIfExisting = true,
}) {
  const salesOrderInternalId = await resolveSalesOrderInternalId(salesOrderId, userId);
  const createdTransfers = [];
  const failed = [];
  const warnings = [];
  const skippedLines = [];

  if (skipIfExisting) {
    try {
      const existingTransfers = await getLinkedTransferOrders(salesOrderInternalId, userId);
      if (existingTransfers.length) {
        console.log(
          `Linked Transfer Orders already exist for Sales Order ${salesOrderInternalId}; skipping creation`
        );
        return {
          ok: true,
          salesOrderId: salesOrderInternalId,
          skipped: true,
          reason: "existing-linked-transfers",
          created: [],
          existing: existingTransfers,
          failed: [],
          warnings,
        };
      }
    } catch (err) {
      const message = err.message || "Could not check existing linked Transfer Orders.";
      console.warn(
        `Could not check existing linked Transfer Orders for Sales Order ${salesOrderInternalId}; continuing with creation:`,
        message
      );
      warnings.push(message);
    }
  }

  try {
    const storeContext = await resolveStoreLocationContext(order, storeName);

    for (const [idx, line] of items.entries()) {
      const hasInventoryMeta = !!String(line.inventoryMeta || "").trim();
      const fulfilMethod = String(
        line.fulfilmentMethod || (line.takenFromStore === true && hasInventoryMeta ? "1" : "")
      ).trim();
      let skipTransfer = false;
      const skipReasons = [];

      if (!hasInventoryMeta) {
        skipTransfer = true;
        skipReasons.push("missing-inventory-meta");
      }

      const metaParts = (line.inventoryMeta || "")
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean);

      if (metaParts.length === 0) {
        skipTransfer = true;
        skipReasons.push("no-inventory-meta-parts");
      }

      if (fulfilMethod === "1") {
        const allInventoryAlreadyInStore = metaParts.every((part) =>
          inventoryDetailIsAtStore(part, storeContext)
        );
        if (allInventoryAlreadyInStore) {
          skipTransfer = true;
          skipReasons.push("inventory-already-at-order-store");
        }
      }

      if (fulfilMethod === "2") {
        try {
          const [, , locIdRaw] = metaParts[0].split("|");
          if (String(locIdRaw || "") === String(order.warehouse)) {
            skipTransfer = true;
            skipReasons.push("inventory-already-at-warehouse");
          }
        } catch {}
      }

      if (!fulfilMethod) {
        skipTransfer = true;
        skipReasons.push("missing-fulfilment-method");
      }

      if (skipTransfer) {
        skippedLines.push({
          line: idx + 1,
          itemId: resolveLineItemId(line),
          fulfilmentMethod: fulfilMethod || null,
          takenFromStore: line.takenFromStore === true,
          reasons: skipReasons,
          inventoryMeta: line.inventoryMeta || "",
        });
        continue;
      }

      for (const part of metaParts) {
        if (fulfilMethod === "1" && inventoryDetailIsAtStore(part, storeContext)) {
          continue;
        }

        let sourceLocId = null;
        const [qty, locName, locIdRaw, , statusIdRaw, , invIdRaw] = part.split("|");
        const quantity = parseFloat(qty || 0) || 0;
        const invId = (invIdRaw || "").trim();
        const locId = (locIdRaw || "").trim();
        const statusId = (statusIdRaw || "").trim();
        let transferItemId = resolveLineItemId(line);

        if (!quantity || !invId) continue;

        const invInfo = await getInventoryNumberInfo(invId, userId);
        if (invInfo?.itemId && invInfo.itemId !== transferItemId) {
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
          }

          if (!sourceLocId && locName) {
            sourceLocId = await resolveDistributionLocationIdByName(locName);
          }

          if (!sourceLocId && locId) {
            sourceLocId = locId;
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
          }

          if (!sourceLocId && locName) {
            sourceLocId = await resolveDistributionLocationIdByName(locName);
          }
        } catch (err) {
          console.error("Source lookup failed:", err.message);
        }

        if (!sourceLocId) {
          if (locId) sourceLocId = locId;
          else {
            skippedLines.push({
              line: idx + 1,
              itemId: transferItemId,
              fulfilmentMethod: fulfilMethod || null,
              takenFromStore: line.takenFromStore === true,
              reasons: ["missing-source-location"],
              inventoryMeta: part,
            });
            continue;
          }
        }

        let destinationLocId = "";
        if (fulfilMethod === "1") {
          destinationLocId = storeContext.transferLocationId;
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
        }

        if (!destinationLocId || !transferItemId) {
          skippedLines.push({
            line: idx + 1,
            itemId: transferItemId,
            fulfilmentMethod: fulfilMethod || null,
            takenFromStore: line.takenFromStore === true,
            sourceLocation: sourceLocId,
            destinationWarehouse: destinationLocId,
            reasons: [
              ...(!destinationLocId ? ["missing-destination-location"] : []),
              ...(!transferItemId ? ["missing-transfer-item"] : []),
            ],
            inventoryMeta: part,
          });
          continue;
        }
        if (String(sourceLocId) === String(destinationLocId)) {
          skippedLines.push({
            line: idx + 1,
            itemId: transferItemId,
            fulfilmentMethod: fulfilMethod || null,
            takenFromStore: line.takenFromStore === true,
            sourceLocation: sourceLocId,
            destinationWarehouse: destinationLocId,
            reasons: ["source-and-destination-match"],
            inventoryMeta: part,
          });
          continue;
        }

        const inventoryAssignment = {
          issueInventoryNumber: { id: invId },
          receiptInventoryNumber: invInfo?.number || "",
          quantity,
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
          custbody_sb_relatedsalesorder: { id: String(salesOrderInternalId) },
          item: {
            items: [
              {
                item: { id: transferItemId },
                location: { id: sourceLocId },
                quantity,
                inventoryDetail: {
                  inventoryAssignment: {
                    items: [inventoryAssignment],
                  },
                },
              },
            ],
          },
        };

        try {
          const tr = await nsPost("/transferOrder", transferBody, userId, "sb");
          let transferId = tr?.id || null;
          if (!transferId && tr?._location) {
            const m = tr._location.match(/transferorder\/(\d+)/i);
            if (m) transferId = m[1];
          }

          createdTransfers.push({
            itemId: transferItemId,
            transferOrderId: transferId,
            sourceLocation: sourceLocId,
            destinationWarehouse: destinationLocId,
          });
        } catch (err) {
          console.error(`Failed to create Transfer Order for line ${idx + 1}:`, err.message);
          failed.push({
            line: idx + 1,
            itemId: transferItemId,
            sourceLocation: sourceLocId,
            destinationWarehouse: destinationLocId,
            error: err.message,
          });
        }
      }
    }
  } catch (err) {
    console.error("Transfer Order creation block failed:", err.message);
    failed.push({ error: err.message });
  }

  return {
    ok: failed.length === 0,
    salesOrderId: salesOrderInternalId,
    skipped: false,
    created: createdTransfers,
    failed,
    warnings,
    skippedLines,
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

async function markSalesOrderCustomerEmailSent(salesOrderId, userId) {
  const id = String(salesOrderId || "").trim();
  if (!id) throw new Error("Missing Sales Order ID for customer email sent flag.");

  await nsPatch(
    `/salesOrder/${encodeURIComponent(id)}`,
    { custbody_sb_cust_email_sent: true },
    userId
  );
  cacheDeleteSalesOrder(id);

  return {
    ok: true,
    salesOrderId: id,
    fieldId: "custbody_sb_cust_email_sent",
  };
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

function isRecordChangedPayload(payload) {
  const name = String(payload?.name || payload?.error?.name || payload?.code || payload?.error?.code || "");
  const message = String(payload?.error?.message || payload?.error || payload?.message || payload?.raw || "");
  return name === "RCRD_HAS_BEEN_CHANGED" || /record has been changed/i.test(message);
}

function isProcessedSalesOrderPermissionPayload(payload) {
  const name = String(payload?.name || payload?.error?.name || payload?.code || payload?.error?.code || "");
  const message = String(payload?.error?.message || payload?.error || payload?.message || payload?.raw || "");
  return (
    name === "INSUFFICIENT_PERMISSION" &&
    /partially or fully processed/i.test(message) &&
    /may not be edited/i.test(message)
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postRestletWithRecordChangedRetry(
  restletUrl,
  buildHeaders,
  payloadText,
  label,
  { maxAttempts = 2, baseDelayMs = 1200 } = {}
) {
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const headers =
      typeof buildHeaders === "function" ? await buildHeaders(attempt) : buildHeaders;
    const response = await fetch(restletUrl, {
      method: "POST",
      headers,
      body: payloadText,
    });
    const text = await response.text();
    const data = parseMaybeJson(text);
    last = { response, text, data, attempt };

    if ((response.ok && data?.ok) || !isRecordChangedPayload(data) || attempt === maxAttempts) {
      return last;
    }

    console.warn(
      `${label} RESTlet hit RCRD_HAS_BEEN_CHANGED; retrying with a fresh NetSuite load (${attempt}/${maxAttempts})`
    );
    await delay(baseDelayMs * attempt);
  }

  return last;
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

function salesOrderNetSuiteUrl(id) {
  const base = netSuiteAppBaseUrl().replace(/\/$/, "");
  return base && id ? `${base}/app/accounting/transactions/salesord.nl?id=${encodeURIComponent(id)}` : "";
}

function normaliseTransactionDocumentNumber(value, fallback = "") {
  const raw = cleanDraftValue(value);
  if (!raw) return cleanDraftValue(fallback);
  const hashMatch = raw.match(/#\s*([A-Za-z0-9._/-]+)\s*$/);
  if (hashMatch) return hashMatch[1];
  return raw;
}

function normalizeCustomerEmail(value) {
  return String(value || "").trim();
}

function isLikelyEmail(value) {
  const email = normalizeCustomerEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicRequestError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function customerShipAddressText(customer = {}) {
  const supplied = String(customer.shipAddress || customer.shipaddress || "").trim();
  if (supplied) return supplied;
  return [
    customer.address1,
    customer.address2,
    customer.address3,
    customer.county,
    customer.postcode,
  ]
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n");
}

async function ensureCustomerEmailBeforeCommit(salesOrderId, headerUpdates, userId) {
  const suppliedEmail = normalizeCustomerEmail(headerUpdates?.email);
  if (suppliedEmail && !isLikelyEmail(suppliedEmail)) {
    throw publicRequestError("Enter a valid customer email before committing the order.");
  }

  const so = await nsGet(
    `/salesOrder/${encodeURIComponent(salesOrderId)}?fields=${encodeURIComponent("entity")}`,
    userId,
    "sb"
  );
  const customerId = String(so?.entity?.id || so?.entity || "").trim();
  if (!customerId) {
    throw publicRequestError("Could not resolve the NetSuite customer for this order.", 502);
  }

  const customer = await nsGet(
    `/customer/${encodeURIComponent(customerId)}?fields=${encodeURIComponent("email")}`,
    userId,
    "sb"
  );
  const existingEmail = normalizeCustomerEmail(customer?.email);
  const targetEmail = suppliedEmail || existingEmail;

  if (!targetEmail) {
    throw publicRequestError("Customer email is required before committing the order.");
  }

  if (!isLikelyEmail(targetEmail)) {
    throw publicRequestError("Enter a valid customer email before committing the order.");
  }

  const emailMatches =
    existingEmail.toLowerCase() === targetEmail.toLowerCase();

  if (!emailMatches) {
    console.log("Patching customer email before Sales Order commit:", {
      salesOrderId,
      customerId,
      hadEmail: !!existingEmail,
    });

    await nsPatch(
      `/customer/${encodeURIComponent(customerId)}`,
      { email: targetEmail },
      userId
    );

    const verifiedCustomer = await nsGet(
      `/customer/${encodeURIComponent(customerId)}?fields=${encodeURIComponent("email")}`,
      userId,
      "sb"
    );
    const verifiedEmail = normalizeCustomerEmail(verifiedCustomer?.email);
    if (verifiedEmail.toLowerCase() !== targetEmail.toLowerCase()) {
      throw publicRequestError(
        "NetSuite accepted the customer email update but did not return it before commit. Please save and try again.",
        502
      );
    }
  }

  return {
    customerId,
    email: targetEmail,
    patched: !emailMatches,
  };
}

async function syncCustomerEmailFromHeaderUpdates(salesOrderId, headerUpdates, userId) {
  const suppliedEmail = normalizeCustomerEmail(headerUpdates?.email);
  if (!suppliedEmail) return null;

  return ensureCustomerEmailBeforeCommit(salesOrderId, headerUpdates, userId);
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

function uniqueRelatedRecords(records = []) {
  const seen = new Set();
  return (Array.isArray(records) ? records : [])
    .map((record) => ({
      id: String(record?.id || "").trim(),
      refName: String(record?.refName || record?.tranid || record?.name || record?.id || "").trim(),
    }))
    .filter((record) => record.id || record.refName)
    .filter((record) => {
      const key = `${record.id}|${record.refName}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function relatedRecordFromRow(row, idKeys = ["id"], nameKeys = ["tranid", "name", "refname"]) {
  const pick = (keys) => {
    for (const key of keys) {
      const value = row?.[key] ?? row?.[String(key).toUpperCase()];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  };

  return {
    id: pick(idKeys),
    refName: pick(nameKeys),
  };
}

function relatedPoRecordsFromRows(rows = []) {
  return uniqueRelatedRecords(
    rows.map((row) =>
      relatedRecordFromRow(
        row,
        ["id", "transaction", "nextdoc", "next_doc", "nextdocid", "createdpo", "createpo"],
        ["tranid", "tran_id", "name", "transaction_name", "nextdoc_name", "createdpo_name", "createpo_name"]
      )
    )
  );
}

function rowValue(row, ...keys) {
  for (const key of keys) {
    const value = row?.[key] ?? row?.[String(key).toUpperCase()];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function purchaseOrderRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const recordType = rowValue(row, "recordtype", "record_type").toLowerCase();
    const type = rowValue(row, "type", "dbstrantype").toLowerCase();
    const tranId = rowValue(row, "tranid", "name", "transaction_name").toLowerCase();
    return (
      recordType === "purchaseorder" ||
      type === "purchord" ||
      tranId.includes("purchase order") ||
      /^po/i.test(tranId)
    );
  });
}

function dropShipmentPoRecordsFromRows(rows = []) {
  const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
    const linkType = rowValue(row, "linktype", "link_type").toLowerCase();
    const recordType = rowValue(row, "recordtype", "type").toLowerCase();
    const tranId = rowValue(row, "tranid", "name");
    return (
      linkType.includes("drop") ||
      recordType.includes("purchase") ||
      /^PO/i.test(tranId)
    );
  });

  return relatedPoRecordsFromRows(filtered);
}

async function trySuiteQlItems(query, userId, label) {
  try {
    const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
    const items = Array.isArray(result?.items) ? result.items : [];
    return items;
  } catch (err) {
    console.warn(`[intercompany-po] ${label} SuiteQL failed:`, err.message || err);
    return [];
  }
}

async function getIntercompanyPurchaseOrdersForSalesOrder(salesOrderId, userId) {
  const numericId = Number(salesOrderId);
  if (!Number.isFinite(numericId) || numericId <= 0) return [];
  let lastAttemptedSource = "";

  const lineCreatedFromRows = await trySuiteQlItems(`
    SELECT
      DISTINCT
      tl.transaction AS id,
      BUILTIN.DF(tl.transaction) AS tranid,
      tl.createdfrom
    FROM transactionline tl
    WHERE tl.createdfrom = ${numericId}
    ORDER BY tl.transaction
  `, userId, "Transaction lines where createdfrom is sales order");
  lastAttemptedSource = "transactionline.createdfrom-any";

  const lineCreatedFromRecords = relatedPoRecordsFromRows(purchaseOrderRows(lineCreatedFromRows));
  if (lineCreatedFromRecords.length) {
    return {
      records: lineCreatedFromRecords,
      source: "transactionline.createdfrom-any",
    };
  }

  const createdFromLineRows = await trySuiteQlItems(`
    SELECT
      DISTINCT
      t.id,
      t.tranid,
      t.type
    FROM transaction t
    JOIN transactionline tl ON tl.transaction = t.id
    WHERE t.type = 'PurchOrd'
      AND tl.createdfrom = ${numericId}
    ORDER BY t.id
  `, userId, "Purchase order lines created from sales order");
  lastAttemptedSource = "transactionline.createdfrom";

  const createdFromLineRecords = relatedPoRecordsFromRows(createdFromLineRows);
  if (createdFromLineRecords.length) {
    return {
      records: createdFromLineRecords,
      source: "transactionline.createdfrom",
    };
  }

  const transactionLinkRows = await trySuiteQlItems(`
    SELECT
      ntl.nextdoc AS id,
      BUILTIN.DF(ntl.nextdoc) AS tranid,
      ntl.linktype
    FROM NextTransactionLink ntl
    WHERE ntl.previousdoc = ${numericId}
  `, userId, "Next transaction linked PO");
  lastAttemptedSource = "NextTransactionLink";

  const transactionLinkRecords = dropShipmentPoRecordsFromRows(transactionLinkRows);
  if (transactionLinkRecords.length) {
    return {
      records: transactionLinkRecords,
      source: "NextTransactionLink",
    };
  }

  const lineLinkRows = await trySuiteQlItems(`
    SELECT
      ntl.nextdoc AS id,
      BUILTIN.DF(ntl.nextdoc) AS tranid,
      ntl.linktype
    FROM NextTransactionLineLink ntl
    WHERE ntl.previousdoc = ${numericId}
  `, userId, "Drop shipment linked PO");
  lastAttemptedSource = "NextTransactionLineLink";

  const linkedRecords = dropShipmentPoRecordsFromRows(lineLinkRows);
  if (linkedRecords.length) {
    return {
      records: linkedRecords,
      source: "NextTransactionLineLink",
    };
  }

  const createdPoRows = await trySuiteQlItems(`
    SELECT
      tl.createdpo AS id,
      BUILTIN.DF(tl.createdpo) AS tranid
    FROM transactionline tl
    WHERE tl.transaction = ${numericId}
      AND tl.mainline = 'F'
      AND tl.taxline = 'F'
      AND tl.createdpo IS NOT NULL
  `, userId, "Line createdpo linked PO");
  lastAttemptedSource = "transactionline.createdpo";

  const createdPoRecords = relatedPoRecordsFromRows(createdPoRows);
  if (createdPoRecords.length) {
    return {
      records: createdPoRecords,
      source: "transactionline.createdpo",
    };
  }

  return {
    records: [],
    source: lastAttemptedSource,
  };
}

async function getSalesOrderLineIntercompanyPoMap(salesOrderId, userId) {
  const numericId = Number(salesOrderId);
  const map = new Map();
  if (!Number.isFinite(numericId) || numericId <= 0) return map;

  const rows = await trySuiteQlItems(`
    SELECT
      tl.id AS lineid,
      tl.createdpo AS id,
      BUILTIN.DF(tl.createdpo) AS tranid
    FROM transactionline tl
    WHERE tl.transaction = ${numericId}
      AND tl.mainline = 'F'
      AND tl.taxline = 'F'
      AND tl.createdpo IS NOT NULL
  `, userId, "Line createdpo map");

  rows.forEach((row) => {
    const lineId = String(row.lineid || "").trim();
    if (!lineId) return;
    map.set(lineId, {
      id: String(row.id || "").trim(),
      refName: String(row.tranid || row.name || row.id || "").trim(),
    });
  });

  return map;
}

async function getTransactionItemLines(transactionId, userId) {
  const numericId = Number(transactionId);
  if (!Number.isFinite(numericId) || numericId <= 0) return [];

  const rows = await trySuiteQlItems(`
    SELECT
      tl.id AS lineid,
      tl.item,
      tl.linesequencenumber
    FROM transactionline tl
    WHERE tl.transaction = ${numericId}
      AND tl.mainline = 'F'
      AND tl.taxline = 'F'
    ORDER BY tl.linesequencenumber
  `, userId, "Transaction item lines");

  return rows.map((row, index) => ({
    lineId: String(row.lineid || "").trim(),
    itemId: String(row.item || "").trim(),
    sequence: Number(row.linesequencenumber) || index + 1,
    index,
  }));
}

function restRecordEndpointFromHref(href) {
  const value = String(href || "").trim();
  if (!value) return "";
  const marker = "/services/rest/record/v1";
  const idx = value.indexOf(marker);
  if (idx >= 0) return value.slice(idx + marker.length);

  try {
    const url = new URL(value);
    const pathIdx = url.pathname.indexOf("/services/rest/record/v1");
    if (pathIdx >= 0) {
      return `${url.pathname.slice(pathIdx + marker.length)}${url.search || ""}`;
    }
  } catch {}

  return "";
}

function sublistLineSelfEndpoint(line) {
  const links = Array.isArray(line?.links) ? line.links : [];
  const self = links.find((link) => String(link?.rel || "").toLowerCase() === "self") || links[0];
  return restRecordEndpointFromHref(self?.href);
}

async function getRestTransactionItemLines(recordType, transactionId, userId) {
  const cleanRecordType = String(recordType || "").trim();
  const cleanTransactionId = String(transactionId || "").trim();
  if (!cleanRecordType || !cleanTransactionId) return [];

  const data = await nsGet(
    `/${cleanRecordType}/${encodeURIComponent(cleanTransactionId)}/item`,
    userId
  );
  const items = Array.isArray(data?.items) ? data.items : [];

  return items.map((line, index) => ({
    raw: line,
    index,
    endpoint: sublistLineSelfEndpoint(line) || `/${cleanRecordType}/${encodeURIComponent(cleanTransactionId)}/item/${encodeURIComponent(line?.id || index)}`,
    itemId: String(
      line?.item?.id ||
        line?.item ||
        line?.itemId ||
        line?.itemid ||
        ""
    ).trim(),
    lineId: String(line?.id || line?.line || line?.lineuniquekey || line?.lineUniqueKey || "").trim(),
    line: String(line?.line || "").trim(),
    lineUniqueKey: String(line?.lineuniquekey || line?.lineUniqueKey || "").trim(),
  }));
}

function findMatchingPurchaseOrderLine({ salesLines, purchaseOrderLines, salesLineId, itemId, lineIndex }) {
  const wantedLineId = String(salesLineId || "").trim();
  const wantedItemId = String(itemId || "").trim();
  const selectedIndex = Number(lineIndex);

  const salesLine =
    salesLines.find((line) => line.lineId === wantedLineId) ||
    (Number.isFinite(selectedIndex) ? salesLines[selectedIndex] : null);

  const matchItemId = wantedItemId || salesLine?.itemId || "";
  if (!matchItemId) return null;

  const occurrence = salesLines
    .filter((line) => line.itemId === matchItemId)
    .findIndex((line) => line.lineId === (salesLine?.lineId || wantedLineId));

  const sameItemPurchaseLines = purchaseOrderLines.filter((line) => line.itemId === matchItemId);
  return sameItemPurchaseLines[Math.max(0, occurrence)] || sameItemPurchaseLines[0] || null;
}

async function getTransactionItemLineFulfilmentQuantities(transactionId, userId) {
  const numericId = Number(transactionId);
  if (!Number.isFinite(numericId) || numericId <= 0) return [];

  const rows = await trySuiteQlItems(`
    SELECT
      tl.id AS lineid,
      tl.item,
      tl.quantity,
      tl.quantityshiprecv AS quantityfulfilled,
      tl.quantitybackordered,
      tl.quantitycommitted,
      tl.linesequencenumber
    FROM transactionline tl
    WHERE tl.transaction = ${numericId}
      AND tl.mainline = 'F'
      AND tl.taxline = 'F'
    ORDER BY tl.linesequencenumber
  `, userId, "Transaction fulfilment quantities");

  return rows.map((row, index) => ({
    lineId: String(row.lineid || "").trim(),
    itemId: String(row.item || "").trim(),
    quantity: Math.abs(Number(row.quantity) || 0),
    fulfilledQuantity: Math.abs(Number(row.quantityfulfilled ?? row.QUANTITYFULFILLED) || 0),
    backorderedQuantity: Math.abs(Number(row.quantitybackordered ?? row.QUANTITYBACKORDERED) || 0),
    committedQuantity: Math.abs(Number(row.quantitycommitted ?? row.QUANTITYCOMMITTED) || 0),
    sequence: Number(row.linesequencenumber) || index + 1,
    index,
  }));
}

function relatedRecordDocumentNumber(record) {
  const value = String(record?.tranid || record?.refName || record?.name || record?.id || "").trim();
  return value
    .replace(/^Purchase\s+Order\s*#?/i, "")
    .replace(/^Sales\s+Order\s*#?/i, "")
    .trim();
}

function prefixedPurchaseOrderOptions(poNumber, optionsDisplay) {
  const cleanPoNumber = String(poNumber || "").trim();
  const cleanOptions = String(optionsDisplay || "").trim();
  if (!cleanPoNumber) return cleanOptions;
  if (!cleanOptions) return cleanPoNumber;
  if (cleanOptions.toLowerCase().startsWith(cleanPoNumber.toLowerCase())) return cleanOptions;
  return `${cleanPoNumber}\n${cleanOptions}`;
}

async function getTransactionMemo(transactionId, userId) {
  const numericId = Number(transactionId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    throw new Error("Invalid transaction ID for memo lookup.");
  }

  const rows = await trySuiteQlItems(`
    SELECT memo
    FROM transaction
    WHERE id = ${numericId}
  `, userId, "Purchase Order memo lookup");

  if (!rows.length) {
    throw new Error("Could not read the Purchase Order before triggering its item-copy User Event.");
  }
  return String(rows[0]?.memo || "");
}

function findMatchingRestPurchaseOrderLine({ salesLines, purchaseOrderRestLines, salesLine, itemId, lineIndex }) {
  const matchItemId = String(itemId || salesLine?.itemId || "").trim();
  if (!matchItemId) return null;

  const wantedLineId = String(salesLine?.lineId || "").trim();
  const sameItemSalesLines = salesLines.filter((line) => line.itemId === matchItemId);
  const occurrence = Math.max(
    0,
    sameItemSalesLines.findIndex((line) => line.lineId === wantedLineId)
  );

  const sameItemPurchaseLines = purchaseOrderRestLines.filter((line) => line.itemId === matchItemId);
  if (sameItemPurchaseLines.length) {
    return sameItemPurchaseLines[occurrence] || sameItemPurchaseLines[0] || null;
  }

  const selectedIndex = Number(lineIndex);
  if (Number.isFinite(selectedIndex)) return purchaseOrderRestLines[selectedIndex] || null;
  return null;
}

async function patchPurchaseOrderLineOptions({ purchaseOrder, salesLines, salesLine, itemId, lineIndex, optionsDisplay, userId }) {
  const purchaseOrderId = String(purchaseOrder?.id || "").trim();
  if (!purchaseOrderId) throw new Error("Missing intercompany Purchase Order ID.");

  const poNumber = relatedRecordDocumentNumber(purchaseOrder);
  const prefixedOptions = prefixedPurchaseOrderOptions(poNumber, optionsDisplay);
  const memo = await getTransactionMemo(purchaseOrderId, userId);
  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const buildRestletHeaders = async () => ({
    ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
    "Content-Type": "application/json",
  });
  const payload = {
    id: purchaseOrderId,
    recordType: "purchaseOrder",
    triggerPoItemSet: true,
    memo,
  };

  const { response, text, data } = await postRestletWithRecordChangedRetry(
    restletUrl,
    buildRestletHeaders,
    JSON.stringify(payload),
    "Trigger Purchase Order item-copy User Event",
    { maxAttempts: 5, baseDelayMs: 750 }
  );
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || text || "NetSuite RESTlet failed to update Purchase Order line options.");
  }

  return {
    result: data,
    endpoint: "RESTlet XEDIT trigger",
    matchedRestLine: {
      index: Number.isFinite(Number(lineIndex)) ? Number(lineIndex) : salesLine?.index ?? null,
      itemId: String(itemId || salesLine?.itemId || "").trim(),
      lineId: "",
    },
    value: prefixedOptions,
  };
}

async function createPairedFabricChangeMemo({ salesOrderId, notes, session, userId }) {
  const memoRestletUrl = process.env.MEMO_RESTLET_URL;
  if (!memoRestletUrl) throw new Error("MEMO_RESTLET_URL is not configured.");

  const cleanNotes = String(notes || "").trim();
  const memo = [
    "I confirm I have contacted the supplier before changing the fabric option",
    `Additional notes: ${cleanNotes || "None"}`,
  ].join("\n\n");
  const result = await nsRestlet(
    memoRestletUrl,
    {
      orderId: String(salesOrderId),
      title: "Fabric option change confirmation",
      type: "Phone",
      memo,
      authorId: session?.netsuiteid || session?.netsuiteId || null,
    },
    userId,
    "POST"
  );

  if (!result?.ok) {
    throw new Error(result?.error || "Could not create the fabric change confirmation memo.");
  }
  return result;
}

async function patchTransactionItemLineOptions(recordType, transactionId, targetLine, optionsDisplay, userId) {
  const cleanRecordType = String(recordType || "").trim();
  const cleanTransactionId = String(transactionId || "").trim();
  const line = targetLine && typeof targetLine === "object"
    ? targetLine
    : { lineId: String(targetLine || "").trim() };

  if (!cleanRecordType || !cleanTransactionId || !String(line.lineId || "").trim()) {
    throw new Error("Missing NetSuite transaction line details.");
  }

  const restLines = await getRestTransactionItemLines(cleanRecordType, cleanTransactionId, userId);
  const restLine =
    restLines.find((candidate) => candidate.lineId && candidate.lineId === String(line.lineId || "")) ||
    restLines.find((candidate) => Number(candidate.index) === Number(line.index)) ||
    restLines.find((candidate) => candidate.itemId && candidate.itemId === String(line.itemId || ""));

  if (!restLine?.endpoint) {
    throw new Error(`Could not resolve the NetSuite ${cleanRecordType} item line endpoint.`);
  }

  const body = { custcol_sb_itemoptionsdisplay: String(optionsDisplay || "") };
  const result = await nsPatch(restLine.endpoint, body, userId);
  return {
    result,
    endpoint: restLine.endpoint,
    matchedRestLine: {
      index: restLine?.index,
      itemId: restLine?.itemId,
      lineId: restLine?.lineId,
    },
  };
}

async function saveSalesOrderLineOptionsViaRestlet(salesOrderId, targetLine, optionsDisplay, userId) {
  const cleanSalesOrderId = String(salesOrderId || "").trim();
  const line = targetLine && typeof targetLine === "object"
    ? targetLine
    : { lineId: String(targetLine || "").trim() };

  if (!cleanSalesOrderId || !String(line.lineId || "").trim()) {
    throw new Error("Missing Sales Order line details for RESTlet save.");
  }

  const restletLineId = String(line.lineId || "").trim();

  const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;
  const buildRestletHeaders = async () => ({
    ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
    "Content-Type": "application/json",
  });

  const payload = {
    id: cleanSalesOrderId,
    lines: [
      {
        lineId: restletLineId,
        suiteQlLineId: String(line.lineId || "").trim(),
        itemId: String(line.itemId || "").trim(),
        lineIndex: Number.isFinite(Number(line.index)) ? Number(line.index) : null,
        options: String(optionsDisplay || ""),
        optionsSummary: String(optionsDisplay || ""),
      },
    ],
    headerUpdates: {},
    deletedLineIds: [],
    commit: false,
    optionsOnly: true,
  };
  console.log("[line-options] RESTlet options-only payload", {
    ...payload,
    lines: payload.lines.map((payloadLine) => ({
      ...payloadLine,
      optionsLength: String(payloadLine.options || "").length,
    })),
  });

  const { response, text, data } = await postRestletWithRecordChangedRetry(
    restletUrl,
    buildRestletHeaders,
    JSON.stringify(payload),
    "Save Sales Order line options",
    { maxAttempts: 5, baseDelayMs: 750 }
  );
  console.log("[line-options] RESTlet options-only response", {
    status: response.status,
    ok: response.ok,
    data,
    rawText: text,
  });

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || text || "NetSuite RESTlet failed to update Sales Order line options.");
  }

  const updatedLine = Array.isArray(data.updatedLines) ? data.updatedLines[0] : null;
  if (!updatedLine) {
    throw new Error("NetSuite did not confirm which Sales Order line was updated.");
  }

  return {
    result: data,
    lineId: restletLineId,
    suiteQlLineId: String(line.lineId || "").trim(),
    itemId: String(line.itemId || "").trim(),
    matchedRestLine: updatedLine,
  };
}

async function closeSalesOrderLineViaRestlet(salesOrderId, targetLine, userId) {
  const cleanSalesOrderId = String(salesOrderId || "").trim();
  const line = targetLine && typeof targetLine === "object"
    ? targetLine
    : { lineId: String(targetLine || "").trim() };

  if (!cleanSalesOrderId || !String(line.lineid || line.lineId || "").trim()) {
    throw new Error("Missing Sales Order line details for close line action.");
  }

  const wantedLineId = String(line.lineId || line.lineid || "").trim();
  const wantedItemId = String(line.itemId || line.item || "").trim();
  const wantedLineUniqueKey = String(line.lineUniqueKey || line.lineuniquekey || "").trim();
  const wantedSequence = Number(line.linesequencenumber || line.sequence || "");
  const wantedIndex = Number.isFinite(Number(line.index))
    ? Number(line.index)
    : Number.isFinite(wantedSequence) && wantedSequence > 0
      ? wantedSequence - 1
      : null;
  const restLines = await getRestTransactionItemLines("salesOrder", cleanSalesOrderId, userId);
  const restLine =
    restLines.find((candidate) => candidate.lineId && candidate.lineId === wantedLineId) ||
    restLines.find((candidate) => wantedLineId && candidate.line === wantedLineId) ||
    restLines.find((candidate) => wantedLineId && candidate.lineUniqueKey === wantedLineId) ||
    restLines.find((candidate) => wantedLineUniqueKey && candidate.lineUniqueKey === wantedLineUniqueKey) ||
    restLines.find((candidate) => wantedIndex !== null && Number(candidate.index) === wantedIndex) ||
    restLines.find((candidate) => wantedItemId && candidate.itemId === wantedItemId);

  if (!restLine?.endpoint) {
    console.warn("[workflow-actions] Could not resolve Sales Order item line endpoint", {
      salesOrderId: cleanSalesOrderId,
      wantedLineId,
      wantedItemId,
      wantedLineUniqueKey,
      wantedSequence,
      wantedIndex,
      targetLine: line,
      restLineCount: restLines.length,
      restLines: restLines.map((candidate) => ({
        index: candidate.index,
        endpoint: candidate.endpoint,
        itemId: candidate.itemId,
        lineId: candidate.lineId,
        line: candidate.line,
        lineUniqueKey: candidate.lineUniqueKey,
        rawKeys: Object.keys(candidate.raw || {}),
      })),
    });
    throw new Error("Could not resolve the NetSuite Sales Order item line endpoint.");
  }

  const patchAttempts = [
    { isclosed: true },
    { isClosed: true },
    { closed: true },
  ];
  let lastErr = null;
  for (const body of patchAttempts) {
    try {
      const result = await nsPatch(restLine.endpoint, body, userId);
      cacheDeleteSalesOrder(cleanSalesOrderId);
      return {
        result,
        endpoint: restLine.endpoint,
        lineId: wantedLineId,
        itemId: wantedItemId || restLine.itemId,
        matchedRestLine: {
          index: restLine.index,
          itemId: restLine.itemId,
          lineId: restLine.lineId,
        },
        patch: body,
      };
    } catch (err) {
      lastErr = err;
      const text = `${err.message || ""} ${JSON.stringify(err.responseBody || {})}`;
      if (!/invalid|unknown|field/i.test(text)) break;
    }
  }

  throw lastErr || new Error("NetSuite REST line patch failed to close Sales Order line.");
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
  const isDistributionOrder = false;
  const intercompanyPurchaseOrderResult = await getIntercompanyPurchaseOrdersForSalesOrder(numericId, userId);

  return {
    custbody_sb_pairedsalesorder: pairedSalesOrder,
    custbody_sb_relatedpurchaseorders: relatedPurchaseOrders,
    intercompanyPurchaseOrders: intercompanyPurchaseOrderResult.records || [],
    intercompanyPurchaseOrderSource: intercompanyPurchaseOrderResult.source || "",
    intercompanyPurchaseOrdersNotApplicable: isDistributionOrder,
    custbody_exported_to_dispatchtrack:
      row.exported_to_dispatchtrack === true ||
      String(row.exported_to_dispatchtrack || "").trim().toUpperCase() === "T",
  };
}

async function syncPairedSalesOrderMemo(salesOrderId, headerUpdates = {}, userId) {
  if (!Object.prototype.hasOwnProperty.call(headerUpdates || {}, "memo")) {
    return { ok: true, skipped: true, reason: "memo-not-supplied" };
  }

  const relatedRecords = await getSalesOrderRelatedRecords(salesOrderId, userId);
  const pairedSalesOrderId = String(
    relatedRecords?.custbody_sb_pairedsalesorder?.id || ""
  ).trim();

  if (!pairedSalesOrderId) {
    return { ok: true, skipped: true, reason: "no-paired-sales-order" };
  }

  const memo = headerUpdates.memo == null ? "" : String(headerUpdates.memo);
  await nsPatch(
    `/salesOrder/${encodeURIComponent(pairedSalesOrderId)}`,
    { memo },
    userId
  );
  cacheDeleteSalesOrder(pairedSalesOrderId);

  return {
    ok: true,
    skipped: false,
    pairedSalesOrderId,
  };
}

function normalizePatchCompareValue(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function netSuiteRecordChangedError(err) {
  const details = err?.responseBody?.["o:errorDetails"] || err?.responseBody?.oErrorDetails || [];
  const text = `${JSON.stringify(details)} ${err?.message || ""}`;
  return /record has been changed/i.test(text);
}

async function patchSalesOrderAndVerify(salesOrderId, patch, userId) {
  const id = String(salesOrderId || "").trim();
  const cleanPatch = Object.fromEntries(
    Object.entries(patch || {}).filter(([, value]) => value !== undefined)
  );
  if (!id || !Object.keys(cleanPatch).length) {
    return { ok: true, skipped: true, id, patch: cleanPatch };
  }

  try {
    await nsPatch(`/salesOrder/${encodeURIComponent(id)}`, cleanPatch, userId);
    cacheDeleteSalesOrder(id);
    return { ok: true, id, patch: cleanPatch, verifiedAfterRecordChanged: false };
  } catch (err) {
    if (!netSuiteRecordChangedError(err)) throw err;

    const fields = Object.keys(cleanPatch).join(",");
    const current = await nsGet(
      `/salesOrder/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`,
      userId
    );
    const matches = Object.entries(cleanPatch).every(([field, expected]) => {
      const actual = current?.[field];
      return normalizePatchCompareValue(actual) === normalizePatchCompareValue(expected);
    });

    if (!matches) throw err;

    console.warn("NetSuite reported Record has been changed after Sales Order PATCH, but verification matched:", {
      id,
      fields: Object.keys(cleanPatch),
    });
    cacheDeleteSalesOrder(id);
    return {
      ok: true,
      id,
      patch: cleanPatch,
      verifiedAfterRecordChanged: true,
    };
  }
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

async function resolveSessionFromRequest(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    return await getSession(token);
  } catch (err) {
    console.warn("Could not resolve session:", err.message);
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

function normalizeDepositType(row) {
  return String(
    row?.Type ||
    row?.type ||
    row?.["Record Type"] ||
    row?.recordType ||
    row?.transactionType ||
    ""
  ).trim();
}

function isCustomerRefundType(type) {
  return String(type || "").trim().toLowerCase() === "customer refund";
}

function normalizeSignedDepositAmount(row) {
  const amount = normalizeDepositAmount(row?.Amount || row?.amount || row?.total);
  return isCustomerRefundType(normalizeDepositType(row))
    ? -Math.abs(amount)
    : amount;
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

function sqlStringList(values) {
  const strings = [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => `'${value.replace(/'/g, "''")}'`)
  )];
  return strings.length ? strings.join(",") : "";
}

function normalizeSuiteQlDeposit(row, salesOrderId) {
  const depositId = String(row.id || row.internalid || "").trim();
  const recordType = String(row.recordtype || "").trim().toLowerCase();
  const type = recordType === "customerrefund" ? "Customer Refund" : "Customer Deposit";
  const amount = normalizeSignedDepositAmount({
    amount: Math.abs(normalizeDepositAmount(
    row.amount || row.foreigntotal || row.total || row.fxamount
    )),
    type,
  });
  const method =
    row.paymentmethod_text ||
    row.payment_method ||
    row.paymentmethod ||
    row["Payment Method"] ||
    "-";
  const labelPrefix = recordType === "customerrefund" ? "RF" : "CD";
  const label = row.tranid || row.documentnumber || (depositId ? `${labelPrefix}${depositId}` : "-");
  const transactionPage = recordType === "customerrefund" ? "custrfnd.nl" : "custdep.nl";
  const link = depositId
    ? `<a href="${netSuiteAppBaseUrl()}/app/accounting/transactions/${transactionPage}?id=${encodeURIComponent(depositId)}" target="_blank">${label}</a>`
    : label;

  return {
    link,
    amount,
    method,
    type,
    soId: String(row.transactioncreatedfrom || row.createdfrom || salesOrderId || ""),
    relatedRefundId: String(row.relatedrefundid || row.custbody_sb_relatedrefund || "").trim(),
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
        DISTINCT
        t.id,
        t.tranid,
        t.trandate,
        t.recordtype,
        tl.createdfrom,
        t.total,
        t.foreigntotal,
        t.paymentmethod,
        BUILTIN.DF(t.paymentmethod) AS paymentmethod_text
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.recordtype = 'customerdeposit'
        AND tl.createdfrom IN (${idList})
      ORDER BY t.trandate DESC, t.id DESC
    `,
    `
      SELECT
        DISTINCT
        t.id,
        t.tranid,
        t.trandate,
        t.recordtype,
        tl.createdfrom,
        t.total
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.recordtype = 'customerdeposit'
        AND tl.createdfrom IN (${idList})
      ORDER BY t.trandate DESC, t.id DESC
    `,
  ];

  const rows = await firstSuccessfulSuiteQlRows(queries, userId, "Customer deposit");
  const deposits = rows.map((row) => normalizeSuiteQlDeposit(row, salesOrderId));
  return enrichDepositsWithRelatedRefundIds(deposits, userId);
}

async function firstSuccessfulSuiteQlRows(queries, userId, label) {
  let lastError = null;
  for (const query of queries) {
    try {
      const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId, "sb");
      return Array.isArray(result?.items) ? result.items : [];
    } catch (err) {
      lastError = err;
      console.warn(`${label} SuiteQL attempt failed:`, err.message);
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function collectSuccessfulSuiteQlRows(queries, userId, label) {
  const rows = [];
  let successCount = 0;
  for (const query of queries) {
    try {
      const result = await nsPostRaw(suiteQlUrl(), { q: query }, userId, "sb");
      successCount += 1;
      rows.push(...(Array.isArray(result?.items) ? result.items : []));
    } catch (err) {
      console.warn(`${label} SuiteQL attempt failed:`, err.message);
    }
  }
  if (!successCount) throw new Error(`${label} SuiteQL failed`);
  return rows;
}

function depositIds(deposits = []) {
  return deposits
    .map((deposit) => String(deposit?.link || "").match(/[?&]id=(\d+)/i)?.[1])
    .filter(Boolean);
}

function relatedRefundIds(deposits = []) {
  return [...new Set(
    deposits
      .map((deposit) => String(deposit?.relatedRefundId || "").trim())
      .filter((id) => /^\d+$/.test(id))
  )];
}

async function enrichDepositsWithRelatedRefundIds(deposits = [], userId) {
  const idList = sqlNumberList(depositIds(deposits));
  if (!idList) return deposits;

  const queries = [
    `
      SELECT
        id,
        custbody_sb_relatedrefund AS relatedrefundid
      FROM customerDeposit
      WHERE id IN (${idList})
    `,
    `
      SELECT
        transactionnumber AS tranid,
        custbody_sb_relatedrefund AS relatedrefundid
      FROM customerDeposit
      WHERE id IN (${idList})
    `,
  ];

  try {
    const rows = await firstSuccessfulSuiteQlRows(queries, userId, "Customer deposit related refund");
    const refundByDepositId = new Map();
    const refundByTranId = new Map();
    rows.forEach((row) => {
      const refundId = String(row.relatedrefundid || row.custbody_sb_relatedrefund || "").trim();
      if (!refundId) return;
      if (row.id) refundByDepositId.set(String(row.id).trim(), refundId);
      if (row.tranid) refundByTranId.set(String(row.tranid).trim(), refundId);
    });

    return deposits.map((deposit) => {
      const id = String(deposit?.link || "").match(/[?&]id=(\d+)/i)?.[1] || "";
      const label = String(deposit?.link || "").replace(/<[^>]*>/g, "").trim();
      const relatedRefundId =
        deposit.relatedRefundId ||
        refundByDepositId.get(id) ||
        refundByTranId.get(label) ||
        "";
      return relatedRefundId ? { ...deposit, relatedRefundId } : deposit;
    });
  } catch (err) {
    console.warn("Could not enrich deposits with related refunds:", err.message);
    return deposits;
  }
}

async function fetchSuiteQlRefundsForSalesOrder(salesOrderId, userId, alternateSalesOrderIds = []) {
  const deposits = await fetchSuiteQlDepositsForSalesOrder(
    salesOrderId,
    userId,
    alternateSalesOrderIds
  );
  const refundIdList = sqlNumberList(relatedRefundIds(deposits));
  if (!refundIdList) return [];

  const queries = [
    `
      SELECT
        id,
        transactionnumber AS tranid,
        'customerrefund' AS recordtype,
        custbody_sb_originalsalesorder AS transactioncreatedfrom,
        total
      FROM customerRefund
      WHERE id IN (${refundIdList})
      ORDER BY transactionnumber
    `,
    `
      SELECT
        transactionnumber AS tranid,
        'customerrefund' AS recordtype,
        custbody_sb_originalsalesorder AS transactioncreatedfrom,
        total
      FROM customerRefund
      WHERE id IN (${refundIdList})
      ORDER BY transactionnumber
    `,
  ];

  const rows = await collectSuccessfulSuiteQlRows(queries, userId, "Customer refund");
  return mergeDeposits(rows.map((row) => normalizeSuiteQlDeposit(row, salesOrderId)));
}

async function fetchAllSuiteQlRefunds(userId, limit = 100) {
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const queries = [
    `
      SELECT
        id,
        transactionnumber AS tranid,
        'customerrefund' AS recordtype,
        custbody_sb_originalsalesorder AS transactioncreatedfrom,
        total
      FROM customerRefund
      WHERE ROWNUM <= ${cappedLimit}
      ORDER BY transactionnumber DESC
    `,
    `
      SELECT
        transactionnumber AS tranid,
        'customerrefund' AS recordtype,
        custbody_sb_originalsalesorder AS transactioncreatedfrom,
        total
      FROM customerRefund
      WHERE ROWNUM <= ${cappedLimit}
      ORDER BY transactionnumber DESC
    `,
  ];

  const rows = await firstSuccessfulSuiteQlRows(queries, userId, "All customer refunds");
  return rows.map((row) => normalizeSuiteQlDeposit(row, row.transactioncreatedfrom || ""));
}

async function loadSalesOrderDeposits(req, salesOrderId, {
  bearerToken = null,
  userId = null,
  prewarmHeaders = null,
  alternateSalesOrderIds = [],
} = {}) {
  try {
    return await fetchSuiteQlDepositsForSalesOrder(
      salesOrderId,
      userId,
      alternateSalesOrderIds
    );
  } catch (err) {
    console.warn(`Could not fetch customer deposits via SuiteQL for SO ${salesOrderId}:`, err.message);
  }

  return [];
}

async function loadSalesOrderRefunds(req, salesOrderId, {
  userId = null,
  alternateSalesOrderIds = [],
} = {}) {
  try {
    return await fetchSuiteQlRefundsForSalesOrder(
      salesOrderId,
      userId,
      alternateSalesOrderIds
    );
  } catch (err) {
    console.warn(`Could not fetch customer refunds via SuiteQL for SO ${salesOrderId}:`, err.message);
  }

  return [];
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

    const { customer, order, items, customFields = [] } = req.body;
    let customerId = customer?.noAddressRequired ? null : customer?.id || null;

    /* ======================================================
   1️⃣ CREATE CUSTOMER IF NEEDED
====================================================== */
    if (!customerId) {
      const createdCustomer = await createNetSuiteCustomer(customer, userId);
      customerId = createdCustomer.id;

      console.log("Created new customer, resolved ID:", customerId, {
        via: createdCustomer.via,
        hasEmail: !!createdCustomer.body?.email,
      });
    }

    /* ======================================================
       2️⃣ LOOKUP SALES EXEC + STORE INFORMATION
    ====================================================== */
    const [salesExecLookup, storeLookup] = await Promise.all([
      order.salesExec
        ? pool
            .query("SELECT netsuiteid, firstname, lastname, email FROM users WHERE id = $1", [order.salesExec])
            .then((resultExec) => resultExec.rows[0] || null)
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

    const salesExecNsId = salesExecLookup?.netsuiteid || null;
    const salesExecName =
      [salesExecLookup?.firstname, salesExecLookup?.lastname].filter(Boolean).join(" ").trim() ||
      salesExecLookup?.email ||
      "";
    const invoiceLocationId = storeLookup?.invoice_location_id || null;
    const storeNsId = storeLookup?.netsuite_internal_id || null;
    const storeName = storeLookup?.name || "";
    const distributionLineLocationId = isDistributionStoreName(storeName)
      ? String(order.warehouse || "").trim()
      : "";
    const shipAddressText = customerShipAddressText(customer);

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
      ...(shipAddressText ? { shipAddress: shipAddressText } : {}),

      item: {
        items: items.map((i, idx) => {
          const itemClass = String(i.class || "").trim().toLowerCase();
          const isServiceItem = itemClass.includes("service");
          const line = {
            item: { id: i.item },
            quantity: i.quantity,
            amount: i.amount / (isVatFreeTaxCode(i.taxCode) ? 1 : 1.2),
            custcol_sb_itemoptionsdisplay: i.options || "",
          };
          applyDistributionLineLocation(line, distributionLineLocationId, storeName);

          // ✅ 60 Night Trial → custcol_sb_30nighttrialoption (List/Record)
          // accepted = 1, declined = 2, n/a = 3
          const trial = String(i.trialOption || "").trim().toLowerCase();
          if (trial === "accepted" || trial === "yes") {
            line.custcol_sb_30nighttrialoption = { id: "1" };
          } else if (trial === "declined" || trial === "no") {
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

          if (i.takenFromStore === true && !isServiceItem) {
            line.custcol_sb_taken_from_store = true;
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
          const lotNumberId =
            normalizeLotNumberId(i.lotnumber) ||
            (!i.inventoryMeta ? lotNumberIdFromInventoryDetail(i.inventoryDetail) : "");
          const lotDetails = fillMissingLotDetailLocations(
            i.lotDetails,
            i.inventoryMeta || i.inventoryDetail
          );
          if (lotDetails) {
            line.custcol_sb_lot_details = lotDetails;
          }
          if (lotNumberId) {
            line.custcol_sb_lotnumber = { id: lotNumberId };
          } else if (i.inventoryMeta) {
            line.custcol_sb_epos_inventory_meta = normalizeInventoryDetailString(i.inventoryMeta);
            line.orderallocationstrategy = null;
          }

          return line;
        }),
      },
    };

    /* ======================================================
       5️⃣ DISTRIBUTION ORDER TYPE (custbody_sb_is_web_order)
    ====================================================== */
    const isDistributionStore = isDistributionStoreName(storeName);
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

    if (Array.isArray(customFields) && customFields.length) {
      const { patch, error } = await buildCustomFieldPatchPayload({
        recordType: "sales_order",
        userId,
        updates: customFields,
      });

      if (error) {
        return res.status(400).json({ ok: false, error });
      }

      Object.assign(orderBody, patch);
      console.log("Custom Sales Order fields included on create:", Object.keys(patch));
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
    await recordDocumentCreated({
      documentType: "sale",
      storeId: order?.store,
      storeName,
    });
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
    // Transfer Orders are intentionally deferred until the order is committed.
    const createdTransfers = [];

    try {
      const alertUserIds = await getEmailAlertUserIds();
      if (alertUserIds.length) {
        const itemMap = await getItemMapCached().catch(() => ({}));
        const itemNameById = Object.fromEntries(
          Object.entries(itemMap || {}).map(([id, info]) => [String(id), info?.name || ""])
        );
        await sendSalesQuoteCreatedEmail({
          documentType: "sale",
          documentId: salesOrderId,
          transactionNumber: so.tranId || so.tranid || "",
          customer,
          order,
          items,
          storeName,
          salesExecName,
          itemNameById,
          appBaseUrl: `${req.protocol}://${req.get("host")}`,
        });
      }
    } catch (err) {
      console.error("Sales Order email alert failed:", err.message);
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
    return res.status(err.statusCode || 500).json({ ok: false, error: err.message });
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
   === PATCH COMMITTED LINE OPTIONS ====================
   ===================================================== */
router.get("/line-options-progress/:requestId", (req, res) => {
  const progress = lineOptionsProgress.get(String(req.params.requestId || "").trim());
  return res.json({
    ok: true,
    stage: progress?.stage || "Preparing...",
    error: progress?.error || "",
  });
});

async function handleCommittedLineOptionsUpdate(req, res) {
  try {
    const { id } = req.params;
    const {
      lineId = "",
      lineIndex = null,
      itemId = "",
      optionsDisplay = "",
      pairedConfirmation = null,
      requestId = "",
    } = req.body || {};

    console.log("[line-options] Request received", {
      salesOrderId: id,
      lineId,
      lineIndex,
      itemId,
      optionsDisplay,
      optionsLength: String(optionsDisplay || "").length,
    });

    const session = await resolveSessionFromRequest(req);
    const userId = session?.id || null;
    const [relatedRecords, salesLines] = await Promise.all([
      getSalesOrderRelatedRecords(id, userId),
      getTransactionItemLines(id, userId),
    ]);
    const pairedSalesOrder = relatedRecords.custbody_sb_pairedsalesorder;
    const hasPairedSalesOrder = !!pairedSalesOrder?.id;
    if (hasPairedSalesOrder && pairedConfirmation?.confirmed !== true) {
      return res.status(400).json({
        ok: false,
        error: "Supplier confirmation is required because an intercompany Sales Order already exists.",
      });
    }

    const intercompanyPo = uniqueRelatedRecords(
      relatedRecords.intercompanyPurchaseOrders
    )[0];
    if (!intercompanyPo?.id) {
      return res.status(400).json({
        ok: false,
        error: "No intercompany Purchase Order was found for this Sales Order.",
      });
    }

    const salesLine =
      salesLines.find((line) => line.lineId === String(lineId || "").trim()) ||
      (Number.isFinite(Number(lineIndex)) ? salesLines[Number(lineIndex)] : null);
    if (!salesLine?.lineId) {
      return res.status(404).json({
        ok: false,
        error: "Could not find the Sales Order line to update.",
      });
    }

    const pairedLinesPromise = hasPairedSalesOrder
      ? getTransactionItemLines(pairedSalesOrder.id, userId)
      : Promise.resolve([]);

    setLineOptionsProgress(requestId, "Saving... Sales Order");
    const salesOrderPatch = await saveSalesOrderLineOptionsViaRestlet(
      id,
      salesLine,
      optionsDisplay,
      userId
    );

    let pairedSalesOrderPatch = null;
    if (hasPairedSalesOrder) {
      setLineOptionsProgress(requestId, "Saving... Intercompany Sales Order");
      const pairedLines = await pairedLinesPromise;
      const pairedLine = findMatchingPurchaseOrderLine({
        salesLines,
        purchaseOrderLines: pairedLines,
        salesLineId: salesLine.lineId,
        itemId: itemId || salesLine.itemId,
        lineIndex,
      });
      if (!pairedLine?.lineId) {
        throw new Error("Could not find the corresponding line on the paired intercompany Sales Order.");
      }

      pairedSalesOrderPatch = await saveSalesOrderLineOptionsViaRestlet(
        pairedSalesOrder.id,
        pairedLine,
        optionsDisplay,
        userId
      );
      cacheDeleteSalesOrder(pairedSalesOrder.id);
    }

    const warnings = [];
    let purchaseOrderPatch = null;
    try {
      setLineOptionsProgress(requestId, "Saving... Intercompany Purchase Order");
      purchaseOrderPatch = await patchPurchaseOrderLineOptions({
        purchaseOrder: intercompanyPo,
        salesLines,
        salesLine,
        itemId: itemId || salesLine.itemId,
        lineIndex,
        optionsDisplay,
        userId,
      });
    } catch (poErr) {
      console.warn("[line-options] Purchase Order line options update failed:", poErr.message || poErr);
      if (hasPairedSalesOrder) throw poErr;
      warnings.push(
        poErr.message ||
          "Sales Order options were updated, but the matching Purchase Order line could not be updated."
      );
    }

    let memoResult = null;
    if (hasPairedSalesOrder) {
      setLineOptionsProgress(requestId, "Saving... Adding memo");
      memoResult = await createPairedFabricChangeMemo({
        salesOrderId: id,
        notes: pairedConfirmation?.notes || "",
        session,
        userId,
      });
    }

    cacheDeleteSalesOrder(id);
    setLineOptionsProgress(requestId, "Saved");

    return res.json({
      ok: true,
      salesOrderId: String(id),
      salesOrderLineId: salesLine.lineId,
      purchaseOrderId: intercompanyPo.id,
      purchaseOrderLineId: purchaseOrderPatch?.matchedRestLine?.lineId || "",
      pairedSalesOrderId: pairedSalesOrder?.id || "",
      salesOrderPatch: {
        method: "RESTlet save-only",
        lineId: salesOrderPatch.lineId,
        itemId: salesOrderPatch.itemId,
        result: salesOrderPatch.result,
      },
      purchaseOrderPatch: purchaseOrderPatch
        ? {
            endpoint: purchaseOrderPatch.endpoint,
            matchedRestLine: purchaseOrderPatch.matchedRestLine,
            value: purchaseOrderPatch.value,
          }
        : null,
      pairedSalesOrderPatch: pairedSalesOrderPatch
        ? {
            method: "RESTlet save-only",
            lineId: pairedSalesOrderPatch.lineId,
            itemId: pairedSalesOrderPatch.itemId,
            result: pairedSalesOrderPatch.result,
          }
        : null,
      memoResult,
      warnings,
      message: hasPairedSalesOrder
        ? "Item options updated on the Sales Order, Purchase Order, and paired Sales Order."
        : "Item options updated on Sales Order and Intercompany Purchase Order.",
    });
  } catch (err) {
    setLineOptionsProgress(req.body?.requestId, "Save failed", err.message || String(err));
    console.error("Line option update failed:", err.message || err);
    return res.status(err.statusCode || 500).json({
      ok: false,
      error:
        err.responseBody?.["o:errorDetails"]?.[0]?.detail ||
        err.message ||
        "Failed to update item options.",
    });
  }
}

router.post("/:id/line-options", handleCommittedLineOptionsUpdate);
router.patch("/:id/line-options", handleCommittedLineOptionsUpdate);
console.log("[line-options] Registered POST/PATCH /:id/line-options route");

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

    console.log("Saving Sales Order custom fields:", {
      salesOrderId: id,
      fields: Object.keys(patch),
    });

    await nsPatch(`/salesOrder/${encodeURIComponent(id)}`, patch, userId);
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
      patchedFields: Object.keys(patch),
      updatedFields: updated,
      customFields,
    });
  } catch (err) {
    console.error("❌ POST /salesorder/:id/custom-fields error:", err.message);
    if (err.responseBody) {
      console.error("NetSuite custom field PATCH response:", err.responseBody);
    }
    return res.status(500).json({
      ok: false,
      error:
        err.responseBody?.["o:errorDetails"]?.[0]?.detail ||
        err.responseBody?.message ||
        err.message ||
        "Failed to save custom fields",
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
   === GET SALES ORDER CUSTOMER REFUNDS ================
   ===================================================== */
router.get("/:id/refunds", async (req, res) => {
  try {
    sendNoStore(res);
    const { id } = req.params;
    const userId = await resolveUserIdFromRequest(req);
    const filtered = ["1", "true", "yes"].includes(String(req.query.filtered || "").toLowerCase());
    if (!filtered) {
      const refunds = await fetchAllSuiteQlRefunds(userId, req.query.limit);
      return res.json({
        ok: true,
        salesOrderId: id,
        refunds,
        debug: { unfiltered: true, count: refunds.length },
      });
    }

    const alternateSalesOrderIds = [];

    try {
      const so = await nsGet(
        `/salesOrder/${encodeURIComponent(id)}?fields=${encodeURIComponent("id,tranId")}`,
        userId,
        "sb"
      );
      alternateSalesOrderIds.push(so?.id, so?.tranId, so?.tranid);
    } catch (err) {
      console.warn(`Could not load SO ${id} identifiers for refund matching:`, err.message);
    }

    const refunds = await loadSalesOrderRefunds(req, id, {
      userId,
      alternateSalesOrderIds,
    });

    return res.json({ ok: true, salesOrderId: id, refunds });
  } catch (err) {
    console.error("❌ GET /salesorder/:id/refunds error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch refunds",
    });
  }
});

/* =====================================================
   === GET SALES ORDER SUPPORT CASES ===================
   ===================================================== */
router.get("/:id/cases", async (req, res) => {
  try {
    sendNoStore(res);
    const { id } = req.params;
    const userId = await resolveUserIdFromRequest(req);
    const cases = await getSalesOrderSupportCases(id, userId);

    return res.json({ ok: true, salesOrderId: id, cases });
  } catch (err) {
    console.error("❌ GET /salesorder/:id/cases error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch support cases",
    });
  }
});

/* =====================================================
   === GET SUPPORT CASE DETAIL =========================
   ===================================================== */
router.get("/cases/:caseId/notes", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const notes = await getSupportCaseNotes(req.params.caseId, userId);
    return res.json({ ok: true, notes });
  } catch (err) {
    console.error("❌ GET /salesorder/cases/:caseId/notes error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch support case notes",
      details: err.responseBody || null,
    });
  }
});

router.post("/cases/:caseId/notes", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const note = await createSupportCaseNote(req.params.caseId, req.body || {}, userId);
    return res.json({ ok: true, note });
  } catch (err) {
    console.error("❌ POST /salesorder/cases/:caseId/notes error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to create support case note",
      details: err.responseBody || null,
    });
  }
});

router.post("/cases/:caseId/workflow-check", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const node = req.body?.node || req.body?.check || req.body || {};
    const result = await evaluateWorkflowCheck({
      caseId: req.params.caseId,
      node,
      inputValue: req.body?.inputValue,
      inputLabel: req.body?.inputLabel,
      inputSource: req.body?.inputSource,
      selectedRecordId: req.body?.selectedRecordId,
    }, userId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("❌ POST /salesorder/cases/:caseId/workflow-check error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to evaluate workflow check",
      details: err.responseBody || null,
    });
  }
});

router.post("/cases/:caseId/workflow-criteria", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const result = await evaluateWorkflowCriteria({
      caseId: req.params.caseId,
      criteria: req.body?.criteria || [],
    }, userId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("❌ POST /salesorder/cases/:caseId/workflow-criteria error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to evaluate workflow criteria",
      details: err.responseBody || null,
    });
  }
});

router.post("/cases/:caseId/workflow-actions/execute", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const result = await executeWorkflowActions({
      caseId: req.params.caseId,
      workflowId: req.body?.workflowId || "",
      actions: req.body?.actions || [],
      approvals: req.body?.approvals || [],
      checks: req.body?.checks || [],
      answers: req.body?.answers || [],
    }, userId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("❌ POST /salesorder/cases/:caseId/workflow-actions/execute error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to execute workflow actions",
      details: err.responseBody || null,
    });
  }
});

router.get("/cases/:caseId/workflow-progress/:workflowId", async (req, res) => {
  try {
    sendNoStore(res);
    await resolveUserIdFromRequest(req);
    const progress = await getCaseWorkflowProgress(req.params.caseId, req.params.workflowId);
    return res.json({ ok: true, progress });
  } catch (err) {
    console.error("GET /salesorder/cases/:caseId/workflow-progress/:workflowId error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to load workflow progress",
    });
  }
});

router.get("/cases/:caseId/workflow-progress", async (req, res) => {
  try {
    sendNoStore(res);
    await resolveUserIdFromRequest(req);
    const progress = await listCaseWorkflowProgress(req.params.caseId);
    return res.json({ ok: true, progress });
  } catch (err) {
    console.error("GET /salesorder/cases/:caseId/workflow-progress error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to load workflow progress",
    });
  }
});

router.put("/cases/:caseId/workflow-progress/:workflowId", async (req, res) => {
  try {
    sendNoStore(res);
    await resolveUserIdFromRequest(req);
    const progress = await saveCaseWorkflowProgress(req.params.caseId, req.params.workflowId, req.body?.progress || req.body || {});
    return res.json({ ok: true, progress });
  } catch (err) {
    console.error("PUT /salesorder/cases/:caseId/workflow-progress/:workflowId error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to save workflow progress",
    });
  }
});

router.delete("/cases/:caseId/workflow-progress/:workflowId", async (req, res) => {
  try {
    sendNoStore(res);
    await resolveUserIdFromRequest(req);
    await deleteCaseWorkflowProgress(req.params.caseId, req.params.workflowId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /salesorder/cases/:caseId/workflow-progress/:workflowId error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to clear workflow progress",
    });
  }
});

router.get("/cases/:caseId", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const supportCase = await getSupportCaseDetail(req.params.caseId, userId);
    return res.json({ ok: true, case: supportCase });
  } catch (err) {
    console.error("❌ GET /salesorder/cases/:caseId error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch support case",
      details: err.responseBody || null,
    });
  }
});

router.patch("/cases/:caseId", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const draft = req.body?.case || req.body?.draft || req.body || {};
    const updated = await updateSupportCaseFromDraft(req.params.caseId, draft, userId);

    return res.json({
      ok: true,
      id: updated.id,
      caseNumber: updated.caseNumber,
    });
  } catch (err) {
    console.error("❌ PATCH /salesorder/cases/:caseId error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to update support case",
      details: err.responseBody || null,
    });
  }
});

/* =====================================================
   === CREATE SUPPORT CASE =============================
   ===================================================== */
router.post("/cases", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const draft = req.body?.case || req.body?.draft || req.body || {};
    const created = await createSupportCaseFromDraft(draft, userId);

    return res.json({
      ok: true,
      id: created.id,
      caseNumber: created.caseNumber,
      location: created.location,
      attachResult: created.attachResult,
    });
  } catch (err) {
    console.error("❌ POST /salesorder/cases error:", err.message);
    return res.status(400).json({
      ok: false,
      error: err.message || "Failed to create support case",
      details: err.responseBody || null,
    });
  }
});

/* =====================================================
   === GENERATE AI DRAFT CASE SUMMARY ==================
   ===================================================== */
router.post("/case-draft-summary", async (req, res) => {
  try {
    sendNoStore(res);
    const enabled = await isAiCaseSummaryEnabled();
    if (!enabled) {
      return res.json({ ok: true, enabled: false, summary: "" });
    }

    const draft = req.body?.draft || {};
    const hasDraftData = [
      draft.subject,
      draft.storeName,
      draft.customerName,
      draft.statusName,
      draft.assignedToName,
      draft.incidentDate,
      draft.typeName,
      draft.subTypeName,
      draft.itemName,
    ].some((value) => String(value || "").trim());

    if (!hasDraftData) {
      return res.json({
        ok: true,
        enabled: true,
        summary: "Start filling in the case details to generate a summary.",
        generated: false,
      });
    }

    const generated = await generateSupportCaseDraftSummary({ draft });
    return res.json({
      ok: true,
      enabled: true,
      summary: generated.text,
      pleaseCheck: generated.pleaseCheck || [],
      model: generated.model,
      usage: generated.usage,
      generated: true,
    });
  } catch (err) {
    console.error("❌ POST /salesorder/case-draft-summary error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to generate draft support case summary",
    });
  }
});

/* =====================================================
   === GET SUPPORT CASE STATUSES =======================
   ===================================================== */
router.get("/case-statuses", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const statuses = await getSupportCaseStatuses(userId);

    return res.json({ ok: true, statuses });
  } catch (err) {
    console.error("❌ GET /salesorder/case-statuses error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch support case statuses",
    });
  }
});

/* =====================================================
   === GET SUPPORT CASE TYPES ==========================
   ===================================================== */
router.get("/case-types", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const types = await getSupportCaseTypes(userId);

    return res.json({ ok: true, types });
  } catch (err) {
    console.error("❌ GET /salesorder/case-types error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch support case types",
    });
  }
});

/* =====================================================
   === GET SUPPORT CASE SUB-TYPES ======================
   ===================================================== */
router.get("/case-sub-types", async (req, res) => {
  try {
    sendNoStore(res);
    const userId = await resolveUserIdFromRequest(req);
    const subTypes = await getSupportCaseSubTypes(userId, req.query.caseTypeId);

    return res.json({ ok: true, subTypes });
  } catch (err) {
    console.error("❌ GET /salesorder/case-sub-types error:", err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to fetch support case sub-types",
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

    const forceRefresh =
      String(req.query.refresh || "") === "1" ||
      String(req.query.refresh || "") === "true";

    if (forceRefresh) {
      soCache.delete(key);
    } else {
      const cached = cacheGet(key);
      if (cached?.data) {
        console.log(`⚡ Sales Order ${id} served from cache`);
        return res.json({ ...cached.data, _cache: "HIT" });
      }
    }

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

    try {
      const relatedRecords = await getSalesOrderRelatedRecords(id, userId);
      so.relatedRecords = relatedRecords;
      Object.assign(so, relatedRecords);
    } catch (err) {
      console.warn("Could not enrich sales order related records:", err.message);
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
      const suiteql = await fetchSalesOrderLineSuiteQl(id, userId);

      if (suiteql && Array.isArray(suiteql.items)) {
        const lineIntercompanyPoMap = await getSalesOrderLineIntercompanyPoMap(id, userId);
        const lotNumberIds = [
          ...new Set(
            suiteql.items
              .map((row) =>
                String(row.custcol_sb_lotnumber || row.CUSTCOL_SB_LOTNUMBER || "").trim()
              )
              .filter(Boolean)
          ),
        ];
        const lotNumberInfoEntries = await Promise.all(
          lotNumberIds.map(async (lotId) => [
            lotId,
            await getInventoryNumberInfo(lotId, userId).catch(() => null),
          ])
        );
        const lotNumberNameById = Object.fromEntries(
          lotNumberInfoEntries
            .map(([lotId, info]) => [lotId, String(info?.number || "").trim()])
            .filter(([, lotName]) => lotName)
        );
        const rawLotDetailsValues = suiteql.items.map((row) =>
          row.custcol_sb_lot_details || row.CUSTCOL_SB_LOT_DETAILS || ""
        );
        const { locationIds, statusIds, inventoryNumberIds } = lotDetailIdSets(rawLotDetailsValues);
        const [
          locationNameById,
          statusNameById,
          inventoryNumberNameById,
          feedLocationNameById,
          feedStatusNameById,
        ] = await Promise.all([
          suiteQlIdNameMap({
            table: "location",
            ids: locationIds,
            nameExpression: "name",
            userId,
          }),
          suiteQlIdNameMap({
            table: "inventorystatus",
            ids: statusIds,
            nameExpression: "name",
            userId,
          }),
          suiteQlIdNameMap({
            table: "inventorynumber",
            ids: inventoryNumberIds,
            nameExpression: "inventorynumber",
            userId,
          }),
          buildLocationNameById(),
          buildInventoryStatusNameById(),
        ]);
        const resolvedLocationNameById = { ...feedLocationNameById, ...locationNameById };
        const resolvedStatusNameById = { ...feedStatusNameById, ...statusNameById };

        const items = await Promise.all(suiteql.items.map(async (r) => {
          const itemId = String(r.item);
          const lineId = String(r.lineid || "");
          const info = itemMap[itemId] || {};
          const itemName = info.name || `Item ${itemId}`;

          // ✅ Keep display quantity positive
          const qty = Math.abs(Number(r.quantity) || 0);

          const rawNet = Number(r.netamount) || 0;
          const rawRate = Number(r.rate) || 0;
          const taxCode = r.taxcode ? String(r.taxcode) : "";
          const vatFree = isVatFreeTaxCode(taxCode);
          const itemNameLower = itemName.toLowerCase();
          const isNegativeValueLine =
            itemNameLower.includes("discount") ||
            itemNameLower.includes("blue light") ||
            itemNameLower.includes("promo") ||
            itemNameLower.includes("promotion") ||
            itemNameLower.includes("voucher") ||
            itemNameLower.includes("trade in") ||
            itemNameLower.includes("recommendation card (as a minus)") ||
            itemNameLower.includes("trade-in");

          // ✅ Financial sign comes from the transaction values, not qty
          let net = rawNet;
          if (rawRate < 0 && rawNet > 0) {
            net = -rawNet;
          }

          const sign = isNegativeValueLine ? -1 : 1;
          net = isNegativeValueLine ? -Math.abs(net) : Math.abs(net);

          // Keep retail/base-price totals separate from the actual transaction line values.
          const retailNet = parseFloat(info.baseprice || 0);
          const retailGross = +(retailNet * 1.2).toFixed(2);
          const retailAmount = +(retailGross * qty * sign).toFixed(2);

          const vat = vatFree ? 0 : +(net * 0.2).toFixed(2);
          const saleprice = +(net + vat).toFixed(2);
          const grossAmount = saleprice;
          const lineRate = qty ? +(net / qty).toFixed(6) : net;

          const fulfilId =
            r.fulfilmentlocation ||
            r.custcol_sb_fulfilmentlocation ||
            r.CUSTCOL_SB_FULFILMENTLOCATION ||
            "";

          const inventoryMeta =
            r.custcol_sb_epos_inventory_meta ||
            r.CUSTCOL_SB_EPOS_INVENTORY_META ||
            "";
          const lotDetails =
            r.custcol_sb_lot_details ||
            r.CUSTCOL_SB_LOT_DETAILS ||
            "";

          const lotNumber =
            r.custcol_sb_lotnumber ||
            r.CUSTCOL_SB_LOTNUMBER ||
            "";
          const suiteQlLotNumberName =
            r.lotnumber_name ||
            r.LOTNUMBER_NAME ||
            "";
          const lotNumberName =
            lotNumberNameById[String(lotNumber || "").trim()] ||
            (String(suiteQlLotNumberName || "").trim() !== String(lotNumber || "").trim()
              ? suiteQlLotNumberName
              : "") ||
            lotNumber ||
            "";
          const lineCreatedPoId =
            r.createdpo ||
            r.CREATEDPO ||
            r.createpo ||
            r.CREATEPO ||
            "";
          const lineCreatedPoName =
            r.createdpo_name ||
            r.CREATEDPO_NAME ||
            r.createpo_name ||
            r.CREATEPO_NAME ||
            "";
          const intercompanyPurchaseOrder = lineCreatedPoId || lineCreatedPoName
            ? {
                id: String(lineCreatedPoId || "").trim(),
                refName: String(lineCreatedPoName || lineCreatedPoId || "").trim(),
              }
            : lineIntercompanyPoMap.get(lineId) || null;

          const trialOptionId =
            r.custcol_sb_30nighttrialoption ||
            r.CUSTCOL_SB_30NIGHTTRIALOPTION ||
            "";

          const takenFromStoreValue =
            r.custcol_sb_taken_from_store ??
            r.CUSTCOL_SB_TAKEN_FROM_STORE ??
            false;
          const takenFromStore =
            takenFromStoreValue === true ||
            ["t", "true", "1", "yes"].includes(
              String(takenFromStoreValue || "").trim().toLowerCase()
            );

          let trialOption = { id: null, refName: "" };
          if (String(trialOptionId) === "1") {
            trialOption = { id: "1", refName: "Accepted" };
          } else if (String(trialOptionId) === "2") {
            trialOption = { id: "2", refName: "Declined" };
          } else if (String(trialOptionId) === "3") {
            trialOption = { id: "3", refName: "N/A" };
          }

          let inventoryDetail = "";
          let inventoryDetailDisplay = "";

          if (inventoryMeta) {
            inventoryDetail = String(inventoryMeta).trim();
            inventoryDetailDisplay = lotDetails || inventoryDetail;
          } else if (lotNumber) {
            const fulfilmentName = fulfilId
              ? String(fulfilmentMap[fulfilId] || "").trim()
              : "";
            const isInStoreLotLine =
              takenFromStore ||
              fulfilmentName.toLowerCase() === "in store" ||
              String(fulfilId || "") === "1";

            const storeDisplayName =
              so?.custbody_sb_primarystore?.refName ||
              so?.custbody_sb_primarystore?.name ||
              so?.custbody_sb_primarystore?.text ||
              "";
            const storeDisplayId =
              so?.location?.id ||
              so?.custbody_sb_primarystore?.id ||
              "";
            const warehouseDisplayName =
              so?.custbody_sb_warehouse?.refName ||
              so?.custbody_sb_warehouse?.name ||
              so?.location?.refName ||
              "";
            const warehouseDisplayId =
              so?.custbody_sb_warehouse?.id ||
              so?.location?.id ||
              "";

            const displayLocationName =
              isInStoreLotLine && storeDisplayName
                ? storeDisplayName
                : warehouseDisplayName;
            const displayLocationId =
              isInStoreLotLine && storeDisplayName
                ? storeDisplayId
                : warehouseDisplayId;

            inventoryDetail = `${qty || 1}|${displayLocationName}|${displayLocationId}|||LOT|${lotNumber}`;
            inventoryDetailDisplay = lotDetails || [displayLocationName, lotNumberName]
              .map((part) => String(part || "").trim())
              .filter(Boolean)
              .join(" | ");
          }
          const effectiveLotDetails = fillMissingLotDetailLocations(lotDetails, inventoryDetail);
          const lotDetailsDisplay = await displayLotDetailsFromIds(effectiveLotDetails, {
            locationNameById: resolvedLocationNameById,
            statusNameById: resolvedStatusNameById,
            inventoryNumberNameById,
            userId,
          });
          if (effectiveLotDetails) inventoryDetailDisplay = lotDetailsDisplay || effectiveLotDetails;

          return {
            lineId,
            isclosed: r.isclosed ?? r.ISCLOSED ?? false,
            isClosed: r.isclosed ?? r.ISCLOSED ?? false,
            item: { id: itemId, refName: itemName, class: info.class || "" },
            itemClass: info.class || "",
            quantity: qty,
            amount: net,
            netamount: net,
            netAmount: net,
            amountNetLine: net,
            rate: lineRate,
            grossAmount,
            grossamt: grossAmount,
            amountGrossLine: saleprice,
            retailAmount,
            vat,
            saleprice,
            taxCode,
            discount: 0,
            inventoryDetail,
            inventoryDetailDisplay,
            lotDetailsDisplay: lotDetailsDisplay || "",
            lotDetails: effectiveLotDetails || "",
            custcol_sb_lot_details: effectiveLotDetails || "",
            custcol_sb_epos_inventory_meta: inventoryMeta || "",
            custcol_sb_lotnumber: lotNumber || "",
            custcol_sb_lotnumber_name: lotNumberName || "",
            lotNumberName: lotNumberName || "",
            createdpoId: intercompanyPurchaseOrder?.id || "",
            createdpoName: intercompanyPurchaseOrder?.refName || "",
            createpo: intercompanyPurchaseOrder,
            createdpo: intercompanyPurchaseOrder,
            intercompanyPurchaseOrder,
            custcol_sb_30nighttrialoption: trialOption,
            custcol_sb_itemoptionsdisplay: r.options || "",
            custcol_sb_taken_from_store: takenFromStore,
            takenFromStore,
            custcol_sb_fulfilmentlocation: {
              id: fulfilId || null,
              refName: fulfilId
                ? fulfilmentMap[fulfilId] || `ID ${fulfilId}`
                : "",
            },
          };
        }));

        const pairedSalesOrderId = String(
          so.relatedRecords?.custbody_sb_pairedsalesorder?.id ||
            so.custbody_sb_pairedsalesorder?.id ||
            ""
        ).trim();

        if (pairedSalesOrderId) {
          const pairedLines = await getTransactionItemLineFulfilmentQuantities(
            pairedSalesOrderId,
            userId
          );
          const salesLines = items.map((line, index) => ({
            lineId: String(line.lineId || "").trim(),
            itemId: String(line.item?.id || "").trim(),
            quantity: Math.abs(Number(line.quantity) || 0),
            index,
          }));

          items.forEach((line, index) => {
            const pairedLine = findMatchingPurchaseOrderLine({
              salesLines,
              purchaseOrderLines: pairedLines,
              salesLineId: line.lineId,
              itemId: line.item?.id,
              lineIndex: index,
            });

            const pairedFulfilledQuantity = Math.abs(
              Number(pairedLine?.fulfilledQuantity) || 0
            );
            const pairedBackorderedQuantity = Math.abs(
              Number(pairedLine?.backorderedQuantity) || 0
            );
            const pairedCommittedQuantity = Math.abs(
              Number(pairedLine?.committedQuantity) || 0
            );
            const lineQuantity = Math.abs(Number(line.quantity) || 0);
            const autoFulfilmentComplete =
              lineQuantity > 0 && pairedFulfilledQuantity >= lineQuantity;
            const autoFulfilmentBackordered =
              lineQuantity > 0 && pairedBackorderedQuantity >= lineQuantity;
            const autoFulfilmentCommitted =
              lineQuantity > 0 && pairedCommittedQuantity >= lineQuantity;
            let autoFulfilmentStatus = "";

            if (autoFulfilmentComplete) {
              autoFulfilmentStatus = "fulfilled";
            } else if (autoFulfilmentBackordered) {
              autoFulfilmentStatus = "backordered";
            } else if (autoFulfilmentCommitted && !line.takenFromStore) {
              autoFulfilmentStatus = "pending-fulfilment";
            } else if (line.takenFromStore) {
              autoFulfilmentStatus = "auto-fulfilment-pending";
            }

            line.pairedSalesOrderLineId = pairedLine?.lineId || "";
            line.pairedFulfilledQuantity = pairedFulfilledQuantity;
            line.pairedBackorderedQuantity = pairedBackorderedQuantity;
            line.pairedCommittedQuantity = pairedCommittedQuantity;
            line.autoFulfilmentComplete = autoFulfilmentComplete;
            line.autoFulfilmentBackordered = autoFulfilmentBackordered;
            line.autoFulfilmentCommitted = autoFulfilmentCommitted;
            line.autoFulfilmentStatus = autoFulfilmentStatus;
          });
        }

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

    cacheSet(key, payload);
    cachePrune();

    return res.json({ ...payload, _cache: forceRefresh ? "BYPASS" : "MISS" });
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
    const buildRestletHeaders = async () => ({
      ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
      "Content-Type": "application/json",
    });

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

    const customerEmailCheck = await ensureCustomerEmailBeforeCommit(
      id,
      headerUpdates,
      userId
    );
    console.log("Customer email available before Sales Order commit:", {
      salesOrderId: id,
      customerId: customerEmailCheck.customerId,
      patched: customerEmailCheck.patched,
    });

    const patchStoreName = await resolvePatchStoreName(id, headerUpdates, userId);
    const patchWarehouseId = String(headerUpdates?.warehouse || "").trim();
    const normalizedLines = (Array.isArray(lines) ? lines : []).map((line) => {
      const grossAmount = Number(
        line.grossAmount ?? line.amountGrossLine ?? line.amount ?? line.saleGrossLine ?? line.grossSaleprice ?? 0
      );
      const grossSaleprice = Number(
        line.grossSaleprice ?? line.saleGrossLine ?? line.saleprice ?? line.amountGrossLine ?? line.grossAmount ?? 0
      );
      const quantity = Number(line.quantity) || 0;
      const qty = quantity || 1;
      const divisor = isVatFreeTaxCode(line.taxCode || line.taxcode) ? 1 : 1.2;
      const netAmount = Number.isFinite(grossAmount)
        ? Number((grossAmount / divisor).toFixed(2))
        : 0;
      const rate = Number.isFinite(netAmount)
        ? Number((netAmount / qty).toFixed(2))
        : 0;
      const trial = String(line.trialOption || "").trim().toLowerCase();
      const trialField =
        trial === "accepted" || trial === "yes"
          ? { id: "1" }
          : trial === "declined" || trial === "no"
            ? { id: "2" }
            : trial === "n/a" || trial === "na"
              ? { id: "3" }
              : null;

      const normalizedLine = {
        ...line,
        lineId: line.lineId || line.lineid || "",
        lineIndex: Number.isFinite(Number(line.lineIndex)) ? Number(line.lineIndex) : null,
        item: line.item || (line.itemId ? { id: String(line.itemId) } : undefined),
        quantity: qty,
        amount: grossAmount,
        saleprice: grossSaleprice,
        netAmount,
        rate,
        discountPct: Number(line.discountPct ?? line.discount ?? 0),
        inventoryMeta: normalizeInventoryDetailString(line.inventoryMeta) || null,
        lotDetails: fillMissingLotDetailLocations(
          lotDetailsFromInventoryDetail(line.inventoryMeta || line.inventoryDetail) || line.lotDetails,
          line.inventoryMeta || line.inventoryDetail
        ) || null,
        trialOption: line.trialOption || null,
        ...(trialField ? { custcol_sb_30nighttrialoption: trialField } : {}),
        custcol_sb_taken_from_store: line.takenFromStore === true,
        grossAmount,
        grossSaleprice,
      };
      return applyDistributionLineLocation(normalizedLine, patchWarehouseId, patchStoreName);
    });

    const commitHeaderUpdates = {
      ...headerUpdates,
      custbody_sb_cust_email_sent: true,
    };

    const payload = {
      id,
      lines: normalizedLines,
      headerUpdates: commitHeaderUpdates,
      deletedLineIds,
      email: customerEmailCheck.email,
      commit: true,
    };
    const payloadText = JSON.stringify(payload);
    console.log("Calling NetSuite RESTlet with payload bytes:", payloadText.length);

    const { response, text, data, attempt } = await postRestletWithRecordChangedRetry(
      restletUrl,
      buildRestletHeaders,
      payloadText,
      "Commit Sales Order"
    );

    const processedPermissionBypass =
      (!response.ok || !data.ok) && isProcessedSalesOrderPermissionPayload(data);
    const restletWarning = processedPermissionBypass
      ? publicNetSuiteError(data)
      : null;

    if (!response.ok || !data.ok) {
      console.error("❌ RESTlet returned error:", text);
      if (processedPermissionBypass) {
        console.warn(
          `Sales Order ${id} appears already approved/processed; continuing with transfer-order automation.`
        );
      } else {
        const safeError = publicNetSuiteError(data);
        return res.status(500).json({
          ok: false,
          ...safeError,
        });
      }
    }

    console.log(
      processedPermissionBypass
        ? `Sales Order ${id} treated as already approved after RESTlet permission response`
        : `Sales Order ${id} approved via RESTlet`
    );
    cacheDeleteSalesOrder(id);

    const customerEmailSentFlag = await markSalesOrderCustomerEmailSent(id, userId).catch((err) => {
      console.error(
        `Failed to set custbody_sb_cust_email_sent on Sales Order ${id}:`,
        err.message
      );
      return {
        ok: false,
        salesOrderId: String(id),
        fieldId: "custbody_sb_cust_email_sent",
        error: err.message || "Customer email sent flag was not updated.",
      };
    });

    const pairedMemoSync = await ensurePairedSalesOrderMemoSync(id, headerUpdates, userId, data);

    const transferCreation = await createLinkedTransferOrdersForSalesOrder({
      salesOrderId: id,
      order: headerUpdates,
      items: normalizedLines,
      storeName: patchStoreName,
      userId,
    }).catch((err) => {
      console.error("Failed to create linked Transfer Orders:", err.message);
      return {
        ok: false,
        skipped: false,
        created: [],
        failed: [{ error: err.message }],
      };
    });

    const transferSalesOrderId =
      transferCreation.salesOrderId || (await resolveSalesOrderInternalId(id, userId));
    const linkedTransferOrdersPromise = approveLinkedTransferOrders(transferSalesOrderId, userId).catch((err) => {
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
      message: processedPermissionBypass
        ? "Sales Order already processed/approved; transfer automation continued"
        : data.message || "Sales Order approved",
      restletResult: data,
      restletBypassed: processedPermissionBypass,
      warnings: [
        ...(restletWarning
          ? [
              `Sales Order was already processed/approved in NetSuite; continuing with transfer automation (${restletWarning.error}).`,
            ]
          : []),
        ...(linkedTransferOrders.ok
          ? []
          : [
              `Linked Transfer Order approval failed for ${
                linkedTransferOrders.failed.length || 1
              } order(s).`,
            ]),
        ...(transferCreation.ok
          ? []
          : [
              `Linked Transfer Order creation failed for ${
                transferCreation.failed?.length || 1
              } order(s).`,
            ]),
        ...(transferCreation.created?.length === 0 && transferCreation.skippedLines?.length
          ? [
              `No linked Transfer Orders were created; ${transferCreation.skippedLines.length} line(s) were skipped.`,
            ]
          : []),
        ...((transferCreation.warnings || []).map(
          (warning) => `Linked Transfer Order pre-check warning: ${warning}`
        )),
        ...(comsSalesValue.ok ? [] : [comsSalesValue.error]),
        ...(customerEmailSentFlag.ok
          ? []
          : [customerEmailSentFlag.error || "Customer email sent flag was not updated."]),
        ...(pairedMemoSync.ok
          ? []
          : [pairedMemoSync.error || "Paired Sales Order memo was not updated."]),
      ],
      customerEmailSentFlag,
      pairedMemoSync,
      transferCreation,
      linkedTransferOrders,
      comsSalesValue,
    });
  } catch (err) {
    console.error("❌ Commit Sales Order failed:", err);
    return res.status(err.statusCode || 500).json({
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
router.post("/:id/shipaddress", async (req, res) => {
  const { id } = req.params;
  const shipAddress = String(req.body?.shipAddress || req.body?.shipaddress || "").trim();
  const contactNumber = String(req.body?.contactNumber || req.body?.phone || "").trim();
  const email = String(req.body?.email || "").trim();

  try {
    if (!id) return res.status(400).json({ ok: false, error: "Missing Sales Order ID." });
    if (!shipAddress && !contactNumber && !email) {
      return res.status(400).json({ ok: false, error: "Missing shipAddress/contact/email update." });
    }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;
    if (token) {
      const session = await getSession(token);
      userId = session?.id || null;
    }

    console.log("Patching Sales Order shipAddress:", {
      id,
      userId: userId || "env default",
      lines: shipAddress.split(/\r?\n/).filter(Boolean).length,
      hasContactNumber: !!contactNumber,
      hasEmail: !!email,
    });

    const currentPatch = {
      ...(shipAddress ? { shipAddress } : {}),
      ...(contactNumber ? { custbody_sb_interco_cus_phone: contactNumber } : {}),
      ...(email ? { custbody_sb_customer_email: email } : {}),
    };
    const currentResult = await patchSalesOrderAndVerify(id, currentPatch, userId);

    const relatedRecords = await getSalesOrderRelatedRecords(id, userId).catch((err) => {
      console.warn("Could not resolve paired Sales Order for customer contact patch:", err.message || err);
      return {};
    });
    const pairedSalesOrderId = String(relatedRecords?.custbody_sb_pairedsalesorder?.id || "").trim();
    let pairedResult = { ok: true, skipped: true, reason: "no-paired-sales-order" };
    if (pairedSalesOrderId && (contactNumber || email)) {
      pairedResult = await patchSalesOrderAndVerify(
        pairedSalesOrderId,
        {
          ...(contactNumber ? { custbody_sb_interco_cus_phone: contactNumber } : {}),
          ...(email ? { custbody_sb_customer_email: email } : {}),
        },
        userId
      );
    }

    return res.json({
      ok: true,
      id,
      shipAddress,
      contactNumber,
      email,
      current: currentResult,
      paired: pairedResult,
    });
  } catch (err) {
    console.error("Failed to patch Sales Order customer delivery/contact fields:", err.message || err);
    if (err.responseBody) console.error("NetSuite customer delivery/contact patch response:", err.responseBody);
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message || "Failed to patch Sales Order customer delivery/contact fields",
      response: err.responseBody || null,
    });
  }
});

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
    const buildRestletHeaders = async () => ({
      ...(await getAuthHeader(restletUrl, "POST", userId, "sb")),
      "Content-Type": "application/json",
    });

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

    const customerEmailSync = await syncCustomerEmailFromHeaderUpdates(
      id,
      headerUpdates,
      userId
    );
    if (customerEmailSync) {
      console.log("Customer email synced during Sales Order save:", {
        salesOrderId: id,
        customerId: customerEmailSync.customerId,
        patched: customerEmailSync.patched,
      });
    }

    const patchStoreName = await resolvePatchStoreName(id, headerUpdates, userId);
    const patchWarehouseId = String(headerUpdates?.warehouse || "").trim();
    const normalizedLines = (Array.isArray(lines) ? lines : []).map((line) => {
      const grossAmount = Number(
        line.grossAmount ?? line.amountGrossLine ?? line.amount ?? line.saleGrossLine ?? line.grossSaleprice ?? 0
      );
      const grossSaleprice = Number(
        line.grossSaleprice ?? line.saleGrossLine ?? line.saleprice ?? line.amountGrossLine ?? line.grossAmount ?? 0
      );
      const quantity = Number(line.quantity) || 0;
      const qty = quantity || 1;
      const divisor = isVatFreeTaxCode(line.taxCode || line.taxcode) ? 1 : 1.2;
      const netAmount = Number.isFinite(grossAmount)
        ? Number((grossAmount / divisor).toFixed(2))
        : 0;
      const rate = Number.isFinite(netAmount)
        ? Number((netAmount / qty).toFixed(2))
        : 0;
      const trial = String(line.trialOption || "").trim().toLowerCase();
      const trialField =
        trial === "accepted" || trial === "yes"
          ? { id: "1" }
          : trial === "declined" || trial === "no"
            ? { id: "2" }
            : trial === "n/a" || trial === "na"
              ? { id: "3" }
              : null;

      const normalizedLine = {
        ...line,
        lineId: line.lineId || line.lineid || "",
        lineIndex: Number.isFinite(Number(line.lineIndex)) ? Number(line.lineIndex) : null,
        item: line.item || (line.itemId ? { id: String(line.itemId) } : undefined),
        quantity: qty,
        amount: grossAmount,
        saleprice: grossSaleprice,
        netAmount,
        rate,
        discountPct: Number(line.discountPct ?? line.discount ?? 0),
        inventoryMeta: normalizeInventoryDetailString(line.inventoryMeta) || null,
        lotDetails: fillMissingLotDetailLocations(
          lotDetailsFromInventoryDetail(line.inventoryMeta || line.inventoryDetail) || line.lotDetails,
          line.inventoryMeta || line.inventoryDetail
        ) || null,
        trialOption: line.trialOption || null,
        ...(trialField ? { custcol_sb_30nighttrialoption: trialField } : {}),
        custcol_sb_taken_from_store: line.takenFromStore === true,
        grossAmount,
        grossSaleprice,
      };
      return applyDistributionLineLocation(normalizedLine, patchWarehouseId, patchStoreName);
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

    const { response, text, data, attempt } = await postRestletWithRecordChangedRetry(
      restletUrl,
      buildRestletHeaders,
      payloadText,
      "Save Sales Order"
    );

    if (!response.ok || !data.ok) {
      console.error("❌ RESTlet returned error (save-only):", text);
      return res.status(500).json({
        ok: false,
        error: data?.error || "NetSuite RESTlet call failed",
        raw: text,
      });
    }

    console.log(`✅ Sales Order ${id} patched via RESTlet (save-only)`);
    const pairedMemoSync = await ensurePairedSalesOrderMemoSync(id, headerUpdates, userId, data);

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
      warnings: pairedMemoSync.ok
        ? []
        : [pairedMemoSync.error || "Paired Sales Order memo was not updated."],
      pairedMemoSync,
    });
  } catch (err) {
    console.error("❌ Save Sales Order failed:", err);
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message || "Unexpected server error",
    });
  }
});

module.exports = router;
