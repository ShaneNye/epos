// server.js
const isRenderRuntime = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
require("dotenv").config({
  override: !isRenderRuntime || String(process.env.DOTENV_OVERRIDE || "").toLowerCase() === "true",
});

function normalizeEnvironmentName(value) {
  const env = String(value || "").trim().toUpperCase();
  if (env === "PROD") return "PRODUCTION";
  if (env === "SB" || env === "SANBOX" || env === "SANDBOX") return "SANDBOX";
  return env || "SANDBOX";
}

process.env.ENVIRONMENT = normalizeEnvironmentName(process.env.ENVIRONMENT);
console.log("🟦 Loaded salesMemos.js FROM:", __filename);

console.log("🟢 Server starting from directory:", __dirname);

const express = require("express");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");
const { getSession } = require("./sessions");
const pool = require("./db"); // for user token lookup if stored in DB
const fetch = require("node-fetch");
const {
  isAlwaysAllowedPath,
  isPageShellPath,
  isPublicPath,
} = require("./utils/accessControlRules");
const { getNetSuiteHomeUrl } = require("./utils/netsuiteEnvironment");
const { ensureUserStatusColumn } = require("./utils/userStatus");

const app = express();
const PORT = process.env.PORT || 3000;
const itemOptionsRoute = require("./routes/itemOptions");
const salesOrderExperience = require("./routes/salesOrderExperience");

function assertNetSuiteEnvironment() {
  const env = process.env.ENVIRONMENT;
  const accountDash = String(process.env.NS_ACCOUNT_DASH || "");
  const isSandboxAccount = /-sb\d*$/i.test(accountDash);

  console.log("NetSuite target:", {
    environment: env,
    accountDash,
    account: process.env.NS_ACCOUNT || "",
  });

  if (env === "SANDBOX" && !isSandboxAccount) {
    throw new Error(
      `Refusing to start: ENVIRONMENT=SANDBOX but NS_ACCOUNT_DASH=${accountDash || "(missing)"} is not a sandbox account.`
    );
  }

  if (env === "PRODUCTION" && isSandboxAccount) {
    throw new Error(
      `Refusing to start: ENVIRONMENT=PRODUCTION but NS_ACCOUNT_DASH=${accountDash} is a sandbox account.`
    );
  }

  const mismatchedUrls = Object.entries(process.env)
    .filter(([key, value]) => /URL$/.test(key) && /netsuite\.com/i.test(String(value || "")))
    .filter(([, value]) => {
      let host = "";
      try {
        host = new URL(String(value).replace(/^"|"$/g, "")).host;
      } catch {
        return false;
      }

      const isSandboxHost = /\.?sb\d*\.|\.?sb\d*-|(-sb\d*)\./i.test(host) || /-sb\d*\./i.test(host);
      return env === "SANDBOX" ? !isSandboxHost : isSandboxHost;
    })
    .map(([key, value]) => {
      try {
        return `${key}=${new URL(String(value).replace(/^"|"$/g, "")).host}`;
      } catch {
        return key;
      }
    });

  if (mismatchedUrls.length) {
    throw new Error(
      `Refusing to start: NetSuite URL environment mismatch for ${env}: ${mismatchedUrls.join(", ")}`
    );
  }
}

assertNetSuiteEnvironment();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

function isApiRequest(req) {
  return req.path.startsWith("/api/") || req.get("accept")?.includes("application/json");
}

function rowBinText(row) {
  if (!row || typeof row !== "object") return "";
  return [
    row["Bin Number"],
    row["Bin"],
    row.bin,
    row.binNumber,
    row.binnumber,
    row["Bin Name"],
    row.binName,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function isOutboundBinRow(row) {
  return rowBinText(row).toUpperCase().includes("OUTBOUND");
}

function excludeOutboundBinRows(payload) {
  if (Array.isArray(payload)) return payload.filter((row) => !isOutboundBinRow(row));
  if (!payload || typeof payload !== "object") return payload;
  const filterRows = (rows) => (Array.isArray(rows) ? rows.filter((row) => !isOutboundBinRow(row)) : rows);
  return {
    ...payload,
    results: filterRows(payload.results),
    data: filterRows(payload.data),
  };
}

function normalizeAccessPath(value) {
  const slug = String(value || "")
    .replace(/^\//, "")
    .replace(/\.html$/i, "")
    .trim()
    .toLowerCase();

  if (slug === "end-of-day" || slug === "endofday") return "eod";
  if (slug === "cash-flow") return "cashflow";
  if (slug === "suitepim" || slug.startsWith("suitepim/")) return "suitepim";
  return slug;
}

function sendNoCacheFile(res, filePath) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  return res.sendFile(filePath);
}

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/assistant", (req, res, next) => {
  if (req.path.endsWith(".js")) res.type("application/javascript");
  next();
}, express.static(path.join(__dirname, "public", "assistant")));

// ✅ Force correct MIME type for .js module files
app.use((req, res, next) => {
  if (req.path.endsWith(".js")) {
    res.type("application/javascript");
  }
  next();
});



// --- Serve static assets. HTML pages are served through named routes below so
// access control can run consistently.
const publicStatic = express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    },
  });

app.use((req, res, next) => {
  if (/\.html$/i.test(req.path) && req.path !== "/index.html") {
    return next();
  }
  return publicStatic(req, res, next);
});

app.use((req, res, next) => {
  const nestedAsset = req.path.match(/^\/[^/]+\/(css|js|assets|fonts)\/(.+)$/i);
  if (!nestedAsset) return next();

  req.url = `/${nestedAsset[1]}/${nestedAsset[2]}`;
  return publicStatic(req, res, next);
});

app.get("/favicon.ico", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "assets", "moon-man-logo.ico"))
);


const suiteletCache = new Map();

