const express = require("express");
const pool = require("../db");
const { normalizeEnvironmentName } = require("../utils/netsuiteEnvironment");

const router = express.Router();

let initPromise = null;

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanDocumentType(value) {
  const type = cleanText(value, 20).toLowerCase();
  return type === "quote" ? "quote" : "sale";
}

function shouldRecordExperienceData() {
  return normalizeEnvironmentName(process.env.ENVIRONMENT) === "PRODUCTION";
}

async function ensureTables() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS sales_order_experience_events (
        id BIGSERIAL PRIMARY KEY,
        document_type TEXT NOT NULL CHECK (document_type IN ('sale', 'quote')),
        store_id TEXT,
        store_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sales_order_experience_feedback (
        id BIGSERIAL PRIMARY KEY,
        document_type TEXT NOT NULL CHECK (document_type IN ('sale', 'quote')),
        store_id TEXT,
        store_name TEXT,
        score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
        comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_soe_events_month_store
        ON sales_order_experience_events (created_at, store_id, store_name);

      CREATE INDEX IF NOT EXISTS idx_soe_feedback_month_store
        ON sales_order_experience_feedback (created_at, store_id, store_name);
    `);
  }

  return initPromise;
}

async function recordDocumentCreated({ documentType, storeId, storeName }) {
  try {
    if (!shouldRecordExperienceData()) {
      return { ok: true, skipped: true, reason: "non_production" };
    }

    await ensureTables();
    await pool.query(
      `INSERT INTO sales_order_experience_events (document_type, store_id, store_name)
       VALUES ($1, $2, $3)`,
      [
        cleanDocumentType(documentType),
        cleanText(storeId, 100) || null,
        cleanText(storeName, 200) || null,
      ]
    );
    return { ok: true, skipped: false };
  } catch (err) {
    console.warn("SalesOrder experience create-event was not recorded:", err.message);
    return { ok: false, error: err.message };
  }
}

router.post("/feedback", async (req, res) => {
  try {
    if (!shouldRecordExperienceData()) {
      return res.json({ ok: true, skipped: true, reason: "non_production" });
    }

    await ensureTables();

    const score = Number(req.body?.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ ok: false, error: "Score must be between 1 and 5." });
    }

    const comment = score <= 3 ? cleanText(req.body?.comment, 1000) : "";

    await pool.query(
      `INSERT INTO sales_order_experience_feedback
        (document_type, store_id, store_name, score, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        cleanDocumentType(req.body?.documentType),
        cleanText(req.body?.storeId, 100) || null,
        cleanText(req.body?.storeName, 200) || null,
        score,
        comment || null,
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("SalesOrder experience feedback error:", err);
    return res.status(500).json({ ok: false, error: "Failed to save feedback." });
  }
});

router.get("/analytics", async (req, res) => {
  try {
    await ensureTables();

    const [groupResult, storeResult, commentsResult] = await Promise.all([
      pool.query(`
        WITH months AS (
          SELECT date_trunc('month', created_at) AS month_start
          FROM sales_order_experience_events
          UNION
          SELECT date_trunc('month', created_at) AS month_start
          FROM sales_order_experience_feedback
        ),
        created AS (
          SELECT date_trunc('month', created_at) AS month_start, COUNT(*)::int AS created_count
          FROM sales_order_experience_events
          GROUP BY 1
        ),
        feedback AS (
          SELECT
            date_trunc('month', created_at) AS month_start,
            COUNT(*)::int AS response_count,
            ROUND(AVG(score)::numeric, 2)::float AS average_score
          FROM sales_order_experience_feedback
          GROUP BY 1
        )
        SELECT
          to_char(m.month_start, 'YYYY-MM') AS month,
          COALESCE(c.created_count, 0)::int AS created_count,
          COALESCE(f.response_count, 0)::int AS response_count,
          CASE
            WHEN COALESCE(c.created_count, 0) = 0 THEN 0
            ELSE ROUND((COALESCE(f.response_count, 0)::numeric / c.created_count) * 100, 1)::float
          END AS response_rate,
          COALESCE(f.average_score, 0)::float AS average_score
        FROM months m
        LEFT JOIN created c ON c.month_start = m.month_start
        LEFT JOIN feedback f ON f.month_start = m.month_start
        ORDER BY m.month_start DESC;
      `),
      pool.query(`
        WITH keys AS (
          SELECT
            date_trunc('month', created_at) AS month_start,
            COALESCE(NULLIF(store_id, ''), 'unknown') AS store_key,
            COALESCE(NULLIF(store_name, ''), 'Unknown Store') AS store_name
          FROM sales_order_experience_events
          UNION
          SELECT
            date_trunc('month', created_at) AS month_start,
            COALESCE(NULLIF(store_id, ''), 'unknown') AS store_key,
            COALESCE(NULLIF(store_name, ''), 'Unknown Store') AS store_name
          FROM sales_order_experience_feedback
        ),
        created AS (
          SELECT
            date_trunc('month', created_at) AS month_start,
            COALESCE(NULLIF(store_id, ''), 'unknown') AS store_key,
            COUNT(*)::int AS created_count
          FROM sales_order_experience_events
          GROUP BY 1, 2
        ),
        feedback AS (
          SELECT
            date_trunc('month', created_at) AS month_start,
            COALESCE(NULLIF(store_id, ''), 'unknown') AS store_key,
            COUNT(*)::int AS response_count,
            ROUND(AVG(score)::numeric, 2)::float AS average_score
          FROM sales_order_experience_feedback
          GROUP BY 1, 2
        )
        SELECT
          to_char(k.month_start, 'YYYY-MM') AS month,
          MAX(k.store_name) AS store_name,
          COALESCE(c.created_count, 0)::int AS created_count,
          COALESCE(f.response_count, 0)::int AS response_count,
          CASE
            WHEN COALESCE(c.created_count, 0) = 0 THEN 0
            ELSE ROUND((COALESCE(f.response_count, 0)::numeric / c.created_count) * 100, 1)::float
          END AS response_rate,
          COALESCE(f.average_score, 0)::float AS average_score
        FROM keys k
        LEFT JOIN created c ON c.month_start = k.month_start AND c.store_key = k.store_key
        LEFT JOIN feedback f ON f.month_start = k.month_start AND f.store_key = k.store_key
        GROUP BY k.month_start, k.store_key, c.created_count, f.response_count, f.average_score
        ORDER BY k.month_start DESC, store_name ASC;
      `),
      pool.query(`
        SELECT
          id,
          to_char(created_at, 'YYYY-MM-DD HH24:MI') AS submitted_at,
          document_type,
          COALESCE(NULLIF(store_name, ''), 'Unknown Store') AS store_name,
          score,
          comment
        FROM sales_order_experience_feedback
        WHERE NULLIF(comment, '') IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 100;
      `),
    ]);

    return res.json({
      ok: true,
      groupPivot: groupResult.rows,
      storePivot: storeResult.rows,
      comments: commentsResult.rows,
    });
  } catch (err) {
    console.error("SalesOrder experience analytics error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load analytics." });
  }
});

module.exports = {
  router,
  recordDocumentCreated,
};
