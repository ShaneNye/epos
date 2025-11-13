// server.js
console.log("🟦 Loaded salesMemos.js FROM:", __filename);

console.log("🟢 Server starting from directory:", __dirname);

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");
const { getSession } = require("./sessions");
const pool = require("./db"); // for user token lookup if stored in DB

const app = express();
const PORT = process.env.PORT || 3000;

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

// --- Serve static files ---
app.use(express.static(path.join(__dirname, "public")));


/**
 * Utility to call NetSuite external Suitelet JSON endpoints.
 * It pulls the base URL + token from env vars dynamically.
 */
async function fetchNetSuiteData(envUrlKey, envTokenKey, res, label) {
  try {
    const baseUrl = process.env[envUrlKey];
    const token = process.env[envTokenKey];

    if (!baseUrl || !token) {
      throw new Error(`Missing ${envUrlKey} or ${envTokenKey} in environment`);
    }

    // Ensure URL ends with the expected query
    const nsUrl = `${baseUrl}&token=${encodeURIComponent(token)}`;
    console.log(`📡 [NetSuite] ${label}: ${nsUrl}`);

    const response = await fetch(nsUrl);
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);

    const json = await response.json();
    return res.json(json);
  } catch (err) {
    console.error(`❌ NetSuite ${label} proxy error:`, err);
    res.status(500).json({ ok: false, error: `Failed to fetch ${label} data` });
  }
}


/* ==========================================================
   ===============  API ROUTES (Public + Protected)  =========
   ========================================================== */

app.use("/api/login", require("./routes/login"));
app.use("/api/me", require("./routes/me"));
app.use("/api/users", require("./routes/users"));
app.use("/api/meta", require("./routes/meta"));
app.use("/api/session/role", require("./routes/sessionRole"));
app.use("/api/forgot-password", require("./routes/forgotPassword"));
app.use("/api/reset-password", require("./routes/resetPassword"));
app.use("/api/fetchify", require("./routes/fetchify"));
app.use("/api/netsuite/salesorder", require("./routes/netsuiteSalesOrder"));
app.use("/api/netsuite/quote", require("./routes/netsuiteQuote"));
app.use("/api/netsuite/entity", require("./routes/netsuiteEntity"));
app.use("/api/netsuite", require("./routes/netsuiteCustomerRecords"));
app.use("/api/meta/store", require("./routes/storeName"));
app.use("/api/meta/management-rules", require("./routes/managementRules"));
app.use("/api/vsa", require("./routes/vsa"));
const intercompanyRoutes = require("./routes/intercompany");
app.use("/api/netsuite/intercompany", intercompanyRoutes);
// === Engagement (Announcements, Analytics) ===
const engagementRoutes = require("./routes/engagement");
app.use("/api/engagement", engagementRoutes);

// === Surveys (Survey creation, questions, responses) ===
const surveysRoutes = require("./routes/surveys");
app.use("/api/engagement/surveys", surveysRoutes);

app.use("/api/sales", require("./routes/salesMemos"));





/* ==========================================================
   ===============  ACCESS CONTROL MIDDLEWARE  ===============
   ========================================================== */

app.use(async (req, res, next) => {
  const publicPaths = [
    "/",
    "/index.html",
    "/api/login",
    "/api/me",
    "/api/session/role",
    "/api/vsa",   
    "/api/meta",
    "/health",
  ];

  // detect static files (css, js, images, icons)
  const staticFiles = req.path.match(/\.(css|js|png|jpg|jpeg|svg|ico|gif|html)$/i);

  // ✅ Allow public + static + assistant assets (html, js, css)
  if (
    publicPaths.some((p) => req.path.startsWith(p)) ||
    staticFiles ||
    req.path.startsWith("/assistant")
  ) {
    return next();
  }

  try {
    const authHeader = req.headers.authorization || req.query.token;
    const token = authHeader?.replace("Bearer ", "");

    // ==========================================================
    // ✅ Always-allowed routes (Sales, Quotes, and NS APIs)
    // ==========================================================
    const alwaysAllowed = [
      "/sales/view",
      "/sales/new",
      "/quote/view",
      "/quote/new",
      "/api/netsuite/salesorder",
      "/api/netsuite/quote",
      "/api/netsuite/order-management",
      "/api/netsuite/quote-management",
    ];

    if (alwaysAllowed.some((prefix) => req.path.startsWith(prefix))) {
      return next();
    }

    // ==========================================================
    // 🔒 Standard token/session validation
    // ==========================================================
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
    const allowed = Array.isArray(activeRole?.access)
      ? activeRole.access
      : [];
    const cleanPath = req.path.replace(/^\/+/, "");

    // ✅ Role-based access
    if (
      allowed.includes(cleanPath) ||
      cleanPath === "" ||
      cleanPath === "home"
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
});


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
  fetchNetSuiteData("SALES_ORD_LEAD_SOURCE_URL", "SALES_ORDER_TKN_LEAD_SOURCE", res, "lead source")
);

// === Warehouse ===
app.get("/api/netsuite/warehouse", (req, res) =>
  fetchNetSuiteData("SALES_ORD_LOCATION_URL", "SALES_ORDER_TKN_LOCATION", res, "warehouse locations")
);

// === Payment Methods ===
app.get("/api/netsuite/paymentmethods", (req, res) =>
  fetchNetSuiteData("SALES_ORD_PYMT_MTHD_URL", "SALES_ORDER_TKN_PYMT_MTHD", res, "payment methods")
);

// === Payment Info ===
app.get("/api/netsuite/paymentinfo", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_PAYMENT_INFO_URL", "SALES_ORDER_PAYMENT_INFO", res, "payment info")
);

// === Customer Titles ===
app.get("/api/netsuite/titles", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_CSTM_TITLE_URL", "SALES_ORDER_CSTM_TITLE", res, "customer titles")
);

// === Sales Order Items ===
app.get("/api/netsuite/items", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_ITEMS_URL", "SALES_ORDER_ITEMS", res, "sales order items")
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
  fetchNetSuiteData("SALES_PRDER_INTERCO_PO_URL", "SALES_ORDER_INTERCO_PO", res, "intercompany purchase orders")
);

// === Fulfilment Methods ===
app.get("/api/netsuite/fulfilmentmethods", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_FULFIL_METHOD_URL", "SALES_ORDER_FULFIL_METHOD", res, "fulfilment methods")
);

// === Inventory Balance ===
app.get("/api/netsuite/inventorybalance", async (req, res) => {
  try {
    const baseUrl = process.env.SALES_ORDER_INV_BALANCE_URL;
    const token = process.env.SALES_ORDER_INV_BALANCE;
    if (!baseUrl || !token) throw new Error("Missing env vars for inventory balance");

    const nsUrl = `${baseUrl}&token=${encodeURIComponent(token)}`;
    const response = await fetch(nsUrl);
    if (!response.ok) throw new Error(`NetSuite response ${response.status}`);
    const json = await response.json();

    const itemId = req.query.id;
    let results = json.results || json;
    if (itemId) results = results.filter(r => String(r["Item ID"]) === String(itemId));
    res.json({ ok: true, results });
  } catch (err) {
    console.error("❌ Inventory balance proxy error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch inventory balance" });
  }
});

