const express = require("express");
const { getSession } = require("../sessions");

const router = express.Router();

// Get active role
router.get("/", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const token = auth.split(" ")[1];
  const session = getSession(token);
  if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

  res.json({ ok: true, role: session.activeRole || null });
});

// Set active role
router.post("/", express.json(), (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const token = auth.split(" ")[1];
  const session = getSession(token);
  if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

  const { role } = req.body;
  if (!role) return res.status(400).json({ ok: false, error: "Missing role" });

  session.activeRole = role;
  res.json({ ok: true });
});

module.exports = router;
