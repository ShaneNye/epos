const OAuth = require("oauth-1.0a");
const crypto = require("crypto");
const fetch = require("node-fetch");
const pool = require("./db");

/* ======================================================
   ===============  Base Config  =========================
   ====================================================== */

const config = {
  account: process.env.NS_ACCOUNT,
  accountDash: process.env.NS_ACCOUNT_DASH,
  consumerKey: process.env.NS_CONSUMER_KEY,
  consumerSecret: process.env.NS_CONSUMER_SECRET,
  restUrl: `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/record/v1`,
};

/* ======================================================
   ===============  Environment Resolver  =================
   ====================================================== */

function isProduction() {
  return (process.env.ENVIRONMENT || "").toUpperCase() === "PRODUCTION";
}

function currentEnvLabel() {
  return isProduction() ? "PRODUCTION" : "SANDBOX";
}

const oauth = OAuth({
  consumer: { key: config.consumerKey, secret: config.consumerSecret },
  signature_method: "HMAC-SHA256",
  hash_function(base_string, key) {
    return crypto.createHmac("sha256", key).update(base_string).digest("base64");
  },
});

const USER_TOKEN_CACHE_TTL_MS =
  Number(process.env.NS_USER_TOKEN_CACHE_TTL_MS || 5 * 60 * 1000) || 5 * 60 * 1000;
const userTokenCache = new Map();

function userTokenCacheKey(userId) {
  return `${currentEnvLabel()}:${String(userId)}`;
}

function readCachedUserTokens(userId) {
  const key = userTokenCacheKey(userId);
  const cached = userTokenCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    userTokenCache.delete(key);
    return null;
  }

  return cached.tokens;
}

function cacheUserTokens(userId, tokens) {
  userTokenCache.set(userTokenCacheKey(userId), {
    tokens,
    expiresAt: Date.now() + USER_TOKEN_CACHE_TTL_MS,
  });
}

/* ======================================================
   ===============  Auth Header Helper  =================
   ====================================================== */

async function getAuthHeader(url, method, userId = null) {
  let tokenId = process.env.NS_TOKEN_ID;
  let tokenSecret = process.env.NS_TOKEN_SECRET;

  if (userId) {
    const cachedTokens = readCachedUserTokens(userId);
    if (cachedTokens) {
      tokenId = cachedTokens.tokenId || tokenId;
      tokenSecret = cachedTokens.tokenSecret || tokenSecret;
      userId = null;
    }
  }

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

        if (isProduction()) {
          tokenId = u.prod_netsuite_token_id || tokenId;
          tokenSecret = u.prod_netsuite_token_secret || tokenSecret;
        } else {
          tokenId = u.sb_netsuite_token_id || tokenId;
          tokenSecret = u.sb_netsuite_token_secret || tokenSecret;
        }

        cacheUserTokens(userId, { tokenId, tokenSecret });

        if (!tokenId || !tokenSecret) {
          console.warn(
            `⚠️ User ${userId} missing NetSuite token fields for ${currentEnvLabel()}`
          );
        } else {
          console.log(
            `🔐 Using user-specific NetSuite tokens for user ${userId} (${currentEnvLabel()})`
          );
        }
      } else {
        console.warn(
          `⚠️ No DB record found for user ${userId}, falling back to global tokens`
        );
      }
    } catch (err) {
      console.error("❌ DB token lookup failed:", err.message);
    }
  }

  if (!tokenId || !tokenSecret) {
    console.warn(
      `⚠️ Using fallback global .env NetSuite token credentials (${currentEnvLabel()})`
    );
  }

  const token = { key: tokenId, secret: tokenSecret };
  const header = oauth.toHeader(oauth.authorize({ url, method }, token));
  header.Authorization += `, realm="${config.account}"`;

  return header;
}

/* ======================================================
   ===============   GET   ===============================
   ====================================================== */

async function nsGet(endpoint, userId = null) {
  const url = `${config.restUrl}${endpoint}`;
  const headers = {
    ...(await getAuthHeader(url, "GET", userId)),
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

async function nsPost(endpoint, body, userId = null) {
  const url = `${config.restUrl}${endpoint}`;
  const headers = {
    ...(await getAuthHeader(url, "POST", userId)),
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

    console.error("🔍 Diagnostic →", {
      userId,
      environment: currentEnvLabel(),
      account: config.account,
      consumerKey: config.consumerKey ? "***" : "(missing)",
      tokenSource: userId ? "user DB" : "global env",
    });

    const err = new Error(`NetSuite POST ${endpoint} → ${res.status}`);
    err.responseBody = tryParse(text);
    throw err;
  }

  const locationHeader =
    res.headers.get("Location") || res.headers.get("location");
  const idMatch = locationHeader?.match(/\/(\d+)$/);
  const id = idMatch ? idMatch[1] : null;

  console.log(`✅ NetSuite created record ${id || "(no ID)"}`);
  return { id, _location: locationHeader || null };
}

/* ======================================================
   ===============   PATCH (update record)   =============
   ====================================================== */

async function nsPatch(endpoint, body, userId = null) {
  const url = `${config.restUrl}${endpoint}`;
  const headers = {
    ...(await getAuthHeader(url, "PATCH", userId)),
    "Content-Type": "application/json",
  };

  console.log(`🔄 [PATCH] NetSuite ${endpoint}`);

  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });

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

async function nsPostRaw(fullUrl, body, userId = null) {
  const headers = {
    ...(await getAuthHeader(fullUrl, "POST", userId)),
    "Content-Type": "application/json",
    Prefer: "transient",
  };

  console.log(`🧾 [SuiteQL] ${fullUrl}`);

  const res = await fetch(fullUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

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
   ===============   RESTlet   ============================
   ====================================================== */

async function nsRestlet(fullUrl, body = null, userId = null, method = "POST") {
  const headers = {
    ...(await getAuthHeader(fullUrl, method, userId)),
    "Content-Type": "application/json",
  };

  console.log(`🛠 [RESTlet] ${method} ${fullUrl}`);

  const res = await fetch(fullUrl, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
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

module.exports = {
  nsGet,
  nsPost,
  nsPatch,
  nsPostRaw,
  nsRestlet,
  getAuthHeader,
};
