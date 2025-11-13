const express = require("express");
const router = express.Router();
const pool = require("../db");

// Get rules for all roles
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT role_name, field_name
      FROM user_management_rules
      ORDER BY role_name, field_name
    `);

    res.json({ ok: true, rules: result.rows });
  } catch (err) {
    console.error("❌ Fetch rules error:", err);
    res.json({ ok: false, error: "Failed to fetch rules" });
  }
});

// Get rules for single role
router.get("/:roleName", async (req, res) => {
  try {
    const roleName = req.params.roleName;

    const result = await pool.query(
      `SELECT field_name FROM user_management_rules WHERE role_name = $1`,
      [roleName]
    );

    res.json({ ok: true, fields: result.rows.map(r => r.field_name) });
  } catch (err) {
    console.error("❌ Fetch rules error:", err);
    res.json({ ok: false, error: "Failed to fetch role rules" });
  }
});

// Save rules for a role
router.put("/:roleName", async (req, res) => {
  const roleName = req.params.roleName;
  const { fields } = req.body;

  try {
    await pool.query(`DELETE FROM user_management_rules WHERE role_name = $1`, [
      roleName,
    ]);

    for (const field of fields) {
      await pool.query(
        `INSERT INTO user_management_rules (role_name, field_name, allowed)
         VALUES ($1, $2, TRUE)`,
        [roleName, field]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Save rules error:", err);
    res.json({ ok: false, error: "Failed to save rules" });
  }
});

module.exports = router;
