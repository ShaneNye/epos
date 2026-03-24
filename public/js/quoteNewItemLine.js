// public/js/quoteNewItemLine.js
console.log("✅ quoteNewItemLine.js loaded");

let items = [];
let globalSuggestions;
let activeInput = null;
let activeRow = null;
let lineCounter = 1;

// ✅ Global cache so popup windows can see them
window.optionsCache = {}; // itemId -> options payload
window.__quoteOptionsTargetLine = null;

/* =========================================================
   Helpers: safely trigger quote totals
========================================================= */
function recalcTotals() {
  if (typeof window.updateQuoteSummary === "function") return window.updateQuoteSummary();
  if (typeof window.updateOrderSummary === "function") return window.updateOrderSummary();
}

/* =========================================================
   Load items from shared cache / proxy
========================================================= */
async function loadItems(forceRefresh = false) {
  try {
    if (window.nsItemFeedCache?.getItems) {
      items = await window.nsItemFeedCache.getItems({ forceRefresh });
      window.items = items;
      console.log("✅ Loaded items from shared cache:", items.length, "records");
      return items;
    }

    console.warn("⚠️ nsItemFeedCache not found - falling back to direct fetch");

    const res = await fetch("/api/netsuite/items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    items = data.results || [];
    window.items = items;

    console.log("✅ Loaded items from API fallback:", items.length, "records");
    return items;
  } catch (err) {
    console.error("❌ Failed to load items:", err);
    items = [];
    window.items = [];
    return [];
  }
}

/* =========================================================
   Filters
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
   Global dropdown
========================================================= */
function createGlobalSuggestions() {
  const existing = document.getElementById("global-suggestions");
  if (existing) {
    globalSuggestions = existing;
    return existing;
  }

  globalSuggestions = document.createElement("ul");
  globalSuggestions.id = "global-suggestions";
  globalSuggestions.className = "hidden";
  globalSuggestions.style.position = "fixed";
  globalSuggestions.style.zIndex = "99999";
  document.body.appendChild(globalSuggestions);
  return globalSuggestions;
}

function showSuggestions(input, row, matches) {
  if (!globalSuggestions) createGlobalSuggestions();

  globalSuggestions.innerHTML = "";
  activeInput = input;
  activeRow = row;

  if (!matches.length) return hideSuggestions();

  matches.forEach((it) => {
    const li = document.createElement("li");
    li.className = "suggestion-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "suggestion-name";
    nameSpan.textContent = it["Name"] || "Unnamed item";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "suggestion-add-btn";
    addBtn.textContent = "+";
    addBtn.title = "Add item";

    const addItem = () => {
      selectItemForRow(row, input, it);
      hideSuggestions();
    };

    // clicking anywhere on row still works
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      addItem();
    });

    // dedicated + button
    addBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      addItem();
    });

    li.appendChild(nameSpan);
    li.appendChild(addBtn);
    globalSuggestions.appendChild(li);
  });

  const rect = input.getBoundingClientRect();
  globalSuggestions.style.left = `${rect.left}px`;
  globalSuggestions.style.width = `${rect.width}px`;

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  if (spaceBelow < 200 && spaceAbove > spaceBelow) {
    globalSuggestions.style.top = "";
    globalSuggestions.style.bottom = `${window.innerHeight - rect.top}px`;
  } else {
    globalSuggestions.style.bottom = "";
    globalSuggestions.style.top = `${rect.bottom}px`;
  }

  globalSuggestions.classList.remove("hidden");
}

