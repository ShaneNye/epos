const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const router = express.Router();
const { getSession } = require("../sessions");


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
router.put("/self-update", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

    const session = await getSession(token);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

    const userId = session.id;

    // ✅ Prefer role sent from client (because your UI role switch is client-driven)
    // Fallback to server session role if not sent
    const requestedRole =
      (req.body?.activeRole || "").trim() ||
      (session.activeRole?.name || "").trim();

    if (!requestedRole) {
      return res.status(400).json({ ok: false, error: "Missing active role" });
    }

    // ✅ Validate the user actually has this role
    const roleCheck = await pool.query(
      `SELECT 1
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1 AND r.name = $2
        LIMIT 1`,
      [userId, requestedRole]
    );

    if (roleCheck.rowCount === 0) {
      return res.status(403).json({
        ok: false,
        error: "Active role is not assigned to this user",
      });
    }

    // Allowed fields for that role
    const rulesRes = await pool.query(
      `SELECT field_name
         FROM user_management_rules
        WHERE TRIM(role_name) = $1 AND allowed = TRUE`,
      [requestedRole]
    );

    const allowedRaw = rulesRes.rows.map(r => r.field_name);

    // Normalize allowed fields (support camelCase or db cols)
    const allowedDb = new Set();
    for (const f of allowedRaw) {
      if (f === "firstName") allowedDb.add("firstname");
      else if (f === "lastName") allowedDb.add("lastname");
      else if (f === "profileImage") allowedDb.add("profileimage");
      else if (f === "primaryStore") allowedDb.add("location_id");
      else if (f === "locationId") allowedDb.add("location_id");
      else if (f === "netsuiteId") allowedDb.add("netsuiteid");
      else if (f === "invoiceLocationId") allowedDb.add("invoicelocationid");
      else allowedDb.add(f);
    }

    const body = req.body || {};

    const candidateUpdates = {
      email: body.email,
      firstname: body.firstname ?? body.firstName,
      lastname: body.lastname ?? body.lastName,
      profileimage: body.profileimage ?? body.profileImage,
      netsuiteid: body.netsuiteid ?? body.netsuiteId,
      invoicelocationid: body.invoicelocationid ?? body.invoiceLocationId,
      location_id: body.location_id ?? body.locationId ?? body.primaryStore,
      themehex: body.themehex,
    };

    const updates = {};
    for (const [k, v] of Object.entries(candidateUpdates)) {
      if (!allowedDb.has(k)) continue;
      if (v === undefined) continue;
      updates[k] = (v === "" ? null : v);
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return res.json({
        ok: false,
        error: "No allowed fields to update (check role rules / payload keys)",
        debug: {
          role: requestedRole,
          allowedRaw,
          allowedDb: Array.from(allowedDb),
          receivedKeys: Object.keys(body),
        },
      });
    }

    const setClauses = keys.map((col, i) => `${col} = $${i + 1}`).join(", ");
    const values = keys.map(k => updates[k]);

    const result = await pool.query(
      `UPDATE users
          SET ${setClauses}
        WHERE id = $${values.length + 1}
      RETURNING id, email, firstname, lastname, profileimage, location_id, netsuiteid, invoicelocationid`,
      [...values, userId]
    );

    const u = result.rows[0];

    return res.json({
      ok: true,
      updated: keys,
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstname,
        lastName: u.lastname,
        profileImage: u.profileimage,
        primaryStore: u.location_id || null,
        netsuiteId: u.netsuiteid || null,
        invoiceLocationId: u.invoicelocationid || null,
      },
    });
  } catch (err) {
    console.error("❌ PUT /api/users/self-update failed:", err);
    res.status(500).json({ ok: false, error: "Server error" });
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
