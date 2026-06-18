// public/js/widgets/goodsValue.js
console.log("Goods Value Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("goodsValueWidget");
  if (!widget) return;

  const GROUP_KEY = "__group__";
  const STATUS_COLORS = [
    "#0081ab",
    "#16a34a",
    "#f5b301",
    "#7c3aed",
    "#dc2626",
    "#0f766e",
    "#ea580c",
    "#475569",
  ];
  const state = {
    rows: [],
    snapshotRows: [],
    selectedLocation: "",
    selectedStockBin: "__all__",
    selectedStockStatus: "__all__",
    comparisonEnabled: false,
    comparisonLoading: false,
    comparisonError: "",
    snapshotDate: "",
    focusTimer: null,
  };

  function getHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  function clean(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function cell(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function firstValue(row, keys) {
    for (const key of keys) {
      if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
        return row[key];
      }
    }

    const normalizeKey = (key) => String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const lookup = new Map(
      Object.keys(row || {}).map((key) => [normalizeKey(key), key])
    );
    for (const key of keys) {
      const actual = lookup.get(normalizeKey(key));
      if (actual && row[actual] !== undefined && row[actual] !== null && row[actual] !== "") {
        return row[actual];
      }
    }
    return "";
  }

  function numericValue(row, keys) {
    const rawValue = firstValue(row, keys);
    if (rawValue === undefined || rawValue === null || rawValue === "") return null;
    const raw = String(rawValue).replace(/[£$,]/g, "").trim();
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : null;
  }

  function numberValue(row, keys) {
    return numericValue(row, keys) ?? 0;
  }

  function dashboardRange() {
    if (window.DashboardDateFilter?.getRange) return window.DashboardDateFilter.getRange();
    const today = new Date();
    return { start: today, end: today };
  }

  function isoDate(value) {
    if (window.DashboardDateFilter?.toIsoDate) return window.DashboardDateFilter.toIsoDate(value);
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function locationValue(row) {
    return clean(firstValue(row, ["Location", "Store", "Warehouse", "Inventory Location", "location"])) || "Unknown Location";
  }

  function itemValue(row) {
    return clean(firstValue(row, ["Item", "Item Name", "Item ID", "Item Id", "item", "Name"]));
  }

  function binValue(row) {
    return clean(firstValue(row, ["Bin Number", "Bin", "Bin Number Name", "binnumber", "bin_number"]));
  }

  function inventoryNumberValue(row) {
    return clean(firstValue(row, ["Inventory Number", "Lot Number", "Serial/Lot Number", "Serial Lot Number", "inventorynumber"]));
  }

  function statusValue(row) {
    return clean(firstValue(row, ["Status", "Inventory Status", "inventoryStatus", "InventoryStatus", "status"])) || "No Status";
  }

  function quantityValue(row) {
    return numberValue(row, [
      "On Hand",
      "OnHand",
      "Quantity On Hand",
      "QuantityOnHand",
      "On Hand Quantity",
      "OnHandQuantity",
      "Quantity",
      "qty",
      "Available",
      "Quantity Available",
    ]);
  }

  function purchasePriceValue(row) {
    return numberValue(row, ["Purchase Price", "PurchasePrice", "purchase price", "purchasePrice", "purchase_price", "Average Cost", "AverageCost", "Cost"]);
  }

  function goodsValue(row) {
    const onHandValue = numericValue(row, [
      "On Hand Value",
      "OnHandValue",
      "On Hand Total Value",
      "OnHandTotalValue",
      "Inventory Value",
      "InventoryValue",
      "Total Value",
      "Total : Value",
      "Total: Value",
      "Sum of Total : Value",
      "Sum of total : value",
      "Good : Value",
      "Good: Value",
      "Sum of Good : Value",
      "Sum of Good: Value",
      "total value",
      "Value",
      "value",
    ]);
    return onHandValue ?? purchasePriceValue(row);
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    });
  }

  function formatNumber(value) {
    return Math.round(Number(value || 0)).toLocaleString("en-GB");
  }

  function statusColor(statusKey) {
    let hash = 0;
    String(statusKey || "").split("").forEach((char) => {
      hash = ((hash << 5) - hash) + char.charCodeAt(0);
      hash |= 0;
    });
    return STATUS_COLORS[Math.abs(hash) % STATUS_COLORS.length];
  }

  function locationSummaries(rows = state.rows) {
    const summaries = new Map();

    rows.forEach((row) => {
      const label = locationValue(row);
      const key = normalize(label);
      if (!summaries.has(key)) {
        summaries.set(key, { key, label, value: 0, quantity: 0, lines: 0 });
      }

      const summary = summaries.get(key);
      summary.value += goodsValue(row);
      summary.quantity += quantityValue(row);
      summary.lines += 1;
    });

    return Array.from(summaries.values())
      .filter((summary) => summary.key)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  function statusSummaries(locationKey, rows = state.rows) {
    const summaries = new Map();

    rows
      .filter((row) => normalize(locationValue(row)) === locationKey)
      .forEach((row) => {
        const label = statusValue(row);
        const key = normalize(label);
        if (!summaries.has(key)) {
          summaries.set(key, { key, label, value: 0, quantity: 0, lines: 0 });
        }

        const summary = summaries.get(key);
        summary.value += goodsValue(row);
        summary.quantity += quantityValue(row);
        summary.lines += 1;
      });

    return Array.from(summaries.values())
      .map((summary) => ({ ...summary, color: statusColor(summary.key) }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  function groupTotal(rows = state.rows) {
    return rows.reduce((sum, row) => sum + goodsValue(row), 0);
  }

  function selectedRows() {
    const summaries = locationSummaries();
    if (!state.selectedLocation) return summaries;
    if (state.selectedLocation === GROUP_KEY) return [];
    return summaries.filter((summary) => summary.key === state.selectedLocation);
  }

  function groupSummary() {
    return {
      key: GROUP_KEY,
      label: "Group",
      value: groupTotal(state.rows),
      quantity: state.rows.reduce((sum, row) => sum + quantityValue(row), 0),
      lines: state.rows.length,
    };
  }

  function snapshotLocationSummaries(rows = state.snapshotRows) {
    const summaries = new Map();

    rows.forEach((row) => {
      const label = locationValue(row);
      const key = normalize(label);
      if (!key || key.includes("invoicing")) return;
      if (!summaries.has(key)) {
        summaries.set(key, { key, label, value: 0, quantity: 0 });
      }
      const summary = summaries.get(key);
      summary.value += numberValue(row, [
        "Total : Value",
        "Total: Value",
        "total : value",
        "Total Value",
        "Value",
      ]);
      summary.quantity += numberValue(row, [
        "Total : Count",
        "Total :  Count",
        "Total :  count",
        "Total: Count",
        "total : count",
        "total quantity",
        "Total Quantity",
        "Total Count",
        "Count",
      ]);
    });

    return Array.from(summaries.values());
  }

  function snapshotSummaryFor(locationKey) {
    const summaries = snapshotLocationSummaries();
    if (locationKey === GROUP_KEY) {
      return {
        key: GROUP_KEY,
        label: "Group",
        value: summaries.reduce((sum, row) => sum + row.value, 0),
        quantity: summaries.reduce((sum, row) => sum + row.quantity, 0),
      };
    }
    return summaries.find((summary) => summary.key === locationKey) || null;
  }

  function comparisonFor(summary) {
    if (!state.comparisonEnabled || state.comparisonLoading || state.comparisonError) return null;
    const snapshot = snapshotSummaryFor(summary.key);
    if (!snapshot) return null;

    const valueDelta = summary.value - snapshot.value;
    const quantityDelta = summary.quantity - snapshot.quantity;
    const valuePercent = snapshot.value ? (valueDelta / snapshot.value) * 100 : 0;
    const quantityPercent = snapshot.quantity ? (quantityDelta / snapshot.quantity) * 100 : 0;

    return {
      valueDelta,
      quantityDelta,
      valuePercent,
      quantityPercent,
      valueDirection: valueDelta < 0 ? "down" : valueDelta > 0 ? "up" : "flat",
      quantityDirection: quantityDelta < 0 ? "down" : quantityDelta > 0 ? "up" : "flat",
    };
  }

  function formatDeltaPercent(value) {
    return `${Math.abs(value).toFixed(1)}%`;
  }

  function comparisonMarkup(summary) {
    const comparison = comparisonFor(summary);
    if (!comparison) return "";

    const valueLabel = comparison.valueDirection === "flat"
      ? "Value flat"
      : `Value ${comparison.valueDirection} ${formatMoney(Math.abs(comparison.valueDelta))} (${formatDeltaPercent(comparison.valuePercent)})`;
    const quantityLabel = comparison.quantityDirection === "flat"
      ? "Units flat"
      : `Units ${comparison.quantityDirection} ${formatNumber(Math.abs(comparison.quantityDelta))} (${formatDeltaPercent(comparison.quantityPercent)})`;

    return `
      <div class="goods-value-comparison">
        <span class="is-${cell(comparison.valueDirection)}">${cell(valueLabel)}</span>
        <span class="is-${cell(comparison.quantityDirection)}">${cell(quantityLabel)}</span>
      </div>
    `;
  }

  function comparisonControlsMarkup() {
    return `
      <div class="goods-value-comparison-controls">
        <label class="goods-value-toggle">
          <input type="checkbox" data-goods-comparison-toggle${state.comparisonEnabled ? " checked" : ""}>
          <span>Compare</span>
        </label>
        <small data-goods-comparison-status hidden></small>
      </div>
    `;
  }

  function selectedLocationLabel() {
    if (state.selectedLocation === GROUP_KEY) return "Group";
    if (!state.selectedLocation) return "All locations";
    return locationSummaries(state.rows).find((summary) => summary.key === state.selectedLocation)?.label || "Location";
  }

  function arcPath(cx, cy, radius, startDeg, endDeg) {
    const start = polarPoint(cx, cy, radius, endDeg);
    const end = polarPoint(cx, cy, radius, startDeg);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  }

  function polarPoint(cx, cy, radius, angleDeg) {
    const angle = (angleDeg - 90) * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }

  function groupStatusSummaries() {
    const summaries = new Map();
    state.rows.forEach((row) => {
      const label = statusValue(row);
      const key = normalize(label);
      if (!summaries.has(key)) {
        summaries.set(key, { key, label, value: 0, quantity: 0, lines: 0 });
      }
      const summary = summaries.get(key);
      summary.value += goodsValue(row);
      summary.quantity += quantityValue(row);
      summary.lines += 1;
    });
    return Array.from(summaries.values())
      .map((summary) => ({ ...summary, color: statusColor(summary.key) }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }

  function statusPartsForSummary(summary) {
    return summary.key === GROUP_KEY ? groupStatusSummaries() : statusSummaries(summary.key, state.rows);
  }

  function statusMeterSvg(summary) {
    const parts = statusPartsForSummary(summary);
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    let cursor = 270;

    if (!parts.length || total <= 0) {
      return `<svg class="goods-value-meter-svg" viewBox="0 0 100 58" aria-hidden="true">
        <path class="goods-value-status-arc" d="${arcPath(50, 50, 40, 270, 450)}" />
      </svg>`;
    }

    return `<svg class="goods-value-meter-svg" viewBox="0 0 100 58" aria-label="${cell(summary.label)} status split">
      ${parts.map((part) => {
        const sweep = Math.max(0.5, (part.value / total) * 180);
        const start = cursor;
        const end = Math.min(450, cursor + sweep);
        cursor = end;
        return `<path class="goods-value-status-arc"
          d="${arcPath(50, 50, 40, start, end)}"
          style="--status-color:${cell(part.color)}"
          tabindex="0"
          data-status-key="${cell(part.key)}"
          data-status-label="${cell(part.label)}"
          data-status-value="${part.value}"
          aria-label="${cell(part.label)} ${formatMoney(part.value)}"></path>`;
      }).join("")}
    </svg>`;
  }

  function meterCard(summary, totalValue) {
    const percent = totalValue > 0 ? (summary.value / totalValue) * 100 : 0;
    const selected = Boolean(state.selectedLocation);
    const isGroup = summary.key === GROUP_KEY;

    return `
      <article class="goods-value-meter-card${selected ? " is-focused" : ""}${isGroup ? " is-group-meter" : ""}"
        role="button"
        tabindex="0"
        data-location-key="${cell(summary.key)}"
        data-location-value="${summary.value}"
        data-location-quantity="${summary.quantity}"
        data-default-percent="${Math.round(percent)}">
        <div class="goods-value-meter">
          ${statusMeterSvg(summary)}
          <div class="goods-value-meter-inner">
            <strong data-goods-meter-percent>${Math.round(percent)}%</strong>
            <span data-goods-meter-label>of stock</span>
          </div>
        </div>
        <div class="goods-value-meter-copy">
          <h3>${cell(summary.label)}</h3>
          <strong data-goods-meter-value>${formatMoney(summary.value)}</strong>
          <small data-goods-meter-quantity>${formatNumber(summary.quantity)} units</small>
          ${comparisonMarkup(summary)}
        </div>
        ${isGroup ? comparisonControlsMarkup() : ""}
      </article>
    `;
  }

  function selectedStockRows() {
    const baseRows = state.selectedLocation === GROUP_KEY
      ? state.rows
      : state.rows.filter((row) => normalize(locationValue(row)) === state.selectedLocation);

    return baseRows
      .filter((row) => state.selectedStockBin === "__all__" || normalize(binValue(row)) === state.selectedStockBin)
      .filter((row) => state.selectedStockStatus === "__all__" || normalize(statusValue(row)) === state.selectedStockStatus)
      .sort((a, b) =>
        statusValue(a).localeCompare(statusValue(b)) ||
        itemValue(a).localeCompare(itemValue(b)) ||
        binValue(a).localeCompare(binValue(b))
      );
  }

  function selectedLocationRows() {
    return state.selectedLocation === GROUP_KEY
      ? state.rows
      : state.rows.filter((row) => normalize(locationValue(row)) === state.selectedLocation);
  }

  function uniqueStockOptions(getValue) {
    const options = new Map();
    selectedLocationRows().forEach((row) => {
      const label = getValue(row);
      const key = normalize(label);
      if (key && !options.has(key)) options.set(key, label);
    });
    return Array.from(options.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function stockTable() {
    const rows = selectedStockRows();
    if (!rows.length) return `<div class="no-data">No stock rows found for this location.</div>`;

    return `
      <div class="goods-value-detail-scroll">
        <table class="goods-value-status-table goods-value-stock-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Status</th>
              <th>Bin</th>
              <th>Inventory Number</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${cell(itemValue(row))}</td>
                <td><span class="goods-value-status-dot" style="--status-color:${cell(statusColor(normalize(statusValue(row))))}"></span>${cell(statusValue(row))}</td>
                <td>${cell(binValue(row))}</td>
                <td>${cell(inventoryNumberValue(row))}</td>
                <td>${formatNumber(quantityValue(row))}</td>
                <td>${formatMoney(purchasePriceValue(row))}</td>
                <td>${formatMoney(goodsValue(row))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function breakdownTable() {
    const rows = state.selectedLocation === GROUP_KEY
      ? groupStatusSummaries()
      : statusSummaries(state.selectedLocation);
    return `
      <div class="goods-value-breakdown-totals">
        <div><span>Total value</span><strong>${formatMoney(groupTotal(selectedStockRows()))}</strong></div>
        <div><span>Total units</span><strong>${formatNumber(selectedStockRows().reduce((sum, row) => sum + quantityValue(row), 0))}</strong></div>
      </div>
      <table class="goods-value-status-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Value</th>
            <th>Quantity</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><span class="goods-value-status-dot" style="--status-color:${cell(row.color)}"></span>${cell(row.label)}</td>
              <td>${formatMoney(row.value)}</td>
              <td>${formatNumber(row.quantity)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderDetailPanel() {
    const panel = widget.querySelector("[data-goods-detail-panel]");
    if (!panel) return;

    if (!state.selectedLocation) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    panel.hidden = false;
    panel.innerHTML = `
      <div class="goods-value-detail-header">
        <div>
          <h3>${cell(selectedLocationLabel())}</h3>
          <small>Actual stock</small>
        </div>
        <div class="goods-value-stock-filters">
          <select data-goods-stock-filter="bin" aria-label="Filter stock by bin">
            <option value="__all__">All bins</option>
            ${uniqueStockOptions(binValue).map((option) => `
              <option value="${cell(option.key)}"${option.key === state.selectedStockBin ? " selected" : ""}>${cell(option.label)}</option>
            `).join("")}
          </select>
          <select data-goods-stock-filter="status" aria-label="Filter stock by status">
            <option value="__all__">All statuses</option>
            ${uniqueStockOptions(statusValue).map((option) => `
              <option value="${cell(option.key)}"${option.key === state.selectedStockStatus ? " selected" : ""}>${cell(option.label)}</option>
            `).join("")}
          </select>
        </div>
      </div>
      <div class="goods-value-detail-body">
        ${stockTable()}
      </div>
    `;

    panel.querySelector('[data-goods-stock-filter="bin"]')?.addEventListener("change", (event) => {
      state.selectedStockBin = event.target.value;
      renderDetailPanel();
    });

    panel.querySelector('[data-goods-stock-filter="status"]')?.addEventListener("change", (event) => {
      state.selectedStockStatus = event.target.value;
      renderDetailPanel();
    });
  }

  function renderUnderBreakdown() {
    const panel = widget.querySelector("[data-goods-under-breakdown]");
    if (!panel) return;

    if (state.selectedLocation === GROUP_KEY) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    panel.hidden = false;
    panel.innerHTML = `
      <div class="goods-value-breakdown-header">
        <h3>Value breakdown</h3>
        <small>${cell(selectedLocationLabel())}</small>
      </div>
      ${breakdownTable()}
    `;
  }

  function renderMeters() {
    const grid = widget.querySelector("[data-goods-value-meters]");
    const groupSlot = widget.querySelector("[data-goods-group-meter]");
    const layout = widget.querySelector(".goods-value-focus-layout");
    const resetButton = widget.querySelector("[data-goods-reset]");
    const header = widget.querySelector(".goods-value-header");
    if (!grid || !groupSlot) return;

    const rows = selectedRows();
    const totalValue = groupTotal();

    const focused = Boolean(state.selectedLocation);

    grid.classList.toggle("is-focused", focused);
    layout?.classList.toggle("is-focused", focused);
    if (resetButton) resetButton.hidden = !focused;
    if (header) header.hidden = !focused;
    groupSlot.hidden = focused && state.selectedLocation !== GROUP_KEY;
    groupSlot.innerHTML = !focused || state.selectedLocation === GROUP_KEY ? meterCard(groupSummary(), totalValue) : "";
    grid.innerHTML = rows.length
      ? rows.map((row) => meterCard(row, totalValue)).join("")
      : state.selectedLocation === GROUP_KEY
        ? ""
        : `<div class="no-data">No inventory value found for this selection.</div>`;

    updateComparisonStatus();
    attachStatusHover();
    attachComparisonToggle();
    attachLocationClicks();
    if (focused) {
      renderUnderBreakdown();
      renderDetailPanel();
    } else {
      widget.querySelector("[data-goods-under-breakdown]")?.setAttribute("hidden", "");
      widget.querySelector("[data-goods-detail-panel]")?.setAttribute("hidden", "");
    }
  }

  function updateComparisonStatus() {
    const comparisonStatus = widget.querySelector("[data-goods-comparison-status]");
    if (!comparisonStatus) return;

    comparisonStatus.textContent = state.comparisonLoading
      ? "Loading..."
      : state.comparisonError
        ? state.comparisonError
        : state.comparisonEnabled && state.snapshotDate
          ? `Since ${state.snapshotDate}`
          : "";
    comparisonStatus.hidden = !comparisonStatus.textContent;
  }

  function attachComparisonToggle() {
    const toggle = widget.querySelector("[data-goods-comparison-toggle]");
    if (!toggle) return;

    toggle.closest(".goods-value-comparison-controls")?.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    toggle.addEventListener("change", async (event) => {
      state.comparisonEnabled = event.target.checked;
      state.comparisonError = "";
      if (state.comparisonEnabled) {
        await loadSnapshotComparison();
      } else {
        state.snapshotRows = [];
        state.snapshotDate = "";
      }
      renderMeters();
    });
  }

  function attachLocationClicks() {
    widget.querySelectorAll(".goods-value-meter-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest(".goods-value-status-arc")) return;
        if (event.target.closest(".goods-value-comparison-controls")) return;
        focusLocation(card);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusLocation(card);
      });
    });
  }

  function focusLocation(card) {
    if (!card?.dataset?.locationKey || state.selectedLocation === card.dataset.locationKey) return;

    if (state.focusTimer) window.clearTimeout(state.focusTimer);

    widget.querySelectorAll(".goods-value-meter-card").forEach((item, index) => {
      item.style.setProperty("--exit-delay", `${Math.min(index * 18, 180)}ms`);
      item.classList.toggle("is-selecting", item === card);
      item.classList.toggle("is-exiting", item !== card);
    });

    state.focusTimer = window.setTimeout(() => {
      state.selectedLocation = card.dataset.locationKey;
      state.selectedStockBin = "__all__";
      state.selectedStockStatus = "__all__";
      state.focusTimer = null;
      renderMeters();
    }, 280);
  }

  function attachStatusHover() {
    widget.querySelectorAll(".goods-value-status-arc[data-status-key]").forEach((arc) => {
      arc.addEventListener("mouseenter", () => applyStatusHover(arc.dataset.statusKey, arc.dataset.statusLabel));
      arc.addEventListener("focus", () => applyStatusHover(arc.dataset.statusKey, arc.dataset.statusLabel));
      arc.addEventListener("mouseleave", clearStatusHover);
      arc.addEventListener("blur", clearStatusHover);
    });
  }

  function applyStatusHover(statusKey, statusLabel) {
    widget.querySelectorAll(".goods-value-status-arc").forEach((arc) => {
      arc.classList.toggle("is-muted", arc.dataset.statusKey !== statusKey);
      arc.classList.toggle("is-highlighted", arc.dataset.statusKey === statusKey);
    });

    widget.querySelectorAll(".goods-value-meter-card").forEach((card) => {
      const locationKey = card.dataset.locationKey;
      const locationValue = parseFloat(card.dataset.locationValue || "0") || 0;
      const statusSummary = locationKey === GROUP_KEY
        ? groupStatusSummaries().find((summary) => summary.key === statusKey)
        : statusSummaries(locationKey, state.rows).find((summary) => summary.key === statusKey);
      const statusValue = statusSummary?.value || 0;
      const statusQuantity = statusSummary?.quantity || 0;
      const percent = locationValue > 0 ? Math.round((statusValue / locationValue) * 100) : 0;

      card.querySelector("[data-goods-meter-percent]").textContent = `${percent}%`;
      card.querySelector("[data-goods-meter-label]").textContent = statusLabel || "status";
      card.querySelector("[data-goods-meter-value]").textContent = formatMoney(statusValue);
      card.querySelector("[data-goods-meter-quantity]").textContent = `${formatNumber(statusQuantity)} units`;
    });
  }

  function clearStatusHover() {
    widget.querySelectorAll(".goods-value-status-arc").forEach((arc) => {
      arc.classList.remove("is-muted", "is-highlighted");
    });

    widget.querySelectorAll(".goods-value-meter-card").forEach((card) => {
      card.querySelector("[data-goods-meter-percent]").textContent = `${card.dataset.defaultPercent || 0}%`;
      card.querySelector("[data-goods-meter-label]").textContent = "of stock";
      card.querySelector("[data-goods-meter-value]").textContent = formatMoney(card.dataset.locationValue || 0);
      card.querySelector("[data-goods-meter-quantity]").textContent = `${formatNumber(card.dataset.locationQuantity || 0)} units`;
    });
  }

  function renderShell() {
    widget.innerHTML = `
      <div class="goods-value-header">
        <button type="button" class="goods-value-reset" data-goods-reset>All locations</button>
      </div>
      <div class="goods-value-focus-layout">
        <div class="goods-value-group-column">
          <div data-goods-group-meter></div>
          <div class="goods-value-meter-grid" data-goods-value-meters></div>
          <section class="goods-value-under-breakdown" data-goods-under-breakdown hidden></section>
        </div>
        <section class="goods-value-detail-panel" data-goods-detail-panel hidden></section>
      </div>
    `;

    renderMeters();

    widget.querySelector("[data-goods-reset]").addEventListener("click", () => {
      if (state.focusTimer) window.clearTimeout(state.focusTimer);
      state.selectedLocation = "";
      state.selectedStockBin = "__all__";
      state.selectedStockStatus = "__all__";
      renderMeters();
    });

  }

  async function loadSnapshotComparison() {
    const range = dashboardRange();
    const date = isoDate(range.start);
    state.comparisonLoading = true;
    state.comparisonError = "";
    state.snapshotDate = date;
    renderMeters();

    try {
      const params = new URLSearchParams({
        date,
        from: date,
        snapshotDate: date,
        refresh: "1",
        _: String(Date.now()),
      });
      const res = await fetch(`/api/netsuite/inventory-snapshot?${params.toString()}`, {
        headers: getHeaders(),
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok || data.ok === false || !Array.isArray(data.results)) {
        throw new Error(data.error || "Invalid inventory snapshot response");
      }

      state.snapshotRows = data.results;
    } catch (err) {
      console.error("Failed to load inventory snapshot:", err);
      state.snapshotRows = [];
      state.comparisonError = "Comparison unavailable";
    } finally {
      state.comparisonLoading = false;
    }
  }

  async function loadGoodsValue() {
    widget.innerHTML = `<div class="loading">Loading goods value...</div>`;

    try {
      const res = await fetch(`/api/netsuite/inventorybalance?refresh=1&_=${Date.now()}`, {
        headers: getHeaders(),
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok || data.ok === false || !Array.isArray(data.results)) {
        throw new Error(data.error || "Invalid inventory balance response");
      }

      state.rows = data.results.filter((row) =>
        quantityValue(row) > 0 &&
        !normalize(locationValue(row)).includes("invoicing")
      );

      if (!state.rows.length) {
        widget.innerHTML = `
          <div class="widget-header">Goods Value</div>
          <div class="no-data">No inventory value found.</div>
        `;
        return;
      }

      renderShell();
    } catch (err) {
      console.error("Failed to load goods value:", err);
      widget.innerHTML = `<div class="error">Error loading goods value</div>`;
    }
  }

  loadGoodsValue();

  window.addEventListener("dashboard:date-range-change", async () => {
    if (!state.comparisonEnabled) return;
    await loadSnapshotComparison();
    renderMeters();
  });
});
