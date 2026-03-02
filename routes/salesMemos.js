const express = require("express");
const router = express.Router();
const { getSession } = require("../sessions");

// Import correct NetSuite client helper
const { nsRestlet } = require("../netsuiteClient");

// Your RESTlet URL (now from .env)
const MEMO_RESTLET_URL = process.env.MEMO_RESTLET_URL;

if (!MEMO_RESTLET_URL) {
  console.error("❌ MEMO_RESTLET_URL missing from environment variables");
}

/* ============================================================
   POST /api/sales/memo
   Creates memo in NetSuite via RESTlet
============================================================ */
router.post("/memo", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    console.log("🔑 Token:", token);

    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    console.log("👤 Session:", session);

    const userEmail = session?.email;
    const userId = session?.id; // Needed for user-specific OAuth

    console.log("📧 Author Email:", userEmail);
    console.log("🧑 User ID:", userId);

    if (!userEmail) return res.status(401).json({ ok: false, error: "Invalid session" });

    const { orderId, title, type, memo } = req.body;

    console.log("📦 Received Payload:", req.body);

    if (!orderId || !title || !memo) {
      console.log("❌ Missing required fields");
      return res.json({ ok: false, error: "Missing required fields" });
    }

    const payload = {
      orderId,
      title,
      type,
      memo,
      // support both naming styles in case session uses netsuiteid (lowercase)
      authorId: session?.netsuiteid || session?.netsuiteId || null,
    };

    console.log("📤 Sending to RESTlet:", payload);
    console.log("🌐 RESTlet URL:", MEMO_RESTLET_URL);

    // ---- Call RESTlet ----
    // IMPORTANT: 4th param is HTTP method now, NOT envType
    const nsResponse = await nsRestlet(MEMO_RESTLET_URL, payload, userId, "POST");

    console.log("📥 RESTlet Response:", nsResponse);

    return res.json(nsResponse);
  } catch (err) {
    console.error("❌ Error creating memo:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/memo/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    const suiteletBase = process.env.USER_NOTES_URL;
    const suiteletToken = process.env.USER_NOTES;

    if (!suiteletBase || !suiteletToken) {
      return res.json({ ok: false, error: "USER_NOTES_URL or USER_NOTES missing" });
    }

    // Append token correctly
    const suiteletUrl = `${suiteletBase}&token=${suiteletToken}`;

    console.log("📡 Fetching notes from Suitelet:", suiteletUrl);

    const resp = await fetch(suiteletUrl);
    const text = await resp.text();

    // If NetSuite returned HTML → authentication error
    if (text.startsWith("<")) {
      console.error("🛑 Suitelet returned HTML instead of JSON:");
      return res.json({
        ok: false,
        error: "Authentication failed calling Suitelet.",
        details: text.substring(0, 200),
      });
    }

    const data = JSON.parse(text);

    if (!data.ok || !Array.isArray(data.results)) {
      return res.json({ ok: false, error: "Invalid Suitelet JSON structure" });
    }

    // Filter by Sales Order internal ID
    const memos = data.results.filter((n) => String(n["Internal ID"]) === String(orderId));

    return res.json({ ok: true, memos });
  } catch (err) {
    console.error("❌ Error fetching memos via Suitelet:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;