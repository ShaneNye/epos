const express = require("express");
const fetch = require("node-fetch");

const router = express.Router();

function getApiKey() {
  return String(process.env.WHAT3WORDS_API_KEY || process.env.W3W_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

router.get("/convert-to-3wa", async (req, res) => {
  try {
    const key = getApiKey();
    if (!key) {
      return res.status(503).json({
        ok: false,
        error: "what3words API key is not configured",
      });
    }

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ ok: false, error: "Valid latitude and longitude are required" });
    }

    const url = new URL("https://api.what3words.com/v3/convert-to-3wa");
    url.searchParams.set("key", key);
    url.searchParams.set("coordinates", `${lat},${lng}`);
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.error) {
      return res.status(response.status || 502).json({
        ok: false,
        error: payload.error?.message || "Failed to generate what3words address",
      });
    }

    return res.json({
      ok: true,
      words: payload.words,
      map: payload.map,
      nearestPlace: payload.nearestPlace,
      coordinates: payload.coordinates,
      square: payload.square,
    });
  } catch (err) {
    console.error("what3words convert-to-3wa error:", err.message || err);
    return res.status(500).json({ ok: false, error: "Failed to generate what3words address" });
  }
});

router.get("/postcode-location", async (req, res) => {
  try {
    const postcode = String(req.query.postcode || "").trim();
    if (!postcode) {
      return res.status(400).json({ ok: false, error: "Postcode is required" });
    }

    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    const result = payload.result || {};

    if (!response.ok || payload.status !== 200 || !Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
      return res.status(response.status || 404).json({ ok: false, error: "Postcode not found" });
    }

    return res.json({
      ok: true,
      postcode: result.postcode,
      latitude: result.latitude,
      longitude: result.longitude,
    });
  } catch (err) {
    console.error("Postcode location lookup error:", err.message || err);
    return res.status(500).json({ ok: false, error: "Failed to locate postcode" });
  }
});

module.exports = router;
