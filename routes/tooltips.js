const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();
const PUBLIC_DIR = path.join(__dirname, "..", "public");
let tableReady;

const PAGE_ROUTE_FILES = {
  "/": "index.html", "/home": "home.html", "/news": "news.html", "/admin": "admin.html",
  "/orders": "ordermanagement.html", "/sales-tools": "salestools.html", "/finance-settings": "finance-settings.html",
  "/finance-calculator": "finance-calculator.html", "/quote-details": "quote-details.html", "/qr-generator": "qr-generator.html",
  "/sales/new": "newsalesorder.html", "/customer-details": "customerdetailspopup.html", "/customer-search": "customersearchpopup.html",
  "/sales/kiosk": "saleskiosk.html", "/quote/new": "quotenew.html", "/product-hub": "product-hub.html", "/reports": "reports.html",
  "/rewards-dashboard": "rewards-dashboard.html", "/promotions": "promotions.html", "/eod": "endofday.html", "/cashflow": "cashflow.html",
  "/floor-plans": "floor-plans.html", "/logistics": "logistics.html", "/suitepim": "suitepim.html", "/suitepim/settings": "suitepim-settings.html",
  "/systems-processes": "systems-processes.html", "/cs-workflows": "cs-workflows.html", "/cs-workflows/suiteql-studio": "cs-suiteql-studio.html",
  "/cs-workflows/create-record-map": "cs-create-record-map.html", "/rota": "rota.html", "/available-shifts": "available-shifts.html",
  "/suitepim/web-management": "suitepim-web-management.html", "/suitepim/imagery-sync": "suitepim-imagery-sync.html",
  "/suitepim/scheduled-exports": "suitepim-scheduled-exports.html", "/suitepim/product-validation": "suitepim-product-validation.html",
  "/suitepim/campaigns": "suitepim-campaigns.html", "/suitepim/item-faqs": "suitepim-item-faqs.html", "/suitepim/reasons-to-buy": "suitepim-reasons-to-buy.html"
};

