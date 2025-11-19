const express = require("express");
const router = express.Router();
const db = require("../db");

/* ============================================================
   GET /api/eod/submissions
=========================================================== */
router.get("/submissions", async (req, res) => {
  try {
    const { storeId, from, to } = req.query;

    const conditions = [];
    const params = [];

    if (storeId) {
      params.push(storeId);
      conditions.push(`e.location_id = $${params.length}`);   // ⭐ FIXED
    }

    if (from) {
      params.push(from);
      conditions.push(`e.date >= $${params.length}`);          // ⭐ prefix table
    }

    if (to) {
      params.push(to);
      conditions.push(`e.date <= $${params.length}`);          // ⭐ prefix table
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT
        e.id,
        e.date,
        e.store_name,
        e.location_id,
        e.signoff_user_id,
        e.confirmation,
        e.deposits,
        e.cashflow,
        e.adjustments,
        e.total_safe,
        e.total_float,
        e.created_at,
        u.firstname,
        u.lastname
      FROM end_of_day e
      LEFT JOIN users u ON u.id = e.signoff_user_id
      ${where}
      ORDER BY e.date DESC, e.id DESC
      LIMIT 200;
    `;

    const result = await db.query(sql, params);

    const formatted = result.rows.map(r => ({
      id: r.id,
      date: r.date,
      storeName: r.store_name,
      locationId: r.location_id,
      signoffUser: `${r.firstname || ""} ${r.lastname || ""}`.trim(),
      confirmation: r.confirmation,
      totals: {
        safe: Number(r.total_safe),
        float: Number(r.total_float)
      },
      deposits: r.deposits,
      cashflow: r.cashflow,
      adjustments: r.adjustments,
      createdAt: r.created_at
    }));

    res.json({ ok: true, results: formatted });

  } catch (err) {
    console.error("❌ EOD submissions route error:", err);
    res.status(500).json({ ok: false, error: "Failed to load submissions" });
  }
});

module.exports = router;
