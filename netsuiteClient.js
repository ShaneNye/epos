// netsuiteClient.js
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");
const fetch = require("node-fetch");

const config = {
  account: process.env.NS_ACCOUNT,
  accountDash: process.env.NS_ACCOUNT_DASH,
  consumerKey: process.env.NS_CONSUMER_KEY,
  consumerSecret: process.env.NS_CONSUMER_SECRET,
  tokenId: process.env.NS_TOKEN_ID,
  tokenSecret: process.env.NS_TOKEN_SECRET,
  restUrl: `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/record/v1`,
};

const oauth = OAuth({
  consumer: { key: config.consumerKey, secret: config.consumerSecret },
  signature_method: "HMAC-SHA256",
  hash_function(base_string, key) {
    return crypto.createHmac("sha256", key).update(base_string).digest("base64");
  },
});

function getAuthHeader(url, method) {
  const token = { key: config.tokenId, secret: config.tokenSecret };
  const header = oauth.toHeader(oauth.authorize({ url, method }, token));
  header.Authorization += `, realm="${config.account}"`;
  return header;
}

/* ======================================================
   ===============   GET   ===============================
   ====================================================== */
async function nsGet(endpoint) {
  const url = `${config.restUrl}${endpoint}`;
  const headers = { ...getAuthHeader(url, "GET"), "Content-Type": "application/json" };

  const res = await fetch(url, { headers });
  const text = await res.text();

  if (!res.ok) {
    console.error(`❌ NetSuite GET ${endpoint} → ${res.status}`, text);
    const err = new Error(`NetSuite GET ${endpoint} → ${res.status}`);
    err.responseBody = tryParse(text);
    throw err;
  }

  return tryParse(text);
}

/* ======================================================
   ===============   POST (record API)   =================
   ====================================================== */
async function nsPost(endpoint, body) {
  const url = `${config.restUrl}${endpoint}`;
  const headers = { ...getAuthHeader(url, "POST"), "Content-Type": "application/json" };

  console.log(`➡️ [POST] NetSuite ${endpoint}`);

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();

  if (!res.ok) {
    console.error(`❌ NetSuite POST ${endpoint} → ${res.status}`);
    console.error("🧾 NetSuite error response:", text);

    const err = new Error(`NetSuite POST ${endpoint} → ${res.status}`);
    err.responseBody = tryParse(text);
    throw err;
  }

  const locationHeader = res.headers.get("Location") || res.headers.get("location");
  const idMatch = locationHeader?.match(/\/(\d+)$/);
  const id = idMatch ? idMatch[1] : null;

  console.log(`✅ NetSuite created record ${id || "(no ID)"}`);
  return { id, _location: locationHeader || null };
}

/* ======================================================
   ===============   PATCH (update record)   =============
   ====================================================== */
async function nsPatch(endpoint, body) {
  const url = `${config.restUrl}${endpoint}`;
  const headers = { ...getAuthHeader(url, "PATCH"), "Content-Type": "application/json" };
  console.log(`🔄 [PATCH] NetSuite ${endpoint}`);

  const res = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(body) });
  const text = await res.text();

  if (!res.ok) {
    console.error(`❌ NetSuite PATCH ${endpoint} → ${res.status}`);
    console.error("🧾 NetSuite error response:", text);

    const err = new Error(`NetSuite PATCH ${endpoint} → ${res.status}`);
    err.responseBody = tryParse(text);
    throw err;
  }

  console.log("✅ Record updated successfully.");
  return tryParse(text);
}

/* ======================================================
   ===============   POST RAW (SuiteQL etc)  =============
   ====================================================== */
async function nsPostRaw(fullUrl, body) {
  const headers = {
    ...getAuthHeader(fullUrl, "POST"),
    "Content-Type": "application/json",
    Prefer: "transient",
  };
  console.log(`🧾 [SuiteQL] ${fullUrl}`);

  const res = await fetch(fullUrl, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();

  if (!res.ok) {
    console.error(`❌ NetSuite SuiteQL → ${res.status}`);
    console.error("🧾 NetSuite error response:", text);
    const err = new Error(`NetSuite SuiteQL → ${res.status}`);
    err.responseBody = tryParse(text);
    throw err;
  }

  return tryParse(text);
}

/* ======================================================
   ===============   Helper: safe JSON parse   ===========
   ====================================================== */
function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/* ======================================================
   ===============   EXPORTS   ===========================
   ====================================================== */
module.exports = { nsGet, nsPost, nsPatch, nsPostRaw, getAuthHeader };
