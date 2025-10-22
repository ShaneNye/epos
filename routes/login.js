// routes/login.js
const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const { createSession } = require("../sessions");

const router = express.Router();

router.post("/", async (req, res) => {
  const { username, password, env } = req.body || {};
  console.log("🟢 Login attempt:", { username, env });

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "Missing username or password." });
  }

  try {
    // 1) Fetch user by email
    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [username]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ ok: false, message: "Invalid username or password." });
    }

    // 2) Validate password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ ok: false, message: "Invalid username or password." });
    }

    // 3) Roles from junction table
    const rolesResult = await pool.query(
      `SELECT r.name 
         FROM user_roles ur 
         JOIN roles r ON r.id = ur.role_id 
        WHERE ur.user_id = $1 
        ORDER BY r.id`,
      [user.id]
    );
    const userRoles = rolesResult.rows.map((r) => r.name);
    console.log("👤 Roles via user_roles:", userRoles);

    // 4) Pick default active role
    const activeRoleName = userRoles[0] || null;

    // 5) Access list for that active role
    let access = [];
    if (activeRoleName) {
      const roleMetaResult = await pool.query(
        "SELECT access FROM roles WHERE LOWER(name)=LOWER($1) LIMIT 1",
        [activeRoleName]
      );
      const roleMeta = roleMetaResult.rows[0];
      if (roleMeta) {
        try {
          access = Array.isArray(roleMeta.access)
            ? roleMeta.access
            : JSON.parse(roleMeta.access || "[]");
        } catch {
          access = [];
        }
      }
    }

    // 6) Create session
    const token = await createSession(
      {
        id: user.id,
        email: user.email,
        firstName: user.firstname,
        lastName: user.lastname,
        roles: userRoles,
        primaryStore: user.location_id || null,
        profileImage: user.profileimage || null,
      },
      activeRoleName,
      access
    );

    console.log("✅ Session created with role:", activeRoleName);
    res.json({ ok: true, token, redirect: "/home.html" });
  } catch (err) {
    console.error("❌ Login route error:", err.message);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;
