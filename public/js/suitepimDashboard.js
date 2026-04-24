(function () {
  const state = {
    environment: "production",
    rows: [],
    filteredRows: [],
    activeType: "all",
  };

  const el = {};

  function initEls() {
    [
      "suitepimPerformanceSource",
      "suitepimToggleKpiFiltersBtn",
      "suitepimKpiFilterBody",
      "suitepimPerformancePeriod",
      "suitepimLocationToggle",
      "suitepimLocationPanel",
      "suitepimPerformanceClear",
      "suitepimExportCsvBtn",
      "suitepimPerformanceStatus",
      "suitepimPerfSales",
      "suitepimPerfUnits",
      "suitepimPerfItems",
      "suitepimPerfAvg",
      "suitepimPerfMom",
      "suitepimPerfYoy",
      "suitepimPerfRows",
      "suitepimTrendTitle",
      "suitepimMonthlyTrend",
      "suitepimStorePerformance",
      "suitepimTopItems",
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });
  }

  function authHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    if (!saved?.token) {
      window.location.href = "/index.html";
      return {};
    }
    return { Authorization: `Bearer ${saved.token}` };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(value) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value || 0);
  }

  function number(value) {
    return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value || 0);
  }

  function parseAmount(value) {
    return Number(String(value ?? "0").replace(/,/g, "")) || 0;
  }

  function parseDate(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  }

  function weekKey(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  }

  function weekLabel(key) {
    const date = new Date(`${key}T00:00:00`);
    return `w/c ${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
  }

  function normaliseRow(row) {
    const date = parseDate(row.Date);
    return {
      sourceDate: row.Date || "",
      date,
      month: date ? monthKey(date) : "",
      year: date ? date.getFullYear() : null,
      store: String(row.Store || "Unknown").trim() || "Unknown",
      salesOrder: String(
        row.SalesOrder ||
        row.salesOrder ||
        row.salesorder ||
        row.tranid ||
        row.documentNumber ||
        row.documentnumber ||
        ""
      ).trim(),
      item: String(row.Item || "Unknown").trim() || "Unknown",
      itemType: normalizeItemType(row.ItemType || row.itemType || row.type),
      quantity: parseAmount(row.Quantity),
      amount: parseAmount(row.Amount),
    };
  }

  function csvValue(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadCsv() {
    if (!state.rows.length) {
      showStatus("No SuitePim performance rows to export yet.", "error");
      return;
    }
    const headers = ["Date", "Sales Order", "Subsidiary", "Item", "Item Type", "Quantity", "Amount"];
    const lines = [
      headers.map(csvValue).join(","),
      ...state.rows.map((row) => [
        row.sourceDate,
        row.salesOrder,
        row.store,
        row.item,
        row.itemType,
        row.quantity,
        row.amount.toFixed(2),
      ].map(csvValue).join(",")),
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `suitepim-item-performance-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function normalizeItemType(value) {
    const text = String(value || "Unknown").trim();
    const compact = text.toLowerCase().replace(/[^a-z]/g, "");
    if (compact.includes("service")) return "Service";
    if (compact.includes("inventory") || compact.includes("invtpart")) return "Inventory";
    return text || "Unknown";
  }

  function showStatus(message, type = "info") {
    if (!el.suitepimPerformanceStatus) return;
    el.suitepimPerformanceStatus.textContent = message || "";
    el.suitepimPerformanceStatus.dataset.type = type;
    el.suitepimPerformanceStatus.hidden = !message;
  }

  async function api(path) {
    const response = await fetch(`/api/suitepim${path}?environment=${state.environment}`, {
      headers: authHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `SuitePim request failed (${response.status})`);
    return data;
  }

  function selectedLocations() {
    return Array.from(el.suitepimLocationPanel.querySelectorAll("input:checked")).map((input) => input.value);
  }

  function inSelectedPeriod(row) {
    if (!row.date) return false;
    const period = el.suitepimPerformancePeriod.value;
    const now = new Date();
    const thisMonth = monthKey(now);
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    if (period === "this-month") return row.month === thisMonth;
    if (period === "last-month") return row.month === monthKey(lastMonthDate);
    if (period === "ytd") return row.date.getFullYear() === now.getFullYear() && row.date <= now;
    if (period === "last-12") {
      const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      return row.date >= start;
    }
    return true;
  }

  function applyFilters() {
    const locations = selectedLocations();
    state.filteredRows = state.rows.filter((row) => {
      if (state.activeType !== "all" && row.itemType !== state.activeType) return false;
      if (locations.length && !locations.includes(row.store)) return false;
      return inSelectedPeriod(row);
    });
    renderReport();
  }

  function comparisonBaseRows() {
    const locations = selectedLocations();
    return state.rows.filter((row) => {
      if (state.activeType !== "all" && row.itemType !== state.activeType) return false;
      if (locations.length && !locations.includes(row.store)) return false;
      return true;
    });
  }

  function sumRows(rows) {
    return rows.reduce((acc, row) => {
      acc.amount += row.amount;
      acc.quantity += row.quantity;
      acc.items.add(row.item);
      if (row.salesOrder) acc.salesOrders.add(row.salesOrder);
      return acc;
    }, { amount: 0, quantity: 0, items: new Set(), salesOrders: new Set() });
  }

  function grouped(rows, keyFn) {
    const map = new Map();
    rows.forEach((row) => {
      const key = keyFn(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return map;
  }

  function percentChange(current, previous) {
    if (!previous && !current) return 0;
    if (!previous) return 100;
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  function renderKpis() {
    const totals = sumRows(state.filteredRows);
    el.suitepimPerfSales.textContent = money(totals.amount);
    el.suitepimPerfUnits.textContent = number(totals.quantity);
    el.suitepimPerfItems.textContent = totals.items.size.toLocaleString();
    el.suitepimPerfAvg.textContent = money(totals.quantity ? totals.amount / totals.quantity : 0);
    el.suitepimPerfRows.textContent = `${state.filteredRows.length.toLocaleString()} rows`;
  }

  function renderTrend() {
    const period = el.suitepimPerformancePeriod.value;
    const useWeeks = period === "this-month" || period === "last-month";
    const keyFn = useWeeks ? (row) => weekKey(row.date) : (row) => row.month;
    const labelFn = useWeeks ? weekLabel : monthLabel;
    const trendGroups = grouped(state.filteredRows.filter((row) => row.date), keyFn);
    const periods = Array.from(trendGroups.keys()).sort().slice(useWeeks ? -6 : -12);
    const summaries = periods.map((key) => sumRows(trendGroups.get(key)));
    const totals = summaries.map((summary) => summary.amount);
    const max = Math.max(...totals, 1);

    el.suitepimTrendTitle.textContent = useWeeks ? "Weekly trend" : "Monthly trend";
    el.suitepimMonthlyTrend.innerHTML = periods.map((key, index) => {
      const summary = summaries[index];
      return `
        <div class="suitepim-bar-row">
          <span>${escapeHtml(labelFn(key))}</span>
          <div><i style="width:${Math.max(3, (summary.amount / max) * 100)}%"></i></div>
          <strong>${money(summary.amount)}<small>${summary.salesOrders.size.toLocaleString()} sales</small></strong>
        </div>
      `;
    }).join("") || `<div class="suitepim-empty-inline">No ${useWeeks ? "weekly" : "monthly"} data available</div>`;

    const now = new Date();
    const baseRows = comparisonBaseRows();
    const current = sumRows(baseRows.filter((row) => row.month === monthKey(now))).amount;
    const previous = sumRows(baseRows.filter((row) => row.month === monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)))).amount;
    const change = percentChange(current, previous);
    el.suitepimPerfMom.textContent = `MoM ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
    el.suitepimPerfMom.dataset.trend = change >= 0 ? "up" : "down";
  }

  function renderStores() {
    const storeGroups = grouped(state.filteredRows, (row) => row.store);
    const rows = Array.from(storeGroups.entries())
      .map(([store, items]) => ({ store, ...sumRows(items) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
    const max = Math.max(...rows.map((row) => row.amount), 1);

    el.suitepimStorePerformance.innerHTML = rows.map((row) => `
      <div class="suitepim-bar-row">
        <span>${escapeHtml(row.store.replace(/^.*:\s*/, ""))}</span>
        <div><i style="width:${Math.max(3, (row.amount / max) * 100)}%"></i></div>
        <strong>${money(row.amount)}<small>${row.salesOrders.size.toLocaleString()} sales</small></strong>
      </div>
    `).join("") || `<div class="suitepim-empty-inline">No store data available</div>`;

    const now = new Date();
    const baseRows = comparisonBaseRows();
    const currentYear = sumRows(baseRows.filter((row) => row.year === now.getFullYear())).amount;
    const previousYear = sumRows(baseRows.filter((row) => row.year === now.getFullYear() - 1)).amount;
    const change = percentChange(currentYear, previousYear);
    el.suitepimPerfYoy.textContent = `YoY ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
    el.suitepimPerfYoy.dataset.trend = change >= 0 ? "up" : "down";
  }

  function renderTopItems() {
    const itemGroups = grouped(state.filteredRows, (row) => row.item);
    const rows = Array.from(itemGroups.entries())
      .map(([item, items]) => ({ item, ...sumRows(items) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12);

    el.suitepimTopItems.innerHTML = `
      <table class="suitepim-mini-table">
        <thead><tr><th>Item</th><th>Units</th><th>Sales</th><th>Avg</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.item)}</td>
              <td>${number(row.quantity)}</td>
              <td>${money(row.amount)}</td>
              <td>${money(row.quantity ? row.amount / row.quantity : 0)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderReport() {
    renderKpis();
    renderTrend();
    renderStores();
    renderTopItems();
  }

  function populateLocations() {
    const locations = Array.from(new Set(state.rows.map((row) => row.store))).sort();
    el.suitepimLocationPanel.innerHTML = locations
      .map((location) => `
        <label>
          <input type="checkbox" value="${escapeHtml(location)}">
          <span>${escapeHtml(location.replace(/^.*:\s*/, ""))}</span>
        </label>
      `)
      .join("");
    el.suitepimLocationPanel.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        updateLocationLabel();
        applyFilters();
      });
    });
    updateLocationLabel();
  }

  function updateLocationLabel() {
    const locations = selectedLocations();
    el.suitepimLocationToggle.textContent = locations.length ? `${locations.length} subsidiar${locations.length === 1 ? "y" : "ies"} selected` : "All subsidiaries";
  }

  function toggleCollapsible(button, expanded) {
    const body = document.getElementById(button.getAttribute("aria-controls"));
    const panel = button.closest(".suitepim-collapsible");
    if (!body || !panel) return;
    panel.classList.toggle("is-collapsed", !expanded);
    button.setAttribute("aria-expanded", String(expanded));
  }

  async function loadDashboard() {
    showStatus("Loading item performance...", "info");
    const data = await api("/item-performance");
    state.rows = (data.rows || []).map(normaliseRow).filter((row) => row.date);
    populateLocations();
    el.suitepimPerformanceSource.innerHTML = `
      <span>${escapeHtml(data.source || "NetSuite")}</span>
      <strong>${state.rows.length.toLocaleString()} performance rows</strong>
    `;
    showStatus("", "success");
    applyFilters();
  }

  function bindEvents() {
    el.suitepimToggleKpiFiltersBtn.addEventListener("click", () => {
      const expanded = el.suitepimToggleKpiFiltersBtn.getAttribute("aria-expanded") !== "true";
      toggleCollapsible(el.suitepimToggleKpiFiltersBtn, expanded);
    });
    el.suitepimPerformancePeriod.addEventListener("change", applyFilters);
    el.suitepimLocationToggle.addEventListener("click", () => {
      el.suitepimLocationPanel.hidden = !el.suitepimLocationPanel.hidden;
    });
    el.suitepimPerformanceClear.addEventListener("click", () => {
      el.suitepimLocationPanel.querySelectorAll("input").forEach((input) => {
        input.checked = false;
      });
      updateLocationLabel();
      applyFilters();
    });
    el.suitepimExportCsvBtn.addEventListener("click", downloadCsv);
    document.querySelectorAll(".suitepim-report-tabs button").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeType = button.dataset.type;
        document.querySelectorAll(".suitepim-report-tabs button").forEach((btn) => {
          btn.classList.toggle("active", btn === button);
        });
        applyFilters();
      });
    });
    document.addEventListener("click", (event) => {
      if (el.suitepimLocationPanel.hidden) return;
      if (el.suitepimLocationPanel.contains(event.target) || el.suitepimLocationToggle.contains(event.target)) return;
      el.suitepimLocationPanel.hidden = true;
    });
  }

  window.addEventListener("DOMContentLoaded", async () => {
    initEls();
    bindEvents();
    await loadDashboard().catch((err) => {
      console.error(err);
      showStatus(err.message, "error");
      el.suitepimPerformanceSource.innerHTML = `<span>Unavailable</span><strong>Item performance</strong>`;
    });
  });
})();
