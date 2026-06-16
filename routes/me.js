// routes/me.js
const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");
const {
  cleanupExpiredUserStatuses,
  ensureUserStatusColumn,
  normalizeUserStatus,
} = require("../utils/userStatus");
const { ensureUserThemeColumns } = require("../utils/userTheme");
const { ensureUserOfficeColumn } = require("../utils/userOffice");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await ensureUserThemeColumns();
    await ensureUserOfficeColumn();
    await cleanupExpiredUserStatuses();
    res.set("Cache-Control", "no-store");
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing token" });
    }

    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    // ✅ Fetch user info
    const userResult = await pool.query(
      `SELECT 
          id,
          email,
          firstname,
          lastname,
          profileimage,
          epos_status,
          epos_status_emoji,
          epos_status_text,
          epos_status_expires_at,
          themehex,
          themeaccenthex,
          office,
          location_id AS "primaryStore"
       FROM users
       WHERE id = $1`,
      [session.id]
    );

    const u = userResult.rows[0];
    if (!u) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    // ✅ Refresh roles from junction table
    const roleResult = await pool.query(
      `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
        ORDER BY r.id`,
      [u.id]
    );

    const roles = roleResult.rows.map((r) => r.name);

    // ✅ Return consistent JSON
    return res.json({
      ok: true,
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstname,
        lastName: u.lastname,
        profileImage: u.profileimage,
        eposStatus: normalizeUserStatus(u.epos_status),
        eposStatusEmoji: u.epos_status_emoji || "",
        eposStatusText: u.epos_status_text || "",
        eposStatusExpiresAt: u.epos_status_expires_at || null,
        roles,
        primaryStore: u.primaryStore || null,
        office: Boolean(u.office),
        themeHex: u.themehex || null,
        themeAccentHex: u.themeaccenthex || null,
      },
      activeRole: session.activeRole?.name || null,
    });
  } catch (err) {
    console.error("❌ /api/me error:", err.message);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
