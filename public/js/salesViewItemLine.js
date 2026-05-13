// public/js/salesViewItemLine.js

let salesViewLineCounter = 1000;

/* =========================================================
   60 Night Trial helpers
========================================================= */
function insertAfter(newNode, referenceNode) {
  referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

function safeQuery(row, selector) {
  try {
    return row.querySelector(selector);
  } catch (err) {
    console.warn("⚠️ Invalid selector skipped:", selector, err);
    return null;
  }
}

function findExisting60NTSelect(row) {
  const selectors = [
    "select.sixty-night-select",
    "#60ntSelect",
    'select[name="60nt"]',
    'select[name="sixtyNightTrial"]',
    'select[name="sixty_night_trial"]',
  ];

  for (const sel of selectors) {
    const el = safeQuery(row, sel);
    if (el) return el;
  }

  const selects = row.querySelectorAll("select");
  for (const s of selects) {
    const opts = [...s.options].map((o) =>
      (o.value || o.textContent || "").trim().toLowerCase()
    );
    const hasYes = opts.includes("yes");
    const hasNo = opts.includes("no");
    const hasNA = opts.includes("n/a") || opts.includes("na");
    if (hasYes && hasNo && hasNA) return s;
  }

  return null;
}

function normalise60NightTrialValue(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "yes" || text === "accepted") return "Accepted";
  if (text === "no" || text === "declined") return "Declined";
  return "";
}

function ensure60NightSelectOptions(sel) {
  if (!sel) return;
  const current = normalise60NightTrialValue(sel.value);
  sel.innerHTML = `
    <option value="">Select...</option>
    <option value="Accepted">Accepted</option>
    <option value="Declined">Declined</option>
  `;
  sel.value = current;
  sel.required = false;
  if (sel.dataset.sixtyNightBound !== "1") {
    sel.dataset.sixtyNightBound = "1";
    sel.addEventListener("change", () => {
      sel.dataset.userEdited = "1";
    });
  }
}

function isMattressClassName(className) {
  return String(className || "").trim().toLowerCase() === "mattress";
}

function isMattressProtectorClassName(className) {
  return String(className || "").trim().toLowerCase() === "mattress protectors";
}

function sync60NightTrialAutomation(rows = document.querySelectorAll("#orderItemsBody .order-line")) {
  const itemRows = [...rows].filter((row) =>
    (row.querySelector(".item-internal-id")?.value || "").trim()
  );
  const autoValue = itemRows.some((row) => isMattressProtectorClassName(row.dataset.itemClass))
    ? "Accepted"
    : "Declined";

  itemRows.forEach((row) => {
    if (!isMattressClassName(row.dataset.itemClass)) return;
    const sel = row.querySelector(".sixty-night-select");
    if (!sel || sel.dataset.userEdited === "1") return;
    sel.value = autoValue;
    sel.dataset.autoValue = autoValue;
  });
}

function ensure60NightTrialCell(row) {
  if (!row) return null;

  let td = row.querySelector("td.sixty-night-cell");

  if (!td) {
    const existingSel = findExisting60NTSelect(row);
    if (existingSel) {
      td = existingSel.closest("td");
      if (td) td.classList.add("sixty-night-cell");
      existingSel.classList.add("sixty-night-select");
    }
  }

  if (!td) {
    td = document.createElement("td");
    td.className = "sixty-night-cell";
    td.innerHTML = `
      <select class="sixty-night-select">
        <option value="">Select...</option>
        <option value="Accepted">Accepted</option>
        <option value="Declined">Declined</option>
      </select>
      <span class="sixty-night-placeholder">—</span>
    `;
  } else {
    if (!td.querySelector(".sixty-night-placeholder")) {
      const span = document.createElement("span");
      span.className = "sixty-night-placeholder";
      span.textContent = "—";
      td.appendChild(span);
    }
    const sel = td.querySelector("select");
    if (sel && !sel.classList.contains("sixty-night-select")) {
      sel.classList.add("sixty-night-select");
    }
  }

  td.style.display = "none";

  const sel = td.querySelector(".sixty-night-select");
  const ph = td.querySelector(".sixty-night-placeholder");
  ensure60NightSelectOptions(sel);
  if (sel) sel.style.display = "none";
  if (ph) ph.style.display = "inline";

  const saleTd =
    row.querySelector(".vat-free-cell") ||
    row.querySelector(".item-saleprice")?.closest("td");
  const fulfilTd =
    row.querySelector(".item-fulfilment")?.closest("td") ||
    row.querySelector(".fulfilment-cell");

  if (saleTd) {
    if (td.parentNode === row) td.remove();
    insertAfter(td, saleTd);
  } else if (fulfilTd) {
    if (td.parentNode === row) td.remove();
    fulfilTd.parentNode.insertBefore(td, fulfilTd);
  } else {
    if (!td.parentNode) row.appendChild(td);
  }

  return td;
}

