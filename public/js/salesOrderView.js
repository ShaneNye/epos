// public/js/salesOrderView.js

// Lightweight global crash sniffers
window.addEventListener("error", e =>
  console.error("💥 Uncaught error:", e.error || e.message)
);
window.addEventListener("unhandledrejection", e =>
  console.error("💥 Unhandled Promise rejection:", e.reason)
);

/* =====================================================
   Item cache (sessionStorage) – shared with other pages
   ===================================================== */
async function loadItemCache() {
  try {
    const cached = sessionStorage.getItem("nsItemCache");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        window.items = parsed;
        console.log("✅ Items loaded from cache:", parsed.length);
        return parsed;
      }
    }

    const res = await fetch("/api/netsuite/items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data.results || [];
    window.items = items;

    try {
      sessionStorage.setItem("nsItemCache", JSON.stringify(items));
    } catch {
      // ignore storage errors (quota etc.)
    }

    console.log("✅ Items loaded from API:", items.length);
    return items;
  } catch (err) {
    console.error("❌ Failed to load items cache:", err.message || err);
    window.items = [];
    return [];
  }
}
// ==========================================================
// TOAST NOTIFICATION (Cloned from SalesNew.js)
// ==========================================================
(function () {
  const toast = document.getElementById("orderToast");
  if (!toast) return;

  window.showToast = function (message, type = "success") {
    toast.textContent = message;
    toast.className = `order-toast ${type}`;
    toast.classList.remove("hidden");

    // Delay triggers CSS animation
    requestAnimationFrame(() => toast.classList.add("show"));

    // Auto-hide
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 300);
    }, 3000);
  };
})();