function wantsFreshData(req) {
  const flag = String(req.query.refresh || req.query.force || req.query.fresh || "").toLowerCase();
  const cacheControl = String(req.headers["cache-control"] || "").toLowerCase();
  const pragma = String(req.headers.pragma || "").toLowerCase();

  return (
    ["1", "true", "yes"].includes(flag) ||
    cacheControl.includes("no-cache") ||
    pragma.includes("no-cache")
  );
}

function sendCachedJson(req, res, payload, { ttlMs = 5 * 60 * 1000, noStore = false } = {}) {
  const body = JSON.stringify(payload);
  const etag = `"${crypto.createHash("sha1").update(body).digest("hex")}"`;

  if (noStore || ttlMs <= 0) {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    return res.type("application/json").send(body);
  }

  res.set({
    "Cache-Control": `private, max-age=${Math.floor(ttlMs / 1000)}, stale-while-revalidate=300`,
    ETag: etag,
  });

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  return res.type("application/json").send(body);
}

function getEnvAny(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return String(value).trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

/**
 * Utility to call NetSuite external Suitelet JSON endpoints.
 * It pulls the base URL + token from env vars dynamically.
 */
async function fetchNetSuiteData(envUrlKey, envTokenKey, req, res, label, options = {}) {
  try {
    const ttlMs = Number(options.ttlMs || process.env.SUITELET_CACHE_TTL_MS || 60 * 60 * 1000);
    const forceRefresh = Boolean(options.forceRefresh || wantsFreshData(req));
    const noStore = Boolean(options.noStore || forceRefresh || ttlMs <= 0);
    const cacheKey = `${envUrlKey}:${envTokenKey}`;
    const cached = suiteletCache.get(cacheKey);

    if (!forceRefresh && cached?.expiresAt > Date.now() && cached.payload) {
      return sendCachedJson(req, res, cached.payload, { ttlMs });
    }

    if (cached?.inFlight) {
      const payload = await cached.inFlight;
      return sendCachedJson(req, res, payload, { ttlMs, noStore });
    }

    const baseUrl = process.env[envUrlKey];
    const token = process.env[envTokenKey];

    if (!baseUrl || !token) {
      throw new Error(`Missing ${envUrlKey} or ${envTokenKey} in environment`);
    }

    // Ensure URL ends with the expected query
    const nsUrl = `${baseUrl}&token=${encodeURIComponent(token)}`;
    console.log(`📡 [NetSuite] ${label}: ${nsUrl}`);

    const inFlight = (async () => {
      try {
        const response = await fetch(nsUrl);
        if (!response.ok) throw new Error(`NetSuite response ${response.status}`);

        let json = await response.json();
        if (typeof options.transformJson === "function") {
          json = options.transformJson(json);
        }
        if (noStore) {
          suiteletCache.delete(cacheKey);
        } else {
          suiteletCache.set(cacheKey, {
            payload: json,
            expiresAt: Date.now() + ttlMs,
            inFlight: null,
          });
        }
        return json;
      } catch (err) {
        suiteletCache.delete(cacheKey);
        throw err;
      }
    })();

    suiteletCache.set(cacheKey, {
      payload: noStore ? null : cached?.payload || null,
      expiresAt: noStore ? 0 : cached?.expiresAt || 0,
      inFlight,
    });

    const json = await inFlight;
    return sendCachedJson(req, res, json, { ttlMs, noStore });
  } catch (err) {
    console.error(`❌ NetSuite ${label} proxy error:`, err);
    res.status(500).json({ ok: false, error: `Failed to fetch ${label} data` });
  }
}

// ==========================================================
// 🔥 Prewarm Sales Order cache using existing SO endpoint
// ==========================================================
async function prewarmSalesOrders(
  host,
  ids,
  prewarmHeaders,
  { limit = 300, concurrency = 3, envType = "sb" } = {}
) {
  const queue = ids.filter(Boolean).slice(0, limit).map(String);

  console.log("🔥 PREWARM QUEUE", {
    limit,
    concurrency,
    envType,
    queued: queue.length,
    first: queue.slice(0, 5),
    hasHeaders: !!prewarmHeaders && Object.keys(prewarmHeaders).length > 0,
  });

  // If we don't have the prewarm headers, this will just fall back to .env NS tokens
  // (and in your case, that caused INVALID_LOGIN), so bail early.
  const hasKey = prewarmHeaders?.["x-prewarm-key"];
  const hasUser = prewarmHeaders?.["x-prewarm-user-id"];
  if (!hasKey || !hasUser) {
    console.warn("🔥 PREWARM SKIPPED: missing x-prewarm-key or x-prewarm-user-id");
    return;
  }

  let running = 0;

  return new Promise((resolve) => {
    const next = () => {
      if (queue.length === 0 && running === 0) {
        console.log("🔥 PREWARM DONE");
        return resolve();
      }

      while (running < concurrency && queue.length) {
        const id = queue.shift();
        running++;

        const url = `${host}/api/netsuite/salesorder/${encodeURIComponent(id)}?env=${encodeURIComponent(envType)}&lite=1&deposits=0`;

        console.log("🔥 PREWARM FETCH", { id, url });

        fetch(url, { headers: prewarmHeaders })
          .then((r) => console.log("🔥 PREWARM RES", id, r.status))
          .catch((e) => console.warn("🔥 PREWARM ERR", id, e.message))
          .finally(() => {
            running--;
            next();
          });
      }
    };

    next();
  });
}


function startPrewarmScheduler() {
  const run = async () => {
    try {
      const host = `http://localhost:${PORT}`;
      const envType = process.env.PREWARM_ENV || "sb";
      const userId = process.env.DEFAULT_PREWARM_USER_ID;
      const key = process.env.PREWARM_KEY;

      if (!userId || !key) {
        console.warn("🔥 Prewarm disabled: missing DEFAULT_PREWARM_USER_ID or PREWARM_KEY");
        return;
      }

      console.log("🔥 System prewarm run starting...", { envType, userId });

      const omRes = await fetch(`${host}/api/netsuite/order-management`, {
        headers: {
          "x-prewarm-key": key,
          "x-prewarm-user-id": String(userId),
        },
      });

      const payload = await omRes.json();
      const results = payload?.results || payload || [];
      const ids = results.map(r => r?.ID).filter(Boolean);

      console.log("🔥 Prewarm list count:", ids.length);

      const prewarmHeaders = {
        "x-prewarm-key": key,
        "x-prewarm-user-id": String(userId),
      };

      await prewarmSalesOrders(host, ids, prewarmHeaders, {
        limit: 300,
        concurrency: 3,
        envType,
      });

      console.log("✅ System prewarm finished");
    } catch (e) {
      console.error("❌ System prewarm failed:", e.message || e);
    }
  };

  // boot run
  setTimeout(run, 3000);

  // hourly run
  setInterval(run, 60 * 60 * 1000);
}




/* ==========================================================
   ===============  ACCESS CONTROL MIDDLEWARE  ===============
   ========================================================== */

async function accessControlMiddleware(req, res, next) {
  if (isPublicPath(req.path)) {
    return next();
  }

  try {
    const authHeader = req.headers.authorization || req.query.token;
    const token = authHeader?.replace("Bearer ", "");
    const prewarmKey = req.headers["x-prewarm-key"];
    const allowPrewarm =
      prewarmKey &&
      process.env.PREWARM_KEY &&
      String(prewarmKey) === String(process.env.PREWARM_KEY);

    if (isAlwaysAllowedPath(req.path)) {
      return next();
    }

    if (isPageShellPath(req.path)) {
      return next();
    }

    if (allowPrewarm) {
      return next();
    }

    if (!token) {
      console.warn("🚫 No token provided for path:", req.path);
      return res.status(401).send("Not authenticated");
    }

    const session = await getSession(token);
    if (!session) {
      console.warn("🚫 Invalid session for token");
      return res.status(401).send("Invalid session");
    }

    const activeRole = session.activeRole;
    const activeRoleName =
      typeof activeRole === "string" ? activeRole : activeRole?.name || null;

    let allowed = [];
    if (activeRoleName) {
      const roleResult = await pool.query(
        "SELECT access FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
        [activeRoleName]
      );
      const rawAccess = roleResult.rows[0]?.access;

      if (Array.isArray(rawAccess)) {
        allowed = rawAccess.map(normalizeAccessPath);
      } else if (typeof rawAccess === "string") {
        try {
          allowed = JSON.parse(rawAccess || "[]").map(normalizeAccessPath);
        } catch {
          allowed = [];
        }
      }
    }

    const accessPath = normalizeAccessPath(req.path);
    const cleanPath = req.path;

    if (
      allowed.includes(accessPath) ||
      accessPath === "" ||
      accessPath === "home" ||
      req.path.startsWith("/api/")
    ) {
      return next();
    }

    console.warn(
      `🚫 Access denied to '${cleanPath}' for role '${
        activeRole?.name || "unknown"
      }'`
    );
    return res.status(403).send("Access denied");
  } catch (err) {
    console.error("❌ Access middleware error:", err);
    return res.status(500).send("Internal access control error");
  }
}

app.use(accessControlMiddleware);

app.use((req, res, next) => {
  if (/\.html$/i.test(req.path)) {
    return publicStatic(req, res, next);
  }
  return next();
});

/* ==========================================================
   ===============  API ROUTES (Public + Protected)  =========
   ========================================================== */

app.use("/api/login", require("./routes/login"));
app.use("/api/me", require("./routes/me"));
app.use("/api/users", require("./routes/users"));
app.use("/api/meta", require("./routes/meta"));
app.use("/api/custom-fields", require("./routes/customFields"));
app.use("/api/email-alerts", require("./routes/emailAlerts"));
app.use("/api/news", require("./routes/news"));
app.use("/api/session/role", require("./routes/sessionRole"));
app.use("/api/forgot-password", require("./routes/forgotPassword"));
app.use("/api/reset-password", require("./routes/resetPassword"));
app.use("/api/fetchify", require("./routes/fetchify"));
app.use("/api/netsuite/salesorder", require("./routes/netsuiteSalesOrder"));
app.use("/api/netsuite/quote", require("./routes/netsuiteQuote"));
app.use("/api/sales-order-experience", salesOrderExperience.router);
app.use("/api/item-options", itemOptionsRoute.router);
app.use("/api/netsuite/entity", require("./routes/netsuiteEntity"));
app.use("/api/netsuite", require("./routes/netsuiteCustomerRecords"));
app.use("/api/suitepim", require("./routes/suitepim"));
app.use("/api/meta/store", require("./routes/storeName"));
app.use("/api/meta/management-rules", require("./routes/managementRules"));
app.use("/api/promotions", require("./routes/promotions"));
app.use("/api/vsa", require("./routes/vsa"));
app.use("/api/systems-processes", require("./routes/systemsProcesses"));
app.use("/api/google", require("./routes/google").router);
const intercompanyRoutes = require("./routes/intercompany");
app.use("/api/netsuite/intercompany", intercompanyRoutes);
// === Engagement (Announcements, Analytics) ===
const engagementRoutes = require("./routes/engagement");
app.use("/api/engagement", engagementRoutes);

// === Surveys (Survey creation, questions, responses) ===
const surveysRoutes = require("./routes/surveys");
app.use("/api/engagement/surveys", surveysRoutes);

app.use("/api/sales", require("./routes/salesMemos"));
const eodRoutes = require("./routes/eod");
app.use("/api/eod", eodRoutes);
const eodSubmissionsRoutes = require("./routes/eodSubmissions");
app.use("/api/eod", eodSubmissionsRoutes);

app.use("/api/logistics", require("./routes/logistics"));

const deliveryScheduleRoutes = require("./routes/deliverySchedule");
app.use("/api/delivery-schedule", deliveryScheduleRoutes);

const dispatchTrackRoutes = require("./routes/DispatchTrack");
app.use("/", dispatchTrackRoutes);






/*==============================================================
================== widget permissions ==========================
===============================================================*/

app.get("/api/dashboard-widgets", async (req, res) => {
  try {
    const result = await pool.query("SELECT widget_key, role_ids FROM widget_roles");
    const rows = result.rows;

    const data = rows.map((r) => {
      let roles = [];
      try {
        if (Array.isArray(r.role_ids)) {
          roles = r.role_ids;
        } else if (typeof r.role_ids === "object" && r.role_ids !== null) {
          roles = Object.values(r.role_ids);
        } else if (typeof r.role_ids === "string") {
          roles = JSON.parse(r.role_ids || "[]");
        }
      } catch (e) {
        console.warn(`⚠️ Failed to parse role_ids for widget ${r.widget_key}:`, r.role_ids);
        roles = [];
      }
      return { widget: r.widget_key, roles };
    });

    res.json({ ok: true, widgets: data });
  } catch (err) {
    console.error("❌ Failed to load widget visibility:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === Update widget role visibility ===
// PostgreSQL does not support REPLACE INTO, so use UPSERT (INSERT ... ON CONFLICT)
app.post("/api/dashboard-widgets", async (req, res) => {
  const { widgetKey, roles } = req.body;
  try {
    await pool.query(
      `
      INSERT INTO widget_roles (widget_key, role_ids)
      VALUES ($1, $2)
      ON CONFLICT (widget_key)
      DO UPDATE SET role_ids = EXCLUDED.role_ids;
      `,
      [widgetKey, JSON.stringify(roles)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to save widget roles:", err.message);
    res.status(500).json({ ok: false, error: "Database error" });
  }
});

// === Roles for Widget Management ===
app.get("/api/roles", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM roles ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Failed to fetch roles:", err.message);
    res.status(500).json({ ok: false, error: "Database error fetching roles" });
  }
});


/* ==========================================================
   ===============  NetSuite Proxy Routes  ==================
   ========================================================== */
// === Lead Source ===
app.get("/api/netsuite/leadsource", (req, res) =>
  fetchNetSuiteData("SALES_ORD_LEAD_SOURCE_URL", "SALES_ORDER_TKN_LEAD_SOURCE", req, res, "lead source")
);

// === Warehouse ===
app.get("/api/netsuite/warehouse", (req, res) =>
  fetchNetSuiteData("SALES_ORD_LOCATION_URL", "SALES_ORDER_TKN_LOCATION", req, res, "warehouse locations")
);

// === Payment Methods ===
function handlePaymentMethods(req, res) {
  fetchNetSuiteData("SALES_ORD_PYMT_MTHD_URL", "SALES_ORDER_TKN_PYMT_MTHD", req, res, "payment methods")
}
app.get("/api/netsuite/paymentmethods", handlePaymentMethods);
app.get("/api/netsuite/payment-methods", handlePaymentMethods);

// === Payment Info ===
app.get("/api/netsuite/paymentinfo", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_PAYMENT_INFO_URL", "SALES_ORDER_PAYMENT_INFO", req, res, "payment info")
);

// === Customer Titles ===
app.get("/api/netsuite/titles", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_CSTM_TITLE_URL", "SALES_ORDER_CSTM_TITLE", req, res, "customer titles")
);

// === Sales Order Items ===
app.get("/api/netsuite/items", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_ITEMS_URL", "SALES_ORDER_ITEMS", req, res, "sales order items")
);

// === Sales Kiosk Items ===
app.get("/api/netsuite/kiosk-items", (req, res) =>
  fetchNetSuiteData("KIOSK_ITEM_URL", "KIOSK_ITEM", req, res, "sales kiosk items")
);

// === Customer Match (with query params) ===
app.get("/api/netsuite/customermatch", async (req, res) => {
  try {
    const baseUrl = process.env.SALES_ORD_CUSTOMER_MATCH_URL;
    const token = process.env.SALES_ORDER_CUSTOMER_MATCH;
    if (!baseUrl || !token) throw new Error("Missing env vars for customer match");

    const { email = "", lastName = "", postcode = "" } = req.query;
    const nsUrl = `${baseUrl}&token=${encodeURIComponent(token)}&email=${encodeURIComponent(
      email
    )}&lastName=${encodeURIComponent(lastName)}&postcode=${encodeURIComponent(postcode)}`;

    console.log("🔎 Calling Suitelet:", nsUrl);
    const response = await fetch(nsUrl);
    const text = await response.text();
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);
    const json = JSON.parse(text);
    res.json(json);
  } catch (err) {
    console.error("❌ Customer match proxy error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === Intercompany Purchase Orders ===
app.get("/api/netsuite/intercopurchaseorders", (req, res) =>
  fetchNetSuiteData("SALES_PRDER_INTERCO_PO_URL", "SALES_ORDER_INTERCO_PO", req, res, "intercompany purchase orders")
);

// === Fulfilment Methods ===
app.get("/api/netsuite/fulfilmentmethods", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_FULFIL_METHOD_URL", "SALES_ORDER_FULFIL_METHOD", req, res, "fulfilment methods")
);

// === Inventory Balance ===
app.get("/api/netsuite/inventorybalance", async (req, res) => {
  try {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    const baseUrl = process.env.SALES_ORDER_INV_BALANCE_URL;
    const token = process.env.SALES_ORDER_INV_BALANCE;
    if (!baseUrl || !token) throw new Error("Missing env vars for inventory balance");

    const nsUrl = `${baseUrl}&token=${encodeURIComponent(token)}`;
    const response = await fetch(nsUrl);
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);
    const json = await response.json();

    const itemId = req.query.id;
    let results = (json.results || json).filter((row) => !isOutboundBinRow(row));
    if (itemId) {
      const wanted = String(itemId).trim();
      results = results.filter((r) => {
        const rowItemId = String(
          r["Item ID"] ||
            r["Item Id"] ||
            r.itemid ||
            r.itemId ||
            r.Item ||
            ""
        ).trim();
        return rowItemId === wanted;
      });
    }
    res.json({ ok: true, results });
  } catch (err) {
    console.error("❌ Inventory balance proxy error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch inventory balance" });
  }
});

// === Invoice Numbers ===
app.get("/api/netsuite/invoice-numbers", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_INV_NUMBER_URL", "SALES_ORDER_INV_NUMBER", req, res, "invoice numbers", {
    transformJson: excludeOutboundBinRows,
  })
);

// === Inventory Status ===
app.get("/api/netsuite/inventory-status", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_INV_STATUS_URL", "SALES_ORDER_INV_STATUS", req, res, "inventory status")
);

app.get("/api/netsuite/order-management", (req, res) =>
  fetchNetSuiteData("ORDER_MANAGEMENT_URL", "ORDER_MANAGEMENT", req, res, "order management", {
    noStore: true,
    forceRefresh: true,
  })
);

app.get("/api/netsuite/dt-system-notes", (req, res) =>
  fetchNetSuiteData("DT_SYSTEM_NOTES_URL", "DT_SYSTEM_NOTES", req, res, "Dispatch Track system notes", {
    noStore: true,
    forceRefresh: true,
  })
);

function rowsFromSuiteletPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function normalizeDocumentNumber(value) {
  return String(value || "").trim().toUpperCase();
}

function extractDispatchTrackDocumentNumberFromSchedule(value) {
  const raw = String(value || "");
  const match = raw.match(/service-orders\/([^"'<>\s]+)/i);
  return match ? match[1] : "";
}

function orderDispatchTrackDocumentCandidates(order = {}) {
  return [
    order["Paired Sales Order Document Number"],
    order["Paired Sales Order"],
    order["Dispatch Track Document Number"],
    order["DT Document Number"],
    order.pairedSalesOrderDocumentNumber,
    order.pairedSalesOrder,
    order.dispatchTrackDocumentNumber,
    extractDispatchTrackDocumentNumberFromSchedule(order.Schedule || order.schedule),
    order["Document Number"],
    order.documentNumber,
    order.tranid,
    order.TranID,
  ]
    .map(normalizeDocumentNumber)
    .filter(Boolean);
}

function parseDispatchTrackDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (match) {
    const [, dayText, monthText, yearText, hourText = "0", minuteText = "0", secondText = "0", meridiem] = match;
    let hour = Number(hourText);
    if (/pm/i.test(meridiem || "") && hour < 12) hour += 12;
    if (/am/i.test(meridiem || "") && hour === 12) hour = 0;

    const date = new Date(
      Number(yearText),
      Number(monthText) - 1,
      Number(dayText),
      hour,
      Number(minuteText),
      Number(secondText)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetweenDates(fromDate, toDate = new Date()) {
  const from = startOfLocalDay(fromDate);
  const to = startOfLocalDay(toDate);
  return Math.floor((to - from) / 86400000);
}

function dispatchTrackAgeBucket(daysInDispatchTrack) {
  if (daysInDispatchTrack >= 100) return "100+";
  if (daysInDispatchTrack >= 90) return "90";
  if (daysInDispatchTrack >= 60) return "60";
  return null;
}

async function loadSuiteletData(envUrlKey, envTokenKey, req, label) {
  const baseUrl = process.env[envUrlKey];
  const token = process.env[envTokenKey];
  if (!baseUrl || !token) {
    throw new Error(`Missing ${envUrlKey} or ${envTokenKey} in environment`);
  }

  const nsUrl = new URL(String(baseUrl).trim().replace(/^["']|["']$/g, ""));
  nsUrl.searchParams.set("token", token);
  nsUrl.searchParams.set("_", String(Date.now()));

  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (["token", "refresh", "force", "fresh", "_"].includes(String(key).toLowerCase())) return;
    if (value === undefined || value === null || value === "") return;
    nsUrl.searchParams.set(key, String(value));
  });

  console.log(`Fetching ${label} from NetSuite`);
  const response = await fetch(nsUrl.toString());
  if (!response.ok) throw new Error(`${label} response ${response.status}`);
  return response.json();
}

app.get("/api/sales-tools/dispatch-track-ageing", async (req, res) => {
  try {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    const [orderPayload, notePayload] = await Promise.all([
      loadSuiteletData("ORDER_MANAGEMENT_URL", "ORDER_MANAGEMENT", req, "order management"),
      loadSuiteletData("DT_SYSTEM_NOTES_URL", "DT_SYSTEM_NOTES", req, "Dispatch Track system notes"),
    ]);

    const orders = rowsFromSuiteletPayload(orderPayload);
    const notes = rowsFromSuiteletPayload(notePayload);
    const firstNoteByDocument = new Map();

    notes.forEach((note) => {
      const documentNumber = normalizeDocumentNumber(
        note["Document Number"] || note.documentNumber || note.tranid || note.TranID
      );
      const exportedAt = parseDispatchTrackDate(note.Date || note.date);
      if (!documentNumber || !exportedAt) return;

      const existing = firstNoteByDocument.get(documentNumber);
      if (!existing || exportedAt < existing.exportedAt) {
        firstNoteByDocument.set(documentNumber, {
          note,
          exportedAt,
        });
      }
    });

    const today = new Date();
    const readyOrders = orders.filter((order) =>
        String(order["Ready For Delivery"] || order.readyForDelivery || "")
          .trim()
          .toLowerCase() === "ready for fulfilment"
      );
    const matchedReadyOrders = readyOrders
      .map((order) => {
        const candidates = orderDispatchTrackDocumentCandidates(order);
        const dispatchTrackDocumentNumber = candidates.find((candidate) =>
          firstNoteByDocument.has(candidate)
        );
        const match = firstNoteByDocument.get(dispatchTrackDocumentNumber);
        if (!match) return null;

        const daysInDispatchTrack = daysBetweenDates(match.exportedAt, today);
        const ageBucket = dispatchTrackAgeBucket(daysInDispatchTrack);

        return {
          ...order,
          dispatchTrackDocumentNumber: match.note["Document Number"] || dispatchTrackDocumentNumber,
          dispatchTrackRecordId: match.note["Record ID"] || match.note.recordId || match.note.id || "",
          dispatchTrackExportedAt: match.note.Date || match.note.date || "",
          dispatchTrackExportedAtIso: match.exportedAt.toISOString(),
          daysInDispatchTrack,
          ageBucket,
        };
      })
      .filter(Boolean);
    const results = matchedReadyOrders
      .filter((row) => row.ageBucket)
      .sort((a, b) => b.daysInDispatchTrack - a.daysInDispatchTrack);

    res.json({
      ok: true,
      generatedAt: today.toISOString(),
      counts: {
        orders: orders.length,
        readyOrders: readyOrders.length,
        dispatchTrackNotes: notes.length,
        matchedReadyOrders: matchedReadyOrders.length,
        matchedAgedOrders: results.length,
        bucket60: results.filter((row) => row.ageBucket === "60").length,
        bucket90: results.filter((row) => row.ageBucket === "90").length,
        bucket100: results.filter((row) => row.ageBucket === "100+").length,
      },
      results,
    });
  } catch (err) {
    console.error("Sales tools Dispatch Track ageing error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to build Dispatch Track ageing data",
    });
  }
});

app.get("/api/netsuite/breathe-rota", async (req, res) => {
  try {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    const baseUrl = getEnvAny("BREATHE_ROTA_URL", "breathe_rota_url");
    const token = getEnvAny("BREATHE_ROTA", "breathe_rota");
    if (!baseUrl || !token) {
      throw new Error("Missing BREATHE_ROTA_URL/breathe_rota_url or BREATHE_ROTA/breathe_rota in environment");
    }

    const nsUrl = new URL(baseUrl);
    nsUrl.searchParams.set("token", token);
    nsUrl.searchParams.set("_", String(Date.now()));
    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (["token", "refresh", "force", "fresh"].includes(String(key).toLowerCase())) return;
      if (value === undefined || value === null || value === "") return;
      nsUrl.searchParams.set(key, String(value));
    });

    console.log("Fetching Breathe rota from NetSuite");
    const response = await fetch(nsUrl.toString());
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);

    const json = await response.json();
    res.json({
      ok: json?.ok !== false,
      ...json,
      results: Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [],
    });
  } catch (err) {
    console.error("NetSuite Breathe rota proxy error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch Breathe rota data" });
  }
});




// === Quote Management ===
app.get("/api/netsuite/quote-management", (req, res) =>
  fetchNetSuiteData("QUOTE_MANAGEMENT_URL", "QUOTE_MANAGEMENT", req, res, "quote management", {
    noStore: true,
    forceRefresh: true,
  })
);

// === Case Management ===
app.get("/api/netsuite/case-management", (req, res) =>
  fetchNetSuiteData("CASE_MANAGEMENT_URL", "CASE_MANAGEMENT", req, res, "case management", {
    noStore: true,
    forceRefresh: true,
  })
);

// === Transfer Order Management ===
app.get("/api/netsuite/transfer-order-management", (req, res) =>
  fetchNetSuiteData("TRANSFER_ORDER_MANAGEMENT_URL", "TRANSFER_ORDER_MANAGEMENT", req, res, "transfer order management", {
    noStore: true,
    forceRefresh: true,
  })
);

// === Transfer Order Widget ===
app.get("/api/netsuite/transfer-order-widget", async (req, res) => {
  try {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    const baseUrl = getEnvAny("TRANSFER_ORDER_WIDGET_URL", "transfer_order_widget_url");
    const token = getEnvAny("TRANSFER_ORDER_WIDGET", "transfer_order_widget");
    if (!baseUrl) {
      throw new Error("Missing TRANSFER_ORDER_WIDGET_URL/transfer_order_widget_url in environment");
    }

    const nsUrl = new URL(baseUrl);
    if (token && !nsUrl.searchParams.has("token")) {
      nsUrl.searchParams.set("token", token);
    }
    nsUrl.searchParams.set("_", String(Date.now()));

    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (["token", "refresh", "force", "fresh"].includes(String(key).toLowerCase())) return;
      if (value === undefined || value === null || value === "") return;
      nsUrl.searchParams.set(key, String(value));
    });

    console.log("Fetching transfer order widget data from NetSuite");
    const response = await fetch(nsUrl.toString());
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);

    const json = await response.json();
    res.json({
      ok: json?.ok !== false,
      ...json,
      results: Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [],
    });
  } catch (err) {
    console.error("NetSuite transfer order widget proxy error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch transfer order widget data" });
  }
});

// === Customer Confirmation / Feedback Widget ===
app.get("/api/netsuite/customer-confirmation", async (req, res) => {
  try {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    const baseUrl = getEnvAny("CUST_CONFIRMATION_URL", "cust_confirmation_url");
    const token = getEnvAny("CUST_CONFIRMATION", "cust_confirmation");
    if (!baseUrl) {
      throw new Error("Missing CUST_CONFIRMATION_URL/cust_confirmation_url in environment");
    }

    const nsUrl = new URL(baseUrl);
    if (token && !nsUrl.searchParams.has("token")) {
      nsUrl.searchParams.set("token", token);
    }
    nsUrl.searchParams.set("_", String(Date.now()));

    Object.entries(req.query || {}).forEach(([key, value]) => {
      if (["token", "refresh", "force", "fresh"].includes(String(key).toLowerCase())) return;
      if (value === undefined || value === null || value === "") return;
      nsUrl.searchParams.set(key, String(value));
    });

    console.log("Fetching customer confirmation feedback from NetSuite");
    const response = await fetch(nsUrl.toString());
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);

    const json = await response.json();
    res.json({
      ok: json?.ok !== false,
      ...json,
      results: Array.isArray(json?.results) ? json.results : Array.isArray(json) ? json : [],
    });
  } catch (err) {
    console.error("NetSuite customer confirmation proxy error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch customer confirmation data" });
  }
});

