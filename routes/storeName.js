const express = require("express");
const pool = require("../db");
const router = express.Router();

/**
 * GET /api/meta/store/:id
 * Returns a location (store) name given its ID.
 * Example: { ok: true, name: "Ashford" }
 */
router.get("/:id", async (req, res) => {
  const locationId = req.params.id;

  try {
    if (!locationId || isNaN(locationId)) {
      return res.status(400).json({ ok: false, error: "Invalid location ID" });
    }

    console.log("🔎 Looking up location name for ID:", locationId);

    // ✅ Query your `locations` table (PostgreSQL syntax)
    const result = await pool.query(
      "SELECT name FROM locations WHERE id = $1",
      [locationId]
    );

    if (result.rows.length === 0) {
      console.warn("⚠️ No location found for ID:", locationId);
      return res.status(404).json({ ok: false, error: "Location not found" });
    }

    const locationName = result.rows[0].name;
    console.log("✅ Found location name:", locationName);

    res.json({ ok: true, name: locationName });
  } catch (err) {
    console.error("❌ /api/meta/store/:id error:", err.message);
    res.status(500).json({ ok: false, error: "Database query failed" });
  }
});

module.exports = router;
