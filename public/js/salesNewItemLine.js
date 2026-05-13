let items = [];
let globalSuggestions;
let activeInput, activeLineIndex;
let lineCounter = 1;

// ✅ Global caches so popup windows can see them
window.optionsCache = {};   // itemId -> options payload
window.inventoryCache = {}; // itemId -> [{location, qty, bin, status, inventoryNumber}, ...]
window.selectedWarehouse = ""; // order header warehouse
window.salesNewItemEditor = {
  addNewRow: (...args) => addNewRow(...args),
  applyItemToRow: (...args) => applyItemToRow(...args),
  selectionsToSummary: (...args) => selectionsToSummary(...args),
  setInventoryDetailForRow: (...args) => setInventoryDetailForRow(...args),
};

function clampPercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.min(100, Math.max(0, amount));
}

function setInventoryDetailForRow(row, detailString) {
  if (!row) return;
  const normalized = String(detailString || "").trim();
  const detailField = row.querySelector(".item-inv-detail");
  if (detailField) detailField.value = normalized;
  row.dataset.invdetail = normalized;
}

function buildLegacyOptionSchemaFromItem(item) {
  const opts = {};
  Object.entries(item || {}).forEach(([key, val]) => {
    if (!String(key).toLowerCase().startsWith("option :")) return;

    const fieldName = String(key).replace(/^option\s*:\s*/i, "").trim();
    if (String(fieldName).toLowerCase() === "size.v1") return;
    const values = String(val || "")
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);

    if (fieldName && values.length) opts[fieldName] = values;
  });
  return opts;
}

function getOptionSchemaForItem(itemId, itemData) {
  const fromDb = window.itemOptionsCache?.getOptionsForItemSync?.(itemId) || {};
  if (Object.keys(fromDb).length) return fromDb;
  return buildLegacyOptionSchemaFromItem(itemData);
}

