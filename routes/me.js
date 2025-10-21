// routes/me.js
const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing token" });
    }

    //console.log("🟢 /api/me: Checking token", token);
    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    // ✅ Include primary store/location in query
    const [[u]] = await pool.query(
      `SELECT 
          id, 
          email, 
          firstName, 
          lastName, 
          profileImage, 
          location_id AS primaryStore
       FROM users
       WHERE id = ?`,
      [session.id]
    );

    if (!u) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    // 🔐 Always refresh roles from junction table
    const [roleRows] = await pool.query(
      `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
        ORDER BY r.id`,
      [u.id]
    );

    const roles = roleRows.map((r) => r.name);
    //console.log("✅ /api/me roles (fresh from DB):", roles);

    // ✅ Return user object with primaryStore included
    return res.json({
      ok: true,
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        profileImage: u.profileImage,
        roles,
        primaryStore: u.primaryStore || null, // ✅ added field
      },
      activeRole: session.activeRole?.name || null,
    });
  } catch (err) {
    console.error("❌ /api/me error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
