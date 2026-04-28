const express = require("express");
const pool = require("../db");
const { getSession, updateSessionRole } = require("../sessions");

const router = express.Router();

// Get active role
router.get("/", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const token = auth.split(" ")[1];
  const session = await getSession(token);
  if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

  res.json({ ok: true, role: session.activeRole?.name || session.activeRole || null });
});

// Set active role
router.post("/", express.json(), async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const token = auth.split(" ")[1];
  const session = await getSession(token);
  if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

  const role = String(req.body?.role || "").trim();
  if (!role) return res.status(400).json({ ok: false, error: "Missing role" });

  if (!Array.isArray(session.roles) || !session.roles.includes(role)) {
    return res.status(403).json({ ok: false, error: "Role is not assigned to this user" });
  }

  try {
    const result = await pool.query(
      "SELECT access FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [role]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Role not found" });
    }

    const rawAccess = result.rows[0].access;
    let access = [];

    if (Array.isArray(rawAccess)) {
      access = rawAccess;
    } else if (typeof rawAccess === "string") {
      try {
        access = JSON.parse(rawAccess || "[]");
      } catch {
        access = [];
      }
    }

    const updated = await updateSessionRole(token, role, access);
    if (!updated) {
      return res.status(500).json({ ok: false, error: "Failed to update session role" });
    }

    res.json({ ok: true, role });
  } catch (err) {
    console.error("Failed to set active role:", err.message);
    res.status(500).json({ ok: false, error: "Failed to update role" });
  }
});

module.exports = router;
