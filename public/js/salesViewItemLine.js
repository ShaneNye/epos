// public/js/salesViewItemLine.js
window.renderSalesViewLines = function renderSalesViewLines({
  so,
  fulfilmentMethods = [],
}) {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const isPending = so?.orderStatus?.id === "A";
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

    const qty = Number(line.quantity || 1);

    // IMPORTANT:
    // Your SO API builder sets line.amount = retailGross (not net) in GET /:id :contentReference[oaicite:3]{index=3}
    // So in Sales View, treat line.amount as "retail gross per unit"
    const retailGrossPerUnit = Number(line.amount || 0);
    const retailGrossTotal = retailGrossPerUnit * qty;

    // Your SO API builder sets line.saleprice = gross LINE total :contentReference[oaicite:4]{index=4}
    const saleGrossLineTotal = Number(line.saleprice || 0);
    const saleGrossPerUnit = qty ? (saleGrossLineTotal / qty) : 0;

    const discountPct = retailGrossTotal > 0
      ? Math.max(0, ((retailGrossTotal - saleGrossLineTotal) / retailGrossTotal) * 100)
      : 0;

    const taxValue = (saleGrossLineTotal > 0 ? saleGrossLineTotal : retailGrossTotal) / 6; // gross*(1/6) = VAT @20%

    // Pending approval → editable discount/sale/fulfilment/inventory
    const discountCell = isPending
      ? `<input type="number" class="item-discount" value="${discountPct.toFixed(1)}" min="0" max="100" step="0.1" />`
      : `${discountPct.toFixed(1)}%`;

    const saleCell = isPending
      ? `<input type="number" class="item-saleprice" value="${saleGrossPerUnit.toFixed(2)}" step="0.01" />`
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
      <td>${line.custcol_sb_itemoptionsdisplay || ""}</td>
      <td class="qty">${qtyCell}</td>

      <td class="amount">
        ${isPending
          ? `<input type="number" class="item-amount" readonly value="${retailGrossTotal.toFixed(2)}" data-unit-retail="${retailGrossPerUnit}" />`
          : `£${retailGrossTotal.toFixed(2)}`
        }
      </td>

      <td class="discount">${discountCell}</td>
      <td class="vat">£${taxValue.toFixed(2)}</td>
      <td class="saleprice">${saleCell}</td>
      <td class="fulfilment-cell">${fulfilCell}</td>
      <td class="inventory-cell-wrapper">${invCell}</td>

      <!-- SalesNew-compatible hidden net base price (NET per unit) -->
      <input type="hidden" class="item-baseprice" value="${(retailGrossPerUnit / 1.2).toFixed(6)}" />
      <input type="hidden" class="item-internal-id" value="${line.item?.id || ""}" />
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  // Wire behaviour if pending approval
  if (isPending) {
    tbody.querySelectorAll("tr.order-line").forEach((row) => {
      // fulfilment options
      const sel = row.querySelector(".item-fulfilment");
      window.SalesLineUI?.fillFulfilmentSelect(sel, fulfilmentMethods);

      // preselect fulfilment from the SO payload (line index matches)
      const lineIdx = Number(row.dataset.line || 0);
      const line = lines[lineIdx];
      const currentId = line?.custcol_sb_fulfilmentlocation?.id;
      if (currentId && sel) sel.value = String(currentId);

      // price behaviour (discount/sale/qty)
      window.SalesLineUI?.setupPriceSync(row);

      // inventory behaviour
      const btn = row.querySelector(".open-inventory");
      btn?.addEventListener("click", () => window.SalesLineUI?.openInventoryWindow(row, lineIdx));
      sel?.addEventListener("change", () => window.SalesLineUI?.validateInventoryForRow(row));

      // initial toggle
      window.SalesLineUI?.validateInventoryForRow(row);
    });

    window.updateOrderSummary?.();
  }
};