function update60NightTrialColumnVisibility() {
  const header = document.getElementById("60ntheader");
  const rows = document.querySelectorAll("#orderItemsBody .order-line");
  if (!header) return;

  rows.forEach((r) => ensure60NightTrialCell(r));

  const anyMattress = [...rows].some((r) => isMattressClassName(r.dataset.itemClass));

  header.style.display = anyMattress ? "table-cell" : "none";

  rows.forEach((r) => {
    const cell = r.querySelector("td.sixty-night-cell");
    if (!cell) return;

    cell.style.display = anyMattress ? "table-cell" : "none";

    const sel = cell.querySelector(".sixty-night-select");
    const ph = cell.querySelector(".sixty-night-placeholder");
    const isMattress = isMattressClassName(r.dataset.itemClass);

    if (sel) sel.style.display = isMattress ? "inline-block" : "none";
    if (ph) ph.style.display = isMattress ? "none" : "inline";

    if (sel) {
      sel.required = anyMattress && isMattress;
      if (!isMattress) {
        sel.value = "";
        delete sel.dataset.userEdited;
        delete sel.dataset.autoValue;
      }
    }
  });

  sync60NightTrialAutomation(rows);
}

function ensureVatFreeCell(row) {
  if (!row) return null;

  let td = row.querySelector("td.vat-free-cell");

  if (!td) {
    td = document.createElement("td");
    td.className = "vat-free-cell";
    td.innerHTML = `
      <input type="checkbox" class="vat-free-checkbox" aria-label="Vat Free" style="display:none;" />
      <span class="vat-free-placeholder"></span>
    `;
  }

  const saleTd =
    row.querySelector(".item-saleprice")?.closest("td") ||
    row.querySelector("td.saleprice");
  if (saleTd) {
    if (td.parentNode === row) td.remove();
    insertAfter(td, saleTd);
  } else if (!td.parentNode) {
    row.appendChild(td);
  }

  return td;
}

function updateVatFreeColumnVisibility() {
  const header = document.getElementById("vatFreeHeader");
  const rows = document.querySelectorAll("#orderItemsBody .order-line");
  if (!header) return;

  rows.forEach((row) => ensureVatFreeCell(row));

  const anyAdjustable = [...rows].some((row) => rowHasAdjustableCategory(row));
  header.style.display = anyAdjustable ? "table-cell" : "none";

  rows.forEach((row) => {
    const cell = row.querySelector("td.vat-free-cell");
    if (!cell) return;

    const isAdjustable = rowHasAdjustableCategory(row);
    const checkbox = cell.querySelector(".vat-free-checkbox");
    const placeholder = cell.querySelector(".vat-free-placeholder");

    cell.style.display = anyAdjustable ? "table-cell" : "none";
    if (checkbox) checkbox.style.display = isAdjustable ? "inline-block" : "none";
    if (placeholder) {
      placeholder.textContent = "";
      placeholder.style.display = "none";
    }
    if (!isAdjustable && checkbox) checkbox.checked = false;
  });
}

