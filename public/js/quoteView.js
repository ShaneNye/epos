// public/js/quoteView.js

console.log("✅ quoteView.js loaded");

// Lightweight global crash sniffers
window.addEventListener("error", (e) =>
  console.error("💥 Uncaught error:", e.error || e.message)
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("💥 Unhandled Promise rejection:", e.reason)
);

/* =========================================================
   Toast
========================================================= */
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

/* =========================================================
   Helpers
========================================================= */
function getIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

function money(n) {
  const v = Number(n || 0);
  return `£${v.toFixed(2)}`;
}

function safeText(el, text) {
  if (el) el.textContent = text ?? "";
}

function parseMoneyInput(val) {
  return parseFloat(String(val || "0").replace(/[£,]/g, "")) || 0;
}

function hasExplicitValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function getItemInternalId(item) {
  return String(
    item?.["Internal ID"] ??
      item?.["InternalId"] ??
      item?.["InternalID"] ??
      item?.["internalid"] ??
      item?.["internal id"] ??
      item?.["Id"] ??
      item?.["id"] ??
      ""
  ).trim();
}

function findCachedItem(itemId) {
  return (window.items || []).find((it) => getItemInternalId(it) === String(itemId));
}

function itemBaseNet(item) {
  const value = Number(
    item?.["Base Price"] ??
      item?.baseprice ??
      item?.["base price"] ??
      item?.price ??
      0
  );
  return Number.isFinite(value) ? value : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function netSuiteRecordUrl(quote, recordType, id) {
  const base = String(quote?._netSuiteAppBaseUrl || "").replace(/\/$/, "");
  if (!base || !id) return "";

  const paths = {
    salesorder: "/app/accounting/transactions/salesord.nl",
    purchaseorder: "/app/accounting/transactions/purchord.nl",
    estimate: "/app/accounting/transactions/estimate.nl",
  };

  const path = paths[recordType];
  return path ? `${base}${path}?id=${encodeURIComponent(id)}` : "";
}

function renderOrderNumberLink(containerId, tranId, quote, recordType = "estimate") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const label = escapeHtml(tranId || "");
  const url = netSuiteRecordUrl(quote, recordType, quote?.id || quote?.internalId || quote?.internalid);
  
  if (url) {
    container.innerHTML = `<a href="${escapeHtml(url)}" class="related-popup-link" title="Open in NetSuite">${label}</a>`;
  } else {
    container.textContent = label;
  }
}

/* =========================================================
   Convert / Save spinner overlay
========================================================= */
function showConvertSpinner(show, message = "Working...") {
  const overlay = document.getElementById("quoteConvertSpinner");
  if (!overlay) return;
  const p = overlay.querySelector("p");
  if (p) p.textContent = message;
  overlay.classList.toggle("hidden", !show);
}

/* =========================================================
   Populate Sales Exec + Store
========================================================= */
async function populateSalesExecAndStore(headers) {
  let currentUser = null;

  try {
    const meRes = await fetch("/api/me", { headers });
    const meData = await meRes.json();
    if (meData.ok && meData.user) currentUser = meData.user;
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

        const salesExecs = (data.users || []).filter(
          (u) => Array.isArray(u.roles) && u.roles.some((r) => r.name === "Sales Executive")
        );

        salesExecs.forEach((u) => {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = `${u.firstName} ${u.lastName}`;
          execSelect.appendChild(opt);
        });

        if (currentUser && salesExecs.some((u) => u.id === currentUser.id)) {
          execSelect.value = currentUser.id;
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

        const filteredLocations = (data.locations || []).filter(
          (loc) => !/warehouse/i.test(loc.name)
        );

        filteredLocations.forEach((loc) => {
          const opt = document.createElement("option");
          opt.value = String(loc.id);
          opt.textContent = loc.name;
          storeSelect.appendChild(opt);
        });

        if (currentUser && currentUser.primaryStore) {
          const match = filteredLocations.find(
            (l) =>
              String(l.id) === String(currentUser.primaryStore) ||
              l.name === currentUser.primaryStore
          );
          if (match) storeSelect.value = String(match.id);
        }
      }
    }
  } catch (err) {
    console.error("❌ Failed to load stores:", err);
  }
}

/* =========================================================
   Summary from editable table
========================================================= */
function updateQuoteSummaryFromTable() {
  const rows = document.querySelectorAll("#orderItemsBody tr.order-line");
  const lines = [...rows]
    .filter((row) => {
      return (
        row.dataset.hasItem === "1" ||
        row.querySelector(".item-internal-id")?.value?.trim()
      );
    })
    .map((row) => ({
      item: {
        refName: row.querySelector(".item-search")?.value?.trim() || "",
      },
      amount: parseMoneyInput(row.querySelector(".item-amount")?.value),
      saleprice: parseMoneyInput(row.querySelector(".item-saleprice")?.value),
      vat: parseMoneyInput(row.querySelector(".item-vat")?.value),
      quantity: parseMoneyInput(row.querySelector(".item-qty")?.value) || 1,
      vatFree: !!row.querySelector(".vat-free-checkbox")?.checked,
    }));

  const summary = lines.reduce(
    (acc, line) => {
      const amount = Number(line.amount || 0);
      const sale = Number(line.saleprice || 0);
      acc.grossTotal += sale;
      acc.discountTotal += Math.max(0, amount - sale);
      if (line.vatFree) {
        acc.netTotal += sale;
      } else {
        const lineNet = Number((sale / 1.2).toFixed(2));
        acc.netTotal += lineNet;
        acc.taxTotal += Number((sale - lineNet).toFixed(2));
      }
      return acc;
    },
    { grossTotal: 0, discountTotal: 0, netTotal: 0, taxTotal: 0 }
  );

  const grossTotal = Number(summary.grossTotal || 0);
  const discountTotal = Number(summary.discountTotal || 0);
  const netTotal = Number(summary.netTotal || 0);
  const taxTotal = Number(summary.taxTotal || 0);

  safeText(document.getElementById("subTotal"), money(netTotal));
  safeText(document.getElementById("discountTotal"), money(discountTotal));
  safeText(document.getElementById("taxTotal"), money(taxTotal));
  safeText(document.getElementById("grandTotal"), money(grossTotal));
}

