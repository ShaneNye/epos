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
const MAX_CONCURRENT = Number(process.env.SUITEPIM_PUSH_CONCURRENCY || 1);
const WEB_MANAGEMENT_CACHE_TTL_MS = Number(process.env.SUITEPIM_WEB_MANAGEMENT_CACHE_TTL_MS || 15 * 60 * 1000);
const WEB_MANAGEMENT_STALE_MS = Number(process.env.SUITEPIM_WEB_MANAGEMENT_STALE_MS || 6 * 60 * 60 * 1000);
const WEB_MANAGEMENT_REFRESH_INTERVAL_MS = Number(
  process.env.SUITEPIM_WEB_MANAGEMENT_REFRESH_INTERVAL_MS || WEB_MANAGEMENT_CACHE_TTL_MS
);

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
  };
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
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

function normalizeOption(item, fieldName = "") {
  const name = String(item.Name || item.name || item.text || item.label || "").trim();
  const rawId = String(item["Internal ID"] || item.internalId || item.id || "").trim();
  const fallbackId = fieldName === "Reasons To Buy" ? name : "";
  return {
    id: rawId || fallbackId,
    name,
    raw: item,
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
  return process.env[feed[env]] || feed[fallbackKey] || "";
}

function optionTokenFor(fieldName, env) {
  if (fieldName === "Reasons To Buy") {
    return process.env.REASONS_TO_BUY || "";
  }
  if (fieldName === "Web Images") {
    return process.env.SUITEPIM_IMAGE || "";
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
    const options = rows.map((item) => normalizeOption(item, fieldName)).filter((o) => o.id && o.name);
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

async function loadMultipleSelectOptionMap(env) {
  const optionFeedPromises = new Map();
  const optionMap = {};

  fields
    .filter((field) => field.fieldType === "multiple-select" && field.optionFeed)
    .forEach((field) => {
      if (!optionFeedPromises.has(field.optionFeed)) {
        optionFeedPromises.set(field.optionFeed, fetchOptionFeed(field.optionFeed, env).catch(() => []));
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
      : String(raw || "").split(",").map((v) => v.trim()).filter(Boolean);
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

function childItemName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parts = text.split(" : ").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

function normalizeRowAliases(row) {
  const next = { ...row };

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
      } else if (field.name === "Name") {
        payload[field.internalid] = childItemName(value);
      } else {
        payload[field.internalid] = String(value);
      }
    }

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

async function fetchWebManagementRows(cfg) {
  const url = withSuiteletToken(cfg.webManagementUrl, cfg.webManagementToken);
  const response = await fetch(url);
  const payload = parseJson(await response.text());
  if (!response.ok) throw new Error(`Web management feed returned ${response.status}`);
  return Array.isArray(payload) ? payload : payload.results || payload.items || [];
}

async function buildWebManagementPayload(env, cfg) {
  const startedAt = Date.now();
  const [rawRows, optionMap] = await Promise.all([
    fetchWebManagementRows(cfg),
    loadMultipleSelectOptionMap(env),
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

function refreshWebManagementCache(key, env, cfg) {
  const existing = webManagementCache.get(key);
  if (existing?.inFlight) return existing.inFlight;

  const inFlight = buildWebManagementPayload(env, cfg)
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

async function getWebManagementPayload(env, cfg, { forceRefresh = false } = {}) {
  const key = webManagementCacheKey(env);
  const cached = webManagementCache.get(key);
  const age = cached?.loadedAt ? Date.now() - cached.loadedAt : Infinity;

  if (!forceRefresh && cached?.payload && age < WEB_MANAGEMENT_CACHE_TTL_MS) {
    return withWebManagementCacheMeta(cached.payload, cached, "cache");
  }

  if (!forceRefresh && cached?.payload && age < WEB_MANAGEMENT_STALE_MS) {
    refreshWebManagementCache(key, env, cfg).catch((err) => {
      console.error("SuitePim web management background refresh failed:", err);
    });
    return withWebManagementCacheMeta(cached.payload, webManagementCache.get(key), "stale");
  }

  const payload = await refreshWebManagementCache(key, env, cfg);
  return withWebManagementCacheMeta(payload, webManagementCache.get(key), forceRefresh ? "refresh" : "origin");
}

function prewarmWebManagementCache() {
  if (String(process.env.SUITEPIM_WEB_MANAGEMENT_PREWARM || "true").toLowerCase() === "false") return;

  ["production", "sandbox"].forEach((env, index) => {
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
    ["production", "sandbox"].forEach((env) => {
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
    const optionMap = await loadMultipleSelectOptionMap(env);

    const rows = rawRows.map((row) => recalcRow(normalizeMultipleSelects(normalizeRowAliases(row), optionMap)));
    res.json({ ok: true, rows, count: rows.length, environment: publicEnvironmentName(env) });
  } catch (err) {
    console.error("SuitePim product load failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/web-management/config", (req, res) => {
  const env = normalizeEnvironment(req.query.environment);
  const cfg = envConfig(env);
  const openai = openAIConfig();
  const cleanFields = fields.map(({ optionFeed, ...field }) => ({
    ...field,
    hasOptions: !!optionFeed,
    optionFeed,
  }));
  res.json({
    ok: true,
    environment: publicEnvironmentName(env),
    fields: cleanFields,
    webManagementFeedConfigured: !!cfg.webManagementUrl,
    priceRestletConfigured: !!cfg.priceRestletUrl,
    aiGenerationConfigured: !!openai.apiKey,
    aiGenerationModel: openai.model,
  });
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
    const payload = await getWebManagementPayload(env, cfg, { forceRefresh });
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
    const requested = req.params.fieldName;
    const field = fields.find((f) => f.name.toLowerCase() === requested.toLowerCase());
    if (!field?.optionFeed) return res.json({ ok: true, options: [] });
    const options = await fetchOptionFeed(field.optionFeed, env);
    res.json({ ok: true, options });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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

prewarmWebManagementCache();
startWebManagementCacheRefreshTimer();

module.exports = router;