/* =========================================================
   Helpers
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

function getItemClass(item) {
  const raw =
    item?.["Class"] ??
    item?.class ??
    item?.itemClass ??
    item?.["Item Class"] ??
    item?.type ??
    item?.Type ??
    item?.itemType ??
    item?.["Item Type"] ??
    "";

  if (raw && typeof raw === "object") {
    return String(raw.refName || raw.name || raw.text || raw.value || raw.id || "")
      .trim()
      .toLowerCase();
  }

  return String(raw).trim().toLowerCase();
}

function getItemCategory(item) {
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

  return String(raw).trim().toLowerCase();
}

function getLineItemClass(line, itemData) {
  return (
    getItemClass(itemData) ||
    getItemClass(line?.item) ||
    getItemClass(line) ||
    String(line?.itemClass || "").trim().toLowerCase()
  );
}

function getLineItemCategory(line, itemData) {
  return (
    getItemCategory(itemData) ||
    getItemCategory(line?.item) ||
    getItemCategory(line) ||
    String(line?.itemCategory || "").trim().toLowerCase()
  );
}

function rowHasAdjustableCategory(row) {
  return String(row?.dataset?.itemCategory || "").toLowerCase().includes("adjustable");
}

function isServiceItemClass(itemClass) {
  return String(itemClass || "").toLowerCase().includes("service");
}

function setServiceFulfilmentVisibility(row, isService) {
  const fulfilCell = row?.querySelector(".fulfilment-cell");
  const fulfilSel = row?.querySelector(".item-fulfilment");
  const invCell =
    row?.querySelector(".inventory-cell") ||
    row?.querySelector(".inventory-cell-wrapper .inventory-cell");

  if (fulfilCell) fulfilCell.classList.toggle("service-empty-cell", !!isService);
  if (fulfilSel) {
    if (isService) fulfilSel.value = "";
    fulfilSel.style.display = isService ? "none" : "inline-block";
  }
  if (invCell) invCell.style.display = isService ? "none" : "";
}

function salesViewRecordValue(record, keys) {
  if (!record || typeof record !== "object") return "";
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object") {
      const nested = value.id ?? value.value ?? value.refName ?? value.name ?? value.text;
      if (nested !== undefined && nested !== null && nested !== "") return String(nested).trim();
    } else if (value !== undefined && value !== null && value !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function existingFulfilmentMethodId(line) {
  return salesViewRecordValue(line, [
    "custcol_sb_fulfilmentlocation",
    "fulfilmentMethod",
    "fulfillmentMethod",
    "fulfilmentlocation",
    "fulfillmentlocation",
    "CUSTCOL_SB_FULFILMENTLOCATION",
  ]);
}

function existingInventoryDetail(line) {
  return salesViewRecordValue(line, [
    "inventoryDetail",
    "inventoryMeta",
    "custcol_sb_epos_inventory_meta",
    "CUSTCOL_SB_EPOS_INVENTORY_META",
    "custcol_sb_lotnumber",
    "CUSTCOL_SB_LOTNUMBER",
    "lotnumber",
    "lotNumber",
  ]);
}

function buildOptionSchemaForItem(itemId) {
  const fromDb = window.itemOptionsCache?.getOptionsForItemSync?.(itemId) || {};
  return Object.keys(fromDb).length ? fromDb : {};
}

function setInventoryButtonState(row) {
  const btn = row.querySelector(".open-inventory");
  const detailField = row.querySelector(".item-inv-detail");
  const qty =
    parseInt(
      row.querySelector(".item-qty")?.value ||
        row.querySelector(".item-qty-cache")?.value ||
        "0",
      10
    ) || 0;

  if (!btn) return;

  const detailString = detailField?.value || "";
  if (!detailString) {
    btn.textContent = "📦";
    return;
  }

  const allocated = detailString
    .split(";")
    .map((p) => parseInt(p.trim().split("|")[0], 10) || 0)
    .reduce((a, b) => a + b, 0);

  if (allocated > 0 && qty > 0 && allocated === qty) {
    btn.textContent = "✅";
  } else {
    btn.textContent = "✅";
  }
}

function applyItemToSalesViewRow(row, item, config = {}) {
  if (!row || !item) return;

  const input = row.querySelector(".item-search");
  const hiddenId = row.querySelector(".item-internal-id");
  const hiddenBase = row.querySelector(".item-baseprice");
  const discountField = row.querySelector(".item-discount");
  const qtyField = row.querySelector(".item-qty");
  const saleField = row.querySelector(".item-saleprice");
  const quantity = Math.max(1, parseInt(config.quantity || qtyField?.value || 1, 10) || 1);

  const itemId = getItemInternalId(item);
  const itemClass = getItemClass(item);
  const itemCategory = getItemCategory(item);

  if (input) input.value = item["Name"] || "";
  if (hiddenId) hiddenId.value = itemId;
  if (hiddenBase) hiddenBase.value = item["Base Price"] || "";
  if (qtyField) qtyField.value = String(quantity);

  const base = parseFloat(item["Base Price"] || 0);
  const retailPerUnitGross = base > 10000 ? (base / 100) * 1.2 : base * 1.2;

  if (discountField) {
    discountField.value = Number.isFinite(Number(config.discountPercent))
      ? String(Number(config.discountPercent))
      : "0";
  }

  row.dataset.itemClass = itemClass;
  row.dataset.itemCategory = itemCategory;
  const existingTrialSelect = row.querySelector(".sixty-night-select");
  if (existingTrialSelect) {
    existingTrialSelect.value = "";
    delete existingTrialSelect.dataset.userEdited;
    delete existingTrialSelect.dataset.autoValue;
  }

  if (!row.setUnitRetail && window.SalesLineUI?.setupPriceSync) {
    window.SalesLineUI.setupPriceSync(row);
  }
  if (row.setUnitRetail) {
    row.setUnitRetail(retailPerUnitGross);
  }

  if (saleField && Number.isFinite(Number(config.salePrice))) {
    saleField.value = Number(config.salePrice).toFixed(2);
    saleField.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const opts = buildOptionSchemaForItem(itemId);
  window.optionsCache = window.optionsCache || {};
  if (itemId) window.optionsCache[itemId] = opts;

  const optCell = row.querySelector(".options-cell");
  if (optCell) {
    if (Object.keys(opts).length === 0) {
      optCell.innerHTML = `
        <input type="hidden" class="item-options-json" value="{}" />
        <div class="options-summary"></div>
      `;
    } else {
      optCell.innerHTML = `
        <button type="button" class="open-options btn-secondary small-btn">Options</button>
        <input type="hidden" class="item-options-json" value="{}" />
        <div class="options-summary"></div>
      `;
      optCell.querySelector(".open-options")?.addEventListener("click", () =>
        window.SalesLineUI?.openOptionsWindow(row)
      );
    }
  }

  ensure60NightTrialCell(row);
  updateVatFreeColumnVisibility();
  update60NightTrialColumnVisibility();

  if (isServiceItemClass(itemClass)) {
    setServiceFulfilmentVisibility(row, true);
  } else {
    setServiceFulfilmentVisibility(row, false);
    window.SalesLineUI?.validateInventoryForRow(row);
  }

  const vatCell = row.querySelector(".vat");
  if (saleField && vatCell) {
    const saleVal = parseFloat(saleField.value || 0) || 0;
    const vatFree = !!row.querySelector(".vat-free-checkbox")?.checked;
    vatCell.textContent = `£${(vatFree ? 0 : saleVal - saleVal / 1.2).toFixed(2)}`;
  }

  if (qtyField && qtyField.value === "") qtyField.value = "1";

  setInventoryButtonState(row);

  if (typeof updateOrderSummaryFromTable === "function") {
    updateOrderSummaryFromTable();
  }
}

function wireSalesViewRow(row, { fulfilmentMethods = [], existingLine = null } = {}) {
  if (!row) return;

  const lineIdx = Number(row.dataset.line || 0);
  const isService = isServiceItemClass(row.dataset.itemClass);

  const sel = row.querySelector(".item-fulfilment");
  if (sel && !isService) {
    window.SalesLineUI?.fillFulfilmentSelect(sel, fulfilmentMethods);
    const currentId = existingFulfilmentMethodId(existingLine);
    if (currentId) sel.value = String(currentId);

    sel.addEventListener("change", () => {
      window.SalesLineUI?.validateInventoryForRow(row);
      setInventoryButtonState(row);
      if (typeof updateOrderSummaryFromTable === "function") {
        updateOrderSummaryFromTable();
      }
    });
  }
  setServiceFulfilmentVisibility(row, isService);

  window.SalesLineUI?.setupPriceSync(row);

  const btn = row.querySelector(".open-inventory");
  btn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.SalesLineUI?.openInventoryWindow(row, lineIdx);
  });

  const optionsBtn = row.querySelector(".open-options");
  optionsBtn?.addEventListener("click", () =>
    window.SalesLineUI?.openOptionsWindow(row)
  );

  const deleteBtn = row.querySelector(".delete-row");
  deleteBtn?.addEventListener("click", () => {
    row.remove();
    updateVatFreeColumnVisibility();
    update60NightTrialColumnVisibility();
    if (typeof updateOrderSummaryFromTable === "function") {
      updateOrderSummaryFromTable();
    }
  });

  const itemSearch = row.querySelector(".item-search");
  if (itemSearch) {
    itemSearch.addEventListener("input", () => {
      const query = itemSearch.value.trim().toLowerCase();
      if (!query) return window.SalesLineUI?.hideSuggestions?.();

      const items = window.items || [];
      const matches = items.filter((it) =>
        String(it["Name"] || "").toLowerCase().includes(query)
      );

      window.SalesLineUI?.showSuggestions?.(itemSearch, matches, lineIdx);
    });
  }

  const saleField = row.querySelector(".item-saleprice");
  const vatCell = row.querySelector(".vat");
  const vatFreeField = row.querySelector(".vat-free-checkbox");
  if (saleField && vatCell) {
    const recalcVat = () => {
      const saleVal = parseFloat(saleField.value || 0) || 0;
      const vatFree = !!vatFreeField?.checked;
      vatCell.textContent = `£${(vatFree ? 0 : saleVal - saleVal / 1.2).toFixed(2)}`;
    };
    saleField.addEventListener("input", recalcVat);
    vatFreeField?.addEventListener("change", recalcVat);
    recalcVat();
  }

  const itemId = row.querySelector(".item-internal-id")?.value?.trim() || "";
  if (itemId) {
    const itemData = (window.items || []).find((it) => getItemInternalId(it) === itemId);
    if (itemData) {
      row.dataset.itemClass = getLineItemClass(existingLine, itemData);
      row.dataset.itemCategory = getLineItemCategory(existingLine, itemData);
      const schema = buildOptionSchemaForItem(itemId);
      if (Object.keys(schema).length) {
        window.optionsCache = window.optionsCache || {};
        window.optionsCache[itemId] = schema;
      }
    }
  }

  ensure60NightTrialCell(row);
  updateVatFreeColumnVisibility();
  update60NightTrialColumnVisibility();
  const finalIsService = isServiceItemClass(row.dataset.itemClass);
  setServiceFulfilmentVisibility(row, finalIsService);
  if (!finalIsService && sel && existingFulfilmentMethodId(existingLine)) {
    sel.value = String(existingFulfilmentMethodId(existingLine));
  }
  if (!finalIsService) {
    window.SalesLineUI?.validateInventoryForRow(row);
  }
  setInventoryButtonState(row);
}

/* =========================================================
   Add new row
========================================================= */
function addSalesViewRow({ fulfilmentMethods = [] } = {}) {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody) return;

  const newLine = salesViewLineCounter++;
  const tr = document.createElement("tr");
  tr.className = "order-line";
  tr.dataset.line = String(newLine);
  tr.dataset.lineid = "";
  tr.dataset.isnew = "T";
  tr.dataset.itemClass = "";
  tr.dataset.itemCategory = "";

  tr.innerHTML = `
    <td>
      <div class="autocomplete">
        <input
          type="text"
          id="itemSearch-${newLine}"
          class="item-search"
          placeholder="Product name"
          autocomplete="off"
          aria-autocomplete="list"
        />
      </div>

      <input type="hidden" class="item-baseprice" value="0" />
      <input type="hidden" class="item-internal-id" value="" />
    </td>

    <td class="options-cell">
      <input type="hidden" class="item-options-json" value="{}" />
      <div class="options-summary"></div>
    </td>

    <td class="qty">
      <input type="number" class="item-qty" value="1" min="1" step="1" />
    </td>

    <td class="amount">
      <input
        type="number"
        class="item-amount"
        readonly
        value="0.00"
        data-unit-retail="0"
      />
    </td>

    <td class="discount">
      <input type="number" class="item-discount" value="0" min="0" max="100" step="0.1" />
    </td>

    <td class="vat">£0.00</td>

    <td class="saleprice">
      <input type="text" class="item-saleprice" value="0.00" inputmode="decimal" autocomplete="off" />
    </td>

    <td class="vat-free-cell" style="display:none;">
      <input type="checkbox" class="vat-free-checkbox" aria-label="Vat Free" style="display:none;" />
      <span class="vat-free-placeholder"></span>
    </td>

    <td class="sixty-night-cell" style="display:none;">
      <select class="sixty-night-select" style="display:none;">
        <option value="">Select...</option>
        <option value="Accepted">Accepted</option>
        <option value="Declined">Declined</option>
      </select>
      <span class="sixty-night-placeholder">—</span>
    </td>

    <td class="fulfilment-cell">
      <select class="item-fulfilment fulfilmentSelect" data-line="${newLine}"></select>
    </td>

    <td class="inventory-cell-wrapper">
      <div class="inventory-cell" style="display:none">
        <button type="button" class="open-inventory btn-secondary small-btn" data-line="${newLine}">📦</button>
        <input type="hidden" class="item-inv-detail" value="" />
        <span class="inv-summary"></span>
      </div>
    </td>

    <td>
      <button type="button" class="delete-row btn-secondary small-btn">🗑</button>
    </td>
  `;

  tbody.appendChild(tr);
  wireSalesViewRow(tr, { fulfilmentMethods });

  if (typeof updateOrderSummaryFromTable === "function") {
    updateOrderSummaryFromTable();
  }
}