window.updateQuoteSummary = updateQuoteSummaryFromTable;

document.addEventListener("input", (event) => {
  if (!event.target.closest(".custom-field-control")) return;
  const status = document.getElementById("customFieldsStatus");
  if (status) status.textContent = "Unsaved changes";
});

document.addEventListener("change", (event) => {
  if (!event.target.closest(".custom-field-control")) return;
  const status = document.getElementById("customFieldsStatus");
  if (status) status.textContent = "Unsaved changes";
});

/* =========================================================
   Editable quote line helpers
========================================================= */
function buildOptionsSummaryHtml(optionsText = "") {
  const clean = String(optionsText || "").trim();
  if (!clean) return "";
  if (clean.includes("<br")) return clean;

  return clean
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("<br>");
}

function guessOptionsJsonFromDisplay(optionsText = "") {
  const out = {};
  const raw = String(optionsText || "").trim();
  if (!raw) return out;

  raw.split(/\r?\n|<br\s*\/?>/i).forEach((part) => {
    const clean = String(part).replace(/<[^>]+>/g, "").trim();
    if (!clean.includes(":")) return;

    const [field, ...rest] = clean.split(":");
    const value = rest.join(":").trim();
    if (!field.trim() || !value) return;

    const vals = value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    out[field.trim()] = vals.length > 1 ? vals : value;
  });

  return out;
}

