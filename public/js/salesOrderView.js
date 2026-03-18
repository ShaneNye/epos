// public/js/salesOrderView.js

// Lightweight global crash sniffers
window.addEventListener("error", e =>
  console.error("💥 Uncaught error:", e.error || e.message)
);
window.addEventListener("unhandledrejection", e =>
  console.error("💥 Unhandled Promise rejection:", e.reason)
);

/* =====================================================
   Shared item cache loader
   ===================================================== */
async function loadItemCache() {
  try {
    if (window.nsItemFeedCache?.getItems) {
      const items = await window.nsItemFeedCache.getItems();
      window.items = items;
      console.log("✅ Items loaded from shared cache:", items.length);
      return items;
    }

    console.warn("⚠️ nsItemFeedCache missing - falling back to direct fetch");
    const res = await fetch("/api/netsuite/items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = data.results || [];
    window.items = items;

    console.log("✅ Items loaded from API fallback:", items.length);
    return items;
  } catch (err) {
    console.error("❌ Failed to load items cache:", err.message || err);
    window.items = [];
    return [];
  }
}

/* =====================================================
   Item options helpers (Sales View)
   ===================================================== */
window.optionsCache = window.optionsCache || {};

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOptionsCacheForItem(itemData) {
  const opts = {};
  if (!itemData || typeof itemData !== "object") return opts;

  Object.entries(itemData).forEach(([key, val]) => {
    if (String(key).toLowerCase().startsWith("option :")) {
      const fieldName = key.replace(/^option\s*:\s*/i, "").trim();
      const values = val
        ? String(val).split(",").map(v => v.trim()).filter(Boolean)
        : [];

      if (fieldName && values.length) {
        opts[fieldName] = values;
      }
    }
  });

  return opts;
}

function parseOptionsDisplayText(text) {
  const out = {};
  const raw = String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();

  if (!raw) return out;

  raw.split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(line => {
      const parts = line.split(/\s*:\s*/);
      if (parts.length < 2) return;

      const field = parts.shift()?.trim();
      const valueText = parts.join(":").trim();
      if (!field || !valueText) return;

      const values = valueText.split(",").map(v => v.trim()).filter(Boolean);
      out[field] = values.length > 1 ? values : (values[0] || "");
    });

  return out;
}

function selectionsToSummary(selections) {
  const parts = [];

  Object.entries(selections || {}).forEach(([field, value]) => {
    if (Array.isArray(value) && value.length) {
      parts.push(`${field} : ${value.join(", ")}`);
    } else if (value) {
      parts.push(`${field} : ${value}`);
    }
  });

  return parts.join("<br>");
}

function getOptionsSummaryText(row) {
  const summaryEl = row?.querySelector(".options-summary");
  if (!summaryEl) return "";
  return summaryEl.innerHTML?.trim() || summaryEl.textContent?.trim() || "";
}

function openOptionsWindow(row) {
  const itemId =
    row.querySelector(".item-internal-id")?.value?.trim() ||
    row.dataset.itemid ||
    "";

  const lineIndex = row.dataset.line || "";

  if (!itemId) {
    alert("⚠️ No item selected for this row.");
    return;
  }

  const existingSelections =
    row.querySelector(".item-options-json")?.value || "{}";

  const url =
    `/options.html?itemId=${encodeURIComponent(itemId)}` +
    `&line=${encodeURIComponent(lineIndex)}` +
    `&selections=${encodeURIComponent(existingSelections)}`;

  const win = window.open(
    url,
    "ItemOptions",
    "width=600,height=500,resizable=yes,scrollbars=yes"
  );

  if (!win) {
    alert("⚠️ Please allow popups for item options.");
    return;
  }

  win.focus();
}

function enhancePendingApprovalOptions() {
  const isPendingApproval =
    String(window.__soStatusId || "").toUpperCase() === "A";

  if (!isPendingApproval) return;

  const rows = document.querySelectorAll("#orderItemsBody tr.order-line");
  if (!rows.length) return;

  rows.forEach((row, idx) => {
    const itemId =
      row.querySelector(".item-internal-id")?.value?.trim() ||
      row.dataset.itemid ||
      "";

    if (!itemId) return;

    const itemData = (window.items || []).find(
      it => String(it["Internal ID"] || "") === String(itemId)
    );

    const optionDefs = buildOptionsCacheForItem(itemData);
    window.optionsCache[itemId] = optionDefs;

    const hasOptionDefs = Object.keys(optionDefs).length > 0;
    if (!hasOptionDefs) return;

    let optionsCell = row.querySelector(".options-cell");
    if (!optionsCell) {
      // fallback: second visible td in your table is typically options
      const cells = row.querySelectorAll("td");
      if (cells[1]) {
        optionsCell = cells[1];
        optionsCell.classList.add("options-cell");
      }
    }

    if (!optionsCell) return;

    // If already enhanced, just ensure row tracking attrs exist
    if (optionsCell.querySelector(".open-options")) {
      row.dataset.line = row.dataset.line || String(idx);
      row.dataset.itemid = itemId;
      return;
    }

    const existingHtml = optionsCell.innerHTML?.trim() || "";
    const existingText = optionsCell.textContent?.trim() || "";
    const startingSummary = existingHtml || escapeHtml(existingText);
    const parsedSelections = parseOptionsDisplayText(existingText);

    row.dataset.line = row.dataset.line || String(idx);
    row.dataset.itemid = itemId;

    optionsCell.innerHTML = `
      <button type="button" class="open-options btn-secondary small-btn">⚙️ Options</button>
      <input
        type="hidden"
        class="item-options-json"
        value='${escapeHtml(JSON.stringify(parsedSelections || {}))}'
      />
      <div class="options-summary">${startingSummary}</div>
    `;
  });
}

// Supports popup callback from options.html
window.onOptionsSaved = function (itemId, selections, lineIndex) {
  try {
    let row = null;

    if (lineIndex !== undefined && lineIndex !== null && lineIndex !== "") {
      row = document.querySelector(
        `#orderItemsBody tr.order-line[data-line="${String(lineIndex)}"]`
      );
    }

    if (!row && itemId) {
      row = [...document.querySelectorAll("#orderItemsBody tr.order-line")].find(r => {
        const rid =
          r.querySelector(".item-internal-id")?.value?.trim() ||
          r.dataset.itemid ||
          "";
        return String(rid) === String(itemId);
      });
    }

    if (!row) {
      console.warn("⚠️ onOptionsSaved: row not found", { itemId, lineIndex });
      return;
    }

    const jsonInp = row.querySelector(".item-options-json");
    const summaryEl = row.querySelector(".options-summary");

    const safeSelections = selections || {};
    const summaryHtml = selectionsToSummary(safeSelections);

    if (jsonInp) jsonInp.value = JSON.stringify(safeSelections);
    if (summaryEl) summaryEl.innerHTML = summaryHtml;

    console.log("✅ Options saved into Sales View row", {
      itemId,
      lineIndex,
      selections: safeSelections
    });

    if (typeof updateOrderSummaryFromTable === "function") {
      updateOrderSummaryFromTable();
    }
  } catch (err) {
    console.error("❌ onOptionsSaved failed:", err.message || err);
  }
};

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

    requestAnimationFrame(() => toast.classList.add("show"));

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
     Populate Sales Executive & Store Dropdowns
     ===================================================== */
  async function populateSalesExecAndStore(headers) {
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

          if (currentUser && salesExecs.some(u => u.id === currentUser.id)) {
            execSelect.value = currentUser.id;
            console.log("✔ Auto-set Sales Exec to current user");
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to load sales executives:", err);
    }

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
    const [
      _items,
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

    const soJson = await soRes.json();
    if (!soRes.ok || !soJson || soJson.ok === false) {
      throw new Error(soJson?.error || `Server returned ${soRes.status}`);
    }

    const so = soJson.salesOrder || soJson;
    if (!so) throw new Error("No salesOrder object in response");
    console.log("✅ Sales Order loaded:", so.tranId || tranId);

    window.__soStatusId = String(so?.orderStatus?.id || "").toUpperCase();

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
    // 2️⃣ Render Deposits
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

    function formatOrderStatus(so) {
      console.log("📦 Raw sales order object for status check:", so);
      console.log("📦 so.status:", so?.status, "| type:", typeof so?.status);
      console.log("📦 so.statusRef:", so?.statusRef, "| type:", typeof so?.statusRef);
      console.log("📦 so.orderStatus:", so?.orderStatus);
      console.log("📦 so.orderStatus?.id:", so?.orderStatus?.id);
      console.log("📦 so.orderStatus?.refName:", so?.orderStatus?.refName);

      if (typeof so?.status === "string" && so.status.trim()) {
        console.log("✅ Using so.status:", so.status.trim());
        return so.status.trim();
      }

      if (
        so?.status &&
        typeof so.status === "object" &&
        typeof so.status.refName === "string" &&
        so.status.refName.trim()
      ) {
        console.log("✅ Using so.status.refName:", so.status.refName.trim());
        return so.status.refName.trim();
      }

      const statusRef =
        (typeof so?.statusRef === "string" && so.statusRef.trim()) ||
        (typeof so?.orderStatus?.refName === "string" && so.orderStatus.refName.trim()) ||
        "";

      console.log("📦 Derived statusRef candidate:", statusRef);

      if (statusRef) {
        const normalized = statusRef.trim();

        const explicitMap = {
          pendingApproval: "Pending Approval",
          pendingFulfillment: "Pending Fulfillment",
          billed: "Billed",
          cancelled: "Cancelled",
          closed: "Closed",
          pendingBilling: "Pending Billing",
          partiallyFulfilled: "Partially Fulfilled",
          pendingBillingPartFulfilled: "Pending Billing / Partially Fulfilled",
        };

        if (explicitMap[normalized]) {
          console.log("✅ Using explicit statusRef map:", normalized, "→", explicitMap[normalized]);
          return explicitMap[normalized];
        }

        const prettyStatus = normalized
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (c) => c.toUpperCase());

        console.log("✅ Using formatted statusRef fallback:", normalized, "→", prettyStatus);
        return prettyStatus;
      }

      const statusId = String(so?.orderStatus?.id || "").trim().toUpperCase();
      console.log("📦 Falling back to orderStatus.id:", statusId);

      const codeMap = {
        A: "Pending Approval",
        B: "Pending Fulfillment",
        C: "Partially Fulfilled",
        D: "Pending Billing",
        E: "Billed",
        F: "Closed",
        G: "Cancelled",
      };

      if (codeMap[statusId]) {
        console.log("✅ Using orderStatus.id map:", statusId, "→", codeMap[statusId]);
        return codeMap[statusId];
      }

      console.warn("⚠️ Could not map order status cleanly, returning raw fallback:", statusId || "-");
      return statusId || "-";
    }

    const orderStatusEl = document.getElementById("orderStatus");
    if (orderStatusEl) {
      const resolvedStatus = formatOrderStatus(so);
      console.log("🧾 Final resolved order status for UI:", resolvedStatus);
      orderStatusEl.textContent = resolvedStatus;
    } else {
      console.warn("⚠️ orderStatus element not found in DOM");
    }

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

    document.querySelector('input[name="email"]').value = so.email || "";
    document.querySelector('input[name="contactNumber"]').value = so.custbody4 || so.phone || "";
    document.querySelector('input[name="altContactNumber"]').value = so.altPhone || "";

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
// 4️⃣ Normalise line signs + Render Item Lines
// ==================================================
if (typeof window.renderSalesViewLines !== "function") {
  throw new Error("renderSalesViewLines() not found — did salesViewItemLine.js load?");
}

// Normalise sign direction before external renderer consumes the payload.
// This protects the UI even if renderSalesViewLines() still has old sign-flip logic.
if (Array.isArray(so?.item?.items)) {
  so.item.items = so.item.items.map((line) => {
    const itemName = String(line?.item?.refName || "").toLowerCase();

    const amount = Number(line.amount || 0);
    const saleprice = Number(line.saleprice || 0);
    const vat = Number(line.vat || 0);

    // Heuristic: discount-style lines should be negative
    const isDiscountLine =
      itemName.includes("discount") ||
      itemName.includes("blue light") ||
      itemName.includes("promo") ||
      itemName.includes("promotion") ||
      itemName.includes("voucher");

    let nextAmount = amount;
    let nextSaleprice = saleprice;
    let nextVat = vat;

    if (isDiscountLine) {
      // Discount lines should stay negative
      if (nextAmount > 0) nextAmount = -nextAmount;
      if (nextSaleprice > 0) nextSaleprice = -nextSaleprice;
      if (nextVat > 0) nextVat = -nextVat;
    } else {
      // Normal stock / service lines should stay positive
      if (nextAmount < 0) nextAmount = Math.abs(nextAmount);
      if (nextSaleprice < 0) nextSaleprice = Math.abs(nextSaleprice);
      if (nextVat < 0) nextVat = Math.abs(nextVat);
    }

    return {
      ...line,
      amount: nextAmount,
      saleprice: nextSaleprice,
      vat: nextVat,
    };
  });

  console.log(
    "🧭 Normalised SO line signs before render:",
    so.item.items.map((l) => ({
      item: l?.item?.refName,
      amount: l.amount,
      vat: l.vat,
      saleprice: l.saleprice,
    }))
  );
}

window.renderSalesViewLines({
  so,
  fulfilmentMethods: window._fulfilmentMap || [],
});

// ✅ Enhance existing rendered rows so options become clickable
enhancePendingApprovalOptions();

    // ==================================================
    // 6️⃣ Lock / unlock form depending on order status
    // ==================================================
    const isPendingApproval = so.orderStatus?.id === "A";

    if (isPendingApproval) {
      console.log("🔓 Pending approval – Sales New style fields editable");

      document.querySelectorAll("input, select, textarea, button").forEach(el => {
        if (
          el.classList.contains("item-qty") ||
          el.classList.contains("item-discount") ||
          el.classList.contains("item-saleprice") ||
          el.classList.contains("item-amount") ||

          el.classList.contains("item-fulfilment") ||
          el.classList.contains("fulfilmentSelect") ||
          el.classList.contains("open-inventory") ||
          el.classList.contains("item-inv-detail") ||

          el.classList.contains("open-options") ||
          el.classList.contains("item-options-json") ||

          el.name === "leadSource" ||
          el.id === "paymentInfo" ||

          el.id === "newMemoBtn" ||
          el.id === "printBtn" ||
          el.id === "addDepositBtn"
        ) {
          el.disabled = false;
          el.classList.remove("locked-input");
          return;
        }

        el.disabled = true;
        el.classList.add("locked-input");
      });

    } else {
      console.log("🔒 Not pending approval – lock everything (read-only)");

      document.querySelectorAll("input, select, textarea, button").forEach(el => {
        if (el.id === "newMemoBtn" || el.id === "printBtn") return;

        el.disabled = true;
        el.classList.add("locked-input");
      });

      const addDepositBtn = document.getElementById("addDepositBtn");
      if (addDepositBtn) {
        addDepositBtn.disabled = true;
        addDepositBtn.classList.add("locked-input");
      }
    }

    // ==================================================
    // 7️⃣ Summary + Action button + Add Deposit
    // ==================================================
    updateOrderSummaryFromTable();
    updateActionButton(so.orderStatus || so.status || {}, tranId, so);

    const addDepositBtn = document.getElementById("addDepositBtn");

    function cleanMoneyText(rawValue) {
      if (rawValue == null) return 0;
      const cleaned = String(rawValue).replace(/[^0-9.-]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    }

    if (addDepositBtn) {
      addDepositBtn.disabled = false;
      addDepositBtn.classList.remove("locked-input");

      addDepositBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const outstandingText =
          document.getElementById("outstandingBalance")?.textContent || "";
        const grandTotalText =
          document.getElementById("grandTotal")?.textContent || "";

        let amount = cleanMoneyText(outstandingText);
        if (!(amount > 0)) amount = cleanMoneyText(grandTotalText);

        console.log("🧾 outstandingText:", outstandingText);
        console.log("🧾 grandTotalText:", grandTotalText);
        console.log("🧾 amount used for popup:", amount);

        const popup = window.open(
          `${window.location.origin}/deposit.html?amount=${encodeURIComponent(
            amount.toFixed(2)
          )}`,
          "AddDeposit",
          "width=420,height=520,resizable=yes,scrollbars=no"
        );

        if (!popup) {
          alert("⚠️ Please allow popups for this site to add deposits.");
        } else {
          popup.focus();
        }
      };
    }

  } catch (err) {
    console.error("❌ Load failure:", err.message || err);
    alert("Failed to load Sales Order details. " + (err.message || err));
  } finally {
    overlay?.classList.add("hidden");
  }
});

