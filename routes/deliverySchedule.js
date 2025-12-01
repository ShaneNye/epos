const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ============================================================
   HELPERS
============================================================ */

const DAYS = ["MON", "TUES", "WEDS", "THURS", "FRI", "SAT"];
const ZONES = [1, 2, 3, 4, 5, 6];

/**
 * Auto-create all headers + cell rows for the given warehouse.
 */
async function initialiseWarehouseSchedule(warehouseId) {
    // Insert missing zone headers
    await pool.query(`
        INSERT INTO delivery_schedule_zone_headers (warehouse_id, zone_number, label)
        SELECT $1, z, CONCAT('Zone ', z)
        FROM generate_series(1,6) AS z
        ON CONFLICT DO NOTHING;
    `, [warehouseId]);

    // Insert missing cells
    for (const day of DAYS) {
        for (const zone of ZONES) {
            await pool.query(`
                INSERT INTO delivery_schedule_cells (warehouse_id, day, zone_number)
                VALUES ($1, $2, $3)
                ON CONFLICT (warehouse_id, day, zone_number) DO NOTHING;
            `, [warehouseId, day, zone]);
        }
    }
}

/* ============================================================
   GET SINGLE CELL (must come FIRST to avoid route collisions)
============================================================ */
router.get("/cell/:warehouseId/:day/:zone", async (req, res) => {
    const { warehouseId, day, zone } = req.params;

    try {
        const result = await pool.query(`
            SELECT warehouse_id, day, zone_number, ampm, label, postcodes, color
            FROM delivery_schedule_cells
            WHERE warehouse_id = $1
              AND day = $2
              AND zone_number = $3
            LIMIT 1
        `, [warehouseId, day.toUpperCase(), zone]);

        if (!result.rows.length) {
            return res.json({ ok: false, error: "Cell not found" });
        }

        res.json({ ok: true, cell: result.rows[0] });

    } catch (err) {
        console.error("❌ GET cell error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ============================================================
   UPDATE A SINGLE CELL
============================================================ */
router.patch("/cell/:warehouseId/:day/:zone", async (req, res) => {
    const { warehouseId, day, zone } = req.params;
    const { ampm, label, postcodes, color } = req.body;

    try {
        const result = await pool.query(`
            UPDATE delivery_schedule_cells
            SET 
                ampm = COALESCE($4, ampm),
                label = COALESCE($5, label),
                postcodes = COALESCE($6, postcodes),
                color = COALESCE($7, color),
                updated_at = NOW()
            WHERE warehouse_id = $1 
              AND day = $2
              AND zone_number = $3
            RETURNING id
        `, [warehouseId, day.toUpperCase(), zone, ampm, label, postcodes, color]);

        if (!result.rowCount)
            return res.json({ ok: false, error: "Cell not found" });

        res.json({ ok: true });

    } catch (err) {
        console.error("❌ PATCH cell error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ============================================================
   RESET A SINGLE CELL
============================================================ */
router.delete("/cell/:warehouseId/:day/:zone", async (req, res) => {
    const { warehouseId, day, zone } = req.params;

    try {
        await pool.query(`
            UPDATE delivery_schedule_cells
            SET 
                ampm = NULL,
                label = NULL,
                postcodes = NULL,
                color = NULL,
                updated_at = NOW()
            WHERE warehouse_id = $1 
              AND day = $2 
              AND zone_number = $3
        `, [warehouseId, day.toUpperCase(), zone]);

        res.json({ ok: true });

    } catch (err) {
        console.error("❌ DELETE cell error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ============================================================
   UPDATE ZONE HEADER
============================================================ */
router.patch("/header/:warehouseId/:zone", async (req, res) => {
    const { warehouseId, zone } = req.params;
    const { label } = req.body;

    try {
        const result = await pool.query(`
            UPDATE delivery_schedule_zone_headers
            SET label = $3,
                updated_at = NOW()
            WHERE warehouse_id = $1 AND zone_number = $2
            RETURNING id
        `, [warehouseId, zone, label]);

        if (!result.rowCount)
            return res.json({ ok: false, error: "Header not found" });

        res.json({ ok: true });

    } catch (err) {
        console.error("❌ PATCH header error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ============================================================
   GET FULL WAREHOUSE DELIVERY SCHEDULE
============================================================ */
router.get("/:warehouseId", async (req, res) => {
    const { warehouseId } = req.params;

    try {
        // ensure schedule exists
        await initialiseWarehouseSchedule(warehouseId);

        const headers = await pool.query(`
            SELECT zone_number, label
            FROM delivery_schedule_zone_headers
            WHERE warehouse_id = $1
            ORDER BY zone_number ASC
        `, [warehouseId]);

        const cells = await pool.query(`
            SELECT day, zone_number, ampm, label, postcodes, color
            FROM delivery_schedule_cells
            WHERE warehouse_id = $1
            ORDER BY day, zone_number
        `, [warehouseId]);

        res.json({ ok: true, headers: headers.rows, cells: cells.rows });

    } catch (err) {
        console.error("❌ GET schedule error:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
