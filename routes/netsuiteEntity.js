const express = require("express");
const router = express.Router();
const { nsGet } = require("../netsuiteClient");

// netsuiteEntity.js
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
    if (token) {
      const { getSession } = require("../sessions");
      const session = await getSession(token);
      userId = session?.id || null;
    }

    console.log(`🔎 Fetching NetSuite entity ${id} (user ${userId || "env default"})`);
    const entity = await nsGet(`/customer/${id}`, userId, "sb");

    console.log("✅ Entity fetched:", {
      id: entity.id,
      title: entity.custentity_title?.refName,
    });
    res.json({ ok: true, entity });
  } catch (err) {
    console.error("❌ Failed to fetch entity:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});


module.exports = router;
