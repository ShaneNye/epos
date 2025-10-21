const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const router = express.Router();

/* -------------------- Helper -------------------- */
function maskUser(u) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    netsuiteId: u.netsuiteId, // ✅ new field
    profileImage: u.profileImage,
    createdAt: u.createdAt,
    roles: u.roles || [],
    location: u.location_id
      ? { id: u.location_id, name: u.location_name, netsuite_internal_id: u.netsuite_internal_id }
      : null,
    sb_netsuite_token_id: u.sb_netsuite_token_id ? "************" : null,
    sb_netsuite_token_secret: u.sb_netsuite_token_secret ? "************" : null,
    prod_netsuite_token_id: u.prod_netsuite_token_id ? "************" : null,
    prod_netsuite_token_secret: u.prod_netsuite_token_secret ? "************" : null,
  };
}

/* -------------------- GET all users -------------------- */
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.id, u.email, u.firstName, u.lastName, u.netsuiteId, u.profileImage, u.createdAt,
        u.location_id, l.name AS location_name, l.netsuite_internal_id,
        GROUP_CONCAT(DISTINCT r.name ORDER BY r.id) AS role_names,
        GROUP_CONCAT(DISTINCT r.id ORDER BY r.id) AS role_ids,
        u.sb_netsuite_token_id, u.sb_netsuite_token_secret,
        u.prod_netsuite_token_id, u.prod_netsuite_token_secret
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON ur.role_id = r.id
      LEFT JOIN locations l ON u.location_id = l.id
      GROUP BY u.id
      ORDER BY u.lastName, u.firstName
    `);

    const users = rows.map(u =>
      maskUser({
        ...u,
        roles: u.role_ids
          ? u.role_ids.split(",").map((id, i) => ({
              id: parseInt(id),
              name: u.role_names.split(",")[i],
            }))
          : [],
      })
    );

    res.json({ ok: true, users });
  } catch (err) {
    console.error("GET /api/users failed:", err);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

/* -------------------- GET single user -------------------- */
router.get("/:id", async (req, res) => {
  try {
    const [[user]] = await pool.query(
      `
      SELECT 
        u.*, 
        l.name AS location_name, 
        l.netsuite_internal_id
      FROM users u
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE u.id = ?
      `,
      [req.params.id]
    );

    if (!user)
      return res.status(404).json({ ok: false, message: "User not found" });

    const [roleRows] = await pool.query(
      `
      SELECT r.id, r.name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = ?
      `,
      [req.params.id]
    );

    user.roles = Array.isArray(roleRows) ? roleRows : [];

    res.json({ ok: true, user: maskUser(user) });
  } catch (err) {
    console.error("GET /api/users/:id failed:", err);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

/* -------------------- CREATE user -------------------- */
router.post("/", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      email,
      password,
      firstName,
      lastName,
      netsuiteId, // ✅ new field
      role_ids = [],
      location_id,
      profileImage,
      sb_netsuite_token_id,
      sb_netsuite_token_secret,
      prod_netsuite_token_id,
      prod_netsuite_token_secret,
    } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "Email and password required" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await conn.query(
      `
      INSERT INTO users
      (email, password_hash, firstName, lastName, netsuiteId, location_id, profileImage,
       sb_netsuite_token_id, sb_netsuite_token_secret,
       prod_netsuite_token_id, prod_netsuite_token_secret)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        email,
        passwordHash,
        firstName,
        lastName,
        netsuiteId || null,
        location_id || null,
        profileImage || null,
        sb_netsuite_token_id || null,
        sb_netsuite_token_secret || null,
        prod_netsuite_token_id || null,
        prod_netsuite_token_secret || null,
      ]
    );

    const userId = result.insertId;

    if (Array.isArray(role_ids) && role_ids.length > 0) {
      for (const roleId of role_ids) {
        await conn.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
          userId,
          roleId,
        ]);
      }
    }

    await conn.commit();
    res.json({ ok: true, id: userId });
  } catch (err) {
    await conn.rollback();
    console.error("POST /api/users failed:", err);
    res.status(500).json({ ok: false, error: "DB error" });
  } finally {
    conn.release();
  }
});

/* -------------------- UPDATE user -------------------- */
router.put("/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      email,
      password,
      firstName,
      lastName,
      netsuiteId, // ✅ new field
      role_ids = [],
      location_id,
      profileImage,
      sb_netsuite_token_id,
      sb_netsuite_token_secret,
      prod_netsuite_token_id,
      prod_netsuite_token_secret,
    } = req.body;

    const updates = {
      email,
      firstName,
      lastName,
      netsuiteId: netsuiteId || null, // ✅ include field
      location_id: location_id || null,
      profileImage,
    };

    if (password)
      updates.password_hash = await bcrypt.hash(password, 10);

    if (sb_netsuite_token_id !== undefined)
      updates.sb_netsuite_token_id = sb_netsuite_token_id || null;
    if (sb_netsuite_token_secret !== undefined)
      updates.sb_netsuite_token_secret = sb_netsuite_token_secret || null;
    if (prod_netsuite_token_id !== undefined)
      updates.prod_netsuite_token_id = prod_netsuite_token_id || null;
    if (prod_netsuite_token_secret !== undefined)
      updates.prod_netsuite_token_secret = prod_netsuite_token_secret || null;

    const fields = Object.keys(updates)
      .map((k) => `${k}=?`)
      .join(", ");
    const values = Object.values(updates);

    await conn.query(`UPDATE users SET ${fields} WHERE id=?`, [
      ...values,
      req.params.id,
    ]);

    await conn.query("DELETE FROM user_roles WHERE user_id=?", [req.params.id]);
    if (Array.isArray(role_ids) && role_ids.length > 0) {
      for (const roleId of role_ids) {
        await conn.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
          req.params.id,
          roleId,
        ]);
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error("PUT /api/users/:id failed:", err);
    res.status(500).json({ ok: false, error: "DB error" });
  } finally {
    conn.release();
  }
});

/* -------------------- DELETE user -------------------- */
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/users/:id failed:", err);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

module.exports = router;
