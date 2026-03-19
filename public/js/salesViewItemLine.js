// public/js/salesViewItemLine.js
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
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" style="text-align:center; color:#888;">No item lines found.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();

  lines.forEach((line, idx) => {
    const tr = document.createElement("tr");
    tr.className = "order-line";
    tr.dataset.line = idx;
    tr.dataset.lineid = line.lineId || "";

    const qty = Math.abs(Number(line.quantity || 1)) || 1;

    // Treat BOTH as line totals from backend
    let retailGrossLineTotal = Number(line.amount || 0);
    let saleGrossLineTotal = Number(line.saleprice ?? 0);

    if (!Number.isFinite(retailGrossLineTotal)) retailGrossLineTotal = 0;
    if (!Number.isFinite(saleGrossLineTotal)) saleGrossLineTotal = 0;

    // ✅ Only fallback retail from sale if retail is missing
    if (retailGrossLineTotal <= 0 && saleGrossLineTotal > 0) {
      retailGrossLineTotal = saleGrossLineTotal;
    }

    // ❌ DO NOT do the reverse fallback
    // A sale price of 0 is valid and must stay 0

    const itemName = String(line.item?.refName || "").toLowerCase();
    const isDiscountLine =
      itemName.includes("discount") ||
      itemName.includes("blue light") ||
      itemName.includes("promo") ||
      itemName.includes("promotion") ||
      itemName.includes("voucher");

    if (isDiscountLine) {
      if (retailGrossLineTotal > 0) retailGrossLineTotal = -retailGrossLineTotal;
      if (saleGrossLineTotal > 0) saleGrossLineTotal = -saleGrossLineTotal;
    } else {
      if (retailGrossLineTotal < 0) retailGrossLineTotal = Math.abs(retailGrossLineTotal);
      if (saleGrossLineTotal < 0) saleGrossLineTotal = Math.abs(saleGrossLineTotal);
    }

    const retailGrossPerUnit = qty ? (retailGrossLineTotal / qty) : 0;

    const discountPct =
      retailGrossLineTotal > 0
        ? Math.max(
            0,
            ((retailGrossLineTotal - saleGrossLineTotal) / retailGrossLineTotal) * 100
          )
        : 0;

    const taxValue = saleGrossLineTotal / 6; // gross -> VAT @20%

    const discountCell = isPending
      ? `<input type="number" class="item-discount" value="${discountPct.toFixed(1)}" min="0" max="100" step="0.1" />`
      : `${discountPct.toFixed(1)}%`;

    const saleCell = isPending
      ? `<input type="number" class="item-saleprice" value="${saleGrossLineTotal.toFixed(2)}" step="0.01" />`
      : `£${saleGrossLineTotal.toFixed(2)}`;

    const qtyCell = isPending
      ? `<input type="number" class="item-qty" value="${qty}" min="1" step="1" />`
      : `<span class="qty">${qty}</span>`;

    const fulfilCell = isPending
      ? `<select class="item-fulfilment fulfilmentSelect" data-line="${idx}"></select>`
      : (line.custcol_sb_fulfilmentlocation?.refName || "");

    const invCell = isPending
      ? `
        <div class="inventory-cell" style="display:none">
          <button type="button" class="open-inventory btn-secondary small-btn" data-line="${idx}">📦</button>
          <input type="hidden" class="item-inv-detail" value="${line.inventoryDetail || ""}" />
          <span class="inv-summary">${line.inventoryDetail || ""}</span>
        </div>`
      : (line.inventoryDetail ? "📦" : "");

    tr.innerHTML = `
      <td>${line.item?.refName || "—"}</td>
      <td class="options-cell">${line.custcol_sb_itemoptionsdisplay || ""}</td>
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
      <td class="fulfilment-cell">${fulfilCell}</td>
      <td class="inventory-cell-wrapper">${invCell}</td>

      <input
        type="hidden"
        class="item-baseprice"
        value="${(retailGrossPerUnit / 1.2).toFixed(6)}"
      />
      <input type="hidden" class="item-internal-id" value="${line.item?.id || ""}" />
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  if (isPending) {
    tbody.querySelectorAll("tr.order-line").forEach((row) => {
      const sel = row.querySelector(".item-fulfilment");
      window.SalesLineUI?.fillFulfilmentSelect(sel, fulfilmentMethods);

      const lineIdx = Number(row.dataset.line || 0);
      const line = lines[lineIdx];
      const currentId = line?.custcol_sb_fulfilmentlocation?.id;

      if (currentId && sel) sel.value = String(currentId);

      window.SalesLineUI?.setupPriceSync(row);

      const btn = row.querySelector(".open-inventory");
      btn?.addEventListener("click", () =>
        window.SalesLineUI?.openInventoryWindow(row, lineIdx)
      );

      sel?.addEventListener("change", () =>
        window.SalesLineUI?.validateInventoryForRow(row)
      );

      window.SalesLineUI?.validateInventoryForRow(row);
    });

    if (typeof updateOrderSummaryFromTable === "function") {
      updateOrderSummaryFromTable();
    }
  }
};