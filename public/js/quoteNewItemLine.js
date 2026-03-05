// public/js/quoteNewItemLine.js
console.log("✅ quoteNewItemLine.js loaded");

let items = [];
let globalSuggestions;
let activeInput, activeLineIndex;
let lineCounter = 1;

// ✅ Global cache so popup windows can see them
window.optionsCache = {}; // itemId -> options payload

/* =========================================================
   Helpers: safely trigger quote totals
========================================================= */
function recalcTotals() {
  if (typeof window.updateQuoteSummary === "function") return window.updateQuoteSummary();
  if (typeof window.updateOrderSummary === "function") return window.updateOrderSummary();
}

/* =========================================================
   Load items from proxy
========================================================= */
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

/* =========================================================
   Filters (match SalesNew)
========================================================= */
async function populateSizeFilter() {
  const sizeSelect = document.getElementById("sizeFilter");
  if (!sizeSelect) return;

  sizeSelect.innerHTML = `<option value="">All Sizes</option>`;

  try {
    const res = await fetch("/api/netsuite/sales-order-item-size");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = data.results || [];

    const sizes = results
      .map((r) => r.size)
      .filter((s) => s && s.trim() !== "" && s !== "- None -");

    sizes.forEach((size) => {
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

  baseSelect.innerHTML = `<option value="">All Storage Options</option>`;

  try {
    const res = await fetch("/api/netsuite/sales-order-item-base-option");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const results = data.results || [];

    const options = results
      .map((r) => r["base options"])
      .filter((o) => o && o.trim() !== "" && o !== "- None -");

    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.toLowerCase();
      opt.textContent = option;
      baseSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Failed loading base option filter:", err);
  }
}

/* =========================================================
   Global dropdown (single instance)
========================================================= */
function createGlobalSuggestions() {
  globalSuggestions = document.createElement("ul");
  globalSuggestions.id = "global-suggestions";
  globalSuggestions.className = "hidden";
  document.body.appendChild(globalSuggestions);
}

function showSuggestions(input, matches, lineIndex) {
  globalSuggestions.innerHTML = "";
  activeInput = input;
  activeLineIndex = lineIndex;

  if (!matches.length) return hideSuggestions();

  matches.forEach((it) => {
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

  // Smart position like SalesNew (flip above if no space)
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  if (spaceBelow < 200 && spaceAbove > spaceBelow) {
    globalSuggestions.style.top = "";
    globalSuggestions.style.bottom = window.innerHeight - rect.top + "px";
  } else {
    globalSuggestions.style.bottom = "";
    globalSuggestions.style.top = rect.bottom + "px";
  }

  globalSuggestions.classList.remove("hidden");
}

function hideSuggestions() {
  if (!globalSuggestions) return;
  globalSuggestions.classList.add("hidden");
  globalSuggestions.innerHTML = "";
  activeInput = null;
  activeLineIndex = null;
}

/* =========================================================
   60 Night Trial column helpers (kept; NOT fulfilment/inventory)
========================================================= */
function insertAfter(newNode, referenceNode) {
  referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
}

// ✅ safe querySelector wrapper (prevents crashes on invalid selectors)
function safeQuery(row, selector) {
  try {
    return row.querySelector(selector);
  } catch (err) {
    console.warn("⚠️ Invalid selector skipped:", selector, err);
    return null;
  }
}

function findExisting60NTSelect(row) {
  // Try known selectors safely (won't crash if one is malformed)
  const selectors = [
    "select.sixty-night-select",
    "#60ntSelect", // safer than "select#60ntSelect"
    'select[name="60nt"]',
    'select[name="sixtyNightTrial"]',
    'select[name="sixty_night_trial"]',
  ];

  for (const sel of selectors) {
    const el = safeQuery(row, sel);
    if (el) return el;
  }

  // Fallback: infer by option values
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

function ensure60NightTrialCell(row) {
  if (!row) return null;

  let td = row.querySelector("td.sixty-night-cell");

  // adopt legacy if present
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
        <option value="N/A">N/A</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
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

  // default hidden until any mattress exists
  td.style.display = "none";

  const sel = td.querySelector(".sixty-night-select");
  const ph = td.querySelector(".sixty-night-placeholder");
  if (sel) sel.style.display = "none";
  if (ph) ph.style.display = "inline";

  // ✅ position after Sale Price (quotes may not have fulfilment col)
  const saleTd = row.querySelector(".item-saleprice")?.closest("td");
  if (saleTd) {
    if (td.parentNode === row) td.remove();
    insertAfter(td, saleTd);
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

  const anyMattress = [...rows].some(
    (r) => (r.dataset.itemClass || "").toLowerCase() === "mattress"
  );

  header.style.display = anyMattress ? "table-cell" : "none";

  rows.forEach((r) => {
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

/* =========================================================
   Options popup (same as your current)
========================================================= */
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

function openOptionsWindow(row) {
  const itemId = row.querySelector(".item-internal-id")?.value;
  if (!itemId) return alert("⚠️ Please select an item first.");

  const existingSelections = row.querySelector(".item-options-json")?.value || "{}";

  const url = `/options.html?itemId=${encodeURIComponent(itemId)}&selections=${encodeURIComponent(
    existingSelections
  )}`;

  const win = window.open(url, "ItemOptions", "width=600,height=500,resizable=yes,scrollbars=yes");
  win?.focus();
}

window.onOptionsSaved = function (itemId, selections) {
  const row = document
    .querySelector(`.order-line .item-internal-id[value="${itemId}"]`)
    ?.closest(".order-line");
  if (!row) return;

  const jsonEl = row.querySelector(".item-options-json");
  const sumEl = row.querySelector(".options-summary");

  if (jsonEl) jsonEl.value = JSON.stringify(selections);
  if (sumEl) sumEl.innerHTML = selectionsToSummary(selections);

  recalcTotals();
};

/* =========================================================
   Price sync (match SalesNew minus inventory calls)
========================================================= */
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

    recalcTotals();
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

    recalcTotals();
  });

  qtyField.addEventListener("input", recalc);

  line.setUnitRetail = (retail) => {
    unitRetail = parseFloat(retail || 0);
    amountField.dataset.unitRetail = unitRetail;
    recalc();
  };
}

/* =========================================================
   Autocomplete attach (match SalesNew filtering behaviour)
========================================================= */
function setupAutocomplete(lineIndex) {
  const input = document.getElementById(`itemSearch-${lineIndex}`);
  if (!input) return;

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    if (!query) return hideSuggestions();

    const selectedSize = (document.getElementById("sizeFilter")?.value || "").toLowerCase();
    const selectedBaseOption = (document.getElementById("baseOptionFilter")?.value || "").toLowerCase();
    const selectedType = (document.getElementById("typeFilter")?.value || "").toLowerCase();

    const matches = items
      .filter((it) => {
        const name = (it["Name"] || "").toLowerCase();
        if (!name.includes(query)) return false;

        const sizeMatch = (() => {
          if (selectedSize === "") return true;

          if (selectedSize === "double") return name.includes("double") && !name.includes("small double");

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

          return name.includes(selectedSize);
        })();

        if (!sizeMatch) return false;

        if (selectedBaseOption) {
          const baseOpt = (it["Base Option"] || it["Base Options"] || it["base options"] || "")
            .toString()
            .toLowerCase();
          const baseOk = baseOpt.includes(selectedBaseOption) || name.includes(selectedBaseOption);
          if (!baseOk) return false;
        }

        if (selectedType) {
          const cls = (it["Class"] || "").toString().toLowerCase();
          const typ = (it["Type"] || "").toString().toLowerCase();
          const ok = cls.includes(selectedType) || typ.includes(selectedType) || name.includes(selectedType);
          if (!ok) return false;
        }

        return true;
      })
      .slice(0, 10);

    showSuggestions(input, matches, lineIndex);
  });

  input.addEventListener("blur", () => setTimeout(hideSuggestions, 120));
}

/* =========================================================
   Ensure there's always a blank row ready (robust)
========================================================= */
function ensureNextEmptyRowAndFocus() {
  const rows = [...document.querySelectorAll("#orderItemsBody .order-line")];

  // empty = any row not marked as having an item yet
  const hasEmpty = rows.some((r) => (r.dataset.hasItem || "0") !== "1");

  if (!hasEmpty) addNewRow();

  const updatedRows = [...document.querySelectorAll("#orderItemsBody .order-line")];
  const emptyRow = updatedRows.find((r) => (r.dataset.hasItem || "0") !== "1");

  const input = emptyRow?.querySelector(".item-search");
  if (input) {
    input.focus();
    input.select?.();
  }
}

/* =========================================================
   Select item (match SalesNew minus fulfilment/inventory)
========================================================= */
async function selectItem(item) {
  if (!activeInput) return;

  const line = document.querySelector(`.order-line[data-line="${activeLineIndex}"]`);
  if (!line) return;

  const hiddenId = line.querySelector(".item-internal-id");
  const hiddenBase = line.querySelector(".item-baseprice");
  const discountField = line.querySelector(".item-discount");

  activeInput.value = item["Name"] || "";

  // ✅ Internal ID mapping (handles payload differences)
  const internalId =
    item["Internal ID"] ??
    item["InternalId"] ??
    item["InternalID"] ??
    item["internalid"] ??
    item["internal id"] ??
    item["Id"] ??
    item["id"] ??
    "";

  if (hiddenId) hiddenId.value = (internalId || "").toString();
  if (hiddenBase) hiddenBase.value = item["Base Price"] || "";

  const base = parseFloat(item["Base Price"] || 0);
  const retailPerUnit = (base / 100) * 120;
  if (discountField) discountField.value = 0;

  if (!line.setUnitRetail) setupPriceSync(line);
  if (line.setUnitRetail) line.setUnitRetail(retailPerUnit);

  // ✅ Mark this row as filled (drives auto-new-line)
  line.dataset.hasItem = "1";

  const itemId = (hiddenId?.value || "").trim();

  // Track item class for 60NT logic
  const itemClass = (item["Class"] || "").toLowerCase();
  line.dataset.itemClass = itemClass;

  // Ensure 60NT cell is correct and update entire table column state
  ensure60NightTrialCell(line);
  update60NightTrialColumnVisibility();

  // ✅ Cache options from item payload ("Option : X")
  const opts = {};
  Object.entries(item).forEach(([key, val]) => {
    if (key.toLowerCase().startsWith("option :")) {
      const fieldName = key.replace(/^option\s*:\s*/i, "").trim();
      const values = val
        ? val
            .split(",")
            .map((v) => v.trim())
            .filter((v) => v)
        : [];
      if (values.length > 0) opts[fieldName] = values;
    }
  });
  if (itemId) window.optionsCache[itemId] = opts;

  // Options cell visibility
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
      optCell.querySelector(".open-options")?.addEventListener("click", () => openOptionsWindow(line));
    }
  }

  // ✅ Ensure a blank row exists immediately after selecting
  setTimeout(() => ensureNextEmptyRowAndFocus(), 0);

  hideSuggestions();
  recalcTotals();
}

/* =========================================================
   Add new row (quote version: no fulfilment, no inventory)
========================================================= */
function addNewRow() {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody) return;

  const newLine = lineCounter++;
  const tr = document.createElement("tr");
  tr.className = "order-line";
  tr.setAttribute("data-line", newLine);

  // mark as empty until selected
  tr.dataset.hasItem = "0";

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

    <!-- 60NT cell is injected/repositioned dynamically when needed -->

    <td><button type="button" class="delete-row">🗑</button></td>
  `;

  tbody.appendChild(tr);

  ensure60NightTrialCell(tr);
  update60NightTrialColumnVisibility();

  setupAutocomplete(newLine);
  setupPriceSync(tr);

  tr.querySelector(".delete-row")?.addEventListener("click", () => {
    tr.remove();
    update60NightTrialColumnVisibility();
    recalcTotals();
  });

  recalcTotals();
}

/* =========================================================
   Init (match SalesNew timing, quote-safe)
========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  await loadItems();
  populateSizeFilter();
  populateBaseOptionFilter();

  createGlobalSuggestions();

  // 🔧 Derive lineCounter from DOM (prevents duplicates)
  const existingLines = [...document.querySelectorAll("#orderItemsBody .order-line")]
    .map((r) => parseInt(r.getAttribute("data-line") || "0", 10))
    .filter((n) => !isNaN(n));
  lineCounter = (existingLines.length ? Math.max(...existingLines) : 0) + 1;

  setupAutocomplete(0);

  // 🔧 Handle the hard-coded first row (line 0)
  const firstRow = document.querySelector(`.order-line[data-line="0"]`);
  if (firstRow) {
    firstRow.dataset.hasItem = "0";
    setupPriceSync(firstRow);

    ensure60NightTrialCell(firstRow);
    update60NightTrialColumnVisibility();

    const optBtn = firstRow.querySelector(".open-options");
    if (optBtn) optBtn.addEventListener("click", () => openOptionsWindow(firstRow));

    // ✅ Wire delete on the hard-coded first row too
    firstRow.querySelector(".delete-row")?.addEventListener("click", () => {
      firstRow.remove();
      update60NightTrialColumnVisibility();
      recalcTotals();
    });
  }

  const addBtn = document.getElementById("addItemBtn");
  if (addBtn) addBtn.addEventListener("click", addNewRow);

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!globalSuggestions) return;

    const clickedInsideSuggestions = globalSuggestions.contains(t);
    const clickedInput = t?.classList?.contains?.("item-search");

    if (!clickedInsideSuggestions && !clickedInput) hideSuggestions();
  });

  recalcTotals();
});