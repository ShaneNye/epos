const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const router = express.Router();

/* -------------------- Helper -------------------- */
function maskUser(u) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstname,
    lastName: u.lastname,
    netsuiteId: u.netsuiteid,
    profileImage: u.profileimage,
    createdAt: u.createdat,
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
const result = await pool.query(`
  SELECT 
    u.id, u.email, u.firstname, u.lastname, u.netsuiteid, u.profileimage, u.createdat,
    u.location_id, l.name AS location_name, l.netsuite_internal_id,
    STRING_AGG(r.name, ',' ORDER BY r.id) AS role_names,
    STRING_AGG(r.id::text, ',' ORDER BY r.id) AS role_ids,
    u.sb_netsuite_token_id, u.sb_netsuite_token_secret,
    u.prod_netsuite_token_id, u.prod_netsuite_token_secret
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON ur.role_id = r.id
  LEFT JOIN locations l ON u.location_id = l.id
  GROUP BY u.id, l.name, l.netsuite_internal_id
  ORDER BY u.lastname, u.firstname;
`);


    const users = result.rows.map(u =>
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
    console.error("GET /api/users failed:", err.message);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

/* -------------------- GET single user -------------------- */
router.get("/:id", async (req, res) => {
  try {
    const userResult = await pool.query(
      `
      SELECT 
        u.*, 
        l.name AS location_name, 
        l.netsuite_internal_id
      FROM users u
      LEFT JOIN locations l ON u.location_id = l.id
      WHERE u.id = $1
      `,
      [req.params.id]
    );

    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const rolesResult = await pool.query(
      `
      SELECT r.id, r.name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
      `,
      [req.params.id]
    );

    user.roles = rolesResult.rows;
    res.json({ ok: true, user: maskUser(user) });
  } catch (err) {
    console.error("GET /api/users/:id failed:", err.message);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

/* -------------------- CREATE user -------------------- */
router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      email,
      password,
      firstName,
      lastName,
      netsuiteId,
      role_ids = [],
      location_id,
      profileImage,
      sb_netsuite_token_id,
      sb_netsuite_token_secret,
      prod_netsuite_token_id,
      prod_netsuite_token_secret,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const insertResult = await client.query(
      `
      INSERT INTO users
      (email, password_hash, firstname, lastname, netsuiteid, location_id, profileimage,
       sb_netsuite_token_id, sb_netsuite_token_secret,
       prod_netsuite_token_id, prod_netsuite_token_secret)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id;
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

    const userId = insertResult.rows[0].id;

    if (Array.isArray(role_ids) && role_ids.length > 0) {
      for (const roleId of role_ids) {
        await client.query(
          "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
          [userId, roleId]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, id: userId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/users failed:", err.message);
    res.status(500).json({ ok: false, error: "DB error" });
  } finally {
    client.release();
  }
});

/* -------------------- UPDATE user -------------------- */
router.put("/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      email,
      password,
      firstName,
      lastName,
      netsuiteId,
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
      firstname: firstName,
      lastname: lastName,
      netsuiteid: netsuiteId || null,
      location_id: location_id || null,
      profileimage: profileImage,
      sb_netsuite_token_id: sb_netsuite_token_id || null,
      sb_netsuite_token_secret: sb_netsuite_token_secret || null,
      prod_netsuite_token_id: prod_netsuite_token_id || null,
      prod_netsuite_token_secret: prod_netsuite_token_secret || null,
    };

    if (password) updates.password_hash = await bcrypt.hash(password, 10);

    const setClauses = Object.keys(updates)
      .map((key, i) => `${key} = $${i + 1}`)
      .join(", ");
    const values = Object.values(updates);

    await client.query(
      `UPDATE users SET ${setClauses} WHERE id = $${values.length + 1}`,
      [...values, req.params.id]
    );

    await client.query("DELETE FROM user_roles WHERE user_id = $1", [req.params.id]);
    if (Array.isArray(role_ids) && role_ids.length > 0) {
      for (const roleId of role_ids) {
        await client.query(
          "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
          [req.params.id, roleId]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/users/:id failed:", err.message);
    res.status(500).json({ ok: false, error: "DB error" });
  } finally {
    client.release();
  }
});

/* -------------------- DELETE user -------------------- */
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/users/:id failed:", err.message);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

module.exports = router;
