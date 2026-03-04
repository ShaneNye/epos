// public/js/salesItemLineCommon.js
(() => {
  function money(n) {
    const v = Number(n || 0);
    return Number.isFinite(v) ? v : 0;
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
      const unitRetailGross = money(amountField.dataset.unitRetail) || (baseNet ? baseNet * 1.2 : 0);
      const retailTotal = unitRetailGross * qty;

      const d = Math.max(0, Math.min(100, money(discountField.value)));
      discountField.value = d.toFixed(1);

      const saleTotal = retailTotal * (1 - d / 100);
      salePriceField.value = saleTotal.toFixed(2);

      amountField.value = retailTotal.toFixed(2);
      window.updateOrderSummary?.();
      validateInventoryForRow(row);
    }

    function recalcFromSalePrice() {
      const qty = Math.max(1, parseInt(qtyField.value || 1, 10));
      const baseNet = money(baseNetField?.value);
      const unitRetailGross = money(amountField.dataset.unitRetail) || (baseNet ? baseNet * 1.2 : 0);
      const retailTotal = unitRetailGross * qty;

      const saleTotal = money(salePriceField.value);
      // protect divide-by-zero
      const d = retailTotal > 0 ? ((retailTotal - saleTotal) / retailTotal) * 100 : 0;
      discountField.value = Math.max(0, Math.min(100, d)).toFixed(1);

      amountField.value = retailTotal.toFixed(2);
      window.updateOrderSummary?.();
      validateInventoryForRow(row);
    }

    discountField.addEventListener("input", recalcFromDiscount);
    salePriceField.addEventListener("input", recalcFromSalePrice);
    qtyField.addEventListener("input", recalcFromDiscount);

    // initial calc
    recalcFromSalePrice();

    row.setUnitRetail = (unitRetailGross) => {
      amountField.dataset.unitRetail = money(unitRetailGross);
      recalcFromSalePrice();
    };
  }

  function fillFulfilmentSelect(select, methods) {
    if (!select) return;
    select.innerHTML = '<option value="">Select fulfilment method...</option>';
    (methods || []).forEach(m => {
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
    const show = allowed.some(a => fulfilmentText.includes(a));

    const invCell = row.querySelector(".inventory-cell");
    if (invCell) invCell.style.display = show ? "inline-block" : "none";

    if (!show) return;

    // optional: update icon based on qty match (keeps your existing behaviour)
    const qty = parseInt(row.querySelector(".item-qty")?.value, 10) || 0;
    if (detailField.value) {
      const totalSelected = detailField.value
        .split(";")
        .map(p => parseInt(p.trim().split(" ")[0], 10) || 0)
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

    const url =
      `/inventory.html?itemId=${encodeURIComponent(itemId)}&qty=${encodeURIComponent(qty)}` +
      `&detail=${encodeURIComponent(existing)}&line=${encodeURIComponent(lineIndex)}`;

    const win = window.open(url, "InventoryDetail", "width=900,height=600,resizable=yes,scrollbars=yes");
    win?.focus();
  }

  window.SalesLineUI = {
    setupPriceSync,
    fillFulfilmentSelect,
    validateInventoryForRow,
    openInventoryWindow
  };
})();