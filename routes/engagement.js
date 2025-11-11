// routes/engagement.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSession } = require("../sessions");

/* =====================================================
   === CREATE NEW ANNOUNCEMENT =========================
   ===================================================== */
router.post("/announcement", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email;
    if (!userEmail) return res.status(401).json({ ok: false, error: "Invalid session" });

    // 🔍 Lookup internal user ID
    const userRes = await pool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [userEmail]);
    if (userRes.rows.length === 0)
      return res.status(404).json({ ok: false, error: "User not found" });

    const userId = userRes.rows[0].id;

    const {
      title,
      message,
      startDate,
      immediate = false,
      endDate = null,
      audience = [],
      analytics = "private",
      sharedWith = []
    } = req.body;

    if (!title || !message)
      return res.status(400).json({ ok: false, error: "Title and message are required" });

    if (!startDate && !immediate)
      return res.status(400).json({ ok: false, error: "Start date or immediate required" });

    const query = `
      INSERT INTO engagement_announcements 
        (title, message, start_date, immediate, end_date, analytics_visibility, audience_roles, shared_with_users, created_by)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id;
    `;

    const values = [
      title,
      message,
      immediate ? new Date().toISOString() : startDate || null,
      immediate,
      endDate || null,
      analytics,
      audience,
      sharedWith,
      userId
    ];

    const result = await pool.query(query, values);
    console.log(`✅ Announcement created by ${userEmail} (ID ${userId}):`, result.rows[0].id);

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("❌ Error creating announcement:", err);
    res.status(500).json({ ok: false, error: "Failed to create announcement" });
  }
});
/* =====================================================
   === GET ANNOUNCEMENTS (Mine / Public / Shared) =======
   ===================================================== */
router.get("/announcements", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email;
    if (!userEmail)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    // 🔍 Lookup internal user ID from email
    const userRes = await pool.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [userEmail]
    );
    if (userRes.rows.length === 0)
      return res.status(404).json({ ok: false, error: "User not found" });

    const userId = userRes.rows[0].id;
    console.log(`🎯 User lookup success: ${userEmail} → ID ${userId}`);

    // Map role names to IDs (safe)
    let userRoleIds = [];
    try {
      const rolesRes = await pool.query("SELECT id, name FROM roles");
      const map = Object.fromEntries(
        rolesRes.rows.map(r => [r.name.trim().toLowerCase(), r.id])
      );
      const rawRoles = Array.isArray(session?.roles) ? session.roles : [];
      userRoleIds = rawRoles
        .map(r => {
          const roleName =
            typeof r === "object"
              ? r.name?.trim().toLowerCase()
              : String(r).trim().toLowerCase();
          return map[roleName];
        })
        .filter(Boolean);
    } catch (roleErr) {
      console.warn("⚠️ Could not map user roles to IDs:", roleErr.message);
    }

    // --- Build SQL and parameters explicitly ---
    let sql;
    let params;

    if (userRoleIds.length > 0) {
      sql = `
        SELECT 
          ea.*,
          u.email AS created_by_email,
          ARRAY(
            SELECT uu.email
            FROM users uu
            WHERE uu.id = ANY(ea.shared_with_users)
          ) AS shared_with_emails
        FROM engagement_announcements ea
        LEFT JOIN users u ON ea.created_by = u.id
        WHERE ea.is_active = TRUE
          AND (
            ea.created_by = $1
            OR ea.analytics_visibility = 'public'
            OR $1 = ANY(ea.shared_with_users)
            OR (
              array_length(ea.audience_roles, 1) > 0
              AND ea.audience_roles && $2::int[]
            )
          )
        ORDER BY ea.created_at DESC;
      `;
      // 👇 force the param type so pg knows it's an integer array
      params = [userId, `{${userRoleIds.join(",")}}`];
    } else {
      sql = `
        SELECT 
          ea.*,
          u.email AS created_by_email,
          ARRAY(
            SELECT uu.email
            FROM users uu
            WHERE uu.id = ANY(ea.shared_with_users)
          ) AS shared_with_emails
        FROM engagement_announcements ea
        LEFT JOIN users u ON ea.created_by = u.id
        WHERE ea.is_active = TRUE
          AND (
            ea.created_by = $1
            OR ea.analytics_visibility = 'public'
            OR $1 = ANY(ea.shared_with_users)
          )
        ORDER BY ea.created_at DESC;
      `;
      params = [userId];
    }

    const result = await pool.query(sql, params);
    console.log(
      `📦 Announcements fetched for ${userEmail} (ID ${userId}): ${result.rows.length} found`
    );

    res.json({ ok: true, announcements: result.rows });
  } catch (err) {
    console.error("❌ Error fetching announcements:", err);
    res
      .status(500)
      .json({ ok: false, error: "Failed to fetch announcements" });
  }
});

