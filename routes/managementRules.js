const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ============================================================
   Available fields admins can grant to roles
   (These are the fields shown in the popup checkbox list)
============================================================ */
const MANAGEMENT_FIELDS = [
  "firstname",
  "lastname",
  "email",
  "profileimage",
  "primarystore",
  "location_id",
  "netsuiteid",
  "invoicelocationid",
  "themehex",  
];

/* Extra safety: never allow these through the UI */
const DISALLOWED_FIELDS = new Set([
  "role_ids",
  "roles",
  "password_hash",
  "reset_token",
  "reset_expires",
  "sb_netsuite_token_id",
  "sb_netsuite_token_secret",
  "prod_netsuite_token_id",
  "prod_netsuite_token_secret",
]);

/* ============================================================
   GET /management-fields
   Returns the list of fields that *can* be assigned as editable
   NOTE: Must appear BEFORE "/:roleName"
============================================================ */
router.get("/management-fields", async (req, res) => {
  try {
    const fields = MANAGEMENT_FIELDS.filter(f => !DISALLOWED_FIELDS.has(f));
    res.json({ ok: true, fields });
  } catch (err) {
    console.error("❌ Fetch management fields error:", err);
    res.json({ ok: false, error: "Failed to fetch management fields" });
  }
});

/* ============================================================
   GET /  (all rules for all roles)
============================================================ */
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

/* ============================================================
   GET /:roleName  (rules for a single role)
============================================================ */
router.get("/:roleName", async (req, res) => {
  try {
    const roleName = (req.params.roleName || "").trim();
    if (!roleName) return res.json({ ok: true, fields: [] });

    const result = await pool.query(
      `SELECT field_name
         FROM user_management_rules
        WHERE TRIM(role_name) = $1
        ORDER BY field_name`,
      [roleName]
    );

    res.json({ ok: true, fields: result.rows.map(r => r.field_name) });
  } catch (err) {
    console.error("❌ Fetch role rules error:", err);
    res.json({ ok: false, error: "Failed to fetch role rules" });
  }
});

/* ============================================================
   PUT /:roleName  (save rules for a role)
   Body: { fields: ["firstname", "email", ...] }
============================================================ */
router.put("/:roleName", async (req, res) => {
  const roleName = (req.params.roleName || "").trim();
  const { fields } = req.body;

  if (!roleName) {
    return res.json({ ok: false, error: "roleName is required" });
  }

  if (!Array.isArray(fields)) {
    return res.json({ ok: false, error: "fields must be an array" });
  }

  // sanitize + enforce deny list
  const cleanedFields = fields
    .map(f => String(f || "").trim())
    .filter(Boolean)
    .filter(f => !DISALLOWED_FIELDS.has(f));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // delete any rows even if role_name had leading/trailing spaces previously
    await client.query(
      `DELETE FROM user_management_rules WHERE TRIM(role_name) = $1`,
      [roleName]
    );

    for (const field of cleanedFields) {
      await client.query(
        `INSERT INTO user_management_rules (role_name, field_name, allowed)
         VALUES ($1, $2, TRUE)`,
        [roleName, field]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Save rules error:", err);
    res.json({ ok: false, error: "Failed to save rules" });
  } finally {
    client.release();
  }
});

module.exports = router;