function hideSuggestions() {
  if (!globalSuggestions) return;
  globalSuggestions.classList.add("hidden");
  globalSuggestions.innerHTML = "";
  activeInput = null;
  activeRow = null;
}

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

  td.style.display = "none";

  const sel = td.querySelector(".sixty-night-select");
  const ph = td.querySelector(".sixty-night-placeholder");
  if (sel) sel.style.display = "none";
  if (ph) ph.style.display = "inline";

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
   Options popup
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
  if (!row) {
    console.warn("⚠️ openOptionsWindow called with no row");
    return;
  }

  const itemId = row.querySelector(".item-internal-id")?.value?.trim();
  if (!itemId) {
    alert("⚠️ Please select an item first.");
    return;
  }

  window.__quoteOptionsTargetLine = row.dataset.line || null;

  const jsonEl = row.querySelector(".item-options-json");
  const existingSelectionsRaw = jsonEl?.value || "{}";

  let existingSelections = {};
  try {
    existingSelections = JSON.parse(existingSelectionsRaw || "{}");
  } catch (err) {
    console.warn("⚠️ Failed parsing existing option JSON, falling back to empty object:", err);
    existingSelections = {};
  }

  let schema = window.optionsCache?.[itemId] || {};

  if (!schema || !Object.keys(schema).length) {
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

    if (itemData) {
      schema = {};
      Object.entries(itemData).forEach(([key, val]) => {
        if (!String(key).toLowerCase().startsWith("option :")) return;

        const fieldName = String(key).replace(/^option\s*:\s*/i, "").trim();
        const values = String(val || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);

        if (fieldName && values.length) {
          schema[fieldName] = values;
        }
      });
    }
  }

  if (!schema || !Object.keys(schema).length) {
    schema = {};
    Object.entries(existingSelections || {}).forEach(([field, value]) => {
      if (Array.isArray(value)) {
        schema[field] = value.map((v) => String(v).trim()).filter(Boolean);
      } else if (value) {
        schema[field] = [String(value).trim()];
      }
    });
  }

  window.optionsCache[itemId] = schema || {};

  console.log("⚙️ Opening options window", {
    itemId,
    rowLine: row.dataset.line,
    existingSelections,
    schema,
  });

  const url = `/options.html?itemId=${encodeURIComponent(
    itemId
  )}&selections=${encodeURIComponent(JSON.stringify(existingSelections))}`;

  const win = window.open(
    url,
    "ItemOptions",
    "width=600,height=500,resizable=yes,scrollbars=yes"
  );

  if (!win) {
    alert("⚠️ Popup blocked. Please allow popups for this site and try again.");
    return;
  }

  win.focus();
}

window.onOptionsSaved = function (itemId, selections) {
  let row = null;

  if (window.__quoteOptionsTargetLine != null) {
    row = document.querySelector(`.order-line[data-line="${window.__quoteOptionsTargetLine}"]`);
  }

  if (!row && activeRow) {
    row = activeRow;
  }

  if (!row) {
    row = document
      .querySelector(`.order-line .item-internal-id[value="${itemId}"]`)
      ?.closest(".order-line");
  }

  if (!row) {
    console.warn("⚠️ onOptionsSaved could not find target row for item:", itemId);
    return;
  }

  let jsonEl = row.querySelector(".item-options-json");
  let sumEl = row.querySelector(".options-summary");
  const optCell = row.querySelector(".options-cell");

  if (!jsonEl && optCell) {
    optCell.innerHTML = `
      <button type="button" class="open-options btn-secondary small-btn">⚙️ Options</button>
      <input type="hidden" class="item-options-json" />
      <div class="options-summary"></div>
    `;
    optCell.querySelector(".open-options")?.addEventListener("click", () => openOptionsWindow(row));
    jsonEl = row.querySelector(".item-options-json");
    sumEl = row.querySelector(".options-summary");
  }

  if (jsonEl) jsonEl.value = JSON.stringify(selections || {});
  if (sumEl) sumEl.innerHTML = selectionsToSummary(selections || {});

  console.log("✅ Options saved back to row", {
    itemId,
    rowLine: row.dataset.line,
    selections,
  });

  recalcTotals();
};