function buildOptionSchemaForItem(itemId) {
  const fromDb = window.itemOptionsCache?.getOptionsForItemSync?.(itemId) || {};
  if (Object.keys(fromDb).length) return fromDb;

  const itemData = (window.items || []).find((it) => {
    const internalId =
      it["Internal ID"] ??
      it["InternalId"] ??
      it["InternalID"] ??
      it["internalid"] ??
      it["internal id"] ??
      it["Id"] ??
      it["id"] ??
      "";
    return String(internalId) === String(itemId);
  });

  if (!itemData) return {};

  const opts = {};
  Object.entries(itemData).forEach(([key, val]) => {
    if (!String(key).toLowerCase().startsWith("option :")) return;

    const fieldName = String(key).replace(/^option\s*:\s*/i, "").trim();
    const values = String(val || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (fieldName && values.length) {
      opts[fieldName] = values;
    }
  });

  return opts;
}

function getItemCategoryText(item) {
  const raw =
    item?.["Category"] ??
    item?.category ??
    item?.itemCategory ??
    item?.["Item Category"] ??
    "";

  if (raw && typeof raw === "object") {
    return String(raw.refName || raw.name || raw.text || raw.value || raw.id || "")
      .trim()
      .toLowerCase();
  }

  return String(raw || "").trim().toLowerCase();
}

function isQuoteNegativeValueLine(itemName) {
  const name = String(itemName || "").toLowerCase();
  return (
    window.EposFinancials?.isNegativeValueLine?.(itemName) ||
    name.includes("discount") ||
    name.includes("blue light") ||
    name.includes("promo") ||
    name.includes("promotion") ||
    name.includes("voucher") ||
    name.includes("trade in") ||
    name.includes("recommendation card (as a minus)") ||
    name.includes("trade-in")
  );
}

function collectEditableQuoteLines() {
  return [...document.querySelectorAll("#orderItemsBody tr.order-line")]
    .map((row) => {
      const itemId = row.querySelector(".item-internal-id")?.value?.trim() || "";
      const itemName = row.querySelector(".item-search")?.value?.trim() || "";
      const quantity = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
      const amount = parseMoneyInput(row.querySelector(".item-amount")?.value);
      const saleInput = row.querySelector(".item-saleprice")?.value;
      const saleprice = hasExplicitValue(saleInput)
        ? parseMoneyInput(saleInput)
        : amount;
      const discount = parseFloat(row.querySelector(".item-discount")?.value || "0") || 0;
      const optionsText =
        row.querySelector(".options-summary")?.innerHTML?.trim().replace(/<br\s*\/?>/gi, "\n") || "";
      const optionsJson = row.querySelector(".item-options-json")?.value || "{}";
      const trialOption = row.querySelector(".sixty-night-select")?.value?.trim() || null;
      const vatFree = !!row.querySelector(".vat-free-checkbox")?.checked;

      return {
        lineId: row.dataset.lineid || "",
        item: itemId,
        itemName,
        quantity,
        amount,
        saleprice,
        discount,
        options: optionsText,
        optionsJson,
        trialOption,
        taxCode: vatFree ? "10" : "",
        isNewLine: !row.dataset.lineid,
      };
    })
    .filter((r) => r.item && r.quantity > 0);
}

window.collectEditableQuoteLines = collectEditableQuoteLines;

function wireEditableQuoteRow(tr, line, idx) {
  const itemId = String(line.item?.id || "");
  const itemName = line.item?.refName || line.itemName || "—";
  const quantity = Number(line.quantity || 1);
  const itemData = findCachedItem(itemId);
  const savedAmount = Number(line.amount || 0);
  const savedSale = Number(line.saleprice || 0);
  const savedVat = Number(line.vat || 0);
  const existingTaxCode = String(
    line.taxCode?.id ||
      line.taxCode?.refName ||
      line.taxCode ||
      line.taxcode ||
      line.tax_code ||
      ""
  ).toLowerCase();
  const existingVatFree =
    existingTaxCode === "10" ||
    existingTaxCode.includes("vat free") ||
    existingTaxCode.includes("zero");
  const negativeLine = isQuoteNegativeValueLine(itemName);
  const sign = negativeLine ? -1 : 1;
  const baseNet = itemBaseNet(itemData);
  const fullRetailGross = baseNet > 0
    ? +(baseNet * 1.2 * quantity).toFixed(2)
    : Math.abs(savedAmount);
  const grossRrp = +(Math.abs(fullRetailGross || savedAmount) * sign).toFixed(2);
  const sale = +(Math.abs(savedSale) * sign).toFixed(2);
  const vat = +(Math.abs(savedVat) * sign).toFixed(2);

  const retailGrossPerUnit =
    quantity > 0 && grossRrp !== 0 ? grossRrp / quantity : 0;

  const discountPct =
    grossRrp > 0
      ? Math.max(0, (((existingVatFree ? grossRrp / 1.2 : grossRrp) - sale) / (existingVatFree ? grossRrp / 1.2 : grossRrp)) * 100)
      : 0;
  const displaySale = existingVatFree && sale === grossRrp ? grossRrp / 1.2 : sale;
  const displayVat = existingVatFree ? 0 : vat;

  const optsText = line.custcol_sb_itemoptionsdisplay || line.optionsDisplay || "";
  const optsHtml = buildOptionsSummaryHtml(optsText);
  const existingSelections = guessOptionsJsonFromDisplay(optsText);
  const optionSchema = buildOptionSchemaForItem(itemId);

  if (itemId && Object.keys(optionSchema).length) {
    window.optionsCache[itemId] = optionSchema;
  }

  const className = String(itemData?.["Class"] || "").toLowerCase();
  const categoryName = getItemCategoryText(itemData);

  const hasExistingOptions =
    !!optsHtml ||
    (existingSelections && Object.keys(existingSelections).length > 0);

  const canEditOptions =
    Object.keys(optionSchema).length > 0 || hasExistingOptions;

  tr.className = "order-line";
  tr.dataset.line = idx;
  tr.dataset.lineid = line.lineId || "";
  tr.dataset.itemId = itemId;
  tr.dataset.hasItem = itemId ? "1" : "0";
  tr.dataset.itemClass = className;
  tr.dataset.itemCategory = categoryName;

  tr.innerHTML = `
    <td>
      <div class="autocomplete">
        <input
          type="text"
          id="itemSearch-${idx}"
          class="item-search"
          value="${String(itemName).replace(/"/g, "&quot;")}"
          placeholder="Product name"
          autocomplete="off"
          aria-autocomplete="list"
        />
        <input type="hidden" class="item-internal-id" value="${itemId}" />
        <input type="hidden" class="item-baseprice" value="${retailGrossPerUnit.toFixed(2)}" />
      </div>
    </td>

    <td class="options-cell">
      ${
        canEditOptions
          ? `
        <button type="button" class="open-options btn-secondary small-btn">Options</button>
        <input
          type="hidden"
          class="item-options-json"
          value='${JSON.stringify(existingSelections).replace(/'/g, "&apos;")}'
        />
        <div class="options-summary">${optsHtml}</div>
      `
          : `
        <input
          type="hidden"
          class="item-options-json"
          value='${JSON.stringify(existingSelections).replace(/'/g, "&apos;")}'
        />
        <div class="options-summary">${optsHtml}</div>
      `
      }
    </td>

    <td>
      <input type="number" class="item-qty" value="${quantity}" min="1" step="1" />
    </td>

    <td>
      <input
        type="number"
        class="item-amount"
        value="${Number(grossRrp || 0).toFixed(2)}"
        step="0.01"
        readonly
      />
    </td>

    <td>
      <input
        type="number"
        class="item-discount"
        value="${Number(discountPct || 0).toFixed(1)}"
        min="0"
        max="100"
        step="0.1"
      />
    </td>

    <td>
      <input
        type="number"
        class="item-vat"
        value="${Number(displayVat || 0).toFixed(2)}"
        step="0.01"
        readonly
      />
    </td>

    <td>
      <input
        type="text"
        class="item-saleprice"
        value="${Number(displaySale || 0).toFixed(2)}"
        inputmode="decimal"
        autocomplete="off"
      />
    </td>

    <td class="vat-free-cell" style="display:none;">
      <input type="checkbox" class="vat-free-checkbox" aria-label="Vat Free" style="display:none;" ${
        existingVatFree ? "checked" : ""
      } />
      <span class="vat-free-placeholder"></span>
    </td>

    <td class="sixty-night-cell" style="display:none;"></td>

    <td>
      <button type="button" class="delete-row btn-secondary small-btn">🗑</button>
    </td>
  `;

  const amountField = tr.querySelector(".item-amount");
  if (amountField) {
    amountField.dataset.unitRetail = retailGrossPerUnit.toFixed(2);
  }

  if (typeof window.setupAutocompleteForRow === "function") {
    window.setupAutocompleteForRow(tr);
  }

  if (typeof window.setupPriceSync === "function") {
    window.setupPriceSync(tr);
  }

  if (typeof window.ensure60NightTrialCell === "function") {
    window.ensure60NightTrialCell(tr);
  }

  if (typeof window.ensureVatFreeCell === "function") {
    window.ensureVatFreeCell(tr);
  }

  if (typeof window.updateVatFreeColumnVisibility === "function") {
    window.updateVatFreeColumnVisibility();
  }

  if (typeof window.update60NightTrialColumnVisibility === "function") {
    window.update60NightTrialColumnVisibility();
  }

  const recalcVat = () => {
    const saleVal = parseMoneyInput(tr.querySelector(".item-saleprice")?.value);
    const vatField = tr.querySelector(".item-vat");
    const vatFree = !!tr.querySelector(".vat-free-checkbox")?.checked;
    if (vatField) vatField.value = (vatFree ? 0 : saleVal - saleVal / 1.2).toFixed(2);
  };

  tr.querySelector(".item-qty")?.addEventListener("input", () => {
    recalcVat();
    updateQuoteSummaryFromTable();
  });

  tr.querySelector(".item-discount")?.addEventListener("input", () => {
    recalcVat();
    updateQuoteSummaryFromTable();
  });

  tr.querySelector(".item-saleprice")?.addEventListener("input", () => {
    recalcVat();
    updateQuoteSummaryFromTable();
  });

  tr.querySelector(".vat-free-checkbox")?.addEventListener("change", () => {
    recalcVat();
    updateQuoteSummaryFromTable();
  });
}

