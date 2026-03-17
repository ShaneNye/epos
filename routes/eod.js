// routes/eod.js
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const { getSession } = require("../sessions");
const nsClient = require("../netsuiteClient");
const pool = require("../db");
const db = require("../db");

const router = express.Router();

/* ============================================================
   GET FOOTFALL DATA — via NetSuite Scriptlet
   ============================================================ */
router.get("/footfall", async (req, res) => {
  try {
    const baseUrl = process.env.EOD_FOOTFALL_URL;
    const token = process.env.EOD_FOOTFALL;

    if (!baseUrl || !token) {
      return res.status(500).json({
        ok: false,
        error: "Missing EOD_FOOTFALL_URL or EOD_FOOTFALL in .env",
      });
    }

    const url = `${baseUrl}&token=${encodeURIComponent(token)}`;
    console.log("📡 Fetching footfall from NetSuite:", url);

    const nsRes = await fetch(url);
    const text = await nsRes.text();

    if (!nsRes.ok) {
      console.error("❌ NetSuite footfall scriptlet error:", text);
      return res.status(500).json({
        ok: false,
        error: "NetSuite footfall scriptlet returned an error.",
        raw: text,
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.error("❌ Failed to parse NetSuite JSON:", err.message);
      return res.status(500).json({
        ok: false,
        error: "NetSuite scriptlet returned invalid JSON.",
        raw: text,
      });
    }

    return res.json(json);

  } catch (err) {
    console.error("❌ /api/eod/footfall error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});



/* ============================================================
   PATCH FOOTFALL RECORD — Update customrecord_sb_footfall
   ============================================================ */
router.patch("/footfall/update", async (req, res) => {
  try {
    const { internalId, values } = req.body;

    if (!internalId) {
      return res.status(400).json({
        ok: false,
        error: "Missing internalId",
      });
    }

    if (!values || typeof values !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Missing values object",
      });
    }

    console.log("📝 Incoming Footfall PATCH →", { internalId, values });

    /* ------------------------------------------------------------
       Resolve EPOS session → retrieve DB-stored NetSuite tokens
       ------------------------------------------------------------ */
    const auth = req.headers.authorization || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!bearer) {
      return res.status(401).json({ ok: false, error: "No Bearer token" });
    }

    let userId = null;
    try {
      const session = await getSession(bearer);
      console.log("🧠 Footfall Session:", session);

      userId = session?.id || null;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "Invalid session" });
      }
    } catch (err) {
      console.error("❌ Failed to load session:", err.message);
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    console.log("🔐 Using NetSuite token of user:", userId);

    /* ------------------------------------------------------------
       Transform VALUES into NetSuite REST structure
       (Frontend already provides correct field map and NS IDs)
       ------------------------------------------------------------ */

    const body = {};

    for (const [label, rawVal] of Object.entries(values)) {
      if (rawVal === "" || rawVal === null) continue;

      const nsFieldId = label; // 🚨 IMPORTANT:
                               // We do NOT map here — the frontend uses FIELD_MAP
                               // and directly sends NetSuite field IDs.
                               // Example coming from frontend:
                               // { "custrecord_sb_bed_specialist_1": "39391" }

      // If value is numeric, send number; otherwise string
      const val =
        typeof rawVal === "string" && rawVal.match(/^\d+(\.\d+)?$/)
          ? Number(rawVal)
          : rawVal;

      // If field is a person (netsuite id), wrap correctly
      if (String(nsFieldId).includes("bed_specialist")) {
        body[nsFieldId] = { id: String(val) }; // ⭐ correct structure
      } else if (String(nsFieldId).includes("team_leader")) {
        body[nsFieldId] = { id: String(val) };
      } else if (typeof val === "number") {
        body[nsFieldId] = val;
      } else {
        body[nsFieldId] = val;
      }
    }

    console.log("📦 Final PATCH body to NetSuite:", body);

    /* ------------------------------------------------------------
       SEND PATCH → NetSuite (per-user TBA)
       ------------------------------------------------------------ */
    const endpoint = `/customrecord_sb_footfall/${internalId}`;

    console.log(`🔧 [PATCH] NetSuite ${endpoint}`);

    const result = await nsClient.nsPatch(endpoint, body, userId, "sb");

    console.log("✅ NetSuite Footfall PATCH result:", result);

    return res.json({ ok: true, result });

  } catch (err) {
    console.error("❌ Footfall PATCH error:", err.responseBody || err.message);

    return res.status(500).json({
      ok: false,
      error: err.responseBody || err.message,
    });
  }
});

/* ============================================================
   GET DAILY BALANCING – CUSTOMER DEPOSITS
   Via NetSuite Scriptlet from EOD_CUST_DEP_URL
   ============================================================ */
router.get("/daily-balance", async (req, res) => {
  try {
    const baseUrl = process.env.EOD_CUST_DEP_URL;
    const token = process.env.EOD_CUST_DEP;

    if (!baseUrl || !token) {
      return res.status(500).json({
        ok: false,
        error: "Missing EOD_CUST_DEP_URL or EOD_CUST_DEP in .env",
      });
    }

    const url = `${baseUrl}&token=${encodeURIComponent(token)}`;
    console.log("📡 Fetching Daily Balance (Customer Deposits) from NetSuite:", url);

    const nsRes = await fetch(url);
    const text = await nsRes.text();

    if (!nsRes.ok) {
      console.error("❌ NetSuite daily balance scriptlet error:", text);
      return res.status(500).json({
        ok: false,
        error: "NetSuite daily balance scriptlet returned an error.",
        raw: text,
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.error("❌ Invalid JSON from NetSuite daily balance:", err.message);
      return res.status(500).json({
        ok: false,
        error: "NetSuite scriptlet returned invalid JSON.",
        raw: text,
      });
    }

    /* ---------------------------------------------
       Normalise shape — supports:
       { results: [...] }
       { data: [...] }
       [ array ]
       --------------------------------------------- */
    let results = [];

    if (Array.isArray(json)) {
      results = json;
    } else if (Array.isArray(json.results)) {
      results = json.results;
    } else if (Array.isArray(json.data)) {
      results = json.data;
    }

    return res.json({
      ok: true,
      recordType: json.recordType || "customerdeposit",
      searchId: json.searchId || "",
      count: results.length,
      results,
    });

  } catch (err) {
    console.error("❌ /api/eod/daily-balance error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});


/* ============================================================
   POST /api/eod/submit  — Save End Of Day
============================================================ */
router.post("/submit", async (req, res) => {
    try {
        const auth = req.headers.authorization || "";
        const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;

        if (!bearer) {
            return res.status(401).json({ ok: false, error: "Missing bearer token" });
        }

        const session = await getSession(bearer);
        if (!session?.id) {
            return res.status(401).json({ ok: false, error: "Invalid session" });
        }

        const {
            store,
            locationId,
            date,
            signoffUserId,
            confirmation,
            deposits,
            cashflow,
            adjustments,
            totals
        } = req.body;

        if (!store || !locationId || !date) {
            return res.status(400).json({ ok: false, error: "Missing required fields" });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            /* ------------------------------------------
               INSERT INTO end_of_day
            ------------------------------------------ */
            const insertEod = `
                INSERT INTO end_of_day
                (store_name, location_id, date, signoff_user_id, confirmation,
                 deposits, cashflow, adjustments, total_safe, total_float)
                VALUES
                ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                RETURNING id;
            `;

            const eodResult = await client.query(insertEod, [
                store,
                locationId,
                date,
                signoffUserId,
                confirmation,
                JSON.stringify(deposits),
                JSON.stringify(cashflow),
                JSON.stringify(adjustments),
                totals.safe,
                totals.float
            ]);

            const eodId = eodResult.rows[0].id;


            /* ------------------------------------------
               UPDATE store safe/float balances
            ------------------------------------------ */
            const updateBalance = `
                UPDATE locations
                SET 
                    safe_balance = safe_balance + $1,
                    float_balance = float_balance + $2
                WHERE id = $3;
            `;

            await client.query(updateBalance, [
                totals.safe,
                totals.float,
                locationId
            ]);

            await client.query("COMMIT");

            return res.json({
                ok: true,
                eodId,
                message: "End of Day submitted successfully"
            });

        } catch (err) {
            await client.query("ROLLBACK");
            console.error("❌ DB error:", err);
            return res.status(500).json({ ok: false, error: err.message });
        } finally {
            client.release();
        }

    } catch (err) {
        console.error("❌ /api/eod/submit error:", err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

router.get("/check-today", async (req, res) => {
  try {
    const rawId = req.query.storeId;
    const storeId = Number(rawId);

    console.log("🟢 /check-today called with:", { rawId, storeId });

    if (!storeId) {
      console.log("🔴 Invalid storeId");
      return res.json({ ok: true, exists: false });
    }

    const sql = `
      SELECT id, date, store_name
      FROM end_of_day
      WHERE location_id = $1
      AND date = CURRENT_DATE
      ORDER BY id DESC
      LIMIT 1
    `;

    // ✅ FIXED — use pool.query
    const result = await pool.query(sql, [storeId]);

    console.log("🟢 Query result:", result.rows);

    if (result.rows.length > 0) {
      return res.json({
        ok: true,
        exists: true,
        recordId: result.rows[0].id,
        date: result.rows[0].date,
        storeName: result.rows[0].store_name
      });
    }

    return res.json({ ok: true, exists: false });

  } catch (err) {
    console.error("❌ EOD check error:", err);
    res.status(500).json({ ok: false, error: "Check failed" });
  }
});

/* ============================================================
   GET EOD REPORT BY ID
   ============================================================ */
router.get("/report/:id", async (req, res) => {
  try {
    const eodId = Number(req.params.id);

    if (!eodId) {
      return res.status(400).json({ ok: false, error: "Invalid EOD id" });
    }

    const sql = `
      SELECT 
        e.id,
        e.store_name,
        e.location_id,
        e.date,
        e.signoff_user_id,
        e.confirmation,
        e.deposits,
        e.cashflow,
        e.adjustments,
        e.total_safe,
        e.total_float,
        u.firstname,
        u.lastname
      FROM end_of_day e
      LEFT JOIN users u
        ON u.id = e.signoff_user_id
      WHERE e.id = $1
      LIMIT 1
    `;

    const result = await pool.query(sql, [eodId]);

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "EOD report not found" });
    }

    const row = result.rows[0];

    return res.json({
      ok: true,
      report: {
        id: row.id,
        store: row.store_name,
        locationId: row.location_id,
        date: row.date,
        confirmation: row.confirmation || "",
        signoffUserId: row.signoff_user_id,
        signoffName: [row.firstname, row.lastname].filter(Boolean).join(" ") || "",
        deposits: row.deposits || {},
        cashflow: row.cashflow || {},
        adjustments: row.adjustments || {},
        totals: {
          safe: Number(row.total_safe || 0),
          float: Number(row.total_float || 0),
        },
      },
    });
  } catch (err) {
    console.error("❌ /api/eod/report/:id error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});




module.exports = router;
