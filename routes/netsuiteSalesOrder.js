// routes/netsuiteSalesOrder.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const fetch = require("node-fetch");
const { getSession } = require("../sessions");
const {
  nsPost,
  nsGet,
  nsPostRaw,
  nsPatch,
  getAuthHeader,
} = require("../netsuiteClient");

// =====================================================
// ✅ In-memory cache for GET /:id sales order payloads
// =====================================================
const SO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const soCache = new Map(); // key -> { expiresAt, data, inFlight }

function cacheKey(id) {
  return `so:${String(id).trim()}`;
}

function cacheGet(key) {
  const e = soCache.get(key);
  if (!e) return null;

  // in-flight promise exists
  if (e.inFlight) return e;

  // expired
  if (e.expiresAt && e.expiresAt < Date.now()) {
    soCache.delete(key);
    return null;
  }
  return e;
}

function cacheSet(key, data) {
  soCache.set(key, {
    data,
    expiresAt: Date.now() + SO_CACHE_TTL_MS,
    inFlight: null,
  });
}

// optional: prevent memory creep
function cachePrune(max = 300) {
  if (soCache.size <= max) return;
  const over = soCache.size - max;
  for (let i = 0; i < over; i++) {
    const first = soCache.keys().next().value;
    soCache.delete(first);
  }
}

// =====================================================
// ✅ Cached suitelet lookups (Item feed + Fulfilment map)
// =====================================================
const ITEM_FEED_TTL_MS = 60 * 60 * 1000; // 1 hour
const FULFIL_TTL_MS = 60 * 60 * 1000; // 1 hour

const itemFeedCache = {
  expiresAt: 0,
  data: null, // itemMap
  inFlight: null,
};

const fulfilmentCache = {
  expiresAt: 0,
  data: null, // fulfilmentMap
  inFlight: null,
};

function isFresh(expiresAt) {
  return expiresAt && expiresAt > Date.now();
}

async function getItemMapCached() {
  if (itemFeedCache.data && isFresh(itemFeedCache.expiresAt)) return itemFeedCache.data;
  if (itemFeedCache.inFlight) return itemFeedCache.inFlight;

  itemFeedCache.inFlight = (async () => {
    const baseUrlItems = process.env.SALES_ORDER_ITEMS_URL;
    const itemFeedToken = process.env.SALES_ORDER_ITEMS;

    if (!baseUrlItems || !itemFeedToken) {
      throw new Error("Missing SALES_ORDER_ITEMS_URL or SALES_ORDER_ITEMS in .env");
    }

    const nsUrlItems = `${baseUrlItems}&token=${encodeURIComponent(itemFeedToken)}`;
    console.log(`📡 [Cache] Fetching item feed from: ${nsUrlItems}`);

    const respItems = await fetch(nsUrlItems);
    if (!respItems.ok) throw new Error(`NetSuite item feed returned ${respItems.status}`);
    const rawItems = await respItems.json();

    let itemList = [];
    if (Array.isArray(rawItems)) itemList = rawItems;
    else if (rawItems.results) itemList = rawItems.results;
    else if (rawItems.data) itemList = rawItems.data;

    const itemMap = {};
    for (const i of itemList) {
      const id = String(i.id || i.internalId || i.itemId || i["Internal ID"] || "").trim();
      if (!id) continue;

      const name = i.name || i.itemName || i["Name"] || i["Item Name"] || "";
      const baseprice = parseFloat(
        i.baseprice || i["Base Price"] || i["base price"] || i.price || 0
      );

      itemMap[id] = { name, baseprice: Number.isFinite(baseprice) ? baseprice : 0 };
    }

    itemFeedCache.data = itemMap;
    itemFeedCache.expiresAt = Date.now() + ITEM_FEED_TTL_MS;
    itemFeedCache.inFlight = null;

    return itemMap;
  })();

  try {
    return await itemFeedCache.inFlight;
  } finally {
    // if it threw, clear inFlight so next request can retry
    if (itemFeedCache.inFlight && !itemFeedCache.data) itemFeedCache.inFlight = null;
  }
}

async function getFulfilmentMapCached() {
  if (fulfilmentCache.data && isFresh(fulfilmentCache.expiresAt)) return fulfilmentCache.data;
  if (fulfilmentCache.inFlight) return fulfilmentCache.inFlight;

  fulfilmentCache.inFlight = (async () => {
    const baseUrlFM = process.env.SALES_ORDER_FULFIL_METHOD_URL;
    const tokenFM = process.env.SALES_ORDER_FULFIL_METHOD;

    if (!baseUrlFM || !tokenFM) {
      console.warn("⚠️ Missing SALES_ORDER_FULFIL_METHOD environment variables.");
      fulfilmentCache.data = {};
      fulfilmentCache.expiresAt = Date.now() + FULFIL_TTL_MS;
      fulfilmentCache.inFlight = null;
      return {};
    }

    const nsUrlFM = `${baseUrlFM}&token=${encodeURIComponent(tokenFM)}`;
    console.log(`📡 [Cache] Fetching fulfilment methods from: ${nsUrlFM}`);

    const fmRes = await fetch(nsUrlFM);
    if (!fmRes.ok) {
      console.warn("⚠️ Fulfilment suitelet returned:", fmRes.status);
      fulfilmentCache.data = {};
      fulfilmentCache.expiresAt = Date.now() + FULFIL_TTL_MS;
      fulfilmentCache.inFlight = null;
      return {};
    }

    const fmJson = await fmRes.json();
    const fmList = fmJson.results || fmJson.data || [];

    const fulfilmentMap = {};
    for (const f of fmList) {
      const id = String(f["Internal ID"] || f.id || f.internalid || "").trim();
      const name = (f["Name"] || f.name || "").trim();
      if (id && name) fulfilmentMap[id] = name;
    }

    fulfilmentCache.data = fulfilmentMap;
    fulfilmentCache.expiresAt = Date.now() + FULFIL_TTL_MS;
    fulfilmentCache.inFlight = null;

    return fulfilmentMap;
  })();

  try {
    return await fulfilmentCache.inFlight;
  } finally {
    if (fulfilmentCache.inFlight && !fulfilmentCache.data) fulfilmentCache.inFlight = null;
  }
}

