// routes/vsa.js
const express = require("express");
const fetch = require("node-fetch");
const router = express.Router();

/**
 * 🧩 Virtual Sales Assistant backend bridge
 * Takes user messages and queries existing NetSuite proxy routes
 */
router.post("/query", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

    const msg = message.toLowerCase();
    let responseText = "I'm not sure what you mean — try asking about orders, stock, or deposits.";

    // === Example intents ===
    if (msg.includes("order")) {
      // 🔹 Fetch recent sales orders
      const r = await fetch("http://localhost:3000/api/netsuite/order-management");
      const data = await r.json();

      if (data?.results?.length) {
        const first = data.results.slice(0, 3);
        const list = first.map(o => `• ${o["Document Number"] || o.id} — ${o["Customer"] || "Unknown"}`).join("\n");
        responseText = `Here are the latest orders:\n${list}`;
      } else {
        responseText = "No recent orders found.";
      }
    } 
    else if (msg.includes("inventory") || msg.includes("stock")) {
      // 🔹 Fetch sample inventory balance
      const r = await fetch("http://localhost:3000/api/netsuite/inventorybalance");
      const data = await r.json();

      if (data?.results?.length) {
        const item = data.results[0];
        responseText = `Example inventory item: ${item["Item Name"] || "Unknown"} — ${item["Available"] || 0} units.`;
      } else {
        responseText = "I couldn't find any inventory data.";
      }
    } 
    else if (msg.includes("deposit")) {
      // 🔹 Customer deposits
      const r = await fetch("http://localhost:3000/api/netsuite/customer-deposits");
      const data = await r.json();
      responseText = data?.results?.length
        ? `Found ${data.results.length} customer deposits.`
        : "No deposits currently available.";
    }

    return res.json({ ok: true, reply: responseText });
  } catch (err) {
    console.error("❌ VSA error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
