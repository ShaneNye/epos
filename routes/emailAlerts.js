const express = require("express");
const { getSession } = require("../sessions");
const {
  getEmailAlertUserIds,
  saveEmailAlertUserIds,
} = require("../utils/salesQuoteEmailAlerts");

const router = express.Router();

async function requireSession(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Missing session token" });
    const session = await getSession(token);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });
    req.session = session;
    next();
  } catch (err) {
    res.status(401).json({ ok: false, error: "Invalid session" });
  }
}

router.get("/settings", requireSession, async (req, res) => {
  try {
    const recipientUserIds = await getEmailAlertUserIds();
    res.json({ ok: true, recipientUserIds });
  } catch (err) {
    console.error("GET /api/email-alerts/settings failed:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load email alert settings" });
  }
});

router.put("/settings", requireSession, async (req, res) => {
  try {
    const recipientUserIds = await saveEmailAlertUserIds(req.body?.recipientUserIds || []);
    res.json({ ok: true, recipientUserIds });
  } catch (err) {
    console.error("PUT /api/email-alerts/settings failed:", err.message);
    res.status(400).json({ ok: false, error: err.message || "Failed to save email alert settings" });
  }
});

module.exports = router;