// === Customer Lookup Report ===
app.get("/api/netsuite/customer-lookup", (req, res) =>
  fetchNetSuiteData("CUSTOMER_LOOKUP_URL", "CUSTOMER_LOOKUP", req, res, "customer lookup report")
);



// === GL Accounts ===
app.get("/api/netsuite/glaccounts", (req, res) =>
  fetchNetSuiteData("GL_ACCOUNTS_URL", "GL_ACCOUNTS", req, res, "GL accounts")
);

// === Customer Deposits ===
app.get("/api/netsuite/customer-deposits", (req, res) =>
  fetchNetSuiteData("CUSTOMER_DEPOSITS_URL", "CUSTOMER_DEPOSITS", req, res, "customer deposits", {
    noStore: true,
    forceRefresh: true,
  })
);

// === VSA Item Data ===
app.get("/api/netsuite/vsa-item-data", (req, res) =>
  fetchNetSuiteData("VSA_ITEM_DATA_URL", "VSA_ITEM_DATA", req, res, "VSA item data")
);

// === Widget Sales ===
app.get("/api/netsuite/widget-sales", (req, res) =>
  fetchNetSuiteData("WIDGET_SALES_URL", "WIDGET_SALES", req, res, "Widget Sales data", {
    noStore: true,
    forceRefresh: true,
  })
);

