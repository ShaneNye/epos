const express = require("express");
const fetch = require("node-fetch");
const pool = require("../db");

const router = express.Router();

const DEFAULT_OPTIONS_URL =
  "https://7972741.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4524&deploy=1&compid=7972741&ns-at=AAEJ7tMQDzLokAZEodyE-6Qceqh8hYAGgV0ddpVFQ7uMM2bc3eA";

const OPTIONS_URL = process.env.ITEM_OPTIONS_URL || DEFAULT_OPTIONS_URL;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = Number(process.env.ITEM_OPTIONS_FETCH_TIMEOUT_MS || 30000);

let initialized = false;
let syncInFlight = null;
let schedulerStarted = false;

function cleanText(value) {
  return String(value ?? "").trim();
}

function isExcludedOptionField(option) {
  const label = cleanText(option?.label).toLowerCase();
  const selectText = cleanText(option?.selectrecordtype_text).toLowerCase();
  const sourceName = cleanText(option?.sourceResult?.source?.name).toLowerCase();

  return [label, selectText, sourceName].some((value) =>
    /^base\s+options?$/i.test(value) || /^fabric\s+type$/i.test(value)
  );
}

function makePageUrl(page, pageSize) {
  const url = new URL(OPTIONS_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  return url.toString();
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`NetSuite item options endpoint returned ${resp.status}`);
    }
    return resp.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`NetSuite item options endpoint timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureTables() {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS item_option_sync_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'never_run',
      last_synced_at TIMESTAMPTZ,
      configured_count INTEGER,
      total_records INTEGER,
      error TEXT,
      CONSTRAINT item_option_sync_state_singleton CHECK (id = 1)
    );

    INSERT INTO item_option_sync_state (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS item_option_fields (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      script_id TEXT,
      inactive BOOLEAN NOT NULL DEFAULT FALSE,
      select_record_type TEXT,
      select_record_type_text TEXT,
      include_child_items BOOLEAN NOT NULL DEFAULT FALSE,
      applies_to_sales BOOLEAN NOT NULL DEFAULT FALSE,
      source_kind TEXT,
      source_id TEXT,
      source_script_id TEXT,
      source_name TEXT,
      source_ok BOOLEAN NOT NULL DEFAULT FALSE,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS item_option_values (
      field_id TEXT NOT NULL REFERENCES item_option_fields(id) ON DELETE CASCADE,
      value_id TEXT NOT NULL,
      name TEXT NOT NULL,
      inactive BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (field_id, value_id)
    );

    CREATE TABLE IF NOT EXISTS item_option_applied_items (
      field_id TEXT NOT NULL REFERENCES item_option_fields(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      item_name TEXT,
      display_name TEXT,
      item_type TEXT,
      inactive BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (field_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_option_applied_items_item_id
      ON item_option_applied_items(item_id);
  `);

  initialized = true;
}

async function fetchAllOptionPages() {
  const pageSize = Number(process.env.ITEM_OPTIONS_PAGE_SIZE || 25);
  console.log("📡 Item options page 1 fetching...");
  const first = await fetchJsonWithTimeout(makePageUrl(1, pageSize));
  const totalPages = Number(first?.meta?.totalPages || 1);
  const results = Array.isArray(first?.results) ? [...first.results] : [];

  for (let page = 2; page <= totalPages; page += 1) {
    console.log(`📡 Item options page ${page}/${totalPages} fetching...`);
    const json = await fetchJsonWithTimeout(makePageUrl(page, pageSize));
    if (Array.isArray(json?.results)) results.push(...json.results);
  }

  return {
    configuredCount: Number(first?.meta?.configuredCount || results.length),
    totalRecords: Number(first?.meta?.totalRecords || results.length),
    results,
  };
}

