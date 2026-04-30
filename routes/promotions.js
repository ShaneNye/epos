const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

let initialized = false;

function parseAuthToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return String(req.query.token || "").trim();
}

async function requireSession(req, res, next) {
  try {
    const token = parseAuthToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    req.session = session;
    next();
  } catch (err) {
    console.error("Promotions auth error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to validate session" });
  }
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function cleanTextArray(values) {
  const list = Array.isArray(values) ? values : [];
  return list.map(cleanText).filter(Boolean);
}

function cleanNullableTextArray(values) {
  const list = cleanTextArray(values);
  return list.length ? list : null;
}

function cleanPercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.min(100, Math.max(0, Number(amount.toFixed(2))));
}

function cleanMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(2));
}

function cleanDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function formatDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return cleanDate(value) || cleanText(value).slice(0, 10);
}

function normalizePromotionType(value) {
  const type = cleanText(value).toLowerCase();
  if (type === "basket" || type === "basketdiscount" || type === "basket_discount") {
    return "basket_discount";
  }
  return type === "upsell" ? "upsell" : "";
}

function normalizeRule(rule) {
  return {
    id: rule?.id ? Number(rule.id) : null,
    minValue: cleanMoney(rule?.minValue),
    maxValue: cleanMoney(rule?.maxValue),
    itemId: cleanText(rule?.itemId),
    itemName: cleanNullableText(rule?.itemName),
  };
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    return "Start date and end date are required.";
  }
  if (startDate > endDate) {
    return "Start date cannot be after end date.";
  }
  return "";
}

function validateBasketRules(rules) {
  if (!Array.isArray(rules) || !rules.length) {
    return "At least one basket discount row is required.";
  }

  const normalized = rules.map(normalizeRule);
  for (const rule of normalized) {
    if (!rule.itemId) {
      return "Each basket discount row must include an item.";
    }
    if (rule.minValue < 0 || rule.maxValue < 0) {
      return "Basket discount ranges cannot be negative.";
    }
    if (rule.minValue > rule.maxValue) {
      return "Basket discount minimum value cannot be greater than maximum value.";
    }
  }

  const sorted = normalized
    .map((rule, index) => ({ ...rule, index }))
    .sort((a, b) => a.minValue - b.minValue || a.maxValue - b.maxValue);

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (current.minValue <= previous.maxValue) {
      return `Basket discount ranges cannot overlap. Check rows ${previous.index + 1} and ${current.index + 1}.`;
    }
  }

  return "";
}

