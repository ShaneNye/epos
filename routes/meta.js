// routes/meta.js
const express = require("express");
const pool = require("../db");
const router = express.Router();

/* ---------------- helpers ---------------- */
function normalizeSlug(s) {
  if (typeof s !== "string") return "";
  return s.replace(/^\//, "").replace(/\.html$/i, "").trim();
}
function toArray(val) {
  if (Array.isArray(val)) return val;
  if (val == null || val === "") return [];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
function cleanAccess(val) {
  const arr = toArray(val).map(normalizeSlug).filter(Boolean);
  return Array.from(new Set(arr));
}

/* ==========================
   ======== ROLES ===========
   ========================== */

// Get all roles
router.get("/roles", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, name, access FROM roles ORDER BY name");
    const roles = rows.map((r) => {
      let accessArr = [];

      if (Array.isArray(r.access)) {
        accessArr = r.access;
      } else if (typeof r.access === "string") {
        try {
          accessArr = JSON.parse(r.access);
        } catch {
          accessArr = [];
        }
      }

      return {
        id: r.id,
        name: r.name,
        access: cleanAccess(accessArr),
      };
    });

    //console.log("🔍 Roles meta fetched:", roles);
    return res.json({ ok: true, roles });
  } catch (err) {
    console.error("❌ GET /api/meta/roles error:", err);
    return res.status(500).json({ ok: false, error: "DB error fetching roles" });
  }
});

// Create new role
router.post("/roles", async (req, res) => {
  try {
    const { name, access = [] } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: "Role name required" });

    const accessArr = cleanAccess(access);
    console.log("🟢 Creating new role:", name, accessArr);

    const [result] = await pool.query(
      "INSERT INTO roles (name, access) VALUES (?, ?)",
      [name, JSON.stringify(accessArr)]
    );

    const [newRoleRows] = await pool.query("SELECT * FROM roles WHERE id = ?", [result.insertId]);
    console.log("✅ Role created successfully:", newRoleRows[0]);

    return res.json({ ok: true, message: "Role created", role: newRoleRows[0] });
  } catch (err) {
    console.error("❌ POST /api/meta/roles error:", err);
    return res.status(500).json({ ok: false, error: "DB error creating role" });
  }
});

// Update role
router.put("/roles/:id", async (req, res) => {
  try {
    const { name, access = [] } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: "Role name required" });

    const accessArr = cleanAccess(access);
    console.log("🟡 Updating role:", req.params.id, { name, accessArr });

    const [result] = await pool.query(
      "UPDATE roles SET name = ?, access = ? WHERE id = ?",
      [name, JSON.stringify(accessArr), req.params.id]
    );

    if (result.affectedRows === 0)
      return res.status(404).json({ ok: false, error: "Role not found" });

    const [updated] = await pool.query("SELECT * FROM roles WHERE id = ?", [req.params.id]);
    console.log("✅ Role updated in DB:", updated[0]);

    return res.json({ ok: true, message: "Role updated", role: updated[0] });
  } catch (err) {
    console.error("❌ PUT /api/meta/roles/:id error:", err);
    return res.status(500).json({ ok: false, error: "DB error updating role" });
  }
});

// Delete role
router.delete("/roles/:id", async (req, res) => {
  try {
    console.log("🗑️ Deleting role:", req.params.id);
    const [result] = await pool.query("DELETE FROM roles WHERE id = ?", [req.params.id]);

    if (result.affectedRows === 0)
      return res.status(404).json({ ok: false, error: "Role not found" });

    console.log("✅ Role deleted successfully:", req.params.id);
    return res.json({ ok: true, message: "Role deleted" });
  } catch (err) {
    console.error("❌ DELETE /api/meta/roles/:id error:", err);
    return res.status(500).json({ ok: false, error: "DB error deleting role" });
  }
});

/* ==========================
   ====== LOCATIONS =========
   ========================== */

// Get all locations
router.get("/locations", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        id,
        name,
        netsuite_internal_id,
        invoice_location_id,
        intercompany_customer,
        petty_cash_account,
        current_account
       FROM locations
       ORDER BY name`
    );

    res.json({ ok: true, locations: rows });
  } catch (err) {
    console.error("❌ GET /api/meta/locations error:", err);
    res.status(500).json({ ok: false, error: "DB error fetching locations" });
  }
});

// Create new location
router.post("/locations", async (req, res) => {
  try {
    const {
      name,
      netsuite_internal_id,
      invoice_location_id,
      intercompany_customer,
      petty_cash_account,
      current_account,
    } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Location name required" });
    }

    console.log("🟢 Creating location:", name);
    await pool.query(
      `INSERT INTO locations 
        (name, netsuite_internal_id, invoice_location_id, intercompany_customer, petty_cash_account, current_account)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        netsuite_internal_id || null,
        invoice_location_id || null,
        intercompany_customer || null,
        petty_cash_account || null,
        current_account || null,
      ]
    );

    res.json({ ok: true, message: "Location created" });
  } catch (err) {
    console.error("❌ POST /api/meta/locations error:", err);
    res.status(500).json({ ok: false, error: "DB error creating location" });
  }
});

// Update existing location
router.put("/locations/:id", async (req, res) => {
  try {
    const {
      name,
      netsuite_internal_id,
      invoice_location_id,
      intercompany_customer,
      petty_cash_account,
      current_account,
    } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Location name required" });
    }

    console.log("🟡 Updating location:", req.params.id);
    const [result] = await pool.query(
      `UPDATE locations
         SET name = ?,
             netsuite_internal_id = ?,
             invoice_location_id = ?,
             intercompany_customer = ?,
             petty_cash_account = ?,
             current_account = ?
       WHERE id = ?`,
      [
        name,
        netsuite_internal_id || null,
        invoice_location_id || null,
        intercompany_customer || null,
        petty_cash_account || null,
        current_account || null,
        req.params.id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: "Location not found" });
    }

    res.json({ ok: true, message: "Location updated" });
  } catch (err) {
    console.error("❌ PUT /api/meta/locations/:id error:", err);
    res.status(500).json({ ok: false, error: "DB error updating location" });
  }
});

module.exports = router;