async function syncItemOptions() {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    await ensureTables();

    const startedAt = new Date();
    console.log("📡 Item options sync starting...");

    try {
      const payload = await fetchAllOptionPages();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM item_option_fields");

        const fieldRows = [];
        const valueRows = [];
        const appliedItemRows = [];

        for (const option of payload.results) {
          if (isExcludedOptionField(option)) continue;

          const fieldId = cleanText(option.id);
          const label = cleanText(option.label);
          if (!fieldId || !label) continue;

          const source = option.sourceResult?.source || {};
          fieldRows.push({
            id: fieldId,
            label,
            script_id: cleanText(option.scriptId) || null,
            inactive: !!option.inactive,
            select_record_type: cleanText(option.selectrecordtype) || null,
            select_record_type_text: cleanText(option.selectrecordtype_text) || null,
            include_child_items: !!option.includeChildItems,
            applies_to_sales: !!option.appliesToSales,
            source_kind: cleanText(option.sourceResult?.kind) || null,
            source_id: cleanText(source.id) || null,
            source_script_id: cleanText(source.scriptId) || null,
            source_name: cleanText(source.name) || null,
            source_ok: !!option.sourceResult?.ok,
            raw: option,
          });

          const values = Array.isArray(option.sourceResult?.values)
            ? option.sourceResult.values
            : [];

          for (const [idx, value] of values.entries()) {
            const valueId = cleanText(value.id);
            const name = cleanText(value.name);
            if (!valueId || !name) continue;

            valueRows.push({
              field_id: fieldId,
              value_id: valueId,
              name,
              inactive: !!value.inactive,
              sort_order: idx,
            });
          }

          const appliedItems = Array.isArray(option.appliedItems)
            ? option.appliedItems
            : [];

          for (const item of appliedItems) {
            const itemId = cleanText(item.id);
            if (!itemId) continue;

            appliedItemRows.push({
              field_id: fieldId,
              item_id: itemId,
              item_name: cleanText(item.itemId) || null,
              display_name: cleanText(item.displayName) || null,
              item_type: cleanText(item.type) || null,
              inactive: !!item.inactive,
            });
          }
        }

        await client.query(
          `
          INSERT INTO item_option_fields (
            id, label, script_id, inactive, select_record_type,
            select_record_type_text, include_child_items, applies_to_sales,
            source_kind, source_id, source_script_id, source_name, source_ok,
            raw, updated_at
          )
          SELECT
            id, label, script_id, inactive, select_record_type,
            select_record_type_text, include_child_items, applies_to_sales,
            source_kind, source_id, source_script_id, source_name, source_ok,
            raw, NOW()
          FROM jsonb_to_recordset($1::jsonb) AS x(
            id TEXT,
            label TEXT,
            script_id TEXT,
            inactive BOOLEAN,
            select_record_type TEXT,
            select_record_type_text TEXT,
            include_child_items BOOLEAN,
            applies_to_sales BOOLEAN,
            source_kind TEXT,
            source_id TEXT,
            source_script_id TEXT,
            source_name TEXT,
            source_ok BOOLEAN,
            raw JSONB
          )
          `,
          [JSON.stringify(fieldRows)]
        );

        if (valueRows.length) {
          await client.query(
            `
            INSERT INTO item_option_values (field_id, value_id, name, inactive, sort_order)
            SELECT field_id, value_id, name, inactive, sort_order
            FROM jsonb_to_recordset($1::jsonb) AS x(
              field_id TEXT,
              value_id TEXT,
              name TEXT,
              inactive BOOLEAN,
              sort_order INTEGER
            )
            `,
            [JSON.stringify(valueRows)]
          );
        }

        if (appliedItemRows.length) {
          await client.query(
            `
            INSERT INTO item_option_applied_items (
              field_id, item_id, item_name, display_name, item_type, inactive
            )
            SELECT field_id, item_id, item_name, display_name, item_type, inactive
            FROM jsonb_to_recordset($1::jsonb) AS x(
              field_id TEXT,
              item_id TEXT,
              item_name TEXT,
              display_name TEXT,
              item_type TEXT,
              inactive BOOLEAN
            )
            ON CONFLICT (field_id, item_id) DO NOTHING
            `,
            [JSON.stringify(appliedItemRows)]
          );
        }

        await client.query(
          `
          UPDATE item_option_sync_state
          SET status = 'ok',
              last_synced_at = NOW(),
              configured_count = $1,
              total_records = $2,
              error = NULL
          WHERE id = 1
          `,
          [payload.configuredCount, payload.totalRecords]
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      console.log("✅ Item options sync complete", {
        records: payload.results.length,
        ms: Date.now() - startedAt.getTime(),
      });

      return { ok: true, synced: payload.results.length };
    } catch (err) {
      await pool.query(
        `
        UPDATE item_option_sync_state
        SET status = 'error',
            error = $1
        WHERE id = 1
        `,
        [err.message]
      ).catch(() => {});

      console.error("❌ Item options sync failed:", err.message);
      throw err;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

function rowsToOptionMap(rows) {
  const byItemId = {};

  rows.forEach((row) => {
    const itemId = cleanText(row.item_id);
    const field = cleanText(row.label);
    const value = cleanText(row.value_name);
    if (!itemId || !field || !value) return;

    byItemId[itemId] = byItemId[itemId] || {};
    byItemId[itemId][field] = byItemId[itemId][field] || [];

    if (!byItemId[itemId][field].includes(value)) {
      byItemId[itemId][field].push(value);
    }
  });

  return byItemId;
}

async function getOptions(itemId) {
  await ensureTables();

  const params = [];
  let itemFilter = "";

  if (itemId) {
    params.push(String(itemId));
    itemFilter = "AND ai.item_id = $1";
  }

  const result = await pool.query(
    `
    SELECT
      ai.item_id,
      f.id AS field_id,
      f.label,
      v.value_id,
      v.name AS value_name,
      v.sort_order
    FROM item_option_applied_items ai
    JOIN item_option_fields f ON f.id = ai.field_id
    JOIN item_option_values v ON v.field_id = f.id
    WHERE f.inactive = FALSE
      AND f.applies_to_sales = TRUE
      AND f.source_ok = TRUE
      AND ai.inactive = FALSE
      AND v.inactive = FALSE
      ${itemFilter}
    ORDER BY ai.item_id, f.label, v.sort_order, v.name
    `,
    params
  );

  return rowsToOptionMap(result.rows);
}

router.get("/", async (req, res) => {
  try {
    await ensureTables();
    const itemId = req.query.itemId ? String(req.query.itemId) : "";
    const [options, state] = await Promise.all([
      getOptions(itemId),
      pool.query("SELECT * FROM item_option_sync_state WHERE id = 1"),
    ]);

    return res.json({
      ok: true,
      itemId: itemId || null,
      options: itemId ? options[itemId] || {} : options,
      byItemId: itemId ? undefined : options,
      sync: state.rows[0] || null,
    });
  } catch (err) {
    console.error("❌ GET /api/item-options error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to load item options" });
  }
});

router.post("/sync", async (req, res) => {
  try {
    const result = await syncItemOptions();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setTimeout(() => {
    syncItemOptions().catch(() => {});
  }, 5000);

  setInterval(() => {
    syncItemOptions().catch(() => {});
  }, SYNC_INTERVAL_MS);
}

module.exports = {
  router,
  startScheduler,
  syncItemOptions,
  ensureTables,
};