/* =========================================================
   Price sync
   amountField.dataset.unitRetail = gross retail per unit in pounds
========================================================= */
function setupPriceSync(line) {
  const amountField = line.querySelector(".item-amount");
  const discountField = line.querySelector(".item-discount");
  const salePriceField = line.querySelector(".item-saleprice");
  const qtyField = line.querySelector(".item-qty");
  const vatField = line.querySelector(".item-vat");

  if (!amountField || !discountField || !salePriceField || !qtyField) return;

  let unitRetail = 0;

  function recalc() {
    const qty = parseInt(qtyField.value || 1, 10);
    const retailTotal = unitRetail * qty;
    amountField.value = retailTotal.toFixed(2);

    const discount = parseFloat(discountField.value || 0);
    const saleTotal = retailTotal * (1 - discount / 100);
    salePriceField.value = saleTotal.toFixed(2);

    if (vatField) {
      const vatVal = saleTotal - saleTotal / 1.2;
      vatField.value = vatVal.toFixed(2);
    }

    recalcTotals();
  }

  if (amountField.dataset.unitRetail) {
    unitRetail = parseFloat(amountField.dataset.unitRetail) || 0;
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

    if (vatField) {
      const vatVal = saleTotal - saleTotal / 1.2;
      vatField.value = vatVal.toFixed(2);
    }

    recalcTotals();
  });

  qtyField.addEventListener("input", recalc);

  line.setUnitRetail = (retailGrossPerUnit) => {
    unitRetail = parseFloat(retailGrossPerUnit || 0) || 0;
    amountField.dataset.unitRetail = unitRetail;
    recalc();
  };
}