function setInventoryDetailForSalesViewRow(row, detailString) {
  if (!row) return;

  const normalized = String(detailString || "").trim();
  const detailField = row.querySelector(".item-inv-detail");
  if (detailField) detailField.value = normalized;

  row.dataset.invdetail = normalized;
  const summary = row.querySelector(".inv-summary");
  if (summary) summary.textContent = normalized;

  setInventoryButtonState(row);
  if (typeof updateOrderSummaryFromTable === "function") {
    updateOrderSummaryFromTable();
  }
}

/* =========================================================
   Callbacks from popups
========================================================= */
window.onOptionsSaved = function onOptionsSaved(itemId, selections) {
  let row = null;

  row = document
    .querySelector(`.order-line .item-internal-id[value="${itemId}"]`)
    ?.closest(".order-line");

  if (!row) {
    console.warn("⚠️ onOptionsSaved could not find target row for item:", itemId);
    return;
  }

  let jsonEl = row.querySelector(".item-options-json");
  let sumEl = row.querySelector(".options-summary");
  const optCell = row.querySelector(".options-cell");

  if (!jsonEl && optCell) {
    optCell.innerHTML = `
      <button type="button" class="open-options btn-secondary small-btn">Options</button>
      <input type="hidden" class="item-options-json" />
      <div class="options-summary"></div>
    `;
    optCell.querySelector(".open-options")?.addEventListener("click", () =>
      window.SalesLineUI?.openOptionsWindow(row)
    );
    jsonEl = row.querySelector(".item-options-json");
    sumEl = row.querySelector(".options-summary");
  }

  const parts = [];
  Object.entries(selections || {}).forEach(([field, value]) => {
    if (Array.isArray(value) && value.length > 0) {
      parts.push(`${field} : ${value.join(", ")}`);
    } else if (value) {
      parts.push(`${field} : ${value}`);
    }
  });

  if (jsonEl) jsonEl.value = JSON.stringify(selections || {});
  if (sumEl) sumEl.innerHTML = parts.join("<br>");

  if (typeof updateOrderSummaryFromTable === "function") {
    updateOrderSummaryFromTable();
  }
};