function canonicalPageKey(value) {
  let key = String(value || "").trim().toLowerCase().split(/[?#]/)[0];
  if (/^\/qr-shop\//.test(key)) return "qr-shop.html";
  if (/^\/sales\/reciept\//.test(key)) return "salesordreceipt.html";
  if (/^\/sales\/view\//.test(key)) return "salesorderview.html";
  if (/^\/quote\/view\//.test(key)) return "quoteview.html";
  if (/^\/quote\/receipt\//.test(key)) return "quotereciept.html";
  return PAGE_ROUTE_FILES[key] || key.replace(/^.*\//, "") || "index.html";
}

function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS page_tooltips (
        id SERIAL PRIMARY KEY,
        page_key TEXT NOT NULL,
        field_key TEXT NOT NULL,
        field_label TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (page_key, field_key)
      );
      CREATE TABLE IF NOT EXISTS page_tooltip_revisions (
        page_key TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  return tableReady;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[1] ?? match[2] ?? "").trim() : "";
}

function pageFields(html) {
  const labels = new Map();
  for (const match of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const nestedControl = match[2].match(/<(?:input|select|textarea)\b[^>]*>/i)?.[0] || "";
    const key = attribute(match[1], "for") || attribute(nestedControl, "id") || attribute(nestedControl, "name");
    const label = decodeEntities(match[2]);
    if (key && label) labels.set(key, label.replace(/[\s:*]+$/, ""));
  }

  const fields = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bdata-tooltip-field\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const key = attribute(match[2], "data-tooltip-field");
    const label = decodeEntities(match[3]);
    if (key && label) fields.set(key, { key, label });
  }
  for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = match[0];
    const type = attribute(tag, "type").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    const key = attribute(tag, "id") || attribute(tag, "name");
    if (!key || fields.has(key)) continue;
    const fallback = attribute(tag, "aria-label") || attribute(tag, "placeholder") || key;
    fields.set(key, { key, label: labels.get(key) || decodeEntities(fallback) });
  }
  return [...fields.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function sessionFor(req) {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ") ? getSession(auth.slice(7)) : null;
}

async function requireAdmin(req, res, next) {
  const session = await sessionFor(req);
  if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });
  if (String(session.activeRole?.name || "").trim().toLowerCase() !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin access required" });
  }
  req.session = session;
  next();
}

router.get("/pages", requireAdmin, async (_req, res) => {
  try {
    await ensureTable();
    async function htmlFiles(directory, prefix = "") {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const nested = await Promise.all(entries.map((entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return htmlFiles(path.join(directory, entry.name), relative);
        return entry.isFile() && entry.name.toLowerCase().endsWith(".html") ? [relative] : [];
      }));
      return nested.flat();
    }
    const names = await htmlFiles(PUBLIC_DIR);
    const discoveredPages = await Promise.all(names.map(async (file) => {
      const html = await fs.readFile(path.join(PUBLIC_DIR, file), "utf8");
      const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || file.replace(/\.html$/i, "");
      return { key: file.toLowerCase(), name: title, file, fields: pageFields(html) };
    }));
    const pages = discoveredPages.filter((page) => page.fields.length > 0);
    const summary = await pool.query(`
      WITH page_keys AS (
        SELECT page_key FROM page_tooltips
        UNION
        SELECT page_key FROM page_tooltip_revisions
      )
      SELECT k.page_key, COUNT(t.id)::INTEGER AS configured, COALESCE(r.revision, 0) AS revision
        FROM page_keys k
        LEFT JOIN page_tooltips t ON t.page_key = k.page_key
        LEFT JOIN page_tooltip_revisions r ON r.page_key = k.page_key
       GROUP BY k.page_key, r.revision
    `);
    const byPage = new Map(summary.rows.map((row) => [row.page_key, row]));
    pages.forEach((page) => {
      page.configured = byPage.get(page.key)?.configured || 0;
      page.revision = byPage.get(page.key)?.revision || 0;
    });
    pages.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, pages });
  } catch (error) {
    console.error("Failed to build tooltip page catalog:", error);
    res.status(500).json({ ok: false, error: "Unable to load page catalog" });
  }
});

router.get("/", async (req, res) => {
  try {
    await ensureTable();
    const pageKey = canonicalPageKey(req.query.page);
    if (!pageKey) return res.status(400).json({ ok: false, error: "Missing page" });
    const [result, revisionResult] = await Promise.all([
      pool.query("SELECT id, page_key AS \"pageKey\", field_key AS \"fieldKey\", field_label AS \"fieldLabel\", message FROM page_tooltips WHERE page_key = $1 ORDER BY field_label", [pageKey]),
      pool.query("SELECT revision FROM page_tooltip_revisions WHERE page_key = $1", [pageKey]),
    ]);
    res.json({ ok: true, tooltips: result.rows, revision: revisionResult.rows[0]?.revision || 0 });
  } catch (error) {
    console.error("Failed to load tooltips:", error);
    res.status(500).json({ ok: false, error: "Unable to load tooltips" });
  }
});

router.put("/:pageKey", requireAdmin, async (req, res) => {
  const pageKey = String(req.params.pageKey || "").trim().toLowerCase();
  const tooltips = Array.isArray(req.body?.tooltips) ? req.body.tooltips : [];
  const expectedRevision = Number(req.body?.revision || 0);
  if (!pageKey || tooltips.length > 500) return res.status(400).json({ ok: false, error: "Invalid tooltip data" });
  const clean = tooltips.map((item) => ({
    fieldKey: String(item.fieldKey || "").trim().slice(0, 200),
    fieldLabel: String(item.fieldLabel || "").trim().slice(0, 300),
    message: String(item.message || "").trim().slice(0, 2000),
  })).filter((item) => item.fieldKey && item.fieldLabel && item.message);

  await ensureTable();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO page_tooltip_revisions (page_key) VALUES ($1) ON CONFLICT (page_key) DO NOTHING", [pageKey]);
    const revisionResult = await client.query("SELECT revision FROM page_tooltip_revisions WHERE page_key = $1 FOR UPDATE", [pageKey]);
    const currentRevision = revisionResult.rows[0]?.revision || 0;
    if (currentRevision !== expectedRevision) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "These tooltips were changed by another administrator. Reload the page and try again.", revision: currentRevision });
    }
    await client.query("DELETE FROM page_tooltips WHERE page_key = $1", [pageKey]);
    for (const item of clean) {
      await client.query(
        "INSERT INTO page_tooltips (page_key, field_key, field_label, message) VALUES ($1, $2, $3, $4)",
        [pageKey, item.fieldKey, item.fieldLabel, item.message]
      );
    }
    const nextRevision = currentRevision + 1;
    await client.query("UPDATE page_tooltip_revisions SET revision = $2, updated_at = NOW() WHERE page_key = $1", [pageKey, nextRevision]);
    await client.query("COMMIT");
    res.json({ ok: true, tooltips: clean, revision: nextRevision });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to save tooltips:", error);
    res.status(500).json({ ok: false, error: "Unable to save tooltips" });
  } finally {
    client.release();
  }
});

module.exports = router;
