let items = [];
let globalSuggestions;
let activeInput, activeLineIndex;
let lineCounter = 1;

// ✅ Global cache so popup windows can see them
window.optionsCache = {};   // itemId -> options payload

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
      hideSuggestions();
    });
    globalSuggestions.appendChild(li);
  });

  const rect = input.getBoundingClientRect();
  globalSuggestions.style.position = "fixed";
  globalSuggestions.style.left = rect.left + "px";
  globalSuggestions.style.width = rect.width + "px";
  globalSuggestions.style.top = rect.bottom + "px";
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

  hideSuggestions();
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

// === Popup windows ===
function openOptionsWindow(row) {
  const itemId = row.querySelector(".item-internal-id")?.value;
  if (!itemId) return alert("⚠️ Please select an item first.");
  const existingSelections = row.querySelector(".item-options-json")?.value || "{}";
  const url = `/options.html?itemId=${encodeURIComponent(itemId)}&selections=${encodeURIComponent(existingSelections)}`;
  const win = window.open(url, "ItemOptions", "width=600,height=500,resizable=yes,scrollbars=yes");
  win.focus();
}

// === Callbacks from popup ===
window.onOptionsSaved = function(itemId, selections) {
  const row = document.querySelector(`.order-line .item-internal-id[value="${itemId}"]`)?.closest(".order-line");
  if (!row) return;
  row.querySelector(".item-options-json").value = JSON.stringify(selections);
  row.querySelector(".options-summary").innerHTML = selectionsToSummary(selections);
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
<td><button type="button" class="delete-row">🗑</button></td>
  `;

  tbody.appendChild(tr);

  // Setup logic for new row
  setupAutocomplete(newLine);
  setupPriceSync(tr);

  // Delete row button
  tr.querySelector(".delete-row").addEventListener("click", () => {
    tr.remove();
    updateOrderSummary();
  });

  updateOrderSummary();
}

// === Init ===
document.addEventListener("DOMContentLoaded", async () => {
  await loadItems();
  createGlobalSuggestions();
  setupAutocomplete(0);

  // 🔧 Handle the hard-coded first row (line 0)
  const firstRow = document.querySelector(`.order-line[data-line="0"]`);
  if (firstRow) setupPriceSync(firstRow);

  const addBtn = document.getElementById("addItemBtn");
  if (addBtn) addBtn.addEventListener("click", addNewRow);
});
