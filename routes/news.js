const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const ALLOWED_ATTACHMENT_TYPES = new Set(["document", "video", "image", "web"]);

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
        ADD COLUMN IF NOT EXISTS department_key TEXT,
        ADD COLUMN IF NOT EXISTS department_label TEXT,
        ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

      CREATE TABLE IF NOT EXISTS news_post_views (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS news_post_reads (
        post_id INTEGER NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (post_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS news_post_reactions (
        post_id INTEGER NOT NULL REFERENCES news_posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
        reacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (post_id, user_id)
      );
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

function cleanDepartmentMeta(body) {
  const departmentKey = String(body?.departmentKey || "").trim().toLowerCase().slice(0, 80);
  const departmentLabel = String(body?.departmentLabel || "").trim().slice(0, 120);

  if (!departmentKey || !departmentLabel) {
    return { departmentKey: null, departmentLabel: null };
  }

  return { departmentKey, departmentLabel };
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
    const context = await getSessionContext(req);

    const result = await pool.query(
      `
      SELECT
        np.id,
        np.title,
        np.body,
        np.attachments,
        np.page_key,
        np.page_label,
        np.department_key,
        np.department_label,
        np.tags,
        np.created_at,
        u.email AS created_by_email,
        u.profileimage AS created_by_profile_image,
        COALESCE(NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), ''), u.email, 'Unknown user') AS created_by_name,
        np.created_by = $1 AS can_manage,
        COALESCE(reactions.like_count, 0)::int AS like_count,
        COALESCE(reactions.dislike_count, 0)::int AS dislike_count,
        my_reaction.reaction AS my_reaction
      FROM news_posts np
      LEFT JOIN users u ON u.id = np.created_by
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE reaction = 'like') AS like_count,
          COUNT(*) FILTER (WHERE reaction = 'dislike') AS dislike_count
        FROM news_post_reactions npr
        WHERE npr.post_id = np.id
      ) reactions ON TRUE
      LEFT JOIN news_post_reactions my_reaction
        ON my_reaction.post_id = np.id
       AND my_reaction.user_id = $1
      ORDER BY np.created_at DESC
      LIMIT 100;
      `,
      [context.user.id]
    );

    res.json({ ok: true, posts: result.rows });
  } catch (err) {
    console.error("GET /api/news/posts failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to load news posts" });
  }
});

router.get("/summary", async (req, res) => {
  try {
    await initNewsTables();
    const context = await getSessionContext(req);

    const result = await pool.query(
      `
      SELECT
        MAX(np.created_at) AS latest_post_at,
        nv.last_seen_at
      FROM news_posts np
      LEFT JOIN news_post_views nv ON nv.user_id = $1
      GROUP BY nv.last_seen_at;
      `,
      [context.user.id]
    );

    const row = result.rows[0] || {};
    const latestPostAt = row.latest_post_at || null;
    const lastSeenAt = row.last_seen_at || null;
    const hasUnread = Boolean(
      latestPostAt &&
        (!lastSeenAt || new Date(latestPostAt).getTime() > new Date(lastSeenAt).getTime())
    );

    res.json({
      ok: true,
      hasUnread,
      latestPostAt,
      lastSeenAt,
    });
  } catch (err) {
    console.error("GET /api/news/summary failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to load news summary" });
  }
});

