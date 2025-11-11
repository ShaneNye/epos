const crypto = require("crypto");
const pool = require("./db");

const SESSION_TTL_DAYS = 7; // expire sessions after 7 days

function normalizeRoleName(name) {
  if (!name) return null;
  return name.trim();
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
    name: `${user.firstname ?? ""} ${user.lastname ?? ""}`.trim(),
    roles: (user.roles || []).map(normalizeRoleName),
    activeRole: {
      name: activeRole,
      access: Array.isArray(access) ? access : [],
    },
    createdAt: Date.now(),
  };

  try {
    await pool.query(
      `INSERT INTO sessions (token, user_id, data) VALUES ($1, $2, $3)`,
      [token, user.id, JSON.stringify(sessionData)]
    );
    console.log("✅ Session inserted into DB for user:", user.email);
    console.log("   ▶ Active Role:", activeRole);
    return token;
  } catch (err) {
    console.error("❌ Error creating session:", err.message);
    throw err;
  }
}

/**
 * Retrieve an active session by token.
 */
async function getSession(token) {
  try {
    const result = await pool.query(
      `SELECT user_id, data, created_at FROM sessions WHERE token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      console.warn("⚠️ No session found for token:", token);
      return null;
    }

    const record = result.rows[0];
    let session;

    try {
      session =
        typeof record.data === "object"
          ? record.data
          : JSON.parse(record.data);
    } catch (parseErr) {
      console.error("❌ Failed to parse session JSON:", parseErr);
      return null;
    }

    // ✅ Always include numeric user_id
    if (!session.user_id) {
      session.user_id = record.user_id;
    }

    // Expire old sessions
    const ageDays =
      (Date.now() - new Date(record.created_at).getTime()) /
      (1000 * 60 * 60 * 24);
    if (ageDays > SESSION_TTL_DAYS) {
      console.warn("⚠️ Session expired, deleting:", token);
      await destroySession(token);
      return null;
    }

    // Normalize roles
    if (Array.isArray(session.roles)) {
      session.roles = session.roles.map(normalizeRoleName);
    }
    if (session.activeRole?.name) {
      session.activeRole.name = normalizeRoleName(session.activeRole.name);
    }

    return session;
  } catch (err) {
    console.error("❌ Error fetching session:", err.message);
    return null;
  }
}

async function updateSessionRole(token, roleName, access = []) {
  try {
    const result = await pool.query(`SELECT data FROM sessions WHERE token = $1`, [token]);
    if (result.rows.length === 0) return false;

    let session;
    try {
      session =
        typeof result.rows[0].data === "object"
          ? result.rows[0].data
          : JSON.parse(result.rows[0].data);
    } catch (err) {
      console.error("❌ Failed to parse session JSON for update:", err.message);
      return false;
    }

    const normalizedRole = normalizeRoleName(roleName);

    session.activeRole = {
      name: normalizedRole,
      access: Array.isArray(access) ? access : [],
    };

    if (Array.isArray(session.roles)) {
      session.roles = session.roles.map(normalizeRoleName);
    }

    await pool.query(`UPDATE sessions SET data = $1 WHERE token = $2`, [
      JSON.stringify(session),
      token,
    ]);

    console.log(`🎯 Session role updated for token ${token}: ${normalizedRole}`);
    return true;
  } catch (err) {
    console.error("❌ Error updating session role:", err.message);
    return false;
  }
}

async function destroySession(token) {
  try {
    await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    console.log("🧹 Session destroyed:", token);
    return true;
  } catch (err) {
    console.error("❌ Error destroying session:", err.message);
    return false;
  }
}

module.exports = {
  createSession,
  getSession,
  updateSessionRole,
  destroySession,
};
