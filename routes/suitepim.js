const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");
const pool = require("../db");
const { getSession } = require("../sessions");
const { getAuthHeader } = require("../netsuiteClient");
const { fields, optionFeeds, productFeeds, webManagementFeeds, validationFeeds, validationFields } = require("./suitepimFields");

const router = express.Router();
const jobs = {};
const jobQueue = [];
const optionsCache = new Map();
const webManagementCache = new Map();
const suitePimSettingsCache = new Map();
const MAX_CONCURRENT = Number(process.env.SUITEPIM_PUSH_CONCURRENCY || 1);
const CAMPAIGN_BATCH_SIZE = Math.max(1, Number(process.env.SUITEPIM_CAMPAIGN_BATCH_SIZE || 25));
const WEB_MANAGEMENT_CACHE_TTL_MS = Number(process.env.SUITEPIM_WEB_MANAGEMENT_CACHE_TTL_MS || 15 * 60 * 1000);
const WEB_MANAGEMENT_STALE_MS = Number(process.env.SUITEPIM_WEB_MANAGEMENT_STALE_MS || 6 * 60 * 60 * 1000);
const WEB_MANAGEMENT_REFRESH_INTERVAL_MS = Number(
  process.env.SUITEPIM_WEB_MANAGEMENT_REFRESH_INTERVAL_MS || WEB_MANAGEMENT_CACHE_TTL_MS
);
const REASONS_TO_BUY_RECORD_TYPE = "customrecord_sb_reasons_to_buy";
const REASONS_TO_BUY_ICON_RECORD_TYPE =
  process.env.SUITEPIM_REASONS_TO_BUY_ICONS_RECORD_TYPE || "customrecord_sb_reasons_to_buy_icons";
const ITEM_FAQ_RECORD_TYPE = process.env.SUITEPIM_ITEM_FAQ_RECORD_TYPE || "customrecord_sb_web_faq";
const reasonsToBuyFields = [
  { name: "Internal ID", internalid: "id", fieldType: "Free-Form Text", disableField: true },
  { name: "Name", internalid: "name", fieldType: "Free-Form Text", required: true },
  { name: "Description", internalid: "custrecord_sb_rtb_description", fieldType: "Text Area" },
  { name: "Icon", internalid: "custrecord_sb_rtb_icon", fieldType: "image", optionFeed: "Web Product Icons" },
  { name: "Icon Selector", internalid: "custrecord_sb_rtb_icon_selector", fieldType: "List/Record", optionFeed: "Reasons To Buy Icons" },
  { name: "Is Warranty Period", internalid: "custrecord_sb_is_warranty", fieldType: "Checkbox" },
  { name: "Items", internalid: "custrecord_sb_rtb_items", fieldType: "multiple-select", optionFeed: "Items" },
];
const itemFaqFields = [
  { name: "Internal ID", internalid: "id", fieldType: "Free-Form Text", disableField: true },
  { name: "Name", internalid: "name", fieldType: "Free-Form Text", required: true },
  { name: "Description", internalid: "custrecord_sb_web_faq_desc", fieldType: "Text Area" },
  { name: "Items", internalid: "custrecord_sb_web_faq_items", fieldType: "multiple-select", optionFeed: "Items" },
];

let suitePimCampaignsInitialized = false;
let suitePimSettingsInitialized = false;
let suitePimFloorPlansInitialized = false;

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
    webManagementUrl:
      process.env[`SUITEPIM_${upper}_WEB_DATA_URL`] ||
      process.env.SUITEPIM_WEB_DATA_URL ||
      process.env[`SUITEPIM_${upper}_WEB_MANAGEMENT_URL`] ||
      process.env[`NETSUITE_${upper}_WEB_MANAGEMENT_URL`] ||
      webManagementFeeds[env] ||
      "",
    webManagementToken:
      process.env[`SUITEPIM_${upper}_WEB_DATA`] ||
      process.env.SUITEPIM_WEB_DATA ||
      process.env[`SUITEPIM_${upper}_WEB_MANAGEMENT`] ||
      process.env.SUITEPIM_WEB_MANAGEMENT ||
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
    imageEndpoint:
      process.env[`SUITEPIM_${upper}_IMAGE_UPDATE_URL`] ||
      process.env.SUITEPIM_IMAGE_UPDATE_URL ||
      process.env[`NETSUITE_${upper}_IMAGE_ENDPOINT`] ||
      "",
    imageToken:
      process.env[`SUITEPIM_${upper}_IMAGE_UPDATE`] ||
      process.env.SUITEPIM_IMAGE_UPDATE ||
      "",
    priceRestletUrl:
      process.env[`NETSUITE_${upper}_PRICE_RESTLET_URL`] ||
      process.env.NETSUITE_PRICE_RESTLET_URL ||
      "",
    campaignPriceRestletUrl:
      process.env[`NETSUITE_${upper}_CAMPAIGN_PRICE_RESTLET_URL`] ||
      process.env.NETSUITE_CAMPAIGN_PRICE_RESTLET_URL ||
      "",
    wooStoreUrl:
      process.env[`WOO_${upper}_STORE_URL`] ||
      process.env[`WOOCOMMERCE_${upper}_STORE_URL`] ||
      process.env.WOO_STORE_URL ||
      process.env.WOO_BASE_URL ||
      process.env.WOOCOMMERCE_STORE_URL ||
      "",
    wooConsumerKey:
      process.env[`WOO_${upper}_CONSUMER_KEY`] ||
      process.env.WOO_CONSUMER_KEY ||
      "",
    wooConsumerSecret:
      process.env[`WOO_${upper}_CONSUMER_SECRET`] ||
      process.env.WOO_CONSUMER_SECRET ||
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

function clearReasonsToBuyCaches() {
  ["production", "sandbox"].forEach((env) => {
    optionsCache.delete(`${env}:Reasons To Buy`);
    optionsCache.delete(`${env}:Reasons To Buy Icons`);
    optionsCache.delete(`${env}:Web Product Icons`);
    optionsCache.delete(`${env}:Items`);
  });
}

function clearItemFaqCaches() {
  ["production", "sandbox"].forEach((env) => {
    optionsCache.delete(`${env}:Item Faq's`);
    optionsCache.delete(`${env}:Items`);
  });
}

