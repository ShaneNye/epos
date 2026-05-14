const pool = require("../db");
const sendEmail = require("./sendEmail");

const RECIPIENT_SETTING_KEY = "email_alerts.sales_quote.user_ids";

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function parseUserIds(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

async function getEmailAlertUserIds() {
  await ensureSettingsTable();
  const result = await pool.query(
    "SELECT value FROM app_settings WHERE key = $1 LIMIT 1",
    [RECIPIENT_SETTING_KEY]
  );
  return parseUserIds(result.rows[0]?.value);
}

async function saveEmailAlertUserIds(userIds) {
  const ids = parseUserIds(JSON.stringify(userIds || []));
  const uniqueIds = [...new Set(ids)];
  await ensureSettingsTable();
  await pool.query(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [RECIPIENT_SETTING_KEY, JSON.stringify(uniqueIds)]
  );
  return uniqueIds;
}

async function getEmailAlertRecipients() {
  const ids = await getEmailAlertUserIds();
  if (!ids.length) return [];

  const result = await pool.query(
    `
      SELECT id, email, firstname, lastname
      FROM users
      WHERE id = ANY($1::int[])
        AND NULLIF(TRIM(email), '') IS NOT NULL
      ORDER BY lastname, firstname, email
    `,
    [ids]
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: [row.firstname, row.lastname].filter(Boolean).join(" ").trim() || row.email,
  }));
}

async function resolveSalesExecName(salesExecUserId) {
  const id = Number(salesExecUserId);
  if (!Number.isInteger(id) || id <= 0) return "";

  const result = await pool.query(
    "SELECT firstname, lastname, email FROM users WHERE id = $1 LIMIT 1",
    [id]
  );
  const row = result.rows[0];
  if (!row) return "";
  return [row.firstname, row.lastname].filter(Boolean).join(" ").trim() || row.email || "";
}

