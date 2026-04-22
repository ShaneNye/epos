let items = [];
let globalSuggestions;
let activeInput, activeLineIndex;
let lineCounter = 1;

// ✅ Global caches so popup windows can see them
window.optionsCache = {};   // itemId -> options payload
window.inventoryCache = {}; // itemId -> [{location, qty, bin, status, inventoryNumber}, ...]
window.selectedWarehouse = ""; // order header warehouse

function buildLegacyOptionSchemaFromItem(item) {
  const opts = {};
  Object.entries(item || {}).forEach(([key, val]) => {
    if (!String(key).toLowerCase().startsWith("option :")) return;

    const fieldName = String(key).replace(/^option\s*:\s*/i, "").trim();
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

// === Load items from shared cache ===
async function loadItems() {
  try {
    if (window.nsItemFeedCache?.getItems) {
      items = await window.nsItemFeedCache.getItems();
    } else {
      console.warn("⚠️ nsItemFeedCache missing - falling back to direct fetch");
      const res = await fetch("/api/netsuite/items");
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
    const res = await fetch("/api/netsuite/inventorybalance");
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

  matches.forEach(it => {
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
  if (spaceBelow < 200 && spaceAbove > spaceBelow) {
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
  const saleTd = row.querySelector(".item-saleprice")?.closest("td");
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

// === Handle selection ===
async function selectItem(item) {
  if (!activeInput) return;

  const line = document.querySelector(`.order-line[data-line="${activeLineIndex}"]`);
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
        <button type="button" class="open-options btn-secondary small-btn">⚙️ Options</button>
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
  const itemClass = (item["Class"] || "").toLowerCase();
  line.dataset.itemClass = itemClass;

  // Ensure 60NT cell is correct and update entire table column state
  ensure60NightTrialCell(line);
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

  if (!amountField || !discountField || !salePriceField || !qtyField) return;
  let unitRetail = 0;

  function recalc() {
    const qty = parseInt(qtyField.value || 1, 10);
    const retailTotal = unitRetail * qty;
    amountField.value = retailTotal.toFixed(2);

    const discount = parseFloat(discountField.value || 0);
    const saleTotal = retailTotal * (1 - discount / 100);
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
    const saleTotal = parseFloat(salePriceField.value || 0);
    if (retailTotal > 0 && !isNaN(saleTotal)) {
      const discount = ((retailTotal - saleTotal) / retailTotal) * 100;
      discountField.value = discount.toFixed(1);
    }
    updateOrderSummary();
  });
  qtyField.addEventListener("input", recalc);

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
    const res = await fetch("/api/netsuite/fulfilmentmethods");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    fulfilmentMethodsCache = data.results || [];
    fulfilmentLoaded = true;
    document.querySelectorAll("select.item-fulfilment").forEach(sel => fillFulfilmentSelect(sel));
  } catch (err) {
    console.error("❌ Failed to load fulfilment methods:", err);
  }
}

function fillFulfilmentSelect(select) {
  if (!select) return;
  select.innerHTML = '<option value="">Select fulfilment method...</option>';
  fulfilmentMethodsCache.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt["Internal ID"];
    option.textContent = opt["Name"];
    select.appendChild(option);
  });
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

  if (!window.optionsCache?.[itemId] || !Object.keys(window.optionsCache[itemId]).length) {
    window.optionsCache = window.optionsCache || {};
    window.optionsCache[itemId] =
      await window.itemOptionsCache?.getOptionsForItem?.(itemId).catch(() => ({})) || {};
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
<td><input type="number" class="item-saleprice" placeholder="£" step="0.01" /></td>

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

  tr.querySelector(".open-inventory").addEventListener("click", () => openInventoryWindow(tr));

  tr.querySelector(".delete-row").addEventListener("click", () => {
    tr.remove();
    updateOrderSummary();
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
    update60NightTrialColumnVisibility();

    const invCell =
      firstRow.querySelector(".inventory-cell") ||
      firstRow.querySelector("td:nth-child(8)");

    if (invCell && !invCell.querySelector(".open-inventory")) {
      invCell.innerHTML = `
        <button type="button" class="open-inventory btn-secondary small-btn">📦</button>
        <input type="hidden" class="item-inv-detail" />
        <span class="inv-summary"></span>
      `;
    }

    const firstInvBtn = firstRow.querySelector(".open-inventory");
    if (firstInvBtn) {
      firstInvBtn.addEventListener("click", () => openInventoryWindow(firstRow));
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
