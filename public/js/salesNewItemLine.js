let items = [];
let globalSuggestions;
let activeInput, activeLineIndex;
let lineCounter = 1;

// ✅ Global caches so popup windows can see them
window.optionsCache = {};   // itemId -> options payload
window.inventoryCache = {}; // itemId -> [{location, qty, bin, status, inventoryNumber}, ...]
window.selectedWarehouse = ""; // order header warehouse

// === Load items from proxy ===
async function loadItems() {
  try {
    const res = await fetch("/api/netsuite/items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items = data.results || [];
    console.log("✅ Loaded items:", items.length, "records");
  } catch (err) {
    console.error("❌ Failed to load items:", err);
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

  // ✅ Cache options
  const opts = {};
  Object.entries(item).forEach(([key, val]) => {
    if (key.toLowerCase().startsWith("option :")) {
      const fieldName = key.replace(/^option\s*:\s*/i, "").trim();
      const values = val ? val.split(",").map(v => v.trim()).filter(v => v) : [];
      if (values.length > 0) {
        opts[fieldName] = values;
      }
    }
  });
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
// ✅ Handle Service class (hide fulfilment + inventory)
const fulfilCell = line.querySelector(".fulfilment-cell");
const fulfilSel = line.querySelector(".item-fulfilment");
const invCell = line.querySelector(".inventory-cell");

if (item["Class"] && item["Class"].toLowerCase() === "service") {
  console.log("🧾 Service item detected – hiding fulfilment and inventory");

  // Hide fulfilment cell and dropdown
  if (fulfilCell) fulfilCell.classList.add("hidden-cell");
  if (fulfilSel) {
    fulfilSel.value = ""; // reset selection
    fulfilSel.style.display = "none"; // hide the dropdown itself
  }

  // Hide inventory cell
  if (invCell) invCell.classList.add("hidden-cell");
} else {
  console.log("📦 Non-service item – showing fulfilment and inventory");

  // Show fulfilment cell and dropdown again
  if (fulfilCell) fulfilCell.classList.remove("hidden-cell");
  if (fulfilSel) fulfilSel.style.display = "inline-block";

  // Show inventory cell
  if (invCell) invCell.classList.remove("hidden-cell");

  // Re-validate inventory for visible lines
  validateInventoryForRow(line);
}


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

// === Hide autocomplete ===
function hideSuggestions() {
  globalSuggestions.classList.add("hidden");
  globalSuggestions.innerHTML = "";
  activeInput = null;
  activeLineIndex = null;
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
    updateOrderSummary(); // ✅ recalc after manual sale price edit
  });
  qtyField.addEventListener("input", recalc);

  line.setUnitRetail = (retail) => {
    unitRetail = parseFloat(retail || 0);
    amountField.dataset.unitRetail = unitRetail;
    recalc();
  };
}

// === Autocomplete attach ===
function setupAutocomplete(lineIndex) {
  const input = document.getElementById(`itemSearch-${lineIndex}`);
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    if (!query) return hideSuggestions();
    const matches = items.filter(it => it["Name"].toLowerCase().includes(query)).slice(0, 10);
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

  // ✅ Show inventory detail only for these fulfilment methods
  const allowedFulfilments = ["in store", "warehouse", "fulfil from store"];

  if (!allowedFulfilments.includes(fulfilmentText)) {
    button.style.display = "none";
    if (invSummary) invSummary.style.display = "none";
    return;
  }

  // ✅ Otherwise, show inventory button + summary
  button.style.display = "inline-block";
  if (invSummary) invSummary.style.display = "inline-block";

  // ✅ Update status based on selected quantity
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
function openOptionsWindow(row) {
  const itemId = row.querySelector(".item-internal-id")?.value;
  if (!itemId) return alert("⚠️ Please select an item first.");
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

window.onInventorySaved = function(itemId, detail) {
  const row = document.querySelector(`.order-line .item-internal-id[value="${itemId}"]`)?.closest(".order-line");
  if (!row) {
    console.warn("❌ Could not find row for itemId", itemId);
    return;
  }

  const detailField = row.querySelector(".item-inv-detail");
  const button = row.querySelector(".open-inventory");
  const summary = row.querySelector(".inv-summary");

  detailField.value = detail;
  button.textContent = detail ? "✅" : "📦";
  summary.innerHTML = detail.replace(/;/g, "<br>");
};

// === Add new row ===
function addNewRow() {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody) return;

  const newLine = lineCounter++;
  const tr = document.createElement("tr");
  tr.className = "order-line";
  tr.setAttribute("data-line", newLine);

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

  // Setup logic for new row
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

  // Hook up inventory button
  tr.querySelector(".open-inventory").addEventListener("click", () => openInventoryWindow(tr));

  // Delete row button
  tr.querySelector(".delete-row").addEventListener("click", () => {
    tr.remove();
    updateOrderSummary(); // ✅ recalc after row removal
  });

  // Fulfilment change
  fulfilSel.addEventListener("change", () => {
    validateInventoryForRow(tr);
    updateOrderSummary(); // ✅ recalc after fulfilment change
  });

  // ✅ Recalculate summary immediately after adding row
  updateOrderSummary();
}




// === Init ===
document.addEventListener("DOMContentLoaded", async () => {
  await loadItems();
  await loadInventoryBalances();
  createGlobalSuggestions();
  setupAutocomplete(0);

  // Track warehouse dropdown from order header
  setupWarehouseTracking();

  // 🔧 Handle the hard-coded first row (line 0)
  const firstRow = document.querySelector(`.order-line[data-line="0"]`);
  if (firstRow) {
    setupPriceSync(firstRow);

    // Ensure inventory cell has button + hidden field + summary
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

    // Wire up events
    const firstInvBtn = firstRow.querySelector(".open-inventory");
    if (firstInvBtn) {
      firstInvBtn.addEventListener("click", () => openInventoryWindow(firstRow));
    }

    const firstFulfilSel = firstRow.querySelector(".item-fulfilment");
    if (firstFulfilSel) {
      firstFulfilSel.addEventListener("change", () => validateInventoryForRow(firstRow));
    }

    // ✅ Make sure button is visible unless fulfilment = Special Order
    validateInventoryForRow(firstRow);
  }

  await loadFulfilmentMethods();

  const addBtn = document.getElementById("addItemBtn");
  if (addBtn) addBtn.addEventListener("click", addNewRow);
});