/* =========================================================
   Autocomplete
========================================================= */
function getFilteredMatches(query) {
  const selectedSize = (document.getElementById("sizeFilter")?.value || "").toLowerCase();
  const selectedBaseOption = (document.getElementById("baseOptionFilter")?.value || "").toLowerCase();
  const selectedType = (document.getElementById("typeFilter")?.value || "").toLowerCase();

  const itemPool = Array.isArray(items) && items.length ? items : (window.items || []);

  return itemPool
    .filter((it) => {
      const name = (it["Name"] || "").toLowerCase();
      if (!name.includes(query)) return false;

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
}

function setupAutocompleteForRow(row) {
  if (!row) return;

  const input = row.querySelector(".item-search");
  if (!input) return;

  if (input.dataset.autocompleteBound === "1") return;
  input.dataset.autocompleteBound = "1";

  input.addEventListener("focus", async () => {
    if ((!items || !items.length) && (!window.items || !window.items.length)) {
      await loadItems();
    }
  });

  input.addEventListener("input", async () => {
    const query = input.value.trim().toLowerCase();
    if (!query) return hideSuggestions();

    if ((!items || !items.length) && (!window.items || !window.items.length)) {
      await loadItems();
    }

    const matches = getFilteredMatches(query);
    showSuggestions(input, row, matches);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => hideSuggestions(), 150);
  });
}

function setupAutocomplete(lineIndex) {
  const input = document.getElementById(`itemSearch-${lineIndex}`);
  if (!input) return;
  const row = input.closest(".order-line");
  if (!row) return;
  setupAutocompleteForRow(row);
}

/* =========================================================
   Ensure blank row exists
========================================================= */
function ensureNextEmptyRowAndFocus() {
  const rows = [...document.querySelectorAll("#orderItemsBody .order-line")];
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
   Select item
========================================================= */
function selectItemForRow(line, input, item) {
  if (!line || !input || !item) return;

  const hiddenId = line.querySelector(".item-internal-id");
  const hiddenBase = line.querySelector(".item-baseprice");
  const discountField = line.querySelector(".item-discount");

  input.value = item["Name"] || "";

  const internalId =
    item["Internal ID"] ??
    item["InternalId"] ??
    item["InternalID"] ??
    item["internalid"] ??
    item["internal id"] ??
    item["Id"] ??
    item["id"] ??
    "";

  if (hiddenId) hiddenId.value = String(internalId || "");
  if (hiddenBase) hiddenBase.value = item["Base Price"] || "";

  const rawBase = parseFloat(item["Base Price"] || 0);
  const retailPerUnitGross = rawBase > 0 ? rawBase * 1.2 : 0;

  if (discountField) discountField.value = 0;

  if (!line.setUnitRetail) setupPriceSync(line);
  if (line.setUnitRetail) line.setUnitRetail(retailPerUnitGross);

  line.dataset.hasItem = "1";

  const itemId = (hiddenId?.value || "").trim();
  const itemClass = (item["Class"] || "").toLowerCase();
  line.dataset.itemClass = itemClass;

  ensure60NightTrialCell(line);
  update60NightTrialColumnVisibility();

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

  setTimeout(() => ensureNextEmptyRowAndFocus(), 0);

  hideSuggestions();
  recalcTotals();
}

async function selectItem(item) {
  if (!activeInput || !activeRow) return;
  selectItemForRow(activeRow, activeInput, item);
}

/* =========================================================
   Add new row
========================================================= */
function addNewRow() {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody) return;

  const newLine = lineCounter++;
  const tr = document.createElement("tr");
  tr.className = "order-line";
  tr.setAttribute("data-line", newLine);
  tr.dataset.hasItem = "0";

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
        <input type="hidden" class="item-internal-id" />
        <input type="hidden" class="item-baseprice" />
      </div>
    </td>

    <td class="options-cell"></td>

    <td><input type="number" class="item-qty" value="1" min="1" step="1" /></td>

    <td><input type="number" class="item-amount" placeholder="£" step="0.01" readonly /></td>

    <td><input type="number" class="item-discount" value="0" min="0" max="100" step="0.1" /></td>

    <td><input type="number" class="item-vat" placeholder="£" step="0.01" readonly /></td>

    <td><input type="number" class="item-saleprice" placeholder="£" step="0.01" /></td>

    <td><button type="button" class="delete-row btn-secondary small-btn">🗑</button></td>
  `;

  tbody.appendChild(tr);

  ensure60NightTrialCell(tr);
  update60NightTrialColumnVisibility();

  setupAutocompleteForRow(tr);
  setupPriceSync(tr);

  tr.querySelector(".delete-row")?.addEventListener("click", () => {
    tr.remove();
    update60NightTrialColumnVisibility();
    recalcTotals();
  });

  recalcTotals();
}

/* =========================================================
   Expose shared helpers for quoteView.js
========================================================= */
window.loadItems = loadItems;
window.populateSizeFilter = populateSizeFilter;
window.populateBaseOptionFilter = populateBaseOptionFilter;
window.createGlobalSuggestions = createGlobalSuggestions;
window.setupAutocomplete = setupAutocomplete;
window.setupAutocompleteForRow = setupAutocompleteForRow;
window.setupPriceSync = setupPriceSync;
window.ensure60NightTrialCell = ensure60NightTrialCell;
window.update60NightTrialColumnVisibility = update60NightTrialColumnVisibility;
window.ensureNextEmptyRowAndFocus = ensureNextEmptyRowAndFocus;
window.addNewRow = addNewRow;
window.openOptionsWindow = openOptionsWindow;

/* =========================================================
   Init
========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  await loadItems();
  await populateSizeFilter();
  await populateBaseOptionFilter();

  createGlobalSuggestions();

  const existingLines = [...document.querySelectorAll("#orderItemsBody .order-line")]
    .map((r) => parseInt(r.getAttribute("data-line") || "0", 10))
    .filter((n) => !isNaN(n));
  lineCounter = (existingLines.length ? Math.max(...existingLines) : 0) + 1;

  document.querySelectorAll("#orderItemsBody .order-line").forEach((row) => {
    setupAutocompleteForRow(row);
    setupPriceSync(row);
    ensure60NightTrialCell(row);

    const hasItem = row.querySelector(".item-internal-id")?.value?.trim();
    row.dataset.hasItem = hasItem ? "1" : (row.dataset.hasItem || "0");

    const optBtn = row.querySelector(".open-options");
    if (optBtn) optBtn.addEventListener("click", () => openOptionsWindow(row));

    row.querySelector(".delete-row")?.addEventListener("click", () => {
      row.remove();
      update60NightTrialColumnVisibility();
      recalcTotals();
    });
  });

  update60NightTrialColumnVisibility();

  const addBtn = document.getElementById("addItemBtn");
  if (addBtn && addBtn.dataset.bound !== "1") {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", addNewRow);
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!globalSuggestions) return;

    const clickedInsideSuggestions = globalSuggestions.contains(t);
    const clickedInput = t?.classList?.contains?.("item-search");

    if (!clickedInsideSuggestions && !clickedInput) hideSuggestions();
  });

  window.addEventListener("resize", hideSuggestions);
  window.addEventListener("scroll", hideSuggestions, true);

  recalcTotals();
});