(function () {
  const state = {
    environment: "production",
    fields: [],
    rows: [],
    filteredRows: [],
  };

  const el = {};

  function initEls() {
    [
      "suitepimValidationSearch",
      "suitepimValidationState",
      "suitepimValidationRefresh",
      "suitepimValidationPush",
      "suitepimValidationTotal",
      "suitepimValidationMissingRows",
      "suitepimValidationMissingFields",
      "suitepimValidationVisible",
      "suitepimValidationStatus",
      "suitepimValidationReport",
      "suitepimValidationMount",
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

  function valueText(value) {
    return String(value ?? "");
  }

  function isPresent(value) {
    if (value === true || value === "T" || value === "true") return true;
    if (value === false || value === "F" || value === "false") return false;
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function defaultValue(field, internalId) {
    return field.defaultValue === "internalid" ? String(internalId) : field.defaultValue;
  }

  async function api(path, options = {}) {
    const joiner = path.includes("?") ? "&" : "?";
    const response = await fetch(`/api/suitepim${path}${joiner}environment=${state.environment}`, {
      ...options,
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `SuitePim request failed (${response.status})`);
    return data;
  }

  function showStatus(message, type = "info") {
    el.suitepimValidationStatus.textContent = message || "";
    el.suitepimValidationStatus.dataset.type = type;
    el.suitepimValidationStatus.hidden = !message;
  }

  function setLoading(message) {
    el.suitepimValidationMount.innerHTML = `
      <div class="suitepim-loading">
        <div class="suitepim-spinner" aria-hidden="true"></div>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  async function loadValidation() {
    setLoading("Loading validation data...");
    showStatus("");
    const config = await api("/validation/config");
    state.fields = config.fields || [];
    const data = await api("/validation");
    state.rows = data.rows || [];
    applyFilters();
    showStatus(`Loaded ${state.rows.length.toLocaleString()} ${data.environment} validation records.`, "success");
  }

  function rowMissingFields(row) {
    if (Array.isArray(row.missingFields)) return row.missingFields;
    return state.fields.filter((field) => !isPresent(row[field.name])).map((field) => field.name);
  }

  function applyFilters() {
    const term = el.suitepimValidationSearch.value.trim().toLowerCase();
    const mode = el.suitepimValidationState.value;

    state.filteredRows = state.rows.filter((row) => {
      const missingCount = rowMissingFields(row).length;
      if (mode === "missing" && missingCount === 0) return false;
      if (mode === "complete" && missingCount > 0) return false;
      if (term) {
        const haystack = [row.Name, row.name, row.internalid, row["Internal ID"], row.id].map(valueText).join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    updateSummary();
    renderTable();
  }

  function updateSummary() {
    const missingRows = state.rows.filter((row) => rowMissingFields(row).length > 0).length;
    const missingFields = state.rows.reduce((sum, row) => sum + rowMissingFields(row).length, 0);
    el.suitepimValidationTotal.textContent = state.rows.length.toLocaleString();
    el.suitepimValidationMissingRows.textContent = missingRows.toLocaleString();
    el.suitepimValidationMissingFields.textContent = missingFields.toLocaleString();
    el.suitepimValidationVisible.textContent = state.filteredRows.length.toLocaleString();
  }

  function renderTable() {
    if (!state.rows.length) {
      el.suitepimValidationMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>No validation records loaded</h2>
          <p>Use refresh once the SuitePim validation feed is available.</p>
        </div>
      `;
      return;
    }

    const table = document.createElement("table");
    table.className = "suitepim-table suitepim-validation-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Name</th>
          <th>Internal ID</th>
          <th>Missing</th>
          ${state.fields.map((field) => `<th>${escapeHtml(field.name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    state.filteredRows.forEach((row) => {
      const missing = new Set(rowMissingFields(row));
      const tr = document.createElement("tr");
      if (missing.size) tr.classList.add("is-dirty");
      tr.innerHTML = `
        <td>${escapeHtml(row.Name || row.name || "")}</td>
        <td>${escapeHtml(row.internalid || row["Internal ID"] || row.id || "")}</td>
        <td><span class="suitepim-validation-count">${missing.size}</span></td>
        ${state.fields.map((field) => {
          const ok = !missing.has(field.name);
          return `<td><span class="suitepim-validation-pill ${ok ? "is-valid" : "is-missing"}">${ok ? "OK" : "Missing"}</span></td>`;
        }).join("")}
      `;
      tbody.appendChild(tr);
    });

    el.suitepimValidationMount.innerHTML = "";
    el.suitepimValidationMount.appendChild(table);
  }

  function buildValidationPayload() {
    return state.rows
      .map((row) => {
        const internalId = row.internalid || row["Internal ID"] || row.id;
        const fields = {};
        if (!internalId) return null;

        state.fields.forEach((field) => {
          if (isPresent(row[field.name])) return;
          fields[field.internalid] = defaultValue(field, internalId);
        });

        if (!Object.keys(fields).length) return null;
        return {
          internalid: String(internalId),
          Name: row.Name || row.name || "",
          recordType: row["Record Type"] || row.recordType || "",
          fields,
        };
      })
      .filter(Boolean);
  }

  function renderReport(job) {
    const results = job.results || [];
    if (!results.length) {
      el.suitepimValidationReport.hidden = true;
      el.suitepimValidationReport.innerHTML = "";
      return;
    }

    const success = results.filter((result) => result.status === "Success").length;
    const failed = results.filter((result) => result.status === "Error").length;
    const skipped = results.filter((result) => result.status === "Skipped").length;
    el.suitepimValidationReport.hidden = false;
    el.suitepimValidationReport.innerHTML = `
      <div class="suitepim-result-summary">
        <strong>Validation push report</strong>
        <span>${success} successful</span>
        <span>${failed} failed</span>
        <span>${skipped} skipped</span>
      </div>
      ${results.map((result) => `
        <article class="suitepim-result-item" data-status="${escapeHtml(result.status)}">
          <div class="suitepim-result-title">
            <span>${escapeHtml(result.status)}</span>
            <span>${escapeHtml(result.itemId || result.internalId || "Unknown item")}</span>
            ${result.recordType ? `<span>${escapeHtml(result.recordType)}</span>` : ""}
          </div>
          <div class="suitepim-result-message">${escapeHtml(result.response?.error || result.status)}</div>
          <details class="suitepim-result-details">
            <summary>Technical details</summary>
            <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
          </details>
        </article>
      `).join("")}
    `;
  }

  async function pushMissingData() {
    const rows = buildValidationPayload();
    if (!rows.length) {
      showStatus("No missing validation fields to push.", "success");
      return;
    }

    el.suitepimValidationPush.disabled = true;
    el.suitepimValidationReport.hidden = true;
    el.suitepimValidationReport.innerHTML = "";
    showStatus(`Queueing ${rows.length.toLocaleString()} validation row(s)...`, "info");

    try {
      const data = await api("/push-validation", {
        method: "POST",
        body: JSON.stringify({ rows, environment: state.environment }),
      });
      pollJob(data.jobId);
    } catch (err) {
      showStatus(err.message, "error");
      el.suitepimValidationPush.disabled = false;
    }
  }

  function pollJob(jobId) {
    const timer = setInterval(async () => {
      try {
        const job = await api(`/push-status/${jobId}`);
        showStatus(`Validation push ${job.status}: ${job.processed}/${job.total} processed`, job.status === "completed" ? "success" : "info");
        if (job.status === "completed" || job.status === "error") {
          clearInterval(timer);
          el.suitepimValidationPush.disabled = false;
          renderReport(job);
        }
      } catch (err) {
        clearInterval(timer);
        el.suitepimValidationPush.disabled = false;
        showStatus(err.message, "error");
      }
    }, 2500);
  }

  function bindEvents() {
    el.suitepimValidationSearch.addEventListener("input", applyFilters);
    el.suitepimValidationState.addEventListener("change", applyFilters);
    el.suitepimValidationRefresh.addEventListener("click", () => loadValidation().catch((err) => showStatus(err.message, "error")));
    el.suitepimValidationPush.addEventListener("click", pushMissingData);
  }

  window.addEventListener("DOMContentLoaded", async () => {
    initEls();
    bindEvents();
    await loadValidation().catch((err) => {
      console.error(err);
      showStatus(err.message, "error");
      el.suitepimValidationMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>Validation data could not load</h2>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    });
  });
})();