/* =====================================================
   Memo Panel
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

  let grossTotal = 0;
  let discountTotal = 0;

  rows.forEach((row, idx) => {
    const itemName =
      row.querySelector("td:first-child")?.textContent?.trim().toLowerCase() || "";

    const itemId = (row.querySelector(".item-internal-id")?.value || "").trim();
    const qtyInp = row.querySelector(".item-qty");
    const discInp = row.querySelector(".item-discount");
    const saleInp = row.querySelector(".item-saleprice");
    const amountInp = row.querySelector(".item-amount");

    // Editable rows
    if (itemId && qtyInp && discInp && saleInp && amountInp) {
      const qty = parseFloat(qtyInp.value || 0) || 0;
      if (!qty) return;

      const amountGrossLine = parseFloat(amountInp.value || 0) || 0;
      const saleGrossLine = parseFloat(saleInp.value || 0) || 0;
      const discountPct = parseFloat(discInp.value || 0) || 0;

      grossTotal += saleGrossLine;

      let lineDiscount = 0;

      if (saleGrossLine < 0 || itemName.includes("discount")) {
        lineDiscount = Math.abs(saleGrossLine);
      } else if (amountGrossLine > 0 && saleGrossLine >= 0) {
        lineDiscount = Math.max(0, amountGrossLine - saleGrossLine);
      } else if (discountPct > 0 && amountGrossLine > 0) {
        lineDiscount = amountGrossLine * (discountPct / 100);
      }

      discountTotal += lineDiscount;

      console.log(`🧾 Editable row ${idx}`, {
        itemId,
        itemName,
        qty,
        amountGrossLine,
        saleGrossLine,
        discountPct,
        lineDiscount
      });

      return;
    }

    // Read-only rows
    const amountEl = row.querySelector(".amount");
    const saleEl = row.querySelector(".saleprice");

    if (!saleEl) return;

    const sale = parseFloat((saleEl.textContent || "").replace(/[£,]/g, "")) || 0;
    const amount = amountEl
      ? parseFloat((amountEl.textContent || "").replace(/[£,]/g, "")) || 0
      : sale;

    grossTotal += sale;

    let lineDiscount = 0;

    if (sale < 0 || itemName.includes("discount")) {
      lineDiscount = Math.abs(sale);
    } else if (amount > 0 && sale >= 0) {
      lineDiscount = Math.max(0, amount - sale);
    }

    discountTotal += lineDiscount;

    console.log(`🧾 Read-only row ${idx}`, {
      itemName,
      amount,
      sale,
      lineDiscount
    });
  });

  grossTotal = Number(grossTotal.toFixed(2));
  discountTotal = Number(discountTotal.toFixed(2));

  const netTotal = Number((grossTotal / 1.2).toFixed(2));
  const taxTotal = Number((grossTotal - netTotal).toFixed(2));

  const subTotalEl = document.getElementById("subTotal");
  const discountEl = document.getElementById("discountTotal");
  const taxEl = document.getElementById("taxTotal");
  const grandEl = document.getElementById("grandTotal");

  if (subTotalEl) subTotalEl.textContent = `£${netTotal.toFixed(2)}`;
  if (discountEl) discountEl.textContent = `£${discountTotal.toFixed(2)}`;
  if (taxEl) taxEl.textContent = `£${taxTotal.toFixed(2)}`;
  if (grandEl) grandEl.textContent = `£${grossTotal.toFixed(2)}`;

  if (typeof updateDepositTotals === "function") {
    const totalDeposits = Array.isArray(window._currentDeposits)
      ? window._currentDeposits.reduce(
          (sum, d) => sum + (parseFloat(d.amount) || 0),
          0
        )
      : 0;

    updateDepositTotals(totalDeposits);
  }

  console.log("📊 Summary recalculated", {
    grossTotal,
    netTotal,
    taxTotal,
    discountTotal
  });
}

document.getElementById("orderItemsBody")?.addEventListener("input", (e) => {
  if (
    e.target.classList.contains("item-qty") ||
    e.target.classList.contains("item-discount") ||
    e.target.classList.contains("item-saleprice") ||
    e.target.classList.contains("item-amount")
  ) {
    updateOrderSummaryFromTable();
  }
});

/* =====================================================
   Print receipt
   ===================================================== */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#printBtn");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  console.log("🖨️ Print button clicked");

  const parts = window.location.pathname.split("/").filter(Boolean);
  const tranId = parts[parts.length - 1];

  console.log("🖨️ URL path parts:", parts);
  console.log("🖨️ Derived tranId:", tranId);

  if (!tranId) {
    console.error("❌ No tranId found in URL");
    alert("⚠️ Could not determine receipt transaction ID.");
    return;
  }

  const url = `/sales/reciept/${tranId}`;
  console.log("🖨️ Opening receipt URL:", url);

  const receiptWin = window.open(url, "_blank");

  if (!receiptWin) {
    console.warn("⚠️ Popup blocked - redirecting in same tab");
    window.location.href = url;
    return;
  }

  receiptWin.focus();
});

