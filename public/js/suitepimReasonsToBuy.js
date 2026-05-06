(function () {
  const state = {
    environment: "production",
    fields: [],
    rows: [],
    filteredRows: [],
    baseline: new Map(),
    dirty: new Map(),
    options: new Map(),
    activeKey: "",
    modal: null,
  };

  const el = {};

  function initEls() {
    [
      "suitepimSearch",
      "suitepimStateFilter",
      "suitepimAddBtn",
      "suitepimRefreshBtn",
      "suitepimSaveBtn",
      "suitepimMount",
      "suitepimStatus",
      "suitepimPushReport",
      "suitepimTotalCount",
      "suitepimVisibleCount",
      "suitepimChangedCount",
      "suitepimNewCount",
      "suitepimModal",
      "suitepimModalTitle",
      "suitepimModalSearch",
      "suitepimModalOptions",
      "suitepimModalClose",
      "suitepimModalCancel",
      "suitepimModalSave",
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
    if (Array.isArray(value)) return value.join(", ");
    return String(value ?? "");
  }

  function imageProxyUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (url.startsWith("/api/suitepim/image-proxy")) return url;
    return `/api/suitepim/image-proxy?url=${encodeURIComponent(url)}`;
  }

  function iconThumb(row, label = "") {
    const proxied = imageProxyUrl(row?.IconUrl);
    if (!proxied) {
      return `<span class="suitepim-reasons-icon-fallback" aria-hidden="true">${escapeHtml(label || "Icon")}</span>`;
    }
    return `<img class="suitepim-reasons-icon-img" src="${escapeHtml(proxied)}" alt="${escapeHtml(label || row?.Icon || "Icon")}" loading="lazy" decoding="async">`;
  }

  function optionImageUrl(option) {
    const raw = option?.raw || {};
    return String(
      raw.url ||
      raw.URL ||
      raw.fileUrl ||
      raw.FileUrl ||
      raw.imageUrl ||
      raw.ImageUrl ||
      raw["File URL"] ||
      raw["Image URL"] ||
      ""
    ).trim();
  }

  function boolValue(value) {
    if (value === true || value === 1) return true;
    return ["true", "t", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
  }

  function rowKey(row, index = 0) {
    return String(row["Internal ID"] || row._suitepimKey || `new-${Date.now()}-${index}`);
  }

  function fieldByName(name) {
    return state.fields.find((field) => field.name === name);
  }

  function fieldUsesOptions(field) {
    return ["List/Record", "multiple-select", "image"].includes(field?.fieldType) || field?.hasOptions || field?.optionFeed;
  }

  function editableFields() {
    return state.fields.filter((field) => !field.disableField);
  }

  function activeRow() {
    return state.rows.find((row) => row._suitepimKey === state.activeKey) || null;
  }

  function stripInternal(row) {
    const copy = { ...row };
    delete copy._suitepimKey;
    delete copy._isNew;
    return copy;
  }

  function showStatus(message, type = "info") {
    el.suitepimStatus.textContent = message || "";
    el.suitepimStatus.dataset.type = type;
    el.suitepimStatus.hidden = !message;
  }

  function setLoading(message) {
    el.suitepimMount.innerHTML = `
      <div class="suitepim-loading">
        <div class="suitepim-spinner" aria-hidden="true"></div>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  async function api(path, options = {}) {
    const joiner = path.includes("?") ? "&" : "?";
    const url = `/api/suitepim${path}${joiner}environment=${encodeURIComponent(state.environment)}`;
    const headers = {
      ...authHeaders(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `SuitePim request failed: ${res.status}`);
    }
    return data;
  }

  async function loadConfig() {
    const data = await api("/reasons-to-buy/config");
    state.fields = data.fields || [];
  }

  async function loadRows() {
    setLoading("Loading Reasons To Buy...");
    showStatus("");
    state.rows = [];
    state.filteredRows = [];
    state.baseline.clear();
    state.dirty.clear();

    const data = await api("/reasons-to-buy");
    state.rows = (data.rows || []).map((row, index) => ({ ...row, _suitepimKey: rowKey(row, index) }));
    state.rows.forEach((row) => state.baseline.set(row._suitepimKey, JSON.stringify(stripInternal(row))));
    state.activeKey = state.rows[0]?._suitepimKey || "";
    applyFilters();
    showStatus(`Loaded ${state.rows.length.toLocaleString()} ${data.environment} records.`, "success");
  }

  function addRecord() {
    const row = {
      _suitepimKey: `new-${Date.now()}`,
      _isNew: true,
      "Internal ID": "",
      Name: "",
      Description: "",
      Icon: "",
      Icon_InternalId: "",
      IconUrl: "",
      "Icon Selector": "",
      "Icon Selector_InternalId": "",
      "Is Warranty Period": false,
      Items: [],
      Items_InternalId: [],
    };
    state.rows.unshift(row);
    state.baseline.set(row._suitepimKey, JSON.stringify({}));
    state.dirty.set(row._suitepimKey, row);
    state.activeKey = row._suitepimKey;
    el.suitepimStateFilter.value = "all";
    applyFilters();
  }

  function changedPayload(row) {
    const base = JSON.parse(state.baseline.get(row._suitepimKey) || "{}");
    const clean = stripInternal(row);
    if (row._isNew) return clean;

    const payload = {
      "Internal ID": clean["Internal ID"],
      Name: clean.Name,
    };

    Object.keys(clean).forEach((key) => {
      if (key === "Internal ID" || key === "Name") return;
      if (key.endsWith("_InternalId")) return;
      if (JSON.stringify(clean[key] ?? null) === JSON.stringify(base[key] ?? null)) return;

      payload[key] = clean[key];
      const internalIdKey = `${key}_InternalId`;
      if (clean[internalIdKey] !== undefined) payload[internalIdKey] = clean[internalIdKey];
    });

    return payload;
  }

  function updateDirty(row) {
    const clean = JSON.stringify(stripInternal(row));
    if (!row._isNew && clean === state.baseline.get(row._suitepimKey)) state.dirty.delete(row._suitepimKey);
    else state.dirty.set(row._suitepimKey, row);
  }

  function updateField(rowKeyValue, fieldName, value, internalIds, extras = null) {
    const idx = state.rows.findIndex((row) => row._suitepimKey === rowKeyValue);
    if (idx === -1) return;

    const updated = { ...state.rows[idx], ...(extras || {}), [fieldName]: value };
    if (internalIds !== undefined) updated[`${fieldName}_InternalId`] = internalIds;
    state.rows[idx] = updated;
    updateDirty(updated);
    applyFilters({ keepSelection: true });
  }

  function updateSummary() {
    el.suitepimTotalCount.textContent = state.rows.length.toLocaleString();
    el.suitepimVisibleCount.textContent = state.filteredRows.length.toLocaleString();
    el.suitepimChangedCount.textContent = state.dirty.size.toLocaleString();
    el.suitepimNewCount.textContent = state.rows.filter((row) => row._isNew).length.toLocaleString();
  }

  function rowMatchesSearch(row, search) {
    if (!search) return true;
    const haystack = [
      row["Internal ID"],
      row.Name,
      row.Description,
      row.Icon,
      row.IconUrl,
      row["Icon Selector"],
      row.Items,
    ].map(valueText).join(" ").toLowerCase();
    return haystack.includes(search);
  }

  function applyFilters({ keepSelection = false } = {}) {
    const search = el.suitepimSearch.value.trim().toLowerCase();
    const filter = el.suitepimStateFilter.value;

    state.filteredRows = state.rows.filter((row) => {
      if (filter === "changed" && !state.dirty.has(row._suitepimKey)) return false;
      if (filter === "new" && !row._isNew) return false;
      return rowMatchesSearch(row, search);
    });

    if (!keepSelection || (state.activeKey && !state.filteredRows.some((row) => row._suitepimKey === state.activeKey))) {
      state.activeKey = state.filteredRows[0]?._suitepimKey || state.rows[0]?._suitepimKey || "";
    }

    updateSummary();
    renderWorkspace();
  }

  function fieldSummary(row) {
    const bits = [];
    if (row["Is Warranty Period"]) bits.push("Warranty");
    const items = Array.isArray(row.Items) ? row.Items.length : String(row.Items || "").split(",").filter(Boolean).length;
    if (items) bits.push(`${items} item${items === 1 ? "" : "s"}`);
    if (row["Icon Selector"]) bits.push(row["Icon Selector"]);
    return bits.join(" | ") || "No extra values set";
  }

  function renderWorkspace() {
    if (!state.rows.length) {
      el.suitepimMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>No Reasons To Buy records loaded</h2>
          <p>Add a record or refresh once NetSuite data is available.</p>
        </div>
      `;
      return;
    }

    el.suitepimMount.innerHTML = `
      <div class="suitepim-reasons-layout">
        <aside class="suitepim-reasons-list" aria-label="Reasons To Buy records">
          <div class="suitepim-reasons-list-head">
            <h2>Records</h2>
            <span>${state.filteredRows.length.toLocaleString()}</span>
          </div>
          <div id="suitepimReasonsListBody" class="suitepim-reasons-list-body"></div>
        </aside>
        <section id="suitepimReasonsFormHost" class="suitepim-reasons-form-panel" aria-label="Edit Reasons To Buy record"></section>
      </div>
    `;

    renderList();
    renderForm();
  }

  function renderList() {
    const host = document.getElementById("suitepimReasonsListBody");
    if (!host) return;

    if (!state.filteredRows.length) {
      host.innerHTML = `<div class="suitepim-empty-option">No records match the current filter.</div>`;
      return;
    }

    host.innerHTML = state.filteredRows.map((row) => `
      <button class="suitepim-reasons-record ${row._suitepimKey === state.activeKey ? "active" : ""}" type="button" data-row-key="${escapeHtml(row._suitepimKey)}">
        <span class="suitepim-reasons-record-icon">${iconThumb(row, row.Name || "Icon")}</span>
        <span>
          <strong>${escapeHtml(row.Name || "Untitled record")}</strong>
          <small>${escapeHtml(fieldSummary(row))}</small>
        </span>
        ${state.dirty.has(row._suitepimKey) ? `<i>Changed</i>` : ""}
      </button>
    `).join("");

    host.querySelectorAll("[data-row-key]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeKey = button.dataset.rowKey || "";
        renderWorkspace();
      });
    });
  }

  function renderForm() {
    const host = document.getElementById("suitepimReasonsFormHost");
    const row = activeRow();
    if (!host) return;

    if (!row) {
      host.innerHTML = `
        <div class="suitepim-empty">
          <h2>No record selected</h2>
          <p>Select a record from the list or create a new one.</p>
        </div>
      `;
      return;
    }

    host.innerHTML = `
      <div class="suitepim-reasons-form-head">
        <div>
          <h2>${escapeHtml(row.Name || "New Reasons To Buy record")}</h2>
          <p>${row["Internal ID"] ? `Internal ID ${escapeHtml(row["Internal ID"])}` : "Unsaved NetSuite record"}</p>
        </div>
        <span class="${state.dirty.has(row._suitepimKey) ? "is-dirty" : ""}">${state.dirty.has(row._suitepimKey) ? "Changed" : "Saved"}</span>
      </div>
      <form id="suitepimReasonsForm" class="suitepim-reasons-form"></form>
    `;

    const form = document.getElementById("suitepimReasonsForm");
    editableFields().forEach((field) => {
      const label = document.createElement("label");
      label.className = field.fieldType === "Checkbox" ? "suitepim-reasons-check" : "";
      label.dataset.fieldType = field.fieldType || "Free-Form Text";

      if (field.fieldType === "Checkbox") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = boolValue(row[field.name]);
        input.addEventListener("change", () => updateField(row._suitepimKey, field.name, input.checked));
        const span = document.createElement("span");
        span.textContent = field.name;
        label.append(input, span);
        form.appendChild(label);
        return;
      }

      const caption = document.createElement("span");
      caption.textContent = field.required ? `${field.name} *` : field.name;
      label.appendChild(caption);
      label.appendChild(renderFieldControl(row, field));
      form.appendChild(label);
    });
  }

  function renderFieldControl(row, field) {
    const value = row[field.name];

    if (field.fieldType === "Text Area" || field.fieldType === "rich-text") {
      const textarea = document.createElement("textarea");
      textarea.rows = 5;
      textarea.value = valueText(value);
      textarea.addEventListener("input", () => updateField(row._suitepimKey, field.name, textarea.value));
      return textarea;
    }

    if (fieldUsesOptions(field)) {
      const wrap = document.createElement("div");
      wrap.className = "suitepim-reasons-picker-row";
      if (field.name === "Icon") {
        const preview = document.createElement("div");
        preview.className = "suitepim-reasons-icon-preview";
        preview.innerHTML = `
          <span class="suitepim-reasons-icon-preview-media">${iconThumb(row, row.Name || "Icon")}</span>
          <span class="suitepim-reasons-icon-preview-copy">
            <strong>${escapeHtml(valueText(value) || "No icon selected")}</strong>
            <small>${escapeHtml(row.IconUrl || "Choose an image file")}</small>
          </span>
        `;
        wrap.appendChild(preview);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-value-btn";
      if (field.fieldType === "multiple-select") {
        const count = Array.isArray(value) ? value.length : String(value || "").split(",").filter(Boolean).length;
        button.textContent = count ? `${count} selected` : "Select";
      } else {
        button.textContent = valueText(value) || "Select";
      }
      button.title = valueText(value);
      button.addEventListener("click", () => openOptionModal({ row, field, multiple: field.fieldType === "multiple-select" }));
      wrap.appendChild(button);

      if (valueText(value)) {
        const small = document.createElement("small");
        small.textContent = valueText(value);
        wrap.appendChild(small);
      }
      return wrap;
    }

    const input = document.createElement("input");
    input.type = ["Currency", "Decimal", "Integer", "Float", "Number"].includes(field.fieldType) ? "number" : "text";
    input.value = valueText(value);
    input.required = !!field.required;
    input.addEventListener("input", () => updateField(row._suitepimKey, field.name, input.value));
    return input;
  }

  async function ensureOptions(field) {
    if (!field.optionFeed && !field.hasOptions) return [];
    if (state.options.has(field.name)) return state.options.get(field.name);
    const data = await api(`/reasons-to-buy/options/${encodeURIComponent(field.name)}`);
    const options = data.options || [];
    state.options.set(field.name, options);
    return options;
  }

  async function openOptionModal({ row, field, multiple }) {
    showStatus(`Loading ${field.name} options...`);
    const options = await ensureOptions(field);
    showStatus("");

    const rawIds = row[`${field.name}_InternalId`];
    const selected = new Set(
      Array.isArray(rawIds)
        ? rawIds.map(String)
        : String(rawIds || "").split(",").map((item) => item.trim()).filter(Boolean)
    );

    state.modal = { rowKey: row._suitepimKey, field, multiple, options, selected };
    el.suitepimModalTitle.textContent = `Select ${field.name}`;
    el.suitepimModalSearch.value = "";
    el.suitepimModal.classList.remove("hidden");
    renderModalOptions();
  }

  function renderModalOptions() {
    const modal = state.modal;
    if (!modal) return;
    const term = el.suitepimModalSearch.value.trim().toLowerCase();
    const filtered = modal.options.filter((option) => option.name.toLowerCase().includes(term)).slice(0, 500);
    el.suitepimModalOptions.innerHTML = "";

    filtered.forEach((option) => {
      const label = document.createElement("label");
      label.className = "suitepim-modal-option";
      const input = document.createElement("input");
      input.type = modal.multiple ? "checkbox" : "radio";
      input.name = "suitepim-modal-option";
      input.checked = modal.selected.has(String(option.id));
      input.addEventListener("change", () => {
        if (!modal.multiple) modal.selected.clear();
        if (input.checked) modal.selected.add(String(option.id));
        else modal.selected.delete(String(option.id));
      });
      label.append(input, document.createTextNode(option.name));
      el.suitepimModalOptions.appendChild(label);
    });

    if (!filtered.length) {
      el.suitepimModalOptions.innerHTML = `<div class="suitepim-empty-option">No options found</div>`;
    }
  }

  function closeModal() {
    state.modal = null;
    el.suitepimModal.classList.add("hidden");
  }

  function saveModalSelection() {
    const modal = state.modal;
    if (!modal) return;

    const ids = Array.from(modal.selected);
    const selectedOptions = ids
      .map((id) => modal.options.find((option) => String(option.id) === String(id)))
      .filter(Boolean);
    const names = ids
      .map((id) => selectedOptions.find((option) => String(option.id) === String(id))?.name)
      .filter(Boolean);

    updateField(
      modal.rowKey,
      modal.field.name,
      modal.multiple ? names : names[0] || "",
      modal.multiple ? ids : ids[0] || "",
      modal.field.name === "Icon" ? { IconUrl: optionImageUrl(selectedOptions[0]) } : null
    );
    closeModal();
  }

  function renderSaveReport(data) {
    const results = data.results || [];
    if (!results.length) {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
      return;
    }

    const rows = results.map((result) => `
      <article class="suitepim-result-item" data-status="${escapeHtml(result.status)}">
        <div class="suitepim-result-title">
          <span>${escapeHtml(result.status)}</span>
          <span>${escapeHtml(result.name || result.internalId || "Reasons To Buy")}</span>
          <span>${escapeHtml(result.action || "")}</span>
        </div>
        <div class="suitepim-result-message">${escapeHtml(result.error || result.status || "")}</div>
        <details class="suitepim-result-details">
          <summary>Technical details</summary>
          <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
        </details>
      </article>
    `).join("");

    el.suitepimPushReport.hidden = false;
    el.suitepimPushReport.innerHTML = `
      <div class="suitepim-push-report-header">
        <h2>Save report: ${data.success || 0} successful, ${data.failed || 0} failed</h2>
        <button type="button" id="suitepimClearPushReport">Clear</button>
      </div>
      <div class="suitepim-result-list">${rows}</div>
    `;
    document.getElementById("suitepimClearPushReport")?.addEventListener("click", () => {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
    });
  }

  async function saveChanges() {
    const rows = Array.from(state.dirty.values()).map(changedPayload);
    if (!rows.length) {
      showStatus("No changed Reasons To Buy records to save.", "warning");
      return;
    }

    const missingName = rows.find((row) => !String(row.Name || "").trim());
    if (missingName) {
      showStatus("Every Reasons To Buy record needs a name before saving.", "warning");
      return;
    }

    el.suitepimSaveBtn.disabled = true;
    showStatus(`Saving ${rows.length.toLocaleString()} record(s)...`);
    try {
      const data = await api("/reasons-to-buy/save", {
        method: "POST",
        body: JSON.stringify({ rows, environment: state.environment }),
      });
      renderSaveReport(data);
      showStatus(`Save finished. ${data.success || 0} successful, ${data.failed || 0} failed.`, data.failed ? "warning" : "success");
      await loadRows();
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      el.suitepimSaveBtn.disabled = false;
    }
  }

  function bindEvents() {
    el.suitepimSearch.addEventListener("input", () => applyFilters());
    el.suitepimStateFilter.addEventListener("change", () => applyFilters());
    el.suitepimAddBtn.addEventListener("click", addRecord);
    el.suitepimRefreshBtn.addEventListener("click", () => loadRows().catch((err) => showStatus(err.message, "error")));
    el.suitepimSaveBtn.addEventListener("click", saveChanges);
    el.suitepimModalSearch.addEventListener("input", renderModalOptions);
    el.suitepimModalClose.addEventListener("click", closeModal);
    el.suitepimModalCancel.addEventListener("click", closeModal);
    el.suitepimModalSave.addEventListener("click", saveModalSelection);
  }

  async function boot() {
    try {
      await loadConfig();
      await loadRows();
    } catch (err) {
      console.error(err);
      showStatus(err.message, "error");
      el.suitepimMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>Reasons To Buy could not load</h2>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  window.addEventListener("DOMContentLoaded", async () => {
    initEls();
    bindEvents();
    await boot();
  });
})();