async function resolveStoreName(storeId) {
  const id = Number(storeId);
  if (!Number.isInteger(id) || id <= 0) return "";

  const result = await pool.query("SELECT name FROM locations WHERE id = $1 LIMIT 1", [id]);
  return result.rows[0]?.name || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value) {
  const amount = Number(value);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function lineTotal(line) {
  const candidates = [
    line?.grossSaleprice,
    line?.saleGrossLine,
    line?.saleprice,
    line?.grossAmount,
    line?.amountGrossLine,
    line?.amount,
  ];
  for (const candidate of candidates) {
    const amount = Number(candidate);
    if (Number.isFinite(amount)) return amount;
  }
  return 0;
}

function itemName(line, itemNameById = {}) {
  return (
    line?.name ||
    line?.itemName ||
    line?.displayName ||
    itemNameById[String(line?.item || line?.itemId || "")] ||
    `Item ${line?.item || line?.itemId || ""}`.trim()
  );
}

function buildItemRows(items, itemNameById) {
  const lines = Array.isArray(items) ? items : [];
  if (!lines.length) {
    return `
      <tr>
        <td colspan="4" style="padding:10px; border:1px solid #e5e7eb; color:#6b7280;">No item lines supplied.</td>
      </tr>
    `;
  }

  return lines
    .map((line) => {
      const qty = Number(line?.quantity) || 0;
      const total = lineTotal(line);
      const options = String(line?.options || "").trim();
      return `
        <tr>
          <td style="padding:10px; border:1px solid #e5e7eb;">
            <strong>${escapeHtml(itemName(line, itemNameById))}</strong>
            ${options ? `<div style="color:#6b7280; margin-top:4px;">${escapeHtml(options)}</div>` : ""}
          </td>
          <td style="padding:10px; border:1px solid #e5e7eb; text-align:right;">${escapeHtml(qty)}</td>
          <td style="padding:10px; border:1px solid #e5e7eb; text-align:right;">${money(qty ? total / qty : total)}</td>
          <td style="padding:10px; border:1px solid #e5e7eb; text-align:right;">${money(total)}</td>
        </tr>
      `;
    })
    .join("");
}

function customerName(customer = {}) {
  return (
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    customer.companyName ||
    customer.email ||
    "Unknown customer"
  );
}

async function sendSalesQuoteCreatedEmail({
  documentType,
  documentId,
  transactionNumber,
  customer = {},
  order = {},
  items = [],
  storeName,
  salesExecName,
  itemNameById = {},
  appBaseUrl = "",
}) {
  const recipients = await getEmailAlertRecipients();
  if (!recipients.length) return { sent: false, skipped: true, reason: "No recipients configured" };

  const typeLabel = documentType === "quote" ? "Quote" : "Sale";
  const resolvedStoreName = storeName || await resolveStoreName(order.store);
  const resolvedSalesExecName = salesExecName || await resolveSalesExecName(order.salesExec);
  const total = (Array.isArray(items) ? items : []).reduce((sum, line) => sum + lineTotal(line), 0);
  const reference = transactionNumber || documentId || "";
  const appPath = documentType === "quote" ? `/quote/view/${reference || documentId}` : `/sales/view/${reference || documentId}`;
  const appUrl = appBaseUrl ? `${String(appBaseUrl).replace(/\/$/, "")}${appPath}` : appPath;

  const html = `
    <div style="font-family:Arial,sans-serif; color:#111827;">
      <h2 style="margin:0 0 14px; color:#0081ab;">New ${escapeHtml(typeLabel)} Created in EPOS</h2>
      <table style="border-collapse:collapse; margin-bottom:18px; min-width:420px;">
        <tr><td style="padding:5px 12px 5px 0; color:#6b7280;">Reference</td><td style="padding:5px 0;"><strong>${escapeHtml(reference || "Pending NetSuite reference")}</strong></td></tr>
        <tr><td style="padding:5px 12px 5px 0; color:#6b7280;">Store</td><td style="padding:5px 0;">${escapeHtml(resolvedStoreName || "Unknown")}</td></tr>
        <tr><td style="padding:5px 12px 5px 0; color:#6b7280;">Sales Executive</td><td style="padding:5px 0;">${escapeHtml(resolvedSalesExecName || "Unknown")}</td></tr>
        <tr><td style="padding:5px 12px 5px 0; color:#6b7280;">Customer</td><td style="padding:5px 0;">${escapeHtml(customerName(customer))}</td></tr>
        <tr><td style="padding:5px 12px 5px 0; color:#6b7280;">Total Order Value</td><td style="padding:5px 0;"><strong>${money(total)}</strong></td></tr>
      </table>

      <h3 style="margin:0 0 8px; color:#111827;">Item Breakdown</h3>
      <table style="border-collapse:collapse; width:100%; max-width:840px;">
        <thead>
          <tr>
            <th style="padding:10px; border:1px solid #e5e7eb; background:#f3f4f6; text-align:left;">Item</th>
            <th style="padding:10px; border:1px solid #e5e7eb; background:#f3f4f6; text-align:right;">Qty</th>
            <th style="padding:10px; border:1px solid #e5e7eb; background:#f3f4f6; text-align:right;">Unit</th>
            <th style="padding:10px; border:1px solid #e5e7eb; background:#f3f4f6; text-align:right;">Line Total</th>
          </tr>
        </thead>
        <tbody>${buildItemRows(items, itemNameById)}</tbody>
      </table>

      <p style="margin-top:18px;">
        <a href="${escapeHtml(appUrl)}" style="color:#0081ab;">Open in EPOS</a>
      </p>
    </div>
  `;

  await sendEmail(
    recipients.map((recipient) => recipient.email).join(","),
    `EPOS ${typeLabel} Created${reference ? ` - ${reference}` : ""}`,
    html
  );

  return { sent: true, skipped: false, recipientCount: recipients.length };
}

module.exports = {
  getEmailAlertUserIds,
  saveEmailAlertUserIds,
  sendSalesQuoteCreatedEmail,
};