async function ensureSuitePimCampaignTables() {
  if (suitePimCampaignsInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suitepim_campaigns (
      id SERIAL PRIMARY KEY,
      environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
      title TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_suitepim_campaigns_environment_updated
      ON suitepim_campaigns(environment, updated_at DESC);
  `);

  suitePimCampaignsInitialized = true;
}

async function ensureSuitePimSettingsTables() {
  if (suitePimSettingsInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suitepim_field_mappings (
      environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
      mapping_key TEXT NOT NULL,
      json_field TEXT NOT NULL,
      internalid TEXT,
      field_type TEXT,
      option_feed TEXT,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (environment, mapping_key)
    );

    CREATE INDEX IF NOT EXISTS idx_suitepim_field_mappings_environment
      ON suitepim_field_mappings(environment, updated_at DESC);
  `);

  suitePimSettingsInitialized = true;
}

async function ensureSuitePimFloorPlanTables() {
  if (suitePimFloorPlansInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suitepim_floor_plans (
      id SERIAL PRIMARY KEY,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_suitepim_floor_plans_location_updated
      ON suitepim_floor_plans(location_id, updated_at DESC);
  `);

  suitePimFloorPlansInitialized = true;
}

function defaultFieldMappings() {
  return fields.map((field) => ({
    mappingKey: field.name,
    defaultJsonField: field.name,
    jsonField: field.name,
    internalid: field.internalid || "",
    fieldType: field.fieldType || "",
    optionFeed: field.optionFeed || "",
    disableField: field.disableField === true,
    hiddenField: field.hiddenField === true,
    hasOptions: !!field.optionFeed,
    defaultInternalid: field.internalid || "",
    defaultFieldType: field.fieldType || "",
  }));
}

async function loadSuitePimFieldMappings(env) {
  await ensureSuitePimSettingsTables();
  const defaults = defaultFieldMappings();
  const result = await pool.query(
    `SELECT mapping_key, json_field, internalid, field_type, option_feed
       FROM suitepim_field_mappings
      WHERE environment = $1`,
    [env]
  );
  const overrides = new Map(result.rows.map((row) => [row.mapping_key, row]));
  const defaultsByKey = new Map(defaults.map((mapping) => [mapping.mappingKey, mapping]));

  const merged = defaults.map((mapping) => {
    const override = overrides.get(mapping.mappingKey);
    if (!override) return mapping;
    return {
      ...mapping,
      jsonField: override.json_field || mapping.jsonField,
      internalid: override.internalid ?? mapping.internalid,
      fieldType: override.field_type || mapping.fieldType,
      optionFeed: override.option_feed || mapping.optionFeed,
      hasOptions: !!(override.option_feed || mapping.optionFeed),
    };
  });

  result.rows.forEach((row) => {
    if (defaultsByKey.has(row.mapping_key)) return;
    merged.push({
      mappingKey: row.mapping_key,
      defaultJsonField: row.json_field || row.mapping_key,
      jsonField: row.json_field || row.mapping_key,
      internalid: row.internalid || "",
      fieldType: row.field_type || "Free-Form Text",
      optionFeed: row.option_feed || "",
      disableField: false,
      hiddenField: false,
      hasOptions: !!row.option_feed,
      defaultInternalid: "",
      defaultFieldType: "Free-Form Text",
      custom: true,
    });
  });

  return merged;
}

function fieldsFromMappings(mappings) {
  return mappings.map((mapping) => {
    const base = fields.find((field) => field.name === mapping.mappingKey) || {};
    const inferredOptionFeed = /faq/i.test(mapping.jsonField || mapping.mappingKey) ? "Item Faq's" : "";
    const mappedInternalId = mapping.internalid || "";
    const internalid = /faq/i.test(mapping.jsonField || mapping.mappingKey) && mappedInternalId === "custitem_sb_web_faq"
      ? "custitem_sb_web_faqs"
      : mappedInternalId;
    return {
      ...base,
      mappingKey: mapping.mappingKey,
      name: mapping.jsonField || mapping.defaultJsonField || mapping.mappingKey,
      internalid,
      fieldType: inferredOptionFeed ? "multiple-select" : (mapping.fieldType || base.fieldType || ""),
      optionFeed: mapping.optionFeed || base.optionFeed || inferredOptionFeed,
      disableField: base.disableField === true,
      hiddenField: base.hiddenField === true,
    };
  });
}

async function effectiveSuitePimFields(env) {
  return fieldsFromMappings(await loadSuitePimFieldMappings(env));
}

function publicFieldConfig(field) {
  const { optionFeed, ...clean } = field;
  return {
    ...clean,
    hasOptions: !!optionFeed,
    optionFeed,
  };
}

function normalizeJsonFieldList(rows = []) {
  const names = new Set();
  rows.slice(0, 100).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      const clean = String(key || "").trim();
      if (clean && !clean.startsWith("__")) names.add(clean);
    });
  });
  fields.forEach((field) => names.add(field.name));
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function settingsCacheKey(env) {
  return `settings:${env}`;
}

async function buildSuitePimSettingsPayload(env, cfg, userId) {
  let rows = [];

  try {
    const payload = await getWebManagementPayload(env, cfg, { userId });
    rows = Array.isArray(payload?.rows) ? payload.rows : [];
  } catch (err) {
    console.warn("SuitePim settings JSON field sample failed:", err.message);
  }

  return {
    ok: true,
    environment: publicEnvironmentName(env),
    tabs: ["NetSuite Connector", "WooCommerce Connector"],
    jsonFields: normalizeJsonFieldList(rows),
    mappings: await loadSuitePimFieldMappings(env),
    wooCommerceConfigured: wooConfigured(cfg),
    loadedAt: new Date().toISOString(),
  };
}

async function getSuitePimSettingsPayload(env, cfg, userId, { forceRefresh = false } = {}) {
  const key = settingsCacheKey(env);
  if (!forceRefresh && suitePimSettingsCache.has(key)) {
    return {
      ...suitePimSettingsCache.get(key),
      cache: "hit",
    };
  }

  const payload = await buildSuitePimSettingsPayload(env, cfg, userId);
  suitePimSettingsCache.set(key, payload);
  return {
    ...payload,
    cache: forceRefresh ? "refresh" : "miss",
  };
}

function invalidateSuitePimSettingsCache(env) {
  suitePimSettingsCache.delete(settingsCacheKey(env));
}

function cleanCampaignText(value) {
  return String(value ?? "").trim();
}

function normalizeCampaignData(payload = {}) {
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const title = cleanCampaignText(payload.title || data.title);
  if (!title) throw new Error("Campaign title is required.");

  const sections = Array.isArray(data.sections)
    ? data.sections.map((section) => ({
        label: cleanCampaignText(section?.label),
        color: cleanCampaignText(section?.color),
        collapsed: section?.collapsed === true,
        rows: Array.isArray(section?.rows)
          ? section.rows.map((row) => ({
              label: cleanCampaignText(row?.label),
              discount: cleanCampaignText(row?.discount),
              pos: cleanCampaignText(row?.pos),
              discPos: cleanCampaignText(row?.discPos),
              other: cleanCampaignText(row?.other),
              filters: Array.isArray(row?.filters) ? row.filters : [],
            }))
          : [],
      }))
    : [];

  return {
    title,
    sections,
    savedAt: new Date().toISOString(),
  };
}

function mapSuitePimCampaignRow(row) {
  return {
    id: row.id,
    environment: row.environment,
    title: row.title,
    data: row.data || { title: row.title, sections: [] },
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractNetSuiteErrorDetail(body) {
  const detail = body?.["o:errorDetails"]?.[0]?.detail;
  return typeof detail === "string" ? detail : "";
}

function normalizeResolvedRecordType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text === "inventoryitem") return "inventoryItem";
  if (text === "lotnumberedinventoryitem") return "lotNumberedInventoryItem";
  if (text === "servicesaleitem") return "serviceSaleItem";
  return "";
}

function inferRecordTypeFromError(body) {
  const detail = extractNetSuiteErrorDetail(body);
  const match = detail.match(/different type:\s*([a-z0-9]+)\s+from the type specified/i);
  return normalizeResolvedRecordType(match?.[1] || "");
}

async function fetchNetSuiteWithRetry(url, options, attempts = 3) {
  let lastResponse = null;
  let lastBody = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(url, options);
    const text = await res.text();
    const body = parseJson(text);

    lastResponse = res;
    lastBody = body;

    if (res.status !== 429) {
      return { res, body };
    }

    if (attempt < attempts) {
      await sleep(500 * attempt);
    }
  }

  return { res: lastResponse, body: lastBody };
}

function recalcRow(row, changedField = null) {
  const updated = { ...row };
  const vat = 0.2;
  const vatMultiplier = 1 + vat;
  let purchase = parseFloat(updated["Purchase Price"]) || 0;
  let base = parseFloat(updated["Base Price"]) || 0;
  let retail = parseFloat(updated["Retail Price"]) || 0;
  let sale = parseFloat(updated["Sale Price"]) || 0;
  let discount = parseFloat(updated["Discount Percent"]) || 0;
  let margin = parseFloat(updated["Margin"]) || 0;

  if (!changedField && sale > 0) {
    sale *= vatMultiplier;
  }

  if (changedField === "Base Price" && base > 0) {
    retail = base * vatMultiplier;
    if (purchase > 0) margin = retail / purchase;
  } else if (changedField === "Retail Price" && retail > 0) {
    base = retail / vatMultiplier;
    if (purchase > 0) margin = retail / purchase;
  } else if (changedField === "Margin" && purchase > 0 && margin > 0) {
    retail = purchase * margin;
    base = retail / vatMultiplier;
  } else if (changedField === "Purchase Price" && purchase > 0 && retail > 0) {
    margin = retail / purchase;
  } else if (changedField === "Sale Price" && retail > 0) {
    discount = ((retail - sale) / retail) * 100;
  } else if (changedField === "Discount Percent" && retail > 0) {
    discount = Math.max(0, Math.min(100, discount));
    sale = retail * (1 - discount / 100);
  } else if (base > 0) {
    retail = base * vatMultiplier;
    if (purchase > 0) margin = retail / purchase;
  }

  if (changedField !== "Sale Price" && changedField !== "Discount Percent" && retail > 0) {
    if (discount > 0) {
      sale = retail * (1 - Math.max(0, Math.min(100, discount)) / 100);
    } else if (sale > 0) {
      discount = ((retail - sale) / retail) * 100;
    }
  }

  if (retail > 0 && sale > 0 && changedField !== "Discount Percent") {
    discount = ((retail - sale) / retail) * 100;
  }

  updated["Purchase Price"] = purchase.toFixed(2);
  updated["Base Price"] = base.toFixed(2);
  updated["Retail Price"] = Math.round(retail);
  updated["Sale Price"] = sale ? sale.toFixed(2) : "";
  updated["Discount Percent"] = Number.isFinite(discount) ? Math.max(0, discount).toFixed(1) : "0.0";
  updated["Margin"] = margin.toFixed(1);
  return updated;
}

function normalizeOption(item, fieldName = "", cfg = null) {
  const rawId = String(item["Internal ID"] || item.internalId || item.id || "").trim();
  const raw = { ...item };
  const rawUrl = item.URL || item.url || item["File URL"] || item.fileUrl || item.ImageUrl || item.imageUrl || "";
  const fileUrl = normalizeNetSuiteFileUrl(rawUrl, cfg);
  if (fileUrl) {
    raw.URL = fileUrl;
    raw.url = fileUrl;
  }
  const nameSource = fieldName === "Web Product Icons"
    ? item.name || item.Name || item.text || item.label
    : item.Name || item.name || item.text || item.label;
  const name = String(nameSource || (rawId ? `File ${rawId}` : "")).trim();
  return {
    id: rawId,
    name,
    raw,
  };
}

function optionUrlFor(fieldName, env) {
  const feed = optionFeeds[fieldName];
  if (!feed) return "";
  const fallbackKey = env === "production" ? "defaultProduction" : "defaultSandbox";
  if (fieldName === "Reasons To Buy" && process.env.REASONS_TO_BUY_URL) {
    return process.env.REASONS_TO_BUY_URL;
  }
  if (fieldName === "Web Images" && process.env.SUITEPIM_IMAGE_URL) {
    return process.env.SUITEPIM_IMAGE_URL;
  }
  if (fieldName === "Web Product Icons" && process.env.WEB_PROD_ICONS_URL) {
    return process.env.WEB_PROD_ICONS_URL;
  }
  return process.env[feed[env]] || feed[fallbackKey] || "";
}

function optionTokenFor(fieldName, env) {
  if (fieldName === "Reasons To Buy") {
    return process.env.REASONS_TO_BUY || "";
  }
  if (fieldName === "Web Images") {
    return process.env.SUITEPIM_IMAGE || "";
  }
  if (fieldName === "Web Product Icons") {
    return process.env.WEB_PROD_ICONS || "";
  }
  return "";
}

function withSuiteletToken(url, token) {
  if (!url) return "";
  if (!token) return url;

  const parsed = new URL(url);
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

function openAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_SUITEPIM_MODEL || process.env.OPENAI_DESCRIPTION_MODEL || "gpt-4.1-mini",
  };
}

const PRODUCT_DESCRIPTION_PROMPT_SCOPES = {
  netsuite: [
    "You write ecommerce mattress and bed product copy for Sussex Beds.",
    "Generate one benefit-led feature description in UK English.",
    "Use only the provided product data.",
    "Keep it concise: 55 to 95 words.",
    "Focus on customer benefits, comfort, support, practicality, and reassurance.",
    "Do not use bullet points, markdown, headings, or HTML.",
    "Do not invent specs, certifications, or claims not present in the input.",
    "Return plain text only.",
  ],
  ean: [
    "Search the web to identify the product that matches the supplied EAN or GTIN.",
    "Prioritise exact EAN or GTIN matches over product-name similarity.",
    "If the GTIN does not confidently match a product, return found_match false.",
    "If it matches, extract only the requested attributes and write one short benefit-led product description in UK English.",
    "Use the supplied EPOS product name as the canonical product name in the description.",
    "Do not mention the supplier name, external retailer name, or a different source product name in the description.",
    "Return a single valid JSON object only, with no markdown fences and no explanatory text.",
    "Do not invent values. Use empty strings for unknown fields.",
  ],
};

const VALID_PRODUCT_DESCRIPTION_PROMPT_SCOPES = new Set(Object.keys(PRODUCT_DESCRIPTION_PROMPT_SCOPES));
let promptTableReady = false;

async function ensureProductDescriptionPromptTable() {
  if (promptTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_product_description_prompt_elements (
      id SERIAL PRIMARY KEY,
      scope TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_product_description_prompt_elements_scope
      ON ai_product_description_prompt_elements (scope, sort_order, id)
  `);
  promptTableReady = true;
}

function cleanPromptElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 40);
}

async function loadProductDescriptionPromptElements(scope) {
  if (!VALID_PRODUCT_DESCRIPTION_PROMPT_SCOPES.has(scope)) {
    throw new Error("Invalid prompt scope");
  }

  await ensureProductDescriptionPromptTable();
  const result = await pool.query(
    `SELECT prompt_text
       FROM ai_product_description_prompt_elements
      WHERE scope = $1
      ORDER BY sort_order ASC, id ASC`,
    [scope]
  );

  const saved = result.rows.map((row) => String(row.prompt_text || "").trim()).filter(Boolean);
  return saved.length ? saved : PRODUCT_DESCRIPTION_PROMPT_SCOPES[scope];
}

async function saveProductDescriptionPromptElements(scope, elements) {
  if (!VALID_PRODUCT_DESCRIPTION_PROMPT_SCOPES.has(scope)) {
    throw new Error("Invalid prompt scope");
  }

  const cleaned = cleanPromptElements(elements);
  if (!cleaned.length) {
    throw new Error("At least one prompt element is required");
  }

  await ensureProductDescriptionPromptTable();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM ai_product_description_prompt_elements WHERE scope = $1", [scope]);
    for (let i = 0; i < cleaned.length; i += 1) {
      await client.query(
        `INSERT INTO ai_product_description_prompt_elements (scope, prompt_text, sort_order)
         VALUES ($1, $2, $3)`,
        [scope, cleaned[i], i]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return cleaned;
}

function compactList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDescriptionContext(row, reasonOptions = []) {
  const reasons = compactList(row["reasons to buy"]);
  const reasonDetails = reasons
    .map((name) => {
      const match = reasonOptions.find((option) => option.name.toLowerCase() === String(name).trim().toLowerCase());
      const raw = match?.raw || {};
      return {
        name,
        description: String(raw.Description || raw.description || raw["Item Description"] || "").trim(),
      };
    })
    .filter((item) => item.name);

  return {
    eanGtin: row["EAN/GTIN"] || row["EAN"] || row["GTIN"] || row["UPC Code"] || "",
    name: row.Name || row["Display Name"] || "",
    className: row.Class || "",
    subClass: row["Sub-Class"] || "",
    type: row.Type || "",
    comfort: row.Comfort || "",
    springType: row["Spring Type"] || "",
    fillings: row.Fillings || "",
    surface: row.Surface || "",
    warranty: row.Warranty || "",
    leadTime: row["Lead Time"] || "",
    countryOfOrigin: row["Country Of Origin"] || "",
    supplier: row["Supplier Name"] || "",
    storage: row.Storage || "",
    turnable: row.Turnable || "",
    builtFlatPacked: row["Built/Flat Packed"] || "",
    standardSizes: row["Standard-Sizes"] || row["Standard Sizes"] || "",
    category: row.Category || "",
    tags: row.Tags || "",
    shortDescription: row["New Short Desc"] || row["Short Description"] || "",
    dimensions: {
      width: row.Width || "",
      length: row.Length || "",
      height: row.Height || "",
      depth: row.Depth || "",
      unit: row["Dimension Unit"] || "",
    },
    reasonsToBuy: reasonDetails,
  };
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
    }
  }

  return "";
}

function extractOpenAIUsage(payload) {
  const usage = payload?.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0),
  };
}

function parseJsonText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeEnrichmentValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeEnrichedDescription(text, row, enrichment = {}) {
  let output = String(text || "").trim();
  if (!output) return output;

  const canonicalName = String(row.Name || row["Display Name"] || "").trim();
  const supplierName = String(row["Supplier Name"] || "").trim();
  const matchedProductName = String(enrichment.matchedProductName || "").trim();

  [supplierName, matchedProductName]
    .filter(Boolean)
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .forEach((name) => {
      if (!canonicalName || name.toLowerCase() === canonicalName.toLowerCase()) return;
      output = output.replace(new RegExp(escapeRegExp(name), "gi"), canonicalName);
    });

  return output;
}

function mapEnrichmentToFields(data = {}) {
  return {
    "Country Of Origin": normalizeEnrichmentValue(data.country_of_origin),
    Depth: normalizeEnrichmentValue(data.depth),
    Fillings: normalizeEnrichmentValue(data.fillings),
    Height: normalizeEnrichmentValue(data.height),
    Width: normalizeEnrichmentValue(data.width),
    Length: normalizeEnrichmentValue(data.length),
    "Spring Type": normalizeEnrichmentValue(data.spring_type),
    Storage: normalizeEnrichmentValue(data.storage),
    Surface: normalizeEnrichmentValue(data.surface),
    Turnable: normalizeEnrichmentValue(data.turnable),
    Warranty: normalizeEnrichmentValue(data.warranty),
  };
}

function hasMeaningfulFieldUpdates(fieldUpdates = {}) {
  return Object.values(fieldUpdates).some((value) => String(value || "").trim() !== "");
}

