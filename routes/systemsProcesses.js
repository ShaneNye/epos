const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const PAGE_OPTIONS = [
  { value: "home", label: "Home" },
  { value: "sales/new", label: "New Sales Order" },
  { value: "sales/view", label: "Sales Order View" },
  { value: "sales/kiosk", label: "Sales Kiosk" },
  { value: "quote/new", label: "New Quote" },
  { value: "quote/view", label: "Quote View" },
  { value: "orders", label: "Order Management" },
  { value: "reports", label: "Reports" },
  { value: "promotions", label: "Promotions" },
  { value: "eod", label: "End Of Day" },
  { value: "cashflow", label: "Cashflow" },
  { value: "engagement", label: "Engagement" },
  { value: "logistics", label: "Logistics" },
  { value: "suitepim", label: "SuitePim" },
  { value: "admin", label: "Admin" },
  { value: "systems-processes", label: "Systems & Processes" },
];

const PAGE_VALUES = new Set(PAGE_OPTIONS.map((page) => page.value));
let tableReadyPromise = null;

function normalizePage(value) {
  const slug = String(value || "")
    .replace(/^\//, "")
    .replace(/\.html$/i, "")
    .trim()
    .toLowerCase();

  if (slug === "end-of-day" || slug === "endofday") return "eod";
  if (slug === "cash-flow") return "cashflow";
  if (slug.startsWith("sales/view/")) return "sales/view";
  if (slug.startsWith("quote/view/")) return "quote/view";
  if (slug === "suitepim" || slug.startsWith("suitepim/")) return "suitepim";
  return slug;
}

function normalizeAccessList(rawAccess) {
  if (Array.isArray(rawAccess)) return rawAccess.map(normalizePage);
  if (typeof rawAccess === "string") {
    try {
      const parsed = JSON.parse(rawAccess);
      return Array.isArray(parsed) ? parsed.map(normalizePage) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function tokenFromReq(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

async function ensureTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS systems_processes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        page TEXT NOT NULL,
        scribe_link TEXT,
        video_link TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_systems_processes_page
        ON systems_processes (page);
    `);
  }
  await tableReadyPromise;
}

async function getRequestContext(req) {
  const token = tokenFromReq(req);
  if (!token) {
    const err = new Error("Missing token");
    err.status = 401;
    throw err;
  }

  const session = await getSession(token);
  if (!session) {
    const err = new Error("Invalid session");
    err.status = 401;
    throw err;
  }

  const activeRoleName =
    typeof session.activeRole === "string"
      ? session.activeRole
      : session.activeRole?.name || "";

  let access = [];
  if (activeRoleName) {
    const result = await pool.query(
      "SELECT access FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [activeRoleName]
    );
    access = normalizeAccessList(result.rows[0]?.access);
  }

  return { token, session, activeRoleName, access };
}

async function requireManagerAccess(req) {
  const context = await getRequestContext(req);
  if (!context.access.includes("systems-processes")) {
    const err = new Error("You do not have access to manage Systems & Processes.");
    err.status = 403;
    throw err;
  }
  return context;
}

function cleanUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function cleanPayload(body = {}) {
  const title = String(body.title || "").trim();
  const page = normalizePage(body.page);
  const scribeLink = cleanUrl(body.scribeLink || body.scribe_link);
  const videoLink = cleanUrl(body.videoLink || body.video_link);

  if (!title) {
    const err = new Error("Title is required.");
    err.status = 400;
    throw err;
  }
  if (!PAGE_VALUES.has(page)) {
    const err = new Error("A valid page is required.");
    err.status = 400;
    throw err;
  }

  return { title, page, scribeLink, videoLink };
}

function toProcess(row) {
  return {
    id: row.id,
    title: row.title,
    page: row.page,
    scribeLink: row.scribe_link || "",
    videoLink: row.video_link || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get("/pages", async (_req, res) => {
  res.json({ ok: true, pages: PAGE_OPTIONS });
});

router.get("/", async (req, res) => {
  try {
    await getRequestContext(req);
    await ensureTable();

    const page = normalizePage(req.query.page);
    const params = [];
    let where = "";

    if (page) {
      params.push(page);
      where = "WHERE page = $1";
    }

    const result = await pool.query(
      `
      SELECT id, title, page, scribe_link, video_link, created_by, created_at, updated_at
      FROM systems_processes
      ${where}
      ORDER BY page, title
      `,
      params
    );

    res.json({ ok: true, processes: result.rows.map(toProcess) });
  } catch (err) {
    const status = Number(err.status || 500);
    console.error("Systems processes list error:", err);
    res.status(status).json({ ok: false, error: err.message || "Failed to load systems processes." });
  }
});

router.post("/", async (req, res) => {
  try {
    const context = await requireManagerAccess(req);
    await ensureTable();
    const payload = cleanPayload(req.body);
    const createdBy = context.session.email || context.session.user?.email || "";

    const result = await pool.query(
      `
      INSERT INTO systems_processes (title, page, scribe_link, video_link, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, page, scribe_link, video_link, created_by, created_at, updated_at
      `,
      [payload.title, payload.page, payload.scribeLink, payload.videoLink, createdBy]
    );

    res.json({ ok: true, process: toProcess(result.rows[0]) });
  } catch (err) {
    const status = Number(err.status || 500);
    console.error("Systems processes create error:", err);
    res.status(status).json({ ok: false, error: err.message || "Failed to create systems process." });
  }
});

router.put("/:id", async (req, res) => {
  try {
    await requireManagerAccess(req);
    await ensureTable();
    const payload = cleanPayload(req.body);

    const result = await pool.query(
      `
      UPDATE systems_processes
      SET title = $1,
          page = $2,
          scribe_link = $3,
          video_link = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, title, page, scribe_link, video_link, created_by, created_at, updated_at
      `,
      [payload.title, payload.page, payload.scribeLink, payload.videoLink, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Systems process not found." });
    }

    res.json({ ok: true, process: toProcess(result.rows[0]) });
  } catch (err) {
    const status = Number(err.status || 500);
    console.error("Systems processes update error:", err);
    res.status(status).json({ ok: false, error: err.message || "Failed to update systems process." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await requireManagerAccess(req);
    await ensureTable();

    const result = await pool.query("DELETE FROM systems_processes WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Systems process not found." });
    }

    res.json({ ok: true });
  } catch (err) {
    const status = Number(err.status || 500);
    console.error("Systems processes delete error:", err);
    res.status(status).json({ ok: false, error: err.message || "Failed to delete systems process." });
  }
});

module.exports = router;
