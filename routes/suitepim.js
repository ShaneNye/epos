const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { getSession } = require("../sessions");
const { getAuthHeader } = require("../netsuiteClient");
const { fields, optionFeeds, productFeeds, validationFeeds, validationFields } = require("./suitepimFields");

const router = express.Router();
const jobs = {};
const jobQueue = [];
const optionsCache = new Map();
const MAX_CONCURRENT = Number(process.env.SUITEPIM_PUSH_CONCURRENCY || 4);

function normalizeEnvironment(value) {
  return String(value || process.env.ENVIRONMENT || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function publicEnvironmentName(env) {
  return env === "production" ? "Production" : "Sandbox";
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

async function requireSuitePimSession(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

  const session = await getSession(token);
  if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

  req.eposSession = session;
  next();
}

function envConfig(env) {
  const upper = env === "production" ? "PROD" : "SANDBOX";
  const fallbackRestUrl = process.env.NS_ACCOUNT_DASH
    ? `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/record/v1`
    : "";

  return {
    env,
    account: process.env[`NETSUITE_${upper}_ACCOUNT`] || process.env.NS_ACCOUNT,
    accountDash: process.env[`NETSUITE_${upper}_ACCOUNT_DASH`] || process.env.NS_ACCOUNT_DASH,
    consumerKey: process.env[`NETSUITE_${upper}_KEY`] || process.env.NS_CONSUMER_KEY,
    consumerSecret: process.env[`NETSUITE_${upper}_SECRET`] || process.env.NS_CONSUMER_SECRET,
    restUrl: process.env[`NETSUITE_${upper}_URL`] || fallbackRestUrl,
    productDataUrl:
      process.env[`SUITEPIM_${upper}_PRODUCT_DATA_URL`] ||
      process.env[`NETSUITE_${upper}_PRODUCT_DATA_URL`] ||
      productFeeds[env] ||
      "",
    validationUrl:
      process.env[`SUITEPIM_${upper}_VALIDATION_URL`] ||
      process.env[`NETSUITE_${upper}_VALIDATION_URL`] ||
      validationFeeds[env] ||
      "",
    itemPerformanceUrl:
      process.env[`SUITEPIM_${upper}_ITEM_PERFORMANCE_URL`] ||
      process.env.SUITEPIM_ITEM_PERFORMANCE_URL ||
      process.env[`NETSUITE_${upper}_ITEM_PERFORMANCE_URL`] ||
      process.env.NETSUITE_ITEM_PERFORMANCE_URL ||
      "",
    savedSearchRestletUrl:
      process.env[`SUITEPIM_${upper}_SAVED_SEARCH_RESTLET_URL`] ||
      process.env.SUITEPIM_SAVED_SEARCH_RESTLET_URL ||
      process.env[`NETSUITE_${upper}_SAVED_SEARCH_RESTLET_URL`] ||
      process.env.NETSUITE_SAVED_SEARCH_RESTLET_URL ||
      "",
    imageEndpoint: process.env[`NETSUITE_${upper}_IMAGE_ENDPOINT`] || "",
    priceRestletUrl:
      process.env[`NETSUITE_${upper}_PRICE_RESTLET_URL`] ||
      process.env.NETSUITE_PRICE_RESTLET_URL ||
      "",
  };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function recalcRow(row, changedField = null) {
  const updated = { ...row };
  const vat = 0.2;
  let purchase = parseFloat(updated["Purchase Price"]) || 0;
  let base = parseFloat(updated["Base Price"]) || 0;
  let retail = parseFloat(updated["Retail Price"]) || 0;
  let margin = parseFloat(updated["Margin"]) || 0;

  if (changedField === "Base Price" && base > 0) {
    retail = base * (1 + vat);
    if (purchase > 0) margin = retail / purchase;
  } else if (changedField === "Retail Price" && retail > 0) {
    base = retail / (1 + vat);
    if (purchase > 0) margin = retail / purchase;
  } else if (changedField === "Margin" && purchase > 0 && margin > 0) {
    retail = purchase * margin;
    base = retail / (1 + vat);
  } else if (changedField === "Purchase Price" && purchase > 0 && retail > 0) {
    margin = retail / purchase;
  } else if (base > 0) {
    retail = base * (1 + vat);
    if (purchase > 0) margin = retail / purchase;
  }

  updated["Purchase Price"] = purchase.toFixed(2);
  updated["Base Price"] = base.toFixed(2);
  updated["Retail Price"] = Math.round(retail);
  updated["Margin"] = margin.toFixed(1);
  return updated;
}

function normalizeOption(item) {
  return {
    id: String(item["Internal ID"] || item.internalId || item.id || "").trim(),
    name: String(item.Name || item.name || item.text || item.label || "").trim(),
    raw: item,
  };
}

function optionUrlFor(fieldName, env) {
  const feed = optionFeeds[fieldName];
  if (!feed) return "";
  const fallbackKey = env === "production" ? "defaultProduction" : "defaultSandbox";
  return process.env[feed[env]] || feed[fallbackKey] || "";
}

async function fetchOptionFeed(fieldName, env) {
  const cacheKey = `${env}:${fieldName}`;
  const cached = optionsCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < 10 * 60 * 1000) return cached.options;

  const url = optionUrlFor(fieldName, env);
  if (!url) return [];

  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Option feed failed for ${fieldName}: ${res.status}`);

  const data = parseJson(text);
  const rows = Array.isArray(data) ? data : data.results || data.items || [];
  const options = rows.map(normalizeOption).filter((o) => o.id && o.name);
  optionsCache.set(cacheKey, { loadedAt: Date.now(), options });
  return options;
}

function normalizeMultipleSelects(row, optionMap) {
  const next = { ...row };
  fields.forEach((field) => {
    if (field.fieldType !== "multiple-select") return;
    const raw = next[field.name];
    const names = Array.isArray(raw)
      ? raw.map(String).filter(Boolean)
      : String(raw || "").split(",").map((v) => v.trim()).filter(Boolean);
    next[field.name] = names;

    if (!Array.isArray(next[`${field.name}_InternalId`])) {
      const options = optionMap[field.name] || [];
      next[`${field.name}_InternalId`] = names
        .map((name) => {
          const match = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
          return match?.id || null;
        })
        .filter(Boolean);
    }
  });
  return next;
}

function isValidationValuePresent(value) {
  if (value === true || value === "T" || value === "true") return true;
  if (value === false || value === "F" || value === "false") return false;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function validationInternalId(row) {
  return row.internalid || row["Internal ID"] || row.id || "";
}

function validationDefaultValue(field, internalId) {
  return field.defaultValue === "internalid" ? String(internalId) : field.defaultValue;
}

function enrichValidationRow(row) {
  const internalId = validationInternalId(row);
  const missing = validationFields
    .filter((field) => !isValidationValuePresent(row[field.name]))
    .map((field) => field.name);

  return {
    ...row,
    internalid: internalId,
    missingFields: missing,
    missingCount: missing.length,
  };
}

function normalizePerformanceRows(payload) {
  const rows = Array.isArray(payload) ? payload : payload.results || payload.items || payload.rows || [];
  return rows
    .map((row) => ({
      Date: row.Date || row.date || row.trandate || "",
      Store: row.Store || row.store || row.location || row.Location || "Unknown",
      SalesOrder:
        row.SalesOrder ||
        row.salesOrder ||
        row.salesorder ||
        row.tranid ||
        row.TranID ||
        row.documentNumber ||
        row.documentnumber ||
        row.DocumentNumber ||
        row.transaction ||
        row.Transaction ||
        "",
      Item: row.Item || row.item || row.itemname || row.name || "Unknown",
      ItemType: row.ItemType || row.itemType || row.itemtype || row.Type || row.type || "Unknown",
      Quantity: row.Quantity || row.quantity || row.qty || 0,
      Amount: row.Amount || row.amount || row.formulacurrency || row.netamount || row.total || 0,
    }))
    .filter((row) => row.Date && row.Item);
}

function sqlString(value) {
  return String(value || "").replace(/'/g, "''");
}

async function fetchSuiteQLRows(cfg, userId, query) {
  if (!cfg.accountDash) throw new Error("Missing NetSuite account dash for SuiteQL");

  const suiteqlUrl = `https://${cfg.accountDash}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
  const allItems = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  while (hasMore) {
    const pageUrl = `${suiteqlUrl}?limit=${limit}&offset=${offset}`;
    const response = await fetch(pageUrl, {
      method: "POST",
      headers: {
        ...(await netSuiteHeaders(pageUrl, "POST", userId, cfg)),
        Prefer: "transient",
      },
      body: JSON.stringify({ q: query }),
    });
    const payload = parseJson(await response.text());
    if (!response.ok) throw new Error(`SuiteQL returned ${response.status}: ${JSON.stringify(payload)}`);

    const items = Array.isArray(payload.items) ? payload.items : [];
    allItems.push(...items);
    hasMore = payload.hasMore === true || items.length === limit;
    offset += limit;
  }

  return allItems;
}

async function fetchItemPerformance(cfg, userId) {
  if (cfg.itemPerformanceUrl) {
    const response = await fetch(cfg.itemPerformanceUrl);
    const payload = parseJson(await response.text());
    if (!response.ok) throw new Error(`Item performance feed returned ${response.status}`);
    return { source: "feed", rows: normalizePerformanceRows(payload) };
  }

  if (cfg.savedSearchRestletUrl) {
    const body = {
      searchId: "customsearch_sb_sp_item_performance",
      internalId: 4270,
    };
    const response = await fetch(cfg.savedSearchRestletUrl, {
      method: "POST",
      headers: await netSuiteHeaders(cfg.savedSearchRestletUrl, "POST", userId, cfg),
      body: JSON.stringify(body),
    });
    const payload = parseJson(await response.text());
    if (!response.ok) throw new Error(`Saved search RESTlet returned ${response.status}: ${JSON.stringify(payload)}`);
    return { source: "saved-search-restlet", rows: normalizePerformanceRows(payload) };
  }

  const query = `
    SELECT
      TO_CHAR(t.trandate, 'DD/MM/YYYY') AS "Date",
      COALESCE(BUILTIN.DF(t.subsidiary), 'Unknown') AS "Store",
      t.tranid AS "salesorder",
      BUILTIN.DF(tl.item) AS "Item",
      CASE
        WHEN i.itemtype = 'Service' OR BUILTIN.DF(i.itemtype) LIKE 'Service%' THEN 'Service'
        WHEN i.itemtype = 'InvtPart' OR BUILTIN.DF(i.itemtype) = 'Inventory Item' THEN 'Inventory'
        ELSE BUILTIN.DF(i.itemtype)
      END AS "ItemType",
      ABS(tl.quantity) AS "Quantity",
      (
        SELECT SUM(COALESCE(tal.amount, 0) * -1) * 1.2
        FROM TransactionAccountingLine AS tal
        WHERE tal.transaction = tl.transaction
          AND tal.transactionline = tl.id
      ) AS "Amount"
    FROM transaction AS t
    JOIN transactionline AS tl ON tl.transaction = t.id
    JOIN item AS i ON i.id = tl.item
    LEFT JOIN customer AS c ON c.id = t.entity
    WHERE t.type = 'SalesOrd'
      AND tl.mainline = 'F'
      AND tl.taxline = 'F'
      AND COALESCE(tl.isclosed, 'F') = 'F'
      AND tl.item IS NOT NULL
      AND COALESCE(t.subsidiary, 0) <> 1
      AND COALESCE(UPPER(BUILTIN.DF(t.subsidiary)), '') <> 'HOLDINGS LTD'
      AND COALESCE(UPPER(BUILTIN.DF(t.status)), '') NOT LIKE '%CANCELLED%'
      AND COALESCE(UPPER(BUILTIN.DF(t.customform)), '') <> 'SUSSEX BEDS - CUSTOMER SERVICE ORDER'
      AND COALESCE(UPPER(BUILTIN.DF(t.leadsource)), '') <> 'COMPETITION PRIZE'
      AND COALESCE(UPPER(BUILTIN.DF(t.custbody_sb_bedspecialist)), '') <> 'SHANE NYE'
      AND COALESCE(UPPER(c.entityid), '') NOT LIKE '%I/C%'
      AND COALESCE(UPPER(BUILTIN.DF(t.entity)), '') NOT LIKE '%I/C%'
      AND t.trandate >= ADD_MONTHS(CURRENT_DATE, -6)
    ORDER BY t.trandate DESC
  `;
  const allItems = await fetchSuiteQLRows(cfg, userId, query).catch((err) => {
    throw new Error(`SuiteQL item performance fallback ${err.message.replace(/^SuiteQL /, "")}`);
  });

  return { source: "suiteql-fallback", rows: normalizePerformanceRows({ items: allItems }) };
}

async function netSuiteHeaders(url, method, userId, cfg) {
  return {
    ...(await getAuthHeader(url, method, userId)),
    "Content-Type": "application/json",
  };
}

function normalizeRecordType(value) {
  const type = String(value || "").trim();
  if (!type) return "";

  const compact = type.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = {
    inventoryitem: "inventoryItem",
    invtpart: "lotNumberedInventoryItem",
    inventorypart: "lotNumberedInventoryItem",
    lotnumberedinventoryitem: "lotNumberedInventoryItem",
    lotnumberedinventory: "lotNumberedInventoryItem",
    lotnumberedinvtpart: "lotNumberedInventoryItem",
    service: "serviceSaleItem",
    serviceitemforsale: "serviceSaleItem",
    servicesaleitem: "serviceSaleItem",
    serviceitem: "serviceSaleItem",
  };

  return aliases[compact] || type;
}

async function resolveRecordType(cfg, userId, internalId, preferredType = "") {
  const feedRecordType = normalizeRecordType(preferredType);
  if (feedRecordType) return feedRecordType;

  const candidates = [
    "lotNumberedInventoryItem",
    "serviceSaleItem",
    "inventoryItem",
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  const attempts = [];

  for (const recordType of uniqueCandidates) {
    const url = `${cfg.restUrl}/${recordType}/${encodeURIComponent(internalId)}`;
    const res = await fetch(url, {
      headers: await netSuiteHeaders(url, "GET", userId, cfg),
    });
    const text = await res.text();
    const body = parseJson(text);
    attempts.push({ recordType, url, status: res.status, statusText: res.statusText, body });
    if (res.ok) return recordType;
  }

  const err = new Error(`Unable to resolve NetSuite record type for ${internalId}`);
  err.diagnostics = {
    environment: publicEnvironmentName(cfg.env),
    configuredAccount: cfg.account || null,
    restUrl: cfg.restUrl || null,
    authAccount: process.env.NS_ACCOUNT || null,
    attempts,
  };
  throw err;
}

async function callPriceRestlet({ cfg, userId, internalId, recordType, price }) {
  if (!cfg.priceRestletUrl) throw new Error("Missing NetSuite SuitePim price RESTlet URL");

  const body = {
    internalId: String(internalId),
    recordType: String(recordType),
    price: Number(price),
    priceLevelId: 1,
    currencyId: 1,
    quantityColumns: [0, 1],
  };

  const res = await fetch(cfg.priceRestletUrl, {
    method: "POST",
    headers: {
      ...(await netSuiteHeaders(cfg.priceRestletUrl, "POST", userId, cfg)),
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const data = parseJson(await res.text());
  if (!res.ok || data?.success === false) {
    throw new Error(`Price RESTlet failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function updatePreferredSupplier({ cfg, userId, internalId, recordType, vendorId }) {
  const vendorUrl = `${cfg.restUrl}/${recordType}/${encodeURIComponent(internalId)}/itemVendor`;
  const vendorRes = await fetch(vendorUrl, {
    headers: await netSuiteHeaders(vendorUrl, "GET", userId, cfg),
  });
  const vendorData = parseJson(await vendorRes.text());
  if (!vendorRes.ok) {
    const err = new Error(`Preferred Supplier lookup failed: ${vendorRes.status}`);
    err.diagnostics = { url: vendorUrl, status: vendorRes.status, body: vendorData };
    throw err;
  }
  const lastLine = Array.isArray(vendorData?.items) ? vendorData.items[vendorData.items.length - 1] : null;
  const selfLink = lastLine?.links?.find((l) => l.rel === "self")?.href;
  if (!selfLink) return { skipped: true, reason: "No vendor line found" };

  const patchBody = {
    vendor: { id: String(vendorId) },
    subsidiary: { id: "6" },
    preferred: true,
    currency: { id: "1" },
  };

  const patchRes = await fetch(selfLink, {
    method: "PATCH",
    headers: {
      ...(await netSuiteHeaders(selfLink, "PATCH", userId, cfg)),
      Prefer: "return=representation",
    },
    body: JSON.stringify(patchBody),
  });
  const patchData = parseJson(await patchRes.text()) || { status: patchRes.status };
  if (!patchRes.ok) {
    const err = new Error(`Preferred Supplier update failed: ${patchRes.status}`);
    err.diagnostics = { url: selfLink, status: patchRes.status, body: patchData, payload: patchBody };
    throw err;
  }
  return patchData;
}

async function processRow(row, job) {
  const result = {
    itemId: row["Item ID"] || row["Name"] || row["Internal ID"],
    internalId: row["Internal ID"],
    recordType: null,
    changedFields: Object.keys(row || {}).filter((key) => !["Internal ID", "Item ID", "Name"].includes(key) && !key.endsWith("_InternalId")),
    status: "Pending",
    response: { main: null, prices: [], images: [], supplier: null, error: null, diagnostics: null },
  };

  try {
    if (!row["Internal ID"]) {
      result.status = "Skipped";
      result.response.error = "Missing Internal ID";
      return result;
    }

    const internalId = String(row["Internal ID"]).trim();
    const recordType = await resolveRecordType(job.cfg, job.userId, internalId, row["Record Type"]);
    result.recordType = recordType;
    const payload = {};
    let basePriceVal;

    for (const field of fields) {
      if (!field.internalid && field.name !== "Base Price" && field.name !== "Preferred Supplier") continue;

      if (field.name === "Base Price") {
        const parsed = parseFloat(row[field.name]);
        if (Number.isFinite(parsed)) basePriceVal = parsed;
        continue;
      }

      if (field.name === "Preferred Supplier") {
        const vendorId = row[`${field.name}_InternalId`];
        if (vendorId && ["inventoryItem", "lotNumberedInventoryItem"].includes(recordType)) {
          result.response.supplier = await updatePreferredSupplier({
            cfg: job.cfg,
            userId: job.userId,
            internalId,
            recordType,
            vendorId,
          });
        }
        continue;
      }

      if (field.fieldType === "multiple-select") {
        const ids = row[`${field.name}_InternalId`];
        if (Array.isArray(ids) && ids.length) {
          payload[field.internalid] = { items: ids.map((id) => ({ id: String(id) })) };
        }
        continue;
      }

      if (field.fieldType === "List/Record") {
        const id = row[`${field.name}_InternalId`];
        if (id !== undefined && id !== null && String(id).trim() !== "") {
          payload[field.internalid] = { id: String(id) };
        }
        continue;
      }

      if (field.fieldType === "image") {
        const fileId = row[`${field.name}_InternalId`];
        if (fileId && job.cfg.imageEndpoint) {
          const imageUrl = `${job.cfg.imageEndpoint}&itemid=${encodeURIComponent(internalId)}&fileid=${encodeURIComponent(fileId)}&fieldid=${encodeURIComponent(field.internalid)}`;
          const res = await fetch(imageUrl);
          result.response.images.push({ field: field.name, result: parseJson(await res.text()) });
        }
        continue;
      }

      const value = row[field.name];
      if (value === undefined || value === null || String(value).trim() === "" || !field.internalid) continue;

      if (field.fieldType === "Currency") {
        payload[field.internalid] = parseFloat(value) || 0;
      } else if (field.fieldType === "Checkbox") {
        const v = typeof value === "string" ? value.trim().toLowerCase() : value;
        payload[field.internalid] = v === true || v === 1 || ["true", "t", "1", "y", "yes"].includes(v);
      } else {
        payload[field.internalid] = String(value);
      }
    }

    if (Object.keys(payload).length) {
      const url = `${job.cfg.restUrl}/${recordType}/${encodeURIComponent(internalId)}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          ...(await netSuiteHeaders(url, "PATCH", job.userId, job.cfg)),
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });
      const responseText = await response.text();
      result.response.main = parseJson(responseText) || { status: response.status };
      result.response.diagnostics = {
        url,
        method: "PATCH",
        status: response.status,
        statusText: response.statusText,
        payload,
        response: result.response.main,
      };
      if (!response.ok) {
        const err = new Error(`NetSuite update failed (${response.status}): ${JSON.stringify(result.response.main)}`);
        err.diagnostics = result.response.diagnostics;
        throw err;
      }
    }

    if (basePriceVal !== undefined) {
      try {
        result.response.prices.push({
          success: true,
          result: await callPriceRestlet({
            cfg: job.cfg,
            userId: job.userId,
            internalId,
            recordType,
            price: basePriceVal,
          }),
        });
      } catch (err) {
        result.response.prices.push({ success: false, error: err.message });
      }
    }

    const hasPriceError = result.response.prices.some((p) => p.success === false);
    const changed = result.response.main || result.response.prices.length || result.response.images.length || result.response.supplier;
    result.status = hasPriceError ? "Error" : changed ? "Success" : "Skipped";
    return result;
  } catch (err) {
    result.status = "Error";
    result.response.error = err.message;
    result.response.diagnostics = err.diagnostics || result.response.diagnostics || null;
    console.error("SuitePim row push failed:", {
      itemId: result.itemId,
      internalId: result.internalId,
      recordType: result.recordType,
      changedFields: result.changedFields,
      error: err.message,
      diagnostics: result.response.diagnostics,
    });
    return result;
  }
}

async function processValidationRow(row, job) {
  const result = {
    itemId: row.Name || row.name || row.internalid,
    internalId: row.internalid,
    recordType: null,
    changedFields: Object.keys(row.fields || {}),
    status: "Pending",
    response: { main: null, error: null, diagnostics: null },
  };

  try {
    const internalId = String(row.internalid || "").trim();
    const payload = row.fields || {};
    if (!internalId) {
      result.status = "Skipped";
      result.response.error = "Missing Internal ID";
      return result;
    }
    if (!Object.keys(payload).length) {
      result.status = "Skipped";
      result.response.error = "No missing fields";
      return result;
    }

    const recordType = await resolveRecordType(job.cfg, job.userId, internalId, row.recordType || row["Record Type"]);
    result.recordType = recordType;
    const url = `${job.cfg.restUrl}/${recordType}/${encodeURIComponent(internalId)}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        ...(await netSuiteHeaders(url, "PATCH", job.userId, job.cfg)),
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });
    const body = parseJson(await response.text());
    result.response.main = body || { status: response.status };
    result.response.diagnostics = {
      url,
      method: "PATCH",
      status: response.status,
      statusText: response.statusText,
      payload,
      response: result.response.main,
    };
    if (!response.ok) {
      const err = new Error(`Validation update failed (${response.status}): ${JSON.stringify(result.response.main)}`);
      err.diagnostics = result.response.diagnostics;
      throw err;
    }

    result.status = "Success";
    return result;
  } catch (err) {
    result.status = "Error";
    result.response.error = err.message;
    result.response.diagnostics = err.diagnostics || result.response.diagnostics || null;
    console.error("SuitePim validation row failed:", {
      itemId: result.itemId,
      internalId: result.internalId,
      error: err.message,
      diagnostics: result.response.diagnostics,
    });
    return result;
  }
}

async function runNextJob() {
  if (!jobQueue.length) return;
  const jobId = jobQueue[0];
  const job = jobs[jobId];
  if (!job || job.status !== "pending") return;

  job.status = "running";
  job.startedAt = new Date().toISOString();
  let index = 0;
  const results = [];

  async function worker() {
    while (index < job.rows.length) {
      const row = job.rows[index++];
      const rowResult = job.type === "validation"
        ? await processValidationRow(row, job)
        : await processRow(row, job);
      results.push(rowResult);
      job.processed += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, job.rows.length) }, worker));

  job.results = results;
  job.status = "completed";
  job.finishedAt = new Date().toISOString();
  jobQueue.shift();
  runNextJob().catch((err) => console.error("SuitePim job queue error:", err));
}

router.use(requireSuitePimSession);

router.get("/config", (req, res) => {
  const env = normalizeEnvironment(req.query.environment);
  const cfg = envConfig(env);
  const cleanFields = fields.map(({ optionFeed, ...field }) => ({
    ...field,
    hasOptions: !!optionFeed,
    optionFeed,
  }));
  res.json({
    ok: true,
    environment: publicEnvironmentName(env),
    fields: cleanFields,
    productFeedConfigured: !!cfg.productDataUrl,
    priceRestletConfigured: !!cfg.priceRestletUrl,
  });
});

router.get("/products", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    if (!cfg.productDataUrl) {
      return res.status(500).json({
        ok: false,
        error: `Missing ${env === "production" ? "SUITEPIM_PROD_PRODUCT_DATA_URL" : "SUITEPIM_SANDBOX_PRODUCT_DATA_URL"}`,
      });
    }

    const response = await fetch(cfg.productDataUrl);
    const payload = parseJson(await response.text());
    if (!response.ok) throw new Error(`Product feed returned ${response.status}`);

    const rawRows = Array.isArray(payload) ? payload : payload.results || payload.items || [];
    const optionMap = {};
    await Promise.all(
      fields
        .filter((f) => f.fieldType === "multiple-select" && f.optionFeed)
        .map(async (field) => {
          optionMap[field.name] = await fetchOptionFeed(field.optionFeed, env).catch(() => []);
        })
    );

    const rows = rawRows.map((row) => recalcRow(normalizeMultipleSelects(row, optionMap)));
    res.json({ ok: true, rows, count: rows.length, environment: publicEnvironmentName(env) });
  } catch (err) {
    console.error("SuitePim product load failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/validation/config", (req, res) => {
  const env = normalizeEnvironment(req.query.environment);
  const cfg = envConfig(env);
  res.json({
    ok: true,
    environment: publicEnvironmentName(env),
    fields: validationFields,
    validationFeedConfigured: !!cfg.validationUrl,
  });
});

router.get("/validation", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    if (!cfg.validationUrl) {
      return res.status(500).json({ ok: false, error: "Missing SuitePim validation feed URL" });
    }

    const response = await fetch(cfg.validationUrl);
    const payload = parseJson(await response.text());
    if (!response.ok) throw new Error(`Validation feed returned ${response.status}`);

    const rawRows = Array.isArray(payload) ? payload : payload.results || payload.items || [];
    const rows = rawRows.map(enrichValidationRow);
    res.json({
      ok: true,
      rows,
      count: rows.length,
      fields: validationFields,
      environment: publicEnvironmentName(env),
    });
  } catch (err) {
    console.error("SuitePim validation load failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/item-performance", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const result = await fetchItemPerformance(cfg, userId);
    res.json({
      ok: true,
      environment: publicEnvironmentName(env),
      searchId: "customsearch_sb_sp_item_performance",
      savedSearchInternalId: 4270,
      source: result.source,
      rows: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    console.error("SuitePim item performance failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/item-performance/diagnostics/:salesOrder", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const salesOrder = sqlString(req.params.salesOrder);
    const query = `
      SELECT
        t.tranid AS "salesorder",
        TO_CHAR(t.trandate, 'DD/MM/YYYY') AS "date",
        BUILTIN.DF(t.status) AS "status",
        BUILTIN.DF(t.customform) AS "customform",
        BUILTIN.DF(t.leadsource) AS "leadsource",
        BUILTIN.DF(t.custbody_sb_bedspecialist) AS "bedspecialist",
        BUILTIN.DF(t.entity) AS "entity",
        c.entityid AS "entityid",
        t.subsidiary AS "subsidiaryid",
        BUILTIN.DF(t.subsidiary) AS "subsidiary",
        tl.id AS "lineid",
        tl.mainline AS "mainline",
        tl.taxline AS "taxline",
        tl.isclosed AS "lineclosed",
        tl.item AS "itemid",
        BUILTIN.DF(tl.item) AS "item",
        BUILTIN.DF(i.itemtype) AS "itemtype",
        ABS(tl.quantity) AS "quantity",
        (
          SELECT SUM(COALESCE(tal.amount, 0) * -1) * 1.2
          FROM TransactionAccountingLine AS tal
          WHERE tal.transaction = tl.transaction
            AND tal.transactionline = tl.id
        ) AS "amount"
      FROM transaction AS t
      JOIN transactionline AS tl ON tl.transaction = t.id
      LEFT JOIN item AS i ON i.id = tl.item
      LEFT JOIN customer AS c ON c.id = t.entity
      WHERE t.type = 'SalesOrd'
        AND t.tranid = '${salesOrder}'
      ORDER BY tl.id
    `;
    const rows = await fetchSuiteQLRows(cfg, userId, query);
    res.json({
      ok: true,
      environment: publicEnvironmentName(env),
      salesOrder: req.params.salesOrder,
      rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("SuitePim item performance diagnostic failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/options/:fieldName", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const requested = req.params.fieldName;
    const field = fields.find((f) => f.name.toLowerCase() === requested.toLowerCase());
    if (!field?.optionFeed) return res.json({ ok: true, options: [] });
    const options = await fetchOptionFeed(field.optionFeed, env);
    res.json({ ok: true, options });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/push-updates", async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: "No rows to push" });

    const env = normalizeEnvironment(req.body.environment || req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const jobId = crypto.randomBytes(6).toString("hex");

    jobs[jobId] = {
      id: jobId,
      status: "pending",
      total: rows.length,
      processed: 0,
      results: [],
      rows,
      cfg,
      userId,
      environment: publicEnvironmentName(env),
      createdAt: new Date().toISOString(),
    };
    jobQueue.push(jobId);
    if (jobQueue.length === 1) runNextJob().catch((err) => console.error("SuitePim queue failed:", err));

    res.json({ ok: true, jobId, queuePos: jobQueue.indexOf(jobId) + 1, queueTotal: jobQueue.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/push-validation", async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: "No rows to push" });

    const env = normalizeEnvironment(req.body.environment || req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const jobId = crypto.randomBytes(6).toString("hex");

    jobs[jobId] = {
      id: jobId,
      type: "validation",
      status: "pending",
      total: rows.length,
      processed: 0,
      results: [],
      rows,
      cfg,
      userId,
      environment: publicEnvironmentName(env),
      createdAt: new Date().toISOString(),
    };
    jobQueue.push(jobId);
    if (jobQueue.length === 1) runNextJob().catch((err) => console.error("SuitePim queue failed:", err));

    res.json({ ok: true, jobId, queuePos: jobQueue.indexOf(jobId) + 1, queueTotal: jobQueue.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/push-status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ ok: false, error: "Job not found" });
  res.json({
    ok: true,
    id: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    results: job.results,
    environment: job.environment,
    queuePos: jobQueue.indexOf(job.id) + 1 || 0,
    queueTotal: jobQueue.length,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
});

module.exports = router;
