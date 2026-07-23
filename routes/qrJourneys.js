const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");
const pool = require("../db");
const { getSession } = require("../sessions");
const { nsGet, nsPost, nsPostRaw } = require("../netsuiteClient");
const { createNetSuiteCustomer } = require("../utils/netsuiteCustomerCreate");
const sendEmail = require("../utils/sendEmail");
const { buildFinanceSummaryPdf } = require("../utils/quotePdf");
const { buildHtmlQuoteReceiptPdf } = require("../utils/htmlQuoteReceiptPdf");
const { resolveQrNetSuiteContext } = require("../utils/qrNetSuiteUser");

const router = express.Router();
let initialized = false;

async function ensureTables() {
  if (initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS qr_finance_journeys (
      token TEXT PRIMARY KEY,
      location_id INTEGER,
      location_name TEXT NOT NULL,
      bin_name TEXT NOT NULL,
      products JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '180 days')
    );
    CREATE TABLE IF NOT EXISTS qr_quote_requests (
      id BIGSERIAL PRIMARY KEY,
      journey_token TEXT NOT NULL REFERENCES qr_finance_journeys(token),
      location_id INTEGER,
      location_name TEXT NOT NULL,
      bin_name TEXT NOT NULL,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      finance JSONB NOT NULL DEFAULT '{}'::jsonb,
      customer JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'new'
    );
    ALTER TABLE qr_quote_requests ADD COLUMN IF NOT EXISTS request_key TEXT;
    ALTER TABLE qr_quote_requests ADD COLUMN IF NOT EXISTS netsuite_quote_id TEXT;
    ALTER TABLE qr_quote_requests ADD COLUMN IF NOT EXISTS netsuite_quote_number TEXT;
    ALTER TABLE qr_quote_requests ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;
    ALTER TABLE qr_quote_requests ADD COLUMN IF NOT EXISTS last_error TEXT;
    ALTER TABLE qr_quote_requests ADD COLUMN IF NOT EXISTS netsuite_user_id INTEGER;
    CREATE UNIQUE INDEX IF NOT EXISTS qr_quote_requests_journey_request_key_uidx
      ON qr_quote_requests(journey_token, request_key)
      WHERE request_key IS NOT NULL;
  `);
  initialized = true;
}

function clean(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function htmlEscape(value) {
  return clean(value, 1000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function suiteQlUrl() {
  return `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

function sqlText(value) {
  return clean(value, 300).replace(/'/g, "''");
}

async function sessionFromRequest(req) {
  const header = String(req.headers.authorization || "");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return token ? getSession(token) : null;
}

async function suiteQl(query, userId) {
  const result = await nsPostRaw(`${suiteQlUrl()}?limit=1000&offset=0`, { q: query }, userId);
  return Array.isArray(result?.items) ? result.items : [];
}

function numericIds(values) {
  return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

router.get("/inventory", async (req, res) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session) return res.status(401).json({ ok: false, error: "Not authenticated" });
    const userId = session.id || session.user_id || null;
    const appLocationId = Number(req.query.locationId) || null;
    let location = clean(req.query.location);
    const bin = clean(req.query.bin);
    let locationIds = [];
    if (appLocationId) {
      const locationResult = await pool.query(`
        SELECT name, netsuite_internal_id, invoice_location_id, distribution_location_id
        FROM locations
        WHERE id = $1
        LIMIT 1
      `, [appLocationId]);
      const appLocation = locationResult.rows[0];
      if (!appLocation) throw new Error("Location was not found");
      location = clean(appLocation.name);
      locationIds = numericIds([
        appLocation.invoice_location_id,
        appLocation.distribution_location_id,
      ]);
    }
    if (!location && !locationIds.length) throw new Error("Location is required");
    const locationConditions = [
      locationIds.length ? `ib.location IN (${locationIds.join(",")})` : "",
      location ? `UPPER(BUILTIN.DF(ib.location)) LIKE UPPER('%${sqlText(location)}%')` : "",
    ].filter(Boolean);

    const inventoryRows = await suiteQl(`
      SELECT
        ib.binnumber AS "bin_id",
        BUILTIN.DF(ib.binnumber) AS "bin_name",
        ib.item AS "item_id",
        i.itemid AS "item_name",
        i.displayname AS "display_name",
        i.custitem_atlas_item_image AS "image_file_id",
        i.custitem_sb_cat_img_one AS "catalogue_image_file_id",
        BUILTIN.DF(i.class) AS "class_name",
        i.parent AS "parent_id",
        BUILTIN.DF(i.parent) AS "parent_name",
        ib.inventorynumber AS "inventory_number_id",
        BUILTIN.DF(ib.inventorynumber) AS "inventory_number",
        ib.location AS "location_id",
        BUILTIN.DF(ib.location) AS "location_name",
        ib.quantityonhand AS "quantity_on_hand"
      FROM InventoryBalance ib
      INNER JOIN Item i ON i.id = ib.item
      WHERE i.islotitem = 'T'
        AND i.isinactive = 'F'
        AND ib.quantityonhand > 0
        AND (${locationConditions.join(" OR ")})
        ${bin ? `AND UPPER(BUILTIN.DF(ib.binnumber)) = UPPER('${sqlText(bin)}')` : ""}
      ORDER BY BUILTIN.DF(ib.binnumber), i.itemid
    `, userId);

    const bins = [...new Set(inventoryRows.map((row) => clean(row.bin_name)).filter(Boolean))].sort();
    if (!bin) return res.json({ ok: true, bins, products: [] });
    if (!inventoryRows.length) return res.json({ ok: true, bins: [], products: [] });

    const stockedIds = numericIds(inventoryRows.map((row) => row.item_id));
    const parentIds = numericIds(inventoryRows.map((row) => row.parent_id));
    const optionTargetIds = numericIds([...stockedIds, ...parentIds]);
    const optionResult = optionTargetIds.length ? await pool.query(`
      SELECT DISTINCT ai.item_id, f.label, v.name AS value_name, v.sort_order
      FROM item_option_fields f
      INNER JOIN item_option_applied_items ai ON ai.field_id = f.id
      INNER JOIN item_option_values v ON v.field_id = f.id
      WHERE ai.item_id = ANY($1::text[])
        AND f.inactive = FALSE
        AND f.applies_to_sales = TRUE
        AND f.source_ok = TRUE
        AND ai.inactive = FALSE
        AND v.inactive = FALSE
      ORDER BY f.label, v.sort_order, v.name
    `, [optionTargetIds.map(String)]) : { rows: [] };
    const itemWhere = [
      stockedIds.length ? `i.id IN (${stockedIds.join(",")})` : "",
      parentIds.length ? `i.parent IN (${parentIds.join(",")})` : "",
      parentIds.length ? `i.id IN (${parentIds.join(",")})` : "",
    ].filter(Boolean).join(" OR ");
    const itemRows = await suiteQl(`
      SELECT
        i.id AS "item_id",
        i.itemid AS "item_name",
        i.displayname AS "display_name",
        i.custitem_atlas_item_image AS "image_file_id",
        i.custitem_sb_cat_img_one AS "catalogue_image_file_id",
        BUILTIN.DF(i.class) AS "class_name",
        i.parent AS "parent_id",
        BUILTIN.DF(i.parent) AS "parent_name"
      FROM Item i
      WHERE i.isinactive = 'F'
        AND (${itemWhere})
      ORDER BY i.parent, i.itemid
    `, userId);
    const itemIds = numericIds(itemRows.map((row) => row.item_id));
    const imageFileIds = numericIds(itemRows.flatMap((row) => [
      row.image_file_id,
      row.catalogue_image_file_id,
    ]));
    const imageRows = imageFileIds.length ? await suiteQl(`
      SELECT id, name, url
      FROM File
      WHERE id IN (${imageFileIds.join(",")})
    `, userId) : [];
    const imageByFileId = new Map(imageRows.map((row) => {
      const absoluteUrl = /^https?:\/\//i.test(clean(row.url))
        ? clean(row.url)
        : `https://${process.env.NS_ACCOUNT_DASH}.app.netsuite.com${clean(row.url)}`;
      return [String(row.id), `/api/suitepim/image-proxy?url=${encodeURIComponent(absoluteUrl)}`];
    }));
    const priceRows = itemIds.length ? await suiteQl(`
      SELECT
        p.item AS "item_id",
        BUILTIN.DF(p.pricelevel) AS "price_level",
        p.priceqty AS "price_quantity",
        p.unitprice AS "unit_price"
      FROM Pricing p
      WHERE p.item IN (${itemIds.join(",")})
        AND BUILTIN.DF(p.pricelevel) IN ('Base Price', 'Sale Price')
      ORDER BY p.item, p.priceqty
    `, userId) : [];
    const priceByItem = new Map();
    priceRows.forEach((row) => {
      const id = String(row.item_id);
      const quantity = Number(row.price_quantity || 0);
      if (quantity > 1) return;
      const level = clean(row.price_level).toLowerCase();
      const current = priceByItem.get(id) || {};
      current[level] = Number(row.unit_price) || 0;
      priceByItem.set(id, current);
    });
    const itemById = new Map(itemRows.map((row) => [String(row.item_id), row]));
    const groups = new Map();
    inventoryRows.forEach((stock) => {
      const child = itemById.get(String(stock.item_id)) || stock;
      const parentId = clean(stock.parent_id);
      const parent = parentId ? itemById.get(parentId) : null;
      const groupId = parentId || clean(stock.item_id);
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          name: clean(parent?.display_name || parent?.item_name || stock.parent_name ||
            child.display_name || child.item_name || `Product ${groupId}`),
          className: clean(parent?.class_name || child.class_name || stock.class_name),
          image: imageByFileId.get(String(
            parent?.image_file_id ||
            parent?.catalogue_image_file_id ||
            child.image_file_id ||
            child.catalogue_image_file_id ||
            ""
          )) || "",
          variants: [],
          optionFields: [],
        });
      }
    });
    groups.forEach((group) => {
      const children = parentIds.includes(Number(group.id))
        ? itemRows.filter((row) => String(row.parent_id) === String(group.id))
        : [itemById.get(String(group.id))].filter(Boolean);
      const parentItem = itemById.get(String(group.id));
      const childIds = new Set(children.map((child) => String(child.item_id)));
      const availableFields = new Map();
      optionResult.rows.forEach((row) => {
        if (String(row.item_id) !== String(group.id) && !childIds.has(String(row.item_id))) return;
        if (!availableFields.has(row.label)) availableFields.set(row.label, []);
        const values = availableFields.get(row.label);
        if (!values.includes(row.value_name)) values.push(row.value_name);
      });
      const usedFields = new Map();
      const derivedMatrixValues = new Set();
      children.forEach((child) => {
        const options = {};
        if (children.length > 1 && parentItem) {
          const parentItemName = clean(parentItem.item_name);
          const childItemName = clean(child.item_name);
          const escapedParentName = parentItemName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const derivedValue = escapedParentName
            ? childItemName
                .replace(new RegExp(escapedParentName, "i"), "")
                .replace(/^[-:|/\\\s]+|[-:|/\\\s]+$/g, "")
            : "";
          if (derivedValue) {
            options.__matrix = derivedValue;
            derivedMatrixValues.add(derivedValue);
          }
        }
        const searchable = `${clean(child.item_name)} ${clean(child.display_name)}`.toLowerCase();
        availableFields.forEach((values, label) => {
          const optionValue = values
            .slice()
            .sort((a, b) => String(b).length - String(a).length)
            .find((candidate) => searchable.includes(String(candidate).toLowerCase()));
          if (!optionValue) return;
          options[label] = optionValue;
          if (!usedFields.has(label)) usedFields.set(label, new Set());
          usedFields.get(label).add(optionValue);
        });
        const prices = priceByItem.get(String(child.item_id)) || {};
        const retailPrice = +((prices["base price"] || 0) * 1.2).toFixed(2);
        const configuredSalePrice = +((prices["sale price"] || 0) * 1.2).toFixed(2);
        const hasSalePrice = configuredSalePrice > 0 && configuredSalePrice < retailPrice;
        const salePrice = hasSalePrice ? configuredSalePrice : retailPrice;
        const discountPercent = hasSalePrice && retailPrice > 0
          ? +(((retailPrice - salePrice) / retailPrice) * 100).toFixed(1)
          : 0;
        group.variants.push({
          id: clean(child.item_id),
          name: clean(child.item_name || child.display_name || `Item ${child.item_id}`),
          price: salePrice,
          retailPrice,
          salePrice,
          discountPercent,
          options,
        });
      });
      if (derivedMatrixValues.size) {
        const values = [...derivedMatrixValues];
        const sizeWords = /^(small single|single|small double|double|king|super king|emperor|queen|standard|small|medium|large)$/i;
        const label = values.every((value) => sizeWords.test(value)) ? "Size" : "Option";
        group.variants.forEach((variant) => {
          if (!variant.options.__matrix) return;
          variant.options[label] = variant.options.__matrix;
          delete variant.options.__matrix;
        });
        group.optionFields.push({ name: label, values: values.sort(), affectsVariant: true });
      }
      availableFields.forEach((values, name) => {
        group.optionFields.push({
          name,
          values: values.slice().sort(),
          affectsVariant: usedFields.has(name),
        });
      });
    });
    const classPriority = new Map([
      ["mattress", 0],
      ["bases only", 1],
      ["headboards", 2],
      ["bed frames", 3],
      ["pillows", 4],
    ]);
    const products = [...groups.values()]
      .filter((group) => group.variants.length)
      .sort((a, b) => {
        const aPriority = classPriority.get(a.className.toLowerCase()) ?? 99;
        const bPriority = classPriority.get(b.className.toLowerCase()) ?? 99;
        return aPriority - bPriority || a.name.localeCompare(b.name);
      });
    res.json({ ok: true, bins, products });
  } catch (error) {
    console.error("QR inventory SuiteQL failed:", error.message);
    res.status(500).json({ ok: false, error: error.message || "Failed to load QR inventory" });
  }
});