// =====================================================
// ✅ Helper: build “lite” fields lists for REST Record service
// =====================================================
function buildSalesOrderFields() {
  // NOTE: these must match *your* REST field IDs. This list is intentionally “safe-ish”.
  // If any field name is invalid, NetSuite can error. Remove/adjust using REST API Browser if needed.
  return [
    "id",
    "tranId",
    "trandate",
    "orderstatus",
    "entity",
    "location",
    "leadsource",
    "custbody_sb_bedspecialist",
    "custbody_sb_primarystore",
    "custbody_sb_paymentinfo",
    "custbody_sb_warehouse",
    // totals (field IDs vary; keep what works in your account)
    "subtotal",
    "discountTotal",
    "taxtotal",
    "total",
    "amountremaining",
    // addresses (again, may vary)
    "billAddress",
    "shipAddress",
  ].join(",");
}

function buildCustomerFields() {
  return [
    "id",
    "firstName",
    "lastName",
    "email",
    "phone",
    "altPhone",
    "custentity_title",
    // optional address-related fields if you rely on them
    "addressbook",
  ].join(",");
}

/* =====================================================
   === CREATE NEW SALES ORDER ===========================
   ===================================================== */
router.post("/create", async (req, res) => {
  try {
    // 🔐 Get user session
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
    if (token) {
      const session = await getSession(token);
      console.log("🧠 Session returned from getSession():", session);
      userId = session?.id || null;
      console.log("🔐 Authenticated session for SO creation:", userId);
    }

    const { customer, order, items } = req.body;
    let customerId = customer?.id || null;

    /* ======================================================
       1️⃣ CREATE CUSTOMER IF NEEDED
    ====================================================== */
    if (!customerId) {
      const custBody = {
        entityStatus: { id: "13" },
        companyName: `${customer.firstName} ${customer.lastName}`,
        custentity_title: customer.title,
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        phone: customer.contactNumber,
        altPhone: customer.altContactNumber,
        subsidiary: { id: "1" },
        isPerson: true,
        addressbook: {
          items: [
            {
              defaultShipping: true,
              defaultBilling: true,
              label: "Main Address",
              addressbookAddress: {
                addr1: customer.address1,
                addr2: customer.address2,
                zip: customer.postcode,
              },
            },
          ],
        },
      };

      console.log("🧾 Creating new customer:", JSON.stringify(custBody, null, 2));
      const newCustomer = await nsPost("/customer", custBody, userId, "sb");

      let match;
      if (
        newCustomer._location &&
        (match = newCustomer._location.match(/customer\/(\d+)/))
      ) {
        customerId = match[1];
      } else if (newCustomer.id) customerId = newCustomer.id;

      if (!customerId) throw new Error("Failed to resolve new customer ID");

      console.log("✅ Created new customer, resolved ID:", customerId);
    }

    console.log("🧩 Using Customer ID:", customerId);

    /* ======================================================
       2️⃣ LOOKUP SALES EXEC NETSUITE ID
    ====================================================== */
    let salesExecNsId = null;
    if (order.salesExec) {
      try {
        const resultExec = await pool.query(
          "SELECT netsuiteid FROM users WHERE id = $1",
          [order.salesExec]
        );
        salesExecNsId = resultExec.rows[0]?.netsuiteid || null;
        console.log("👤 Sales Executive NS ID:", salesExecNsId);
      } catch (err) {
        console.error("❌ Sales Exec lookup failed:", err.message);
      }
    }

    /* ======================================================
       3️⃣ LOOKUP STORE INFORMATION
    ====================================================== */
    let invoiceLocationId = null;
    let storeNsId = null;
    let storeName = "";

    if (order.store) {
      try {
        const resultLoc = await pool.query(
          `SELECT name, netsuite_internal_id, invoice_location_id
           FROM locations WHERE id = $1`,
          [order.store]
        );
        if (resultLoc.rows.length) {
          const row = resultLoc.rows[0];
          storeNsId = row.netsuite_internal_id;
          invoiceLocationId = row.invoice_location_id;
          storeName = row.name;
          console.log("🏬 Store lookup →", {
            storeNsId,
            invoiceLocationId,
            storeName,
          });
        }
      } catch (err) {
        console.error("❌ Store lookup failed:", err.message);
      }
    }

    /* ======================================================
       4️⃣ BUILD ORDER BODY (BEFORE INTERCOPO + WEB ORDER)
    ====================================================== */
    const orderBody = {
      entity: { id: customerId },
      subsidiary: storeNsId ? { id: String(storeNsId) } : undefined,
      trandate: new Date().toISOString().split("T")[0],
      orderstatus: "A",
      location: invoiceLocationId ? { id: String(invoiceLocationId) } : undefined,
      custbody_sb_bedspecialist: salesExecNsId ? { id: salesExecNsId } : undefined,
      custbody_sb_primarystore: storeNsId ? { id: storeNsId } : undefined,
      leadsource: { id: order.leadSource },
      custbody_sb_paymentinfo: { id: order.paymentInfo },
      custbody_sb_warehouse: { id: order.warehouse },

      item: {
        items: items.map((i, idx) => {
          console.log(`🧪 RAW FRONTEND LINE ${idx + 1}:`, i);

          const line = {
            item: { id: i.item },
            quantity: i.quantity,
            amount: i.amount / 1.2,
            custcol_sb_itemoptionsdisplay: i.options || "",
          };

          // Fulfilment Method → custcol_sb_fulfilmentlocation
          if (i.fulfilmentMethod && i.class !== "service") {
            line.custcol_sb_fulfilmentlocation = { id: i.fulfilmentMethod };
          }

          /* ======================================================
             createpo logic — ONLY for subsidiary 6
          ====================================================== */
          const fulfilId = String(i.fulfilmentMethod || "").trim();

          if (String(storeNsId) === "6") {
            if (fulfilId === "3") {
              line.createpo = "SpecOrd";
              console.log(`🟦 Line ${idx + 1} createpo = SpecOrd (Special Order)`);
            } else {
              line.createpo = "";
              console.log(`⬜ Line ${idx + 1} createpo = "" (default/warehouse)`);
            }
          } else {
            console.log(`🚫 Subsidiary ${storeNsId} → createpo removed`);
          }

          /* ======================================================
             LOT / META ALLOCATION
          ====================================================== */
          if (i.lotnumber) {
            line.custcol_sb_lotnumber = { id: i.lotnumber };
          } else if (i.inventoryMeta) {
            line.custcol_sb_epos_inventory_meta = i.inventoryMeta;
            line.orderallocationstrategy = null;
          }

          console.log(`🧾 Final Line ${idx + 1}:`, line);
          return line;
        }),
      },
    };

    /* ======================================================
       5️⃣ WEB ORDER FLAG — MUST BE BEFORE PAYLOAD PREVIEW
    ====================================================== */
    if (String(storeNsId) === "6") {
      orderBody.custbody_sb_is_web_order = { id: "1" };
      console.log("🏷 Web Order FLAG SET: custbody_sb_is_web_order = 1");
    }

    /* ======================================================
       6️⃣ FINAL PAYLOAD PREVIEW (AFTER ALL MODIFICATIONS)
    ====================================================== */
    console.log("🚀 FINAL Sales Order payload:", JSON.stringify(orderBody, null, 2));

    /* ======================================================
       7️⃣ CREATE SALES ORDER IN NETSUITE
    ====================================================== */
    const so = await nsPost("/salesOrder", orderBody, userId, "sb");

    let salesOrderId = so.id || null;
    if (!salesOrderId && so._location) {
      const match = so._location.match(/salesorder\/(\d+)/i);
      if (match) salesOrderId = match[1];
    }

    if (!salesOrderId)
      return res.status(500).json({
        ok: false,
        error: "Failed to resolve Sales Order ID",
      });

    console.log("✅ Sales Order created successfully with ID:", salesOrderId);

    // ==========================================================
    // 💰 Create Customer Deposit(s) if provided in payload
    // ==========================================================
    const allDeposits = Array.isArray(order?.deposits)
      ? order.deposits
      : Array.isArray(req.body?.deposits)
        ? req.body.deposits
        : [];

    if (Array.isArray(allDeposits) && allDeposits.length > 0) {
      console.log(
        `💰 Found ${allDeposits.length} deposit(s) in payload — creating in NetSuite...`
      );
      console.table(
        allDeposits.map((d) => ({
          MethodID: d.id,
          MethodName: d.name,
          Amount: d.amount,
        }))
      );

      // 🔍 Fetch account mapping from store
      let currentAccountId = null;
      let pettyCashAccountId = null;
      try {
        const accResult = await pool.query(
          `SELECT current_account, petty_cash_account 
           FROM locations 
           WHERE id = $1 
           LIMIT 1`,
          [order.store]
        );
        const accRows = accResult.rows;

        if (accRows.length) {
          currentAccountId = accRows[0].current_account || null;
          pettyCashAccountId = accRows[0].petty_cash_account || null;
          console.log("🏦 Store account mapping →", { currentAccountId, pettyCashAccountId });
        } else {
          console.warn("⚠️ No account mapping found for store:", order.store);
        }
      } catch (accErr) {
        console.error("❌ Failed to load store account mapping:", accErr.message);
      }

      for (const [index, dep] of allDeposits.entries()) {
        try {
          const isCash = /cash/i.test(dep.name || "");
          const selectedAccountId = isCash ? pettyCashAccountId : currentAccountId;

          if (!selectedAccountId) {
            console.warn(
              `⚠️ [Deposit ${index + 1}] No ${isCash ? "petty cash" : "current"
              } account ID found — skipping account assignment.`
            );
          }

          const depositBody = {
            entity: { id: String(customerId) },
            subsidiary: storeNsId ? { id: String(storeNsId) } : undefined,
            trandate: new Date().toISOString().split("T")[0],
            salesorder: { id: String(salesOrderId) },
            payment: parseFloat(dep.amount || 0),
            paymentmethod: { id: String(dep.id) },
            undepfunds: false,
            memo: dep.name || "",
            ...(selectedAccountId && { account: { id: String(selectedAccountId) } }),
          };

          console.log(`🧾 [Deposit ${index + 1}] Creating Customer Deposit:`);
          console.dir(depositBody, { depth: null });

          const depositRes = await nsPost("/customerDeposit", depositBody, userId, "sb");

          let depositId = depositRes?.id || null;
          if (!depositId && depositRes?._location) {
            const match = depositRes._location.match(/customerDeposit\/(\d+)/i);
            if (match) depositId = match[1];
          }

          if (depositId) {
            console.log(`✅ Deposit ${index + 1} created successfully → ID ${depositId}`);
          } else {
            console.warn(`⚠️ Deposit ${index + 1} created but no ID returned:`, depositRes);
          }
        } catch (err) {
          console.error(`❌ Failed to create Customer Deposit ${index + 1}:`, err.message);
        }
      }
    } else {
      console.log("ℹ️ No customer deposits found in request — skipping deposit creation.");
    }

    // ==========================================================
    //  🔁 Create Transfer Orders for cross-location lines
    // ==========================================================
    const createdTransfers = [];
    try {
      const salesOrderTranId = so.tranId || so.tranid || so.id || "";

      // 🔍 Fetch full store record to get distribution location
      let storeDistributionLocId = null;
      try {
        const storeRes = await pool.query(
          `SELECT 
             netsuite_internal_id, 
             invoice_location_id, 
             distribution_location_id 
           FROM locations 
           WHERE id = $1 
           LIMIT 1`,
          [order.store]
        );

        if (storeRes.rows.length) {
          const row = storeRes.rows[0];

          const dist = (row.distribution_location_id || "").toString().trim();
          const inv = (row.invoice_location_id || "").toString().trim();
          const main = (row.netsuite_internal_id || "").toString().trim();

          storeDistributionLocId =
            dist !== "" ? dist : inv !== "" ? inv : main !== "" ? main : null;

          console.log("🏬 Store location mapping →", {
            storeNsId: main,
            invoiceLocationId: inv,
            distributionLocationId: dist,
            usedTransferDest: storeDistributionLocId,
          });
        } else {
          console.warn("⚠️ No store record found for store ID:", order.store);
        }
      } catch (err) {
        console.error("❌ Failed to load store distribution location:", err.message);
      }

      for (const [idx, line] of items.entries()) {
        const fulfilMethod = String(line.fulfilmentMethod || "").trim();
        console.log(`📦 Line ${idx + 1} fulfilMethod =`, fulfilMethod);

        let skipTransfer = false;

        if (line.lotnumber && !line.inventoryMeta) {
          console.log(`🔍 Resolving LOT source for LOT ${line.lotnumber}`);

          try {
            const lotRes = await pool.query(
              `SELECT location_name, location_id, distribution_location_id
               FROM epos_lots
               WHERE lot_id = $1
               LIMIT 1`,
              [line.lotnumber]
            );

            if (lotRes.rows.length) {
              const row = lotRes.rows[0];
              const srcName = row.location_name || "";
              const srcInv = row.location_id || "";
              const srcDist = row.distribution_location_id || srcInv;

              console.log(`📦 LOT ${line.lotnumber} → ${srcName} (dist ${srcDist})`);
              line.inventoryMeta = `1|${srcName}|${srcInv}|||LOT|${line.lotnumber}`;
            } else {
              console.warn(`⚠️ No LOT source found → cannot create transfer`);
              skipTransfer = true;
            }
          } catch (err) {
            console.error("❌ LOT lookup failed:", err.message);
            skipTransfer = true;
          }
        }

        if (!line.inventoryMeta) {
          console.log(`⛔ [Line ${idx + 1}] No metadata → skip transfer`);
          skipTransfer = true;
        }

        const metaParts = (line.inventoryMeta || "")
          .split(";")
          .map((p) => p.trim())
          .filter(Boolean);

        if (metaParts.length === 0) {
          console.log(`⛔ [Line ${idx + 1}] No valid meta parts → skip transfer`);
          skipTransfer = true;
        }

        if (fulfilMethod === "1") {
          console.log(`🛒 In-Store fulfilment for line ${idx + 1}`);
          try {
            const [qty, locName] = metaParts[0].split("|");
            const metaLoc = (locName || "").trim().toLowerCase();
            const storeLower = String(storeName || "").toLowerCase();

            const alreadyInStore =
              metaLoc === storeLower ||
              metaLoc.includes(storeLower) ||
              storeLower.includes(metaLoc);

            if (alreadyInStore) {
              console.log(`🟢 Already in store → skip transfer`);
              skipTransfer = true;
            }
          } catch { }
        }

        if (fulfilMethod === "2") {
          console.log(`🏭 Warehouse fulfilment for line ${idx + 1}`);
          try {
            const [, , locIdRaw] = metaParts[0].split("|");
            if (String(locIdRaw || "") === String(order.warehouse)) {
              console.log(`🟢 Already in warehouse → skip transfer`);
              skipTransfer = true;
            }
          } catch { }
        }

        if (skipTransfer) {
          console.log(`🚫 [Line ${idx + 1}] Transfer skipped`);
          continue;
        }

        for (const part of metaParts) {
          let sourceLocId = null;

          const [qty, locName, locIdRaw, , , , invIdRaw] = part.split("|");

          const quantity = parseFloat(qty || 0) || 0;
          const invId = (invIdRaw || "").trim();
          const locId = (locIdRaw || "").trim();

          if (!quantity || !invId) {
            console.log(`⚠️ [Line ${idx + 1}] Invalid meta row → skip`);
            continue;
          }

          try {
            if (locId) {
              const q = await pool.query(
                `SELECT distribution_location_id
                 FROM locations
                 WHERE netsuite_internal_id = $1
                 LIMIT 1`,
                [locId]
              );
              sourceLocId = (q.rows[0]?.distribution_location_id || "").trim();
            }

            if (!sourceLocId && locName) {
              const q2 = await pool.query(
                `SELECT distribution_location_id
                 FROM locations
                 WHERE name ILIKE $1
                 LIMIT 1`,
                [locName]
              );
              sourceLocId = (q2.rows[0]?.distribution_location_id || "").trim();
            }
          } catch (err) {
            console.error("❌ Source lookup failed:", err.message);
          }

          if (!sourceLocId) {
            console.log(`⚠️ No source location resolved → skip`);
            continue;
          }

          let destinationLocId = "";

          if (fulfilMethod === "1") {
            destinationLocId = storeDistributionLocId;
            console.log(`🏪 STORE fulfilment → dest ${destinationLocId}`);
          } else if (fulfilMethod === "2") {
            try {
              const w = await pool.query(
                `SELECT distribution_location_id
                 FROM locations
                 WHERE netsuite_internal_id = $1
                 LIMIT 1`,
                [order.warehouse]
              );
              destinationLocId = (w.rows[0]?.distribution_location_id || order.warehouse).toString();
            } catch {
              destinationLocId = order.warehouse;
            }
            console.log(`🏭 WAREHOUSE fulfilment → dest ${destinationLocId}`);
          }

          if (!destinationLocId) continue;

          const transferBody = {
            subsidiary: { id: "6" },
            custbody_sb_needed_by: new Date(Date.now() + 3 * 86400000)
              .toISOString()
              .split("T")[0],
            transferlocation: { id: destinationLocId },
            location: { id: sourceLocId },
            custbody_sb_transfer_order_type: { id: "2" },
            custbody_sb_relatedsalesorder: { id: String(salesOrderId) },
            item: {
              items: [
                {
                  item: { id: line.item },
                  quantity: quantity,
                  inventorydetail: {
                    inventoryassignment: {
                      items: [
                        {
                          issueinventorynumber: { id: invId },
                          quantity: quantity,
                        },
                      ],
                    },
                  },
                },
              ],
            },
          };

          console.log(`🔁 Creating Transfer Order for line ${idx + 1}:`);
          console.dir(transferBody, { depth: null });

          try {
            const tr = await nsPost("/transferOrder", transferBody, userId, "sb");
            let transferId = tr?.id || null;
            if (!transferId && tr?._location) {
              const m = tr._location.match(/transferorder\/(\d+)/i);
              if (m) transferId = m[1];
            }

            console.log(`✅ Transfer Order created → ${transferId}`);

            createdTransfers.push({
              itemId: line.item,
              transferOrderId: transferId,
              sourceLocation: sourceLocId,
              destinationWarehouse: destinationLocId,
            });
          } catch (err) {
            console.error(`❌ Failed to create TO for line ${idx + 1}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error("⚠️ Transfer Order creation block failed:", err.message);
    }

    return res.json({
      ok: true,
      salesOrderId,
      createdTransfers,
      response: so,
    });
  } catch (err) {
    console.error("❌ Sales Order creation error:", err.message);
    if (err.stack) console.error(err.stack);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* =====================================================
   === GET SALES ORDER (for read-only view) =============
   ===================================================== */
router.get("/:id", async (req, res) => {
  let key;
  let rejectInflight = null;

  try {
    const { id } = req.params;
    console.log(`📦 Fetching Sales Order ${id} from NetSuite...`);

    // ✅ Cache support
    const refresh = String(req.query.refresh || "") === "1";
    key = cacheKey(id);

    // Optional: lite mode (still returns lines via suiteql; just reduces base record payload)
    const lite = String(req.query.lite || "") === "1" || String(req.query.lite || "") === "true";

    // Optional: allow skipping deposits fetch for faster initial paint
    // Default true to avoid breaking existing UI
    const includeDeposits =
      !(String(req.query.deposits || "") === "0" || String(req.query.deposits || "") === "false");

    if (!refresh) {
      const cached = cacheGet(key);

      // 1) warm cache hit
      if (cached?.data) {
        return res.json({ ...cached.data, _cache: "HIT" });
      }

      // 2) another request already fetching this SO
      if (cached?.inFlight) {
        try {
          const data = await cached.inFlight;
          return res.json({ ...data, _cache: "HIT-INFLIGHT" });
        } catch {
          // fall through and try fresh
        }
      }
    }

    // create in-flight promise so concurrent requests dedupe
    let resolveInflight;
    const inFlight = new Promise((resolve, reject) => {
      resolveInflight = resolve;
      rejectInflight = reject;
    });
    soCache.set(key, { inFlight, expiresAt: Date.now() + SO_CACHE_TTL_MS, data: null });

    // 🔐 Resolve user session for per-user NetSuite token
    const auth = req.headers.authorization || "";
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;

    if (bearerToken) {
      try {
        const session = await getSession(bearerToken);
        userId = session?.id || null;
        console.log("🔐 Authenticated user for SO view:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve user session for SO view:", e.message);
      }
    }

    // ✅ Server-side prewarm (no browser session needed)
    const prewarmKey = req.headers["x-prewarm-key"];
    const prewarmUserId = req.headers["x-prewarm-user-id"];

    const allowPrewarm =
      prewarmKey &&
      process.env.PREWARM_KEY &&
      String(prewarmKey) === String(process.env.PREWARM_KEY) &&
      prewarmUserId;

    if (!bearerToken && allowPrewarm) {
      userId = Number(prewarmUserId) || null;
      console.log("🔥 Prewarm auth accepted. Using userId:", userId);
    }

    // ✅ Load cached maps in parallel (big win: removes 2 suitelet calls per SO view)
    const [itemMap, fulfilmentMap] = await Promise.all([
      getItemMapCached(),
      getFulfilmentMapCached(),
    ]);

    // ✅ Pull a smaller SO record when lite is enabled
    const soPath = lite
      ? `/salesOrder/${id}?fields=${encodeURIComponent(buildSalesOrderFields())}`
      : `/salesOrder/${id}`;

    const so = await nsGet(soPath, userId, "sb");

    // 🔎 Fetch *minimal* entity/customer record (title + contact fields)
    let entityFull = null;
    if (so.entity?.id) {
      try {
        const custPath = `/customer/${so.entity.id}?fields=${encodeURIComponent(buildCustomerFields())}`;
        entityFull = await nsGet(custPath, userId, "sb");
        console.log("✅ Entity fetched for SO:", {
          id: entityFull.id,
          title: entityFull.custentity_title?.refName || entityFull.custentity_title?.text,
        });
      } catch (err) {
        console.warn("⚠️ Could not fetch full entity:", err.message);
      }
    }
    if (entityFull) so.entityFull = entityFull;

    /* -----------------------------------------------------
       3️⃣ Expand Item Lines via SuiteQL (only columns you need)
    ----------------------------------------------------- */
    {
      const query = `
        SELECT
          id AS lineid,
          item,
          quantity,
          netamount,
          rate,
          custcol_sb_itemoptionsdisplay AS options,
          custcol_sb_fulfilmentlocation
        FROM transactionline
        WHERE transaction = ${id}
          AND mainline = 'F'
          AND taxline = 'F'
        ORDER BY linesequencenumber
      `;

      const suiteql = await nsPostRaw(
        `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
        { q: query },
        userId,
        "sb"
      );

      if (suiteql && Array.isArray(suiteql.items)) {
        const items = suiteql.items.map((r) => {
          const itemId = String(r.item);
          const lineId = String(r.lineid || "");
          const info = itemMap[itemId] || {};
          const itemName = info.name || `Item ${itemId}`;

          const qty = Math.abs(Number(r.quantity) || 0);
          const net = Math.abs(Number(r.netamount) || 0);

          const retailNet = parseFloat(info.baseprice || 0);
          const retailGross = +(retailNet * 1.2).toFixed(2);

          const vat = net > 0 ? +(net * 0.2).toFixed(2) : 0;
          const saleprice = net > 0 ? +(net + vat).toFixed(2) : 0;

          const fulfilId =
            r.fulfilmentlocation ||
            r.custcol_sb_fulfilmentlocation ||
            r.CUSTCOL_SB_FULFILMENTLOCATION ||
            "";

          return {
            lineId,
            item: { id: itemId, refName: itemName },
            quantity: qty,
            amount: retailGross,
            vat,
            saleprice,
            discount: 0,
            custcol_sb_itemoptionsdisplay: r.options || "",
            custcol_sb_fulfilmentlocation: {
              id: fulfilId || null,
              refName: fulfilId ? (fulfilmentMap[fulfilId] || `ID ${fulfilId}`) : "",
            },
          };
        });

        so.item = { items };
        console.log(`✅ Loaded ${items.length} item lines`);
      } else {
        so.item = { items: [] };
      }
    }

    /* -----------------------------------------------------
       💰 Fetch Customer Deposits (optional)
    ----------------------------------------------------- */
    let deposits = [];
    if (includeDeposits) {
      try {
        console.log(
          `💰 Fetching deposit data for Sales Order ${id} via /api/netsuite/customer-deposits...`
        );

        // NOTE: this endpoint is currently public in your access middleware, so no auth header required.
        // If you later secure it, pass through bearer/prewarm headers here.
        const depRes = await fetch(`${req.protocol}://${req.get("host")}/api/netsuite/customer-deposits`);
        if (!depRes.ok) throw new Error(`Deposit route returned ${depRes.status}`);

        const depJson = await depRes.json();
        const allDeposits = depJson.results || depJson.data || [];

        const normalizeKeys = (obj) => {
          const newObj = {};
          for (const [k, v] of Object.entries(obj)) {
            const cleanKey = k.replace(/\u00A0/g, " ");
            newObj[cleanKey.trim()] = v;
          }
          return newObj;
        };

        deposits = allDeposits
          .map(normalizeKeys)
          .filter((d) => String(d["SO Id"]) === String(id))
          .map((d) => ({
            link: d["Document Number"] || "-",
            amount: parseFloat(String(d["Amount"] || "0").replace(/[^\d.-]/g, "")) || 0,
            method: d["Payment Method"] || "-",
            soId: String(d["SO Id"] || ""),
          }));

        console.log(`✅ Found ${deposits.length} deposit(s) for Sales Order ${id}`);
      } catch (err) {
        console.warn("⚠️ Could not fetch deposits:", err.message);
      }
    }

    /* -----------------------------------------------------
       ✅ Respond + cache
    ----------------------------------------------------- */
    console.log("✅ Sales Order fetched successfully:", so.tranId || so.id);

    const payload = {
      ok: true,
      salesOrderId: so.id,
      salesOrder: so,
      deposits,
      _mode: lite ? "LITE" : "FULL",
    };

    cacheSet(key, payload);
    cachePrune();
    resolveInflight(payload);

    return res.json({ ...payload, _cache: "MISS" });
  } catch (err) {
    console.error("❌ GET /salesorder/:id error:", err.message);

    // if we created an inflight promise above, reject + clear cache entry
    try {
      if (typeof rejectInflight === "function") rejectInflight(err);
      if (key) soCache.delete(key);
    } catch { }

    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================================================
// === COMMIT SALES ORDER (Approve via RESTlet only) ===
// =====================================================
router.post("/:id/commit", async (req, res) => {
  try {
    const { id } = req.params;
    const { updates = [] } = req.body;

    console.log(`🔁 Approving Sales Order ${id} via NetSuite RESTlet`);
    console.log("📦 Incoming updates:", JSON.stringify(updates, null, 2));

    if (!id || !Array.isArray(updates)) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing Sales Order ID or updates array." });
    }

    // 🔐 Get session from Authorization header
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
    if (token) {
      try {
        const session = await getSession(token);
        userId = session?.id || null;
        console.log("🔐 Commit request for user:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve session for commit:", e.message);
      }
    }

    // 🔗 RESTlet URL
    const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;

    // ✅ Build OAuth headers using per-user tokens
    const authHeader = await getAuthHeader(restletUrl, "POST", userId, "sb");
    const headers = {
      ...authHeader,
      "Content-Type": "application/json",
    };

    // 🔁 Prevent rapid double-submit
    if (!global._recentCommits) global._recentCommits = {};
    const now = Date.now();
    if (global._recentCommits[id] && now - global._recentCommits[id] < 1000) {
      console.warn(`⚠️ Duplicate commit request ignored for Sales Order ${id}`);
      return res.json({
        ok: false,
        warning: "Duplicate commit ignored (too soon)",
      });
    }
    global._recentCommits[id] = now;

    const payload = { id, updates };
    console.log("📡 Calling NetSuite RESTlet with payload:", JSON.stringify(payload, null, 2));

    const response = await fetch(restletUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok || !data.ok) {
      console.error("❌ RESTlet returned error:", text);
      return res.status(500).json({
        ok: false,
        error: data?.error || "NetSuite RESTlet call failed",
        raw: text,
      });
    }

    console.log(`✅ Sales Order ${id} approved via RESTlet`);

    // ==========================================================
    // 🧾 Create custom record: customrecord_sb_coms_sales_value
    // ==========================================================
    try {
      console.log("📊 Creating customrecord_sb_coms_sales_value for SO:", id);

      // If you want to speed this up too, you can do fields= here (once you confirm your field IDs)
      const soData = await nsGet(`/salesOrder/${id}`, userId, "sb");

      const soInternalId = soData?.id || soData?.internalId || id;
      const grossValue = soData?.custbody_stc_total_after_discount || 0;
      const profitValue = soData?.custrecord_sb_coms_profit || 0;
      const salesRep = soData?.custbody_sb_bedspecialist?.id || null;

      const recordBody = {
        custrecord_sb_coms_date: new Date().toISOString().split("T")[0],
        custrecord_sb_coms_sales_order: { id: String(soInternalId) },
        custrecord_sb_coms_gross: parseFloat(grossValue) || 0,
        custrecord_sb_coms_profit: parseFloat(profitValue) || 0,
        ...(salesRep && { custrecord_sb_coms_sales_rep: { id: String(salesRep) } }),
      };

      console.log("🧾 Custom record payload:", recordBody);

      const restletUrl =
        "https://7972741-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=4193&deploy=1";

      const resCreate = await fetch(restletUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recordBody),
      });

      const t = await resCreate.text();
      let json;
      try {
        json = JSON.parse(t);
      } catch {
        json = { ok: false, raw: t };
      }

      if (resCreate.ok && json.ok) {
        console.log(`✅ Custom record created successfully → ID ${json.id}`);
      } else {
        console.error("❌ RESTlet returned error:", json);
      }
    } catch (err) {
      console.error("❌ Failed to create customrecord_sb_coms_sales_value:", err.message);
    }

    return res.json({
      ok: true,
      message: data.message || "Sales Order approved",
      restletResult: data,
    });
  } catch (err) {
    console.error("❌ Commit Sales Order failed:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unexpected server error",
    });
  }
});

// ==========================================================
// 💰 Add Deposit from Popup (Frontend -> REST -> NetSuite)
// ==========================================================
router.post("/:id/add-deposit", async (req, res) => {
  try {
    const { id } = req.params;
    const dep = req.body;
    console.log(`💰 [Popup] Creating deposit for Sales Order ${id}`, dep);

    if (!dep?.id || !dep?.amount || !dep?.name) {
      return res.status(400).json({ ok: false, error: "Missing deposit fields" });
    }

    // 🔐 Resolve logged-in user → userId for per-user NetSuite tokens
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let userId = null;
    if (token) {
      try {
        const session = await getSession(token);
        userId = session?.id || null;
        console.log("🔐 Authenticated user for deposit creation:", userId);
      } catch (e) {
        console.warn("⚠️ Could not resolve session:", e.message);
      }
    }

    // 🔍 Determine store ID
    let storeId = dep.storeId || null;

    if (!storeId && id) {
      try {
        // If you want this faster too: use lite fields once confirmed
        const so = await nsGet(`/salesOrder/${id}`, userId, "sb");
        storeId = so?.location?.id || so?.custbody_sb_primarystore?.id || null;
        console.log("🏬 Store determined from NetSuite SO:", storeId);
      } catch (err) {
        console.warn("⚠️ Could not fetch store from NetSuite:", err.message);
      }
    }

    if (!storeId) {
      console.warn("⚠️ No store ID provided or found; using fallback location 1");
      storeId = 1;
    }

    // ==========================================================
    // 🔎 Fetch account mapping for that store
    // ==========================================================
    let accRows = [];
    try {
      const query = `
        SELECT id, name, netsuite_internal_id, invoice_location_id, current_account, petty_cash_account
        FROM locations
        WHERE id::text = $1::text 
           OR netsuite_internal_id::text = $1::text
           OR invoice_location_id::text = $1::text
        LIMIT 1
      `;
      const result = await pool.query(query, [String(storeId)]);
      accRows = result.rows || [];

      if (accRows.length && accRows[0].invoice_location_id?.toString() === String(storeId)) {
        const realStoreNsId = accRows[0].netsuite_internal_id;
        console.log(
          `🔁 Matched invoice location ${storeId}, resolving real store netsuite_internal_id → ${realStoreNsId}`
        );

        const storeRes = await pool.query(
          `
          SELECT id, name, netsuite_internal_id, current_account, petty_cash_account
          FROM locations
          WHERE netsuite_internal_id::text = $1::text
          LIMIT 1
          `,
          [String(realStoreNsId)]
        );
        if (storeRes.rows.length) accRows = storeRes.rows;
      }

      if (accRows.length) console.log("🏪 Store match found:", accRows[0]);
      else console.warn("⚠️ No location match found for storeId:", storeId);
    } catch (dbErr) {
      console.error("❌ Failed to fetch account mapping:", dbErr.message);
    }

    const currentAccountId = accRows?.[0]?.current_account || null;
    const pettyCashAccountId = accRows?.[0]?.petty_cash_account || null;

    const isCash = /cash/i.test(dep.name || dep.method || "");
    const selectedAccountId = isCash ? pettyCashAccountId : currentAccountId;

    console.log("🏦 Account mapping resolved →", {
      storeId,
      currentAccountId,
      pettyCashAccountId,
      selectedAccountId,
      isCash,
    });

    // ==========================================================
    // ✅ Build NetSuite deposit body
    // ==========================================================
    const depositBody = {
      salesorder: { id: String(id) },
      payment: parseFloat(dep.amount || 0),
      paymentmethod: { id: String(dep.id) },
      undepfunds: false,
      memo: dep.name || "",
      ...(selectedAccountId && { account: { id: String(selectedAccountId) } }),
    };

    console.log("🧾 [AddDeposit] Payload to NetSuite:", depositBody);

    const depositRes = await nsPost("/customerDeposit", depositBody, userId, "sb");
    console.log("💰 NetSuite Deposit response:", depositRes);

    let depositId = depositRes?.id || null;
    if (!depositId && depositRes?._location) {
      const match = depositRes._location.match(/customerDeposit\/(\d+)/i);
      if (match) depositId = match[1];  
    }

    if (!depositId) throw new Error("Deposit created but ID not returned");

    const accountDash = process.env.NS_ACCOUNT_DASH;
    const depositLink = `https://${accountDash}.app.netsuite.com/app/accounting/transactions/custdep.nl?id=${depositId}`;

    return res.json({
      ok: true,
      id: depositId,
      link: `<a href="${depositLink}" target="_blank">CD${depositId}</a>`,
    });
  } catch (err) {
    console.error("❌ Add Deposit (Popup) failed:", err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || "Deposit creation failed" });
  }
});

module.exports = router;
