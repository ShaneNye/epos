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
    const result = await pool.query("SELECT id, name, access FROM roles ORDER BY name");
    const roles = result.rows.map((r) => {
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

    return res.json({ ok: true, roles });
  } catch (err) {
    console.error("❌ GET /api/meta/roles error:", err.message);
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

    const insertResult = await pool.query(
      "INSERT INTO roles (name, access) VALUES ($1, $2) RETURNING *",
      [name, JSON.stringify(accessArr)]
    );

    const newRole = insertResult.rows[0];
    console.log("✅ Role created successfully:", newRole);

    return res.json({ ok: true, message: "Role created", role: newRole });
  } catch (err) {
    console.error("❌ POST /api/meta/roles error:", err.message);
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

    const updateResult = await pool.query(
      "UPDATE roles SET name = $1, access = $2 WHERE id = $3 RETURNING *",
      [name, JSON.stringify(accessArr), req.params.id]
    );

    if (updateResult.rowCount === 0)
      return res.status(404).json({ ok: false, error: "Role not found" });

    const updated = updateResult.rows[0];
    console.log("✅ Role updated in DB:", updated);

    return res.json({ ok: true, message: "Role updated", role: updated });
  } catch (err) {
    console.error("❌ PUT /api/meta/roles/:id error:", err.message);
    return res.status(500).json({ ok: false, error: "DB error updating role" });
  }
});

// Delete role
router.delete("/roles/:id", async (req, res) => {
  try {
    console.log("🗑️ Deleting role:", req.params.id);
    const deleteResult = await pool.query("DELETE FROM roles WHERE id = $1", [req.params.id]);

    if (deleteResult.rowCount === 0)
      return res.status(404).json({ ok: false, error: "Role not found" });

    console.log("✅ Role deleted successfully:", req.params.id);
    return res.json({ ok: true, message: "Role deleted" });
  } catch (err) {
    console.error("❌ DELETE /api/meta/roles/:id error:", err.message);
    return res.status(500).json({ ok: false, error: "DB error deleting role" });
  }
});

/* ==========================
   ====== LOCATIONS =========
   ========================== */

router.get("/locations", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        name,
        netsuite_internal_id,
        invoice_location_id,
        intercompany_customer,
        intercompany_location,
        distribution_location_id,
        petty_cash_account,
        current_account,
        email                       -- ⭐ NEW FIELD
       FROM locations
       ORDER BY name`
    );

    res.json({ ok: true, locations: result.rows });
  } catch (err) {
    console.error("❌ GET /api/meta/locations error:", err.message);
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
      intercompany_location,
      distribution_location_id,
      petty_cash_account,
      current_account,
      email                   // ⭐ NEW
    } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Location name required" });
    }

    console.log("🟢 Creating location:", name);
    await pool.query(
      `INSERT INTO locations 
        (name, netsuite_internal_id, invoice_location_id, intercompany_customer, intercompany_location,
         distribution_location_id, petty_cash_account, current_account, email)     -- ⭐ NEW
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        name,
        netsuite_internal_id || null,
        invoice_location_id || null,
        intercompany_customer || null,
        intercompany_location || null,
        distribution_location_id || null,
        petty_cash_account || null,
        current_account || null,
        email || null             // ⭐ NEW
      ]
    );

    res.json({ ok: true, message: "Location created" });
  } catch (err) {
    console.error("❌ POST /api/meta/locations error:", err.message);
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
      intercompany_location,
      distribution_location_id,
      petty_cash_account,
      current_account,
      email                     // ⭐ NEW
    } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Location name required" });
    }

    console.log("🟡 Updating location:", req.params.id);
    const updateResult = await pool.query(
      `UPDATE locations
         SET name = $1,
             netsuite_internal_id = $2,
             invoice_location_id = $3,
             intercompany_customer = $4,
             intercompany_location = $5,
             distribution_location_id = $6,
             petty_cash_account = $7,
             current_account = $8,
             email = $9                       -- ⭐ NEW
       WHERE id = $10`,
      [
        name,
        netsuite_internal_id || null,
        invoice_location_id || null,
        intercompany_customer || null,
        intercompany_location || null,
        distribution_location_id || null,
        petty_cash_account || null,
        current_account || null,
        email || null,                        // ⭐ NEW
        req.params.id
      ]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Location not found" });
    }

    res.json({ ok: true, message: "Location updated" });
  } catch (err) {
    console.error("❌ PUT /api/meta/locations/:id error:", err.message);
    res.status(500).json({ ok: false, error: "DB error updating location" });
  }
});



module.exports = router;