// === Invoice Numbers ===
app.get("/api/netsuite/invoice-numbers", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_INV_NUMBER_URL", "SALES_ORDER_INV_NUMBER", res, "invoice numbers")
);

// === Inventory Status ===
app.get("/api/netsuite/inventory-status", (req, res) =>
  fetchNetSuiteData("SALES_ORDER_INV_STATUS_URL", "SALES_ORDER_INV_STATUS", res, "inventory status")
);

// === Order Management ===
app.get("/api/netsuite/order-management", (req, res) =>
  fetchNetSuiteData("ORDER_MANAGEMENT_URL", "ORDER_MANAGEMENT", res, "order management")
);

// === Quote Management ===
app.get("/api/netsuite/quote-management", (req, res) =>
  fetchNetSuiteData("QUOTE_MANAGEMENT_URL", "QUOTE_MANAGEMENT", res, "quote management")
);

// === Case Management ===
app.get("/api/netsuite/case-management", (req, res) =>
  fetchNetSuiteData("CASE_MANAGEMENT_URL", "CASE_MANAGEMENT", res, "case management")
);

// === Transfer Order Management ===
app.get("/api/netsuite/transfer-order-management", (req, res) =>
  fetchNetSuiteData("TRANSFER_ORDER_MANAGEMENT_URL", "TRANSFER_ORDER_MANAGEMENT", res, "transfer order management")
);

// === Customer Lookup Report ===
app.get("/api/netsuite/customer-lookup", (req, res) =>
  fetchNetSuiteData("CUSTOMER_LOOKUP_URL", "CUSTOMER_LOOKUP", res, "customer lookup report")
);



// === GL Accounts ===
app.get("/api/netsuite/glaccounts", (req, res) =>
  fetchNetSuiteData("GL_ACCOUNTS_URL", "GL_ACCOUNTS", res, "GL accounts")
);

// === Customer Deposits ===
app.get("/api/netsuite/customer-deposits", (req, res) =>
  fetchNetSuiteData("CUSTOMER_DEPOSITS_URL", "CUSTOMER_DEPOSITS", res, "customer deposits")
);

// === VSA Item Data ===
app.get("/api/netsuite/vsa-item-data", (req, res) =>
  fetchNetSuiteData("VSA_ITEM_DATA_URL", "VSA_ITEM_DATA", res, "VSA item data")
);

// === Widget Sales ===
app.get("/api/netsuite/widget-sales", (req, res) =>
  fetchNetSuiteData("WIDGET_SALES_URL", "WIDGET_SALES", res, "Widget Sales data")
);


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

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/home", (req, res) => res.sendFile(path.join(__dirname, "public", "home.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/forgot", (req, res) => res.sendFile(path.join(__dirname, "public", "forgot.html")));
app.get("/orders", (req, res) => res.sendFile(path.join(__dirname, "public", "orderManagement.html")));
app.get("/reset", (req, res) => res.sendFile(path.join(__dirname, "public", "reset.html")));
app.get("/sales/new", (req, res) => res.sendFile(path.join(__dirname, "public", "newSalesOrder.html")));
app.get("/quote/new", (req, res) => res.sendFile(path.join(__dirname, "public", "quoteNew.html")));
app.get("/reports", (req, res) => res.sendFile(path.join(__dirname, "public", "reports.html")))
app.get("/quote/view/:id", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "quoteView.html"))
);
app.get("/sales/view/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "salesOrderView.html"));
});
app.get("/engagement", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "engagement.html"))
);





/* ==========================================================
   =====================  START SERVER  ======================
   ========================================================== */
app.use((req, res, next) => {
  console.warn("⚠️  Unhandled path reached end of middleware stack:", req.path);
  next();
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
