const OAuth = require("oauth-1.0a");
const crypto = require("crypto");
const fetch = require("node-fetch");
const pool = require("./db"); // ✅ new — so we can fetch user tokens

const config = {
  account: process.env.NS_ACCOUNT,
  accountDash: process.env.NS_ACCOUNT_DASH,
  consumerKey: process.env.NS_CONSUMER_KEY,
  consumerSecret: process.env.NS_CONSUMER_SECRET,
  restUrl: `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/record/v1`,
};

const oauth = OAuth({
  consumer: { key: config.consumerKey, secret: config.consumerSecret },
  signature_method: "HMAC-SHA256",
  hash_function(base_string, key) {
    return crypto.createHmac("sha256", key).update(base_string).digest("base64");
  },
});

/**
 * 🧩 Build OAuth Header dynamically
 * Optionally pass a userId to use per-user NetSuite tokens from DB.
 */
async function getAuthHeader(url, method, userId = null, envType = "sb") {
  let tokenId = process.env.NS_TOKEN_ID;
  let tokenSecret = process.env.NS_TOKEN_SECRET;

  if (userId) {
    try {
      const result = await pool.query(
        `SELECT 
           sb_netsuite_token_id, sb_netsuite_token_secret,
           prod_netsuite_token_id, prod_netsuite_token_secret
         FROM users
         WHERE id = $1 LIMIT 1`,
        [userId]
      );

      if (result.rows.length) {
        const user = result.rows[0];
        if (envType === "prod") {
          tokenId = user.prod_netsuite_token_id || tokenId;
          tokenSecret = user.prod_netsuite_token_secret || tokenSecret;
        } else {
          tokenId = user.sb_netsuite_token_id || tokenId;
          tokenSecret = user.sb_netsuite_token_secret || tokenSecret;
        }
      }
    } catch (err) {
      console.error("⚠️ Failed to fetch user NetSuite tokens:", err.message);
    }
  }

  const token = { key: tokenId, secret: tokenSecret };
  const header = oauth.toHeader(oauth.authorize({ url, method }, token));
  header.Authorization += `, realm="${config.account}"`;
  return header;
}

/* ======================================================
   ===============   GET   ===============================
   ====================================================== */
async function nsGet(endpoint, userId = null, envType = "sb") {
  const url = `${config.restUrl}${endpoint}`;
  const headers = { ...(await getAuthHeader(url, "GET", userId, envType)), "Content-Type": "application/json" };

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
async function nsPost(endpoint, body, userId = null, envType = "sb") {
  const url = `${config.restUrl}${endpoint}`;
  const headers = { ...(await getAuthHeader(url, "POST", userId, envType)), "Content-Type": "application/json" };

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
async function nsPatch(endpoint, body, userId = null, envType = "sb") {
  const url = `${config.restUrl}${endpoint}`;
  const headers = { ...(await getAuthHeader(url, "PATCH", userId, envType)), "Content-Type": "application/json" };
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
async function nsPostRaw(fullUrl, body, userId = null, envType = "sb") {
  const headers = {
    ...(await getAuthHeader(fullUrl, "POST", userId, envType)),
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

module.exports = { nsGet, nsPost, nsPatch, nsPostRaw, getAuthHeader };
