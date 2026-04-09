// public/js/salesItemLineCommon.js
(() => {
  let globalSuggestions = null;

  function money(n) {
    const v = Number(n || 0);
    return Number.isFinite(v) ? v : 0;
  }

  function ensureSuggestionsEl() {
    if (globalSuggestions) return globalSuggestions;

    globalSuggestions = document.createElement("ul");
    globalSuggestions.id = "global-suggestions";
    globalSuggestions.className = "hidden";
    document.body.appendChild(globalSuggestions);

    document.addEventListener("click", (e) => {
      if (
        globalSuggestions &&
        !globalSuggestions.contains(e.target) &&
        !e.target.classList.contains("item-search")
      ) {
        hideSuggestions();
      }
    });

    return globalSuggestions;
  }

  function showSuggestions(input, matches, lineIndex) {
    const list = ensureSuggestionsEl();
    list.innerHTML = "";

    if (!input || !matches?.length) {
      hideSuggestions();
      return;
    }

    matches.slice(0, 10).forEach((it) => {
      const li = document.createElement("li");
      li.textContent = it["Name"] || "";
      li.addEventListener("click", () => {
        input.value = it["Name"] || "";
        const row = document.querySelector(`.order-line[data-line="${lineIndex}"]`);
        if (!row) return;

        const hiddenId = row.querySelector(".item-internal-id");
        const hiddenBase = row.querySelector(".item-baseprice");
        const discountField = row.querySelector(".item-discount");

        if (hiddenId) hiddenId.value = it["Internal ID"] || "";
        if (hiddenBase) hiddenBase.value = it["Base Price"] || "";
        if (discountField) discountField.value = "0";

        if (typeof row.setUnitRetail === "function") {
          const base = parseFloat(it["Base Price"] || 0);
          const retailPerUnit = (base / 100) * 120;
          row.setUnitRetail(retailPerUnit);
        }

        // cache options payload like Sales New
        const itemId = hiddenId?.value || "";
        const opts = {};
        Object.entries(it).forEach(([key, val]) => {
          if (key.toLowerCase().startsWith("option :")) {
            const fieldName = key.replace(/^option\s*:\s*/i, "").trim();
            const values = val
              ? String(val).split(",").map((v) => v.trim()).filter(Boolean)
              : [];
            if (values.length) opts[fieldName] = values;
          }
        });

        window.optionsCache = window.optionsCache || {};
        if (itemId) window.optionsCache[itemId] = opts;

        // rebuild options cell if options exist
        const optCell = row.querySelector(".options-cell");
        if (optCell) {
          if (Object.keys(opts).length === 0) {
            optCell.innerHTML = "";
          } else {
            optCell.innerHTML = `
              <button type="button" class="open-options btn-secondary small-btn">⚙️ Options</button>
              <input type="hidden" class="item-options-json" value="{}" />
              <div class="options-summary"></div>
            `;
            optCell.querySelector(".open-options")?.addEventListener("click", () => {
              openOptionsWindow(row);
            });
          }
        }

        hideSuggestions();
      });

      list.appendChild(li);
    });

    const rect = input.getBoundingClientRect();
    list.style.position = "fixed";
    list.style.left = rect.left + "px";
    list.style.width = rect.width + "px";

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow < 200 && spaceAbove > spaceBelow) {
      list.style.top = "";
      list.style.bottom = window.innerHeight - rect.top + "px";
    } else {
      list.style.bottom = "";
      list.style.top = rect.bottom + "px";
    }

    list.classList.remove("hidden");
  }

  function hideSuggestions() {
    if (!globalSuggestions) return;
    globalSuggestions.classList.add("hidden");
    globalSuggestions.innerHTML = "";
  }

  function selectionsToSummary(selections) {
    const parts = [];
    Object.entries(selections || {}).forEach(([field, value]) => {
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

    const existingSelections =
      row.querySelector(".item-options-json")?.value || "{}";

    const url = `/options.html?itemId=${encodeURIComponent(
      itemId
    )}&selections=${encodeURIComponent(existingSelections)}`;

    const win = window.open(
      url,
      "ItemOptions",
      "width=600,height=500,resizable=yes,scrollbars=yes"
    );
    win?.focus();
  }

  function setupPriceSync(row) {
    const amountField = row.querySelector(".item-amount");
    const discountField = row.querySelector(".item-discount");
    const salePriceField = row.querySelector(".item-saleprice");
    const qtyField = row.querySelector(".item-qty");
    const baseNetField = row.querySelector(".item-baseprice");

    if (!amountField || !discountField || !salePriceField || !qtyField) return;

    function recalcFromDiscount() {
      const qty = Math.max(1, parseInt(qtyField.value || 1, 10));
      const baseNet = money(baseNetField?.value);
      const unitRetailGross =
        money(amountField.dataset.unitRetail) || (baseNet ? baseNet * 1.2 : 0);
      const retailTotal = unitRetailGross * qty;

      const d = Math.max(0, Math.min(100, money(discountField.value)));
      discountField.value = d.toFixed(1);

      const saleTotal = retailTotal * (1 - d / 100);
      salePriceField.value = saleTotal.toFixed(2);

      amountField.value = retailTotal.toFixed(2);
      window.updateOrderSummary?.();
      window.updateOrderSummaryFromTable?.();
      validateInventoryForRow(row);
    }

    function recalcFromSalePrice() {
      const qty = Math.max(1, parseInt(qtyField.value || 1, 10));
      const baseNet = money(baseNetField?.value);
      const unitRetailGross =
        money(amountField.dataset.unitRetail) || (baseNet ? baseNet * 1.2 : 0);
      const retailTotal = unitRetailGross * qty;

      const saleTotal = money(salePriceField.value);
      const d = retailTotal > 0 ? ((retailTotal - saleTotal) / retailTotal) * 100 : 0;
      discountField.value = Math.max(0, Math.min(100, d)).toFixed(1);

      amountField.value = retailTotal.toFixed(2);
      window.updateOrderSummary?.();
      window.updateOrderSummaryFromTable?.();
      validateInventoryForRow(row);
    }

    discountField.addEventListener("input", recalcFromDiscount);
    salePriceField.addEventListener("input", recalcFromSalePrice);
    qtyField.addEventListener("input", recalcFromDiscount);

    recalcFromSalePrice();

    row.setUnitRetail = (unitRetailGross) => {
      amountField.dataset.unitRetail = money(unitRetailGross);
      recalcFromSalePrice();
    };
  }

  function fillFulfilmentSelect(select, methods) {
    if (!select) return;
    select.innerHTML = '<option value="">Select fulfilment method...</option>';
    (methods || []).forEach((m) => {
      const id = String(m.id ?? m["Internal ID"] ?? "");
      const name = m.name ?? m["Name"] ?? "";
      if (!id) return;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      select.appendChild(opt);
    });
  }

  function validateInventoryForRow(row) {
    const button = row.querySelector(".open-inventory");
    const detailField = row.querySelector(".item-inv-detail");
    const fulfilSel = row.querySelector(".item-fulfilment");
    const invSummary = row.querySelector(".inv-summary");
    if (!button || !detailField || !fulfilSel) return;

    const fulfilmentText =
      fulfilSel.options[fulfilSel.selectedIndex]?.textContent?.trim().toLowerCase() || "";

    const allowed = ["in store", "warehouse", "fulfil from store"];
    const show = allowed.some((a) => fulfilmentText.includes(a));

    const invCell = row.querySelector(".inventory-cell");
    if (invCell) invCell.style.display = show ? "inline-block" : "none";

    if (!show) return;

    const qty = parseInt(row.querySelector(".item-qty")?.value, 10) || 0;
    if (detailField.value) {
      const totalSelected = detailField.value
        .split(";")
        .map((p) => parseInt(p.trim().split(" ")[0], 10) || 0)
        .reduce((a, b) => a + b, 0);

      button.textContent = totalSelected === qty ? "✅" : "📦";
      if (invSummary) invSummary.textContent = detailField.value;
    } else {
      button.textContent = "📦";
      if (invSummary) invSummary.textContent = "";
    }
  }

function openInventoryWindow(row, lineIndexOverride) {
  const itemId = row.querySelector(".item-internal-id")?.value;
  const qty = row.querySelector(".item-qty")?.value || 0;
  const existing = row.querySelector(".item-inv-detail")?.value || "";
  const lineIndex = lineIndexOverride ?? row.dataset.line ?? "0";

  // ✅ remember exact row that opened popup
  window.__salesInventoryTargetRowLine = String(row.dataset.line || lineIndex);
  window.__salesInventoryTargetItemId = String(itemId || "");

  const url =
    `/inventory.html?itemId=${encodeURIComponent(itemId)}&qty=${encodeURIComponent(qty)}` +
    `&detail=${encodeURIComponent(existing)}&line=${encodeURIComponent(lineIndex)}`;

  const win = window.open(
    url,
    "InventoryDetail",
    "width=900,height=600,resizable=yes,scrollbars=yes"
  );
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

    window.updateOrderSummary?.();
    window.updateOrderSummaryFromTable?.();
  };

  window.SalesLineUI = {
    setupPriceSync,
    fillFulfilmentSelect,
    validateInventoryForRow,
    openInventoryWindow,
    openOptionsWindow,
    showSuggestions,
    hideSuggestions,
  };
})();