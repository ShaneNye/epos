const express = require("express");
const router = express.Router();
const { getSession } = require("../sessions");

// Import correct NetSuite client helper
const { nsRestlet } = require("../netsuiteClient");

// Your RESTlet URL
const MEMO_RESTLET_URL =
    "https://7972741-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=4199&deploy=1";

/* ============================================================
   POST /api/sales/memo
   Creates memo in NetSuite via RESTlet
============================================================ */
router.post("/memo", async (req, res) => {
    try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

        console.log("🔑 Token:", token);

        if (!token)
            return res.status(401).json({ ok: false, error: "Unauthorized" });

        const session = await getSession(token);
        console.log("👤 Session:", session);

        const userEmail = session?.email;
        const userId = session?.id;   // Needed for user-specific OAuth

        console.log("📧 Author Email:", userEmail);
        console.log("🧑 User ID:", userId);

        if (!userEmail)
            return res.status(401).json({ ok: false, error: "Invalid session" });

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
            authorId: session.netsuiteId || null  // ← from your users table
        };


        console.log("📤 Sending to RESTlet:", payload);
        console.log("🌐 RESTlet URL:", MEMO_RESTLET_URL);

        // ---- Call RESTlet ----
        const nsResponse = await nsRestlet(MEMO_RESTLET_URL, payload, userId, "sb");

        console.log("📥 RESTlet Response:", nsResponse);

        return res.json(nsResponse);

    } catch (err) {
        console.error("❌ Error creating memo:", err);
        res.status(500).json({ ok: false, error: "Server error" });
    }
});


/* ============================================================
   GET /api/sales/memo/:orderId
   Fetch memo list from NetSuite RESTlet
============================================================ */
router.get("/memo/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    console.log("🔎 Fetching memos for order:", orderId);

    const rawAuth = req.headers.authorization || "";
    const token = rawAuth.replace("Bearer ", "");
    const session = await getSession(token);
    const userId = session?.user_id || session?.id;

    console.log("🔐 User Session:", session);

    const url = `${MEMO_RESTLET_URL}&id=${orderId}`;
    console.log("🌐 RESTlet GET URL:", url);

    const nsResponse = await nsRestlet(url, null, userId, "sb", "GET");
    console.log("📥 RESTlet GET Response:", nsResponse);

    return res.json({
      ok: nsResponse.ok,
      memos: nsResponse.results || []
    });

  } catch (err) {
    console.error("❌ Error fetching memos:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});



module.exports = router;
