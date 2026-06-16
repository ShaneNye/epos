const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const router = express.Router();
const { getSession } = require("../sessions");
const { clearUserTokenCache } = require("../netsuiteClient");
const {
  cleanupExpiredUserStatuses,
  ensureUserStatusColumn,
  normalizeStatusEmoji,
  normalizeStatusText,
  normalizeUserStatus,
  statusExpirySql,
} = require("../utils/userStatus");
const { ensureUserThemeColumns, normalizeHexColor } = require("../utils/userTheme");
const { ensureUserOfficeColumn, normalizeOfficeFlag } = require("../utils/userOffice");


/* -------------------- Helper -------------------- */
function maskUser(u) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstname,
    lastName: u.lastname,
    netsuiteId: u.netsuiteid,
    profileImage: u.profileimage,
    eposStatus: normalizeUserStatus(u.epos_status),
    eposStatusEmoji: u.epos_status_emoji || "",
    eposStatusText: u.epos_status_text || "",
    eposStatusExpiresAt: u.epos_status_expires_at || null,
    themeHex: u.themehex || null,
    themeAccentHex: u.themeaccenthex || null,
    office: Boolean(u.office),
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
    await ensureUserThemeColumns();
    await ensureUserOfficeColumn();
    await cleanupExpiredUserStatuses();
    res.set("Cache-Control", "no-store");
    const result = await pool.query(`
  SELECT 
    u.id, u.email, u.firstname, u.lastname, u.netsuiteid, u.profileimage,
    u.epos_status, u.epos_status_emoji, u.epos_status_text, u.epos_status_expires_at,
    u.themehex, u.themeaccenthex, u.createdat,
    u.office,
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

router.post("/status", async (req, res) => {
  try {
    await cleanupExpiredUserStatuses();
    res.set("Cache-Control", "no-store");

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

    const session = await getSession(token);
    if (!session) return res.status(401).json({ ok: false, error: "Invalid session" });

    const body = req.body || {};
    const status = normalizeUserStatus(body.status || body.epos_status);
    const emoji = normalizeStatusEmoji(body.emoji ?? body.epos_status_emoji);
    const text = normalizeStatusText(body.text ?? body.epos_status_text);
    const clearIfText = normalizeStatusText(body.clearIfText);
    const hasCustomStatus = Boolean(emoji || text);
    const expiresInSeconds = Math.min(
      900,
      Math.max(30, Number(body.expiresInSeconds || 120) || 120)
    );

    if (status === "available" && !hasCustomStatus && clearIfText) {
      const result = await pool.query(
        `UPDATE users
            SET epos_status = 'available',
                epos_status_emoji = NULL,
                epos_status_text = NULL,
                epos_status_expires_at = NULL
          WHERE id = $1
            AND epos_status_text = $2
        RETURNING id, epos_status, epos_status_emoji, epos_status_text, epos_status_expires_at`,
        [session.id, clearIfText]
      );

      const user = result.rows[0];
      return res.json({
        ok: true,
        skipped: !user,
        user: user
          ? {
              id: user.id,
              eposStatus: normalizeUserStatus(user.epos_status),
              eposStatusEmoji: user.epos_status_emoji || "",
              eposStatusText: user.epos_status_text || "",
              eposStatusExpiresAt: user.epos_status_expires_at || null,
            }
          : null,
      });
    }

    const result = await pool.query(
      `UPDATE users
          SET epos_status = $1,
              epos_status_emoji = $2,
              epos_status_text = $3,
              epos_status_expires_at = CASE
                WHEN $4::boolean THEN NOW() + ($5::int * INTERVAL '1 second')
                ELSE NULL
              END
        WHERE id = $6
      RETURNING id, epos_status, epos_status_emoji, epos_status_text, epos_status_expires_at`,
      [
        status,
        hasCustomStatus ? emoji || null : null,
        hasCustomStatus ? text || null : null,
        hasCustomStatus,
        expiresInSeconds,
        session.id,
      ]
    );

    const user = result.rows[0];
    return res.json({
      ok: true,
      user: {
        id: user.id,
        eposStatus: normalizeUserStatus(user.epos_status),
        eposStatusEmoji: user.epos_status_emoji || "",
        eposStatusText: user.epos_status_text || "",
        eposStatusExpiresAt: user.epos_status_expires_at || null,
      },
    });
  } catch (err) {
    console.error("POST /api/users/status failed:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.put("/self-update", async (req, res) => {
  try {
    await ensureUserThemeColumns();
    await ensureUserOfficeColumn();
    await cleanupExpiredUserStatuses();
    res.set("Cache-Control", "no-store");
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
    for (const rawField of allowedRaw) {
      const f = String(rawField || "").trim();
      const normalizedField = f.toLowerCase();
      if (f === "firstName" || normalizedField === "firstname") allowedDb.add("firstname");
      else if (f === "lastName" || normalizedField === "lastname") allowedDb.add("lastname");
      else if (f === "profileImage" || normalizedField === "profileimage") allowedDb.add("profileimage");
      else if (f === "eposStatus" || normalizedField === "epos_status") allowedDb.add("epos_status");
      else if (f === "primaryStore" || f === "locationId" || normalizedField === "primarystore" || normalizedField === "location_id") allowedDb.add("location_id");
      else if (f === "netsuiteId" || normalizedField === "netsuiteid") allowedDb.add("netsuiteid");
      else if (f === "invoiceLocationId" || normalizedField === "invoicelocationid") allowedDb.add("invoicelocationid");
      else if (f === "themeHex" || normalizedField === "themehex") allowedDb.add("themehex");
      else if (f === "themeAccentHex" || normalizedField === "themeaccenthex") allowedDb.add("themeaccenthex");
      else if (f) allowedDb.add(f);
    }

    if (allowedDb.has("themehex")) {
      allowedDb.add("themeaccenthex");
    }

    const body = req.body || {};

    function bodyValue(...keys) {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
      }
      return undefined;
    }

    const candidateUpdates = {
      email: body.email,
      firstname: bodyValue("firstname", "firstName"),
      lastname: bodyValue("lastname", "lastName"),
      profileimage: bodyValue("profileimage", "profileImage"),
      netsuiteid: bodyValue("netsuiteid", "netsuiteId"),
      invoicelocationid: bodyValue("invoicelocationid", "invoiceLocationId"),
      location_id: bodyValue("location_id", "locationId", "primaryStore"),
      themehex: bodyValue("themehex", "themeHex"),
      themeaccenthex: bodyValue("themeaccenthex", "themeAccentHex"),
    };

    if (Object.prototype.hasOwnProperty.call(body, "epos_status") || Object.prototype.hasOwnProperty.call(body, "eposStatus")) {
      candidateUpdates.epos_status = normalizeUserStatus(body.epos_status ?? body.eposStatus);
    }
    if (Object.prototype.hasOwnProperty.call(body, "epos_status_emoji") || Object.prototype.hasOwnProperty.call(body, "eposStatusEmoji")) {
      candidateUpdates.epos_status_emoji = normalizeStatusEmoji(body.epos_status_emoji ?? body.eposStatusEmoji);
    }
    if (Object.prototype.hasOwnProperty.call(body, "epos_status_text") || Object.prototype.hasOwnProperty.call(body, "eposStatusText")) {
      candidateUpdates.epos_status_text = normalizeStatusText(body.epos_status_text ?? body.eposStatusText);
    }

    const updates = {};
    for (const [k, v] of Object.entries(candidateUpdates)) {
      if (!["epos_status", "epos_status_emoji", "epos_status_text"].includes(k) && !allowedDb.has(k)) continue;
      if (v === undefined) continue;
      updates[k] = (v === "" ? null : v);
    }

    for (const colorField of ["themehex", "themeaccenthex"]) {
      if (!Object.prototype.hasOwnProperty.call(updates, colorField)) continue;
      const normalized = normalizeHexColor(updates[colorField]);
      if (normalized === undefined) {
        return res.status(400).json({
          ok: false,
          error: `${colorField} must be a valid hex colour or blank`,
        });
      }
      updates[colorField] = normalized;
    }

    if (
      Object.prototype.hasOwnProperty.call(updates, "epos_status_emoji") ||
      Object.prototype.hasOwnProperty.call(updates, "epos_status_text")
    ) {
      const hasCustomStatus = Boolean(updates.epos_status_emoji || updates.epos_status_text);
      updates.epos_status_expires_at = hasCustomStatus ? { rawSql: statusExpirySql() } : null;
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

    const values = [];
    const setClauses = keys.map((col) => {
      const value = updates[col];
      if (value && typeof value === "object" && value.rawSql) {
        return `${col} = ${value.rawSql}`;
      }
      values.push(value);
      return `${col} = $${values.length}`;
    }).join(", ");

    const result = await pool.query(
      `UPDATE users
          SET ${setClauses}
        WHERE id = $${values.length + 1}
      RETURNING id, email, firstname, lastname, profileimage,
        epos_status, epos_status_emoji, epos_status_text, epos_status_expires_at,
        location_id, netsuiteid, invoicelocationid, themehex, themeaccenthex`,
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
        eposStatus: normalizeUserStatus(u.epos_status),
        eposStatusEmoji: u.epos_status_emoji || "",
        eposStatusText: u.epos_status_text || "",
        eposStatusExpiresAt: u.epos_status_expires_at || null,
        primaryStore: u.location_id || null,
        netsuiteId: u.netsuiteid || null,
        invoiceLocationId: u.invoicelocationid || null,
        themeHex: u.themehex || null,
        themeAccentHex: u.themeaccenthex || null,
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
    await cleanupExpiredUserStatuses();
    await ensureUserOfficeColumn();
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
    await ensureUserOfficeColumn();
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
      office,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const insertResult = await client.query(
      `
      INSERT INTO users
      (email, password_hash, firstname, lastname, netsuiteid, location_id, profileimage,
       office,
       sb_netsuite_token_id, sb_netsuite_token_secret,
       prod_netsuite_token_id, prod_netsuite_token_secret)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        normalizeOfficeFlag(office),
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
    clearUserTokenCache(userId);
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
    await ensureUserOfficeColumn();
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
      office,
    } = req.body;

    const updates = {
      email,
      firstname: firstName,
      lastname: lastName,
      netsuiteid: netsuiteId || null,
      location_id: location_id || null,
      profileimage: profileImage,
      office: normalizeOfficeFlag(office),
    };

    const tokenFields = {
      sb_netsuite_token_id,
      sb_netsuite_token_secret,
      prod_netsuite_token_id,
      prod_netsuite_token_secret,
    };

    for (const [field, value] of Object.entries(tokenFields)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;
      if (value === "************" || value === "") continue;
      updates[field] = value || null;
    }

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
    clearUserTokenCache(req.params.id);
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
    clearUserTokenCache(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/users/:id failed:", err.message);
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

module.exports = router;
