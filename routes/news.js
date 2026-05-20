const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const ALLOWED_ATTACHMENT_TYPES = new Set(["document", "video", "web"]);

let initPromise;

function initNewsTables() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS news_posts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE news_posts
        ADD COLUMN IF NOT EXISTS page_key TEXT,
        ADD COLUMN IF NOT EXISTS page_label TEXT,
        ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
    `);
  }
  return initPromise;
}

function normalizeAccessPath(value) {
  return String(value || "")
    .replace(/^\//, "")
    .replace(/\.html$/i, "")
    .trim()
    .toLowerCase();
}

function parseAccess(rawAccess) {
  if (Array.isArray(rawAccess)) return rawAccess.map(normalizeAccessPath);
  if (typeof rawAccess === "string") {
    try {
      const parsed = JSON.parse(rawAccess || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeAccessPath) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function getSessionContext(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const session = await getSession(token);
  if (!session?.email) {
    const err = new Error("Invalid session");
    err.status = 401;
    throw err;
  }

  const userRes = await pool.query(
    "SELECT id, firstname, lastname, email FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1",
    [session.email]
  );
  if (!userRes.rows.length) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }

  const activeRole = session.activeRole;
  const activeRoleName =
    typeof activeRole === "string" ? activeRole : activeRole?.name || null;

  let access = [];
  if (activeRoleName) {
    const roleRes = await pool.query(
      "SELECT access FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [activeRoleName]
    );
    access = parseAccess(roleRes.rows[0]?.access);
  }

  return {
    session,
    user: userRes.rows[0],
    activeRoleName,
    canPost: access.includes("news-post") || access.includes("admin"),
  };
}

function cleanAttachments(input) {
  if (!Array.isArray(input)) return [];

  return input
    .slice(0, 12)
    .map((item) => {
      const type = String(item?.type || "").trim().toLowerCase();
      const url = String(item?.url || "").trim();
      const label = String(item?.label || "").trim().slice(0, 120);

      if (!ALLOWED_ATTACHMENT_TYPES.has(type) || !url) return null;

      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }

      if (!["http:", "https:"].includes(parsed.protocol)) return null;

      return {
        type,
        url: parsed.href,
        label: label || parsed.hostname.replace(/^www\./, ""),
      };
    })
    .filter(Boolean);
}

function cleanTags(input) {
  const rawTags = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((tag) => tag.trim());

  return Array.from(
    new Set(
      rawTags
        .map((tag) => String(tag || "").trim().replace(/^#/, "").slice(0, 40))
        .filter(Boolean)
    )
  ).slice(0, 12);
}

function cleanPageMeta(body) {
  const pageKey = String(body?.pageKey || "").trim().toLowerCase().slice(0, 80);
  const pageLabel = String(body?.pageLabel || "").trim().slice(0, 120);

  if (!pageKey || !pageLabel) {
    return { pageKey: null, pageLabel: null };
  }

  return { pageKey, pageLabel };
}

router.get("/permissions", async (req, res) => {
  try {
    await initNewsTables();
    const context = await getSessionContext(req);
    res.json({ ok: true, canPost: context.canPost });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message || "Failed to check permissions" });
  }
});

router.get("/posts", async (req, res) => {
  try {
    await initNewsTables();
    await getSessionContext(req);

    const result = await pool.query(`
      SELECT
        np.id,
        np.title,
        np.body,
        np.attachments,
        np.page_key,
        np.page_label,
        np.tags,
        np.created_at,
        u.email AS created_by_email,
        COALESCE(NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), ''), u.email, 'Unknown user') AS created_by_name
      FROM news_posts np
      LEFT JOIN users u ON u.id = np.created_by
      ORDER BY np.created_at DESC
      LIMIT 100;
    `);

    res.json({ ok: true, posts: result.rows });
  } catch (err) {
    console.error("GET /api/news/posts failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to load news posts" });
  }
});

router.post("/posts", async (req, res) => {
  try {
    await initNewsTables();
    const context = await getSessionContext(req);
    if (!context.canPost) {
      return res.status(403).json({ ok: false, error: "Your active role cannot post news updates" });
    }

    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const attachments = cleanAttachments(req.body?.attachments);
    const tags = cleanTags(req.body?.tags);
    const pageMeta = cleanPageMeta(req.body);

    if (!title || !body) {
      return res.status(400).json({ ok: false, error: "Title and notification body are required" });
    }

    const result = await pool.query(
      `
      INSERT INTO news_posts (title, body, attachments, page_key, page_label, tags, created_by)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6::text[], $7)
      RETURNING id, created_at;
      `,
      [
        title.slice(0, 180),
        body,
        JSON.stringify(attachments),
        pageMeta.pageKey,
        pageMeta.pageLabel,
        tags,
        context.user.id,
      ]
    );

    res.status(201).json({ ok: true, post: result.rows[0] });
  } catch (err) {
    console.error("POST /api/news/posts failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to create news post" });
  }
});

module.exports = router;