window.onInventorySaved = function onInventorySaved(itemId, detailString, lineIndex) {
  try {
    const row = document.querySelector(`#orderItemsBody tr.order-line[data-line="${lineIndex}"]`);
    if (!row) {
      console.warn("⚠️ onInventorySaved: row not found", { lineIndex, itemId });
      return;
    }

    const invInp = row.querySelector(".item-inv-detail");
    if (invInp) invInp.value = detailString || "";

    const summary = row.querySelector(".inv-summary");
    if (summary) summary.textContent = detailString || "";

    const fulfilSel =
      row.querySelector(".item-fulfilment") || row.querySelector(".fulfilmentSelect");
    if (fulfilSel && window.SalesLineUI?.validateInventoryForRow) {
      window.SalesLineUI.validateInventoryForRow(row);
    }

    setInventoryButtonState(row);

    if (typeof updateOrderSummaryFromTable === "function") {
      updateOrderSummaryFromTable();
    }

    console.log("✅ Inventory saved into Sales View row", { lineIndex, itemId });
  } catch (err) {
    console.error("❌ onInventorySaved failed:", err.message || err);
  }
};

/* =========================================================
   Main renderer
========================================================= */
window.renderSalesViewLines = function renderSalesViewLines({
  so,
  fulfilmentMethods = [],
}) {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const isPending = String(so?.orderStatus?.id || "").toUpperCase() === "A";
  const lines = so?.item?.items || [];

  if (!lines.length) {
    if (isPending) {
      const addBtn = document.getElementById("addItemBtn");
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.classList.remove("locked-input");
        addBtn.onclick = () => addSalesViewRow({ fulfilmentMethods });
      }

      addSalesViewRow({ fulfilmentMethods });

      if (typeof updateOrderSummaryFromTable === "function") {
        updateOrderSummaryFromTable();
      }
      return;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="11" style="text-align:center; color:#888;">No item lines found.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();

  lines.forEach((line, idx) => {
    const tr = document.createElement("tr");
    tr.className = "order-line";
    tr.dataset.line = idx;
    tr.dataset.lineid = line.lineId || "";
    tr.dataset.itemClass = "";

    const qty = Math.abs(Number(line.quantity || 1)) || 1;

    let retailGrossLineTotal = Number(line.amount || 0);
    let saleGrossLineTotal = Number(line.saleprice ?? 0);

    if (!Number.isFinite(retailGrossLineTotal)) retailGrossLineTotal = 0;
    if (!Number.isFinite(saleGrossLineTotal)) saleGrossLineTotal = 0;

    if (retailGrossLineTotal === 0 && saleGrossLineTotal !== 0) {
      retailGrossLineTotal = saleGrossLineTotal;
    }

    const itemName = String(line.item?.refName || "").toLowerCase();

    const isNegativeValueLine = window.EposFinancials?.isNegativeValueLine
      ? window.EposFinancials.isNegativeValueLine(itemName)
      : itemName.includes("discount") ||
        itemName.includes("blue light") ||
        itemName.includes("promo") ||
        itemName.includes("promotion") ||
        itemName.includes("voucher") ||
        itemName.includes("trade in") ||
        itemName.includes("recommendation card (as a minus)") ||
        itemName.includes("trade-in");

    if (isNegativeValueLine) {
      if (retailGrossLineTotal > 0) retailGrossLineTotal = -retailGrossLineTotal;
      if (saleGrossLineTotal > 0) saleGrossLineTotal = -saleGrossLineTotal;
    } else {
      if (retailGrossLineTotal < 0) retailGrossLineTotal = Math.abs(retailGrossLineTotal);
      if (saleGrossLineTotal < 0) saleGrossLineTotal = Math.abs(saleGrossLineTotal);
    }

    const retailGrossPerUnit = qty ? retailGrossLineTotal / qty : 0;

    const existingTaxCode = salesViewRecordValue(line, [
      "taxCode",
      "taxcode",
      "tax_code",
      "Tax Code",
    ]).toLowerCase();
    const existingVatFree =
      existingTaxCode === "10" ||
      existingTaxCode.includes("vat free") ||
      existingTaxCode.includes("zero");

    const discountBasis = existingVatFree ? retailGrossLineTotal / 1.2 : retailGrossLineTotal;
    const displaySaleLineTotal =
      existingVatFree && saleGrossLineTotal === retailGrossLineTotal
        ? discountBasis
        : saleGrossLineTotal;
    const discountPct =
      discountBasis > 0
        ? Math.max(0, ((discountBasis - displaySaleLineTotal) / discountBasis) * 100)
        : 0;

    const taxValue = existingVatFree ? 0 : displaySaleLineTotal / 6;

    const optionsText = line.custcol_sb_itemoptionsdisplay || line.optionsDisplay || "";
    const optsHtml = buildOptionsSummaryHtml(optionsText);
    const existingSelections = guessOptionsJsonFromDisplay(optionsText);
    const itemId = String(line.item?.id || "");
    const optionSchema = buildOptionSchemaForItem(itemId);
    if (itemId && Object.keys(optionSchema).length) {
      window.optionsCache = window.optionsCache || {};
      window.optionsCache[itemId] = optionSchema;
    }

    const itemData = (window.items || []).find((it) => getItemInternalId(it) === itemId);
    const itemClass = getLineItemClass(line, itemData);
    const itemCategory = getLineItemCategory(line, itemData);
    const isServiceLine = isServiceItemClass(itemClass);
    tr.dataset.itemClass = itemClass;
    tr.dataset.itemCategory = itemCategory;

    const hasEditableOptions = Object.keys(optionSchema).length > 0;

    const discountCell = isPending
      ? `<input type="number" class="item-discount" value="${discountPct.toFixed(1)}" min="0" max="100" step="0.1" />`
      : `${discountPct.toFixed(1)}%`;

    const saleCell = isPending
      ? `<input type="text" class="item-saleprice" value="${displaySaleLineTotal.toFixed(2)}" inputmode="decimal" autocomplete="off" />`
      : `£${displaySaleLineTotal.toFixed(2)}`;

    const qtyCell = isPending
      ? `<input type="number" class="item-qty" value="${qty}" min="1" step="1" />`
      : `<span class="qty">${qty}</span>`;

    const fulfilCell = isServiceLine
      ? ""
      : isPending
        ? `<select class="item-fulfilment fulfilmentSelect" data-line="${idx}"></select>`
        : line.custcol_sb_fulfilmentlocation?.refName || "";

    const inventoryDetail = existingInventoryDetail(line);

    const invCell = isServiceLine
      ? ""
      : isPending
      ? `
        <div class="inventory-cell" style="display:none">
          <button type="button" class="open-inventory btn-secondary small-btn" data-line="${idx}">${
            inventoryDetail ? "✅" : "📦"
          }</button>
          <input type="hidden" class="item-inv-detail" value="${String(inventoryDetail).replace(/"/g, "&quot;")}" />
          <span class="inv-summary">${inventoryDetail || ""}</span>
        </div>`
      : inventoryDetail
        ? "✅"
        : "";

    tr.innerHTML = `
      <td>
        ${
          isPending
            ? `
              <div class="autocomplete">
                <input
                  type="text"
                  id="itemSearch-${idx}"
                  class="item-search"
                  value="${String(line.item?.refName || "").replace(/"/g, "&quot;")}"
                  placeholder="Product name"
                  autocomplete="off"
                  aria-autocomplete="list"
                />
              </div>
            `
            : `${line.item?.refName || "—"}`
        }

        <input
          type="hidden"
          class="item-baseprice"
          value="${(retailGrossPerUnit / 1.2).toFixed(6)}"
        />
        <input type="hidden" class="item-internal-id" value="${itemId}" />
      </td>

      <td class="options-cell">
        ${
          isPending
            ? hasEditableOptions
              ? `
                <button type="button" class="open-options btn-secondary small-btn">Options</button>
                <input type="hidden" class="item-options-json" value='${JSON.stringify(existingSelections).replace(/'/g, "&apos;")}' />
                <div class="options-summary">${optsHtml}</div>
              `
              : `
                <input type="hidden" class="item-options-json" value='${JSON.stringify(existingSelections).replace(/'/g, "&apos;")}' />
                <div class="options-summary">${optsHtml}</div>
              `
            : optsHtml
        }
      </td>

      <td class="qty">${qtyCell}</td>

      <td class="amount">
        ${
          isPending
            ? `<input
                type="number"
                class="item-amount"
                readonly
                value="${retailGrossLineTotal.toFixed(2)}"
                data-unit-retail="${retailGrossPerUnit.toFixed(6)}"
              />`
            : `£${retailGrossLineTotal.toFixed(2)}`
        }
      </td>

      <td class="discount">${discountCell}</td>
      <td class="vat">£${taxValue.toFixed(2)}</td>
      <td class="saleprice">${saleCell}</td>

      <td class="vat-free-cell" style="display:none;">
        ${
          isPending
            ? `<input type="checkbox" class="vat-free-checkbox" aria-label="Vat Free" style="display:none;" ${
                existingVatFree ? "checked" : ""
              } />
               <span class="vat-free-placeholder"></span>`
            : `<span class="vat-free-placeholder"></span>`
        }
      </td>

      <td class="sixty-night-cell" style="display:none;">
        <select class="sixty-night-select" style="display:none;">
          <option value="">Select...</option>
          <option value="Accepted">Accepted</option>
          <option value="Declined">Declined</option>
        </select>
        <span class="sixty-night-placeholder">—</span>
      </td>

      <td class="fulfilment-cell${isServiceLine ? " service-empty-cell" : ""}">${fulfilCell}</td>
      <td class="inventory-cell-wrapper">${invCell}</td>

      ${
        isPending
          ? `<td><button type="button" class="delete-row btn-secondary small-btn">🗑</button></td>`
          : ``
      }
    `;

    const sixtyNightSelect = tr.querySelector(".sixty-night-select");
    const existingTrialValue =
      line.custcol_sb_30nighttrialoption?.refName ||
      line.custcol_sb_30nighttrialoption?.text ||
      line.trialOption ||
      "N/A";

    if (sixtyNightSelect) {
      const normTrial = String(existingTrialValue || "").trim().toLowerCase();
      if (normTrial === "yes" || normTrial === "accepted") {
        sixtyNightSelect.value = "Accepted";
      } else if (normTrial === "no" || normTrial === "declined") {
        sixtyNightSelect.value = "Declined";
      } else {
        sixtyNightSelect.value = "";
      }
      if (sixtyNightSelect.value) sixtyNightSelect.dataset.userEdited = "1";
    }

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  if (isPending) {
    const addBtn = document.getElementById("addItemBtn");
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.classList.remove("locked-input");
      addBtn.onclick = () => addSalesViewRow({ fulfilmentMethods });
    }

    tbody.querySelectorAll("tr.order-line").forEach((row) => {
      const lineIdx = Number(row.dataset.line || 0);
      const line = lines[lineIdx];
      wireSalesViewRow(row, { fulfilmentMethods, existingLine: line });
    });

    update60NightTrialColumnVisibility();

    if (typeof updateOrderSummaryFromTable === "function") {
      updateOrderSummaryFromTable();
    }
  } else {
    updateVatFreeColumnVisibility();
    update60NightTrialColumnVisibility();
  }
};

/* =========================================================
   Expose helpers
========================================================= */
window.ensure60NightTrialCell = ensure60NightTrialCell;
window.update60NightTrialColumnVisibility = update60NightTrialColumnVisibility;
window.ensureVatFreeCell = ensureVatFreeCell;
window.updateVatFreeColumnVisibility = updateVatFreeColumnVisibility;
window.applyItemToSalesViewRow = applyItemToSalesViewRow;
window.salesNewItemEditor = window.salesNewItemEditor || {
  addNewRow: () => addSalesViewRow({ fulfilmentMethods: window._fulfilmentMap || [] }),
  applyItemToRow: (...args) => applyItemToSalesViewRow(...args),
  setInventoryDetailForRow: (...args) => setInventoryDetailForSalesViewRow(...args),
};