// == sales order item size ==
app.get("/api/netsuite/sales-order-item-size", (req, res) =>
fetchNetSuiteData("SALES_ORDER_ITEM_SIZE_URL", "SALES_ORDER_ITEM_SIZE", req, res, "sales Order item size")
);

// == Sales Order Base Option ==
app.get("/api/netsuite/sales-order-item-base-option", (req, res) =>
fetchNetSuiteData("SALES_ORDER_ITEM_BASE_OPTIONS_URL", "SALES_ORDER_ITEM_BASE_OPTION", req, res, "sales order item base option")
);

// == Stock Replenishment ==
app.get("/api/netsuite/stock-replenishment", (req, res) =>
fetchNetSuiteData("STOCK_REPLENISHMENT_URL", "STOCK_REPLENISHMENT", req, res, "stock replenishment"));

// == Quantity Backordered
app.get("/api/netsuite/quantity-backordered", (req, res) =>
fetchNetSuiteData("QUANTITY_BACKORDERED_URL", "QUANTITY_BACKORDERED", req, res, "quantity backordered"));

// == Committed Lines
app.get("/api/netsuite/committed-lines", (req, res) =>
fetchNetSuiteData("COMMITTED_LINES_URL", "COMMITTED_LINES", req, res, "committed lines", {
  noStore: true,
  forceRefresh: true,
}));


