const express = require("express");
const router = express.Router();
const { nsGet } = require("../netsuiteClient");

// GET /api/netsuite/entity/:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    console.log(`🔎 Fetching NetSuite entity ${id}`);
    const entity = await nsGet(`/customer/${id}`);
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
