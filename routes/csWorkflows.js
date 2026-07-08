const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsPostRaw } = require("../netsuiteClient");
const { getNetSuiteAccountDash } = require("../utils/netsuiteEnvironment");

const router = express.Router();

let initialized = false;
let initializing = null;

async function ensureTables() {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cs_workflows (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        definition JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cs_workflow_record_types (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        internal_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cs_workflow_record_fields (
        id SERIAL PRIMARY KEY,
        record_type_id INTEGER NOT NULL REFERENCES cs_workflow_record_types(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        internal_id TEXT NOT NULL,
        field_type TEXT NOT NULL,
        list_values_query TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cs_workflow_record_sublists (
        id SERIAL PRIMARY KEY,
        record_type_id INTEGER NOT NULL REFERENCES cs_workflow_record_types(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        internal_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cs_workflow_record_sublist_fields (
        id SERIAL PRIMARY KEY,
        sublist_id INTEGER NOT NULL REFERENCES cs_workflow_record_sublists(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        internal_id TEXT NOT NULL,
        field_type TEXT NOT NULL,
        list_values_query TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    initialized = true;
  })();

  try {
    await initializing;
  } finally {
    initializing = null;
  }
}

function suiteQlUrl() {
  return `https://${getNetSuiteAccountDash()}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

async function resolveSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return getSession(token);
}

function normalizeListOption(row = {}) {
  const id = String(row.id ?? row.ID ?? row.value ?? row.Value ?? "").trim();
  const name = String(
    row.name ??
    row.Name ??
    row.altname ??
    row.altName ??
    row.ALTNAME ??
    row.companyname ??
    row.companyName ??
    row.COMPANYNAME ??
    row.label ??
    row.Label ??
    row.displayname ??
    row.displayName ??
    row.entityid ??
    row.entityId ??
    row.ENTITYID ??
    id
  ).trim();
  return id || name ? { id, name: name || id } : null;
}

async function runSuiteQlPaged(query, userId, { maxRows = 1000 } = {}) {
  const limit = 1000;
  let offset = 0;
  const rows = [];
  let lastResult = null;

  while (rows.length < maxRows) {
    const url = `${suiteQlUrl()}?limit=${limit}&offset=${offset}`;
    const result = await nsPostRaw(url, { q: query }, userId);
    const items = Array.isArray(result?.items) ? result.items : [];
    rows.push(...items.slice(0, Math.max(0, maxRows - rows.length)));
    lastResult = result;
    offset += items.length;

    if (rows.length >= maxRows || !items.length || items.length < limit || result?.hasMore === false) break;
  }

  return {
    rows: rows.slice(0, maxRows),
    raw: lastResult,
    capped: rows.length >= maxRows && lastResult?.hasMore !== false,
  };
}

function normalizeWorkflow(row = {}) {
  return {
    id: row.id,
    name: row.name || "",
    description: row.description || "",
    definition: row.definition || { nodes: [], edges: [] },
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeDefinition(definition = {}) {
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition.edges) ? definition.edges : [];
  const criteria = Array.isArray(definition.criteria) ? definition.criteria : [];
  const rawSettings = definition.settings && typeof definition.settings === "object" ? definition.settings : {};
  const settings = {
    executionMode: rawSettings.executionMode === "fullExecution" ? "fullExecution" : "actionMessageOnly",
    pathwayDebug: rawSettings.pathwayDebug === true,
  };
  return { nodes, edges, settings, criteria };
}

function normalizeRecord(row = {}, fields = [], sublists = []) {
  return {
    id: row.id,
    label: row.label || "",
    internalId: row.internal_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fields,
    sublists,
  };
}

function normalizeRecordField(row = {}) {
  return {
    id: row.id,
    recordTypeId: row.record_type_id,
    label: row.label || "",
    internalId: row.internal_id || "",
    fieldType: row.field_type || "",
    listValuesQuery: row.list_values_query || "",
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRecordSublist(row = {}, fields = []) {
  return {
    id: row.id,
    recordTypeId: row.record_type_id,
    label: row.label || "",
    internalId: row.internal_id || "",
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fields,
  };
}

function normalizeRecordSublistField(row = {}) {
  return {
    id: row.id,
    sublistId: row.sublist_id,
    label: row.label || "",
    internalId: row.internal_id || "",
    fieldType: row.field_type || "",
    listValuesQuery: row.list_values_query || "",
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadRecords() {
  await ensureTables();
  const [recordsResult, fieldsResult, sublistsResult, sublistFieldsResult] = await Promise.all([
    pool.query(`
      SELECT id, label, internal_id, created_at, updated_at
      FROM cs_workflow_record_types
      ORDER BY label ASC, id ASC
    `),
    pool.query(`
      SELECT id, record_type_id, label, internal_id, field_type, list_values_query, sort_order, created_at, updated_at
      FROM cs_workflow_record_fields
      ORDER BY record_type_id ASC, sort_order ASC, label ASC, id ASC
    `),
    pool.query(`
      SELECT id, record_type_id, label, internal_id, sort_order, created_at, updated_at
      FROM cs_workflow_record_sublists
      ORDER BY record_type_id ASC, sort_order ASC, label ASC, id ASC
    `),
    pool.query(`
      SELECT id, sublist_id, label, internal_id, field_type, list_values_query, sort_order, created_at, updated_at
      FROM cs_workflow_record_sublist_fields
      ORDER BY sublist_id ASC, sort_order ASC, label ASC, id ASC
    `),
  ]);
  const fieldsByRecord = new Map();
  fieldsResult.rows.map(normalizeRecordField).forEach((field) => {
    const list = fieldsByRecord.get(field.recordTypeId) || [];
    list.push(field);
    fieldsByRecord.set(field.recordTypeId, list);
  });
  const sublistFieldsBySublist = new Map();
  sublistFieldsResult.rows.map(normalizeRecordSublistField).forEach((field) => {
    const list = sublistFieldsBySublist.get(field.sublistId) || [];
    list.push(field);
    sublistFieldsBySublist.set(field.sublistId, list);
  });
  const sublistsByRecord = new Map();
  sublistsResult.rows.forEach((row) => {
    const sublist = normalizeRecordSublist(row, sublistFieldsBySublist.get(row.id) || []);
    const list = sublistsByRecord.get(sublist.recordTypeId) || [];
    list.push(sublist);
    sublistsByRecord.set(sublist.recordTypeId, list);
  });
  return recordsResult.rows.map((row) => normalizeRecord(row, fieldsByRecord.get(row.id) || [], sublistsByRecord.get(row.id) || []));
}

router.get("/", async (req, res) => {
  try {
    await ensureTables();
    const result = await pool.query(`
      SELECT id, name, description, definition, is_active, created_at, updated_at
      FROM cs_workflows
      ORDER BY updated_at DESC, name ASC
    `);
    res.json({ ok: true, workflows: result.rows.map(normalizeWorkflow) });
  } catch (err) {
    console.error("GET /api/cs-workflows error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load workflows" });
  }
});

router.get("/records", async (req, res) => {
  try {
    const records = await loadRecords();
    res.json({ ok: true, records });
  } catch (err) {
    console.error("GET /api/cs-workflows/records error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load workflow records" });
  }
});

router.post("/records", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    if (!label) return res.status(400).json({ ok: false, error: "Record label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Record Type ID is required" });
    const result = await pool.query(
      `INSERT INTO cs_workflow_record_types (label, internal_id, updated_at)
       VALUES ($1, $2, NOW())
       RETURNING id, label, internal_id, created_at, updated_at`,
      [label, internalId]
    );
    res.json({ ok: true, record: normalizeRecord(result.rows[0], []) });
  } catch (err) {
    console.error("POST /api/cs-workflows/records error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow record" });
  }
});

router.put("/records/:recordId", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    if (!label) return res.status(400).json({ ok: false, error: "Record label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Record Type ID is required" });
    const result = await pool.query(
      `UPDATE cs_workflow_record_types
          SET label = $1, internal_id = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, label, internal_id, created_at, updated_at`,
      [label, internalId, req.params.recordId]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Record not found" });
    const records = await loadRecords();
    res.json({ ok: true, record: records.find((record) => String(record.id) === String(req.params.recordId)) || normalizeRecord(result.rows[0], []) });
  } catch (err) {
    console.error("PUT /api/cs-workflows/records/:recordId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow record" });
  }
});

router.delete("/records/:recordId", async (req, res) => {
  try {
    await ensureTables();
    await pool.query("DELETE FROM cs_workflow_record_types WHERE id = $1", [req.params.recordId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cs-workflows/records/:recordId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to delete workflow record" });
  }
});

router.post("/records/:recordId/fields", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    const fieldType = String(req.body?.fieldType || req.body?.field_type || "").trim();
    const listValuesQuery = String(req.body?.listValuesQuery || req.body?.list_values_query || "").trim();
    const sortOrder = Number(req.body?.sortOrder || req.body?.sort_order || 0);
    if (!label) return res.status(400).json({ ok: false, error: "Field label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Field internal id is required" });
    if (!fieldType) return res.status(400).json({ ok: false, error: "Field type is required" });
    const result = await pool.query(
      `INSERT INTO cs_workflow_record_fields (record_type_id, label, internal_id, field_type, list_values_query, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, record_type_id, label, internal_id, field_type, list_values_query, sort_order, created_at, updated_at`,
      [req.params.recordId, label, internalId, fieldType, listValuesQuery, Number.isFinite(sortOrder) ? sortOrder : 0]
    );
    res.json({ ok: true, field: normalizeRecordField(result.rows[0]) });
  } catch (err) {
    console.error("POST /api/cs-workflows/records/:recordId/fields error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow record field" });
  }
});

router.put("/records/:recordId/fields/:fieldId", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    const fieldType = String(req.body?.fieldType || req.body?.field_type || "").trim();
    const listValuesQuery = String(req.body?.listValuesQuery || req.body?.list_values_query || "").trim();
    const sortOrder = Number(req.body?.sortOrder || req.body?.sort_order || 0);
    if (!label) return res.status(400).json({ ok: false, error: "Field label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Field internal id is required" });
    if (!fieldType) return res.status(400).json({ ok: false, error: "Field type is required" });
    const result = await pool.query(
      `UPDATE cs_workflow_record_fields
          SET label = $1,
              internal_id = $2,
              field_type = $3,
              list_values_query = $4,
              sort_order = $5,
              updated_at = NOW()
        WHERE id = $6 AND record_type_id = $7
        RETURNING id, record_type_id, label, internal_id, field_type, list_values_query, sort_order, created_at, updated_at`,
      [label, internalId, fieldType, listValuesQuery, Number.isFinite(sortOrder) ? sortOrder : 0, req.params.fieldId, req.params.recordId]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Field not found" });
    res.json({ ok: true, field: normalizeRecordField(result.rows[0]) });
  } catch (err) {
    console.error("PUT /api/cs-workflows/records/:recordId/fields/:fieldId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow record field" });
  }
});

router.delete("/records/:recordId/fields/:fieldId", async (req, res) => {
  try {
    await ensureTables();
    await pool.query("DELETE FROM cs_workflow_record_fields WHERE id = $1 AND record_type_id = $2", [req.params.fieldId, req.params.recordId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cs-workflows/records/:recordId/fields/:fieldId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to delete workflow record field" });
  }
});

router.get("/records/:recordId/fields/:fieldId/options", async (req, res) => {
  try {
    await ensureTables();
    const session = await resolveSession(req);
    const userId = session?.id || session?.user_id || null;
    const result = await pool.query(
      `SELECT id, field_type, list_values_query
         FROM cs_workflow_record_fields
        WHERE id = $1 AND record_type_id = $2`,
      [req.params.fieldId, req.params.recordId]
    );
    const field = result.rows[0];
    if (!field) return res.status(404).json({ ok: false, error: "Field not found" });
    const fieldType = String(field.field_type || "").trim().toLowerCase();
    if (!["list/record", "multiple select"].includes(fieldType)) {
      return res.status(400).json({ ok: false, error: "Field does not use list values" });
    }
    const query = String(field.list_values_query || "").trim();
    if (!query) return res.json({ ok: true, options: [] });

    const nsResult = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
    const search = String(req.query.q || "").trim().toLowerCase();
    const options = (Array.isArray(nsResult?.items) ? nsResult.items : [])
      .map(normalizeListOption)
      .filter(Boolean)
      .filter((option) => !search || option.id.toLowerCase().includes(search) || option.name.toLowerCase().includes(search))
      .slice(0, 50);
    res.json({ ok: true, options });
  } catch (err) {
    console.error("GET /api/cs-workflows/records/:recordId/fields/:fieldId/options error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load field options" });
  }
});

router.post("/records/:recordId/sublists", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    const sortOrder = Number(req.body?.sortOrder || req.body?.sort_order || 0);
    if (!label) return res.status(400).json({ ok: false, error: "Sublist label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Sublist ID is required" });
    const result = await pool.query(
      `INSERT INTO cs_workflow_record_sublists (record_type_id, label, internal_id, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, record_type_id, label, internal_id, sort_order, created_at, updated_at`,
      [req.params.recordId, label, internalId, Number.isFinite(sortOrder) ? sortOrder : 0]
    );
    res.json({ ok: true, sublist: normalizeRecordSublist(result.rows[0], []) });
  } catch (err) {
    console.error("POST /api/cs-workflows/records/:recordId/sublists error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow sublist" });
  }
});

router.put("/records/:recordId/sublists/:sublistId", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    const sortOrder = Number(req.body?.sortOrder || req.body?.sort_order || 0);
    if (!label) return res.status(400).json({ ok: false, error: "Sublist label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Sublist ID is required" });
    const result = await pool.query(
      `UPDATE cs_workflow_record_sublists
          SET label = $1, internal_id = $2, sort_order = $3, updated_at = NOW()
        WHERE id = $4 AND record_type_id = $5
        RETURNING id, record_type_id, label, internal_id, sort_order, created_at, updated_at`,
      [label, internalId, Number.isFinite(sortOrder) ? sortOrder : 0, req.params.sublistId, req.params.recordId]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Sublist not found" });
    res.json({ ok: true, sublist: normalizeRecordSublist(result.rows[0], []) });
  } catch (err) {
    console.error("PUT /api/cs-workflows/records/:recordId/sublists/:sublistId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow sublist" });
  }
});

router.delete("/records/:recordId/sublists/:sublistId", async (req, res) => {
  try {
    await ensureTables();
    await pool.query("DELETE FROM cs_workflow_record_sublists WHERE id = $1 AND record_type_id = $2", [req.params.sublistId, req.params.recordId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cs-workflows/records/:recordId/sublists/:sublistId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to delete workflow sublist" });
  }
});

router.post("/records/:recordId/sublists/:sublistId/fields", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    const fieldType = String(req.body?.fieldType || req.body?.field_type || "").trim();
    const listValuesQuery = String(req.body?.listValuesQuery || req.body?.list_values_query || "").trim();
    const sortOrder = Number(req.body?.sortOrder || req.body?.sort_order || 0);
    if (!label) return res.status(400).json({ ok: false, error: "Sublist field label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Sublist field internal id is required" });
    if (!fieldType) return res.status(400).json({ ok: false, error: "Sublist field type is required" });
    const result = await pool.query(
      `INSERT INTO cs_workflow_record_sublist_fields (sublist_id, label, internal_id, field_type, list_values_query, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, sublist_id, label, internal_id, field_type, list_values_query, sort_order, created_at, updated_at`,
      [req.params.sublistId, label, internalId, fieldType, listValuesQuery, Number.isFinite(sortOrder) ? sortOrder : 0]
    );
    res.json({ ok: true, field: normalizeRecordSublistField(result.rows[0]) });
  } catch (err) {
    console.error("POST /api/cs-workflows/records/:recordId/sublists/:sublistId/fields error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow sublist field" });
  }
});

router.put("/records/:recordId/sublists/:sublistId/fields/:fieldId", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "").trim();
    const internalId = String(req.body?.internalId || req.body?.internal_id || "").trim();
    const fieldType = String(req.body?.fieldType || req.body?.field_type || "").trim();
    const listValuesQuery = String(req.body?.listValuesQuery || req.body?.list_values_query || "").trim();
    const sortOrder = Number(req.body?.sortOrder || req.body?.sort_order || 0);
    if (!label) return res.status(400).json({ ok: false, error: "Sublist field label is required" });
    if (!internalId) return res.status(400).json({ ok: false, error: "Sublist field internal id is required" });
    if (!fieldType) return res.status(400).json({ ok: false, error: "Sublist field type is required" });
    const result = await pool.query(
      `UPDATE cs_workflow_record_sublist_fields
          SET label = $1, internal_id = $2, field_type = $3, list_values_query = $4, sort_order = $5, updated_at = NOW()
        WHERE id = $6 AND sublist_id = $7
        RETURNING id, sublist_id, label, internal_id, field_type, list_values_query, sort_order, created_at, updated_at`,
      [label, internalId, fieldType, listValuesQuery, Number.isFinite(sortOrder) ? sortOrder : 0, req.params.fieldId, req.params.sublistId]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Sublist field not found" });
    res.json({ ok: true, field: normalizeRecordSublistField(result.rows[0]) });
  } catch (err) {
    console.error("PUT /api/cs-workflows/records/:recordId/sublists/:sublistId/fields/:fieldId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow sublist field" });
  }
});

router.delete("/records/:recordId/sublists/:sublistId/fields/:fieldId", async (req, res) => {
  try {
    await ensureTables();
    await pool.query("DELETE FROM cs_workflow_record_sublist_fields WHERE id = $1 AND sublist_id = $2", [req.params.fieldId, req.params.sublistId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/cs-workflows/records/:recordId/sublists/:sublistId/fields/:fieldId error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to delete workflow sublist field" });
  }
});

router.post("/suiteql/run", async (req, res) => {
  const startedAt = Date.now();
  try {
    const session = await resolveSession(req);
    const userId = session?.id || session?.user_id || null;
    const query = String(req.body?.query || req.body?.suiteql || "").trim();
    if (!query) return res.status(400).json({ ok: false, error: "SuiteQL query is required" });

    const maxRows = Math.min(Math.max(Number(req.body?.maxRows || 1000), 1), 5000);
    const result = await runSuiteQlPaged(query, userId, { maxRows });
    res.json({
      ok: true,
      count: result.rows.length,
      elapsedMs: Date.now() - startedAt,
      capped: result.capped,
      rows: result.rows,
      raw: {
        count: result.rows.length,
        capped: result.capped,
        hasMore: result.raw?.hasMore ?? result.capped,
        links: result.raw?.links || [],
        offset: result.raw?.offset,
        totalResults: result.raw?.totalResults,
        preview: result.rows.slice(0, 100),
      },
    });
  } catch (err) {
    console.error("POST /api/cs-workflows/suiteql/run error:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message || "Failed to run SuiteQL",
      elapsedMs: Date.now() - startedAt,
      details: err.responseBody || null,
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    await ensureTables();
    const result = await pool.query(
      `SELECT id, name, description, definition, is_active, created_at, updated_at
       FROM cs_workflows
       WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Workflow not found" });
    res.json({ ok: true, workflow: normalizeWorkflow(result.rows[0]) });
  } catch (err) {
    console.error("GET /api/cs-workflows/:id error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load workflow" });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureTables();
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const definition = normalizeDefinition(req.body?.definition || {});
    if (!name) return res.status(400).json({ ok: false, error: "Workflow name is required" });

    const result = await pool.query(
      `INSERT INTO cs_workflows (name, description, definition, is_active, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       RETURNING id, name, description, definition, is_active, created_at, updated_at`,
      [name, description, JSON.stringify(definition), req.body?.isActive !== false]
    );
    res.json({ ok: true, workflow: normalizeWorkflow(result.rows[0]) });
  } catch (err) {
    console.error("POST /api/cs-workflows error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    await ensureTables();
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const definition = normalizeDefinition(req.body?.definition || {});
    if (!name) return res.status(400).json({ ok: false, error: "Workflow name is required" });

    const result = await pool.query(
      `UPDATE cs_workflows
          SET name = $1,
              description = $2,
              definition = $3::jsonb,
              is_active = $4,
              updated_at = NOW()
        WHERE id = $5
        RETURNING id, name, description, definition, is_active, created_at, updated_at`,
      [name, description, JSON.stringify(definition), req.body?.isActive !== false, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Workflow not found" });
    res.json({ ok: true, workflow: normalizeWorkflow(result.rows[0]) });
  } catch (err) {
    console.error("PUT /api/cs-workflows/:id error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save workflow" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await ensureTables();
    const result = await pool.query(
      `DELETE FROM cs_workflows
        WHERE id = $1
        RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Workflow not found" });
    res.json({ ok: true, id: String(result.rows[0].id) });
  } catch (err) {
    console.error("DELETE /api/cs-workflows/:id error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to delete workflow" });
  }
});

module.exports = router;
