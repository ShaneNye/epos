// public/js/salesOrderView.js

// Global top-level crash sniffers (keep super light)
window.addEventListener("error", e => console.error("💥 Uncaught error:", e.error || e.message));
window.addEventListener("unhandledrejection", e => console.error("💥 Unhandled Promise rejection:", e.reason));

// === Shared item cache loader (copied from salesNew.js) ===
async function loadItems() {
  try {
    const res = await fetch("/api/netsuite/items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    window.items = data.results || [];
    console.log("✅ Loaded items cache:", window.items.length, "records");
  } catch (err) {
    console.error("❌ Failed to load items cache:", err);
    window.items = [];
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("💡 DOMContentLoaded — starting salesOrderView load");
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    overlay.classList.remove("hidden");
    console.log("⏳ Spinner shown");
  } else {
    console.warn("⚠️ loadingOverlay element not found");
  }

  const saved = storageGet?.();
  if (!saved || !saved.token) {
    console.warn("🚫 No token in storage — redirecting to login");
    return (window.location.href = "/index.html");
  }
  const headers = { Authorization: `Bearer ${saved.token}` };

  // keep deposits across UI updates
  window._currentDeposits = [];

  // ✅ Load cached item feed (for Class detection, etc.)
  await loadItems();

  // === Extract Sales Order ID from URL ===
  const parts = window.location.pathname.split("/");
  const tranId = parts.pop() || parts.pop();
  if (!tranId) {
    alert("No Sales Order ID found in URL.");
    console.error("❌ Missing tranId from URL");
    return;
  }
  console.log("🔎 Sales Order ID:", tranId);


  try {
    // === Fetch Sales Order ===
    console.log("📡 Fetching /api/netsuite/salesorder/%s …", tranId);
    const res = await fetch(`/api/netsuite/salesorder/${tranId}`, { headers });
    const raw = await res.text();
    console.log("📥 Sales Order raw length:", raw?.length ?? 0);

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("❌ JSON parse failed:", e.message);
      throw new Error(`Invalid JSON from server (status ${res.status})`);
    }

    if (!res.ok || !data || data.ok === false) {
      console.error("❌ API not ok:", { status: res.status, bodyOk: !!data?.ok, error: data?.error });
      throw new Error(data?.error || `Server returned ${res.status}`);
    }

    const so = data.salesOrder || data;
    if (!so) throw new Error("No salesOrder object in response");
    console.log("✅ Sales Order received (tranId:%s, id:%s)", so.tranId || "-", so.id || "-");

    // ✅ Render linked deposits if any
    if (Array.isArray(data.deposits) && data.deposits.length > 0) {
      console.log("💰 Rendering %d deposit(s)", data.deposits.length);
      window._currentDeposits = data.deposits;
      renderDeposits(window._currentDeposits);
    } else {
      console.log("💰 No deposits returned");
    }

   // === Populate Customer Title (via entity lookup) ===
try {
  if (so.entity?.id) {
    console.log("🔎 Fetching full entity for title field:", so.entity.id);
    const entRes = await fetch(`/api/netsuite/entity/${so.entity.id}`, { headers });
    if (entRes.ok) {
      const entData = await entRes.json();
      console.log("🔎 Full Entity for SalesOrder:", entData);

      const entity = entData.entity || {};
      const titleObj = entity.custentity_title || entity.title || null;

      if (titleObj && titleObj.id) {
        console.log("🎩 NetSuite Title candidate (SO):", titleObj);
        const titleSelect = document.querySelector('select[name="title"]');
        if (titleSelect) {
          const match = Array.from(titleSelect.options).find(
            opt => String(opt.value) === String(titleObj.id)
          );
          if (match) {
            titleSelect.value = titleObj.id;
            console.log("✅ Title populated from entity:", titleObj.refName);
          } else {
            console.warn("⚠️ No matching title option found for:", titleObj);
          }
        }
      } else {
        console.warn("⚠️ No title field found on entity:", entity);
      }
    }
  }
} catch (err) {
  console.error("❌ Failed to populate title from entity:", err.message);
}


    // === Populate Customer + Address Info ===
    try {
      console.log("🏠 Populating address + customer fields");
      const addressLines = so.billingAddress_text
        ? so.billingAddress_text.split("\n").map(l => l.trim()).filter(Boolean)
        : [];
      const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
      let postcode = "", countryLine = "", cleanedAddress = [];

      for (const line of addressLines) {
        if (postcodeRegex.test(line)) {
          const match = line.match(postcodeRegex);
          if (match) postcode = match[0].toUpperCase();
          const townPart = line.replace(postcode, "").trim();
          if (townPart) cleanedAddress.push(townPart);
        } else if (/(United Kingdom|UK|England|Scotland|Wales|Northern Ireland)/i.test(line)) {
          countryLine = line;
        } else cleanedAddress.push(line);
      }

      document.querySelector('input[name="firstName"]').value =
        so.entity?.refName?.split(" ")[1] || "";
      document.querySelector('input[name="lastName"]').value =
        so.entity?.refName?.split(" ")[2] || "";
      document.querySelector('input[name="address1"]').value = cleanedAddress[0] || "";
      document.querySelector('input[name="address2"]').value = cleanedAddress[1] || "";
      document.querySelector('input[name="address3"]').value = cleanedAddress[2] || "";
      document.querySelector('input[name="postcode"]').value = postcode || "";
      document.querySelector('input[name="country"]').value = countryLine || "United Kingdom";
    } catch (err) {
      console.warn("⚠️ Address block failed:", err.message);
    }

    // === Contact Info ===
    document.querySelector('input[name="email"]').value = so.email || "";
    document.querySelector('input[name="contactNumber"]').value = so.custbody4 || so.phone || "";
    document.querySelector('input[name="altContactNumber"]').value = so.altPhone || "";

    // === Order Details ===
    try {
      console.log("📋 Populating order meta fields");
      const nsExecId = so.custbody_sb_bedspecialist?.id || null;
      if (nsExecId) {
        try {
          const userRes = await fetch("/api/users", { headers });
          if (userRes.ok) {
            const userData = await userRes.json();
            const users = userData.users || userData.data || [];
            const match = users.find(u => String(u.netsuiteId) === String(nsExecId));
            if (match) document.querySelector("#salesExec").value = match.id;
          }
        } catch (e) {
          console.warn("⚠️ Sales Exec lookup skipped:", e.message);
        }
      }

      const subsidiaryId =
        so.subsidiary?.id || so.location?.id || so.custbody_sb_primarystore?.id || null;

      if (subsidiaryId) {
        console.log("🏢 Fetching /api/meta/locations for subsidiary mapping…");
        const locRes = await fetch("/api/meta/locations", { headers });
        if (locRes.ok) {
          const locData = await locRes.json();
          const locations = locData.locations || locData.data || [];
          const match = locations.find(
            loc =>
              String(loc.netsuite_internal_id) === String(subsidiaryId) ||
              String(loc.invoice_location_id) === String(subsidiaryId)
          );
          if (match) document.querySelector("#store").value = match.id;
        }
      }

      document.querySelector('select[name="leadSource"]').value = so.leadSource?.id || "";
      document.querySelector("#paymentInfo").value = so.custbody_sb_paymentinfo?.id || "";
      document.querySelector("#warehouse").value = so.custbody_sb_warehouse?.id || "";
    } catch (err) {
      console.warn("⚠️ Order details block failed:", err.message);
    }

    // === Cache warehouse for inventory popup use ===
try {
  const warehouseSelect = document.getElementById("warehouse");
  if (warehouseSelect) {
    window.selectedWarehouseId = warehouseSelect.value.trim();
    window.selectedWarehouseName =
      warehouseSelect.options[warehouseSelect.selectedIndex]?.textContent.trim() || "";
    console.log("🏭 Cached warehouse from SO view:", window.selectedWarehouseId, window.selectedWarehouseName);

    // keep it updated if user changes warehouse
    warehouseSelect.addEventListener("change", () => {
      window.selectedWarehouseId = warehouseSelect.value.trim();
      window.selectedWarehouseName =
        warehouseSelect.options[warehouseSelect.selectedIndex]?.textContent.trim() || "";
      console.log("🏭 Updated warehouse cache:", window.selectedWarehouseId, window.selectedWarehouseName);
    });
  } else {
    console.warn("⚠️ Warehouse select not found in SO view");
  }
} catch (err) {
  console.error("❌ Failed to cache warehouse:", err.message);
}


// === Populate Order Items ===
console.log("🧾 Rendering item lines to table");
document.getElementById("orderNumber").textContent = so.tranId || tranId;
const tbody = document.getElementById("orderItemsBody");
tbody.innerHTML = "";

try {
  if (Array.isArray(so.item?.items)) {
    console.log("🧮 Item lines:", so.item.items.length);
    console.log("📦 Cached items in window.items:", Array.isArray(window.items) ? window.items.length : "not loaded");

    so.item.items.forEach((line, idx) => {
      const tr = document.createElement("tr");
      tr.classList.add("order-line");
      tr.dataset.line = idx;
      tr.dataset.lineid = line.lineId || ""; // ✅ cache true NetSuite internal line ID

      // guard against NaN (amount may be NET per line)
      const gross = Number(line.amount * line.quantity) || 0;
      const vat = line.vat ?? Number(line.saleprice || 0) * 0.2;
      const sale = Number(line.saleprice || 0);

      // 🔎 Detect Service items by cached item feed
      const itemId = String(line.item?.id || "");
      const itemData = window.items?.find(it => String(it["Internal ID"]) === itemId);
      const classFromLine = line.item?.class;
      const classFromCache = itemData?.["Class"];
      const className = (classFromCache || "").toLowerCase();
      const isService = className === "service";

      console.log(`🔎 Line ${idx} — Item check`, {
        itemId,
        itemRef: line.item,
        classFromLine,
        classFromCache,
        className,
        isService,
        rawItemData: itemData
      });

      let fulfilCell = "";
      let invCell = "";

      if (!isService) {
        if (so.orderStatus?.id === "A") {
          // Pending approval → editable
          fulfilCell = `<select class="fulfilmentSelect" data-line="${idx}"></select>`;
          invCell = `
            <div class="inventory-cell" style="display:none">
              <button 
                type="button" 
                class="open-inventory btn-secondary small-btn" 
                data-itemid="${line.item?.id || ""}" 
                data-line="${idx}" 
                data-qty="${line.quantity || 0}"
              >📦</button>
              <!-- 🔑 Always cache itemId + qty for popup -->
              <input 
                type="hidden" 
                class="item-internal-id" 
                data-line="${idx}" 
                value="${line.item?.id || ""}" 
              />
              <input 
                type="hidden" 
                class="item-qty-cache" 
                data-line="${idx}" 
                value="${line.quantity || 0}" 
              />
              <input 
                type="hidden" 
                class="item-inv-detail" 
                data-line="${idx}" 
                value="${line.inventoryDetail || ""}" 
              />
              <span class="inv-summary">${line.inventoryDetail || ""}</span>
            </div>
          `;
        } else {
          fulfilCell = line.custcol_sb_fulfilmentlocation?.refName || "";
          invCell = line.inventoryDetail ? "📦" : "";
        }
      } else {
        // 🚫 Service item → hide both
        fulfilCell = "";
        invCell = "";
        console.log(`🧾 Service item row ${idx} (${line.item?.refName}) — fulfilment & inventory hidden`);
      }

      // === Render row ===
      tr.innerHTML = `
        <td>${line.item?.refName || "—"}</td>
        <td>${line.custcol_sb_itemoptionsdisplay || ""}</td>
        <td class="qty">${line.quantity || 0}</td>
        <td class="amount">£${gross.toFixed(2)}</td>
        <td class="discount">${
          (() => {
            const retailGross = Number(line.amount * line.quantity) || 0;
            const saleGross = sale || 0;
            if (retailGross <= 0) return "0%";
            const pct = ((retailGross - saleGross) / retailGross) * 100;
            return `${Math.max(0, pct).toFixed(1)}%`;
          })()
        }</td>
        <td class="vat">£${Number(vat || 0).toFixed(2)}</td>
        <td class="saleprice">£${sale ? sale.toFixed(2) : "0.00"}</td>
        <td class="fulfilment-cell">${fulfilCell}</td>
        <td class="inventory-cell-wrapper">${invCell}</td>
        <!-- 🔑 Hidden cache fields for consistency -->
        <input type="hidden" class="item-qty-cache" data-line="${idx}" value="${line.quantity || 0}" />
        <input type="hidden" class="item-internal-id" data-line="${idx}" value="${line.item?.id || ""}" />
      `;

      console.log(`💾 Cached quantity for line ${idx}:`, line.quantity);
      tbody.appendChild(tr);

      if ((idx + 1) % 10 === 0) console.log("…rendered %d rows", idx + 1);
    });

    console.log("✅ Item lines rendered");


    // === Populate fulfilment dropdowns if Pending Approval ===
    if (so.orderStatus?.id === "A") {
      try {
        console.log("📡 Fetching fulfilment methods for dropdowns...");
        const res = await fetch("/api/netsuite/fulfilmentmethods");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const fulfilmentMethods = data.results || [];
        console.log("✅ Fulfilment methods loaded:", fulfilmentMethods);

        tbody.querySelectorAll(".fulfilmentSelect").forEach(sel => {
          sel.innerHTML = '<option value="">-- Select --</option>';
          fulfilmentMethods.forEach(method => {
            const opt = document.createElement("option");
            opt.value = method["Internal ID"] || method.id;
            opt.textContent = method["Name"] || method.name;
            sel.appendChild(opt);
          });

          // 🎯 Fulfilment change → toggle inventory button
          sel.addEventListener("change", () => {
            const lineIndex = sel.dataset.line;
            const invWrapper = tbody.querySelector(`.item-inv-detail[data-line="${lineIndex}"]`)?.closest(".inventory-cell");
            if (!invWrapper) return;

            const selectedText = sel.options[sel.selectedIndex]?.textContent?.toLowerCase() || "";
            if (["warehouse", "in store", "fulfil from store"].includes(selectedText)) {
              invWrapper.style.display = "inline-block";
            } else {
              invWrapper.style.display = "none";
            }
          });
        });
      } catch (err) {
        console.error("❌ Failed to load fulfilment methods:", err);
      }
    }

// === Attach inventory popup buttons ===
tbody.querySelectorAll(".open-inventory").forEach(btn => {
  btn.addEventListener("click", () => {
    const lineIndex = btn.dataset.line;

    // 🔎 Item ID (from dataset OR hidden field)
    const itemId =
      btn.dataset.itemid ||
      document.querySelector(`.item-internal-id[data-line="${lineIndex}"]`)?.value ||
      "";

    // 🔎 Quantity sources
    let qty = btn.dataset.qty;
    const cacheQty =
      document.querySelector(`.item-qty-cache[data-line="${lineIndex}"]`)?.value || 0;

    console.log("📊 Qty sources for line", lineIndex, {
      fromDataset: qty,
      fromCacheField: cacheQty
    });

    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      qty = cacheQty;
    }

    console.log("🪟 Final qty being passed to popup:", qty);

    // 🔎 Existing detail string
    const existing =
      document.querySelector(`.item-inv-detail[data-line="${lineIndex}"]`)?.value || "";

    // 🔑 Ensure warehouse cached
    const warehouseSel = document.getElementById("warehouse");
    if (warehouseSel) {
      window.selectedWarehouseId = warehouseSel.value.trim();
      window.selectedWarehouseName =
        warehouseSel.options[warehouseSel.selectedIndex]?.textContent.trim() || "";
      console.log(
        "🏭 Cached warehouse for popup:",
        window.selectedWarehouseId,
        window.selectedWarehouseName
      );
    }

    // 🔗 Build popup URL
    const url = `/inventory.html?itemId=${encodeURIComponent(itemId)}&qty=${encodeURIComponent(
      qty
    )}&detail=${encodeURIComponent(existing)}&line=${lineIndex}`;

    console.log("🪟 Opening inventory popup with URL:", url);

    const win = window.open(
      url,
      "InventoryDetail",
      "width=900,height=600,resizable=yes,scrollbars=yes"
    );
    if (win) win.focus();
  });
});




  } else {
    console.warn("⚠️ so.item.items missing or not array");
    const empty = document.createElement("tr");
    empty.innerHTML = `<td colspan="8" style="text-align:center; color:#888;">No item lines found.</td>`;
    tbody.appendChild(empty);
  }
} catch (err) {
  console.error("❌ Item rendering error:", err);
}


// === Load fulfilment methods if we are in Pending Approval ===
if (so.orderStatus?.id === "A") {
  try {
    console.log("📡 Fetching fulfilment methods for dropdowns...");
    const res = await fetch("/api/netsuite/fulfilmentmethods");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const fulfilmentMethods = data.results || [];
    console.log("✅ Fulfilment methods loaded:", fulfilmentMethods);

    // Populate each select
    tbody.querySelectorAll(".fulfilmentSelect").forEach(sel => {
      sel.innerHTML = '<option value="">-- Select --</option>';
      fulfilmentMethods.forEach(method => {
        const opt = document.createElement("option");
        opt.value = method["Internal ID"] || method.id;
        opt.textContent = method["Name"] || method.name;
        sel.appendChild(opt);
      });
    });
  } catch (err) {
    console.error("❌ Failed to load fulfilment methods:", err);
  }
}


// === Attach inventory popup buttons ===
tbody.querySelectorAll(".open-inventory").forEach(btn => {
  btn.addEventListener("click", () => {
    const lineIndex = btn.dataset.line;

    // item id: button → hidden → row
    let itemId =
      btn.dataset.itemid ||
      document.querySelector(`.item-internal-id[data-line="${lineIndex}"]`)?.value ||
      tbody.querySelector(`tr.order-line[data-line="${lineIndex}"]`)?.dataset.itemid ||
      "";

    // qty: button → hidden → row .qty text → server map → 0
    let qty = btn.dataset.qty;
    if (!qty || isNaN(qty) || Number(qty) <= 0) {
      qty =
        document.querySelector(`.item-qty-cache[data-line="${lineIndex}"]`)?.value ||
        tbody.querySelector(`tr.order-line[data-line="${lineIndex}"] .qty`)?.textContent ||
        (Array.isArray(window._soLineQtyMap) ? window._soLineQtyMap[Number(lineIndex)] : 0) ||
        0;
    }
    qty = String(qty).trim();
    if (!qty || isNaN(qty)) qty = "0";

    const existing =
      document.querySelector(`.item-inv-detail[data-line="${lineIndex}"]`)?.value || "";

    // 🔑 Ensure warehouse is cached for popup
    const warehouseSel = document.getElementById("warehouse");
    if (warehouseSel) {
      window.selectedWarehouseId = warehouseSel.value.trim();
      window.selectedWarehouseName =
        warehouseSel.options[warehouseSel.selectedIndex]?.textContent.trim() || "";
      console.log("🏭 Cached warehouse for popup:", window.selectedWarehouseId, window.selectedWarehouseName);
    }

    console.log("🪟 Opening inventory popup with:", { lineIndex, itemId, qty, existing });

    const url = `/inventory.html?itemId=${encodeURIComponent(itemId)}&qty=${encodeURIComponent(qty)}&detail=${encodeURIComponent(existing)}&line=${lineIndex}`;
    const win = window.open(url, "InventoryDetail", "width=900,height=600,resizable=yes,scrollbars=yes");
    if (win) win.focus();
  });
});


// === Show/hide inventory by fulfilment ===
function validateInventoryForRow(row) {
  const fulfilSel = row.querySelector(".fulfilmentSelect");
  const invCell = row.querySelector(".inventory-cell");
  if (!fulfilSel || !invCell) return;

  const value = (fulfilSel.options[fulfilSel.selectedIndex]?.textContent || "").toLowerCase();
  const allowed = ["warehouse", "in store", "fulfil from store"];

  if (allowed.some(a => value.includes(a))) {
    invCell.style.display = "block";
  } else {
    invCell.style.display = "none";
  }
}

// Attach fulfilment listeners + initial validation
tbody.querySelectorAll("tr").forEach(row => {
  const fulfilSel = row.querySelector(".fulfilmentSelect");
  if (fulfilSel) {
    fulfilSel.addEventListener("change", () => validateInventoryForRow(row));
    validateInventoryForRow(row); // run once
  }
});

// === Lock View (with exceptions for pending approval) ===
if (so.orderStatus?.id === "A") {
  console.log("🔓 Pending approval — fulfilment + inventory remain editable");
  document.querySelectorAll("input, select, textarea, button").forEach(el => {
    if (el.classList.contains("fulfilmentSelect") ||
        el.classList.contains("open-inventory") ||
        el.classList.contains("item-inv-detail")) {
      return; // keep these editable
    }
    el.disabled = true;
    el.classList.add("locked-input");
  });
} else {
  document.querySelectorAll("input, select, textarea, button").forEach(el => {
    el.disabled = true;
    el.classList.add("locked-input");
  });
  console.log("🔒 Form locked (read-only)");
}

setTimeout(() => {
  updateOrderSummaryFromTable();
  console.log("📊 Summary recalculated");
}, 200);

updateActionButton(so.orderStatus || so.status || {}, tranId, so);
console.log("🧭 Action buttons set");

// === Enable Add Deposit Popup ===
setTimeout(() => {
  const addDepositBtn = document.getElementById("addDepositBtn");
  if (!addDepositBtn) {
    console.warn("⚠️ Add Deposit button not found");
    return;
  }
  addDepositBtn.disabled = false;
  addDepositBtn.classList.remove("locked-input");
  addDepositBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("🟦 Add Deposit clicked — opening popup");
    const popup = window.open(
      window.location.origin + "/deposit.html",
      "AddDeposit",
      "width=420,height=520,resizable=yes,scrollbars=no"
    );
    if (!popup) {
      alert("⚠️ Please allow popups for this site to add deposits.");
      console.warn("🚫 Popup blocked");
    } else {
      popup.focus();
      console.log("✅ Deposit popup opened");
    }
  });
}, 500);

} catch (err) {
console.error("❌ Load failure:", err);
alert("Failed to load Sales Order details. " + err.message);
} finally {
// Always hide the spinner
console.log("🏁 finally{} reached — hiding spinner");
try {
  setTimeout(() => {
    overlay?.classList.add("hidden");
    console.log("🟢 Spinner hidden");
  }, 300);
} catch (e) {
  console.warn("⚠️ Failed to hide spinner:", e.message);
}
}
});