router.post("/seen", async (req, res) => {
  try {
    await initNewsTables();
    const context = await getSessionContext(req);

    await pool.query(
      `
      INSERT INTO news_post_views (user_id, last_seen_at)
      VALUES ($1, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
      `,
      [context.user.id]
    );

    await pool.query(
      `
      INSERT INTO news_post_reads (post_id, user_id, viewed_at)
      SELECT id, $1, NOW()
      FROM news_posts
      ON CONFLICT (post_id, user_id)
      DO UPDATE SET viewed_at = EXCLUDED.viewed_at;
      `,
      [context.user.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/news/seen failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to mark news as seen" });
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
    const departmentMeta = cleanDepartmentMeta(req.body);

    if (!title || !body) {
      return res.status(400).json({ ok: false, error: "Title and notification body are required" });
    }

    const result = await pool.query(
      `
      INSERT INTO news_posts (title, body, attachments, page_key, page_label, department_key, department_label, tags, created_by)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8::text[], $9)
      RETURNING id, created_at;
      `,
      [
        title.slice(0, 180),
        body,
        JSON.stringify(attachments),
        pageMeta.pageKey,
        pageMeta.pageLabel,
        departmentMeta.departmentKey,
        departmentMeta.departmentLabel,
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

router.post("/posts/:id/reaction", async (req, res) => {
  try {
    await initNewsTables();
    const context = await getSessionContext(req);
    const reaction = String(req.body?.reaction || "").trim().toLowerCase();

    if (!["like", "dislike", ""].includes(reaction)) {
      return res.status(400).json({ ok: false, error: "Reaction must be like or dislike" });
    }

    const postRes = await pool.query("SELECT id FROM news_posts WHERE id = $1 LIMIT 1;", [req.params.id]);
    if (!postRes.rowCount) {
      return res.status(404).json({ ok: false, error: "Post not found" });
    }

    if (!reaction) {
      await pool.query(
        "DELETE FROM news_post_reactions WHERE post_id = $1 AND user_id = $2;",
        [req.params.id, context.user.id]
      );
    } else {
      await pool.query(
        `
        INSERT INTO news_post_reactions (post_id, user_id, reaction, reacted_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (post_id, user_id)
        DO UPDATE SET reaction = EXCLUDED.reaction, reacted_at = EXCLUDED.reacted_at;
        `,
        [req.params.id, context.user.id, reaction]
      );
    }

    const counts = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE reaction = 'like')::int AS like_count,
        COUNT(*) FILTER (WHERE reaction = 'dislike')::int AS dislike_count
      FROM news_post_reactions
      WHERE post_id = $1;
      `,
      [req.params.id]
    );

    res.json({
      ok: true,
      reaction: reaction || null,
      likeCount: counts.rows[0]?.like_count || 0,
      dislikeCount: counts.rows[0]?.dislike_count || 0,
    });
  } catch (err) {
    console.error("POST /api/news/posts/:id/reaction failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to save reaction" });
  }
});

router.get("/posts/:id/analytics", async (req, res) => {
  try {
    await initNewsTables();
    await getSessionContext(req);

    const postRes = await pool.query(
      "SELECT id, title, created_at FROM news_posts WHERE id = $1 LIMIT 1;",
      [req.params.id]
    );
    if (!postRes.rowCount) {
      return res.status(404).json({ ok: false, error: "Post not found" });
    }

    const userRes = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        COALESCE(NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), ''), u.email, 'Unknown user') AS name,
        COALESCE(npr.viewed_at, CASE WHEN npv.last_seen_at >= np.created_at THEN npv.last_seen_at END) AS viewed_at
      FROM news_posts np
      CROSS JOIN users u
      LEFT JOIN news_post_reads npr
        ON npr.post_id = np.id
       AND npr.user_id = u.id
      LEFT JOIN news_post_views npv
        ON npv.user_id = u.id
      WHERE np.id = $1
      ORDER BY viewed_at NULLS LAST, name ASC;
      `,
      [req.params.id]
    );

    const viewed = [];
    const notViewed = [];
    userRes.rows.forEach((row) => {
      const item = {
        id: row.id,
        name: row.name,
        email: row.email,
        viewedAt: row.viewed_at,
      };
      if (row.viewed_at) viewed.push(item);
      else notViewed.push(item);
    });

    const total = userRes.rowCount;
    const viewedCount = viewed.length;
    const viewedPercent = total ? Math.round((viewedCount / total) * 100) : 0;

    res.json({
      ok: true,
      post: postRes.rows[0],
      metrics: {
        totalUsers: total,
        viewedCount,
        notViewedCount: notViewed.length,
        viewedPercent,
      },
      viewed,
      notViewed,
    });
  } catch (err) {
    console.error("GET /api/news/posts/:id/analytics failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to load post analytics" });
  }
});

router.put("/posts/:id", async (req, res) => {
  try {
    await initNewsTables();
    const context = await getSessionContext(req);

    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    const attachments = cleanAttachments(req.body?.attachments);
    const tags = cleanTags(req.body?.tags);
    const pageMeta = cleanPageMeta(req.body);
    const departmentMeta = cleanDepartmentMeta(req.body);

    if (!title || !body) {
      return res.status(400).json({ ok: false, error: "Title and notification body are required" });
    }

    const result = await pool.query(
      `
      UPDATE news_posts
      SET
        title = $1,
        body = $2,
        attachments = $3::jsonb,
        page_key = $4,
        page_label = $5,
        department_key = $6,
        department_label = $7,
        tags = $8::text[],
        updated_at = NOW()
      WHERE id = $9
        AND created_by = $10
      RETURNING id, updated_at;
      `,
      [
        title.slice(0, 180),
        body,
        JSON.stringify(attachments),
        pageMeta.pageKey,
        pageMeta.pageLabel,
        departmentMeta.departmentKey,
        departmentMeta.departmentLabel,
        tags,
        req.params.id,
        context.user.id,
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({ ok: false, error: "Post not found or not owned by you" });
    }

    res.json({ ok: true, post: result.rows[0] });
  } catch (err) {
    console.error("PUT /api/news/posts/:id failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to update news post" });
  }
});

router.delete("/posts/:id", async (req, res) => {
  try {
    await initNewsTables();
    const context = await getSessionContext(req);

    const result = await pool.query(
      "DELETE FROM news_posts WHERE id = $1 AND created_by = $2 RETURNING id;",
      [req.params.id, context.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ ok: false, error: "Post not found or not owned by you" });
    }

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("DELETE /api/news/posts/:id failed:", err);
    res.status(err.status || 500).json({ ok: false, error: "Failed to delete news post" });
  }
});

module.exports = router;
