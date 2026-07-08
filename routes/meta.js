// routes/meta.js
const express = require("express");
const pool = require("../db");
const {
  ensureCashBalanceAuditTable,
  logCashBalanceChange,
  money,
  resolveUserContextFromRequest,
} = require("../utils/cashBalanceAudit");
const router = express.Router();

/* ---------------- helpers ---------------- */
function normalizeSlug(s) {
  if (typeof s !== "string") return "";
  const slug = s.replace(/^\//, "").replace(/\.html$/i, "").trim().toLowerCase();
  if (slug === "end-of-day" || slug === "endofday") return "eod";
  if (slug === "cash-flow") return "cashflow";
  return slug;
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

let locationStoreManagerColumnReady = false;

async function ensureLocationStoreManagerColumn() {
  if (locationStoreManagerColumnReady) return;
  await pool.query("ALTER TABLE locations ADD COLUMN IF NOT EXISTS store_manager INTEGER");
  locationStoreManagerColumnReady = true;
}

router.get("/locations", async (req, res) => {
  try {
    await ensureLocationStoreManagerColumn();
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
        store_manager,

        -- existing field (keep for backwards compatibility)
        email,

        -- ✅ new fields
        location_phone_number,
        location_email,
        vat_number,
        company_number,
        address_line_1,
        address_line_2,
        postcode,

        float_balance,
        safe_balance                    
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
    await ensureLocationStoreManagerColumn();
    const {
      name,
      netsuite_internal_id,
      invoice_location_id,
      intercompany_customer,
      intercompany_location,
      distribution_location_id,
      petty_cash_account,
      current_account,
      store_manager,

      // existing + new
      email,                 // legacy
      location_phone_number,
      location_email,
      vat_number,
      company_number,
      address_line_1,
      address_line_2,
      postcode
    } = req.body;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Location name required" });
    }

    console.log("🟢 Creating location:", name);

    await pool.query(
      `INSERT INTO locations 
        (
          name,
          netsuite_internal_id,
          invoice_location_id,
          intercompany_customer,
          intercompany_location,
          distribution_location_id,
          petty_cash_account,
          current_account,
          store_manager,

          email,
          location_phone_number,
          location_email,
          vat_number,
          company_number,
          address_line_1,
          address_line_2,
          postcode
        )
       VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,
          $10,$11,$12,$13,$14,$15,$16,$17
       )`,
      [
        name,
        netsuite_internal_id || null,
        invoice_location_id || null,
        intercompany_customer || null,
        intercompany_location || null,
        distribution_location_id || null,
        petty_cash_account || null,
        current_account || null,
        store_manager || null,

        email || null,                     // legacy
        location_phone_number || null,
        location_email || null,
        vat_number || null,
        company_number || null,
        address_line_1 || null,
        address_line_2 || null,
        postcode || null
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
    await ensureLocationStoreManagerColumn();
    const {
      name,
      netsuite_internal_id,
      invoice_location_id,
      intercompany_customer,
      intercompany_location,
      distribution_location_id,
      petty_cash_account,
      current_account,
      store_manager,

      // existing + new
      email,                 // legacy
      location_phone_number,
      location_email,
      vat_number,
      company_number,
      address_line_1,
      address_line_2,
      postcode
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
             store_manager = $9,

             email = $10,
             location_phone_number = $11,
             location_email = $12,
             vat_number = $13,
             company_number = $14,
             address_line_1 = $15,
             address_line_2 = $16,
             postcode = $17
       WHERE id = $18`,
      [
        name,
        netsuite_internal_id || null,
        invoice_location_id || null,
        intercompany_customer || null,
        intercompany_location || null,
        distribution_location_id || null,
        petty_cash_account || null,
        current_account || null,
        store_manager || null,

        email || null,                     // legacy
        location_phone_number || null,
        location_email || null,
        vat_number || null,
        company_number || null,
        address_line_1 || null,
        address_line_2 || null,
        postcode || null,

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

// ============================
//   SAFE EMPTIED (SET TO ZERO)
// ============================
router.post("/locations/:id/safe-emptied", async (req, res) => {
  const client = await pool.connect();
  try {
    const id = req.params.id;
    const user = await resolveUserContextFromRequest(req);

    await client.query("BEGIN");

    const before = await client.query(
      "SELECT * FROM locations WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (before.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Location not found" });
    }

    const oldSafe = money(before.rows[0].safe_balance);

    const result = await client.query(
      "UPDATE locations SET safe_balance = 0 WHERE id = $1 RETURNING *",
      [id]
    );

    await logCashBalanceChange(client, {
      locationId: id,
      balanceType: "safe",
      changeSource: "manual",
      oldBalance: oldSafe,
      adjustmentAmount: -oldSafe,
      newBalance: 0,
      updatedBy: user.id,
      updatedByName: user.name,
      referenceType: "safe_emptied",
    });

    await client.query("COMMIT");

    res.json({ ok: true, message: "Safe reset to GBP 0.00", location: result.rows[0] });

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /locations/:id/safe-emptied error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to reset safe balance" });
  } finally {
    client.release();
  }
});

router.post("/locations/:id/balances", async (req, res) => {
  const client = await pool.connect();
  try {
    const id = req.params.id;
    const { float_balance, safe_balance } = req.body;
    const user = await resolveUserContextFromRequest(req);

    const floatBalance = Number(float_balance);
    const safeBalance = Number(safe_balance);

    if (!Number.isFinite(floatBalance) || !Number.isFinite(safeBalance)) {
      return res.status(400).json({
        ok: false,
        error: "Valid float_balance and safe_balance are required"
      });
    }

    if (floatBalance < 0 || safeBalance < 0) {
      return res.status(400).json({
        ok: false,
        error: "Balances cannot be negative"
      });
    }

    await client.query("BEGIN");

    const before = await client.query(
      "SELECT * FROM locations WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (before.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        error: "Location not found"
      });
    }

    const oldFloat = money(before.rows[0].float_balance);
    const oldSafe = money(before.rows[0].safe_balance);

    const result = await client.query(
      `
      UPDATE locations
      SET float_balance = $1,
          safe_balance = $2
      WHERE id = $3
      RETURNING *
      `,
      [floatBalance, safeBalance, id]
    );

    await logCashBalanceChange(client, {
      locationId: id,
      balanceType: "float",
      changeSource: "manual",
      oldBalance: oldFloat,
      newBalance: floatBalance,
      updatedBy: user.id,
      updatedByName: user.name,
      referenceType: "cashflow_manual_save",
    });

    await logCashBalanceChange(client, {
      locationId: id,
      balanceType: "safe",
      changeSource: "manual",
      oldBalance: oldSafe,
      newBalance: safeBalance,
      updatedBy: user.id,
      updatedByName: user.name,
      referenceType: "cashflow_manual_save",
    });

    await client.query("COMMIT");

    return res.json({
      ok: true,
      message: "Balances updated successfully",
      location: result.rows[0]
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /locations/:id/balances error:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to update balances"
    });
  } finally {
    client.release();
  }
});

router.get("/locations/:id/balance-history", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid location id" });
    }

    await ensureCashBalanceAuditTable();

    const { from, to, updatedBy } = req.query;
    const filters = ["a.location_id = $1"];
    const values = [id];

    if (from) {
      values.push(from);
      filters.push(`a.created_at >= $${values.length}::date`);
    }

    if (to) {
      values.push(to);
      filters.push(`a.created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }

    if (updatedBy) {
      if (updatedBy === "unknown") {
        filters.push("a.updated_by IS NULL");
      } else {
        const updatedById = Number(updatedBy);
        if (!Number.isFinite(updatedById) || updatedById <= 0) {
          return res.status(400).json({ ok: false, error: "Invalid updated by filter" });
        }
        values.push(updatedById);
        filters.push(`a.updated_by = $${values.length}`);
      }
    }

    const result = await pool.query(
      `SELECT
          a.id,
          a.location_id,
          a.balance_type,
          a.change_source,
          a.old_balance,
          a.adjustment_amount,
          a.new_balance,
          a.updated_by,
          COALESCE(a.updated_by_name, NULLIF(CONCAT_WS(' ', u.firstname, u.lastname), ''), u.email) AS updated_by_name,
          a.reference_type,
          a.reference_id,
          a.created_at
       FROM cash_balance_audit a
       LEFT JOIN users u ON u.id = a.updated_by
       WHERE ${filters.join(" AND ")}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 100`,
      values
    );

    const updatedByResult = await pool.query(
      `SELECT DISTINCT
          COALESCE(a.updated_by::text, 'unknown') AS value,
          COALESCE(a.updated_by_name, NULLIF(CONCAT_WS(' ', u.firstname, u.lastname), ''), u.email, 'Unknown') AS label
       FROM cash_balance_audit a
       LEFT JOIN users u ON u.id = a.updated_by
       WHERE a.location_id = $1
       ORDER BY label`,
      [id]
    );

    return res.json({
      ok: true,
      history: result.rows,
      updatedByOptions: updatedByResult.rows
    });
  } catch (err) {
    console.error("GET /locations/:id/balance-history error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to load balance history" });
  }
});

/*
 * Legacy duplicate balance routes removed from the active router.
 * The audited handlers above are the single source of truth for balance changes.
 *
router.post("/locations/:id/safe-emptied", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await pool.query(
      "UPDATE locations SET safe_balance = 0 WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Location not found" });
    }

    res.json({ ok: true, message: "Safe reset to £0.00", location: result.rows[0] });

  } catch (err) {
    console.error("❌ POST /locations/:id/safe-emptied error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to reset safe balance" });
  }
});

router.post("/locations/:id/balances", async (req, res) => {
  try {
    const id = req.params.id;
    const { float_balance, safe_balance } = req.body;

    const floatBalance = Number(float_balance);
    const safeBalance = Number(safe_balance);

    if (!Number.isFinite(floatBalance) || !Number.isFinite(safeBalance)) {
      return res.status(400).json({
        ok: false,
        error: "Valid float_balance and safe_balance are required"
      });
    }

    if (floatBalance < 0 || safeBalance < 0) {
      return res.status(400).json({
        ok: false,
        error: "Balances cannot be negative"
      });
    }

    const result = await pool.query(
      `
      UPDATE locations
      SET float_balance = $1,
          safe_balance = $2
      WHERE id = $3
      RETURNING *
      `,
      [floatBalance, safeBalance, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Location not found"
      });
    }

    return res.json({
      ok: true,
      message: "Balances updated successfully",
      location: result.rows[0]
    });
  } catch (err) {
    console.error("❌ POST /locations/:id/balances error:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Failed to update balances"
    });
  }
});



*/

module.exports = router;
