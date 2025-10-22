const express = require("express");
const router = express.Router();
const pool = require("../db");
const fetch = require("node-fetch");
const { getSession } = require("../sessions");
const {
  nsPost,
  nsGet,
  nsPostRaw,
  nsPatch
} = require("../netsuiteClient");

/* =====================================================
   === CREATE NEW SALES ORDER ===========================
   ===================================================== */
router.post("/create", async (req, res) => {
  try {
    // 🔐 Get user session from Authorization header
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    let userId = null;
   if (token) {
  const session = await getSession(token);
  console.log("🧠 Session returned from getSession():", session);
  userId = session?.id || null;
  console.log("🔐 Authenticated session for SO creation:", userId);
}


    const { customer, order, items, deposits = [] } = req.body;
    let customerId = customer?.id || null;

    // === 1️⃣ Create Customer if needed ===
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
      const newCustomer = await nsPost("/customer", custBody, userId, "sb"); // 👈 use per-user token

      // Extract customer ID as before
      let match;
      if (newCustomer._location && (match = newCustomer._location.match(/customer\/(\d+)/))) {
        customerId = match[1];
      } else if (newCustomer.id) {
        customerId = newCustomer.id;
      }

      if (!customerId)
        throw new Error("Failed to resolve new customer ID from NetSuite response");

      console.log("✅ Created new customer, resolved ID:", customerId);
    }

    console.log("🧩 Using Customer ID for Sales Order:", customerId);

    // === 2️⃣ Lookup Sales Executive’s NetSuite ID ===
    let salesExecNsId = null;
    if (order.salesExec) {
      try {
        const resultExec = await pool.query(
          "SELECT netsuiteid FROM users WHERE id = $1",
          [order.salesExec]
        );
        if (resultExec.rows.length && resultExec.rows[0].netsuiteid) {
          salesExecNsId = resultExec.rows[0].netsuiteid;
          console.log("👤 Found NetSuite ID for Sales Exec:", salesExecNsId);
        }
      } catch (err) {
        console.error("❌ Error looking up Sales Exec NetSuite ID:", err.message);
      }
    }

    // === 3️⃣ Lookup Store Info ===
    let invoiceLocationId = null;
    let storeNsId = null;
    if (order.store) {
      try {
        const resultLoc = await pool.query(
          `SELECT netsuite_internal_id, invoice_location_id 
           FROM locations WHERE id = $1`,
          [order.store]
        );
        if (resultLoc.rows.length) {
          storeNsId = resultLoc.rows[0].netsuite_internal_id || null;
          invoiceLocationId = resultLoc.rows[0].invoice_location_id || null;
          console.log("🏬 Store lookup →", { storeNsId, invoiceLocationId });
        }
      } catch (err) {
        console.error("❌ Error looking up store info:", err.message);
      }
    }

    // === 4️⃣ Build Sales Order payload ===
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
          const line = {
            item: { id: i.item },
            quantity: i.quantity,
            amount: i.amount / 1.2,
            custcol_sb_itemoptionsdisplay: i.options || "",
          };

          if (i.fulfilmentMethod && String(i.fulfilmentMethod).trim() !== "" && i.class !== "service") {
            line.custcol_sb_fulfilmentlocation = { id: i.fulfilmentMethod };
          }

          if (i.lotnumber && i.lotnumber.trim() !== "") {
            line.custcol_sb_lotnumber = { id: i.lotnumber };
          } else if (i.inventoryMeta && i.inventoryMeta.trim() !== "") {
            line.custcol_sb_epos_inventory_meta = i.inventoryMeta;
          }
          return line;
        }),
      },
    };

    console.log("🚀 Sales Order payload preview:", JSON.stringify(orderBody, null, 2));

    // ✅ Create SO using per-user token
    const so = await nsPost("/salesOrder", orderBody, userId, "sb");

    let salesOrderId = so.id || null;
    if (!salesOrderId && so._location) {
      const match = so._location.match(/salesorder\/(\d+)/i);
      if (match) salesOrderId = match[1];
    }

    if (!salesOrderId)
      return res.status(500).json({ ok: false, error: "Failed to resolve Sales Order ID" });

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
  console.log(`💰 Found ${allDeposits.length} deposit(s) in payload — creating in NetSuite...`);
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
    const [accRows] = await pool.query(
      `SELECT current_account, petty_cash_account FROM locations WHERE id = ? LIMIT 1`,
      [order.store]
    );
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
          `⚠️ [Deposit ${index + 1}] No ${
            isCash ? "petty cash" : "current"
          } account ID found — skipping account assignment.`
        );
      }

      // ✅ Correct NetSuite payload
      const depositBody = {
        entity: { id: String(customerId) },
        subsidiary: storeNsId ? { id: String(storeNsId) } : undefined,
        trandate: new Date().toISOString().split("T")[0],
        salesorder: { id: String(salesOrderId) },
        payment: parseFloat(dep.amount || 0),
        paymentmethod: { id: String(dep.id) },
        undepfunds: false, // ✅ Use Account instead of Undeposited Funds
        memo: dep.name || "", // ✅ NEW — populate memo with payment method name
        ...(selectedAccountId && { account: { id: String(selectedAccountId) } }),
      };

      console.log(`🧾 [Deposit ${index + 1}] Creating Customer Deposit:`);
      console.dir(depositBody, { depth: null });

      const depositRes = await nsPost("/customerDeposit", depositBody);

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
//  🔁 Create Transfer Orders for cross-warehouse lines
// ==========================================================
const createdTransfers = [];
try {
  const salesOrderTranId = so.tranId || so.tranid || so.id || "";

  for (const [idx, line] of items.entries()) {
    if (!line.inventoryMeta) continue;

    const metaParts = line.inventoryMeta.split(";").map(p => p.trim()).filter(Boolean);
    for (const part of metaParts) {
      const [qty, locName, locIdRaw, , , , invIdRaw] = part.split("|");
      const locId = (locIdRaw || "").trim();
      const invId = (invIdRaw || "").trim();
      const quantity = parseFloat(qty || 0) || 0;

      if (!quantity) {
        console.log(`⚠️ [Line ${idx + 1}] Skipping — no quantity`);
        continue;
      }
// Try to map by location name if ID missing
let sourceLocId = locId;
if (!sourceLocId && locName) {
  try {
    const resultLocName = await pool.query(
      "SELECT netsuite_internal_id FROM locations WHERE name = $1 LIMIT 1",
      [locName]
    );

    if (resultLocName.rows.length && resultLocName.rows[0].netsuite_internal_id) {
      sourceLocId = String(resultLocName.rows[0].netsuite_internal_id);
      console.log(`📍 Mapped "${locName}" → netsuite_internal_id ${sourceLocId}`);
    } else {
      console.warn(`⚠️ No matching location found for name "${locName}"`);
    }
  } catch (err) {
    console.error(`❌ Location lookup failed for "${locName}":`, err.message);
  }
}

if (!sourceLocId) {
  console.log(`⚠️ [Line ${idx + 1}] Skipping — missing locationId for "${locName}"`);
  continue;
}

if (!invId) {
  console.log(`⚠️ [Line ${idx + 1}] Skipping — missing inventoryNumberId`);
  continue;
}

// Skip if same as main warehouse
if (String(sourceLocId) === String(order.warehouse)) {
  console.log(`ℹ️ [Line ${idx + 1}] Same as main warehouse → no transfer`);
  continue;
}


      // Build Transfer Order body
const transferBody = {
  subsidiary: { id: "6" },
  custbody_sb_needed_by: new Date(Date.now() + 3 * 86400000)
    .toISOString()
    .split("T")[0],
  transferlocation: { id: String(order.warehouse) },
  location: { id: String(sourceLocId) },
  custbody_sb_transfer_order_type: { id: "2" },
  custbody_sb_relatedsalesorder: salesOrderId
    ? { id: String(salesOrderId) }
    : undefined,
  item: {
    items: [
      {
        item: { id: line.item },
        quantity,
        inventorydetail: {
          inventoryassignment: {
            items: [
              {
                issueinventorynumber: { id: invId },
                quantity,
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
        const transferResponse = await nsPost("/transferOrder", transferBody);
        let transferId = transferResponse?.id || null;
        if (!transferId && transferResponse._location) {
          const match = transferResponse._location.match(/transferorder\/(\d+)/i);
          if (match) transferId = match[1];
        }
        console.log(
          `✅ Transfer Order created for item ${line.item} → ID ${transferId || "(unknown)"}`
        );
        createdTransfers.push({
          itemId: line.item,
          transferOrderId: transferId,
          sourceLocation: sourceLocId,
          destinationWarehouse: order.warehouse,
        });
      } catch (postErr) {
        console.error(`❌ Failed to create Transfer Order for line ${idx + 1}:`, postErr.message);
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
  try {
    const { id } = req.params;
    console.log(`📦 Fetching Sales Order ${id} from NetSuite...`);

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

    // ✅ Use per-user token when calling NetSuite
    const so = await nsGet(`/salesOrder/${id}`, userId, "sb");

    // 🔎 Fetch full entity (customer record) for title + custom fields
    let entityFull = null;
    if (so.entity?.id) {
      try {
        entityFull = await nsGet(`/customer/${so.entity.id}`, userId, "sb");
        console.log("✅ Entity fetched for SO:", {
          id: entityFull.id,
          title: entityFull.custentity_title?.refName,
        });
      } catch (err) {
        console.warn("⚠️ Could not fetch full entity:", err.message);
      }
    }
    if (entityFull) {
      so.entityFull = entityFull; // attach for frontend
    }

/* -----------------------------------------------------
       1️⃣ Fetch Item Feed (Name + Base Price)
    ----------------------------------------------------- */
    const itemFeedToken = process.env.SALES_ORDER_ITEMS;
    const nsUrlItems = `https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4178&deploy=6&compid=7972741_SB1&ns-at=AAEJ7tMQlL2UP5SuRn6p9IsRJ-Rgkanx98uShulWU5RVHLRlgSs&token=${encodeURIComponent(
      itemFeedToken
    )}`;

    const respItems = await fetch(nsUrlItems);
    if (!respItems.ok) throw new Error(`NetSuite item feed returned ${respItems.status}`);
    const rawItems = await respItems.json();

    let itemList = [];
    if (Array.isArray(rawItems)) itemList = rawItems;
    else if (rawItems.results) itemList = rawItems.results;
    else if (rawItems.data) itemList = rawItems.data;

    const itemMap = {};
    for (const i of itemList) {
      const id = String(i.id || i.internalId || i.itemId || i["Internal ID"]);
      const name = i.name || i.itemName || i["Name"] || i["Item Name"] || "";
      const baseprice = parseFloat(
        i.baseprice || i["Base Price"] || i["base price"] || i.price || 0
      );
      if (id) itemMap[id] = { name, baseprice };
    }

    /* -----------------------------------------------------
       2️⃣ Fulfilment Method Map
    ----------------------------------------------------- */
    let fulfilmentMap = {};
    try {
      const tokenFM = process.env.SALES_ORDER_FULFIL_METHOD;
      const nsUrlFM = `https://7972741-sb1.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=4178&deploy=7&compid=7972741_SB1&ns-at=AAEJ7tMQoVD4xXVi2aftvr1c5rNpwUNCW2YHfMu7NXrzI9r6id4&token=${encodeURIComponent(
        tokenFM
      )}`;
      const fmRes = await fetch(nsUrlFM);
      if (fmRes.ok) {
        const fmJson = await fmRes.json();
        const fmList = fmJson.results || [];
        for (const f of fmList) {
          const id = String(f["Internal ID"] || f.id || f.internalid);
          const name = f["Name"] || f.name;
          if (id && name) fulfilmentMap[id] = name;
        }
      }
    } catch (err) {
      console.warn("⚠️ Could not fetch fulfilment methods:", err.message);
    }
    /* -----------------------------------------------------
       3️⃣ Expand Item Lines via SuiteQL
    ----------------------------------------------------- */
    if (!so.item?.items) {
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
      }
    }

    /* -----------------------------------------------------
       💰 Fetch Customer Deposits
    ----------------------------------------------------- */
    let deposits = [];
    try {
      console.log(`💰 Fetching deposit data for Sales Order ${id} via /api/netsuite/customer-deposits...`);

      const depRes = await fetch(`${req.protocol}://${req.get("host")}/api/netsuite/customer-deposits`);
      if (!depRes.ok) throw new Error(`Deposit route returned ${depRes.status}`);

      const depJson = await depRes.json();
      const allDeposits = depJson.results || depJson.data || [];

      const normalizeKeys = (obj) => {
        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
          const cleanKey = key.replace(/\u00A0/g, " "); 
          newObj[cleanKey.trim()] = value;
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

    /* -----------------------------------------------------
       ✅ Respond
    ----------------------------------------------------- */
    console.log("✅ Sales Order fetched successfully:", so.tranId || so.id);
    return res.json({
      ok: true,
      salesOrderId: so.id,
      salesOrder: so,
      deposits,
    });
  } catch (err) {
    console.error("❌ GET /salesorder/:id error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});


/* =====================================================
   === COMMIT SALES ORDER (Approve via RESTlet only) ===
   ===================================================== */
router.post("/:id/commit", async (req, res) => {
  try {
    const { id } = req.params;
    const { updates = [] } = req.body;

    console.log(`🔁 Approving Sales Order ${id} via NetSuite RESTlet`);
    console.log("📦 Incoming updates:", JSON.stringify(updates, null, 2));

    // ✅ Basic validation
    if (!id || !Array.isArray(updates)) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing Sales Order ID or updates array." });
    }

    // 🔗 RESTlet endpoint (script & deploy from your environment)
    const restletUrl = `https://${process.env.NS_ACCOUNT_DASH}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_sb_approve_sales_order&deploy=customdeploy_sb_epos_approve_so`;

    // ✅ Build headers
    const headers = {
      ...getAuthHeader(restletUrl, "POST"),
      "Content-Type": "application/json",
    };

    // ✅ Prevent accidental double-fire within <1s for same ID
    if (!global._recentCommits) global._recentCommits = {};
    const now = Date.now();
    if (
      global._recentCommits[id] &&
      now - global._recentCommits[id] < 1000
    ) {
      console.warn(`⚠️ Duplicate commit request ignored for Sales Order ${id}`);
      return res.json({
        ok: false,
        warning: "Duplicate commit ignored (too soon)",
      });
    }
    global._recentCommits[id] = now;

    const payload = { id, updates };

    console.log(
      "📡 Calling NetSuite RESTlet with payload:",
      JSON.stringify(payload, null, 2)
    );

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

    // ✅ Handle RESTlet response
    if (!response.ok || !data.ok) {
      console.error("❌ RESTlet returned error:", text);
      return res.status(500).json({
        ok: false,
        error: data?.error || "NetSuite RESTlet call failed",
        raw: text,
      });
    }

    console.log(`✅ Sales Order ${id} updated & approved via RESTlet`);
    return res.json({
      ok: true,
      message: data.message || "Sales Order updated & approved",
      restletResult: data,
    });
  } catch (err) {
    console.error("❌ Commit Sales Order (RESTlet) failed:", err);
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
    const { id } = req.params; // Sales Order ID
    const dep = req.body;      // { id, name, amount }
    console.log(`💰 [Popup] Creating deposit for Sales Order ${id}`, dep);

    if (!dep?.id || !dep?.amount || !dep?.name) {
      return res.status(400).json({ ok: false, error: "Missing deposit fields" });
    }

    // 🔎 Fetch store + account mapping (reusing same DB logic)
    const [accRows] = await pool.query(
      `SELECT current_account, petty_cash_account FROM locations WHERE id = (SELECT store FROM orders WHERE netsuite_id = ? LIMIT 1)`,
      [id]
    );

    const currentAccountId = accRows?.[0]?.current_account || null;
    const pettyCashAccountId = accRows?.[0]?.petty_cash_account || null;
    const isCash = /cash/i.test(dep.name || "");
    const selectedAccountId = isCash ? pettyCashAccountId : currentAccountId;

    console.log("🏦 Account mapping for deposit:", { selectedAccountId });

    // ✅ Build NetSuite deposit body
    const depositBody = {
      salesorder: { id: String(id) },
      payment: parseFloat(dep.amount || 0),
      paymentmethod: { id: String(dep.id) },
      undepfunds: false,
      memo: dep.name || "",
      ...(selectedAccountId && { account: { id: String(selectedAccountId) } }),
    };

    console.log("🧾 [AddDeposit] Payload to NetSuite:", depositBody);

    // ✅ Create Customer Deposit
    const depositRes = await nsPost("/customerDeposit", depositBody);
    console.log("💰 NetSuite Deposit response:", depositRes);

    let depositId = depositRes?.id || null;
    if (!depositId && depositRes?._location) {
      const match = depositRes._location.match(/customerDeposit\/(\d+)/i);
      if (match) depositId = match[1];
    }

    if (!depositId) throw new Error("Deposit created but ID not returned");

    const depositLink = `https://7972741-sb1.app.netsuite.com/app/accounting/transactions/custdep.nl?id=${depositId}`;

    return res.json({
      ok: true,
      id: depositId,
      link: `<a href="${depositLink}" target="_blank">CD${depositId}</a>`,
    });
  } catch (err) {
    console.error("❌ Add Deposit (Popup) failed:", err);
    return res.status(500).json({ ok: false, error: err.message || "Deposit creation failed" });
  }
});


module.exports = router;