// === Purchase Order Management ===
app.get("/api/netsuite/purchase-order-management", async (req, res) => {
  try {
    const baseUrl = process.env.PURCH_ORD_MANAGEMENT_URL;
    const token = process.env.PURCH_ORD_MANAGEMENT;

    const url = `${baseUrl}&token=${encodeURIComponent(token)}`;
    const response = await fetch(url);

    if (!response.ok) throw new Error(`NetSuite returned ${response.status}`);

    const json = await response.json();
    res.json({ ok: true, results: json.results || json.data || [] });
  } catch (err) {
    console.error("❌ PO Management fetch error:", err);
    res.status(500).json({ ok: false, error: "Failed to load PO management" });
  }
});

// === Supplier Lead Time ===
app.get("/api/netsuite/supplier-lead-time", async (req, res) => {
  try {
    const baseUrl = process.env.SUPPLIER_LEAD_TIME_URL;
    const token = process.env.SUPPLIER_LEAD_TIME;

    const url = `${baseUrl}&token=${encodeURIComponent(token)}`;
    const response = await fetch(url);

    if (!response.ok) throw new Error(`NetSuite returned ${response.status}`);

    const json = await response.json();
    res.json({ ok: true, results: json.results || json.data || [] });
  } catch (err) {
    console.error("❌ Supplier Lead Time fetch error:", err);
    res.status(500).json({ ok: false, error: "Failed to load supplier lead times" });
  }
});

