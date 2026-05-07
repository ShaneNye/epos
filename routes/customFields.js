const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const RECORD_TYPES = new Set(["sales_order", "quote"]);
const FIELD_TYPES = new Set(["free_form_text", "list_record", "number", "currency"]);
const FIELD_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LIST_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

let tableReadyPromise = null;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "object") return Object.values(value);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function cleanIdList(value) {
  return Array.from(
    new Set(
      asArray(value)
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );
}

function normalizeRecordType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "salesorder") return "sales_order";
  if (normalized === "estimate") return "quote";
  return normalized;
}

function normalizeFieldType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-\s/]+/g, "_");
  if (normalized === "freeformtext") return "free_form_text";
  if (normalized === "listrecord") return "list_record";
  return normalized;
}

function publicField(row) {
  return {
    id: row.id,
    recordType: row.record_type,
    appLabel: row.app_label || "",
    fieldInternalId: row.field_internal_id,
    fieldType: row.field_type,
    listRecordInternalId: row.list_record_internal_id || "",
    accessRoleIds: cleanIdList(row.access_role_ids),
    accessUserIds: cleanIdList(row.access_user_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureCustomFieldsTable() {
  if (!tableReadyPromise) {
    tableReadyPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS custom_fields (
        id SERIAL PRIMARY KEY,
        record_type TEXT NOT NULL CHECK (record_type IN ('sales_order', 'quote')),
        app_label TEXT,
        field_internal_id TEXT NOT NULL,
        field_type TEXT NOT NULL CHECK (field_type IN ('free_form_text', 'list_record', 'number', 'currency')),
        list_record_internal_id TEXT,
        access_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        access_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (record_type, field_internal_id)
      );
      ALTER TABLE custom_fields
        ADD COLUMN IF NOT EXISTS app_label TEXT;
      UPDATE custom_fields
         SET app_label = field_internal_id
       WHERE app_label IS NULL OR TRIM(app_label) = '';
    `);
  }

  await tableReadyPromise;
}

async function resolveSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return getSession(token);
}

async function getUserRoleIds(userId) {
  if (!userId) return [];
  const result = await pool.query(
    "SELECT role_id FROM user_roles WHERE user_id = $1",
    [userId]
  );
  return result.rows.map((row) => String(row.role_id));
}

function fieldVisibleToUser(field, userId, userRoleIds) {
  const roleIds = cleanIdList(field.access_role_ids);
  const userIds = cleanIdList(field.access_user_ids);

  if (!roleIds.length && !userIds.length) return true;
  if (userId && userIds.includes(String(userId))) return true;
  return roleIds.some((roleId) => userRoleIds.includes(String(roleId)));
}

function validateFieldPayload(body) {
  const recordType = normalizeRecordType(body.recordType || body.record_type);
  const fieldType = normalizeFieldType(body.fieldType || body.field_type);
  const fieldInternalId = String(body.fieldInternalId || body.field_internal_id || "").trim();
  const appLabel = String(body.appLabel || body.app_label || "").trim();
  const listRecordInternalId = String(
    body.listRecordInternalId || body.list_record_internal_id || ""
  ).trim();
  const accessRoleIds = cleanIdList(body.accessRoleIds || body.access_role_ids);
  const accessUserIds = cleanIdList(body.accessUserIds || body.access_user_ids);

  if (!RECORD_TYPES.has(recordType)) {
    return { error: "Choose Sales Order or Quote as the record type." };
  }
  if (!FIELD_ID_PATTERN.test(fieldInternalId)) {
    return { error: "Enter a valid NetSuite field internal ID." };
  }
  if (!appLabel) {
    return { error: "Enter an app label for this field." };
  }
  if (!FIELD_TYPES.has(fieldType)) {
    return { error: "Choose a valid field type." };
  }
  if (fieldType === "list_record" && !listRecordInternalId) {
    return { error: "List/record fields need the list internal ID." };
  }

  return {
    value: {
      recordType,
      appLabel,
      fieldType,
      fieldInternalId,
      listRecordInternalId: fieldType === "list_record" ? listRecordInternalId : null,
      accessRoleIds,
      accessUserIds,
    },
  };
}

function customFieldSelectExpression(field) {
  const fieldId = String(field.field_internal_id || "").trim();
  if (!FIELD_ID_PATTERN.test(fieldId)) {
    return null;
  }

  const alias = `cf_${field.id}`;
  const displayAlias = `cf_${field.id}_display`;
  const select =
    field.field_type === "list_record"
      ? `${fieldId} AS ${alias}, BUILTIN.DF(${fieldId}) AS ${displayAlias}`
      : `${fieldId} AS ${alias}`;

  return {
    alias,
    displayAlias,
    select,
  };
}

async function loadListRecordOptions(field, userId, nsPostRaw, suiteQlUrl) {
  const listInternalId = String(field.list_record_internal_id || "").trim();
  if (field.field_type !== "list_record") return [];
  if (!LIST_ID_PATTERN.test(listInternalId)) {
    throw new Error("Invalid list internal ID");
  }

  const result = await nsPostRaw(
    suiteQlUrl(),
    {
      q: `
        SELECT id, name
        FROM ${listInternalId}
        ORDER BY name
      `,
    },
    userId
  );

  return (Array.isArray(result?.items) ? result.items : [])
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      name: String(row.name ?? row.id ?? "").trim(),
    }))
    .filter((option) => option.id || option.name);
}

async function loadVisibleCustomFields(recordType, userId) {
  await ensureCustomFieldsTable();

  const normalizedRecordType = normalizeRecordType(recordType);
  const result = await pool.query(
      `SELECT *
       FROM custom_fields
      WHERE record_type = $1
      ORDER BY app_label ASC, field_internal_id ASC`,
    [normalizedRecordType]
  );

  const userRoleIds = await getUserRoleIds(userId);
  return result.rows.filter((field) => fieldVisibleToUser(field, userId, userRoleIds));
}

async function loadTransactionCustomFieldValues({
  recordType,
  transactionId,
  userId,
  nsPostRaw,
  suiteQlUrl,
}) {
  const numericId = Number(transactionId);
  if (!Number.isFinite(numericId) || numericId <= 0) return [];

  const fields = await loadVisibleCustomFields(recordType, userId);
  if (!fields.length) return [];

  const selectFields = fields.map((field) => ({
    field,
    expression: customFieldSelectExpression(field),
  }));

  const invalidFields = selectFields
    .filter((item) => !item.expression)
    .map(({ field }) => ({
      ...publicField(field),
      value: null,
      displayValue: "",
      error: "Invalid field internal ID",
    }));

  const validFields = selectFields.filter((item) => item.expression);
  if (!validFields.length) return invalidFields;

  try {
    const result = await nsPostRaw(
      suiteQlUrl(),
      {
        q: `
          SELECT ${validFields.map((item) => item.expression.select).join(", ")}
          FROM transaction
          WHERE id = ${numericId}
        `,
      },
      userId
    );

    const row = Array.isArray(result?.items) ? result.items[0] || {} : {};
    const values = await Promise.all(validFields.map(async ({ field, expression }) => {
      const value = row[expression.alias] ?? null;
      const displayValue =
        field.field_type === "list_record"
          ? row[expression.displayAlias] || row[expression.alias] || ""
          : row[expression.alias] ?? "";

      const payload = {
        ...publicField(field),
        value,
        displayValue,
        error: null,
      };

      if (field.field_type === "list_record") {
        try {
          payload.options = await loadListRecordOptions(field, userId, nsPostRaw, suiteQlUrl);
        } catch (err) {
          payload.options = [];
          payload.optionsError = err.message || "Could not load list values";
        }
      }

      return payload;
    }));

    return [...invalidFields, ...values];
  } catch (err) {
    return fields.map((field) => ({
      ...publicField(field),
      value: null,
      displayValue: "",
      error: err.message || "Could not load field",
    }));
  }
}

function normalizeCustomFieldUpdateValue(field, rawValue) {
  if (rawValue === undefined) return { skip: true };

  if (field.field_type === "list_record") {
    const value = String(rawValue ?? "").trim();
    return { value: value ? { id: value } : null };
  }

  if (field.field_type === "number" || field.field_type === "currency") {
    if (rawValue === null || rawValue === "") return { value: null };
    const number = Number(rawValue);
    if (!Number.isFinite(number)) {
      return { error: `${field.app_label || field.field_internal_id} must be a valid number.` };
    }
    return { value: number };
  }

  return { value: String(rawValue ?? "") };
}

async function buildCustomFieldPatchPayload({ recordType, userId, updates }) {
  const fields = await loadVisibleCustomFields(recordType, userId);
  const fieldsById = new Map(fields.map((field) => [String(field.id), field]));
  const patch = {};
  const updated = [];

  for (const update of Array.isArray(updates) ? updates : []) {
    const field = fieldsById.get(String(update.id));
    if (!field) continue;
    const fieldId = String(field.field_internal_id || "").trim();
    if (!FIELD_ID_PATTERN.test(fieldId)) continue;

    const normalized = normalizeCustomFieldUpdateValue(field, update.value);
    if (normalized.skip) continue;
    if (normalized.error) return { error: normalized.error };

    patch[fieldId] = normalized.value;
    updated.push(publicField(field));
  }

  return { patch, updated };
}

router.get("/", async (req, res) => {
  try {
    await ensureCustomFieldsTable();
    const recordType = normalizeRecordType(req.query.recordType || req.query.record_type || "");
    const params = [];
    let where = "";

    if (RECORD_TYPES.has(recordType)) {
      params.push(recordType);
      where = "WHERE record_type = $1";
    }

    const result = await pool.query(
      `SELECT *
        FROM custom_fields
         ${where}
        ORDER BY record_type ASC, app_label ASC, field_internal_id ASC`,
      params
    );

    res.json({ ok: true, customFields: result.rows.map(publicField) });
  } catch (err) {
    console.error("GET /api/custom-fields failed:", err.message);
    res.status(500).json({ ok: false, error: "Database error loading custom fields" });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureCustomFieldsTable();
    const validated = validateFieldPayload(req.body || {});
    if (validated.error) return res.status(400).json({ ok: false, error: validated.error });

    const field = validated.value;
    const result = await pool.query(
      `INSERT INTO custom_fields
        (record_type, app_label, field_internal_id, field_type, list_record_internal_id, access_role_ids, access_user_ids)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        field.recordType,
        field.appLabel,
        field.fieldInternalId,
        field.fieldType,
        field.listRecordInternalId,
        JSON.stringify(field.accessRoleIds),
        JSON.stringify(field.accessUserIds),
      ]
    );

    res.json({ ok: true, customField: publicField(result.rows[0]) });
  } catch (err) {
    const duplicate = String(err.message || "").includes("custom_fields_record_type_field_internal_id_key");
    console.error("POST /api/custom-fields failed:", err.message);
    res.status(duplicate ? 409 : 500).json({
      ok: false,
      error: duplicate ? "That field is already configured for this record type." : "Database error saving custom field",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    await ensureCustomFieldsTable();
    const validated = validateFieldPayload(req.body || {});
    if (validated.error) return res.status(400).json({ ok: false, error: validated.error });

    const field = validated.value;
    const result = await pool.query(
      `UPDATE custom_fields
          SET record_type = $1,
              app_label = $2,
              field_internal_id = $3,
              field_type = $4,
              list_record_internal_id = $5,
              access_role_ids = $6::jsonb,
              access_user_ids = $7::jsonb,
              updated_at = NOW()
        WHERE id = $8
        RETURNING *`,
      [
        field.recordType,
        field.appLabel,
        field.fieldInternalId,
        field.fieldType,
        field.listRecordInternalId,
        JSON.stringify(field.accessRoleIds),
        JSON.stringify(field.accessUserIds),
        req.params.id,
      ]
    );

    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Custom field not found" });
    res.json({ ok: true, customField: publicField(result.rows[0]) });
  } catch (err) {
    const duplicate = String(err.message || "").includes("custom_fields_record_type_field_internal_id_key");
    console.error("PUT /api/custom-fields/:id failed:", err.message);
    res.status(duplicate ? 409 : 500).json({
      ok: false,
      error: duplicate ? "That field is already configured for this record type." : "Database error updating custom field",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await ensureCustomFieldsTable();
    const result = await pool.query("DELETE FROM custom_fields WHERE id = $1", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "Custom field not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/custom-fields/:id failed:", err.message);
    res.status(500).json({ ok: false, error: "Database error deleting custom field" });
  }
});

router.get("/visible", async (req, res) => {
  try {
    const session = await resolveSession(req);
    const userId = session?.id || session?.user_id || null;
    const recordType = normalizeRecordType(req.query.recordType || req.query.record_type || "");
    if (!RECORD_TYPES.has(recordType)) {
      return res.status(400).json({ ok: false, error: "Invalid record type" });
    }

    const fields = await loadVisibleCustomFields(recordType, userId);
    res.json({ ok: true, customFields: fields.map(publicField) });
  } catch (err) {
    console.error("GET /api/custom-fields/visible failed:", err.message);
    res.status(500).json({ ok: false, error: "Database error loading custom fields" });
  }
});

router.ensureCustomFieldsTable = ensureCustomFieldsTable;
router.loadVisibleCustomFields = loadVisibleCustomFields;
router.loadTransactionCustomFieldValues = loadTransactionCustomFieldValues;
router.buildCustomFieldPatchPayload = buildCustomFieldPatchPayload;

module.exports = router;