/* =====================================================
   === GET SINGLE ANNOUNCEMENT BY ID ====================
   ===================================================== */
router.get("/announcement/:id", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    if (!session?.email)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    const { id } = req.params;

    const sql = `
      SELECT 
        ea.*,
        u.email AS created_by_email,
        ARRAY(
          SELECT uu.email
          FROM users uu
          WHERE uu.id = ANY(ea.shared_with_users)
        ) AS shared_with_emails
      FROM engagement_announcements ea
      LEFT JOIN users u ON ea.created_by = u.id
      WHERE ea.id = $1;
    `;

    const result = await pool.query(sql, [id]);

    if (!result.rows.length)
      return res.status(404).json({ ok: false, error: "Announcement not found" });

    res.json({ ok: true, announcement: result.rows[0] });
  } catch (err) {
    console.error("❌ Error fetching announcement by ID:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch announcement" });
  }
});

/* =====================================================
   === UPDATE EXISTING ANNOUNCEMENT =====================
   ===================================================== */
router.put("/announcement/:id", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email;
    if (!userEmail)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    const { id } = req.params;
    const {
      title,
      message,
      startDate,
      immediate = false,
      endDate = null,
      audience = [],
      analytics = "private",
      sharedWith = [],
    } = req.body;

    if (!title || !message)
      return res
        .status(400)
        .json({ ok: false, error: "Title and message are required" });

    const query = `
      UPDATE engagement_announcements
      SET
        title = $1,
        message = $2,
        start_date = $3,
        immediate = $4,
        end_date = $5,
        analytics_visibility = $6,
        audience_roles = $7,
        shared_with_users = $8,
        updated_at = NOW()
      WHERE id = $9
      RETURNING id;
    `;

    const values = [
      title,
      message,
      immediate ? new Date().toISOString() : startDate || null,
      immediate,
      endDate || null,
      analytics,
      audience,
      sharedWith,
      id,
    ];

    const result = await pool.query(query, values);

    if (!result.rowCount)
      return res.status(404).json({ ok: false, error: "Announcement not found" });

    console.log(`✏️ Updated announcement ID ${id}`);
    res.json({ ok: true, id });
  } catch (err) {
    console.error("❌ Error updating announcement:", err);
    res.status(500).json({ ok: false, error: "Failed to update announcement" });
  }
});


/* =====================================================
   === DELETE ANNOUNCEMENT ==============================
   ===================================================== */
router.delete("/announcement/:id", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    if (!session?.email)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM engagement_announcements WHERE id = $1 RETURNING id;",
      [id]
    );

    if (!result.rowCount)
      return res
        .status(404)
        .json({ ok: false, error: "Announcement not found" });

    console.log(`🗑️ Deleted announcement ID ${id}`);
    res.json({ ok: true, id });
  } catch (err) {
    console.error("❌ Error deleting announcement:", err);
    res.status(500).json({ ok: false, error: "Failed to delete announcement" });
  }
});

/* =====================================================
   === GET ACTIVE ANNOUNCEMENTS FOR CURRENT USER ========
   ===================================================== */
router.get("/active", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email?.trim().toLowerCase();
    const activeRoleName = session?.activeRole?.name;

    if (!userEmail)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    // === Get user and role IDs ===
    const userRes = await pool.query(
      "SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [userEmail]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ ok: false, error: "User not found" });
    const userId = userRes.rows[0].id;

    const roleRes = await pool.query(
      "SELECT id FROM roles WHERE name = $1 LIMIT 1",
      [activeRoleName]
    );
    const roleId = roleRes.rows.length ? roleRes.rows[0].id : null;

    // === Fetch announcements ===
    const sql = `
      SELECT ea.*, u.email AS created_by_email
      FROM engagement_announcements ea
      LEFT JOIN users u ON ea.created_by = u.id
      WHERE ea.is_active = TRUE
        AND (
          ea.analytics_visibility = 'public'
          OR $2 = ANY(ea.audience_roles)
        )
        AND ea.start_date <= NOW()
        AND (ea.end_date IS NULL OR ea.end_date >= NOW())
        AND ea.id NOT IN (
          SELECT announcement_id
          FROM engagement_acknowledgements
          WHERE user_id = $1
        )
      ORDER BY ea.start_date DESC;
    `;
    const announcements = (await pool.query(sql, [userId, roleId])).rows;

    // === Look up proper name for each creator ===
    for (const a of announcements) {
      if (!a.created_by_email) continue;
      const cleanEmail = a.created_by_email.trim().toLowerCase();

      console.log(`🔎 Checking creator: ${a.created_by_email} (normalized: ${cleanEmail})`);

      const nameRes = await pool.query(
        `SELECT firstname, lastname, email 
         FROM users 
         WHERE LOWER(TRIM(email)) = $1 
         LIMIT 1;`,
        [cleanEmail]
      );

      if (nameRes.rows.length) {
        const u = nameRes.rows[0];
        const fname = u.firstname?.trim() || "";
        const lname = u.lastname?.trim() || "";
        const finalName =
          fname || lname
            ? `${fname} ${lname}`.trim()
            : u.email.split("@")[0];
        a.created_by_name = finalName;

        console.log(
          `✅ Matched user for ${cleanEmail}: firstname="${fname}", lastname="${lname}", final="${finalName}"`
        );
      } else {
        a.created_by_name = cleanEmail.split("@")[0];
        console.log(`⚠️ No match found for ${cleanEmail}, fallback to prefix.`);
      }
    }

    console.log(
      `📢 Active announcements fetched for ${userEmail} (${activeRoleName || "No Role"}): ${announcements.length} found`
    );

    res.json({ ok: true, announcements });
  } catch (err) {
    console.error("❌ Error fetching active announcements:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch announcements" });
  }
});