function getItemClassText(item) {
  const raw =
    item?.["Class"] ??
    item?.class ??
    item?.className ??
    item?.itemClass ??
    item?.["Item Class"] ??
    "";

  if (raw && typeof raw === "object") {
    return String(raw.refName || raw.name || raw.text || raw.value || raw.id || "")
      .trim()
      .toLowerCase();
  }

  return String(raw || "").trim().toLowerCase();
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

function rowHasAdjustableCategory(row) {
  return String(row?.dataset?.itemCategory || "").toLowerCase().includes("adjustable");
}

// === Load items from shared cache ===
async function loadItems() {
  try {
    if (window.nsItemFeedCache?.getItems) {
      items = await window.nsItemFeedCache.getItems({ forceRefresh: true });
    } else {
      console.warn("⚠️ nsItemFeedCache missing - falling back to direct fetch");
      const res = await fetch("/api/netsuite/items?refresh=1", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      items = data.results || [];
    }

    window.items = items;
    console.log("✅ Loaded items:", items.length, "records");
  } catch (err) {
    console.error("❌ Failed to load items:", err);
    items = [];
    window.items = [];
  }
}

async function populateSizeFilter() {
  const sizeSelect = document.getElementById("sizeFilter");
  if (!sizeSelect) return;

  // Reset dropdown
  sizeSelect.innerHTML = `<option value="">All Sizes</option>`;

  try {
    const res = await fetch("/api/netsuite/sales-order-item-size");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const results = data.results || [];

    // Extract size values (excluding “- None -”)
    const sizes = results
      .map(r => r.size)
      .filter(size => size && size.trim() !== "" && size !== "- None -");

    console.log("▶ Size list loaded fast:", sizes);

    sizes.forEach(size => {
      const opt = document.createElement("option");
      opt.value = size.toLowerCase();
      opt.textContent = size;
      sizeSelect.appendChild(opt);
    });

  } catch (err) {
    console.error("❌ Failed loading size filter:", err);
  }
}

async function populateBaseOptionFilter() {
  const baseSelect = document.getElementById("baseOptionFilter");
  if (!baseSelect) return;

  // Default option
  baseSelect.innerHTML = `<option value="">All Storage Options</option>`;

  try {
    const res = await fetch("/api/netsuite/sales-order-item-base-option");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const results = data.results || [];

    const options = results
      .map(r => r["base options"])
      .filter(o => o && o.trim() !== "" && o !== "- None -");

    console.log("▶ Base options loaded fast:", options);

    options.forEach(option => {
      const opt = document.createElement("option");
      opt.value = option.toLowerCase();
      opt.textContent = option;
      baseSelect.appendChild(opt);
    });

  } catch (err) {
    console.error("❌ Failed loading base option filter:", err);
  }
}

// === Load inventory balances (bulk) ===
async function loadInventoryBalances() {
  try {
    const res = await fetch(`/api/netsuite/inventorybalance?refresh=1&_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    window.inventoryCache = {};
    (data.results || []).forEach(row => {
      const itemId = row["Item ID"];
      if (!window.inventoryCache[itemId]) window.inventoryCache[itemId] = [];
      window.inventoryCache[itemId].push({
        location: row["Location"] || "",
        qty: parseInt(row["Available"] || 0, 10),
        bin: row["Bin Number"] || "",
        status: row["Status"] || "",
        inventoryNumber: row["Inventory Number"] || ""
      });
    });

    console.log("📦 Inventory cache loaded:", window.inventoryCache);
  } catch (err) {
    console.error("❌ Failed to load inventory balances:", err);
    window.inventoryCache = {};
  }
}

function setupWarehouseTracking() {
  const warehouseSelect = document.getElementById("warehouse");
  if (!warehouseSelect) {
    console.warn("⚠️ Warehouse select element not found");
    return;
  }
  function updateWarehouseCache() {
    window.selectedWarehouseId = warehouseSelect.value.trim();
    window.selectedWarehouseName = warehouseSelect.options[warehouseSelect.selectedIndex]?.textContent.trim() || "";
    console.log("🏭 Selected warehouse:", window.selectedWarehouseId, window.selectedWarehouseName);
  }

  // Init + attach change listener
  updateWarehouseCache();
  warehouseSelect.addEventListener("change", updateWarehouseCache);
}

// === Create global dropdown once ===
function createGlobalSuggestions() {
  globalSuggestions = document.createElement("ul");
  globalSuggestions.id = "global-suggestions";
  globalSuggestions.className = "hidden";
  document.body.appendChild(globalSuggestions);
}

// === Show dropdown ===
function showSuggestions(input, matches, lineIndex) {
  globalSuggestions.innerHTML = "";
  activeInput = input;
  activeLineIndex = lineIndex;

  if (!matches.length) return hideSuggestions();

  matches.slice(0, 50).forEach(it => {
    const li = document.createElement("li");
    li.textContent = it["Name"];
    li.addEventListener("click", () => {
      selectItem(it);
      hideSuggestions(); // ✅ ensures dropdown closes immediately
    });
    globalSuggestions.appendChild(li);
  });

  const rect = input.getBoundingClientRect();
  globalSuggestions.style.position = "fixed";
  globalSuggestions.style.left = rect.left + "px";
  globalSuggestions.style.width = rect.width + "px";

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const opensUp = spaceBelow < 220 && spaceAbove > spaceBelow;
  const availableSpace = opensUp ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(160, Math.min(320, availableSpace - 12));

  globalSuggestions.style.maxHeight = maxHeight + "px";
  globalSuggestions.style.overflowY = "auto";
  globalSuggestions.style.overscrollBehavior = "contain";
  globalSuggestions.classList.toggle("open-up", opensUp);
  globalSuggestions.classList.toggle("open-down", !opensUp);

  if (opensUp) {
    globalSuggestions.style.top = "";
    globalSuggestions.style.bottom = (window.innerHeight - rect.top) + "px";
  } else {
    globalSuggestions.style.bottom = "";
    globalSuggestions.style.top = rect.bottom + "px";
  }

  globalSuggestions.classList.remove("hidden");
}

function hideSuggestions() {
  globalSuggestions.classList.add("hidden");
  globalSuggestions.innerHTML = "";
  activeInput = null;
  activeLineIndex = null;
}

function normaliseMoneyText(value) {
  const text = String(value || "").replace(/[^\d.]/g, "");
  const firstDot = text.indexOf(".");
  if (firstDot === -1) return text;
  return text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, "");
}

function formatMoneyText(value) {
  const cleaned = normaliseMoneyText(value);
  const amount = Number(cleaned || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function bindMoneyInput(input) {
  if (!input || input.dataset.moneyInputBound === "1") return;
  input.dataset.moneyInputBound = "1";
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.pattern = "\\d*(\\.\\d*)?";

  input.addEventListener("input", () => {
    const cleaned = normaliseMoneyText(input.value);
    if (input.value !== cleaned) input.value = cleaned;
  });

  input.addEventListener("blur", () => {
    const formatted = formatMoneyText(input.value);
    if (input.value !== formatted) {
      input.value = formatted;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

/* ==========================================================
   ✅ 60 NIGHT TRIAL COLUMN HELPERS (FIXED)
   - Reuse existing 60NT cell if HTML already contains it
   - Ensure it always sits AFTER Sale Price and BEFORE Fulfilment
   - Only show dropdown on mattress rows; others show "—"
   ========================================================== */

function insertAfter(newNode, referenceNode) {
  referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

function findExisting60NTSelect(row) {
  // Common direct hooks
  let sel =
    row.querySelector("select.sixty-night-select") ||
    row.querySelector("select#60ntSelect") ||
    row.querySelector('select[name="60nt"]') ||
    row.querySelector('select[name="sixtyNightTrial"]') ||
    row.querySelector('select[name="sixty_night_trial"]');

  if (sel) return sel;

  // Fallback: detect by option values/text
  const selects = row.querySelectorAll("select");
  for (const s of selects) {
    const opts = [...s.options].map(o => (o.value || o.textContent || "").trim().toLowerCase());
    const hasYes = opts.includes("yes");
    const hasNo = opts.includes("no");
    const hasNA = opts.includes("n/a") || opts.includes("na");
    if (hasYes && hasNo && hasNA) return s;
  }

  return null;
}

function ensure60NightTrialCell(row) {
  if (!row) return null;

  // If we already have our managed cell, just reposition it correctly
  let td = row.querySelector("td.sixty-night-cell");

  // If not, try to ADOPT an existing cell/select from the hard-coded HTML
  if (!td) {
    const existingSel = findExisting60NTSelect(row);
    if (existingSel) {
      td = existingSel.closest("td");
      if (td) td.classList.add("sixty-night-cell");
      existingSel.classList.add("sixty-night-select");
    }
  }

  // If still none, create a new td
  if (!td) {
    td = document.createElement("td");
    td.className = "sixty-night-cell";
    td.innerHTML = `
      <select class="sixty-night-select">
        <option value="N/A">N/A</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
      <span class="sixty-night-placeholder">—</span>
    `;
  } else {
    // Ensure placeholder exists if adopting legacy
    if (!td.querySelector(".sixty-night-placeholder")) {
      const span = document.createElement("span");
      span.className = "sixty-night-placeholder";
      span.textContent = "—";
      td.appendChild(span);
    }
    // Ensure select has our class if adopting legacy
    const sel = td.querySelector("select");
    if (sel && !sel.classList.contains("sixty-night-select")) {
      sel.classList.add("sixty-night-select");
    }
  }

  // Default state (hidden until any mattress exists)
  td.style.display = "none";

  const sel = td.querySelector(".sixty-night-select");
  const ph = td.querySelector(".sixty-night-placeholder");
  if (sel) sel.style.display = "none";
  if (ph) ph.style.display = "inline";

  // ✅ Reposition into correct column order:
  // after Sale Price td, before Fulfilment td
  const saleTd = row.querySelector(".vat-free-cell") || row.querySelector(".item-saleprice")?.closest("td");
  const fulfilTd = row.querySelector(".fulfilment-cell");

  if (saleTd) {
    // Move td if it’s currently elsewhere in the row
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

  // Ensure each row has the cell (and is in the correct position)
  rows.forEach(r => ensure60NightTrialCell(r));

  const anyMattress = [...rows].some(
    r => (r.dataset.itemClass || "").toLowerCase() === "mattress"
  );

  header.style.display = anyMattress ? "table-cell" : "none";

  rows.forEach(r => {
    const cell = r.querySelector("td.sixty-night-cell");
    if (!cell) return;

    cell.style.display = anyMattress ? "table-cell" : "none";

    const sel = cell.querySelector(".sixty-night-select");
    const ph = cell.querySelector(".sixty-night-placeholder");
    const isMattress = (r.dataset.itemClass || "").toLowerCase() === "mattress";

    if (sel) sel.style.display = isMattress ? "inline-block" : "none";
    if (ph) ph.style.display = isMattress ? "none" : "inline";

    if (!isMattress && sel) sel.value = "N/A";
  });
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

  const saleTd = row.querySelector(".item-saleprice")?.closest("td");
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

  rows.forEach(row => ensureVatFreeCell(row));

  const anyAdjustable = [...rows].some(row => rowHasAdjustableCategory(row));
  header.style.display = anyAdjustable ? "table-cell" : "none";

  rows.forEach(row => {
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

// === Handle selection ===
async function selectItem(item) {
  if (!activeInput) return;

  const line = document.querySelector(`.order-line[data-line="${activeLineIndex}"]`);
  applyItemToRow(line, item);

  setTimeout(() => {
    const addBtn = document.getElementById("addItemBtn");
    if (addBtn) addBtn.click();
  }, 50);

  hideSuggestions();
  updateOrderSummary();
  return;

  const hiddenId = line.querySelector(".item-internal-id");
  const hiddenBase = line.querySelector(".item-baseprice");
  const discountField = line.querySelector(".item-discount");

  activeInput.value = item["Name"];
  hiddenId.value = item["Internal ID"];
  hiddenBase.value = item["Base Price"];

  const base = parseFloat(item["Base Price"] || 0);
  const retailPerUnit = (base / 100) * 120;
  discountField.value = 0;

  if (!line.setUnitRetail) setupPriceSync(line);
  line.setUnitRetail(retailPerUnit);

  const itemId = hiddenId.value;

  // ✅ Cache options from the database-backed item option map.
  const opts = getOptionSchemaForItem(itemId, item);
  window.optionsCache[itemId] = opts;

  // ✅ Handle options cell visibility
  const optCell = line.querySelector(".options-cell");
  if (optCell) {
    if (Object.keys(opts).length === 0) {
      optCell.innerHTML = "";
    } else {
      optCell.innerHTML = `
        <button type="button" class="open-options btn-secondary small-btn">Options</button>
        <input type="hidden" class="item-options-json" />
        <div class="options-summary"></div>
      `;
      optCell.querySelector(".open-options")
        .addEventListener("click", () => openOptionsWindow(line));
    }
  }

  // ✅ Handle Service class (hide fulfilment + inventory)
  const fulfilCell = line.querySelector(".fulfilment-cell");
  const fulfilSel = line.querySelector(".item-fulfilment");
  const invCell = line.querySelector(".inventory-cell");

  // ✅ Track item class on the row for global 60NT logic
  const itemClass = getItemClassText(item);
  line.dataset.itemClass = itemClass;
  line.dataset.itemCategory = getItemCategoryText(item);

  // Ensure 60NT cell is correct and update entire table column state
  ensure60NightTrialCell(line);
  updateVatFreeColumnVisibility();
  update60NightTrialColumnVisibility();

  if (item["Class"] && item["Class"].toLowerCase() === "service") {
    console.log("🧾 Service item detected – hiding fulfilment and inventory");

    // Hide fulfilment cell and dropdown
    if (fulfilCell) fulfilCell.classList.add("hidden-cell");
    if (fulfilSel) {
      fulfilSel.value = "";
      fulfilSel.style.display = "none";
    }

    // Hide inventory cell
    if (invCell) invCell.classList.add("hidden-cell");
  } else {
    console.log("📦 Non-service item – showing fulfilment and inventory");

    if (fulfilCell) fulfilCell.classList.remove("hidden-cell");
    if (fulfilSel) fulfilSel.style.display = "inline-block";

    if (invCell) invCell.classList.remove("hidden-cell");

    validateInventoryForRow(line);
  }

  // ✅ Automatically add a new empty item row when user finishes selecting this item
  setTimeout(() => {
    const addBtn = document.getElementById("addItemBtn");
    if (addBtn) addBtn.click();
  }, 50);

  hideSuggestions();

  // ✅ Recalculate summary after item is selected
  updateOrderSummary();
}

function applyItemToRow(line, item, config = {}) {
  if (!line || !item) return;

  const quantity = Math.max(1, parseInt(config.quantity || 1, 10) || 1);
  const hiddenId = line.querySelector(".item-internal-id");
  const hiddenBase = line.querySelector(".item-baseprice");
  const discountField = line.querySelector(".item-discount");
  const qtyField = line.querySelector(".item-qty");
  const salePriceField = line.querySelector(".item-saleprice");
  const textInput = line.querySelector(".item-search");

  if (textInput) textInput.value = item["Name"] || "";
  if (hiddenId) hiddenId.value = item["Internal ID"] || "";
  if (hiddenBase) hiddenBase.value = item["Base Price"] || "";
  if (qtyField) qtyField.value = String(quantity);
  if (discountField) discountField.value = "0";

  const base = parseFloat(item["Base Price"] || 0);
  const retailPerUnit = (base / 100) * 120;

  if (!line.setUnitRetail) setupPriceSync(line);
  line.setUnitRetail(retailPerUnit);

  const itemId = hiddenId?.value || "";
  const opts = getOptionSchemaForItem(itemId, item);
  window.optionsCache[itemId] = opts;

  const optCell = line.querySelector(".options-cell");
  if (optCell) {
    if (Object.keys(opts).length === 0) {
      optCell.innerHTML = "";
    } else {
      optCell.innerHTML = `
        <button type="button" class="open-options btn-secondary small-btn">Options</button>
        <input type="hidden" class="item-options-json" value="{}" />
        <div class="options-summary"></div>
      `;
      optCell.querySelector(".open-options")?.addEventListener("click", () => openOptionsWindow(line));
    }
  }

  const selections = config.optionsSelections || {};
  const optionsJsonEl = line.querySelector(".item-options-json");
  const optionsSummaryEl = line.querySelector(".options-summary");
  if (optionsJsonEl) optionsJsonEl.value = JSON.stringify(selections);
  if (optionsSummaryEl) optionsSummaryEl.innerHTML = selectionsToSummary(selections);

  setInventoryDetailForRow(line, config.inventoryDetail || "");
  line.dataset.inventoryMeta = String(config.inventoryMeta || config.inventoryDetail || "").trim();
  line.dataset.inventoryMetaJson = String(config.inventoryMetaJson || "").trim();
  line.dataset.lotnumber = String(config.lotnumber || "").trim();

  const fulfilCell = line.querySelector(".fulfilment-cell");
  const fulfilSel = line.querySelector(".item-fulfilment");
  const invCell = line.querySelector(".inventory-cell");
  const itemClass = getItemClassText(item);
  line.dataset.itemClass = itemClass;
  line.dataset.itemCategory = getItemCategoryText(item);

  ensure60NightTrialCell(line);
  updateVatFreeColumnVisibility();
  update60NightTrialColumnVisibility();

  if (itemClass === "service" || itemClass.includes("service")) {
    if (fulfilCell) fulfilCell.classList.add("hidden-cell");
    if (fulfilSel) {
      fulfilSel.value = "";
      fulfilSel.style.display = "none";
    }
    if (invCell) invCell.classList.add("hidden-cell");
  } else {
    if (fulfilCell) fulfilCell.classList.remove("hidden-cell");
    if (fulfilSel) fulfilSel.style.display = "inline-block";
    if (invCell) invCell.classList.remove("hidden-cell");
    if (fulfilSel && config.fulfilmentMethod) {
      fulfilSel.dataset.pendingValue = String(config.fulfilmentMethod);
      fulfilSel.value = String(config.fulfilmentMethod);
      fulfilSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    validateInventoryForRow(line);
    if (String(config.inventoryDetail || "").trim() && typeof window.updateInventoryCellForRow === "function") {
      window.updateInventoryCellForRow(Number(line.dataset.line || "0"));
    }
  }

  if (salePriceField && Number.isFinite(Number(config.salePrice))) {
    salePriceField.value = Number(config.salePrice).toFixed(2);
    salePriceField.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    updateOrderSummary();
  }
}

// === Convert selections to summary ===
function selectionsToSummary(selections) {
  const parts = [];
  Object.entries(selections).forEach(([field, value]) => {
    if (Array.isArray(value) && value.length > 0) {
      parts.push(`${field} : ${value.join(", ")}`);
    } else if (value) {
      parts.push(`${field} : ${value}`);
    }
  });
  return parts.join("<br>");
}

// === Sync discount/price/qty ===
function setupPriceSync(line) {
  const amountField = line.querySelector(".item-amount");
  const discountField = line.querySelector(".item-discount");
  const salePriceField = line.querySelector(".item-saleprice");
  const qtyField = line.querySelector(".item-qty");
  const vatFreeField = line.querySelector(".vat-free-checkbox");

  if (!amountField || !discountField || !salePriceField || !qtyField) return;
  bindMoneyInput(salePriceField);
  let unitRetail = 0;

  function recalc() {
    const qty = parseInt(qtyField.value || 1, 10);
    const retailTotal = unitRetail * qty;
    const priceBasis = vatFreeField?.checked ? retailTotal / 1.2 : retailTotal;
    amountField.value = retailTotal.toFixed(2);

    const discountPercent = clampPercent(discountField.value || 0);
    discountField.value = discountPercent.toFixed(1).replace(/\.0$/, "");
    const saleTotal = priceBasis * (1 - discountPercent / 100);
    salePriceField.value = saleTotal.toFixed(2);

    validateInventoryForRow(line);

    // ✅ always recalc order summary too
    updateOrderSummary();
  }

  if (amountField.dataset.unitRetail) {
    unitRetail = parseFloat(amountField.dataset.unitRetail);
    recalc();
  }

  discountField.addEventListener("input", recalc);
  salePriceField.addEventListener("input", () => {
    const qty = parseInt(qtyField.value || 1, 10);
    const retailTotal = unitRetail * qty;
    const priceBasis = vatFreeField?.checked ? retailTotal / 1.2 : retailTotal;
    const saleTotal = parseFloat(salePriceField.value || 0) || 0;
    if (priceBasis > 0 && !isNaN(saleTotal)) {
      const discountPercent = clampPercent(((priceBasis - saleTotal) / priceBasis) * 100);
      discountField.value = discountPercent.toFixed(1).replace(/\.0$/, "");
    } else {
      discountField.value = "0";
    }
    validateInventoryForRow(line);
    updateOrderSummary();
  });
  qtyField.addEventListener("input", recalc);
  vatFreeField?.addEventListener("change", recalc);

  line.setUnitRetail = (retail) => {
    unitRetail = parseFloat(retail || 0);
    amountField.dataset.unitRetail = unitRetail;
    recalc();
  };
}

function setupAutocomplete(lineIndex) {
  const input = document.getElementById(`itemSearch-${lineIndex}`);
  if (!input) return;

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    if (!query) return hideSuggestions();

    const selectedSize = (document.getElementById("sizeFilter")?.value || "").toLowerCase();
    const selectedBaseOption = (document.getElementById("baseOptionFilter")?.value || "").toLowerCase();
    const selectedType = (document.getElementById("typeFilter")?.value || "").toLowerCase();

    const matches = items.filter(it => {
      const name = it["Name"].toLowerCase();
      const nameMatch = name.includes(query);

      const sizeMatch = (() => {
        if (selectedSize === "") return true;

        if (selectedSize === "double") {
          return name.includes("double") && !name.includes("small double");
        }

        if (selectedSize === "king") {
          return (
            (name.includes(" king") || name.startsWith("king") || name.includes("(king")) &&
            !name.includes("super king") &&
            !name.includes("zip and link") &&
            !name.includes("zip & link")
          );
        }

        if (selectedSize === "single") {
          return (
            (name.includes(" single") || name.startsWith("single") || name.includes("(single")) &&
            !name.includes("small single") &&
            !name.includes("euro single")
          );
        }

        const pattern = new RegExp(`\\b${selectedSize}\\b`, "i");
        return pattern.test(name);
      })();

      const baseMatch = (() => {
        if (selectedBaseOption === "") return true;
        const cleanName = name.replace(/[^a-z0-9 ]/g, "");
        return cleanName.includes(selectedBaseOption);
      })();

      const typeMatch = (() => {
        const cls = (it["Class"] || "").toLowerCase();
        if (selectedType === "") return true;
        if (selectedType === "services") return cls === "service";
        if (selectedType === "items") return cls !== "service";
        return true;
      })();

      return nameMatch && sizeMatch && baseMatch && typeMatch;
    });

    showSuggestions(input, matches, lineIndex);
  });
}

// === Fulfilment methods ===
let fulfilmentMethodsCache = [];
let fulfilmentLoaded = false;

async function loadFulfilmentMethods() {
  try {
    const res = await fetch(`/api/netsuite/fulfilmentmethods?refresh=1&_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fulfilmentMethodsCache = (data.results || []).filter((opt) => {
      const id = String(opt["Internal ID"] || "").trim();
      const name = String(opt["Name"] || "").trim();
      return id && name && name !== ".";
    });
    fulfilmentLoaded = true;
    document.querySelectorAll("select.item-fulfilment").forEach(sel => fillFulfilmentSelect(sel));
  } catch (err) {
    console.error("❌ Failed to load fulfilment methods:", err);
  }
}

function fillFulfilmentSelect(select) {
  if (!select) return;
  const pendingValue = String(select.dataset.pendingValue || select.value || "").trim();
  select.innerHTML = '<option value="">Select fulfilment method...</option>';
  fulfilmentMethodsCache.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt["Internal ID"];
    option.textContent = opt["Name"];
    select.appendChild(option);
  });
  if (pendingValue) {
    select.value = pendingValue;
    if (select.value === pendingValue) delete select.dataset.pendingValue;
  }
}

// === Inventory validation ===
function validateInventoryForRow(row) {
  const button = row.querySelector(".open-inventory");
  const detailField = row.querySelector(".item-inv-detail");
  const fulfilSel = row.querySelector(".item-fulfilment");
  const invSummary = row.querySelector(".inv-summary");
  if (!button || !detailField || !fulfilSel) return;

  const fulfilmentText = fulfilSel.options[fulfilSel.selectedIndex]?.textContent?.trim().toLowerCase() || "";
  const allowedFulfilments = ["in store", "warehouse", "fulfil from store"];

  if (!allowedFulfilments.includes(fulfilmentText)) {
    button.style.display = "none";
    if (invSummary) invSummary.style.display = "none";
    return;
  }

  button.style.display = "inline-block";
  if (invSummary) invSummary.style.display = "inline-block";

  const qty = parseInt(row.querySelector(".item-qty")?.value, 10) || 0;
  if (detailField.value) {
    const totalSelected = detailField.value
      .split(";")
      .map(p => parseInt(p.trim().split(" ")[0], 10) || 0)
      .reduce((a, b) => a + b, 0);
    button.textContent = totalSelected === qty ? "✅" : "📦";
  } else {
    button.textContent = "📦";
  }
}

// === Popup windows ===
async function openOptionsWindow(row) {
  const itemId = row.querySelector(".item-internal-id")?.value;
  if (!itemId) return alert("⚠️ Please select an item first.");

  window.optionsCache = window.optionsCache || {};

  const dbSchema = await window.itemOptionsCache?.getOptionsForItem?.(itemId).catch(() => ({})) || {};
  if (Object.keys(dbSchema).length) {
    window.optionsCache[itemId] = dbSchema;
  } else if (!window.optionsCache[itemId]) {
    window.optionsCache[itemId] = {};
  }

  const existingSelections = row.querySelector(".item-options-json")?.value || "{}";
  const url = `/options.html?itemId=${encodeURIComponent(itemId)}&selections=${encodeURIComponent(existingSelections)}`;
  const win = window.open(url, "ItemOptions", "width=600,height=500,resizable=yes,scrollbars=yes");
  win.focus();
}

function openInventoryWindow(row) {
  const itemId = row.querySelector(".item-internal-id")?.value;
  const qty = row.querySelector(".item-qty")?.value || 0;
  const existing = row.querySelector(".item-inv-detail")?.value || "";
  const url = `/inventory.html?itemId=${encodeURIComponent(itemId)}&qty=${qty}&detail=${encodeURIComponent(existing)}`;
  const win = window.open(url, "InventoryDetail", "width=900,height=600,resizable=yes,scrollbars=yes");
  win.focus();
}

// === Callbacks from popup ===
window.onOptionsSaved = function(itemId, selections) {
  const row = document.querySelector(`.order-line .item-internal-id[value="${itemId}"]`)?.closest(".order-line");
  if (!row) return;
  row.querySelector(".item-options-json").value = JSON.stringify(selections);
  row.querySelector(".options-summary").innerHTML = selectionsToSummary(selections);
};

window.onInventorySaved = function (itemId, detailString, lineIndex) {
  const rows = document.querySelectorAll("#orderItemsBody .order-line");
  const row = rows[lineIndex];
  if (!row) return;

  window.updateInventoryCellForRow(lineIndex);
  validateInventoryForRow(row);
  updateOrderSummary();
};

// === Add new row ===
function addNewRow() {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody) return;

  const newLine = lineCounter++;
  const tr = document.createElement("tr");
  tr.className = "order-line";
  tr.setAttribute("data-line", newLine);

  // ✅ IMPORTANT: 60NT td is now in the template, in the RIGHT position
  tr.innerHTML = `
<td>
  <div class="autocomplete">
    <input type="text" id="itemSearch-${newLine}" class="item-search" placeholder="Product name"
      autocomplete="off" aria-autocomplete="list" />
    <input type="hidden" class="item-internal-id" />
    <input type="hidden" class="item-baseprice" />
  </div>
</td>
<td class="options-cell"></td>
<td><input type="number" class="item-qty" value="1" min="1" step="1" /></td>
<td><input type="number" class="item-amount" placeholder="£" step="0.01" readonly /></td>
<td><input type="number" class="item-discount" value="0" min="0" max="100" step="0.1" /></td>
<td><input type="text" class="item-saleprice" placeholder="£" inputmode="decimal" autocomplete="off" /></td>

<td class="vat-free-cell" style="display:none;">
  <input type="checkbox" class="vat-free-checkbox" aria-label="Vat Free" style="display:none;" />
  <span class="vat-free-placeholder"></span>
</td>

<td class="sixty-night-cell" style="display:none;">
  <select class="sixty-night-select" style="display:none;">
    <option value="N/A">N/A</option>
    <option value="Yes">Yes</option>
    <option value="No">No</option>
  </select>
  <span class="sixty-night-placeholder">—</span>
</td>

<td class="fulfilment-cell">
  <select name="fulfilmentMethod" class="item-fulfilment">
    <option value="">Loading fulfilment methods...</option>
  </select>
</td>
<td class="inventory-cell">
  <button type="button" class="open-inventory btn-secondary small-btn">📦</button>
  <input type="hidden" class="item-inv-detail" />
  <span class="inv-summary"></span>
</td>
<td><button type="button" class="delete-row">🗑</button></td>
  `;

  tbody.appendChild(tr);

  // ✅ Ensure correct position + adopt legacy if needed (belt & braces)
  ensure60NightTrialCell(tr);
  updateVatFreeColumnVisibility();
  update60NightTrialColumnVisibility();

  setupAutocomplete(newLine);
  setupPriceSync(tr);

  const fulfilSel = tr.querySelector(".item-fulfilment");
  if (fulfilmentLoaded) {
    fillFulfilmentSelect(fulfilSel);
  } else {
    const observer = setInterval(() => {
      if (fulfilmentLoaded) {
        fillFulfilmentSelect(fulfilSel);
        clearInterval(observer);
      }
    }, 200);
  }

  tr.querySelector(".delete-row").addEventListener("click", () => {
    tr.remove();
    updateOrderSummary();
    updateVatFreeColumnVisibility();
    update60NightTrialColumnVisibility(); // ✅ if a mattress row was removed
  });

  fulfilSel.addEventListener("change", () => {
    validateInventoryForRow(tr);
    updateOrderSummary();
  });

  updateOrderSummary();
}

