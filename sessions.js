// sessions.js
const crypto = require("crypto");
const pool = require("./db");

const SESSION_TTL_DAYS = 7; // expire sessions after 7 days

/**
 * Normalize role names (trim + consistent capitalization)
 */
function normalizeRoleName(name) {
  if (!name) return null;
  return name.trim(); // keep original case (DB “Admin”, “Sales Executive”, etc.)
}

/**
 * Create a session for the given user.
 */
async function createSession(user, activeRoleName = null, access = []) {
  const token = crypto.randomUUID();
  const activeRole = normalizeRoleName(activeRoleName);

  const sessionData = {
    id: user.id,
    email: user.email,
    name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
    roles: (user.roles || []).map(normalizeRoleName),
    activeRole: {
      name: activeRole,
      access: Array.isArray(access) ? access : [],
    },
    createdAt: Date.now(),
  };

  try {
    await pool.query(
      `INSERT INTO sessions (token, user_id, data) VALUES (?, ?, ?)`,
      [token, user.id, JSON.stringify(sessionData)]
    );
    console.log("✅ Session inserted into DB for user:", user.email);
    console.log("   ▶ Active Role:", activeRole);
    return token;
  } catch (err) {
    console.error("❌ Error creating session:", err);
    throw err;
  }
}

/**
 * Retrieve an active session by token.
 */
async function getSession(token) {
  try {
    const [rows] = await pool.query(
      `SELECT data, created_at FROM sessions WHERE token = ?`,
      [token]
    );
    if (!rows.length) {
      console.warn("⚠️ No session found for token:", token);
      return null;
    }

    const record = rows[0];
    let session;

    if (typeof record.data === "object") {
      session = record.data;
    } else {
      try {
        session = JSON.parse(record.data);
      } catch (parseErr) {
        console.error("❌ Failed to parse session JSON:", parseErr);
        return null;
      }
    }

    // Expire old sessions
    const ageDays =
      (Date.now() - new Date(record.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > SESSION_TTL_DAYS) {
      console.warn("⚠️ Session expired, deleting:", token);
      await destroySession(token);
      return null;
    }

    // Normalize all stored roles
    if (Array.isArray(session.roles)) {
      session.roles = session.roles.map(normalizeRoleName);
    }

    if (session.activeRole?.name) {
      session.activeRole.name = normalizeRoleName(session.activeRole.name);
    }

    return session;
  } catch (err) {
    console.error("❌ Error fetching session:", err);
    return null;
  }
}

/**
 * Update the active role and its access list for a session.
 */
async function updateSessionRole(token, roleName, access = []) {
  try {
    const [rows] = await pool.query(`SELECT data FROM sessions WHERE token = ?`, [token]);
    if (!rows.length) return false;

    let session;
    if (typeof rows[0].data === "object") {
      session = rows[0].data;
    } else {
      session = JSON.parse(rows[0].data);
    }

    // Normalize role
    const normalizedRole = normalizeRoleName(roleName);

    session.activeRole = {
      name: normalizedRole,
      access: Array.isArray(access) ? access : [],
    };

    // Ensure roles array contains normalized names
    if (Array.isArray(session.roles)) {
      session.roles = session.roles.map(normalizeRoleName);
    }

    await pool.query(`UPDATE sessions SET data = ? WHERE token = ?`, [
      JSON.stringify(session),
      token,
    ]);

    console.log(`🎯 Session role updated for token ${token}: ${normalizedRole}`);
    return true;
  } catch (err) {
    console.error("❌ Error updating session role:", err);
    return false;
  }
}

/**
 * Destroy a session (logout).
 */
async function destroySession(token) {
  try {
    await pool.query(`DELETE FROM sessions WHERE token = ?`, [token]);
    console.log("🧹 Session destroyed:", token);
    return true;
  } catch (err) {
    console.error("❌ Error destroying session:", err);
    return false;
  }
}

module.exports = {
  createSession,
  getSession,
  updateSessionRole,
  destroySession,
};