/* =====================================================
   === ACKNOWLEDGE ANNOUNCEMENT =========================
   ===================================================== */
router.post("/acknowledge/:id", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email;
    const roleName = session?.activeRole?.name;

    if (!userEmail)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    const userRes = await pool.query("SELECT id FROM users WHERE email = $1", [userEmail]);
    if (userRes.rows.length === 0)
      return res.status(404).json({ ok: false, error: "User not found" });
    const userId = userRes.rows[0].id;

    const roleRes = await pool.query("SELECT id FROM roles WHERE name = $1", [roleName]);
    const roleId = roleRes.rows.length ? roleRes.rows[0].id : null;

    await pool.query(
      `INSERT INTO engagement_acknowledgements (announcement_id, user_id, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (announcement_id, user_id) DO NOTHING;`,
      [req.params.id, userId, roleId]
    );

    console.log(`✅ User ${userEmail} acknowledged announcement ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error acknowledging announcement:", err);
    res.status(500).json({ ok: false, error: "Failed to acknowledge announcement" });
  }
});
/* =====================================================
   === GET ANNOUNCEMENT ANALYTICS ======================
   ===================================================== */
router.get("/analytics/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Get audience roles for this announcement
    const annSql = `
      SELECT id, audience_roles
      FROM engagement_announcements
      WHERE id = $1;
    `;
    const annRes = await pool.query(annSql, [id]);
    if (!annRes.rows.length)
      return res.status(404).json({ ok: false, error: "Announcement not found" });

    const announcement = annRes.rows[0];
    const audienceRoles = announcement.audience_roles || [];

    // 2️⃣ Get all users assigned to those roles
    const usersSql = `
      SELECT DISTINCT u.id, u.firstname, u.lastname, u.email, r.name AS role_name
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.role_id = ANY($1::int[]);
    `;
    const usersRes = await pool.query(usersSql, [audienceRoles]);

    // 3️⃣ Get all acknowledgements (user_id, role_id)
    const ackSql = `
      SELECT user_id, role_id
      FROM engagement_acknowledgements
      WHERE announcement_id = $1;
    `;
    const ackRes = await pool.query(ackSql, [id]);
    const acknowledgedUsers = [...new Set(ackRes.rows.map(r => r.user_id))]; // ✅ unique users

    // 4️⃣ Merge data — mark user acknowledged if *any* of their roles acknowledged
    const users = usersRes.rows.map(u => ({
      id: u.id,
      name: `${u.firstname ?? ""} ${u.lastname ?? ""}`.trim() || u.email,
      email: u.email,
      role: u.role_name,
      acknowledged: acknowledgedUsers.includes(u.id)
    }));

    // 5️⃣ Calculate totals
    const total = users.length;
    const acknowledgedCount = users.filter(u => u.acknowledged).length;
    const percentage = total ? Math.round((acknowledgedCount / total) * 100) : 0;

    console.log(
      `📊 Analytics for announcement ${id}: ${acknowledgedCount}/${total} acknowledged (${percentage}%)`
    );

    res.json({
      ok: true,
      total,
      acknowledgedCount,
      percentage,
      users,
    });
  } catch (err) {
    console.error("❌ Error fetching announcement analytics:", err);
    res.status(500).json({ ok: false, error: "Failed to load analytics" });
  }
});




module.exports = router;
