// utils/sendTransferEmail.js
const pool = require("../db");
const sendEmail = require("./sendEmail");
const { nsGet } = require("../netsuiteClient");

async function getItemName(itemId) {
  try {
    const res = await pool.query(
      `SELECT name FROM item_cache WHERE id = $1 LIMIT 1`,
      [itemId]
    );
    if (res.rows.length) return res.rows[0].name;

    // Fallback: try name from NetSuite via REST
    const item = await nsGet(`/inventoryItem/${itemId}`, null, "sb");
    return item?.itemId || `Item ${itemId}`;
  } catch {
    return `Item ${itemId}`;
  }
}

async function getLocationName(id) {
  try {
    const res = await pool.query(
      `SELECT name FROM locations 
       WHERE id::text = $1::text
          OR netsuite_internal_id::text = $1::text
          OR invoice_location_id::text = $1::text
          OR distribution_location_id::text = $1::text
       LIMIT 1`,
      [String(id)]
    );
    return res.rows.length ? res.rows[0].name : "Unknown Location";
  } catch {
    return "Unknown Location";
  }
}

async function sendTransferEmail({
  transferId,
  itemId,
  quantity,
  sourceLocId,
  destinationLocId,
}) {
  try {
    // 1️⃣ Fetch document number (tranId)
    let transferDocNum = transferId;
    try {
      const to = await nsGet(`/transferOrder/${transferId}`, null, "sb");
      transferDocNum = to?.tranId || transferId;
    } catch (e) {
      console.warn("⚠️ Could not load transfer order tranId:", e.message);
    }

    // 2️⃣ Fetch source & destination names
    const sourceRes = await pool.query(
      `SELECT name, email 
       FROM locations 
       WHERE id::text = $1::text
          OR netsuite_internal_id::text = $1::text
          OR invoice_location_id::text = $1::text
          OR distribution_location_id::text = $1::text
       LIMIT 1`,
      [String(sourceLocId)]
    );

    if (!sourceRes.rows.length || !sourceRes.rows[0].email) {
      console.warn("⚠️ Missing email for source location", sourceLocId);
      return;
    }

    const sourceName = sourceRes.rows[0].name;
    const sourceEmail = sourceRes.rows[0].email;
    const destinationName = await getLocationName(destinationLocId);

    // 3️⃣ Fetch item name
    const itemName = await getItemName(itemId);

    // 4️⃣ Build email contents
    const html = `
      <div style="font-family:Arial, sans-serif; padding:20px;">
        <h2 style="color:#0081ab;">New Transfer Order Created</h2>

        <p>Hello ${sourceName},</p>
        <p>A new <strong>Transfer Order</strong> has been raised from your location.</p>

        <table style="margin-top:15px; border-collapse:collapse;">
          <tr><td><strong>Transfer Order #</strong></td><td>${transferDocNum}</td></tr>
          <tr><td><strong>Source Location</strong></td><td>${sourceName}</td></tr>
          <tr><td><strong>Destination</strong></td><td>${destinationName}</td></tr>
          <tr><td><strong>Item</strong></td><td>${itemName}</td></tr>
          <tr><td><strong>Quantity</strong></td><td>${quantity}</td></tr>
        </table>

        <p style="margin-top:20px;">Please process and dispatch the stock to the destination location.</p>

        <p>Thank you,<br>EPOS System</p>
      </div>
    `;

    // 5️⃣ Send email
    await sendEmail(
      sourceEmail,
      `Transfer Order ${transferDocNum} Created`,
      html
    );

    console.log(`📧 Transfer email sent to ${sourceEmail}`);

  } catch (err) {
    console.error("❌ sendTransferEmail failed:", err.message);
  }
}

module.exports = sendTransferEmail;