app.get("/api/config/intercompany-url", (req, res) => {
  const url = String(process.env.INTERCOMPANY_URL || "").trim().replace(/^["']|["']$/g, "");
  res.json({
    ok: true,
    url
  });
});

app.get("/netsuite/home", (req, res) => {
  res.redirect(getNetSuiteHomeUrl());
});



/****************************************************
 * virtual sales assistant routes
 *****************************************************/
// === VSA Item Data ===
app.get("/api/netsuite/vsa-item-data", async (req, res) => {
  try {
    const baseUrl = process.env.VSA_ITEM_DATA_URL;
    const token = process.env.VSA_ITEM_DATA;

    if (!baseUrl || !token) {
      throw new Error("Missing VSA_ITEM_DATA_URL or VSA_ITEM_DATA in .env");
    }

    const nsUrl = `${baseUrl}&token=${encodeURIComponent(token)}`;
    console.log(`📡 Fetching VSA item data from: ${nsUrl}`);

    const response = await fetch(nsUrl);
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);

    const json = await response.json();
    res.json(json);
  } catch (err) {
    console.error("❌ NetSuite VSA item data proxy error:", err);
    res
      .status(500)
      .json({ ok: false, error: "Failed to fetch VSA item data" });
  }
});





const { nsGet } = require("./netsuiteClient");

function normalizeField(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map(v => v.text || v.value || String(v));
  }
  if (typeof val === "object") {
    return [val.text || val.value || JSON.stringify(val)];
  }
  return String(val).split(",").map(v => v.trim());
}