function ensureQuoteAddButton() {
  let btn = document.getElementById("addItemBtn");

  if (!btn) {
    const wrapper =
      document.getElementById("quoteItemsToolbar") ||
      document.getElementById("orderItemsToolbar") ||
      document.getElementById("orderActionWrapper");

    if (!wrapper) return;

    btn = document.createElement("button");
    btn.id = "addItemBtn";
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = "+ Add Item";

    wrapper.prepend(btn);
  }

  if (btn.dataset.bound !== "1") {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      if (typeof window.addNewRow === "function") {
        window.addNewRow();
      } else {
        console.warn("⚠️ addNewRow is not available on window");
      }
    });
  }
}

function bindQuoteItemTableEvents() {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody || tbody.dataset.bound === "1") return;

  tbody.dataset.bound = "1";

  tbody.addEventListener("click", (e) => {
    const optionsBtn = e.target.closest(".open-options");
    if (optionsBtn) {
      const row = optionsBtn.closest(".order-line");
      console.log("⚙️ Options clicked", { rowLine: row?.dataset?.line });
      if (row && typeof window.openOptionsWindow === "function") {
        window.openOptionsWindow(row);
      } else {
        console.warn("⚠️ openOptionsWindow not available or row missing");
      }
      return;
    }

    const deleteBtn = e.target.closest(".delete-row");
    if (deleteBtn) {
      const row = deleteBtn.closest(".order-line");
      console.log("🗑 Delete clicked", { rowLine: row?.dataset?.line });

      if (row) {
        row.remove();

        if (typeof window.update60NightTrialColumnVisibility === "function") {
          window.update60NightTrialColumnVisibility();
        }

        updateQuoteSummaryFromTable();

        if (typeof window.ensureNextEmptyRowAndFocus === "function") {
          window.ensureNextEmptyRowAndFocus();
        }
      }
    }
  });
}

/* =========================================================
   Build RESTlet save payload
========================================================= */
function buildQuoteSavePayload() {
  const items =
    typeof window.collectEditableQuoteLines === "function"
      ? window.collectEditableQuoteLines()
      : [];

  const qtySafe = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  const storeSelect = document.getElementById("store");
  const salesExecSelect = document.getElementById("salesExec");

  const updates = items.map((i) => {
    const qty = qtySafe(i.quantity);

    const retailGrossLine = Number(i.amount || 0);
    const grossToSave = hasExplicitValue(i.saleprice)
      ? Number(i.saleprice)
      : retailGrossLine;

    const netLineTotal = +(grossToSave / 1.2).toFixed(2);
    const netUnitRate = qty > 0 ? +(netLineTotal / qty).toFixed(2) : 0;
    const discountPct = Number.isFinite(Number(i.discount))
      ? Number(i.discount)
      : retailGrossLine > 0
        ? Math.max(0, ((retailGrossLine - grossToSave) / retailGrossLine) * 100)
        : 0;

    let optionsText = i.options || "";

    if (!optionsText && i.optionsJson) {
      try {
        const parsed = JSON.parse(i.optionsJson || "{}");
        const parts = [];
        Object.entries(parsed).forEach(([k, v]) => {
          if (Array.isArray(v)) parts.push(`${k}: ${v.join(", ")}`);
          else if (v) parts.push(`${k}: ${v}`);
        });
        optionsText = parts.join("\n");
      } catch {
        // ignore bad JSON
      }
    }

    return {
      lineId: i.lineId || "",
      itemId: String(i.item),
      quantity: qty,
      rate: netUnitRate,
      amount: netLineTotal,
      saleprice: grossToSave,
      grossSaleprice: grossToSave,
      saleGrossLine: grossToSave,
      amountGrossLine: retailGrossLine,
      grossAmount: retailGrossLine,
      discountPct,
      discount: discountPct,
      options: optionsText || "",
      trialOption: i.trialOption || null,
      taxCode: i.taxCode || "",
    };
  });

  return {
    updates,
    customFields: window.EposTransactionCustomFields?.collectAll?.() || [],
    headerUpdates: {
      salesExec: salesExecSelect?.value || "",
      store: storeSelect?.value || "",
      leadSource: document.querySelector('select[name="leadSource"]')?.value || "",
      paymentInfo: document.getElementById("paymentInfo")?.value || "",
      warehouse: document.getElementById("warehouse")?.value || "",
    },
  };
}