// === Init ===
document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([
    loadItems(),
    window.itemOptionsCache?.getAll?.().catch((err) => {
      console.warn("⚠️ Failed to preload item options:", err.message);
      return {};
    }),
  ]);
  populateSizeFilter();
  populateBaseOptionFilter();
  await loadInventoryBalances();
  createGlobalSuggestions();
  setupAutocomplete(0);

  setupWarehouseTracking();

  // 🔧 Handle the hard-coded first row (line 0)
  const firstRow = document.querySelector(`.order-line[data-line="0"]`);
  if (firstRow) {
    setupPriceSync(firstRow);

    // ✅ Ensure the first row's 60NT cell is adopted/repositioned (prevents duplicate columns)
    ensure60NightTrialCell(firstRow);
    ensureVatFreeCell(firstRow);
    updateVatFreeColumnVisibility();
    update60NightTrialColumnVisibility();

    const invCell =
      firstRow.querySelector(".inventory-cell") ||
      firstRow.querySelector("td:nth-child(9)");

    if (invCell && !invCell.querySelector(".open-inventory")) {
      invCell.innerHTML = `
        <button type="button" class="open-inventory btn-secondary small-btn">📦</button>
        <input type="hidden" class="item-inv-detail" />
        <span class="inv-summary"></span>
      `;
    }

    const firstFulfilSel = firstRow.querySelector(".item-fulfilment");
    if (firstFulfilSel) {
      firstFulfilSel.addEventListener("change", () => validateInventoryForRow(firstRow));
    }

    validateInventoryForRow(firstRow);
  }

  await loadFulfilmentMethods();

  const addBtn = document.getElementById("addItemBtn");
  if (addBtn) addBtn.addEventListener("click", addNewRow);
});

// =====================================================
// NEW: Update inventory UI after modal save (LOT + META)
// =====================================================
window.updateInventoryCellForRow = function (lineIndex) {
  const rows = document.querySelectorAll("#orderItemsBody .order-line");
  const row = rows[lineIndex];
  if (!row) return;

  const lot = row.dataset.lotnumber || "";
  const meta = row.dataset.inventoryMeta || "";

  const cell = row.querySelector(".inventory-cell");
  if (!cell) return;

  if (lot) {
    cell.innerHTML = `
      <strong>Lot:</strong> ${lot}<br>
      <small>ID: ${lot}</small>
    `;
    return;
  }

  if (meta) {
    const display = meta.split(";").map(part => {
      const [qty, locName, , , , invName] = part.split("|");
      return `${qty}× ${invName || ""} @ ${locName || ""}`;
    }).join("<br>");

    cell.innerHTML = display;
    return;
  }

  cell.textContent = "—";
};
