const OAuth = require("oauth-1.0a");
const crypto = require("crypto");
const fetch = require("node-fetch");
const pool = require("./db"); // ✅ needed for per-user tokens

/* ======================================================
   ===============  Base Config  =========================
   ====================================================== */
const config = {
  account: process.env.NS_ACCOUNT,               // e.g. 7972741_SB1
  accountDash: process.env.NS_ACCOUNT_DASH,      // e.g. 7972741-sb1
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

/* ======================================================
   ===============  Auth Header Helper  =================
   ====================================================== */
/**
 * Build an OAuth 1.0 header.  If userId provided, pull their tokens from DB.
 * envType: 'sb' or 'prod'
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
         WHERE id = $1
         LIMIT 1`,
        [userId]
      );

      if (result.rows.length) {
        const u = result.rows[0];
        if (envType === "prod") {
          tokenId = u.prod_netsuite_token_id || tokenId;
          tokenSecret = u.prod_netsuite_token_secret || tokenSecret;
        } else {
          tokenId = u.sb_netsuite_token_id || tokenId;
          tokenSecret = u.sb_netsuite_token_secret || tokenSecret;
        }

        if (!tokenId || !tokenSecret) {
          console.warn(`⚠️ User ${userId} has missing NetSuite token fields for ${envType}`);
        } else {
          console.log(`🔐 Using user-specific NetSuite tokens for user ${userId} (${envType})`);
        }
      } else {
        console.warn(`⚠️ No DB record found for user ${userId}, falling back to global tokens`);
      }
    } catch (err) {
      console.error("❌ DB token lookup failed:", err.message);
    }
  }

  if (!tokenId || !tokenSecret) {
    console.warn("⚠️ Using fallback global .env NetSuite token credentials");
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
  const headers = {
    ...(await getAuthHeader(url, "GET", userId, envType)),
    "Content-Type": "application/json",
  };

  const res = await fetch(url, { headers });
  const text = await res.text();

  if (!res.ok) {
    console.error(`❌ NetSuite GET ${endpoint} → ${res.status}`);
    console.error("🧾 NetSuite response:", text);
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
  const headers = {
    ...(await getAuthHeader(url, "POST", userId, envType)),
    "Content-Type": "application/json",
  };

  console.log(`➡️ [POST] NetSuite ${endpoint} (user: ${userId || "env default"})`);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error(`❌ NetSuite POST ${endpoint} → ${res.status}`);
    console.error("🧾 NetSuite error response:", text);

    // diagnostic dump for debugging
    console.error("🔍 Token used →", {
      userId,
      envType,
      account: config.account,
      consumerKey: config.consumerKey ? "***" : "(missing)",
      tokenId: userId ? "(from user DB)" : process.env.NS_TOKEN_ID,
    });

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
  const headers = {
    ...(await getAuthHeader(url, "PATCH", userId, envType)),
    "Content-Type": "application/json",
  };

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

async function nsRestlet(fullUrl, body = null, userId = null, envType = "sb", method = "POST") {
  // Build OAuth header for the correct HTTP method
  const headers = {
    ...(await getAuthHeader(fullUrl, method, userId, envType)),
    "Content-Type": "application/json"
  };

  console.log(`🛠 [RESTlet] ${method} ${fullUrl}`);
  if (body && method === "POST") {
    console.log("📤 RESTlet payload:", body);
  }

  const res = await fetch(fullUrl, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body || {}) : undefined
  });

  const text = await res.text();
  console.log("📥 Raw RESTlet response:", text);

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, raw: text };
  }
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

module.exports = { nsGet, nsPost, nsPatch, nsPostRaw, nsRestlet, getAuthHeader };