function stableSaveSignature(payload) {
  return JSON.stringify(payload || {});
}

/* =========================================================
   Quote action buttons
========================================================= */
function updateActionButtonForQuote() {
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;

  wrapper.innerHTML = `
    <button id="saveQuoteBtn" class="btn-secondary">Save Quote</button>
    <button id="convertToSaleBtn" class="btn-primary">Convert to Sale</button>
  `;

  const saveBtn = document.getElementById("saveQuoteBtn");
  const convertBtn = document.getElementById("convertToSaleBtn");

  saveBtn?.addEventListener("click", async () => {
    let savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const quoteIdOrTran = getIdFromPath();
    if (!quoteIdOrTran) return alert("No Quote ID found in URL.");

    saveBtn.disabled = true;
    if (convertBtn) convertBtn.disabled = true;
    saveBtn.classList.add("locked-input");
    convertBtn?.classList.add("locked-input");

    try {
      showConvertSpinner(true, "Saving quote...");
      showToast?.("⏳ Saving quote...", "success");

      const payload = buildQuoteSavePayload();
      console.log("🧾 Quote save payload summary:", {
        updates: payload.updates?.length || 0,
        headerFields: Object.keys(payload.headerUpdates || {}).filter((key) => payload.headerUpdates[key]),
      });

      const signature = stableSaveSignature(payload);
      if (signature === window._lastQuoteSaveSignature) {
        showToast?.("No quote changes to save.", "success");
        return;
      }

      const res = await fetch(
        `/api/netsuite/quote/${encodeURIComponent(quoteIdOrTran)}/save`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }
      );

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      }

      showToast?.("✅ Quote saved successfully!", "success");
      if (Array.isArray(data.customFields) && data.customFields.length) {
        window.EposTransactionCustomFields?.render?.(
          data.customFields,
          "No custom fields are visible for this quote."
        );
      }
      const customStatus = document.getElementById("customFieldsStatus");
      if (customStatus) customStatus.textContent = "";
      window._lastQuoteSaveSignature = stableSaveSignature(buildQuoteSavePayload());
    } catch (err) {
      console.error("❌ Save quote error:", err.message || err);
      showToast?.(`❌ ${err.message || err}`, "error");
    } finally {
      showConvertSpinner(false);
      saveBtn.disabled = false;
      if (convertBtn) convertBtn.disabled = false;
      saveBtn.classList.remove("locked-input");
      convertBtn?.classList.remove("locked-input");
    }
  });

  convertBtn?.addEventListener("click", async () => {
    let savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const quoteIdOrTran = getIdFromPath();
    if (!quoteIdOrTran) return alert("No Quote ID found in URL.");

    convertBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    convertBtn.classList.add("locked-input");
    saveBtn?.classList.add("locked-input");

    try {
      showConvertSpinner(true, "Converting quote to sales order...");
      showToast?.("⏳ Converting quote...", "success");

      const res = await fetch(`/api/netsuite/quote/${encodeURIComponent(quoteIdOrTran)}/convert`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `Convert failed (HTTP ${res.status})`);
      }

      const soTranId = data.tranId || data.salesOrderTranId || null;
      const soId = data.salesOrderId || data.id || null;
      if (data.quoteStatusUpdated === false) {
        console.warn("Quote converted, but quote status was not updated:", data.quoteStatusResult);
      }

      showToast?.("✅ Converted to Sales Order! Redirecting...", "success");

      setTimeout(() => {
        if (soTranId) return (window.location.href = `/sales/view/${soTranId}`);
        if (soId) return (window.location.href = `/sales/view/${soId}`);
        if (data.redirectUrl) return (window.location.href = data.redirectUrl);
        window.location.href = "/sales";
      }, 250);
    } catch (err) {
      console.error("❌ Convert error:", err.message || err);
      showToast?.(`❌ ${err.message || err}`, "error");
      convertBtn.disabled = false;
      if (saveBtn) saveBtn.disabled = false;
      convertBtn.classList.remove("locked-input");
      saveBtn?.classList.remove("locked-input");
    } finally {
      showConvertSpinner(false);
    }
  });
}