function cleanProducts(products) {
  if (!Array.isArray(products) || !products.length) throw new Error("The selected bin has no products");
  return products.slice(0, 200).map((product) => ({
    id: clean(product.id, 80),
    name: clean(product.name),
    className: clean(product.className, 100),
    image: clean(product.image, 2000),
    variants: (Array.isArray(product.variants) ? product.variants : []).slice(0, 300).map((variant) => ({
      id: clean(variant.id, 80),
      name: clean(variant.name),
      price: Math.max(0, Number(variant.price) || 0),
      retailPrice: Math.max(0, Number(variant.retailPrice) || Number(variant.price) || 0),
      salePrice: Math.max(0, Number(variant.salePrice) || Number(variant.price) || 0),
      discountPercent: Math.max(0, Number(variant.discountPercent) || 0),
      options: variant.options && typeof variant.options === "object" ? variant.options : {},
    })),
    optionFields: (Array.isArray(product.optionFields) ? product.optionFields : []).slice(0, 20).map((field) => ({
      name: clean(field.name, 100),
      values: (Array.isArray(field.values) ? field.values : []).slice(0, 100).map((value) => clean(value, 100)),
      affectsVariant: field.affectsVariant !== false,
    })),
  })).filter((product) => product.id && product.name && product.variants.length);
}