/* =====================================================
   === 💰 Render Deposits Table + Summary Update ========
   ===================================================== */
function renderDeposits(deposits) {
  console.log("💾 renderDeposits()", Array.isArray(deposits) ? deposits.length : deposits);
  const section = document.getElementById("depositsSection");
  const tbody = document.querySelector("#depositsTable tbody");
  const count = document.getElementById("depositCount");
  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");
  if (!section || !tbody) {
    console.warn("⚠️ Deposit section/table not found");
    return;
  }

  if (!Array.isArray(deposits)) deposits = [];
  if (deposits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">No deposits found.</td></tr>`;
    section.classList.remove("hidden");
    section.style.display = "block";
    if (depositsTotalCell) depositsTotalCell.textContent = "£0.00";
    if (balanceCell) balanceCell.textContent = "£0.00";
    console.log("ℹ️ No deposits to render");
    return;
  }

  section.classList.remove("hidden");
  section.style.display = "block";
  if (count) count.textContent = deposits.length;
  tbody.innerHTML = "";

  let totalDeposits = 0;
  deposits.forEach((d) => {
    const amount = parseFloat(d.amount || 0);
    totalDeposits += amount;
    const tr = document.createElement("tr");

    const tdLink = document.createElement("td");
    tdLink.innerHTML = d.link || "-";

    const tdMethod = document.createElement("td");
    tdMethod.textContent = d.method || "-";

    const tdAmount = document.createElement("td");
    tdAmount.textContent = `£${amount.toFixed(2)}`;

    tr.append(tdLink, tdMethod, tdAmount);
    tbody.appendChild(tr);
  });

  updateDepositTotals(totalDeposits);
  console.log("✅ Deposits rendered — total £%s", totalDeposits.toFixed(2));
}