async function ensureTables() {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promotions (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('upsell', 'basket_discount')),
      title TEXT NOT NULL,
      message TEXT,
      trigger_item_id TEXT,
      trigger_item_name TEXT,
      trigger_item_ids TEXT[],
      trigger_item_names TEXT[],
      trigger_class TEXT,
      trigger_size TEXT,
      trigger_category TEXT,
      suggested_item_id TEXT,
      suggested_item_name TEXT,
      discount_percent NUMERIC(5,2),
      exclude_clearance BOOLEAN NOT NULL DEFAULT FALSE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS promotion_basket_rules (
      id SERIAL PRIMARY KEY,
      promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
      min_value NUMERIC(10,2) NOT NULL,
      max_value NUMERIC(10,2) NOT NULL,
      item_id TEXT NOT NULL,
      item_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_promotions_type_dates
      ON promotions(type, is_active, start_date, end_date);

    CREATE INDEX IF NOT EXISTS idx_promotion_basket_rules_parent
      ON promotion_basket_rules(promotion_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS trigger_item_ids TEXT[];
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS trigger_item_names TEXT[];
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS trigger_class TEXT;
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS trigger_size TEXT;
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS trigger_category TEXT;
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS exclude_clearance BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  initialized = true;
}

function settingBool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = cleanText(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

function normalizePromotionEnvironment(value) {
  return String(value || process.env.ENVIROMENT || process.env.ENVIRONMENT || "sandbox").trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function promotionSettingKeys(env) {
  const normalized = normalizePromotionEnvironment(env);
  return {
    upsells: `promotions.${normalized}.upsells.enabled`,
    basketDiscounts: `promotions.${normalized}.basket_discounts.enabled`,
  };
}

async function getPromotionFeatureSettings(env) {
  await ensureTables();
  const keys = promotionSettingKeys(env);
  const result = await pool.query(
    "SELECT key, value FROM app_settings WHERE key = ANY($1::text[])",
    [[keys.upsells, keys.basketDiscounts]]
  );
  const settings = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  return {
    environment: normalizePromotionEnvironment(env),
    upsellsEnabled: settingBool(settings[keys.upsells], true),
    basketDiscountsEnabled: settingBool(settings[keys.basketDiscounts], true),
  };
}

async function getAllPromotionFeatureSettings() {
  const [production, sandbox] = await Promise.all([
    getPromotionFeatureSettings("production"),
    getPromotionFeatureSettings("sandbox"),
  ]);
  return { production, sandbox };
}

async function savePromotionFeatureSettings(payload, env) {
  await ensureTables();
  const keys = promotionSettingKeys(env);
  const settings = {
    [keys.upsells]: settingBool(payload?.upsellsEnabled, true),
    [keys.basketDiscounts]: settingBool(payload?.basketDiscountsEnabled, true),
  };

  for (const [key, value] of Object.entries(settings)) {
    await pool.query(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      [key, value ? "true" : "false"]
    );
  }

  return getPromotionFeatureSettings(env);
}

async function saveAllPromotionFeatureSettings(payload) {
  const productionPayload = payload?.production || {};
  const sandboxPayload = payload?.sandbox || {};
  const [production, sandbox] = await Promise.all([
    savePromotionFeatureSettings(productionPayload, "production"),
    savePromotionFeatureSettings(sandboxPayload, "sandbox"),
  ]);
  return { production, sandbox };
}

async function listPromotions() {
  await ensureTables();

  const result = await pool.query(`
    SELECT
      p.id,
      p.type,
      p.title,
      p.message,
      p.trigger_item_id,
      p.trigger_item_name,
      p.trigger_item_ids,
      p.trigger_item_names,
      p.trigger_class,
      p.trigger_size,
      p.trigger_category,
      p.suggested_item_id,
      p.suggested_item_name,
      p.discount_percent,
      p.exclude_clearance,
      p.start_date,
      p.end_date,
      p.is_active,
      p.created_by,
      p.created_at,
      p.updated_at,
      COALESCE(
        json_agg(
          json_build_object(
            'id', r.id,
            'minValue', r.min_value,
            'maxValue', r.max_value,
            'itemId', r.item_id,
            'itemName', r.item_name
          )
          ORDER BY r.min_value, r.max_value, r.id
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'::json
      ) AS rules
    FROM promotions p
    LEFT JOIN promotion_basket_rules r
      ON r.promotion_id = p.id
    GROUP BY p.id
    ORDER BY p.type, p.start_date DESC, p.title ASC
  `);

  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message || "",
    triggerItemId: row.trigger_item_id || "",
    triggerItemName: row.trigger_item_name || "",
    triggerItemIds: Array.isArray(row.trigger_item_ids)
      ? row.trigger_item_ids.map(cleanText).filter(Boolean)
      : row.trigger_item_id
        ? [cleanText(row.trigger_item_id)]
        : [],
    triggerItemNames: Array.isArray(row.trigger_item_names)
      ? row.trigger_item_names.map(cleanText).filter(Boolean)
      : row.trigger_item_name
        ? [cleanText(row.trigger_item_name)]
        : [],
    triggerClass: row.trigger_class || "",
    triggerSize: row.trigger_size || "",
    triggerCategory: row.trigger_category || "",
    suggestedItemId: row.suggested_item_id || "",
    suggestedItemName: row.suggested_item_name || "",
    discountPercent: Number(row.discount_percent || 0),
    excludeClearance: !!row.exclude_clearance,
    startDate: formatDateOnly(row.start_date),
    endDate: formatDateOnly(row.end_date),
    isActive: !!row.is_active,
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rules: Array.isArray(row.rules)
      ? row.rules.map((rule) => ({
          id: rule.id,
          minValue: Number(rule.minValue || 0),
          maxValue: Number(rule.maxValue || 0),
          itemId: cleanText(rule.itemId),
          itemName: cleanText(rule.itemName),
        }))
      : [],
  }));
}

async function savePromotion(client, promotionId, payload, createdBy) {
  const type = normalizePromotionType(payload.type);
  const title = cleanText(payload.title);
  const message = cleanNullableText(payload.message);
  const startDate = cleanDate(payload.startDate);
  const endDate = cleanDate(payload.endDate);
  const isActive = payload.isActive !== false;

  if (!type) {
    throw new Error("Promotion type must be upsell or basket discount.");
  }
  if (!title) {
    throw new Error("Promotion title is required.");
  }

  const dateError = validateDateRange(startDate, endDate);
  if (dateError) {
    throw new Error(dateError);
  }

  if (type === "upsell") {
    const triggerItemIds = cleanTextArray(payload.triggerItemIds);
    const triggerItemNames = cleanTextArray(payload.triggerItemNames);
    const triggerItemId = cleanText(payload.triggerItemId) || triggerItemIds[0] || "";
    const triggerItemName = cleanText(payload.triggerItemName) || triggerItemNames[0] || "";
    const triggerClass = cleanText(payload.triggerClass);
    const triggerSize = cleanText(payload.triggerSize);
    const triggerCategory = cleanText(payload.triggerCategory);
    const suggestedItemId = cleanText(payload.suggestedItemId);
    const discountPercent = cleanPercent(payload.discountPercent);

    if (!triggerItemIds.length && !triggerClass && !triggerSize && !triggerCategory) {
      throw new Error("An upsell needs at least one trigger item, class, size, or category.");
    }
    if (!suggestedItemId) {
      throw new Error("An upsell needs a suggested item.");
    }
    if (triggerItemIds.includes(suggestedItemId)) {
      throw new Error("Trigger item and suggested item cannot be the same.");
    }

    const params = [
      type,
      title,
      message,
      triggerItemId,
      cleanNullableText(triggerItemName),
      cleanNullableTextArray(triggerItemIds),
      cleanNullableTextArray(triggerItemNames),
      cleanNullableText(triggerClass),
      cleanNullableText(triggerSize),
      cleanNullableText(triggerCategory),
      suggestedItemId,
      cleanNullableText(payload.suggestedItemName),
      discountPercent,
      startDate,
      endDate,
      isActive,
      cleanNullableText(createdBy),
    ];

    let result;
    if (promotionId) {
      result = await client.query(
        `
          UPDATE promotions
             SET type = $1,
                 title = $2,
                 message = $3,
                 trigger_item_id = $4,
                 trigger_item_name = $5,
                 trigger_item_ids = $6,
                 trigger_item_names = $7,
                 trigger_class = $8,
                 trigger_size = $9,
                 trigger_category = $10,
                 suggested_item_id = $11,
                 suggested_item_name = $12,
                 discount_percent = $13,
                 start_date = $14,
                 end_date = $15,
                 is_active = $16,
                 updated_at = NOW()
           WHERE id = $17
           RETURNING id
        `,
        [...params.slice(0, 16), promotionId]
      );
      await client.query("DELETE FROM promotion_basket_rules WHERE promotion_id = $1", [promotionId]);
    } else {
      result = await client.query(
        `
          INSERT INTO promotions (
            type,
            title,
            message,
            trigger_item_id,
            trigger_item_name,
            trigger_item_ids,
            trigger_item_names,
            trigger_class,
            trigger_size,
            trigger_category,
            suggested_item_id,
            suggested_item_name,
            discount_percent,
            start_date,
            end_date,
            is_active,
            created_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          RETURNING id
        `,
        params
      );
    }

    return result.rows[0]?.id;
  }

  const rules = Array.isArray(payload.rules) ? payload.rules.map(normalizeRule) : [];
  const ruleError = validateBasketRules(rules);
  const excludeClearance = payload.excludeClearance === true;
  if (ruleError) {
    throw new Error(ruleError);
  }

  let result;
  if (promotionId) {
    result = await client.query(
      `
        UPDATE promotions
           SET type = 'basket_discount',
               title = $1,
               message = $2,
               trigger_item_id = NULL,
               trigger_item_name = NULL,
               trigger_item_ids = NULL,
               trigger_item_names = NULL,
               trigger_class = NULL,
               trigger_size = NULL,
               trigger_category = NULL,
               suggested_item_id = NULL,
               suggested_item_name = NULL,
               discount_percent = NULL,
               exclude_clearance = $3,
               start_date = $4,
               end_date = $5,
               is_active = $6,
               updated_at = NOW()
         WHERE id = $7
         RETURNING id
      `,
      [title, message, excludeClearance, startDate, endDate, isActive, promotionId]
    );
    await client.query("DELETE FROM promotion_basket_rules WHERE promotion_id = $1", [promotionId]);
  } else {
    result = await client.query(
      `
        INSERT INTO promotions (
          type,
          title,
          message,
          exclude_clearance,
          start_date,
          end_date,
          is_active,
          created_by
        )
        VALUES ('basket_discount',$1,$2,$3,$4,$5,$6,$7)
        RETURNING id
      `,
      [title, message, excludeClearance, startDate, endDate, isActive, cleanNullableText(createdBy)]
    );
  }

  const savedPromotionId = result.rows[0]?.id;
  for (const rule of rules) {
    await client.query(
      `
        INSERT INTO promotion_basket_rules (
          promotion_id,
          min_value,
          max_value,
          item_id,
          item_name
        )
        VALUES ($1,$2,$3,$4,$5)
      `,
      [savedPromotionId, rule.minValue, rule.maxValue, rule.itemId, rule.itemName]
    );
  }

  return savedPromotionId;
}

router.get("/active", requireSession, async (req, res) => {
  try {
    const activeEnvironment = normalizePromotionEnvironment(req.query.environment);
    const settings = await getPromotionFeatureSettings(activeEnvironment);
    const promotions = await listPromotions();
    const today = new Date().toISOString().slice(0, 10);
    const active = promotions.filter(
      (promotion) => promotion.isActive && promotion.startDate <= today && promotion.endDate >= today
    );

    res.json({
      ok: true,
      environment: activeEnvironment,
      settings,
      promotions: {
        upsells: settings.upsellsEnabled ? active.filter((promotion) => promotion.type === "upsell") : [],
        basketDiscounts: settings.basketDiscountsEnabled ? active.filter((promotion) => promotion.type === "basket_discount") : [],
      },
    });
  } catch (err) {
    console.error("GET /api/promotions/active error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load active promotions" });
  }
});

