const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ============================================================
   GET ALL LOGISTICS AREAS
   ============================================================ */
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT la.id,
                   la.warehouse_id,
                   la.postcodes,
                   la.hex_color,
                   la.created_at,
                   la.updated_at,
                   l.name AS warehouse_name
            FROM logistics_area la
            LEFT JOIN locations l ON la.warehouse_id = l.id
            ORDER BY la.id ASC
        `);

        res.json({
            ok: true,
            logistics: result.rows
        });
    } catch (err) {
        console.error("❌ GET /api/logistics error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/* ============================================================
   CREATE NEW LOGISTICS AREA
   ============================================================ */
router.post("/", async (req, res) => {
    try {
        const { warehouse_id, postcodes, hex_color } = req.body;

        if (!warehouse_id) {
            return res.status(400).json({ ok: false, error: "Missing warehouse_id" });
        }
        if (!Array.isArray(postcodes)) {
            return res.status(400).json({ ok: false, error: "postcodes must be an array" });
        }

        const colorToSave = hex_color || "#0081ab";

        const result = await pool.query(
            `
            INSERT INTO logistics_area (warehouse_id, postcodes, hex_color)
            VALUES ($1, $2, $3)
            RETURNING id
            `,
            [warehouse_id, postcodes, colorToSave]
        );

        res.json({ ok: true, id: result.rows[0].id });

    } catch (err) {
        console.error("❌ POST /api/logistics error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/* ============================================================
   UPDATE EXISTING LOGISTICS AREA
   ============================================================ */
router.patch("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { warehouse_id, postcodes, hex_color } = req.body;

        const result = await pool.query(
            `
            UPDATE logistics_area
            SET 
                warehouse_id = $2,
                postcodes = $3,
                hex_color = $4,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id
            `,
            [id, warehouse_id, postcodes, hex_color]
        );

        if (!result.rows.length) {
            return res.status(404).json({ ok: false, error: "Record not found" });
        }

        res.json({ ok: true, id: result.rows[0].id });

    } catch (err) {
        console.error("❌ PATCH /api/logistics/:id error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});



/* ============================================================
   DELETE LOGISTICS AREA
   ============================================================ */
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query("DELETE FROM logistics_area WHERE id = $1", [id]);

        res.json({ ok: true });

    } catch (err) {
        console.error("❌ DELETE /api/logistics/:id error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ============================================================
   LOOKUP WAREHOUSE BY POSTCODE PREFIX
============================================================ */
router.get("/lookup/:prefix", async (req, res) => {
    try {
        const prefix = req.params.prefix.toUpperCase().trim();

        const result = await pool.query(`
            SELECT la.warehouse_id, l.name AS warehouse_name
            FROM logistics_area la
            LEFT JOIN locations l ON la.warehouse_id = l.id
            WHERE $1 = ANY(la.postcodes)
            LIMIT 1
        `, [prefix]);

        if (result.rows.length === 0) {
            return res.json({ ok: true, found: false });
        }

        res.json({
            ok: true,
            found: true,
            warehouse_id: result.rows[0].warehouse_id,
            warehouse_name: result.rows[0].warehouse_name
        });

    } catch (err) {
        console.error("❌ POSTCODE LOOKUP ERROR:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});


module.exports = router;