function quoteReceiptSelectedText(selector) {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  return el?.options?.[el.selectedIndex]?.textContent?.trim() || "";
}

function quoteReceiptPayloadFromDom(quoteIdOrTran) {
  const quote = window._currentQuote || {};

  const readRowValue = (row, selector, fallbackCellIndex = null) => {
    const el = row.querySelector(selector);

    const raw =
      el?.value ??
      el?.textContent ??
      (fallbackCellIndex !== null ? row.children?.[fallbackCellIndex]?.textContent : "") ??
      "";

    return String(raw).trim();
  };

  const readRowMoney = (row, selector, fallbackCellIndex = null) => {
    return parseMoneyInput(readRowValue(row, selector, fallbackCellIndex));
  };

  const items = [...document.querySelectorAll("#orderItemsBody tr.order-line")]
    .map((row) => {
      const itemId =
        row.querySelector(".item-internal-id")?.value?.trim() ||
        row.dataset.itemId ||
        "";

      const name =
        readRowValue(row, ".item-search", 0) ||
        row.dataset.itemName ||
        "";

      if (!itemId && !name) return null;

      const quantity = readRowMoney(row, ".item-qty, .qty", 2) || 1;

      const retailGrossLine = readRowMoney(row, ".item-amount, .amount", 3);
      const discountPct = readRowMoney(row, ".item-discount, .discount", 4);

      let saleGrossLine = readRowMoney(row, ".item-saleprice, .saleprice", 5);

      // ✅ If 100% discounted, force actual charged value to zero
      if (discountPct >= 99.9) {
        saleGrossLine = 0;
      }

      // ✅ Only fallback if sale price is genuinely blank
      const saleRaw = readRowValue(row, ".item-saleprice, .saleprice", 5);
      if (saleRaw === "" && discountPct < 99.9) {
        saleGrossLine = retailGrossLine;
      }

      // ✅ Send money fields as strings so "0.00" does not get lost by || fallback logic elsewhere
      const retailGrossLineText = Number(retailGrossLine || 0).toFixed(2);
      const saleGrossLineText = Number(saleGrossLine || 0).toFixed(2);

      console.log("🧾 Quote receipt line payload:", {
        name,
        quantity,
        retailGrossLine: retailGrossLineText,
        discountPct,
        saleGrossLine: saleGrossLineText,
      });

      return {
        name: name || "Item",
        itemName: name || "Item",

        options:
          row.querySelector(".options-summary")?.innerText?.trim() ||
          row.children?.[1]?.innerText?.trim() ||
          "",

        quantity,

        // RRP / Price column
        retailGrossLine: retailGrossLineText,
        retailGross: retailGrossLineText,
        amountGrossLine: retailGrossLineText,
        grossAmount: retailGrossLineText,
        amount: retailGrossLineText,

        // Actual charged / Total column
        saleGrossLine: saleGrossLineText,
        saleGross: saleGrossLineText,
        saleprice: saleGrossLineText,
        grossSaleprice: saleGrossLineText,
        total: saleGrossLineText,
        lineTotal: saleGrossLineText,

        discountPct,
        discount: discountPct,
      };
    })
    .filter(Boolean);

  return {
    type: "quote",
    customer: {
      firstName: document.querySelector('input[name="firstName"]')?.value || "",
      lastName: document.querySelector('input[name="lastName"]')?.value || "",
      address1: document.querySelector('input[name="address1"]')?.value || "",
      address2: document.querySelector('input[name="address2"]')?.value || "",
      address3: document.querySelector('input[name="address3"]')?.value || "",
      postcode: document.querySelector('input[name="postcode"]')?.value || "",
      email: document.querySelector('input[name="email"]')?.value || "",
      contactNumber: document.querySelector('input[name="contactNumber"]')?.value || "",
    },
    order: {
      tranId: quote.tranId || quoteIdOrTran,
      quoteDate: quote.tranDate || quote.trandate || "",
      salesExecName:
        quoteReceiptSelectedText(document.getElementById("salesExec")) ||
        quote.custbody_sb_bedspecialist?.refName ||
        "",
      store: document.getElementById("store")?.value || "",
      storeName: quoteReceiptSelectedText(document.getElementById("store")),
      paymentInfoName:
        quoteReceiptSelectedText(document.getElementById("paymentInfo")) ||
        quote.custbody_sb_paymentinfo?.refName ||
        "",
    },
    items,
    deposits: [],
  };
}

