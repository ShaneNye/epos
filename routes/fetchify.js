// routes/fetchify.js
const express = require("express");
const router = express.Router();

const FETCHIFY_KEY = "df395-d4c3d-ce73c-098d7"; // your 20-char access key

router.get("/postcode/:code", async (req, res) => {
  try {
    const postcode = req.params.code.trim().replace(/\s+/g, "").toUpperCase();
    const url = "https://pcls1.craftyclicks.co.uk/json/rapidaddress";

    const body = {
      key: FETCHIFY_KEY,
      postcode,
      response: "data_formatted",
      lines: "3"
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    //console.log("🔎 Raw Fetchify response:", text);

    const data = JSON.parse(text);

    if (!data.delivery_points || !Array.isArray(data.delivery_points)) {
      return res.status(500).json({ error: "Unexpected response format" });
    }

    // Normalise each address
    const addresses = data.delivery_points.map(dp => ({
      line_1: dp.line_1 || "",
      line_2: dp.line_2 || "",
      line_3: dp.line_3 || data.town || "",
      county: data.postal_county || data.traditional_county || "",
      postcode: data.postcode || ""
    }));

    res.json({ addresses });
  } catch (err) {
    console.error("❌ Fetchify (CraftyClicks) proxy error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

module.exports = router;
