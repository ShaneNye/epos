(() => {
  let items = [];
  let suggestionsEl = null;
  let activeItemId = "";
  let unitRetailGross = 0;
  let isReady = false;

  function money(value) {
    return `£${(Number(value) || 0).toFixed(2)}`;
  }

  function buildLegacyOptionSchemaFromItem(item) {
    const opts = {};
    Object.entries(item || {}).forEach(([key, val]) => {
      if (!String(key).toLowerCase().startsWith("option :")) return;

      const fieldName = String(key).replace(/^option\s*:\s*/i, "").trim();
      const values = String(val || "")
        .split(",")
        .map((v) => v.trim())
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

  function getItemId(item) {
    return String(
      item?.["Internal ID"] ??
      item?.InternalId ??
      item?.InternalID ??
      item?.internalid ??
      item?.id ??
      ""
    ).trim();
  }

  async function loadItems() {
    try {
      if (window.nsItemFeedCache?.getItems) {
        items = await window.nsItemFeedCache.getItems();
      } else {
        const res = await fetch("/api/netsuite/items", { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        items = data.results || data.data || [];
      }
      window.items = items;
    } catch (err) {
      console.error("Failed to load homepage item widget items:", err);
      items = [];
    }
  }

  function setWidgetLoading(loading) {
    const widget = document.getElementById("homeItemLineWidget");
    if (!widget) return;

    widget.classList.toggle("is-loading", !!loading);

    const controls = widget.querySelectorAll("input, select, button");
    controls.forEach((control) => {
      if (control.id === "homeItemLineLoading") return;
      control.disabled = !!loading;
    });
  }

  async function populateSelectFromApi(selectId, url, valueKey, fallbackLabel) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = `<option value="">${fallbackLabel}</option>`;

    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const values = (data.results || [])
        .map((row) => row[valueKey])
        .filter((value) => value && String(value).trim() && value !== "- None -");

      [...new Set(values)].forEach((value) => {
        const option = document.createElement("option");
        option.value = String(value).toLowerCase();
        option.textContent = value;
        select.appendChild(option);
      });
    } catch (err) {
      console.warn(`Failed to populate ${selectId}:`, err);
    }
  }

  function ensureSuggestions() {
    if (suggestionsEl) return suggestionsEl;

    suggestionsEl = document.createElement("ul");
    suggestionsEl.id = "homeItemSuggestions";
    suggestionsEl.className = "hidden";
    document.body.appendChild(suggestionsEl);
    return suggestionsEl;
  }

  function hideSuggestions() {
    if (!suggestionsEl) return;
    suggestionsEl.classList.add("hidden");
    suggestionsEl.innerHTML = "";
  }

  function getFilteredMatches(query) {
    const size = (document.getElementById("homeItemSizeFilter")?.value || "").toLowerCase();
    const baseOption = (document.getElementById("homeItemBaseOptionFilter")?.value || "").toLowerCase();
    const type = (document.getElementById("homeItemTypeFilter")?.value || "").toLowerCase();

    return items
      .filter((item) => {
        const name = String(item["Name"] || "").toLowerCase();
        if (!name.includes(query)) return false;

        if (size) {
          if (size === "double" && (!name.includes("double") || name.includes("small double"))) return false;
          else if (size === "king" && (!(name.includes(" king") || name.startsWith("king") || name.includes("(king")) || name.includes("super king"))) return false;
          else if (size === "single" && (!(name.includes(" single") || name.startsWith("single") || name.includes("(single")) || name.includes("small single"))) return false;
          else if (!["double", "king", "single"].includes(size) && !name.includes(size)) return false;
        }

        if (baseOption) {
          const baseText = String(item["Base Option"] || item["Base Options"] || item["base options"] || "").toLowerCase();
          if (!baseText.includes(baseOption) && !name.includes(baseOption)) return false;
        }

        if (type) {
          const itemClass = String(item["Class"] || "").toLowerCase();
          if (type === "services" && itemClass !== "service") return false;
          if (type === "items" && itemClass === "service") return false;
        }

        return true;
      })
      .slice(0, 10);
  }

  function showSuggestions(input, matches) {
    if (!isReady) return;

    const list = ensureSuggestions();
    list.innerHTML = "";

    if (!matches.length) return hideSuggestions();

    matches.forEach((item) => {
      const li = document.createElement("li");
      li.className = "home-item-suggestion-row";

      const name = document.createElement("span");
      name.textContent = item["Name"] || "Unnamed item";

      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "+";
      add.title = "Select item";

      const select = () => {
        selectItem(item);
        hideSuggestions();
      };

      li.addEventListener("mousedown", (event) => {
        event.preventDefault();
        select();
      });
      add.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        select();
      });

      li.append(name, add);
      list.appendChild(li);
    });

    const rect = input.getBoundingClientRect();
    list.style.left = `${rect.left}px`;
    list.style.width = `${rect.width}px`;
    list.style.top = `${rect.bottom}px`;
    list.classList.remove("hidden");
  }

  function updatePriceTotals() {
    const row = document.getElementById("homeItemLine");
    if (!row) return;

    const qty = parseInt(row.querySelector(".home-item-qty")?.value || "1", 10) || 1;
    const discount = parseFloat(row.querySelector(".home-item-discount")?.value || "0") || 0;
    const amount = unitRetailGross * qty;
    const sale = amount * (1 - discount / 100);

    const amountInput = row.querySelector(".home-item-amount");
    const saleInput = row.querySelector(".home-item-saleprice");
    if (amountInput) amountInput.value = amount.toFixed(2);
    if (saleInput && document.activeElement !== saleInput) saleInput.value = sale.toFixed(2);

    const priceTotal = document.getElementById("homeItemPriceTotal");
    const saleTotal = document.getElementById("homeItemSaleTotal");
    if (priceTotal) priceTotal.textContent = money(amount);
    if (saleTotal) saleTotal.textContent = money(saleInput?.value || sale);
  }

  function syncDiscountFromSalePrice() {
    const row = document.getElementById("homeItemLine");
    if (!row) return;

    const qty = parseInt(row.querySelector(".home-item-qty")?.value || "1", 10) || 1;
    const retailTotal = unitRetailGross * qty;
    const salePrice = parseFloat(row.querySelector(".home-item-saleprice")?.value || "0");
    const discountInput = row.querySelector(".home-item-discount");

    if (retailTotal > 0 && Number.isFinite(salePrice) && discountInput) {
      discountInput.value = (((retailTotal - salePrice) / retailTotal) * 100).toFixed(1);
    }

    const saleTotal = document.getElementById("homeItemSaleTotal");
    if (saleTotal) saleTotal.textContent = money(salePrice);
  }

  function selectionsToSummary(selections) {
    return Object.entries(selections || {})
      .map(([field, value]) => {
        if (Array.isArray(value) && value.length) return `${field} : ${value.join(", ")}`;
        if (value) return `${field} : ${value}`;
        return "";
      })
      .filter(Boolean)
      .join("<br>");
  }

  async function openOptionsWindow() {
    if (!isReady) return;

    const row = document.getElementById("homeItemLine");
    const itemId = row?.querySelector(".home-item-internal-id")?.value?.trim();
    if (!itemId) return alert("Please select an item first.");

    if (!window.optionsCache?.[itemId] || !Object.keys(window.optionsCache[itemId]).length) {
      window.optionsCache = window.optionsCache || {};
      window.optionsCache[itemId] =
        await window.itemOptionsCache?.getOptionsForItem?.(itemId).catch(() => ({})) || {};
    }

    const existingSelections = row.querySelector(".home-item-options-json")?.value || "{}";
    const url = `/options.html?itemId=${encodeURIComponent(itemId)}&selections=${encodeURIComponent(existingSelections)}`;
    const win = window.open(url, "ItemOptions", "width=600,height=500,resizable=yes,scrollbars=yes");
    if (!win) return alert("Popup blocked. Please allow popups for this site and try again.");
    win.focus();
  }

  function renderOptionsCell(schema) {
    const cell = document.querySelector("#homeItemLine .home-item-options-cell");
    if (!cell) return;

    if (!schema || !Object.keys(schema).length) {
      cell.innerHTML = `<span class="home-item-muted">No options</span>`;
      return;
    }

    cell.innerHTML = `
      <button type="button" class="home-item-options-btn">Options</button>
      <input type="hidden" class="home-item-options-json" value="{}" />
      <div class="home-item-options-summary"></div>
    `;
    cell.querySelector(".home-item-options-btn")?.addEventListener("click", openOptionsWindow);
  }

  function selectItem(item) {
    if (!isReady) return;

    const row = document.getElementById("homeItemLine");
    if (!row) return;

    const input = document.getElementById("homeItemSearch");
    const idInput = row.querySelector(".home-item-internal-id");
    activeItemId = getItemId(item);

    if (input) input.value = item["Name"] || "";
    if (idInput) idInput.value = activeItemId;

    const rawBase = parseFloat(item["Base Price"] || "0");
    unitRetailGross = Number.isFinite(rawBase) ? rawBase * 1.2 : 0;

    const discount = row.querySelector(".home-item-discount");
    if (discount) discount.value = "0";

    window.optionsCache = window.optionsCache || {};
    const schema = getOptionSchemaForItem(activeItemId, item);
    if (activeItemId) window.optionsCache[activeItemId] = schema;

    renderOptionsCell(schema);
    updatePriceTotals();
  }

  function resetLine() {
    if (!isReady) return;

    const row = document.getElementById("homeItemLine");
    if (!row) return;

    row.querySelectorAll("input").forEach((input) => {
      if (input.classList.contains("home-item-qty")) input.value = "1";
      else if (input.classList.contains("home-item-discount")) input.value = "0";
      else input.value = "";
    });

    activeItemId = "";
    unitRetailGross = 0;
    renderOptionsCell(null);
    updatePriceTotals();
    document.getElementById("homeItemSearch")?.focus();
  }

  window.onOptionsSaved = function (itemId, selections) {
    if (String(itemId) !== String(activeItemId)) return;

    const row = document.getElementById("homeItemLine");
    const json = row?.querySelector(".home-item-options-json");
    const summary = row?.querySelector(".home-item-options-summary");

    if (json) json.value = JSON.stringify(selections || {});
    if (summary) summary.innerHTML = selectionsToSummary(selections || {});
  };

  document.addEventListener("DOMContentLoaded", async () => {
    setWidgetLoading(true);

    const search = document.getElementById("homeItemSearch");
    search?.addEventListener("input", () => {
      if (!isReady) return;
      const query = search.value.trim().toLowerCase();
      if (!query) return hideSuggestions();
      showSuggestions(search, getFilteredMatches(query));
    });
    search?.addEventListener("blur", () => setTimeout(hideSuggestions, 150));

    document.querySelector("#homeItemLine .home-item-qty")?.addEventListener("input", updatePriceTotals);
    document.querySelector("#homeItemLine .home-item-discount")?.addEventListener("input", updatePriceTotals);
    document.querySelector("#homeItemLine .home-item-saleprice")?.addEventListener("input", syncDiscountFromSalePrice);
    document.getElementById("homeItemResetBtn")?.addEventListener("click", resetLine);

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!suggestionsEl || suggestionsEl.contains(target) || target === search) return;
      hideSuggestions();
    });

    updatePriceTotals();

    try {
      await Promise.all([
        loadItems(),
        window.itemOptionsCache?.getAll?.().catch((err) => {
          console.warn("Failed to preload homepage item options:", err.message);
          return {};
        }),
        populateSelectFromApi("homeItemSizeFilter", "/api/netsuite/sales-order-item-size", "size", "All Sizes"),
        populateSelectFromApi("homeItemBaseOptionFilter", "/api/netsuite/sales-order-item-base-option", "base options", "All Storage Options"),
      ]);
      isReady = true;
    } finally {
      setWidgetLoading(false);
    }
  });
})();
