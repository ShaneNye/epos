const express = require("express");
const router = express.Router();
const pool = require("../db");

// Returns list of editable columns from the users table
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    // Exclude internal / system fields you do NOT want users modifying
    const blacklist = [
      "id",
      "password_hash",
      "created_at",
      "updated_at",
      "sb_netsuite_token_id",
      "sb_netsuite_token_secret",
      "prod_netsuite_token_id",
      "prod_netsuite_token_secret"
    ];

    const fields = result.rows
      .map(r => r.column_name)
      .filter(f => !blacklist.includes(f));

    res.json({ ok: true, fields });
  } catch (err) {
    console.error("❌ Error loading user fields:", err);
    res.json({ ok: false, error: "Failed to fetch user fields" });
  }
});

module.exports = router;