/* =====================================================
   Main Sales Order View Loader
   ===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("💡 SalesOrderView init");

  const overlay = document.getElementById("loadingOverlay");
  overlay?.classList.remove("hidden");

  // ---- Auth / token ----
  let saved = storageGet?.();
  if (!saved || !saved.token) {
    await new Promise(r => setTimeout(r, 300));
    saved = storageGet?.();
  }
  if (!saved || !saved.token) {
    console.error("🚫 No auth token – redirecting to login");
    return (window.location.href = "/index.html");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${saved.token}`,
  };

  populateSalesExecAndStore(headers);


  /* =====================================================
   Populate Sales Executive & Store Dropdowns (extracted from salesNew.js)
   ===================================================== */

  async function populateSalesExecAndStore(headers) {
    // Load Current User
    let currentUser = null;
    try {
      const meRes = await fetch("/api/me", { headers });
      const meData = await meRes.json();
      if (meData.ok && meData.user) {
        currentUser = meData.user;
        console.log("🧑 Current user:", currentUser);
      }
    } catch (err) {
      console.warn("⚠️ Failed to load current user:", err);
    }

    // Load Sales Executives
    try {
      const res = await fetch("/api/users", { headers });
      const data = await res.json();

      if (data.ok) {
        const execSelect = document.getElementById("salesExec");
        if (execSelect) {
          execSelect.innerHTML = '<option value="">Select Sales Executive</option>';

          const salesExecs = data.users.filter(
            u => Array.isArray(u.roles) && u.roles.some(r => r.name === "Sales Executive")
          );

          salesExecs.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = `${u.firstName} ${u.lastName}`;
            execSelect.appendChild(opt);
          });

          // Auto-assign if user is a Sales Exec
          if (currentUser && salesExecs.some(u => u.id === currentUser.id)) {
            execSelect.value = currentUser.id;
            console.log("✔ Auto-set Sales Exec to current user");
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to load sales executives:", err);
    }

    // Load Stores
    try {
      const res = await fetch("/api/meta/locations", { headers });
      const data = await res.json();

      if (data.ok) {
        const storeSelect = document.getElementById("store");
        if (storeSelect) {
          storeSelect.innerHTML = '<option value="">Select Store</option>';

          const filteredLocations = data.locations.filter(
            loc => !/warehouse/i.test(loc.name)
          );

          filteredLocations.forEach(loc => {
            const opt = document.createElement("option");
            opt.value = String(loc.id);
            opt.textContent = loc.name;
            storeSelect.appendChild(opt);
          });

          // Default to user’s primary store
          if (currentUser && currentUser.primaryStore) {
            const match = filteredLocations.find(l =>
              String(l.id) === String(currentUser.primaryStore) ||
              l.name === currentUser.primaryStore
            );

            if (match) {
              storeSelect.value = String(match.id);
              console.log("✔ Auto-set store to:", match.name);
            }
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to load stores:", err);
    }
  }


  // ---- Sales Order ID from URL ----
  const pathParts = window.location.pathname.split("/");
  const tranId = pathParts.pop() || pathParts.pop();
  if (!tranId) {
    alert("No Sales Order ID found in URL.");
    console.error("❌ Missing tranId from URL");
    return;
  }

  try {
    // ==================================================
    // 1️⃣ Load everything in parallel where possible
    // ==================================================
    const [
      _items,            // item cache (ignored variable, but ensures cache ready)
      soRes,
      locRes,
      userRes,
      fulfilRes
    ] = await Promise.all([
      loadItemCache(),
      fetch(`/api/netsuite/salesorder/${tranId}`, { headers }),
      fetch("/api/meta/locations", { headers }),
      fetch("/api/users", { headers }),
      fetch("/api/netsuite/fulfilmentmethods").catch(() => null)
    ]);

    // --- Sales Order response ---
    const soJson = await soRes.json();
    if (!soRes.ok || !soJson || soJson.ok === false) {
      throw new Error(soJson?.error || `Server returned ${soRes.status}`);
    }

    const so = soJson.salesOrder || soJson;
    if (!so) throw new Error("No salesOrder object in response");
    console.log("✅ Sales Order loaded:", so.tranId || tranId);

    // --- Locations, Users, Fulfilment Methods ---
    const locJson = locRes.ok ? await locRes.json() : {};
    const locations = locJson.locations || locJson.data || [];

    const userJson = userRes.ok ? await userRes.json() : {};
    const users = userJson.users || userJson.data || [];

    let fulfilmentMethods = [];
    if (fulfilRes && fulfilRes.ok) {
      const fJson = await fulfilRes.json();
      fulfilmentMethods = fJson.results || [];
    }
    window._fulfilmentMap = fulfilmentMethods.map(f => ({
      id: String(f["Internal ID"] || f.id),
      name: f["Name"] || f.name,
    }));

    // ==================================================
    // 2️⃣ Render Deposits (from backend aggregation)
    // ==================================================
    if (Array.isArray(soJson.deposits) && soJson.deposits.length) {
      window._currentDeposits = soJson.deposits;
      renderDeposits(window._currentDeposits);
    } else {
      window._currentDeposits = [];
    }

    // ==================================================
    // 3️⃣ Populate header + customer + order meta
    // ==================================================
    document.getElementById("orderNumber").textContent = so.tranId || tranId;

    // --- Customer / address ---
    try {
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
        } else {
          cleanedAddress.push(line);
        }
      }

      const fullName = so.entity?.refName || "";
      const nameParts = fullName.split(" ");
      document.querySelector('input[name="firstName"]').value = nameParts[1] || "";
      document.querySelector('input[name="lastName"]').value = nameParts[2] || "";
      document.querySelector('input[name="address1"]').value = cleanedAddress[0] || "";
      document.querySelector('input[name="address2"]').value = cleanedAddress[1] || "";
      document.querySelector('input[name="address3"]').value = cleanedAddress[2] || "";
      document.querySelector('input[name="postcode"]').value = postcode || "";
      document.querySelector('input[name="country"]').value = countryLine || "United Kingdom";
    } catch (err) {
      console.warn("⚠️ Address population failed:", err.message);
    }

    // --- Contact info ---
    document.querySelector('input[name="email"]').value = so.email || "";
    document.querySelector('input[name="contactNumber"]').value = so.custbody4 || so.phone || "";
    document.querySelector('input[name="altContactNumber"]').value = so.altPhone || "";

    // --- Title (use entityFull if backend attached it) ---
    try {
      const entity = so.entityFull || {};
      const titleObj = entity.custentity_title || entity.title || null;
      if (titleObj?.id) {
        const titleSelect = document.querySelector('select[name="title"]');
        if (titleSelect) {
          const match = Array.from(titleSelect.options).find(
            opt => String(opt.value) === String(titleObj.id)
          );
          if (match) titleSelect.value = titleObj.id;
        }
      }
    } catch (err) {
      console.warn("⚠️ Title population skipped:", err.message);
    }

    // --- Order meta (Sales Exec, Store, Lead Source, Warehouse etc.) ---
    try {
      const nsExecId = so.custbody_sb_bedspecialist?.id || null;
      if (nsExecId && users.length) {
        const execMatch = users.find(u => String(u.netsuiteId) === String(nsExecId));
        if (execMatch) document.querySelector("#salesExec").value = execMatch.id;
      }

      const subsidiaryId =
        so.subsidiary?.id || so.location?.id || so.custbody_sb_primarystore?.id || null;

      if (subsidiaryId && locations.length) {
        const storeMatch = locations.find(
          loc =>
            String(loc.netsuite_internal_id) === String(subsidiaryId) ||
            String(loc.invoice_location_id) === String(subsidiaryId)
        );
        if (storeMatch) document.querySelector("#store").value = storeMatch.id;
      }

      document.querySelector('select[name="leadSource"]').value = so.leadSource?.id || "";
      document.querySelector("#paymentInfo").value = so.custbody_sb_paymentinfo?.id || "";
      document.querySelector("#warehouse").value = so.custbody_sb_warehouse?.id || "";
    } catch (err) {
      console.warn("⚠️ Order meta population failed:", err.message);
    }

    // --- Cache warehouse for inventory popup use ---
    try {
      const warehouseSelect = document.getElementById("warehouse");
      if (warehouseSelect) {
        const updateWarehouseCache = () => {
          window.selectedWarehouseId = warehouseSelect.value.trim();
          window.selectedWarehouseName =
            warehouseSelect.options[warehouseSelect.selectedIndex]?.textContent.trim() || "";
        };
        updateWarehouseCache();
        warehouseSelect.addEventListener("change", updateWarehouseCache);
      }
    } catch (err) {
      console.error("❌ Warehouse cache failed:", err.message);
    }

    // ==================================================
    // 4️⃣ Render Item Lines (fast DOM)
    // ==================================================
    const tbody = document.getElementById("orderItemsBody");
    tbody.innerHTML = "";
    if (Array.isArray(so.item?.items) && so.item.items.length) {
      const frag = document.createDocumentFragment();

      so.item.items.forEach((line, idx) => {
        const tr = document.createElement("tr");
        tr.classList.add("order-line");
        tr.dataset.line = idx;
        tr.dataset.lineid = line.lineId || "";

        const itemId = String(line.item?.id || "");
        const itemData = window.items?.find(it => String(it["Internal ID"]) === itemId);
        const classFromCache = itemData?.["Class"];
        const className = (classFromCache || "").toLowerCase();
        const isService = className === "service";
        const quantity = Number(line.quantity || 0);
        const retailNet = Number(line.amount || 0);
        const gross = retailNet * quantity || 0;

        let sale = Number(line.saleprice || 0);
        if (gross < 0 && sale > 0) {
          sale = -sale;
        }

        const vat =
          line.vat ??
          (sale ? sale - retailNet * quantity : retailNet * quantity * 0.2);


        let fulfilCellHtml = "";
        let invCellHtml = "";

        if (!isService) {
          if (so.orderStatus?.id === "A") {
            // Pending approval → editable fulfilment + inventory
            fulfilCellHtml = `<select class="fulfilmentSelect" data-line="${idx}"></select>`;
            invCellHtml = `
              <div class="inventory-cell" style="display:none">
                <button 
                  type="button" 
                  class="open-inventory btn-secondary small-btn" 
                  data-itemid="${line.item?.id || ""}" 
                  data-line="${idx}" 
                  data-qty="${quantity}"
                >📦</button>
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
                  value="${quantity}" 
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
            fulfilCellHtml = line.custcol_sb_fulfilmentlocation?.refName || "";
            invCellHtml = line.inventoryDetail ? "📦" : "";
          }
        }

        const discountPct = (() => {
          const retailGross = retailNet * quantity || 0;
          const saleGross = sale || 0;
          if (retailGross <= 0) return 0;
          return Math.max(0, ((retailGross - saleGross) / retailGross) * 100);
        })();

        tr.innerHTML = `
          <td>${line.item?.refName || "—"}</td>
          <td>${line.custcol_sb_itemoptionsdisplay || ""}</td>
          <td class="qty">${quantity}</td>
          <td class="amount">£${gross.toFixed(2)}</td>
          <td class="discount">${discountPct.toFixed(1)}%</td>
          <td class="vat">£${Number(vat || 0).toFixed(2)}</td>
          <td class="saleprice">£${sale ? sale.toFixed(2) : "0.00"}</td>
          <td class="fulfilment-cell">${fulfilCellHtml}</td>
          <td class="inventory-cell-wrapper">${invCellHtml}</td>
          <input type="hidden" class="item-qty-cache" data-line="${idx}" value="${quantity}" />
          <input type="hidden" class="item-internal-id" data-line="${idx}" value="${line.item?.id || ""}" />
        `;

        frag.appendChild(tr);
      });

      tbody.appendChild(frag);
    } else {
      const empty = document.createElement("tr");
      empty.innerHTML = `<td colspan="8" style="text-align:center; color:#888;">No item lines found.</td>`;
      tbody.appendChild(empty);
    }

    // ==================================================
    // 5️⃣ Populate fulfilment dropdowns (once) + inventory buttons
    // ==================================================
    if (so.orderStatus?.id === "A" && fulfilmentMethods.length) {
      const allowedInvTexts = ["warehouse", "in store", "fulfil from store"];

      tbody.querySelectorAll(".fulfilmentSelect").forEach(sel => {
        const lineIndex = sel.dataset.line;
        const line = so.item?.items?.[lineIndex] || {};

        const currentFulfilId =
          line?.custcol_sb_fulfilmentlocation?.id ||
          line?.fulfilmentlocation ||
          line?.CUSTCOL_SB_FULFILMENTLOCATION ||
          "";

        const currentFulfilName =
          line?.custcol_sb_fulfilmentlocation?.refName ||
          line?.custcol_sb_fulfilmentlocation?.name ||
          line?.fulfilmentlocationname ||
          "";

        sel.innerHTML = '<option value="">-- Select --</option>';

        fulfilmentMethods.forEach(method => {
          const id = String(method["Internal ID"] || method.id);
          const name = method["Name"] || method.name;
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = name;

          if (
            (currentFulfilId && String(id) === String(currentFulfilId)) ||
            (currentFulfilName && name.toLowerCase() === currentFulfilName.toLowerCase())
          ) {
            opt.selected = true;
          }

          sel.appendChild(opt);
        });

        // initial inventory toggle
        const row = tbody.querySelector(`tr[data-line="${lineIndex}"]`);
        const invWrapper = row?.querySelector(".inventory-cell");
        const setInvVisibility = () => {
          if (!invWrapper) return;
          const text =
            sel.options[sel.selectedIndex]?.textContent?.toLowerCase() || "";
          invWrapper.style.display =
            allowedInvTexts.some(a => text.includes(a)) ? "inline-block" : "none";
        };
        sel.addEventListener("change", setInvVisibility);
        setInvVisibility();
      });

      // Inventory popup buttons
      tbody.querySelectorAll(".open-inventory").forEach(btn => {
        btn.addEventListener("click", () => {
          const lineIndex = btn.dataset.line;
          const itemId =
            btn.dataset.itemid ||
            document.querySelector(`.item-internal-id[data-line="${lineIndex}"]`)?.value ||
            "";

          let qty = btn.dataset.qty;
          if (!qty || isNaN(qty) || Number(qty) <= 0) {
            qty =
              document.querySelector(`.item-qty-cache[data-line="${lineIndex}"]`)?.value ||
              tbody.querySelector(`tr.order-line[data-line="${lineIndex}"] .qty`)?.textContent ||
              0;
          }
          qty = String(qty).trim() || "0";

          const existing =
            document.querySelector(`.item-inv-detail[data-line="${lineIndex}"]`)?.value || "";

          const warehouseSel = document.getElementById("warehouse");
          if (warehouseSel) {
            window.selectedWarehouseId = warehouseSel.value.trim();
            window.selectedWarehouseName =
              warehouseSel.options[warehouseSel.selectedIndex]?.textContent.trim() || "";
          }

          const url = `/inventory.html?itemId=${encodeURIComponent(
            itemId
          )}&qty=${encodeURIComponent(qty)}&detail=${encodeURIComponent(
            existing
          )}&line=${lineIndex}`;

          const win = window.open(
            url,
            "InventoryDetail",
            "width=900,height=600,resizable=yes,scrollbars=yes"
          );
          if (win) win.focus();
        });
      });
    }

    // ==================================================
    // 6️⃣ Lock / unlock form depending on order status
    // ==================================================
    if (so.orderStatus?.id === "A") {
      console.log("🔓 Pending approval – fulfilment & inventory editable");
      document.querySelectorAll("input, select, textarea, button").forEach(el => {
        if (
          el.classList.contains("fulfilmentSelect") ||
          el.classList.contains("open-inventory") ||
          el.classList.contains("item-inv-detail") ||
          el.id === "newMemoBtn" ||
          el.id === "printBtn"
        ) {
          return;
        }
        el.disabled = true;
        el.classList.add("locked-input");
      });
    } else {
      document.querySelectorAll("input, select, textarea, button").forEach(el => {
        if (el.id === 
          "newMemoBtn" || 
          "printBtn") 
          
          return;
        el.disabled = true;
        el.classList.add("locked-input");
      });
      console.log("🔒 Form locked (read-only, memo enabled)");
    }

    // ==================================================
    // 7️⃣ Summary + Action button + Add Deposit
    // ==================================================
    updateOrderSummaryFromTable();
    updateActionButton(so.orderStatus || so.status || {}, tranId, so);

    // Enable Add Deposit popup
    const addDepositBtn = document.getElementById("addDepositBtn");
    if (addDepositBtn) {
      addDepositBtn.disabled = false;
      addDepositBtn.classList.remove("locked-input");
      addDepositBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const popup = window.open(
          window.location.origin + "/deposit.html",
          "AddDeposit",
          "width=420,height=520,resizable=yes,scrollbars=no"
        );
        if (!popup) {
          alert("⚠️ Please allow popups for this site to add deposits.");
        } else {
          popup.focus();
        }
      });
    }
  } catch (err) {
    console.error("❌ Load failure:", err.message || err);
    alert("Failed to load Sales Order details. " + (err.message || err));
  } finally {
    overlay?.classList.add("hidden");
  }
});

/* =====================================================
   Memo Panel (separate but lightweight)
   ===================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const auth = storageGet?.();
  const token = auth?.token || null;

  const memoPanel = document.getElementById("memoPanel");
  const memoHeader = document.querySelector(".memo-header");
  const memoTableBody = document.querySelector("#memoTable tbody");
  const noMemosMsg = document.getElementById("noMemosMsg");

  if (!memoPanel || !memoHeader || !memoTableBody) return;

  const parts = window.location.pathname.split("/");
  const orderId = parts.pop() || parts.pop();

  memoHeader.addEventListener("click", () => {
    memoPanel.classList.toggle("expanded");
  });

  document.getElementById("newMemoBtn")?.addEventListener("click", () => {
    if (!token) return alert("Missing session token");
    const url = `/memo.html?orderId=${orderId}&token=${token}`;
    const w = window.open(
      url,
      "MemoPopup",
      "width=550,height=600,resizable=yes,scrollbars=yes"
    );
    if (!w) alert("Please allow popups.");
  });

  async function loadMemos() {
    try {
      const res = await fetch(`/api/sales/memo/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      memoTableBody.innerHTML = "";
      updateMemoHeader(data.memos?.length || 0);

      if (!data.ok || !data.memos?.length) {
        noMemosMsg.style.display = "block";
        return;
      }

      noMemosMsg.style.display = "none";

      const frag = document.createDocumentFragment();
      data.memos.forEach(m => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${m["Date"] || ""}</td>
          <td>${m["Author"] || ""}</td>
          <td>${m["Title"] || ""}</td>
          <td>${m["Type"] || ""}</td>
          <td>${m["Memo"] || ""}</td>
        `;
        frag.appendChild(tr);
      });

      memoTableBody.appendChild(frag);
    } catch (err) {
      console.error("❌ Failed to load memos:", err.message || err);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.data?.action === "refresh-memos") {
      loadMemos();
    }
  });

  loadMemos();
});

function updateMemoHeader(count) {
  const header = document.getElementById("memoHeaderTitle");
  if (!header) return;
  header.textContent = !count ? "Memos" : `Memos (${count})`;
}

/* =====================================================
   💰 Deposits rendering + totals
   ===================================================== */
function renderDeposits(deposits) {
  const section = document.getElementById("depositsSection");
  const tbody = document.querySelector("#depositsTable tbody");
  const count = document.getElementById("depositCount");
  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");
  if (!section || !tbody) return;

  if (!Array.isArray(deposits) || deposits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">No deposits found.</td></tr>`;
    section.classList.remove("hidden");
    section.style.display = "block";
    if (depositsTotalCell) depositsTotalCell.textContent = "£0.00";
    if (balanceCell) balanceCell.textContent = "£0.00";
    return;
  }

  section.classList.remove("hidden");
  section.style.display = "block";
  if (count) count.textContent = deposits.length;
  tbody.innerHTML = "";

  let totalDeposits = 0;
  const frag = document.createDocumentFragment();

  deposits.forEach(d => {
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
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  updateDepositTotals(totalDeposits);
}

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
}

/* =====================================================
   Deposit saved from popup
   ===================================================== */
window.onDepositSaved = async (deposit) => {
  if (!deposit || !deposit.id || !deposit.amount) return;

  const soId = window.location.pathname.split("/").pop();
  const addBtn = document.getElementById("addDepositBtn");
  const spinner = document.getElementById("depositSpinner");

  try {
    spinner?.classList.remove("hidden");
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.classList.add("locked-input");
    }

    const savedAuth = storageGet?.();
    const token = savedAuth?.token;

    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`/api/netsuite/salesorder/${soId}/add-deposit`, {
      method: "POST",
      headers,
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

    window._currentDeposits = window._currentDeposits || [];
    window._currentDeposits.push(newDeposit);
    renderDeposits(window._currentDeposits);

    showToast?.(`✅ Deposit £${Number(deposit.amount).toFixed(2)} added`, "success");
  } catch (err) {
    console.error("❌ Add deposit failed:", err.message || err);
    showToast?.(`❌ ${err.message || err}`, "error");
  } finally {
    spinner?.classList.add("hidden");
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.classList.remove("locked-input");
    }
  }
};

/* =====================================================
   Summary from table
   ===================================================== */
function updateOrderSummaryFromTable() {
  console.log("🧮 updateOrderSummaryFromTable()");

  const rows = document.querySelectorAll("#orderItemsBody tr.order-line");
  if (!rows.length) return;

  let grossTotal = 0;      // sum of Sale Price (inc VAT)
  let discountTotal = 0;   // RRP gross - actual gross

  rows.forEach(row => {
    const amountEl = row.querySelector(".amount");     // RRP / original gross
    const saleEl = row.querySelector(".saleprice");  // actual charged gross

    if (!saleEl) return;

    const sale = parseFloat(saleEl.textContent.replace(/[£,]/g, "")) || 0;
    const amount = amountEl
      ? parseFloat(amountEl.textContent.replace(/[£,]/g, "")) || 0
      : sale;

    grossTotal += sale;

const lineDiscount = Math.max(0, amount - sale);
discountTotal += lineDiscount;

if (sale < 0) {
  discountTotal += Math.abs(sale);
}

  });

  // 🔹 VAT breakdown from gross (20% VAT):
  const netTotal = grossTotal / 1.2;
  const taxTotal = grossTotal - netTotal;

  // 🔹 Update UI labels
  document.getElementById("subTotal").textContent = `£${netTotal.toFixed(2)}`;
  document.getElementById("discountTotal").textContent = `£${discountTotal.toFixed(2)}`;
  document.getElementById("taxTotal").textContent = `£${taxTotal.toFixed(2)}`;
  document.getElementById("grandTotal").textContent = `£${grossTotal.toFixed(2)}`;

  // 🔹 Recalculate deposits → outstanding balance (uses grandTotal text)
  if (window._currentDeposits?.length > 0) {
    const totalDeposits = window._currentDeposits.reduce(
      (sum, d) => sum + (parseFloat(d.amount) || 0),
      0
    );
    updateDepositTotals(totalDeposits);
  }

  console.log("📊 Summary recalculated — grand:", grossTotal.toFixed(2));
}


document.getElementById("printBtn").addEventListener("click", () => {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const tranId = parts[parts.length - 1];

  if (!tranId) {
    console.error("❌ No tranId found in URL");
    return;
  }

  const url = `/sales/reciept/${tranId}`;
  window.open(url, "_blank");
});







/* =====================================================
   Commit / fulfil buttons
   ===================================================== */
function showCommitSpinner() {
  document.getElementById("commitSpinner")?.classList.remove("hidden");
}
function hideCommitSpinner() {
  document.getElementById("commitSpinner")?.classList.add("hidden");
}

function updateActionButton(orderStatusObj, tranId, so) {
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
    return;
  }

  wrapper.innerHTML = btnHtml;

  const commitBtn = document.getElementById(btnId);
  if (btnId === "commitOrderBtn" && commitBtn) {
    commitBtn.replaceWith(commitBtn.cloneNode(true));
    const freshBtn = document.getElementById(btnId);

    freshBtn.addEventListener("click", async () => {
      const savedAuth = storageGet?.();
      const token = savedAuth?.token;
      if (!token) {
        return (window.location.href = "/index.html");
      }

      const updates = [];
      document.querySelectorAll("#orderItemsBody tr.order-line").forEach(row => {
        const lineId = row.dataset.lineid || "";
        const fulfilSel = row.querySelector(".fulfilmentSelect");
        const invInp = row.querySelector(".item-inv-detail");
        const qtyCache = row.querySelector(".item-qty-cache")?.value || 0;
        const itemId = row.querySelector(".item-internal-id")?.value || "";

        let fulfilmentValue = fulfilSel?.value?.trim() || "";
        if (!fulfilmentValue) {
          const currentRef =
            row.querySelector(".fulfilment-cell")?.textContent?.trim() || "";
          if (currentRef && Array.isArray(window._fulfilmentMap)) {
            const match = window._fulfilmentMap.find(
              f => f.name?.toLowerCase() === currentRef.toLowerCase()
            );
            fulfilmentValue = match?.id || "";
          }
        }

        updates.push({
          lineId,
          itemId,
          quantity: Number(qtyCache),
          fulfilmentMethod: fulfilmentValue || null,
          inventoryDetail: invInp?.value || null,
        });
      });

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
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to commit order");
        }

        showToast?.(`✅ Order ${tranId} approved!`, "success");
        hideCommitSpinner();
      } catch (err) {
        hideCommitSpinner();
        console.error("❌ Commit error:", err.message || err);
        showToast?.(`❌ ${err.message || err}`, "error");
      }
    });
  } else if (btnId === "fulfilOrderBtn") {
    const fulfilBtn = document.getElementById(btnId);
    if (fulfilBtn) {
      fulfilBtn.replaceWith(fulfilBtn.cloneNode(true));
      const freshFulfil = document.getElementById(btnId);
      freshFulfil.addEventListener("click", () => {
        console.log("📦 Fulfil clicked for:", tranId);
        // future fulfilment flow
      });
    }
  }
}