async function journey(token) {
  await ensureTables();
  const result = await pool.query(
    `SELECT token, location_id, location_name, bin_name, products, created_at, expires_at
       FROM qr_finance_journeys
      WHERE token = $1 AND expires_at > NOW()`,
    [clean(token, 100)]
  );
  return result.rows[0] || null;
}

router.post("/", async (req, res) => {
  try {
    await ensureTables();
    const locationId = Number(req.body?.locationId) || null;
    const locationName = clean(req.body?.locationName);
    const binName = clean(req.body?.binName);
    if (!locationId || !locationName || !binName) throw new Error("Location and bin are required");
    const products = cleanProducts(req.body?.products);
    const token = crypto.randomBytes(24).toString("base64url");
    await pool.query(
      `INSERT INTO qr_finance_journeys
        (token, location_id, location_name, bin_name, products)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [token, locationId, locationName, binName, JSON.stringify(products)]
    );
    const url = `${req.protocol}://${req.get("host")}/qr-shop/${encodeURIComponent(token)}`;
    res.json({ ok: true, token, url, qrDataUrl: await QRCode.toDataURL(url, { width: 700, margin: 2 }) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Failed to generate QR journey" });
  }
});

router.get("/public/:token", async (req, res) => {
  try {
    const row = await journey(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: "This QR code is invalid or has expired" });
    res.json({ ok: true, journey: row });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load this QR journey" });
  }
});

router.get("/public/:token/finance-settings", async (req, res) => {
  try {
    const row = await journey(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: "This QR code is invalid or has expired" });
    const result = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'finance.calculator.tiers' LIMIT 1"
    );
    const tiers = result.rows[0]?.value ? JSON.parse(result.rows[0].value) : [{
      minSaleAmount: 0, maxSaleAmount: 999999.99, minTermMonths: 6, maxTermMonths: 36,
      minimumDepositPercent: 10, interestBearing: false, interestRatePercent: 0,
    }];
    res.json({ ok: true, tiers });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load finance settings" });
  }
});