/* =====================================================
   Commit / fulfil buttons
   ===================================================== */
function showCommitInline(message = "Committing…") {
  const wrap = document.getElementById("commitInlineStatus");
  const text = document.getElementById("commitInlineText");
  if (text) text.textContent = message;
  wrap?.classList.remove("hidden");
}

function hideCommitInline() {
  document.getElementById("commitInlineStatus")?.classList.add("hidden");
}

function updateActionButton(orderStatusObj, tranId, so) {
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;

  wrapper.innerHTML = "";

  function showCommitInline(message = "Working…") {
    const wrap = document.getElementById("commitInlineStatus");
    const text = document.getElementById("commitInlineText");
    if (text) text.textContent = message;
    wrap?.classList.remove("hidden");
  }

  function hideCommitInline() {
    document.getElementById("commitInlineStatus")?.classList.add("hidden");
  }

  const statusId = (orderStatusObj?.id || "").toUpperCase();
  const statusName = (orderStatusObj?.refName || "").toLowerCase();

  const isPendingApproval = statusId === "A" || statusName.includes("approval");
  if (!isPendingApproval) return;

  wrapper.innerHTML = `
    <button id="saveOrderBtn" class="btn-secondary">Save</button>
    <button id="commitOrderBtn" class="btn-primary">Commit</button>
  `;

  function buildPayloadFromUI() {
    const headerUpdates = {
      leadSource: document.querySelector('select[name="leadSource"]')?.value || null,
      paymentInfo: document.getElementById("paymentInfo")?.value || null,
    };

    const updates = [];

    document.querySelectorAll("#orderItemsBody tr.order-line").forEach((row) => {
      const lineId = row.dataset.lineid || "";
      const itemId =
        row.querySelector(".item-internal-id")?.value || row.dataset.itemid || "";

      const qty = Number(
        row.querySelector(".item-qty")?.value ||
          row.querySelector(".item-qty-cache")?.value ||
          0
      );

      const fulfilSel =
        row.querySelector(".item-fulfilment") || row.querySelector(".fulfilmentSelect");
      let fulfilmentValue = fulfilSel?.value?.trim() || "";

      if (!fulfilmentValue) {
        const currentRef = row.querySelector(".fulfilment-cell")?.textContent?.trim() || "";
        if (currentRef && Array.isArray(window._fulfilmentMap)) {
          const match = window._fulfilmentMap.find(
            (f) => f.name?.toLowerCase() === currentRef.toLowerCase()
          );
          fulfilmentValue = match?.id || "";
        }
      }

      const invInp = row.querySelector(".item-inv-detail");

      const discountPct = Number(row.querySelector(".item-discount")?.value || 0);
      const saleGrossPerUnit = Number(row.querySelector(".item-saleprice")?.value || 0);
      const optionsText = getOptionsSummaryText(row) || null;

      updates.push({
        lineId,
        itemId,
        quantity: qty,
        fulfilmentMethod: fulfilmentValue || null,
        inventoryDetail: invInp?.value || null,
        discountPct,
        saleGrossPerUnit,
        options: optionsText,
      });
    });

    return { updates, headerUpdates };
  }

  const saveBtn = document.getElementById("saveOrderBtn");
  if (saveBtn) {
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    const freshSaveBtn = document.getElementById("saveOrderBtn");

    freshSaveBtn.addEventListener("click", async () => {
      const savedAuth = storageGet?.();
      const token = savedAuth?.token;
      if (!token) return (window.location.href = "/index.html");

      freshSaveBtn.disabled = true;
      freshSaveBtn.classList.add("locked-input");
      showCommitInline("Saving…");

      const { updates, headerUpdates } = buildPayloadFromUI();

      try {
        const res = await fetch(`/api/netsuite/salesorder/${tranId}/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ updates, headerUpdates }),
        });

        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save order");

        showToast?.("✅ Saved (not committed)", "success");
        showCommitInline("Saved ✅");
        setTimeout(() => hideCommitInline(), 800);
      } catch (err) {
        console.error("❌ Save error:", err.message || err);
        showToast?.(`❌ ${err.message || err}`, "error");
        showCommitInline("Save failed ❌");
        setTimeout(() => hideCommitInline(), 1500);
      } finally {
        freshSaveBtn.disabled = false;
        freshSaveBtn.classList.remove("locked-input");
      }
    });
  }

  // ✅ Inventory saved callback
  window.onInventorySaved = function (itemId, detailString, lineIndex) {
    try {
      const row = document.querySelector(`#orderItemsBody tr.order-line[data-line="${lineIndex}"]`);
      if (!row) return console.warn("⚠️ onInventorySaved: row not found", { lineIndex });

      const invInp = row.querySelector(".item-inv-detail");
      if (invInp) invInp.value = detailString || "";

      const summary = row.querySelector(".inv-summary");
      if (summary) summary.textContent = detailString || "";

      const btn = row.querySelector(".open-inventory");
      const qty =
        parseInt(row.querySelector(".item-qty")?.value || row.querySelector(".item-qty-cache")?.value || "0", 10) || 0;

      const allocated = (detailString || "")
        .split(";")
        .map(p => parseInt(p.trim().split("|")[0], 10) || 0)
        .reduce((a, b) => a + b, 0);

      if (btn) btn.textContent = (qty > 0 && allocated === qty) ? "✅" : "📦";

      const fulfilSel = row.querySelector(".item-fulfilment") || row.querySelector(".fulfilmentSelect");
      if (fulfilSel && window.SalesLineUI?.validateInventoryForRow) {
        window.SalesLineUI.validateInventoryForRow(row);
      }

      if (typeof updateOrderSummaryFromTable === "function") updateOrderSummaryFromTable();

      console.log("✅ Inventory saved into Sales View row", { lineIndex, itemId });
    } catch (err) {
      console.error("❌ onInventorySaved failed:", err.message || err);
    }
  };

  const commitBtn = document.getElementById("commitOrderBtn");
  if (!commitBtn) return;

  commitBtn.replaceWith(commitBtn.cloneNode(true));
  const freshCommitBtn = document.getElementById("commitOrderBtn");

  freshCommitBtn.addEventListener("click", async () => {
    const savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    freshCommitBtn.disabled = true;
    freshCommitBtn.classList.add("locked-input");
    showCommitInline("Committing…");

    const { updates, headerUpdates } = buildPayloadFromUI();

    try {
      const res = await fetch(`/api/netsuite/salesorder/${tranId}/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ updates, headerUpdates }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to commit order");

      showToast?.(`✅ Order ${tranId} approved!`, "success");
      showCommitInline("Committed ✅");

      setTimeout(() => {
        wrapper.innerHTML = "";
        hideCommitInline();
      }, 1000);
    } catch (err) {
      console.error("❌ Commit error:", err.message || err);
      showToast?.(`❌ ${err.message || err}`, "error");

      showCommitInline("Commit failed ❌");
      setTimeout(() => hideCommitInline(), 2000);

      freshCommitBtn.disabled = false;
      freshCommitBtn.classList.remove("locked-input");
    }
  });
}