router.get("/settings", requireSession, async (req, res) => {
  try {
    const activeEnvironment = normalizePromotionEnvironment(req.query.environment);
    const settings = await getAllPromotionFeatureSettings();
    res.json({ ok: true, environment: activeEnvironment, settings });
  } catch (err) {
    console.error("GET /api/promotions/settings error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load promotion settings" });
  }
});

router.put("/settings", requireSession, async (req, res) => {
  try {
    const activeEnvironment = normalizePromotionEnvironment(req.body?.environment || req.query.environment);
    const settings = req.body?.settings
      ? await saveAllPromotionFeatureSettings(req.body.settings)
      : { [activeEnvironment]: await savePromotionFeatureSettings(req.body || {}, activeEnvironment) };
    res.json({ ok: true, environment: activeEnvironment, settings });
  } catch (err) {
    console.error("PUT /api/promotions/settings error:", err.message);
    res.status(400).json({ ok: false, error: err.message || "Failed to save promotion settings" });
  }
});

router.get("/", requireSession, async (req, res) => {
  try {
    const promotions = await listPromotions();
    res.json({ ok: true, promotions });
  } catch (err) {
    console.error("GET /api/promotions error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to load promotions" });
  }
});

router.post("/", requireSession, async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureTables();
    await client.query("BEGIN");
    const createdBy = cleanText(req.session?.email || req.session?.username || "");
    const promotionId = await savePromotion(client, null, req.body || {}, createdBy);
    await client.query("COMMIT");

    const promotions = await listPromotions();
    const promotion = promotions.find((entry) => Number(entry.id) === Number(promotionId));
    res.json({ ok: true, promotion });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/promotions error:", err.message);
    res.status(400).json({ ok: false, error: err.message || "Failed to create promotion" });
  } finally {
    client.release();
  }
});

router.put("/:id", requireSession, async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureTables();
    await client.query("BEGIN");

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Invalid promotion id.");
    }

    const exists = await client.query("SELECT id FROM promotions WHERE id = $1", [id]);
    if (!exists.rowCount) {
      const notFoundError = new Error("Promotion not found");
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    await savePromotion(client, id, req.body || {}, req.session?.email || "");
    await client.query("COMMIT");

    const promotions = await listPromotions();
    const promotion = promotions.find((entry) => Number(entry.id) === id);
    res.json({ ok: true, promotion });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/promotions/:id error:", err.message);
    res.status(err.statusCode || 400).json({ ok: false, error: err.message || "Failed to update promotion" });
  } finally {
    client.release();
  }
});

router.delete("/:id", requireSession, async (req, res) => {
  try {
    await ensureTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid promotion id." });
    }

    const result = await pool.query("DELETE FROM promotions WHERE id = $1 RETURNING id", [id]);
    if (!result.rowCount) {
      return res.status(404).json({ ok: false, error: "Promotion not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/promotions/:id error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to delete promotion" });
  }
});

module.exports = router;