router.post("/public/:token/quote-request", async (req, res) => {
  let requestId = null;
  try {
    const row = await journey(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: "This QR code is invalid or has expired" });
    const customer = req.body?.customer || {};
    if (
      !clean(customer.firstName) ||
      !clean(customer.lastName) ||
      !clean(customer.postcode) ||
      !clean(customer.address1) ||
      !clean(customer.contactNumber) ||
      !clean(customer.email)
    ) {
      throw new Error("Complete all required customer and contact details");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(customer.email))) {
      throw new Error("Enter a valid email address");
    }
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const variants = new Map(
      (row.products || []).flatMap((product) =>
        (product.variants || []).map((variant) => [String(variant.id), { product, variant }])
      )
    );
    const items = requestedItems.map((item) => {
      const match = variants.get(String(item.itemId || ""));
      if (!match) return null;
      return {
        parentId: match.product.id,
        parentName: match.product.name,
        itemId: match.variant.id,
        itemName: match.variant.name,
        price: Number(match.variant.price) || 0,
        retailPrice: Number(match.variant.retailPrice || match.variant.price) || 0,
        salePrice: Number(match.variant.salePrice || match.variant.price) || 0,
        discountPercent: Number(match.variant.discountPercent) || 0,
        options: item.options && typeof item.options === "object" ? item.options : {},
      };
    }).filter(Boolean);
    if (!items.length) throw new Error("Select at least one valid product");
    const suppliedFinance = req.body?.finance || {};
    const finance = {
      saleAmount: items.reduce((sum, item) => sum + item.price, 0),
      deposit: Math.max(0, Number(suppliedFinance.deposit) || 0),
      termMonths: Math.max(0, Math.round(Number(suppliedFinance.termMonths) || 0)),
      estimatedMonthlyPayment: Math.max(0, Number(suppliedFinance.estimatedMonthlyPayment) || 0),
      amountFinanced: Math.max(0, Number(suppliedFinance.amountFinanced) || 0),
      totalPayable: Math.max(0, Number(suppliedFinance.totalPayable) || 0),
      apr: clean(suppliedFinance.apr, 100),
      monthlyBudgetEnabled: suppliedFinance.monthlyBudgetEnabled === true,
    };
    const storedCustomer = {
      firstName: clean(customer.firstName),
      lastName: clean(customer.lastName),
      postcode: clean(customer.postcode, 20),
      address1: clean(customer.address1),
      address2: clean(customer.address2),
      address3: clean(customer.address3),
      county: clean(customer.county),
      contactNumber: clean(customer.contactNumber, 50),
      email: clean(customer.email),
    };
    const requestKey = clean(req.body?.requestKey, 100) || crypto.randomUUID();
    const inserted = await pool.query(
      `INSERT INTO qr_quote_requests
        (journey_token, location_id, location_name, bin_name, items, finance, customer, status, request_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, 'processing', $8)
       ON CONFLICT (journey_token, request_key) WHERE request_key IS NOT NULL DO NOTHING
       RETURNING id, status, netsuite_quote_id, netsuite_quote_number`,
      [
        row.token, row.location_id, row.location_name, row.bin_name,
        JSON.stringify(items),
        JSON.stringify(finance),
        JSON.stringify(storedCustomer),
        requestKey,
      ]
    );
    let requestRecord = inserted.rows[0];
    if (!requestRecord) {
      const existing = await pool.query(
        `SELECT id, status, netsuite_quote_id, netsuite_quote_number
           FROM qr_quote_requests
          WHERE journey_token = $1 AND request_key = $2
          LIMIT 1`,
        [row.token, requestKey]
      );
      requestRecord = existing.rows[0];
      if (requestRecord?.status === "sent") {
        return res.json({
          ok: true,
          requestId: requestRecord.id,
          quoteId: requestRecord.netsuite_quote_id,
          quoteNumber: requestRecord.netsuite_quote_number,
          alreadySent: true,
        });
      }
      if (requestRecord?.status === "processing") {
        return res.status(409).json({ ok: false, error: "Your quote is already being prepared. Please wait a moment." });
      }
      await pool.query(
        "UPDATE qr_quote_requests SET status = 'processing', last_error = NULL WHERE id = $1",
        [requestRecord.id]
      );
    }
    requestId = requestRecord.id;

    let quoteId = requestRecord.netsuite_quote_id;
    let quoteNumber = requestRecord.netsuite_quote_number;
    if (!quoteId) {
      const netSuiteContext = await resolveQrNetSuiteContext(pool, row.location_id);
      await pool.query(
        "UPDATE qr_quote_requests SET netsuite_user_id = $2 WHERE id = $1",
        [requestId, netSuiteContext.userId]
      );
      const createdCustomer = await createNetSuiteCustomer(storedCustomer, netSuiteContext.userId);
      const quoteBody = {
        entity: { id: String(createdCustomer.id) },
        trandate: new Date().toISOString().slice(0, 10),
        orderstatus: "A",
        subsidiary: { id: String(netSuiteContext.storeNsId) },
        location: { id: String(netSuiteContext.invoiceLocationId) },
        leadsource: { id: "4958" },
        custbody_sb_bedspecialist: { id: String(netSuiteContext.netSuiteEmployeeId) },
        custbody_sb_primarystore: { id: String(netSuiteContext.storeNsId) },
        shipAddress: [
          storedCustomer.address1, storedCustomer.address2, storedCustomer.address3,
          storedCustomer.county, storedCustomer.postcode,
        ].filter(Boolean).join("\n"),
        memo: `Customer finance quote request ${requestId}`,
        item: {
          items: items.map((item) => {
            const gross = Number(item.price) || 0;
            const net = +(gross / 1.2).toFixed(2);
            return {
              item: { id: String(item.itemId) },
              quantity: 1,
              price: { id: "-1" },
              rate: net,
              amount: net,
              custcol_sb_itemoptionsdisplay: Object.entries(item.options || {})
                .map(([name, value]) => `${name}: ${value}`)
                .join("\n"),
            };
          }),
        },
      };
      const createdQuote = await nsPost("/estimate", quoteBody, netSuiteContext.userId);
      quoteId = createdQuote.id;
      if (!quoteId) throw new Error("NetSuite created the quote but did not return its ID");
      const quote = await nsGet(`/estimate/${encodeURIComponent(quoteId)}`, netSuiteContext.userId);
      quoteNumber = clean(quote?.tranId || quote?.tranid || quoteId, 100);
      await pool.query(
        `UPDATE qr_quote_requests
            SET netsuite_quote_id = $2, netsuite_quote_number = $3
          WHERE id = $1`,
        [requestId, quoteId, quoteNumber]
      );
    }

    const storeResult = await pool.query(
      `SELECT
         l.name,
         l.location_phone_number,
         COALESCE(NULLIF(l.location_email, ''), l.email) AS location_email,
         l.vat_number,
         l.company_number,
         l.address_line_1,
         l.address_line_2,
         l.postcode,
         NULLIF(TRIM(CONCAT_WS(' ', manager.firstname, manager.lastname)), '') AS manager_name
       FROM locations l
       LEFT JOIN users manager ON manager.id = l.store_manager
       WHERE l.id = $1
       LIMIT 1`,
      [row.location_id]
    );
    const storeRow = storeResult.rows[0] || {};
    const store = {
      name: clean(storeRow.name || row.location_name),
      phone: clean(storeRow.location_phone_number, 100),
      email: clean(storeRow.location_email),
      vatNumber: clean(storeRow.vat_number, 100),
      companyNumber: clean(storeRow.company_number, 100),
      address1: clean(storeRow.address_line_1),
      address2: clean(storeRow.address_line_2),
      postcode: clean(storeRow.postcode, 30),
      managerName: clean(storeRow.manager_name),
    };
    const receiptPdf = await buildHtmlQuoteReceiptPdf({
      appBaseUrl: `${req.protocol}://${req.get("host")}`,
      quoteNumber,
      store,
      customer: storedCustomer,
      items,
      total: finance.saleAmount,
    });
    const financePdf = buildFinanceSummaryPdf({
      quoteNumber, storeName: row.location_name, customer: storedCustomer, finance,
    });
    const contactLinks = [
      store.phone
        ? `<a href="tel:${htmlEscape(store.phone.replace(/\s+/g, ""))}" style="color:#006a9c;text-decoration:none;font-weight:700;">${htmlEscape(store.phone)}</a>`
        : "",
      store.email
        ? `<a href="mailto:${htmlEscape(store.email)}" style="color:#006a9c;text-decoration:none;font-weight:700;">${htmlEscape(store.email)}</a>`
        : "",
    ].filter(Boolean).join(" &nbsp;&middot;&nbsp; ");
    const signOff = store.managerName || `${store.name} team`;
    const emailSent = await sendEmail(
      storedCustomer.email,
      `Your Sussex Beds quote ${quoteNumber}`,
      `<div style="margin:0;background:#f2f6f8;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#17343d;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(23,52,61,.10);">
          <div style="background:#006a9c;padding:28px 32px;border-bottom:5px solid #ffd700;">
            <div style="font-size:13px;font-weight:800;letter-spacing:1.5px;color:#dff5fb;text-transform:uppercase;">Sussex Beds</div>
            <h1 style="margin:8px 0 0;color:#ffffff;font-size:27px;line-height:1.2;">Your quote is ready</h1>
          </div>
          <div style="padding:30px 32px;">
            <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Hi ${htmlEscape(storedCustomer.firstName)},</p>
            <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">Thank you for choosing Sussex Beds. We’ve attached your quote and your personalised finance illustration.</p>
            <div style="margin:24px 0;padding:18px 20px;background:#eef7f9;border-left:4px solid #006a9c;border-radius:10px;">
              <div style="font-size:12px;color:#5e747c;text-transform:uppercase;letter-spacing:.8px;font-weight:700;">Quote reference</div>
              <div style="margin-top:5px;font-size:22px;color:#17343d;font-weight:800;">${htmlEscape(quoteNumber)}</div>
            </div>
            <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">Questions or ready to go ahead? Contact <strong>${htmlEscape(store.name)}</strong>:</p>
            <p style="margin:0 0 26px;font-size:15px;line-height:1.7;">${contactLinks || "Please contact your local store and quote the reference above."}</p>
            <p style="margin:0;font-size:15px;line-height:1.6;">Kind regards,<br><strong>${htmlEscape(signOff)}</strong><br><span style="color:#5e747c;">${htmlEscape(store.name)}, Sussex Beds</span></p>
          </div>
          <div style="padding:16px 32px;background:#f7fafb;color:#6a7d83;font-size:12px;line-height:1.5;">Your finance document is an illustration only. Final finance is subject to approval and lender terms.</div>
        </div>
      </div>`,
      {
        fromName: "Sussex Beds",
        text: `Hi ${storedCustomer.firstName}, your Sussex Beds quote ${quoteNumber} and finance illustration are attached. Contact ${store.name}${store.phone ? ` on ${store.phone}` : ""}${store.email ? ` or ${store.email}` : ""}. Kind regards, ${signOff}.`,
        attachments: [
          { filename: `Quote-${quoteNumber}.pdf`, content: receiptPdf, contentType: "application/pdf" },
          { filename: `Finance-${quoteNumber}.pdf`, content: financePdf, contentType: "application/pdf" },
        ],
      }
    );
    if (!emailSent) throw new Error("The NetSuite quote was created, but the confirmation email could not be sent");
    await pool.query(
      `UPDATE qr_quote_requests
          SET status = 'sent', email_sent_at = NOW(), last_error = NULL
        WHERE id = $1`,
      [requestId]
    );
    res.json({ ok: true, requestId, quoteId, quoteNumber });
  } catch (error) {
    if (requestId) {
      await pool.query(
        "UPDATE qr_quote_requests SET status = 'failed', last_error = $2 WHERE id = $1",
        [requestId, clean(error.message, 1000)]
      ).catch(() => {});
    }
    res.status(error.statusCode || 400).json({ ok: false, error: error.message || "Failed to create and send quote" });
  }
});

module.exports = router;
