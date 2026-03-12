const express = require("express");
const axios = require("axios");
const router = express.Router();
const pool = require("../db"); // adjust to your project

// Your DispatchTrack tenant base URL.
// Replace with your actual tenant domain.
const DISPATCHTRACK_BASE_URL = "https://sussexbeds.dispatchtrack.com/external_api/v1";

function getAuthHeaders(apiKey) {
  return {
    Authorization: `Basic ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function normaliseStopGroup(row, accountName) {
  // Adjust these mappings once you inspect the real payload
  const status =
    row.status ||
    row.state ||
    row.delivery_status ||
    row.stop_group_status ||
    null;

  const orderNumber =
    row.order_number ||
    row.identifier ||
    row.reference ||
    row.external_id ||
    row.number ||
    null;

  const store =
    row.store ||
    row.branch ||
    row.location ||
    row.custom_fields?.store ||
    row.meta?.store ||
    null;

  return {
    account: accountName,
    store,
    orderNumber,
    status,
    raw: row, // keep for testing, remove later
  };
}

async function fetchDispatchTrackOpenJobs(accountName, apiKey) {
  let page = 1;
  let totalPages = 1;
  const results = [];

  while (page <= totalPages) {
    const res = await axios.get(`${DISPATCHTRACK_BASE_URL}/stop_groups`, {
      headers: getAuthHeaders(apiKey),
      params: {
        page,
        per_page: 100,
      },
      timeout: 30000,
    });

    const body = res.data || {};
    const rows =
      body.stop_groups ||
      body.data ||
      body.results ||
      body.items ||
      [];

    const metaPages = body.meta?.pages?.total_pages;
    totalPages = Number(metaPages || 1);

    for (const row of rows) {
      const mapped = normaliseStopGroup(row, accountName);

      // Keep only non-finished jobs
      if (!mapped.status) {
        results.push(mapped);
        continue;
      }

      if (String(mapped.status).toLowerCase() !== "finished") {
        results.push(mapped);
      }
    }

    page += 1;
  }

  return results;
}

router.get("/api/dispatchtrack/open-jobs", async (req, res) => {
  try {
    const sql = `
      SELECT id, name, dispatchtrack_api_key
      FROM public.locations
      WHERE id IN (6, 7)
      ORDER BY id
    `;

    const dbResult = await pool.query(sql);
    const locations = dbResult.rows;

    if (!locations.length) {
      return res.status(404).json({ error: "No DispatchTrack accounts found." });
    }

    const output = [];

    for (const loc of locations) {
      if (!loc.dispatchtrack_api_key) {
        output.push({
          account: loc.name,
          error: "Missing dispatchtrack_api_key",
        });
        continue;
      }

      try {
        const jobs = await fetchDispatchTrackOpenJobs(
          loc.name,
          loc.dispatchtrack_api_key
        );
        output.push(...jobs);
      } catch (err) {
        output.push({
          account: loc.name,
          error: err.response?.data || err.message,
        });
      }
    }

    return res.json({
      success: true,
      count: output.length,
      data: output,
    });
  } catch (err) {
    console.error("DispatchTrack open jobs error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;