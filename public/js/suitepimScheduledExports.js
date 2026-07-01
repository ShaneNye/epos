(function () {
  const state = {
    environment: "production",
    scheduledExports: [],
    itemLookup: new Map(),
  };
  const el = {};

  function initEls() {
    ["suitepimScheduleStatus", "suitepimScheduledRefresh", "suitepimScheduledStatus", "suitepimScheduledMount"].forEach((id) => {
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

  async function api(path, options = {}) {
    const response = await fetch(`/api/suitepim${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `SuitePim request failed: ${response.status}`);
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showStatus(message, type = "info") {
    el.suitepimScheduledStatus.textContent = message || "";
    el.suitepimScheduledStatus.hidden = !message;
    el.suitepimScheduledStatus.dataset.type = type;
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function changedColumns(rows) {
    const excluded = new Set(["Internal ID", "Item ID", "Record Type"]);
    const columns = [];
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (excluded.has(key) || key.startsWith("__") || key.endsWith("_InternalId")) return;
        if (!columns.includes(key)) columns.push(key);
      });
    });
    return columns;
  }

  function itemLookup(row) {
    return state.itemLookup.get(String(row?.["Internal ID"] || "").trim()) || {};
  }

  function itemName(row) {
    const lookup = itemLookup(row);
    return row?.__itemName || row?.Name || lookup.name || row?.["Item ID"] || row?.["Internal ID"] || "";
  }

  function itemId(row) {
    const lookup = itemLookup(row);
    return row?.["Item ID"] || row?.__itemId || lookup.itemId || "";
  }

  function displayValue(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value && typeof value === "object") return JSON.stringify(value);
    return value ?? "";
  }

  function renderPayloadTable(scheduledExport) {
    const rows = Array.isArray(scheduledExport.rows) ? scheduledExport.rows : [];
    const columns = changedColumns(rows);
    if (!rows.length) return `<div class="suitepim-empty">No items were saved for this scheduled push.</div>`;
    if (!columns.length) return `<div class="suitepim-empty">No changed fields were saved for this scheduled push.</div>`;

    return `
      <div class="suitepim-scheduled-table-wrap">
        <table class="suitepim-table suitepim-scheduled-table">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Internal ID</th>
              <th>Item ID</th>
              ${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(itemName(row))}</td>
                <td>${escapeHtml(row["Internal ID"])}</td>
                <td>${escapeHtml(itemId(row))}</td>
                ${columns.map((column) => `<td>${escapeHtml(displayValue(row[column]))}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function render() {
    const items = state.scheduledExports;
    if (!items.length) {
      el.suitepimScheduledMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>No scheduled pushes found</h2>
          <p>Scheduled pushes created from Item Management will appear here.</p>
        </div>
      `;
      return;
    }

    el.suitepimScheduledMount.innerHTML = `
      <div class="suitepim-scheduled-list">
        ${items.map((item) => `
          <details class="suitepim-scheduled-card" data-id="${item.id}">
            <summary>
              <span>
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.rowCount)} item${item.rowCount === 1 ? "" : "s"} scheduled for ${escapeHtml(formatDateTime(item.scheduledAt))}</small>
              </span>
              <span class="suitepim-scheduled-meta">${escapeHtml(item.status)}</span>
            </summary>
            <div class="suitepim-scheduled-details">
              ${item.jobId ? `<p>Job: ${escapeHtml(item.jobId)}</p>` : ""}
              ${item.error ? `<p class="suitepim-scheduled-error">${escapeHtml(item.error)}</p>` : ""}
              ${renderPayloadTable(item)}
            </div>
          </details>
        `).join("")}
      </div>
    `;
  }

  async function loadScheduledExports() {
    showStatus("Loading scheduled pushes...", "info");
    el.suitepimScheduledRefresh.disabled = true;
    try {
      const status = el.suitepimScheduleStatus.value || "pending";
      const data = await api(`/scheduled-exports?environment=${encodeURIComponent(state.environment)}&status=${encodeURIComponent(status)}`);
      state.scheduledExports = data.scheduledExports || [];
      await loadItemLookup();
      render();
      showStatus(`Loaded ${state.scheduledExports.length.toLocaleString()} ${data.environment} scheduled push(es).`, "success");
    } catch (err) {
      el.suitepimScheduledMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>Scheduled exports could not load</h2>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
      showStatus(err.message, "error");
    } finally {
      el.suitepimScheduledRefresh.disabled = false;
    }
  }

  async function loadItemLookup() {
    if (state.itemLookup.size) return;
    try {
      const data = await api(`/web-management?environment=${encodeURIComponent(state.environment)}`);
      state.itemLookup = new Map(
        (data.rows || [])
          .map((row) => [
            String(row?.["Internal ID"] || "").trim(),
            {
              name: row?.Name || row?.["Display Name"] || row?.["Item ID"] || "",
              itemId: row?.["Item ID"] || "",
            },
          ])
          .filter(([internalId]) => internalId)
      );
    } catch (err) {
      console.warn("SuitePim scheduled export item lookup failed:", err.message);
    }
  }

  function bindEvents() {
    el.suitepimScheduleStatus.addEventListener("change", loadScheduledExports);
    el.suitepimScheduledRefresh.addEventListener("click", loadScheduledExports);
  }

  window.addEventListener("DOMContentLoaded", () => {
    initEls();
    bindEvents();
    loadScheduledExports();
  });
})();