/* =========================================================
   Main Quote View Loader
========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("💡 QuoteView init");

  const overlay = document.getElementById("loadingOverlay");
  overlay?.classList.remove("hidden");

  let saved = storageGet?.();
  if (!saved || !saved.token) {
    await new Promise((r) => setTimeout(r, 300));
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

  const dropdownsPromise = populateSalesExecAndStore(headers);

  const tranId = getIdFromPath();
  if (!tranId) {
    alert("No Quote ID found in URL.");
    overlay?.classList.add("hidden");
    return;
  }

  try {
    const quotePromise = fetch(
      `/api/netsuite/quote/${encodeURIComponent(tranId)}?refresh=1&_=${Date.now()}`,
      { headers, cache: "no-store" }
    );

    const setupPromise = Promise.all([
      typeof window.loadItems === "function" ? window.loadItems() : Promise.resolve(),
      window.itemOptionsCache?.getAll?.().catch((err) => {
        console.warn("⚠️ Failed to preload item options:", err.message);
        return {};
      }),
    ]);

    const filterPromise = Promise.all([
      typeof window.populateSizeFilter === "function"
        ? window.populateSizeFilter()
        : Promise.resolve(),
      typeof window.populateBaseOptionFilter === "function"
        ? window.populateBaseOptionFilter()
        : Promise.resolve(),
    ]).catch((err) => {
      console.warn("⚠️ Failed to preload quote filters:", err.message || err);
    });

    const [qRes] = await Promise.all([quotePromise, setupPromise]);
    const qJson = await qRes.json();

    if (!qRes.ok || !qJson || qJson.ok === false) {
      throw new Error(qJson?.error || `Server returned ${qRes.status}`);
    }

    const quote = qJson.quote || qJson.estimate || qJson.estimateObj || qJson;
    window._currentQuote = quote;
    if (!quote) throw new Error("No quote/estimate object in response");

    console.log("✅ Quote loaded:", quote.tranId || tranId);

    // ✅ Wait until Sales Exec + Store dropdowns are populated
    await dropdownsPromise;

    // ✅ Override Sales Exec from quote.custbody_sb_bedspecialist
    try {
      const salesExecSelect = document.getElementById("salesExec");
      const nsSalesExecId =
        quote.custbody_sb_bedspecialist?.id ||
        quote.custbody_sb_bedspecialist?.value ||
        "";

      if (salesExecSelect && nsSalesExecId) {
        const usersRes = await fetch("/api/users", { headers });
        const usersJson = await usersRes.json();
        const users = usersJson.users || usersJson.data || [];

        const match = users.find(
          (u) =>
            String(u.netsuiteId || u.netsuiteid || u.netsuite_id || "") ===
            String(nsSalesExecId)
        );

        if (match) {
          salesExecSelect.value = String(match.id);
          console.log("✅ Quote Sales Exec set from custbody_sb_bedspecialist:", match);
        } else {
          console.warn("⚠️ No EPOS user matched quote Sales Exec:", nsSalesExecId);
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to set quote Sales Exec:", err.message || err);
    }

    // ✅ Override Store from quote subsidiary / primary store / location
    try {
      const storeSelect = document.getElementById("store");

      const quoteStoreNsId =
        quote.custbody_sb_primarystore?.id ||
        quote.subsidiary?.id ||
        quote.location?.id ||
        "";

      if (storeSelect && quoteStoreNsId) {
        const locRes = await fetch("/api/meta/locations", { headers });
        const locJson = await locRes.json();
        const locations = locJson.locations || locJson.data || [];

        const match = locations.find(
          (loc) =>
            String(loc.netsuite_internal_id || "") === String(quoteStoreNsId) ||
            String(loc.invoice_location_id || "") === String(quoteStoreNsId)
        );

        if (match) {
          storeSelect.value = String(match.id);
          console.log("✅ Quote Store set from quote subsidiary/store:", match);
        } else {
          console.warn("⚠️ No EPOS location matched quote store NS ID:", quoteStoreNsId);
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to set quote Store:", err.message || err);
    }

    if (
      typeof window.createGlobalSuggestions === "function" &&
      !document.getElementById("global-suggestions")
    ) {
      window.createGlobalSuggestions();
    }

    void filterPromise;

    renderOrderNumberLink("ordernumber", quote.tranId || tranId, quote, "estimate");
    renderOrderNumberLink("orderNumber", quote.tranId || tranId, quote, "estimate");

    try {
      const addressText = quote.billingAddress_text || quote.billaddress || "";
      let addressLines = addressText
        ? String(addressText).split("\n").map((l) => l.trim()).filter(Boolean)
        : [];

      const normalizeAddressLine = (value) =>
        String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      const entityName = [quote.entity?.firstName, quote.entity?.lastName]
        .filter(Boolean)
        .join(" ");
      const displayName = String(quote.entity?.refName || quote.customer?.refName || "")
        .replace(/^\d+\s+/, "")
        .trim();
      const nameToSkip = normalizeAddressLine(entityName || displayName);

      if (addressLines.length && nameToSkip) {
        const firstLine = normalizeAddressLine(addressLines[0]).replace(/^\d+\s+/, "");
        if (firstLine === nameToSkip) addressLines.shift();
      }

      const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
      let postcode = "";
      const cleanedAddress = [];

      for (const line of addressLines) {
        if (postcodeRegex.test(line)) {
          const match = line.match(postcodeRegex);
          if (match) postcode = match[0].toUpperCase();
          const townPart = line.replace(postcode, "").trim();
          if (townPart) cleanedAddress.push(townPart);
        } else if (/(United Kingdom|UK|England|Scotland|Wales|Northern Ireland)/i.test(line)) {
          // ignore country
        } else {
          cleanedAddress.push(line);
        }
      }

      const countySuffixRegex =
        /\b(East Sussex|West Sussex|Kent|Surrey|Essex|Hampshire|London|Greater London|Devon|Cornwall|Dorset|Somerset|Norfolk|Suffolk|Yorkshire|North Yorkshire|South Yorkshire|West Yorkshire|Lancashire|Cheshire)\b$/i;
      const splitTownCounty = (line) => {
        const value = String(line || "").trim();
        const countyMatch = value.match(countySuffixRegex);
        if (!countyMatch) return { town: value, county: "" };

        const countyValue = countyMatch[1].trim();
        return {
          town: value.slice(0, value.length - countyValue.length).trim(),
          county: countyValue,
        };
      };

      let address1 = cleanedAddress[0] || "";
      let address2 = cleanedAddress[1] || "";
      let address3 = cleanedAddress[2] || "";

      if (cleanedAddress.length === 2) {
        const townCounty = splitTownCounty(cleanedAddress[1]);
        if (townCounty.county) {
          address2 = "";
          address3 = townCounty.town;
        }
      } else if (address3) {
        address3 = splitTownCounty(address3).town;
      }

      const fullName = quote.entity?.refName || quote.customer?.refName || "";
      const nameParts = fullName.split(" ").filter(Boolean);

      const firstName = nameParts[1] || quote.firstName || "";
      const lastName = nameParts[2] || quote.lastName || "";

      document.querySelector('input[name="firstName"]')?.setAttribute("value", firstName);
      document.querySelector('input[name="lastName"]')?.setAttribute("value", lastName);

      const firstNameEl = document.querySelector('input[name="firstName"]');
      const lastNameEl = document.querySelector('input[name="lastName"]');
      const address1El = document.querySelector('input[name="address1"]');
      const address2El = document.querySelector('input[name="address2"]');
      const address3El = document.querySelector('input[name="address3"]');
      const postcodeEl = document.querySelector('input[name="postcode"]');

      if (firstNameEl) firstNameEl.value = firstName;
      if (lastNameEl) lastNameEl.value = lastName;
      if (address1El) address1El.value = address1;
      if (address2El) address2El.value = address2;
      if (address3El) address3El.value = address3;
      if (postcodeEl) postcodeEl.value = postcode || "";
    } catch (err) {
      console.warn("⚠️ Address population failed:", err.message || err);
    }

    const emailEl = document.querySelector('input[name="email"]');
    const contactEl = document.querySelector('input[name="contactNumber"]');
    const altContactEl = document.querySelector('input[name="altContactNumber"]');

    if (emailEl) emailEl.value = quote.email || "";
    if (contactEl) contactEl.value = quote.custbody4 || quote.phone || "";
    if (altContactEl) altContactEl.value = quote.altPhone || "";

    try {
      const leadSourceEl = document.querySelector('select[name="leadSource"]');
      const paymentSelect = document.getElementById("paymentInfo");
      const whSelect = document.getElementById("warehouse");

      if (leadSourceEl) leadSourceEl.value = quote.leadSource?.id || "";

      const paymentInfo = quote.custbody_sb_paymentinfo?.id || "";
      if (paymentSelect) paymentSelect.value = paymentInfo;

      const wh = quote.custbody_sb_warehouse?.id || "";
      if (whSelect) whSelect.value = wh;
    } catch (err) {
      console.warn("⚠️ Quote meta population failed:", err.message || err);
    }

    const storeEl = document.getElementById("store");
    if (storeEl) {
      storeEl.disabled = true;
      storeEl.classList.add("locked-input");
    }

    const tbody = document.getElementById("orderItemsBody");
    tbody.innerHTML = "";

    const lines = quote.item?.items || quote.items || quote.lines || [];

    if (Array.isArray(lines) && lines.length) {
      const frag = document.createDocumentFragment();

      lines.forEach((line, idx) => {
        const tr = document.createElement("tr");
        wireEditableQuoteRow(tr, line, idx);
        frag.appendChild(tr);
      });

      tbody.appendChild(frag);
    } else if (typeof window.addNewRow === "function") {
      window.addNewRow();
    } else {
      const empty = document.createElement("tr");
      empty.innerHTML = `<td colspan="10" style="text-align:center; color:#888;">No item lines found.</td>`;
      tbody.appendChild(empty);
    }

    bindQuoteItemTableEvents();
    ensureQuoteAddButton();

    if (typeof window.update60NightTrialColumnVisibility === "function") {
      window.update60NightTrialColumnVisibility();
    }

    if (typeof window.ensureNextEmptyRowAndFocus === "function") {
      const hasEmpty = [...document.querySelectorAll("#orderItemsBody .order-line")].some(
        (r) => (r.dataset.hasItem || "0") !== "1"
      );
      if (!hasEmpty && typeof window.addNewRow === "function") window.addNewRow();
    }

    updateQuoteSummaryFromTable();
    window.EposTransactionCustomFields?.render?.(
      quote.customFields || [],
      "No custom fields are visible for this quote."
    );
    window._lastQuoteSaveSignature = stableSaveSignature(buildQuoteSavePayload());
    updateActionButtonForQuote();
    ensureQuoteAddButton();

    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    document.getElementById("printBtn")?.addEventListener("click", () => {
      const id = getIdFromPath();
      if (!id) return alert("No quote ID found in URL");
      const payload = quoteReceiptPayloadFromDom(id);
      const url = window.EposPendingReceipt?.create?.("quote", payload) || `/quote/reciept/${id}`;
      window.open(url, "_blank");
    });
  } catch (err) {
    console.error("❌ Quote load failure:", err.message || err);
    alert("Failed to load Quote details. " + (err.message || err));
  } finally {
    overlay?.classList.add("hidden");
  }
});
