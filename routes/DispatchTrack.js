const express = require("express");
const fetch = require("node-fetch");
const router = express.Router();
const pool = require("../db");

router.get("/api/dispatchtrack/debug", async (req, res) => {
  try {
    const locationId = Number(req.query.locationId || 6);
    const date = String(req.query.date || "2026-03-10");

    const db = await pool.query(
      `
      SELECT id, name, dispatchtrack_api_key
      FROM public.locations
      WHERE id = $1
      LIMIT 1
      `,
      [locationId]
    );

    const loc = db.rows[0];
    if (!loc) {
      return res.status(404).json({ success: false, error: "Location not found" });
    }

    const url = `https://sussexbeds.dispatchtrack.com/api/external/v1/routes?date=${encodeURIComponent(date)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-AUTH-TOKEN": loc.dispatchtrack_api_key,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();

    return res.json({
      success: true,
      account: loc.name,
      testedUrl: url,
      status: response.status,
      headers: {
        contentType: response.headers.get("content-type"),
      },
      body: text,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;