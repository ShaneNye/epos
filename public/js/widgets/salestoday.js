// public/js/widgets/salestoday.js
console.log("Sales Created Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widgetContainer = document.getElementById("salesTodayWidget");
  if (!widgetContainer) {
    console.warn("#salesTodayWidget container not found");
    return;
  }

  const state = {
    activeTab: "sales",
    salesRows: [],
    feedbackRows: [],
    selectedStore: "all",
    salesError: null,
    feedbackError: null,
  };

  function getRange() {
    return window.DashboardDateFilter?.getRange() || {
      label: "Today",
      start: new Date(),
      end: new Date(),
    };
  }

  function inSalesRange(row, range) {
    return window.DashboardDateFilter?.isDateInRange(row.Date, range);
  }

  function normalize(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim()
      .toLowerCase();
  }

  function displayStore(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim() || "Unknown";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseLastModified(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
    if (!match) return null;

    let hours = Number(match[4] || 0);
    const minutes = Number(match[5] || 0);
    const meridiem = String(match[6] || "").toUpperCase();
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;

    return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), hours, minutes);
  }

  function inFeedbackRange(row, range) {
    const date = parseLastModified(row["Last Modified"]);
    if (!date) return false;
    const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
    const end = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), 23, 59, 59, 999);
    return date >= start && date <= end;
  }

  function getHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  function buildWidgetShell() {
    widgetContainer.innerHTML = `
      <div class="widget-header">
        <div class="widget-title">Sales Dashboard</div>
        <div class="sales-dashboard-controls">
          <div class="widget-tabs" role="tablist" aria-label="Sales dashboard tabs">
            <button type="button" class="widget-tab active" data-tab="sales" role="tab" aria-selected="true">Sales Created</button>
            <button type="button" class="widget-tab" data-tab="feedback" role="tab" aria-selected="false">Customer Feedback</button>
          </div>
          <select id="salesDashboardStoreFilter" aria-label="Sales dashboard store filter">
            <option value="all">All stores</option>
          </select>
        </div>
      </div>
      <div class="widget-panel active" id="salesPanel">
        <div class="panel-content" id="salesPanelContent">
          <div class="loading">Loading sales created...</div>
        </div>
      </div>
      <div class="widget-panel" id="feedbackPanel">
        <div class="panel-content" id="feedbackPanelContent">
          <div class="loading">Loading customer feedback...</div>
        </div>
      </div>
    `;

    const tabs = widgetContainer.querySelectorAll(".widget-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const selectedTab = tab.dataset.tab;
        if (!selectedTab || state.activeTab === selectedTab) return;
        state.activeTab = selectedTab;
        tabs.forEach((btn) => {
          const isActive = btn.dataset.tab === selectedTab;
          btn.classList.toggle("active", isActive);
          btn.setAttribute("aria-selected", String(isActive));
        });
        widgetContainer.querySelectorAll(".widget-panel").forEach((panel) => {
          panel.classList.toggle("active", panel.id === `${selectedTab}Panel`);
        });
      });
    });

    const storeFilter = widgetContainer.querySelector("#salesDashboardStoreFilter");
    storeFilter?.addEventListener("change", (event) => {
      state.selectedStore = event.target.value;
      renderSalesPanel();
      renderFeedbackPanel();
    });
  }

  function renderSalesPanel() {
    const content = widgetContainer.querySelector("#salesPanelContent");
    if (!content) return;

    if (state.salesError) {
      content.innerHTML = `<div class="error">Error loading sales data</div>`;
      return;
    }

    const range = getRange();
    const orders = state.salesRows
      .filter((r) => inSalesRange(r, range))
      .filter((r) => state.selectedStore === "all" || normalize(r.Store) === state.selectedStore);

    if (!orders.length) {
      content.innerHTML = `<div class="widget-header">Sales Created (0 orders)</div><div class="no-data">No sales found for ${range.label.toLowerCase()}.</div>`;
      return;
    }

    const grouped = {};
    orders.forEach((row) => {
      const docNum = row["Document Number"];
      const internalId = row.InternalId;
      const amount = parseFloat(row.Amount) || 0;

      if (!grouped[docNum]) {
        grouped[docNum] = {
          docNum,
          internalId,
          store: row.Store,
          specialist: row["Bed Specialist"],
          total: 0,
        };
      }
      grouped[docNum].total += amount;
    });

    const groupedRows = Object.values(grouped).sort((a, b) => b.total - a.total);
    const documentCount = groupedRows.length;
    const totalRevenue = groupedRows.reduce((sum, row) => sum + row.total, 0);
    const averageOrderValue = documentCount ? totalRevenue / documentCount : 0;

    const table = document.createElement("table");
    table.className = "sales-today-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Document #</th>
          <th>Store</th>
          <th>Bed Specialist</th>
          <th>Total (\u00a3)</th>
        </tr>
      </thead>
      <tbody>
        ${groupedRows
          .map(
            (o) => `
          <tr>
            <td data-label="Document #">
              <a href="/sales/view/${encodeURIComponent(o.internalId)}" class="so-link">${escapeHtml(o.docNum)}</a>
            </td>
            <td data-label="Store">${escapeHtml(o.store)}</td>
            <td data-label="Bed Specialist">${escapeHtml(o.specialist)}</td>
            <td data-label="Total (\u00a3)" style="text-align:right;">\u00a3${o.total.toFixed(2)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    `;

    content.innerHTML = `
      <div class="widget-header">Sales Created (${documentCount} orders)</div>
      <div class="table-scroll"></div>
      <div class="sales-today-summary">
        <div><strong>Document count:</strong> ${documentCount}</div>
        <div><strong>Total revenue:</strong> \u00a3${totalRevenue.toFixed(2)}</div>
        <div><strong>Avg order value:</strong> \u00a3${averageOrderValue.toFixed(2)}</div>
      </div>
    `;
    content.querySelector(".table-scroll").appendChild(table);
  }

  function storeOptions() {
    const stores = new Map();
    state.salesRows.forEach((row) => {
      const key = normalize(row.Store);
      if (key && !stores.has(key)) stores.set(key, displayStore(row.Store));
    });

    state.feedbackRows.forEach((row) => {
      const key = normalize(row.Store);
      if (key && !stores.has(key)) stores.set(key, displayStore(row.Store));
    });

    return Array.from(stores.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function filteredFeedbackRows() {
    const range = getRange();
    return state.feedbackRows
      .filter((row) => state.selectedStore === "all" || normalize(row.Store) === state.selectedStore)
      .filter((row) => inFeedbackRange(row, range))
      .sort((a, b) => (parseLastModified(b["Last Modified"]) || 0) - (parseLastModified(a["Last Modified"]) || 0));
  }

  function renderStoreSelect() {
    const select = widgetContainer.querySelector("#salesDashboardStoreFilter");
    if (!select) return;

    const options = storeOptions();
    select.innerHTML = `
      <option value="all">All stores</option>
      ${options.map((store) => `<option value="${store.key}">${escapeHtml(store.label)}</option>`).join("")}
    `;
    select.value = state.selectedStore;
  }

  function renderFeedbackPanel() {
    const content = widgetContainer.querySelector("#feedbackPanelContent");
    if (!content) return;

    if (state.feedbackError) {
      content.innerHTML = `<div class="error">Error loading customer feedback</div>`;
      return;
    }

    const rows = filteredFeedbackRows();
    const count = rows.length;
    if (!rows.length) {
      content.innerHTML = `
        <div class="sales-panel-meta"><strong>0</strong> feedback responses in selected range</div>
        <div class="no-data">No customer feedback found for this selection.</div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="sales-panel-meta"><strong>${count}</strong> feedback responses in selected range</div>
      <div class="customer-feedback-body"></div>
    `;
    const body = widgetContainer.querySelector(".customer-feedback-body");
    if (!body) return;

    body.innerHTML = `
      <table class="customer-feedback-table">
        <thead>
          <tr>
            <th>Last Modified</th>
            <th>Store</th>
            <th>Bed Specialist</th>
            <th>Feedback</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `
            <tr>
              <td>${escapeHtml(row["Last Modified"])}</td>
              <td>${escapeHtml(displayStore(row.Store))}</td>
              <td>${escapeHtml(row["Bed Specialist"])}</td>
              <td>${escapeHtml(row["Detailed Feedback response"])}</td>
            </tr>
          `)
            .join("")}
        </tbody>
      </table>
    `;
  }

  async function loadWidgetData() {
    buildWidgetShell();

    const salesPromise = fetch(`/api/netsuite/widget-sales?refresh=1&_=${Date.now()}`, {
      headers: getHeaders(),
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.ok || !Array.isArray(data.results)) {
          throw new Error("Invalid or unexpected response format");
        }
        state.salesRows = data.results;
      })
      .catch((err) => {
        console.error("Failed to load sales created:", err);
        state.salesError = err;
      });

    const feedbackPromise = fetch(`/api/netsuite/customer-confirmation?refresh=1&_=${Date.now()}`, {
      headers: getHeaders(),
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.ok === false || !Array.isArray(data.results)) {
          throw new Error(data.error || "Invalid customer feedback response");
        }
        state.feedbackRows = data.results;
      })
      .catch((err) => {
        console.error("Failed to load customer feedback:", err);
        state.feedbackError = err;
      });

    await Promise.all([salesPromise, feedbackPromise]);
    renderStoreSelect();
    renderSalesPanel();
    renderFeedbackPanel();
  }

  window.addEventListener("dashboard:date-range-change", () => {
    renderSalesPanel();
    renderFeedbackPanel();
  });
  loadWidgetData();
});