async function expandField(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(v => v.text || v.refName || v.value || v.id || String(v));
  if (val.links) {
    const link = val.links.find(l => l.rel === "self")?.href;
    if (link) {
      const endpoint = link.split("/record/v1")[1];
      const sub = await nsGet(endpoint);

      if (sub.items) {
        return sub.items.map(v =>
          v.refName || v.text || v.value || v.id
        );
      }
    }
  }
  return [];
}



app.get("/api/netsuite/itemOptions", async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ ok: false, error: "Missing item id" });

  try {
    const item = await nsGet(`/inventoryItem/${id}`);

    const options = {
      tension: await expandField(item.custitem_sb_tension)
    };

    res.json({ ok: true, itemId: id, options });
  } catch (err) {
    console.error("❌ Item options fetch failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ==========================================================
   ====================  HEALTH CHECK  =======================
   ========================================================== */

app.get("/health", (req, res) => res.json({ ok: true }));

/* ==========================================================
   ====================  HTML ROUTES  ========================
   ========================================================== */

app.get("/", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "index.html")));
app.get("/home", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "home.html")));
app.get("/news", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "news.html")));
app.get("/admin", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "admin.html")));
app.get("/forgot", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "forgot.html")));
app.get("/orders", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "orderManagement.html")));
app.get("/sales-tools", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "salesTools.html")));
app.get("/reset", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "reset.html")));
app.get("/sales/new", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "newSalesOrder.html")));
app.get("/sales/kiosk", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "salesKiosk.html")));
app.get("/quote/new", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "quoteNew.html")));
app.get("/product-hub", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "product-hub.html")))
app.get("/reports", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "reports.html")))
app.get("/promotions", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "promotions.html")))
app.get("/eod", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "endOfDay.html")))
app.get("/cashflow", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "cashFlow.html")))
app.get("/logistics", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "logistics.html")))
app.get("/suitepim", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "suitepim.html")))
app.get("/systems-processes", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "systems-processes.html")))
app.get("/rota", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "rota.html")))
app.get("/suitepim/product-data", (req, res) => res.redirect(302, "/suitepim/web-management"))
app.get("/suitepim/web-management", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "suitepim-web-management.html")))
app.get("/suitepim/product-validation", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "suitepim-product-validation.html")))
app.get("/suitepim/campaigns", (req, res) => sendNoCacheFile(res, path.join(__dirname, "public", "suitepim-campaigns.html")))
app.get(["/suitepim/reasons-to-buy", "/suitepim/reasons-to-buy.html"], (req, res) =>
  sendNoCacheFile(res, path.join(__dirname, "public", "suitepim-reasons-to-buy.html"))
)
app.get("/sales/reciept/:id", (req, res) => sendNoCacheFile(res, path.join(__dirname,"public", "salesOrdReceipt.html")));