/* =====================================================
   === Helper: Update Deposit Totals ====================
   ===================================================== */
function updateDepositTotals(totalDeposits) {
  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");

  const grandTotalText = document.getElementById("grandTotal")?.textContent || "£0.00";
  const grandTotal = parseFloat(grandTotalText.replace(/[£,]/g, "")) || 0;

  let outstanding = grandTotal - totalDeposits;
  outstanding = Math.round(outstanding * 100) / 100;
  if (Math.abs(outstanding) < 0.005) outstanding = 0;

  if (depositsTotalCell)
    depositsTotalCell.textContent = `£${totalDeposits.toFixed(2)}`;

  if (balanceCell) {
    balanceCell.textContent = `£${outstanding.toFixed(2)}`;
    balanceCell.style.color = outstanding === 0 ? "#008060" : "#d00000";
    balanceCell.style.fontWeight = "600";
  }
  console.log("💰 Totals updated — outstanding £%s", outstanding.toFixed(2));
}

/* =====================================================
   === 🔁 Handle Deposit Saved from Popup ===============
   ===================================================== */
window.onDepositSaved = async (deposit) => {
  console.log("💰 onDepositSaved:", deposit);
  if (!deposit || !deposit.id || !deposit.amount) return;

  const soId = window.location.pathname.split("/").pop();

  try {
    const res = await fetch(`/api/netsuite/salesorder/${soId}/add-deposit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deposit),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Deposit creation failed");

    const newDeposit = {
      link: data.link || "-",
      amount: deposit.amount,
      method: deposit.name,
      soId,
    };

    window._currentDeposits.push(newDeposit);
    renderDeposits(window._currentDeposits);
    showToast?.(`✅ Deposit £${Number(deposit.amount).toFixed(2)} added`, "success");
  } catch (err) {
    console.error("❌ Add deposit failed:", err.message);
    showToast?.(`❌ ${err.message}`, "error");
  }
};

/* =====================================================
   === Helper: Update Summary from Table ===============
   ===================================================== */
function updateOrderSummaryFromTable() {
  console.log("🧮 updateOrderSummaryFromTable()");
  const rows = document.querySelectorAll("#orderItemsBody tr");
  if (!rows.length) {
    console.log("ℹ️ No rows to summarize");
    return;
  }

  let subtotal = 0, discountTotal = 0, taxTotal = 0, grandTotal = 0;
  rows.forEach(row => {
    const amountEl = row.querySelector(".amount");
    const discountEl = row.querySelector(".discount");
    const vatEl = row.querySelector(".vat");
    const saleEl = row.querySelector(".saleprice");
    if (!amountEl || !saleEl) return;

    const amount = parseFloat(amountEl.textContent.replace(/[£,]/g, "")) || 0;
    const vat = parseFloat(vatEl?.textContent.replace(/[£,]/g, "")) || 0;
    const sale = parseFloat(saleEl?.textContent.replace(/[£,]/g, "")) || 0;
    const discountPct =
      discountEl && discountEl.textContent.includes("%")
        ? parseFloat(discountEl.textContent)
        : 0;
    const discountValue = (amount * discountPct) / 100;

    subtotal += amount;
    discountTotal += discountValue;
    taxTotal += vat;
    grandTotal += sale;
  });

  document.getElementById("subTotal").textContent = `£${subtotal.toFixed(2)}`;
  document.getElementById("discountTotal").textContent = `£${discountTotal.toFixed(2)}`;
  document.getElementById("taxTotal").textContent = `£${taxTotal.toFixed(2)}`;
  document.getElementById("grandTotal").textContent = `£${grandTotal.toFixed(2)}`;
  console.log("📊 Summary set — grand £%s", grandTotal.toFixed(2));

  if (window._currentDeposits && window._currentDeposits.length > 0) {
    const totalDeposits = window._currentDeposits.reduce(
      (sum, d) => sum + (parseFloat(d.amount) || 0),
      0
    );
    updateDepositTotals(totalDeposits);
  }
}

/* =====================================================
   === Helper: Spinner for Commit ======================
   ===================================================== */
function showCommitSpinner() {
  document.getElementById("commitSpinner")?.classList.remove("hidden");
}
function hideCommitSpinner() {
  document.getElementById("commitSpinner")?.classList.add("hidden");
}

/* =====================================================
   === Helper: Show Commit / Fulfil Button =============
   ===================================================== */
function updateActionButton(orderStatusObj, tranId, so) {
  console.log("⚙️ updateActionButton()", orderStatusObj);
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;
  wrapper.innerHTML = "";

  const statusId = (orderStatusObj?.id || "").toUpperCase();
  const statusName = (orderStatusObj?.refName || "").toLowerCase();
  let btnHtml = "", btnId = "";

  if (statusId === "A" || statusName.includes("approval")) {
    btnId = "commitOrderBtn";
    btnHtml = `<button id="${btnId}" class="btn-primary">Commit</button>`;
  } else if (["B", "C"].includes(statusId) || statusName.includes("fulfil")) {
    btnId = "fulfilOrderBtn";
    btnHtml = `<button id="${btnId}" class="btn-primary">Fulfil</button>`;
  } else {
    console.log("ℹ️ No action button for status:", statusName || statusId);
    return;
  }

  wrapper.innerHTML = btnHtml;
  console.log("✅ Rendered action button:", btnId);

  const commitBtn = document.getElementById(btnId);
  if (btnId === "commitOrderBtn" && commitBtn) {
    // 🧹 Prevent duplicate bindings
    commitBtn.replaceWith(commitBtn.cloneNode(true));
    const freshBtn = document.getElementById(btnId);

    freshBtn.addEventListener("click", async () => {
      const savedAuth = storageGet?.();
      const token = savedAuth?.token;
      if (!token) {
        console.warn("⚠️ No auth token — redirecting to login");
        return (window.location.href = "/index.html");
      }

      // ✨ Gather fulfilment + inventory inputs
      const updates = [];
      document.querySelectorAll("#orderItemsBody tr.order-line").forEach(row => {
        const lineId = row.dataset.lineid || ""; // ✅ NetSuite internal line id
        const fulfilSel = row.querySelector(".fulfilmentSelect");
        const invInp = row.querySelector(".item-inv-detail");
        const qtyCache = row.querySelector(".item-qty-cache")?.value || 0;
        const itemId = row.querySelector(".item-internal-id")?.value || "";

        // ✅ Try to get fulfilment method safely
        let fulfilmentValue = fulfilSel?.value?.trim() || "";

        // If no value selected, fallback to cell text (displayed name)
        if (!fulfilmentValue) {
          const currentRef =
            row.querySelector(".fulfilment-cell")?.textContent?.trim() || "";
          if (currentRef) {
            // Try to map display name to an ID via cached fulfilment methods
            const match = (window._fulfilmentMap || []).find(
              f =>
                f["Name"]?.toLowerCase() === currentRef.toLowerCase() ||
                f.name?.toLowerCase() === currentRef.toLowerCase()
            );
            fulfilmentValue = match?.["Internal ID"] || match?.id || "";
            if (fulfilmentValue)
              console.log(
                `🧩 Mapped fulfilment text '${currentRef}' → ID ${fulfilmentValue}`
              );
          }
        }

        // Final value (null if empty)
        const fulfilmentMethod = fulfilmentValue ? String(fulfilmentValue) : null;

        updates.push({
          lineId,
          itemId,
          quantity: Number(qtyCache),
          fulfilmentMethod,
          inventoryDetail: invInp?.value || null,
        });
      });

      console.log("🟩 Commit clicked with updates:", updates);

      try {
        showCommitSpinner();
        const res = await fetch(`/api/netsuite/salesorder/${tranId}/commit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ updates }),
        });

        const data = await res.json();
        console.log("🧾 Commit response:", data);

        if (!res.ok || !data.ok)
          throw new Error(data.error || "Failed to commit order");

        showToast?.(`✅ Order ${tranId} approved!`, "success");
        hideCommitSpinner();
        setTimeout(() => location.reload(), 2500);
      } catch (err) {
        hideCommitSpinner();
        console.error("❌ Commit error:", err);
        showToast?.(`❌ ${err.message}`, "error");
      }
    });
  }

  // === Fulfil button logic ===
  else if (btnId === "fulfilOrderBtn") {
    const fulfilBtn = document.getElementById(btnId);
    if (fulfilBtn) {
      fulfilBtn.replaceWith(fulfilBtn.cloneNode(true));
      const freshFulfil = document.getElementById(btnId);
      freshFulfil.addEventListener("click", () => {
        console.log("📦 Fulfil clicked for:", tranId);
        // TODO: Add fulfil flow here if needed
      });
    }
  }
}