async function generateFeatureDescriptionFromRow(row, reasonOptions = []) {
  const openai = openAIConfig();
  if (!openai.apiKey) throw new Error("Missing OPENAI_API_KEY");

  const context = buildDescriptionContext(row, reasonOptions);
  const instructions = (await loadProductDescriptionPromptElements("netsuite")).join(" ");

  const input = [
    "Create a product feature description from this JSON product context:",
    JSON.stringify(context, null, 2),
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openai.model,
      instructions,
      input,
      max_output_tokens: 220,
    }),
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI request failed: ${response.status}`);
  }

  const text = extractOpenAIText(payload);
  if (!text) throw new Error("OpenAI did not return any description text");

  return {
    text,
    model: openai.model,
    usage: extractOpenAIUsage(payload),
    context,
    fieldUpdates: {},
    enriched: false,
  };
}

async function enrichFromGtin(row) {
  const openai = openAIConfig();
  if (!openai.apiKey) throw new Error("Missing OPENAI_API_KEY");

  const gtin = String(row["EAN/GTIN"] || row["EAN"] || row["GTIN"] || row["UPC Code"] || "").trim();
  if (!gtin) return null;

  const lookupContext = {
    eanGtin: gtin,
    name: row.Name || row["Display Name"] || "",
    className: row.Class || "",
    currentKnownFields: {
      comfort: row.Comfort || "",
      springType: row["Spring Type"] || "",
      fillings: row.Fillings || "",
      warranty: row.Warranty || "",
      countryOfOrigin: row["Country Of Origin"] || "",
      width: row.Width || "",
      length: row.Length || "",
      height: row.Height || "",
      depth: row.Depth || "",
      dimensionUnit: row["Dimension Unit"] || "",
    },
  };

  const instructions = (await loadProductDescriptionPromptElements("ean")).join(" ");

  const input = [
    "Find and enrich this product using the EAN/GTIN. Return JSON with these keys exactly:",
    JSON.stringify({
      found_match: true,
      matched_product_name: "",
      feature_description: "",
      country_of_origin: "",
      depth: "",
      fillings: "",
      height: "",
      width: "",
      length: "",
      spring_type: "",
      storage: "",
      surface: "",
      turnable: "",
      warranty: "",
      confidence_notes: "",
    }, null, 2),
    "Lookup context:",
    JSON.stringify(lookupContext, null, 2),
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openai.model,
      instructions,
      input,
      tools: [{ type: "web_search", search_context_size: "low" }],
      tool_choice: "auto",
      max_output_tokens: 320,
    }),
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI web enrichment failed: ${response.status}`);
  }

  const parsed = parseJsonText(extractOpenAIText(payload));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI enrichment did not return valid JSON");
  }

  const fieldUpdates = mapEnrichmentToFields(parsed);
  const matchedProductName = normalizeEnrichmentValue(parsed.matched_product_name);
  return {
    foundMatch: parsed.found_match === true || String(parsed.found_match).toLowerCase() === "true",
    text: sanitizeEnrichedDescription(normalizeEnrichmentValue(parsed.feature_description), row, { matchedProductName }),
    fieldUpdates,
    usage: extractOpenAIUsage(payload),
    model: openai.model,
    matchedProductName,
    confidenceNotes: normalizeEnrichmentValue(parsed.confidence_notes),
  };
}

async function generateFeatureDescription(row, env) {
  const openai = openAIConfig();
  if (!openai.apiKey) throw new Error("Missing OPENAI_API_KEY");

  const gtin = String(row["EAN/GTIN"] || row["EAN"] || row["GTIN"] || row["UPC Code"] || "").trim();
  if (!gtin) {
    const reasonOptions = await fetchOptionFeed("Reasons To Buy", env).catch(() => []);
    return generateFeatureDescriptionFromRow(row, reasonOptions);
  }

  const enrichment = await enrichFromGtin(row);
  if (enrichment?.foundMatch && (enrichment.text || hasMeaningfulFieldUpdates(enrichment.fieldUpdates))) {
    return {
      text: enrichment.text || "",
      model: enrichment.model,
      usage: enrichment.usage,
      context: { eanGtin: gtin, name: row.Name || row["Display Name"] || "" },
      fieldUpdates: enrichment.fieldUpdates,
      enriched: true,
      matchedProductName: enrichment.matchedProductName,
      confidenceNotes: enrichment.confidenceNotes,
    };
  }

  const reasonOptions = await fetchOptionFeed("Reasons To Buy", env).catch(() => []);
  const fallback = await generateFeatureDescriptionFromRow(row, reasonOptions);
  return {
    ...fallback,
    confidenceNotes: enrichment?.confidenceNotes || "",
    matchedProductName: enrichment?.matchedProductName || "",
  };
}

async function fetchOptionFeed(fieldName, env) {
  const cacheKey = `${env}:${fieldName}`;
  const cached = optionsCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < 10 * 60 * 1000) return cached.options;
  if (cached?.inFlight) return cached.inFlight;

  const url = withSuiteletToken(optionUrlFor(fieldName, env), optionTokenFor(fieldName, env));
  if (!url) return [];

  const inFlight = (async () => {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(`Option feed failed for ${fieldName}: ${res.status}`);

    const data = parseJson(text);
    const rows = Array.isArray(data) ? data : data.results || data.items || [];
    const cfg = envConfig(env);
    const options = rows.map((item) => normalizeOption(item, fieldName, cfg)).filter((o) => o.id && o.name);
    optionsCache.set(cacheKey, { loadedAt: Date.now(), options, inFlight: null });
    return options;
  })();

  optionsCache.set(cacheKey, {
    loadedAt: cached?.loadedAt || 0,
    options: cached?.options || [],
    inFlight,
  });

  try {
    return await inFlight;
  } catch (err) {
    optionsCache.delete(cacheKey);
    throw err;
  }
}

function optionFromSuiteQLRow(row, nameKeys = ["name", "Name", "displayname", "Display Name"]) {
  const id = String(row.id || row.ID || row.internalid || row.InternalID || row["Internal ID"] || "").trim();
  const name = String(firstDefinedValue(row, nameKeys) || "").trim();
  return id && name ? { id, name, raw: row } : null;
}

async function fetchReasonsToBuyIconOptions(cfg, userId) {
  const query = `
    SELECT
      id,
      name
    FROM ${REASONS_TO_BUY_ICON_RECORD_TYPE}
    WHERE isinactive = 'F'
    ORDER BY name
  `;
  const rows = await fetchSuiteQLRows(cfg, userId, query);
  return rows.map((row) => optionFromSuiteQLRow(row)).filter(Boolean);
}

async function fetchItemOptions(cfg, userId) {
  const query = `
    SELECT
      id,
      itemid AS name,
      displayname
    FROM item
    WHERE isinactive = 'F'
    ORDER BY itemid
  `;
  const rows = await fetchSuiteQLRows(cfg, userId, query);
  return rows
    .map((row) => {
      const option = optionFromSuiteQLRow(row, ["name", "itemid", "displayname"]);
      if (!option) return null;
      const displayName = String(row.displayname || row.DisplayName || "").trim();
      if (displayName && !option.name.includes(displayName)) {
        option.name = `${option.name} - ${displayName}`;
      }
      return option;
    })
    .filter(Boolean);
}

async function fetchReasonsToBuyOptions(fieldName, env, cfg, userId) {
  if (fieldName === "Reasons To Buy Icons") return fetchReasonsToBuyIconOptions(cfg, userId);
  if (fieldName === "Items") return fetchItemOptions(cfg, userId);
  if (/faq/i.test(fieldName) && cfg && userId) {
    const rows = await fetchItemFaqRows(cfg, userId);
    return rows
      .map((row) => ({
        id: row["Internal ID"],
        name: row.Name,
        raw: row,
      }))
      .filter((option) => option.id && option.name);
  }
  if (fieldName === "Reasons To Buy" && cfg && userId) {
    const rows = await fetchReasonsToBuyRows(cfg, userId);
    return rows
      .map((row) => ({
        id: row["Internal ID"],
        name: row.Name,
        raw: {
          ...row,
          "Icon URL": row.IconUrl,
          "Is Warranty Period": row["Is Warranty Period"],
        },
      }))
      .filter((option) => option.id && option.name);
  }
  return fetchOptionFeed(fieldName, env);
}

function normalizeReferenceValue(row, field) {
  const id = row[field.internalid] || row[`${field.internalid}.id`] || row[`${field.name}_InternalId`] || "";
  const name = row[`${field.internalid}_text`] || row[`${field.internalid}.name`] || row[field.name] || "";
  return {
    id: String(id || "").trim(),
    name: String(name || "").trim(),
  };
}

function reasonsToBuyFeedIconUrl(row, cfg) {
  return normalizeNetSuiteFileUrl(
    row?.["Icon URL"] ||
    row?.IconURL ||
    row?.iconUrl ||
    row?.icon_url ||
    row?.url ||
    row?.URL ||
    "",
    cfg
  );
}

async function fetchReasonsToBuyFeedIconMap(env, cfg) {
  const url = withSuiteletToken(optionUrlFor("Reasons To Buy", env), optionTokenFor("Reasons To Buy", env));
  if (!url) return new Map();

  const response = await fetch(url);
  const payload = parseJson(await response.text());
  if (!response.ok) {
    console.warn(`SuitePim Reasons To Buy feed icon lookup failed: ${response.status}`);
    return new Map();
  }

  const rows = Array.isArray(payload) ? payload : payload.results || payload.items || [];
  const byName = new Map();
  rows.forEach((row) => {
    const name = String(row?.Name || row?.name || "").trim().toLowerCase();
    const iconUrl = reasonsToBuyFeedIconUrl(row, cfg);
    if (name && iconUrl) byName.set(name, iconUrl);
  });
  return byName;
}

function attachReasonsToBuyFeedIcons(rows, iconMap) {
  if (!iconMap?.size) return rows;
  return rows.map((row) => ({
    ...row,
    IconUrl: row.IconUrl || iconMap.get(String(row.Name || "").trim().toLowerCase()) || "",
  }));
}

function normalizeNetSuiteFileUrl(value, cfg) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https:\/\//i.test(raw)) return raw;
  if (!raw.startsWith("/")) return "";

  const accountHost = String(cfg?.accountDash || process.env.NS_ACCOUNT_DASH || "").trim();
  if (!accountHost) return "";
  return `https://${accountHost}.app.netsuite.com${raw}`;
}

function normalizeMultiReferenceIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item?.id || item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\u0005,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function netSuiteInternalIds(value) {
  return normalizeMultiReferenceIds(value).filter((id) => /^\d+$/.test(String(id)));
}

function normalizeItemFaqRow(row) {
  const itemIds = normalizeMultiReferenceIds(row.custrecord_sb_web_faq_items || row.Items_InternalId || row.items_internalid);
  const itemNames = String(row.custrecord_sb_web_faq_items_text || row.Items || row.items || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    "Internal ID": String(row.id || row.ID || row.internalid || row["Internal ID"] || "").trim(),
    Name: String(row.name || row.Name || "").trim(),
    Description: row.custrecord_sb_web_faq_desc || row.Description || "",
    Items: itemNames,
    Items_InternalId: itemIds,
  };
}

async function fetchItemFaqRows(cfg, userId) {
  const query = `
    SELECT
      id,
      name,
      custrecord_sb_web_faq_desc,
      custrecord_sb_web_faq_items,
      BUILTIN.DF(custrecord_sb_web_faq_items) AS custrecord_sb_web_faq_items_text
    FROM ${ITEM_FAQ_RECORD_TYPE}
    ORDER BY name
  `;
  const rows = await fetchSuiteQLRows(cfg, userId, query);
  return rows.map(normalizeItemFaqRow);
}

