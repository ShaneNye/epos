// public/js/widgets/customerFeedback.js
console.log("Customer Feedback Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("customerFeedbackWidget");
  if (!widget) return;

  let feedbackRows = [];
  let selectedStore = "all";

  function getHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
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

  function getRange() {
    return window.DashboardDateFilter?.getRange() || {
      label: "Today",
      start: new Date(),
      end: new Date(),
    };
  }

  function inRange(row, range) {
    const date = parseLastModified(row["Last Modified"]);
    if (!date) return false;
    const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
    const end = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), 23, 59, 59, 999);
    return date >= start && date <= end;
  }

  function storeOptions() {
    const stores = new Map();
    feedbackRows.forEach((row) => {
      const key = normalize(row.Store);
      if (key && !stores.has(key)) stores.set(key, displayStore(row.Store));
    });

    return Array.from(stores.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function filteredRows() {
    const range = getRange();
    return feedbackRows
      .filter((row) => selectedStore === "all" || normalize(row.Store) === selectedStore)
      .filter((row) => inRange(row, range))
      .sort((a, b) => (parseLastModified(b["Last Modified"]) || 0) - (parseLastModified(a["Last Modified"]) || 0));
  }

  function renderStoreSelect() {
    const select = widget.querySelector("#customerFeedbackStore");
    if (!select) return;

    const options = storeOptions();
    select.innerHTML = `
      <option value="all">All stores</option>
      ${options.map((store) => `<option value="${store.key}">${escapeHtml(store.label)}</option>`).join("")}
    `;
    select.value = selectedStore;
  }

  function renderRows() {
    const rows = filteredRows();
    const body = widget.querySelector(".customer-feedback-body");
    const count = widget.querySelector("[data-feedback-count]");
    if (count) count.textContent = String(rows.length);
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = `<div class="no-data">No customer feedback found for this selection.</div>`;
      return;
    }

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
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row["Last Modified"])}</td>
              <td>${escapeHtml(displayStore(row.Store))}</td>
              <td>${escapeHtml(row["Bed Specialist"])}</td>
              <td>${escapeHtml(row["Detailed Feedback response"])}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderShell() {
    widget.innerHTML = `
      <div class="customer-feedback-header">
        <div>
          <div class="widget-header">Customer Feedback</div>
          <span><strong data-feedback-count>0</strong> responses in selected range</span>
        </div>
        <select id="customerFeedbackStore" aria-label="Customer feedback store"></select>
      </div>
      <div class="customer-feedback-body"></div>
    `;

    renderStoreSelect();
    renderRows();

    widget.querySelector("#customerFeedbackStore").addEventListener("change", (event) => {
      selectedStore = event.target.value;
      renderRows();
    });
  }

  async function loadFeedback() {
    widget.innerHTML = `<div class="loading">Loading customer feedback...</div>`;

    try {
      const res = await fetch(`/api/netsuite/customer-confirmation?refresh=1&_=${Date.now()}`, {
        headers: getHeaders(),
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok || data.ok === false || !Array.isArray(data.results)) {
        throw new Error(data.error || "Invalid customer feedback response");
      }

      feedbackRows = data.results;
      renderShell();
    } catch (err) {
      console.error("Failed to load customer feedback:", err);
      widget.innerHTML = `<div class="error">Error loading customer feedback</div>`;
    }
  }

  window.addEventListener("dashboard:date-range-change", renderRows);
  loadFeedback();
});
