const OAuth = require("oauth-1.0a");
const crypto = require("crypto");
const fetch = require("node-fetch");
const pool = require("./db");

/* ======================================================
   ===============  Base Config  =========================
   ====================================================== */

function normalizeEnvironmentName(value) {
  const env = String(value || "").trim().toUpperCase();
  if (env === "PROD") return "PRODUCTION";
  if (env === "SB" || env === "SANBOX" || env === "SANDBOX") return "SANDBOX";
  return env || "SANDBOX";
}

process.env.ENVIRONMENT = normalizeEnvironmentName(process.env.ENVIRONMENT);

const config = {
  account: process.env.NS_ACCOUNT,
  accountDash: process.env.NS_ACCOUNT_DASH,
  consumerKey: process.env.NS_CONSUMER_KEY,
  consumerSecret: process.env.NS_CONSUMER_SECRET,
  restUrl: `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/record/v1`,
};

function isSandboxAccount(accountDash = config.accountDash) {
  return /-sb\d*$/i.test(String(accountDash || ""));
}

function assertNetSuiteEnvironment() {
  if (currentEnvLabel() === "SANDBOX" && !isSandboxAccount()) {
    throw new Error(
      `Refusing NetSuite call: ENVIRONMENT=SANDBOX but NS_ACCOUNT_DASH=${config.accountDash || "(missing)"} is not a sandbox account.`
    );
  }

  if (currentEnvLabel() === "PRODUCTION" && isSandboxAccount()) {
    throw new Error(
      `Refusing NetSuite call: ENVIRONMENT=PRODUCTION but NS_ACCOUNT_DASH=${config.accountDash} is a sandbox account.`
    );
  }
}

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
const NETSUITE_MAX_CONCURRENT_REQUESTS =
  Math.max(1, Number(process.env.NETSUITE_MAX_CONCURRENT_REQUESTS || 2) || 2);
const NETSUITE_MAX_RETRIES =
  Math.max(0, Number(process.env.NETSUITE_MAX_RETRIES || 3) || 3);
const NETSUITE_RETRY_BASE_MS =
  Math.max(100, Number(process.env.NETSUITE_RETRY_BASE_MS || 700) || 700);
let activeNetSuiteRequests = 0;
const netSuiteRequestQueue = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireNetSuiteSlot() {
  if (activeNetSuiteRequests < NETSUITE_MAX_CONCURRENT_REQUESTS) {
    activeNetSuiteRequests += 1;
    return;
  }

  await new Promise((resolve) => netSuiteRequestQueue.push(resolve));
  activeNetSuiteRequests += 1;
}

function releaseNetSuiteSlot() {
  activeNetSuiteRequests = Math.max(0, activeNetSuiteRequests - 1);
  const next = netSuiteRequestQueue.shift();
  if (next) next();
}

function retryDelayMs(res, attempt) {
  const retryAfter = res?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }

  const jitter = Math.floor(Math.random() * 250);
  return NETSUITE_RETRY_BASE_MS * Math.pow(2, attempt) + jitter;
}

function isRetryableNetSuiteStatus(status) {
  return status === 429 || status === 503 || status === 504;
}

async function fetchNetSuiteWithRetry({
  url,
  method,
  userId = null,
  headers = {},
  body,
  logLabel = "NetSuite request",
}) {
  let lastResult = null;

  for (let attempt = 0; attempt <= NETSUITE_MAX_RETRIES; attempt += 1) {
    let delayAfterRelease = 0;
    await acquireNetSuiteSlot();

    try {
      const authHeaders = await getAuthHeader(url, method, userId);
      const res = await fetch(url, {
        method,
        headers: {
          ...authHeaders,
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
      });
      const text = await res.text();
      lastResult = { res, text };

      if (
        !res.ok &&
        isRetryableNetSuiteStatus(res.status) &&
        attempt < NETSUITE_MAX_RETRIES
      ) {
        delayAfterRelease = retryDelayMs(res, attempt);
        console.warn(
          `⚠️ ${logLabel} returned ${res.status}; retrying in ${delayAfterRelease}ms (${attempt + 1}/${NETSUITE_MAX_RETRIES})`
        );
      } else {
        return lastResult;
      }
    } finally {
      releaseNetSuiteSlot();
    }

    if (delayAfterRelease > 0) await sleep(delayAfterRelease);
  }

  return lastResult;
}

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

function clearUserTokenCache(userId = null) {
  if (userId == null) {
    userTokenCache.clear();
    return;
  }

  const suffix = `:${String(userId)}`;
  for (const key of userTokenCache.keys()) {
    if (key.endsWith(suffix)) userTokenCache.delete(key);
  }
}

/* ======================================================
   ===============  Auth Header Helper  =================
   ====================================================== */

async function getAuthHeader(url, method, userId = null) {
  assertNetSuiteEnvironment();

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
  const { res, text } = await fetchNetSuiteWithRetry({
    url,
    method: "GET",
    userId,
    headers: { "Content-Type": "application/json" },
    logLabel: `NetSuite GET ${endpoint}`,
  });

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

  console.log(`➡️ [POST] NetSuite ${endpoint} (user: ${userId || "env default"})`);

  const { res, text } = await fetchNetSuiteWithRetry({
    url,
    method: "POST",
    userId,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    logLabel: `NetSuite POST ${endpoint}`,
  });

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

  console.log(`🔄 [PATCH] NetSuite ${endpoint}`);

  const { res, text } = await fetchNetSuiteWithRetry({
    url,
    method: "PATCH",
    userId,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    logLabel: `NetSuite PATCH ${endpoint}`,
  });

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
  console.log(`🧾 [SuiteQL] ${fullUrl}`);

  const { res, text } = await fetchNetSuiteWithRetry({
    url: fullUrl,
    method: "POST",
    userId,
    headers: {
      "Content-Type": "application/json",
      Prefer: "transient",
    },
    body: JSON.stringify(body),
    logLabel: "NetSuite SuiteQL",
  });

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
  console.log(`🛠 [RESTlet] ${method} ${fullUrl}`);

  const { text } = await fetchNetSuiteWithRetry({
    url: fullUrl,
    method,
    userId,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    logLabel: `NetSuite RESTlet ${method}`,
  });
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
  clearUserTokenCache,
};