async function saveItemFaqRecord(cfg, userId, row) {
  const internalId = String(row["Internal ID"] || "").trim();
  const isCreate = !internalId;
  const payload = {};

  for (const field of itemFaqFields) {
    if (field.disableField || !field.internalid) continue;
    if (field.name !== "Name" && row[field.name] === undefined && row[`${field.name}_InternalId`] === undefined) continue;
    const value = row[field.name];
    const internalIds = row[`${field.name}_InternalId`];
    const payloadValue = reasonsValueForPayload(field, value, internalIds);
    if (payloadValue === null && !isCreate) continue;
    payload[field.internalid] = payloadValue;
  }

  if (!String(payload.name || "").trim()) throw new Error("Name is required");

  // If the payload doesn't include an Icon Selector but the client provided an Icon name,
  // try to resolve a matching Reasons To Buy Icon record and set the selector so NetSuite
  // will reference the correct icon record instead of relying on file attach via suitelet.
  try {
    if (!payload.custrecord_sb_rtb_icon_selector && String(row.Icon || "").trim()) {
      const iconName = String(row.Icon || "").trim().toLowerCase();
      const options = await fetchReasonsToBuyIconOptions(cfg, userId).catch((err) => {
        console.warn("Failed to load Reasons To Buy Icons for selector resolution:", err && err.message ? err.message : err);
        return [];
      });
      const match = (options || []).find((opt) => String(opt.name || "").trim().toLowerCase() === iconName);
      if (match && match.id) {
        payload.custrecord_sb_rtb_icon_selector = { id: String(match.id) };
      }
    }
  } catch (err) {
    console.warn("Icon selector resolution failed:", err && err.message ? err.message : err);
  }

  const url = isCreate
    ? `${cfg.restUrl}/${ITEM_FAQ_RECORD_TYPE}`
    : `${cfg.restUrl}/${ITEM_FAQ_RECORD_TYPE}/${encodeURIComponent(internalId)}`;
  const method = isCreate ? "POST" : "PATCH";
  const { res, body } = await fetchNetSuiteWithRetry(url, {
    method,
    headers: {
      ...(await netSuiteHeaders(url, method, userId, cfg)),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = new Error(`Item FAQ save failed (${res.status}): ${JSON.stringify(body)}`);
    err.diagnostics = { url, method, status: res.status, statusText: res.statusText, payload, response: body };
    throw err;
  }

  clearItemFaqCaches();
  return {
    id: body?.id || internalId,
    name: payload.name,
    status: isCreate ? "Created" : "Updated",
    response: body || { status: res.status },
  };
}

function normalizeReasonsToBuyRow(row, cfg) {
  const icon = normalizeReferenceValue(row, reasonsToBuyFields.find((field) => field.name === "Icon"));
  const iconSelector = normalizeReferenceValue(row, reasonsToBuyFields.find((field) => field.name === "Icon Selector"));
  const iconName = String(row.icon_name || row.IconName || icon.name || icon.id || "").trim();
  const itemIds = normalizeMultiReferenceIds(row.custrecord_sb_rtb_items || row.Items_InternalId || row.items_internalid);
  const itemNames = String(row.custrecord_sb_rtb_items_text || row.Items || row.items || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    "Internal ID": String(row.id || row.ID || row.internalid || row["Internal ID"] || "").trim(),
    Name: String(row.name || row.Name || "").trim(),
    Description: row.custrecord_sb_rtb_description || row.Description || "",
    Icon: iconName,
    Icon_InternalId: icon.id,
    IconUrl: normalizeNetSuiteFileUrl(row.icon_url || row.IconUrl || row.custrecord_sb_rtb_icon_url, cfg),
    "Icon Selector": iconSelector.name,
    "Icon Selector_InternalId": iconSelector.id,
    "Is Warranty Period": row.custrecord_sb_is_warranty === true || String(row.custrecord_sb_is_warranty || "").toUpperCase() === "T",
    Items: itemNames,
    Items_InternalId: itemIds,
  };
}

async function fetchReasonsToBuyRows(cfg, userId) {
  const query = `
    SELECT
      id,
      name,
      custrecord_sb_rtb_description,
      custrecord_sb_rtb_icon,
      BUILTIN.DF(custrecord_sb_rtb_icon) AS custrecord_sb_rtb_icon_text,
      custrecord_sb_rtb_icon_selector,
      BUILTIN.DF(custrecord_sb_rtb_icon_selector) AS custrecord_sb_rtb_icon_selector_text,
      custrecord_sb_is_warranty,
      custrecord_sb_rtb_items,
      BUILTIN.DF(custrecord_sb_rtb_items) AS custrecord_sb_rtb_items_text
    FROM ${REASONS_TO_BUY_RECORD_TYPE}
    ORDER BY name
  `;
  const [rows, iconMap] = await Promise.all([
    fetchSuiteQLRows(cfg, userId, query),
    fetchReasonsToBuyFeedIconMap(cfg.env, cfg).catch((err) => {
      console.warn("SuitePim Reasons To Buy feed icon lookup errored:", err.message);
      return new Map();
    }),
  ]);
  return attachReasonsToBuyFeedIcons(rows.map((row) => normalizeReasonsToBuyRow(row, cfg)), iconMap);
}

function reasonsValueForPayload(field, value, internalIds) {
  if (field.fieldType === "Checkbox") return value === true || String(value || "").toLowerCase() === "true";
  if (field.fieldType === "List/Record" || field.fieldType === "image") {
    const id = String(internalIds || value || "").trim();
    if (!id) return null;
    // For the Reasons To Buy image field, send a plain id value instead of an object
    if (field.fieldType === "image" && field.internalid === "custrecord_sb_rtb_icon") {
      return id;
    }
    return { id };
  }
  if (field.fieldType === "multiple-select") {
    const ids = Array.isArray(internalIds) ? internalIds : normalizeMultiReferenceIds(internalIds || value);
    return { items: ids.map((id) => ({ id: String(id) })) };
  }
  return String(value ?? "");
}

async function saveReasonsToBuyRecord(cfg, userId, row) {
  const internalId = String(row["Internal ID"] || "").trim();
  const isCreate = !internalId;
  const payload = {};

  for (const field of reasonsToBuyFields) {
    if (field.disableField || !field.internalid || field.skipFromPayload) continue;
    if (field.name !== "Name" && row[field.name] === undefined && row[`${field.name}_InternalId`] === undefined) continue;
    const value = row[field.name];
    const internalIds = row[`${field.name}_InternalId`];
    const payloadValue = reasonsValueForPayload(field, value, internalIds);
    if (payloadValue === null && !isCreate) continue;
    payload[field.internalid] = payloadValue;
  }

  if (!String(payload.name || "").trim()) throw new Error("Name is required");

  const url = isCreate
    ? `${cfg.restUrl}/${REASONS_TO_BUY_RECORD_TYPE}`
    : `${cfg.restUrl}/${REASONS_TO_BUY_RECORD_TYPE}/${encodeURIComponent(internalId)}`;
  const method = isCreate ? "POST" : "PATCH";
  const { res, body } = await fetchNetSuiteWithRetry(url, {
    method,
    headers: {
      ...(await netSuiteHeaders(url, method, userId, cfg)),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = new Error(`NetSuite ${isCreate ? "create" : "update"} failed (${res.status}): ${JSON.stringify(body)}`);
    err.diagnostics = { url, method, status: res.status, statusText: res.statusText, payload, response: body };
    throw err;
  }

  // If an image file id was selected for the Icon field, apply it via the image suitelet
  const resultResponse = body || { status: res.status };
  const targetId = internalId || String(body?.id || body?.internalId || "");
    try {
    // If payload already includes the image field, no suitelet attach required.
    const fileId = row["Icon_InternalId"];
    if (!payload.custrecord_sb_rtb_icon && fileId && String(fileId).trim() !== "" && cfg.imageEndpoint && targetId) {
      const suiteletUrl = cfg.imageToken ? withSuiteletToken(cfg.imageEndpoint, cfg.imageToken) : cfg.imageEndpoint;
      const imageUrl = `${suiteletUrl}&itemid=${encodeURIComponent(targetId)}&fileid=${encodeURIComponent(String(fileId))}&fieldid=${encodeURIComponent("custrecord_sb_rtb_icon")}&rectype=${encodeURIComponent(REASONS_TO_BUY_RECORD_TYPE)}`;
      const imgRes = await fetch(imageUrl, { method: "GET" });
      try {
        const imgBody = parseJson(await imgRes.text());
        resultResponse.images = resultResponse.images || [];
        resultResponse.images.push({ field: "Icon", fileId: String(fileId), mode: "suitelet", result: imgBody });
      } catch (e) {
        resultResponse.images = resultResponse.images || [];
        resultResponse.images.push({ field: "Icon", fileId: String(fileId), mode: "suitelet", result: await imgRes.text() });
      }
    }
  } catch (err) {
    console.warn("Applying Reasons To Buy icon via suitelet failed:", err && err.message ? err.message : err);
  }

  clearReasonsToBuyCaches();
  return {
    status: "Success",
    internalId: targetId,
    name: row.Name,
    action: isCreate ? "Created" : "Updated",
    response: resultResponse,
  };
}

async function patchReasonsToBuyItems(cfg, userId, reasonId, itemIds) {
  const ids = Array.from(new Set(netSuiteInternalIds(itemIds)));
  const url = `${cfg.restUrl}/${REASONS_TO_BUY_RECORD_TYPE}/${encodeURIComponent(reasonId)}`;
  const payload = {
    custrecord_sb_rtb_items: {
      items: ids.map((id) => ({ id: String(id) })),
    },
  };
  const { res, body } = await fetchNetSuiteWithRetry(url, {
    method: "PATCH",
    headers: {
      ...(await netSuiteHeaders(url, "PATCH", userId, cfg)),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`Reasons To Buy linked items update failed (${res.status})`);
    err.diagnostics = { url, method: "PATCH", status: res.status, statusText: res.statusText, payload, response: body };
    throw err;
  }
  return body || { status: res.status };
}

async function syncReasonsToBuyItemLinks({ cfg, userId, itemId, previousIds = [], nextIds = [] }) {
  const itemInternalId = String(itemId || "").trim();
  if (!itemInternalId) return [];

  const previous = new Set(netSuiteInternalIds(previousIds));
  const next = new Set(netSuiteInternalIds(nextIds));
  const reasonIds = Array.from(new Set([...previous, ...next]));
  if (!reasonIds.length) return [];

  const rows = await fetchReasonsToBuyRows(cfg, userId);
  const byId = new Map(rows.map((row) => [String(row["Internal ID"] || ""), row]));
  const results = [];

  for (const reasonId of reasonIds) {
    const row = byId.get(String(reasonId));
    if (!row) continue;
    const currentItems = new Set(netSuiteInternalIds(row.Items_InternalId));
    if (next.has(reasonId)) currentItems.add(itemInternalId);
    else currentItems.delete(itemInternalId);

    const before = Array.from(new Set(netSuiteInternalIds(row.Items_InternalId))).sort();
    const after = Array.from(currentItems).sort();
    if (JSON.stringify(before) === JSON.stringify(after)) {
      results.push({ reasonId, status: "Unchanged", itemCount: after.length });
      continue;
    }

    const response = await patchReasonsToBuyItems(cfg, userId, reasonId, after);
    results.push({
      reasonId,
      status: next.has(reasonId) ? "Added" : "Removed",
      itemCount: after.length,
      response,
    });
  }

  if (results.length) clearReasonsToBuyCaches();
  return results;
}

async function patchItemFaqItems(cfg, userId, faqId, itemIds) {
  const ids = Array.from(new Set(netSuiteInternalIds(itemIds)));
  const url = `${cfg.restUrl}/${ITEM_FAQ_RECORD_TYPE}/${encodeURIComponent(faqId)}`;
  const payload = {
    custrecord_sb_web_faq_items: {
      items: ids.map((id) => ({ id: String(id) })),
    },
  };
  const { res, body } = await fetchNetSuiteWithRetry(url, {
    method: "PATCH",
    headers: {
      ...(await netSuiteHeaders(url, "PATCH", userId, cfg)),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = new Error(`Item FAQ linked items update failed (${res.status})`);
    err.diagnostics = { url, method: "PATCH", status: res.status, statusText: res.statusText, payload, response: body };
    throw err;
  }
  return body || { status: res.status };
}

async function syncItemFaqLinks({ cfg, userId, itemId, previousIds = [], nextIds = [] }) {
  const itemInternalId = String(itemId || "").trim();
  if (!itemInternalId) return [];

  const previous = new Set(netSuiteInternalIds(previousIds));
  const next = new Set(netSuiteInternalIds(nextIds));
  const faqIds = Array.from(new Set([...previous, ...next]));
  if (!faqIds.length) return [];

  const rows = await fetchItemFaqRows(cfg, userId);
  const byId = new Map(rows.map((row) => [String(row["Internal ID"] || ""), row]));
  const results = [];

  for (const faqId of faqIds) {
    const row = byId.get(String(faqId));
    if (!row) continue;
    const currentItems = new Set(netSuiteInternalIds(row.Items_InternalId));
    if (next.has(faqId)) currentItems.add(itemInternalId);
    else currentItems.delete(itemInternalId);

    const before = Array.from(new Set(netSuiteInternalIds(row.Items_InternalId))).sort();
    const after = Array.from(currentItems).sort();
    if (JSON.stringify(before) === JSON.stringify(after)) {
      results.push({ faqId, status: "Unchanged", itemCount: after.length });
      continue;
    }

    const response = await patchItemFaqItems(cfg, userId, faqId, after);
    results.push({
      faqId,
      status: next.has(faqId) ? "Added" : "Removed",
      itemCount: after.length,
      response,
    });
  }

  if (results.length) clearItemFaqCaches();
  return results;
}

function buildOptionLookup(options = []) {
  const byName = new Map();
  options.forEach((option) => {
    const fullName = String(option.name || "").trim().toLowerCase();
    if (fullName && !byName.has(fullName)) byName.set(fullName, option);

    const leafName = String(option.name || "").split(" : ").pop().trim().toLowerCase();
    if (leafName && !byName.has(leafName)) byName.set(leafName, option);
  });
  return byName;
}

async function loadMultipleSelectOptionMap(env, cfg = null, userId = null) {
  const optionFeedPromises = new Map();
  const optionMap = {};

  fields
    .filter((field) => field.fieldType === "multiple-select" && field.optionFeed)
    .forEach((field) => {
      if (!optionFeedPromises.has(field.optionFeed)) {
        optionFeedPromises.set(field.optionFeed, fetchReasonsToBuyOptions(field.optionFeed, env, cfg, userId).catch(() => []));
      }
    });

  await Promise.all(
    fields
      .filter((field) => field.fieldType === "multiple-select" && field.optionFeed)
      .map(async (field) => {
        const options = await optionFeedPromises.get(field.optionFeed);
        optionMap[field.name] = {
          options,
          byName: buildOptionLookup(options),
        };
      })
  );

  return optionMap;
}

function normalizeMultipleSelects(row, optionMap) {
  const next = { ...row };
  fields.forEach((field) => {
    if (field.fieldType !== "multiple-select") return;
    const raw = next[field.name];
    const names = Array.isArray(raw)
      ? raw.map(String).filter(Boolean)
      : String(raw || "").split(/[\u0005,]/).map((v) => v.trim()).filter(Boolean);
    next[field.name] = names;

    if (!Array.isArray(next[`${field.name}_InternalId`])) {
      const optionEntry = Array.isArray(optionMap[field.name])
        ? { options: optionMap[field.name] }
        : optionMap[field.name] || {};
      const byName = optionEntry.byName || buildOptionLookup(optionEntry.options || []);
      next[`${field.name}_InternalId`] = names
        .map((name) => {
          const wanted = String(name || "").trim().toLowerCase();
          const match = byName.get(wanted);
          return match?.id || null;
        })
        .filter(Boolean);
    }
  });
  return next;
}

function firstDefinedValue(row, keys = []) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return row[keys[0]];
}

function compactFieldKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstLooseDefinedValue(row, keys = []) {
  const exact = firstDefinedValue(row, keys);
  if (exact !== undefined && exact !== null && String(exact).trim() !== "") return exact;

  const aliases = new Set(keys.map(compactFieldKey));
  const matchedKey = Object.keys(row || {}).find((key) => aliases.has(compactFieldKey(key)));
  return matchedKey ? row[matchedKey] : "";
}

function childItemName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parts = text.split(" : ").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

function normalizeRowAliases(row) {
  const next = { ...row };

  next["Internal ID"] = String(firstLooseDefinedValue(next, [
    "Internal ID",
    "InternalID",
    "internalid",
    "id",
  ]) || "").trim();

  next["Item ID"] = firstLooseDefinedValue(next, [
    "Item ID",
    "Item Name/Number",
    "Item Name",
    "itemid",
    "itemId",
  ]) || "";

  next.Name = childItemName(firstDefinedValue(next, [
    "Name",
    "Item Name/Number",
    "Item Name",
    "itemid",
    "itemId",
  ]) || "");

  next["Display Name"] = firstDefinedValue(next, [
    "Display Name",
    "Display Name/Code",
    "Display Name Code",
    "DisplayName",
    "displayname",
  ]) || "";

  next["Record Type"] = firstLooseDefinedValue(next, [
    "Record Type",
    "recordtype",
    "recordType",
  ]) || next["Record Type"] || "";

  next["Woo ID"] = String(firstLooseDefinedValue(next, [
    "Woo ID",
    "WooID",
    "WooCommerce ID",
    "WooCommerceID",
    "Magento ID",
    "MagentoID",
    "custitem_magentoid",
  ]) || "").trim();

  next["Web SKU"] = String(firstLooseDefinedValue(next, [
    "Web SKU",
    "Woo SKU",
    "WooCommerce SKU",
    "SKU",
    "sku",
    "custitemwoo_commerce_sku",
  ]) || "").trim();

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
    inventory: "inventoryItem",
    inventoryitemforsale: "inventoryItem",
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

  return aliases[compact] || normalizeResolvedRecordType(type);
}

async function resolveRecordType(cfg, userId, internalId, preferredType = "") {
  const feedRecordType = normalizeRecordType(preferredType);
  if (feedRecordType) return feedRecordType;

  const candidates = [
    "inventoryItem",
    "lotNumberedInventoryItem",
    "serviceSaleItem",
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  const attempts = [];

  for (const recordType of uniqueCandidates) {
    const url = `${cfg.restUrl}/${recordType}/${encodeURIComponent(internalId)}`;
    const { res, body } = await fetchNetSuiteWithRetry(url, {
      headers: await netSuiteHeaders(url, "GET", userId, cfg),
    });
    attempts.push({ recordType, url, status: res.status, statusText: res.statusText, body });
    if (res.ok) return recordType;

    const inferred = inferRecordTypeFromError(body);
    if (inferred) return inferred;
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

async function callPriceRestlet({ cfg, userId, internalId, recordType, price, priceLevelId = 1, priceLevelName = "" }) {
  if (!cfg.priceRestletUrl) throw new Error("Missing NetSuite SuitePim price RESTlet URL");

  const body = {
    internalId: String(internalId),
    recordType: String(recordType),
    price: Number(price),
    priceLevelId,
    priceLevelName,
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

async function callCampaignPriceBatchRestlet({ cfg, userId, updates, batchId }) {
  if (!cfg.campaignPriceRestletUrl) throw new Error("Missing NetSuite SuitePim campaign price batch RESTlet URL");

  const res = await fetch(cfg.campaignPriceRestletUrl, {
    method: "POST",
    headers: {
      ...(await netSuiteHeaders(cfg.campaignPriceRestletUrl, "POST", userId, cfg)),
      Prefer: "return=representation",
    },
    body: JSON.stringify({ batchId, updates }),
  });
  const data = parseJson(await res.text());
  if (!res.ok) {
    throw new Error(`Campaign price batch RESTlet failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

function wooConfigured(cfg) {
  return !!(cfg.wooStoreUrl && cfg.wooConsumerKey && cfg.wooConsumerSecret);
}

function wooApiUrl(cfg, path) {
  const base = String(cfg.wooStoreUrl || "").trim().replace(/\/+$/, "");
  return `${base}/wp-json/wc/v3${path}`;
}

function wooAuthHeader(cfg) {
  return `Basic ${Buffer.from(`${cfg.wooConsumerKey}:${cfg.wooConsumerSecret}`).toString("base64")}`;
}

async function callWooProductBatch({ cfg, updates }) {
  if (!updates.length) return { ok: true, results: [] };
  if (!wooConfigured(cfg)) {
    throw new Error("Missing WooCommerce config. Set WOO_STORE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET.");
  }

  const url = wooApiUrl(cfg, "/products/batch");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: wooAuthHeader(cfg),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ update: updates }),
  });
  const payload = parseJson(await response.text());
  if (!response.ok) {
    throw new Error(`WooCommerce batch update failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function callWooApi({ cfg, path, method = "GET", body }) {
  if (!wooConfigured(cfg)) {
    throw new Error("Missing WooCommerce config. Set WOO_STORE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET.");
  }

  const response = await fetch(wooApiUrl(cfg, path), {
    method,
    headers: {
      Authorization: wooAuthHeader(cfg),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = parseJson(await response.text());
  if (!response.ok) {
    const err = new Error(`WooCommerce API failed (${response.status}): ${JSON.stringify(payload)}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
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
    changedFields: Object.keys(row || {}).filter((key) => !["Internal ID", "Item ID", "Name", "Record Type"].includes(key) && !key.endsWith("_InternalId") && !key.startsWith("__")),
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
    let salePriceVal;
    const explicitPriceUpdates = Array.isArray(row.__priceUpdates)
      ? row.__priceUpdates
          .map((update) => ({
            field: String(update?.field || ""),
            priceLevelId: Number(update?.priceLevelId),
            priceLevelName: String(update?.priceLevelName || ""),
            price: Number(update?.price),
          }))
          .filter((update) => Number.isFinite(update.priceLevelId) && Number.isFinite(update.price))
      : [];

    for (const field of job.fields || fields) {
      const fieldKey = field.mappingKey || field.name;
      if (!field.internalid && fieldKey !== "Base Price" && fieldKey !== "Preferred Supplier") continue;
      if (field.disableField && fieldKey !== "Base Price" && fieldKey !== "Preferred Supplier") continue;

      if (fieldKey === "Base Price") {
        const parsed = parseFloat(row[field.name]);
        if (Number.isFinite(parsed)) basePriceVal = parsed;
        continue;
      }

      if (fieldKey === "Preferred Supplier") {
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
        const ids = netSuiteInternalIds(row[`${field.name}_InternalId`]);
        if (Object.prototype.hasOwnProperty.call(row, `${field.name}_InternalId`)) {
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
        if (fileId && String(fileId).trim() !== "" && job.cfg.imageEndpoint) {
          const suiteletUrl = job.cfg.imageToken
            ? withSuiteletToken(job.cfg.imageEndpoint, job.cfg.imageToken)
            : job.cfg.imageEndpoint;
          const imageUrl = `${suiteletUrl}&itemid=${encodeURIComponent(internalId)}&fileid=${encodeURIComponent(fileId)}&fieldid=${encodeURIComponent(field.internalid)}`;
          const res = await fetch(imageUrl, { method: "GET" });
          result.response.images.push({
            field: field.name,
            fileId: String(fileId),
            mode: "suitelet",
            result: parseJson(await res.text()),
          });
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
      } else if (fieldKey === "Name") {
        payload[field.internalid] = childItemName(value);
      } else {
        payload[field.internalid] = String(value);
      }
    }

    const parsedSalePrice = parseFloat(row["Sale Price"]);
    if (Number.isFinite(parsedSalePrice)) salePriceVal = parsedSalePrice;

    if (Object.keys(payload).length) {
      const url = `${job.cfg.restUrl}/${recordType}/${encodeURIComponent(internalId)}`;
      const { res: response, body: responseBody } = await fetchNetSuiteWithRetry(url, {
        method: "PATCH",
        headers: {
          ...(await netSuiteHeaders(url, "PATCH", job.userId, job.cfg)),
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });
      result.response.main = responseBody || { status: response.status };
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

    if (row.__previousReasonsToBuyInternalIds !== undefined && row["reasons to buy_InternalId"] !== undefined) {
      result.response.reasonsToBuyLinks = await syncReasonsToBuyItemLinks({
        cfg: job.cfg,
        userId: job.userId,
        itemId: internalId,
        previousIds: row.__previousReasonsToBuyInternalIds,
        nextIds: row["reasons to buy_InternalId"],
      });
    }

    if (row.__previousItemFaqInternalIds !== undefined) {
      const faqInternalIdKey = Object.keys(row).find((key) => /faq/i.test(key) && key.endsWith("_InternalId"));
      if (faqInternalIdKey) {
        result.response.itemFaqLinks = await syncItemFaqLinks({
          cfg: job.cfg,
          userId: job.userId,
          itemId: internalId,
          previousIds: row.__previousItemFaqInternalIds,
          nextIds: row[faqInternalIdKey],
        });
      }
    }

    const priceUpdates = explicitPriceUpdates.length
      ? explicitPriceUpdates
      : [
          basePriceVal !== undefined
            ? { field: "Base Price", priceLevelId: 1, priceLevelName: "Base Price", price: basePriceVal }
            : null,
          salePriceVal !== undefined
            ? { field: "Sale Price", priceLevelId: 4, priceLevelName: "Sale Price", price: salePriceVal }
            : null,
        ].filter(Boolean);

    for (const priceUpdate of priceUpdates) {
      try {
        result.response.prices.push({
          success: true,
          field: priceUpdate.field,
          priceLevelId: priceUpdate.priceLevelId,
          priceLevelName: priceUpdate.priceLevelName,
          requestedPrice: priceUpdate.price,
          result: await callPriceRestlet({
            cfg: job.cfg,
            userId: job.userId,
            internalId,
            recordType,
            price: priceUpdate.price,
            priceLevelId: priceUpdate.priceLevelId,
            priceLevelName: priceUpdate.priceLevelName,
          }),
        });
      } catch (err) {
        result.response.prices.push({
          success: false,
          field: priceUpdate.field,
          priceLevelId: priceUpdate.priceLevelId,
          priceLevelName: priceUpdate.priceLevelName,
          requestedPrice: priceUpdate.price,
          error: err.message,
        });
      }
    }

    const hasPriceError = result.response.prices.some((p) => p.success === false);
    const changed = result.response.main || result.response.prices.length || result.response.images.length || result.response.supplier || result.response.reasonsToBuyLinks?.length || result.response.itemFaqLinks?.length;
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

function campaignPriceUpdateFromRow(row) {
  const priceUpdate = Array.isArray(row.__priceUpdates)
    ? row.__priceUpdates.find((update) => Number.isFinite(Number(update?.price)))
    : null;
  const price = Number(priceUpdate?.price);
  if (!Number.isFinite(price)) throw new Error("Missing campaign sale price update");

  return {
    clientKey: String(row["Internal ID"] || row["Item ID"] || row.Name || ""),
    internalId: String(row["Internal ID"] || "").trim(),
    itemId: row["Item ID"] || row.Name || "",
    recordType: campaignRecordTypeFromRow(row),
    price,
    priceLevelId: Number(priceUpdate.priceLevelId || 4),
    priceLevelName: String(priceUpdate.priceLevelName || "Sale Price"),
    currencyId: 1,
    quantityColumns: [0, 1],
  };
}

function campaignRecordTypeFromRow(row) {
  const raw = String(row?.["Record Type"] || row?.recordType || "").trim();
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const allowed = {
    inventoryitem: "inventoryItem",
    lotnumberedinventoryitem: "lotNumberedInventoryItem",
    lotnumberedinventory: "lotNumberedInventoryItem",
    lotnumberedinvtpart: "lotNumberedInventoryItem",
    invtpart: "lotNumberedInventoryItem",
    servicesaleitem: "serviceSaleItem",
    serviceitem: "serviceSaleItem",
    assemblyitem: "assemblyItem",
    noninventorysaleitem: "nonInventorySaleItem",
    noninventoryitem: "nonInventorySaleItem",
    kititem: "kitItem",
  };
  return allowed[compact] || "inventoryItem";
}

function campaignBatchErrorResult(row, error) {
  return {
    itemId: row["Item ID"] || row.Name || row["Internal ID"],
    internalId: row["Internal ID"],
    wooId: row["Woo ID"] || "",
    recordType: row["Record Type"] || null,
    changedFields: ["Sale Price"],
    status: "Error",
    response: { main: null, prices: [], woo: null, images: [], supplier: null, error, diagnostics: null },
  };
}

function campaignBatchResult(row, batchResult, wooResult) {
  const netsuiteSuccess = batchResult && batchResult.success !== false;
  const wooSuccess = !wooResult || wooResult.status === "skipped" || wooResult.success !== false;
  const success = netsuiteSuccess && wooSuccess;
  return {
    itemId: row["Item ID"] || row.Name || row["Internal ID"],
    internalId: row["Internal ID"],
    wooId: row["Woo ID"] || "",
    recordType: row["Record Type"] || null,
    changedFields: row["Woo ID"] ? ["Sale Price", "WooCommerce Sale Price"] : ["Sale Price"],
    status: success ? "Success" : "Error",
    response: {
      main: null,
      prices: [
        {
          success: netsuiteSuccess,
          field: "Sale Price",
          priceLevelId: 4,
          priceLevelName: "Sale Price",
          requestedPrice: Number(row.__priceUpdates?.[0]?.price),
          result: batchResult?.result || null,
          error: batchResult?.error || null,
        },
      ],
      woo: wooResult || { status: "skipped", reason: "No Woo ID" },
      images: [],
      supplier: null,
      error: success ? null : batchResult?.error || wooResult?.error || "Campaign batch update failed",
      diagnostics: { netsuite: batchResult || null, woo: wooResult || null },
    },
  };
}

function wooIdsFromRow(row) {
  return String(row["Woo ID"] || "")
    .split(/[,\s;]+/)
    .map((value) => Number(String(value).trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function wooSalePriceFromRow(row) {
  const netPriceUpdate = Array.isArray(row.__priceUpdates)
    ? row.__priceUpdates.find((update) => Number.isFinite(Number(update?.price)))
    : null;
  const net = Number(netPriceUpdate?.price);
  if (Number.isFinite(net)) return net.toFixed(2);

  const gross = Number(row["Sale Price"]);
  if (!Number.isFinite(gross)) return "";
  return (gross / 1.2).toFixed(2);
}

function wooSkuCandidates(row) {
  const values = [
    row["Internal ID"],
    row["Item ID"],
    row["Web SKU"],
    row.Name,
  ];
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

async function getWooProductById(cfg, productId) {
  try {
    return await callWooApi({ cfg, path: `/products/${encodeURIComponent(productId)}` });
  } catch (err) {
    if (Number(err.status) === 404) return null;
    throw err;
  }
}

async function findWooProductBySku(cfg, skuCandidates) {
  for (const sku of skuCandidates) {
    const products = await callWooApi({
      cfg,
      path: `/products?sku=${encodeURIComponent(sku)}&per_page=100`,
    });
    if (Array.isArray(products) && products.length) return products[0];
  }
  return null;
}

async function findWooVariationBySku(cfg, parentId, skuCandidates) {
  for (const sku of skuCandidates) {
    const variations = await callWooApi({
      cfg,
      path: `/products/${encodeURIComponent(parentId)}/variations?sku=${encodeURIComponent(sku)}&per_page=100`,
    });
    if (Array.isArray(variations) && variations.length) return variations[0];
  }
  return null;
}

function mergeWooResult(current, next) {
  if (!current || current.status === "skipped") return next;
  if (current.success === false) return current;
  return next.success === false ? next : current;
}

async function processWooBatchForRows(cfg, rows) {
  const resultByInternalId = new Map();
  rows.forEach((row) => {
    const internalId = String(row["Internal ID"] || "");
    if (!row["Woo ID"]) {
      resultByInternalId.set(internalId, { status: "skipped", reason: "No Woo ID" });
    }
  });

  const rowsWithWoo = rows.filter((row) => wooIdsFromRow(row).length);
  if (!rowsWithWoo.length) return resultByInternalId;

  if (!wooConfigured(cfg)) {
    rowsWithWoo.forEach((row) => {
      resultByInternalId.set(String(row["Internal ID"] || ""), {
        success: false,
        error: "Woo ID present but WooCommerce config is incomplete. Set WOO_STORE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET.",
      });
    });
    return resultByInternalId;
  }

  const productUpdates = [];
  const variationUpdatesByParent = new Map();
  const productUpdateRows = new Map();
  const variationUpdateRows = new Map();
  const productCache = new Map();

  try {
    for (const row of rowsWithWoo) {
      const internalId = String(row["Internal ID"] || "");
      const salePrice = wooSalePriceFromRow(row);
      const skuCandidates = wooSkuCandidates(row);

      if (!salePrice) {
        resultByInternalId.set(internalId, { success: false, error: "Missing sale price for WooCommerce update." });
        continue;
      }

      for (const wooId of wooIdsFromRow(row)) {
        if (!productCache.has(wooId)) productCache.set(wooId, await getWooProductById(cfg, wooId));
        const product = productCache.get(wooId);

        if (!product) {
          const skuMatch = await findWooProductBySku(cfg, skuCandidates);
          if (!skuMatch) {
            resultByInternalId.set(internalId, mergeWooResult(resultByInternalId.get(internalId), {
              status: "skipped",
              wooId,
              reason: `WooCommerce product does not exist and no SKU match was found for ${skuCandidates.join(", ")}.`,
            }));
            continue;
          }

          if (skuMatch.type === "variation" && skuMatch.parent_id) {
            const parentId = Number(skuMatch.parent_id);
            if (!variationUpdatesByParent.has(parentId)) variationUpdatesByParent.set(parentId, []);
            variationUpdatesByParent.get(parentId).push({ id: Number(skuMatch.id), sale_price: salePrice });
            variationUpdateRows.set(`${parentId}:${skuMatch.id}`, { row, variation: skuMatch, parentId });
            continue;
          }

          productUpdates.push({ id: Number(skuMatch.id), sale_price: salePrice });
          productUpdateRows.set(String(skuMatch.id), { row, product: skuMatch });
          continue;
        }

        if (product.type === "variation" && product.parent_id) {
          const parentId = Number(product.parent_id);
          if (!variationUpdatesByParent.has(parentId)) variationUpdatesByParent.set(parentId, []);
          variationUpdatesByParent.get(parentId).push({ id: Number(product.id), sale_price: salePrice });
          variationUpdateRows.set(`${parentId}:${product.id}`, { row, variation: product, parentId });
          continue;
        }

        if (product.type === "variable") {
          const variation = await findWooVariationBySku(cfg, wooId, skuCandidates);
          if (!variation?.id) {
            resultByInternalId.set(internalId, mergeWooResult(resultByInternalId.get(internalId), {
              status: "skipped",
              wooId,
              reason: `No WooCommerce variation found for SKU ${skuCandidates.join(", ")}.`,
            }));
            continue;
          }

          if (!variationUpdatesByParent.has(wooId)) variationUpdatesByParent.set(wooId, []);
          variationUpdatesByParent.get(wooId).push({ id: Number(variation.id), sale_price: salePrice });
          variationUpdateRows.set(`${wooId}:${variation.id}`, { row, variation, parentId: wooId });
          continue;
        }

        productUpdates.push({ id: wooId, sale_price: salePrice });
        productUpdateRows.set(String(wooId), { row, product });
      }
    }

    if (productUpdates.length) {
      const payload = await callWooProductBatch({ cfg, updates: productUpdates });
      const returned = Array.isArray(payload?.update) ? payload.update : [];
      returned.forEach((item) => {
        const key = String(item?.id || "");
        const context = productUpdateRows.get(key);
        if (!context) return;
        resultByInternalId.set(String(context.row["Internal ID"] || ""), {
          success: true,
          status: "updated",
          target: "product",
          wooId: Number(item.id),
          salePrice: item.sale_price,
          result: item,
        });
      });
    }

    for (const [parentId, updates] of variationUpdatesByParent.entries()) {
      const payload = await callWooApi({
        cfg,
        path: `/products/${encodeURIComponent(parentId)}/variations/batch`,
        method: "POST",
        body: { update: updates },
      });
      const returned = Array.isArray(payload?.update) ? payload.update : [];
      returned.forEach((item) => {
        const context = variationUpdateRows.get(`${parentId}:${item?.id}`);
        if (!context) return;
        resultByInternalId.set(String(context.row["Internal ID"] || ""), {
          success: true,
          status: "updated",
          target: "variation",
          wooId: Number(item.id),
          parentId,
          sku: item.sku,
          salePrice: item.sale_price,
          result: item,
        });
      });
    }

    productUpdateRows.forEach((context, productId) => {
      const internalId = String(context.row["Internal ID"] || "");
      if (resultByInternalId.get(internalId)?.status === "updated") return;
      resultByInternalId.set(internalId, {
        status: "skipped",
        wooId: Number(productId),
        reason: "WooCommerce product was not returned by the batch update.",
      });
    });

    variationUpdateRows.forEach((context) => {
      const internalId = String(context.row["Internal ID"] || "");
      if (resultByInternalId.get(internalId)?.status === "updated") return;
      resultByInternalId.set(internalId, {
        status: "skipped",
        wooId: Number(context.variation.id),
        parentId: context.parentId,
        reason: "WooCommerce variation was not returned by the batch update.",
      });
    });
  } catch (err) {
    rowsWithWoo.forEach((row) => {
      resultByInternalId.set(String(row["Internal ID"] || ""), {
        success: false,
        wooId: row["Woo ID"],
        error: err.message,
      });
    });
  }

  return resultByInternalId;
}

async function processCampaignBatchJob(job) {
  if (!job.cfg.campaignPriceRestletUrl) {
    throw new Error("Missing NetSuite SuitePim campaign price batch RESTlet URL");
  }

  job.batchTotal = Math.ceil(job.rows.length / CAMPAIGN_BATCH_SIZE);
  job.batchProcessed = 0;
  job.batchInProgress = 0;

  for (let offset = 0; offset < job.rows.length; offset += CAMPAIGN_BATCH_SIZE) {
    const rows = job.rows.slice(offset, offset + CAMPAIGN_BATCH_SIZE);
    const valid = [];
    const batchNumber = Math.floor(offset / CAMPAIGN_BATCH_SIZE) + 1;
    job.batchInProgress = batchNumber;

    rows.forEach((row, rowIndex) => {
      try {
        valid.push({ row, rowIndex, update: campaignPriceUpdateFromRow(row) });
      } catch (err) {
        job.results.push(campaignBatchErrorResult(row, err.message));
        job.processed += 1;
      }
    });

    if (!valid.length) continue;

    try {
      const batchId = `${job.id}:${batchNumber}`;
      const payload = await callCampaignPriceBatchRestlet({
        cfg: job.cfg,
        userId: job.userId,
        updates: valid.map((entry) => entry.update),
        batchId,
      });
      const results = Array.isArray(payload?.results) ? payload.results : [];
      const wooResults = await processWooBatchForRows(job.cfg, valid.map((entry) => entry.row));

      valid.forEach((entry, index) => {
        const result = results.find((item) => Number(item.index) === index)
          || results.find((item) => String(item.clientKey || "") === String(entry.update.clientKey || ""))
          || { success: false, error: "No batch result returned for row" };
        job.results.push(campaignBatchResult(entry.row, result, wooResults.get(String(entry.row["Internal ID"] || ""))));
        job.processed += 1;
      });
    } catch (err) {
      const wooResults = await processWooBatchForRows(job.cfg, valid.map((entry) => entry.row));
      valid.forEach((entry) => {
        const netSuiteError = { success: false, error: err.message };
        job.results.push(campaignBatchResult(entry.row, netSuiteError, wooResults.get(String(entry.row["Internal ID"] || ""))));
        job.processed += 1;
      });
    } finally {
      job.batchProcessed = batchNumber;
      job.batchInProgress = 0;
    }
  }
}

async function runNextJob() {
  if (!jobQueue.length) return;
  const jobId = jobQueue[0];
  const job = jobs[jobId];
  if (!job || job.status !== "pending") return;

  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.results = [];
  let index = 0;

  if (job.type === "campaign-batch") {
    try {
      await processCampaignBatchJob(job);
    } catch (err) {
      job.rows.forEach((row) => {
        if (job.results.some((result) => String(result.internalId) === String(row["Internal ID"]))) return;
        job.results.push(campaignBatchErrorResult(row, err.message));
        job.processed += 1;
      });
    }
    job.status = "completed";
    job.finishedAt = new Date().toISOString();
    jobQueue.shift();
    runNextJob().catch((err) => console.error("SuitePim job queue error:", err));
    return;
  }

  async function worker() {
    while (index < job.rows.length) {
      const row = job.rows[index++];
      const rowResult = job.type === "validation"
        ? await processValidationRow(row, job)
        : await processRow(row, job);
      job.results.push(rowResult);
      job.processed += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, job.rows.length) }, worker));

  job.status = "completed";
  job.finishedAt = new Date().toISOString();
  jobQueue.shift();
  runNextJob().catch((err) => console.error("SuitePim job queue error:", err));
}

async function fetchWebManagementRows(cfg) {
  const url = withSuiteletToken(cfg.webManagementUrl, cfg.webManagementToken);
  const response = await fetch(url);
  const payload = parseJson(await response.text());
  if (!response.ok) throw new Error(`Item management feed returned ${response.status}`);
  return Array.isArray(payload) ? payload : payload.results || payload.items || [];
}

async function buildWebManagementPayload(env, cfg, userId = null) {
  const startedAt = Date.now();
  const [rawRows, optionMap] = await Promise.all([
    fetchWebManagementRows(cfg),
    loadMultipleSelectOptionMap(env, cfg, userId),
  ]);
  const rows = rawRows.map((row) => recalcRow(normalizeMultipleSelects(normalizeRowAliases(row), optionMap)));

  return {
    ok: true,
    rows,
    count: rows.length,
    environment: publicEnvironmentName(env),
    generatedAt: new Date().toISOString(),
    buildDurationMs: Date.now() - startedAt,
  };
}

function webManagementCacheKey(env) {
  return `web-management:${env}`;
}

function withWebManagementCacheMeta(payload, entry, source) {
  const loadedAt = entry?.loadedAt || Date.now();
  return {
    ...payload,
    cache: {
      source,
      generatedAt: payload.generatedAt || new Date(loadedAt).toISOString(),
      ageSeconds: Math.max(0, Math.round((Date.now() - loadedAt) / 1000)),
      refreshInProgress: !!entry?.inFlight,
      buildDurationMs: payload.buildDurationMs || 0,
    },
  };
}

function webManagementPayloadHasReasonIds(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows.every((row) => {
    const reasons = Array.isArray(row?.["reasons to buy"])
      ? row["reasons to buy"].filter(Boolean)
      : String(row?.["reasons to buy"] || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!reasons.length) return true;
    return netSuiteInternalIds(row?.["reasons to buy_InternalId"]).length === reasons.length;
  });
}

function refreshWebManagementCache(key, env, cfg, userId = null) {
  const existing = webManagementCache.get(key);
  if (existing?.inFlight) return existing.inFlight;

  const inFlight = buildWebManagementPayload(env, cfg, userId)
    .then((payload) => {
      webManagementCache.set(key, {
        payload,
        loadedAt: Date.now(),
        inFlight: null,
      });
      return payload;
    })
    .catch((err) => {
      const current = webManagementCache.get(key);
      if (current) webManagementCache.set(key, { ...current, inFlight: null, lastError: err.message });
      throw err;
    });

  webManagementCache.set(key, {
    payload: existing?.payload || null,
    loadedAt: existing?.loadedAt || 0,
    inFlight,
    lastError: existing?.lastError || "",
  });

  return inFlight;
}

async function getWebManagementPayload(env, cfg, { forceRefresh = false, userId = null } = {}) {
  const key = webManagementCacheKey(env);
  const cached = webManagementCache.get(key);
  const age = cached?.loadedAt ? Date.now() - cached.loadedAt : Infinity;
  const cachedHasReasonIds = !userId || webManagementPayloadHasReasonIds(cached?.payload);

  if (!forceRefresh && cached?.payload && cachedHasReasonIds && age < WEB_MANAGEMENT_CACHE_TTL_MS) {
    return withWebManagementCacheMeta(cached.payload, cached, "cache");
  }

  if (!forceRefresh && cached?.payload && cachedHasReasonIds && age < WEB_MANAGEMENT_STALE_MS) {
    refreshWebManagementCache(key, env, cfg, userId).catch((err) => {
      console.error("SuitePim web management background refresh failed:", err);
    });
    return withWebManagementCacheMeta(cached.payload, webManagementCache.get(key), "stale");
  }

  const payload = await refreshWebManagementCache(key, env, cfg, userId);
  return withWebManagementCacheMeta(payload, webManagementCache.get(key), forceRefresh ? "refresh" : "origin");
}

function prewarmWebManagementCache() {
  if (String(process.env.SUITEPIM_WEB_MANAGEMENT_PREWARM || "true").toLowerCase() === "false") return;

  const envs = String(process.env.SUITEPIM_WEB_MANAGEMENT_PREWARM_ALL || "false").toLowerCase() === "true"
    ? ["production", "sandbox"]
    : [normalizeEnvironment()];

  envs.forEach((env, index) => {
    setTimeout(() => {
      const cfg = envConfig(env);
      if (!cfg.webManagementUrl) return;
      const key = webManagementCacheKey(env);
      refreshWebManagementCache(key, env, cfg)
        .then((payload) => {
          console.log(`SuitePim ${env} web management cache warmed: ${payload.count} rows`);
        })
        .catch((err) => {
          console.warn(`SuitePim ${env} web management cache warm failed:`, err.message);
        });
    }, 5000 + index * 30000);
  });
}

function startWebManagementCacheRefreshTimer() {
  if (String(process.env.SUITEPIM_WEB_MANAGEMENT_AUTO_REFRESH || "true").toLowerCase() === "false") return;
  if (!Number.isFinite(WEB_MANAGEMENT_REFRESH_INTERVAL_MS) || WEB_MANAGEMENT_REFRESH_INTERVAL_MS <= 0) return;

  setInterval(() => {
    const envs = String(process.env.SUITEPIM_WEB_MANAGEMENT_REFRESH_ALL || "false").toLowerCase() === "true"
      ? ["production", "sandbox"]
      : [normalizeEnvironment()];

    envs.forEach((env) => {
      const cfg = envConfig(env);
      if (!cfg.webManagementUrl) return;
      const key = webManagementCacheKey(env);
      refreshWebManagementCache(key, env, cfg)
        .then((payload) => {
          console.log(`SuitePim ${env} web management cache refreshed: ${payload.count} rows`);
        })
        .catch((err) => {
          console.warn(`SuitePim ${env} web management cache refresh failed:`, err.message);
        });
    });
  }, WEB_MANAGEMENT_REFRESH_INTERVAL_MS);
}

router.get("/image-proxy", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl) return res.status(400).send("Missing image URL");

    let imageUrl;
    try {
      imageUrl = new URL(rawUrl);
    } catch {
      return res.status(400).send("Invalid image URL");
    }

    const isNetSuiteHost = /(^|\.)netsuite\.com$/i.test(imageUrl.hostname);
    const isMediaFile = /\/core\/media\/media\.nl$/i.test(imageUrl.pathname);
    if (imageUrl.protocol !== "https:" || !isNetSuiteHost || !isMediaFile) {
      return res.status(400).send("Unsupported image URL");
    }

    const upstream = await fetch(imageUrl.toString(), {
      headers: {
        "User-Agent": "EPOS SuitePIM image proxy",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send("Image unavailable");
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(contentType)) {
      return res.status(415).send("Unsupported media type");
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    upstream.body.pipe(res);
  } catch (err) {
    console.error("SuitePIM image proxy failed:", err.message);
    res.status(500).send("Image proxy failed");
  }
});

router.use(requireSuitePimSession);

router.get("/config", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const cleanFields = (await effectiveSuitePimFields(env)).map(publicFieldConfig);
    res.json({
      ok: true,
      environment: publicEnvironmentName(env),
      fields: cleanFields,
      productFeedConfigured: !!cfg.productDataUrl,
      priceRestletConfigured: !!cfg.priceRestletUrl,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/reasons-to-buy/config", (req, res) => {
  const env = normalizeEnvironment(req.query.environment);
  res.json({
    ok: true,
    environment: publicEnvironmentName(env),
    recordType: REASONS_TO_BUY_RECORD_TYPE,
    fields: reasonsToBuyFields.map((field) => ({
      ...field,
      hasOptions: !!field.optionFeed,
    })),
  });
});

router.get("/reasons-to-buy", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const rows = await fetchReasonsToBuyRows(cfg, userId);
    res.json({
      ok: true,
      rows,
      count: rows.length,
      environment: publicEnvironmentName(env),
      recordType: REASONS_TO_BUY_RECORD_TYPE,
    });
  } catch (err) {
    console.error("SuitePim reasons-to-buy load failed:", err);
    res.status(500).json({ ok: false, error: err.message, diagnostics: err.diagnostics || null });
  }
});

router.get("/reasons-to-buy/options/:fieldName", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const field = reasonsToBuyFields.find((item) => item.name.toLowerCase() === String(req.params.fieldName || "").toLowerCase());
    if (!field?.optionFeed) return res.json({ ok: true, options: [] });
    const options = await fetchReasonsToBuyOptions(field.optionFeed, env, cfg, userId);
    res.json({ ok: true, options });
  } catch (err) {
    console.error("SuitePim reasons-to-buy option load failed:", err);
    res.status(500).json({ ok: false, error: err.message, diagnostics: err.diagnostics || null });
  }
});

router.get("/item-faqs/config", (req, res) => {
  const env = normalizeEnvironment(req.query.environment);
  res.json({
    ok: true,
    environment: publicEnvironmentName(env),
    recordType: ITEM_FAQ_RECORD_TYPE,
    fields: itemFaqFields.map((field) => ({
      ...field,
      hasOptions: !!field.optionFeed,
    })),
  });
});

router.get("/item-faqs", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const rows = await fetchItemFaqRows(cfg, userId);
    res.json({
      ok: true,
      rows,
      count: rows.length,
      environment: publicEnvironmentName(env),
      recordType: ITEM_FAQ_RECORD_TYPE,
    });
  } catch (err) {
    console.error("SuitePim item FAQs load failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/item-faqs/options/:fieldName", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const field = itemFaqFields.find((item) => item.name.toLowerCase() === String(req.params.fieldName || "").toLowerCase());
    const feedName = field?.optionFeed || req.params.fieldName;
    const options = await fetchReasonsToBuyOptions(feedName, env, cfg, userId);
    res.json({ ok: true, options, field: req.params.fieldName });
  } catch (err) {
    console.error("SuitePim item FAQs option load failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/item-faqs/save", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.body.environment || req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: "No Item FAQ records to save" });

    const results = [];
    for (const row of rows) {
      try {
        results.push(await saveItemFaqRecord(cfg, userId, row));
      } catch (err) {
        results.push({
          id: row["Internal ID"] || "",
          name: row.Name || "",
          status: "Error",
          error: err.message,
          diagnostics: err.diagnostics || null,
        });
      }
    }

    res.json({ ok: true, results, environment: publicEnvironmentName(env) });
  } catch (err) {
    console.error("SuitePim item FAQs save failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/reasons-to-buy/save", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.body?.environment || req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: "No records to save" });

    const results = [];
    for (const row of rows) {
      try {
        results.push(await saveReasonsToBuyRecord(cfg, userId, row));
      } catch (err) {
        results.push({
          status: "Error",
          internalId: row["Internal ID"] || "",
          name: row.Name || "",
          action: row["Internal ID"] ? "Update" : "Create",
          error: err.message,
          diagnostics: err.diagnostics || null,
        });
      }
    }

    res.json({
      ok: true,
      results,
      environment: publicEnvironmentName(env),
      success: results.filter((result) => result.status === "Success").length,
      failed: results.filter((result) => result.status === "Error").length,
    });
  } catch (err) {
    console.error("SuitePim reasons-to-buy save failed:", err);
    res.status(500).json({ ok: false, error: err.message, diagnostics: err.diagnostics || null });
  }
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
    const userId = req.eposSession.user_id || req.eposSession.id;
    const optionMap = await loadMultipleSelectOptionMap(env, cfg, userId);

    const rows = rawRows.map((row) => recalcRow(normalizeMultipleSelects(normalizeRowAliases(row), optionMap)));
    res.json({ ok: true, rows, count: rows.length, environment: publicEnvironmentName(env) });
  } catch (err) {
    console.error("SuitePim product load failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/web-management/config", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const openai = openAIConfig();
    const cleanFields = (await effectiveSuitePimFields(env)).map(publicFieldConfig);
    res.json({
      ok: true,
      environment: publicEnvironmentName(env),
      fields: cleanFields,
      webManagementFeedConfigured: !!cfg.webManagementUrl,
      priceRestletConfigured: !!cfg.priceRestletUrl,
      campaignPriceRestletConfigured: !!cfg.campaignPriceRestletUrl,
      wooCommerceConfigured: wooConfigured(cfg),
      aiGenerationConfigured: !!openai.apiKey,
      aiGenerationModel: openai.model,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/settings", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const forceRefresh = req.query.refresh === "1" || req.query.force === "1";
    res.json(await getSuitePimSettingsPayload(env, cfg, userId, { forceRefresh }));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post("/settings/netsuite-mappings", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.body.environment || req.query.environment);
    const cfg = envConfig(env);
    const submitted = Array.isArray(req.body.mappings) ? req.body.mappings : [];
    const defaultsByKey = new Map(defaultFieldMappings().map((mapping) => [mapping.mappingKey, mapping]));
    const user = req.eposSession.email || req.eposSession.username || req.eposSession.user_id || "";
    const submittedKeys = new Set();

    await ensureSuitePimSettingsTables();

    for (const row of submitted) {
      const mappingKey = String(row?.mappingKey || "").trim();
      const isCustom = mappingKey.startsWith("custom:");
      const base = defaultsByKey.get(mappingKey) || {
        defaultJsonField: String(row?.jsonField || "").trim(),
        defaultInternalid: "",
        defaultFieldType: "Free-Form Text",
        optionFeed: "",
      };
      if (!mappingKey || (!defaultsByKey.has(mappingKey) && !isCustom)) continue;

      const jsonField = String(row?.jsonField || base.defaultJsonField || mappingKey).trim();
      const internalid = String(row?.internalid ?? base.defaultInternalid ?? "").trim();
      const fieldType = String(row?.fieldType || base.defaultFieldType || "").trim();
      const optionFeed = String(row?.optionFeed || base.optionFeed || (/faq/i.test(jsonField) ? "Item Faq's" : "")).trim();
      if (!jsonField) continue;
      submittedKeys.add(mappingKey);

      await pool.query(
        `INSERT INTO suitepim_field_mappings
          (environment, mapping_key, json_field, internalid, field_type, option_feed, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (environment, mapping_key)
         DO UPDATE SET
           json_field = EXCLUDED.json_field,
           internalid = EXCLUDED.internalid,
           field_type = EXCLUDED.field_type,
           option_feed = EXCLUDED.option_feed,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [env, mappingKey, jsonField, internalid || null, fieldType || null, optionFeed || null, String(user)]
      );
    }

    const customKeys = Array.from(submittedKeys).filter((key) => key.startsWith("custom:"));
    await pool.query(
      `DELETE FROM suitepim_field_mappings
        WHERE environment = $1
          AND mapping_key LIKE 'custom:%'
          AND NOT (mapping_key = ANY($2::text[]))`,
      [env, customKeys]
    );

    webManagementCache.delete(webManagementCacheKey(env));
    invalidateSuitePimSettingsCache(env);
    const userId = req.eposSession.user_id || req.eposSession.id;

    res.json(await getSuitePimSettingsPayload(env, cfg, userId, { forceRefresh: true }));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get("/web-management", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const cfg = envConfig(env);
    if (!cfg.webManagementUrl) {
      return res.status(500).json({
        ok: false,
        error: `Missing ${env === "production" ? "SUITEPIM_WEB_DATA_URL or SUITEPIM_PROD_WEB_DATA_URL" : "SUITEPIM_WEB_DATA_URL or SUITEPIM_SANDBOX_WEB_DATA_URL"}`,
      });
    }

    const forceRefresh = req.query.refresh === "1" || req.query.force === "1";
    const userId = req.eposSession.user_id || req.eposSession.id;
    const payload = await getWebManagementPayload(env, cfg, { forceRefresh, userId });
    res.json(payload);
  } catch (err) {
    console.error("SuitePim web management load failed:", err);
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
    const cfg = envConfig(env);
    const userId = req.eposSession.user_id || req.eposSession.id;
    const requested = req.params.fieldName;
    const effectiveFields = await effectiveSuitePimFields(env);
    const field = effectiveFields.find((f) => f.name.toLowerCase() === requested.toLowerCase());
    const feedName = field?.optionFeed || (/faq/i.test(requested) ? "Item Faq's" : "");
    if (!feedName) return res.json({ ok: true, options: [] });
    const options = await fetchReasonsToBuyOptions(feedName, env, cfg, userId);
    res.json({ ok: true, options });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function cleanFloorPlanName(value) {
  return String(value || "").trim().slice(0, 120);
}

function cleanFloorPlanData(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const widthMeters = Math.min(200, Math.max(10, Number(data.widthMeters) || 100));
  const heightMeters = Math.min(200, Math.max(10, Number(data.heightMeters) || 70));
  const elements = Array.isArray(data.elements) ? data.elements : [];

  return {
    widthMeters,
    heightMeters,
    elements: elements.slice(0, 1000).map((element) => {
      const type = ["line", "door", "window", "asset"].includes(element.type) ? element.type : "line";
      if (type === "asset") {
        return {
          id: String(element.id || crypto.randomBytes(6).toString("hex")).slice(0, 40),
          type,
          assetKey: String(element.assetKey || "").slice(0, 60),
          name: String(element.name || "Asset").slice(0, 120),
          x: Number(element.x) || 0,
          y: Number(element.y) || 0,
          width: Math.min(20, Math.max(0.1, Number(element.width) || 1)),
          height: Math.min(20, Math.max(0.1, Number(element.height) || 1)),
        };
      }
      return {
        id: String(element.id || crypto.randomBytes(6).toString("hex")).slice(0, 40),
        type,
        x1: Number(element.x1) || 0,
        y1: Number(element.y1) || 0,
        x2: Number(element.x2) || 0,
        y2: Number(element.y2) || 0,
      };
    }),
  };
}

function mapFloorPlanRow(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: row.location_name || "",
    name: row.name,
    data: row.data || {},
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/floor-plans", async (req, res) => {
  try {
    await ensureSuitePimFloorPlanTables();
    const locationId = Number(req.query.locationId || 0);
    if (!Number.isInteger(locationId) || locationId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid location id" });
    }

    const result = await pool.query(
      `
        SELECT fp.id, fp.location_id, l.name AS location_name, fp.name, fp.data, fp.created_by, fp.created_at, fp.updated_at
          FROM suitepim_floor_plans fp
          JOIN locations l ON l.id = fp.location_id
         WHERE fp.location_id = $1
         ORDER BY fp.updated_at DESC, fp.name ASC
      `,
      [locationId]
    );

    res.json({ ok: true, floorPlans: result.rows.map(mapFloorPlanRow) });
  } catch (err) {
    console.error("SuitePim floor plan list failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load floor plans" });
  }
});

router.get("/floor-plans/:id", async (req, res) => {
  try {
    await ensureSuitePimFloorPlanTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Invalid floor plan id" });

    const result = await pool.query(
      `
        SELECT fp.id, fp.location_id, l.name AS location_name, fp.name, fp.data, fp.created_by, fp.created_at, fp.updated_at
          FROM suitepim_floor_plans fp
          JOIN locations l ON l.id = fp.location_id
         WHERE fp.id = $1
      `,
      [id]
    );

    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Floor plan not found" });
    res.json({ ok: true, floorPlan: mapFloorPlanRow(result.rows[0]) });
  } catch (err) {
    console.error("SuitePim floor plan load failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load floor plan" });
  }
});

router.post("/floor-plans", async (req, res) => {
  try {
    await ensureSuitePimFloorPlanTables();
    const locationId = Number(req.body?.locationId);
    const name = cleanFloorPlanName(req.body?.name) || "Untitled floor plan";
    const data = cleanFloorPlanData(req.body?.data);
    const createdBy = String(req.eposSession?.email || req.eposSession?.username || req.eposSession?.user_id || "").slice(0, 160);

    if (!Number.isInteger(locationId) || locationId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid location id" });
    }

    const result = await pool.query(
      `
        INSERT INTO suitepim_floor_plans (location_id, name, data, created_by)
        VALUES ($1, $2, $3::jsonb, $4)
        RETURNING id, location_id, name, data, created_by, created_at, updated_at
      `,
      [locationId, name, JSON.stringify(data), createdBy || null]
    );

    res.status(201).json({ ok: true, floorPlan: mapFloorPlanRow(result.rows[0]) });
  } catch (err) {
    console.error("SuitePim floor plan create failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to create floor plan" });
  }
});

router.put("/floor-plans/:id", async (req, res) => {
  try {
    await ensureSuitePimFloorPlanTables();
    const id = Number(req.params.id);
    const name = cleanFloorPlanName(req.body?.name) || "Untitled floor plan";
    const data = cleanFloorPlanData(req.body?.data);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Invalid floor plan id" });

    const result = await pool.query(
      `
        UPDATE suitepim_floor_plans
           SET name = $2,
               data = $3::jsonb,
               updated_at = NOW()
         WHERE id = $1
        RETURNING id, location_id, name, data, created_by, created_at, updated_at
      `,
      [id, name, JSON.stringify(data)]
    );

    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Floor plan not found" });
    res.json({ ok: true, floorPlan: mapFloorPlanRow(result.rows[0]) });
  } catch (err) {
    console.error("SuitePim floor plan update failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to save floor plan" });
  }
});

router.delete("/floor-plans/:id", async (req, res) => {
  try {
    await ensureSuitePimFloorPlanTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Invalid floor plan id" });

    const result = await pool.query("DELETE FROM suitepim_floor_plans WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Floor plan not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("SuitePim floor plan delete failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to delete floor plan" });
  }
});

router.get("/campaigns", async (req, res) => {
  try {
    await ensureSuitePimCampaignTables();
    const env = normalizeEnvironment(req.query.environment);
    const result = await pool.query(
      `
        SELECT id, environment, title, data, created_by, created_at, updated_at
          FROM suitepim_campaigns
         WHERE environment = $1
         ORDER BY updated_at DESC, title ASC
      `,
      [env]
    );
    res.json({
      ok: true,
      environment: publicEnvironmentName(env),
      campaigns: result.rows.map(mapSuitePimCampaignRow),
    });
  } catch (err) {
    console.error("SuitePim campaign list failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load campaigns" });
  }
});

router.get("/campaigns/:id", async (req, res) => {
  try {
    await ensureSuitePimCampaignTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Invalid campaign id" });

    const result = await pool.query(
      `
        SELECT id, environment, title, data, created_by, created_at, updated_at
          FROM suitepim_campaigns
         WHERE id = $1
      `,
      [id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Campaign not found" });
    res.json({ ok: true, campaign: mapSuitePimCampaignRow(result.rows[0]) });
  } catch (err) {
    console.error("SuitePim campaign load failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to load campaign" });
  }
});

router.post("/campaigns", async (req, res) => {
  try {
    await ensureSuitePimCampaignTables();
    const env = normalizeEnvironment(req.body?.environment || req.query.environment);
    const data = normalizeCampaignData(req.body || {});
    const createdBy = cleanCampaignText(req.eposSession?.email || req.eposSession?.username || req.eposSession?.user_id);
    const result = await pool.query(
      `
        INSERT INTO suitepim_campaigns (environment, title, data, created_by)
        VALUES ($1, $2, $3::jsonb, $4)
        RETURNING id, environment, title, data, created_by, created_at, updated_at
      `,
      [env, data.title, JSON.stringify(data), createdBy || null]
    );
    res.json({ ok: true, campaign: mapSuitePimCampaignRow(result.rows[0]) });
  } catch (err) {
    console.error("SuitePim campaign save failed:", err);
    res.status(400).json({ ok: false, error: err.message || "Failed to save campaign" });
  }
});

router.put("/campaigns/:id", async (req, res) => {
  try {
    await ensureSuitePimCampaignTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Invalid campaign id" });

    const env = normalizeEnvironment(req.body?.environment || req.query.environment);
    const data = normalizeCampaignData(req.body || {});
    const result = await pool.query(
      `
        UPDATE suitepim_campaigns
           SET environment = $1,
               title = $2,
               data = $3::jsonb,
               updated_at = NOW()
         WHERE id = $4
         RETURNING id, environment, title, data, created_by, created_at, updated_at
      `,
      [env, data.title, JSON.stringify(data), id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Campaign not found" });
    res.json({ ok: true, campaign: mapSuitePimCampaignRow(result.rows[0]) });
  } catch (err) {
    console.error("SuitePim campaign update failed:", err);
    res.status(400).json({ ok: false, error: err.message || "Failed to update campaign" });
  }
});

router.delete("/campaigns/:id", async (req, res) => {
  try {
    await ensureSuitePimCampaignTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: "Invalid campaign id" });

    const result = await pool.query("DELETE FROM suitepim_campaigns WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Campaign not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("SuitePim campaign delete failed:", err);
    res.status(500).json({ ok: false, error: err.message || "Failed to delete campaign" });
  }
});

router.get("/ai-prompts/product-descriptions", async (req, res) => {
  try {
    const [netsuite, ean] = await Promise.all([
      loadProductDescriptionPromptElements("netsuite"),
      loadProductDescriptionPromptElements("ean"),
    ]);
    res.json({
      ok: true,
      prompts: {
        netsuite,
        ean,
      },
      defaults: PRODUCT_DESCRIPTION_PROMPT_SCOPES,
    });
  } catch (err) {
    console.error("SuitePim prompt config load failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put("/ai-prompts/product-descriptions/:scope", async (req, res) => {
  try {
    const scope = String(req.params.scope || "").trim().toLowerCase();
    const elements = await saveProductDescriptionPromptElements(scope, req.body?.elements);
    res.json({ ok: true, scope, elements });
  } catch (err) {
    console.error("SuitePim prompt config save failed:", err);
    const status = /invalid|required/i.test(err.message) ? 400 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.post("/generate-description", async (req, res) => {
  try {
    const env = normalizeEnvironment(req.query.environment);
    const row = req.body?.row;
    if (!row || typeof row !== "object") {
      return res.status(400).json({ ok: false, error: "Missing row payload" });
    }

    const generated = await generateFeatureDescription(row, env);
    res.json({
      ok: true,
      text: generated.text,
      model: generated.model,
      usage: generated.usage,
      fieldUpdates: generated.fieldUpdates || {},
      enriched: !!generated.enriched,
      matchedProductName: generated.matchedProductName || "",
      confidenceNotes: generated.confidenceNotes || "",
    });
  } catch (err) {
    console.error("SuitePim description generation failed:", err);
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
    const mappedFields = await effectiveSuitePimFields(env);
    const jobId = crypto.randomBytes(6).toString("hex");

    jobs[jobId] = {
      id: jobId,
      status: "pending",
      total: rows.length,
      processed: 0,
      results: [],
      rows,
      fields: mappedFields,
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

router.post("/campaigns/push-batch", async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: "No rows to push" });

    const env = normalizeEnvironment(req.body.environment || req.query.environment);
    const cfg = envConfig(env);
    if (!cfg.campaignPriceRestletUrl) {
      return res.status(500).json({
        ok: false,
        error: `Missing ${env === "production" ? "NETSUITE_PROD_CAMPAIGN_PRICE_RESTLET_URL" : "NETSUITE_SANDBOX_CAMPAIGN_PRICE_RESTLET_URL"} or NETSUITE_CAMPAIGN_PRICE_RESTLET_URL`,
      });
    }

    const userId = req.eposSession.user_id || req.eposSession.id;
    const jobId = crypto.randomBytes(6).toString("hex");

    jobs[jobId] = {
      id: jobId,
      type: "campaign-batch",
      status: "pending",
      total: rows.length,
      processed: 0,
      results: [],
      rows,
      cfg,
      userId,
      environment: publicEnvironmentName(env),
      createdAt: new Date().toISOString(),
      batchSize: CAMPAIGN_BATCH_SIZE,
      batchTotal: Math.ceil(rows.length / CAMPAIGN_BATCH_SIZE),
      batchProcessed: 0,
      batchInProgress: 0,
    };
    jobQueue.push(jobId);
    if (jobQueue.length === 1) runNextJob().catch((err) => console.error("SuitePim queue failed:", err));

    res.json({ ok: true, jobId, queuePos: jobQueue.indexOf(jobId) + 1, queueTotal: jobQueue.length, batchSize: CAMPAIGN_BATCH_SIZE });
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
    type: job.type || "standard",
    status: job.status,
    total: job.total,
    processed: job.processed,
    results: job.results,
    environment: job.environment,
    batchSize: job.batchSize || null,
    batchTotal: job.batchTotal || null,
    batchProcessed: job.batchProcessed || 0,
    batchInProgress: job.batchInProgress || 0,
    queuePos: jobQueue.indexOf(job.id) + 1 || 0,
    queueTotal: jobQueue.length,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
});

prewarmWebManagementCache();
startWebManagementCacheRefreshTimer();

module.exports = router;