app.get("/quote/view/:id", (req, res) =>
  sendNoCacheFile(res, path.join(__dirname, "public", "quoteView.html"))
);
app.get(["/quote/reciept/:id", "/quote/receipt/:id"], (req, res) => {
  sendNoCacheFile(res, path.join(__dirname, "public", "quoteReciept.html"));
});
app.get("/sales/view/:id", (req, res) => {
  sendNoCacheFile(res, path.join(__dirname, "public", "salesOrderView.html"));
});
app.get("/engagement", (req, res) =>
  sendNoCacheFile(res, path.join(__dirname, "public", "engagement.html"))
);
app.get("/error", (req, res) =>
  sendNoCacheFile(res, path.join(__dirname, "public", "error.html"))
);





/* ==========================================================
   =====================  START SERVER  ======================
   ========================================================== */
app.use((req, res, next) => {
  console.warn("⚠️  Unhandled path reached end of middleware stack:", req.path);
  next();
});

app.use((err, req, res, next) => {
  console.error("Unhandled request error:", {
    path: req.path,
    method: req.method,
    message: err.message,
  });

  if (res.headersSent) return next(err);

  if (isApiRequest(req)) {
    return res.status(err.status || 500).json({
      ok: false,
      error: "Unexpected server error. Please try again or contact support.",
      code: "SERVER_ERROR",
    });
  }

  return res.status(err.status || 500).redirect("/error");
});

app.use((req, res) => {
  console.warn("Unhandled path reached end of middleware stack:", req.path);

  if (isApiRequest(req)) {
    return res.status(404).json({
      ok: false,
      error: "Not found",
      code: "NOT_FOUND",
    });
  }

  return res.status(404).redirect("/error");
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  itemOptionsRoute.startScheduler();
  ensureUserStatusColumn().catch((err) => {
    console.error("Failed to initialize user status columns:", err.message);
  });

});
