(function () {
  const state = {
    environment: "production",
    jsonFields: [],
    mappings: [],
    search: "",
  };

  const el = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function initEls() {
    [
      "suitepimSettingsStatus",
      "suitepimSettingsNetsuite",
      "suitepimSettingsWoo",
      "suitepimMappingsTable",
      "suitepimSaveMappings",
      "suitepimMappingSearch",
      "suitepimUnmappedJsonField",
      "suitepimAddMappingRow",
    ].forEach((id) => {
      el[id] = byId(id);
    });
    el.tabs = Array.from(document.querySelectorAll(".suitepim-settings-tabs button"));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showStatus(message, type = "info") {
    if (!el.suitepimSettingsStatus) return;
    el.suitepimSettingsStatus.textContent = message || "";
    el.suitepimSettingsStatus.className = `suitepim-status ${type}`;
  }

  function savedEnvironment() {
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      return String(saved?.env || "").toLowerCase() === "production" ? "production" : "sandbox";
    } catch {
      return "production";
    }
  }

  async function api(path, options = {}) {
    const url = `/api/suitepim${path}${path.includes("?") ? "&" : "?"}environment=${encodeURIComponent(state.environment)}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function jsonFieldOptions(selected) {
    const values = new Set(state.jsonFields);
    if (selected) values.add(selected);
    return Array.from(values)
      .sort((a, b) => a.localeCompare(b))
      .map((field) => `<option value="${escapeHtml(field)}" ${field === selected ? "selected" : ""}>${escapeHtml(field)}</option>`)
      .join("");
  }

  function mappedJsonFields() {
    return new Set(state.mappings.map((mapping) => String(mapping.jsonField || "").trim()).filter(Boolean));
  }

  function unmappedJsonFields() {
    const mapped = mappedJsonFields();
    return state.jsonFields.filter((field) => field && !mapped.has(field));
  }

  function renderUnmappedPicker() {
    if (!el.suitepimUnmappedJsonField) return;
    const fields = unmappedJsonFields();
    el.suitepimUnmappedJsonField.innerHTML = `
      <option value="">Choose unmapped JSON field</option>
      ${fields.map((field) => `<option value="${escapeHtml(field)}">${escapeHtml(field)}</option>`).join("")}
    `;
    if (el.suitepimAddMappingRow) el.suitepimAddMappingRow.disabled = !fields.length;
  }

  function filteredMappings() {
    const term = state.search.trim().toLowerCase();
    if (!term) return state.mappings.map((mapping, index) => ({ mapping, index }));
    return state.mappings
      .map((mapping, index) => ({ mapping, index }))
      .filter(({ mapping }) => {
        const haystack = [
          mapping.mappingKey,
          mapping.jsonField,
          mapping.internalid,
          mapping.fieldType,
          mapping.defaultInternalid,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
  }

  function renderMappings() {
    if (!el.suitepimMappingsTable) return;
    const rows = filteredMappings();
    renderUnmappedPicker();

    if (!rows.length) {
      el.suitepimMappingsTable.innerHTML = `<div class="suitepim-settings-empty">No NetSuite field mappings found.</div>`;
      return;
    }

    el.suitepimMappingsTable.innerHTML = `
      <table class="suitepim-settings-table">
        <thead>
          <tr>
            <th>Existing mapping</th>
            <th>JSON data field</th>
            <th>NetSuite item field internal ID</th>
            <th>Type</th>
            <th>Default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              ({ mapping, index }) => `
                <tr data-index="${index}">
                  <td>
                    <strong>${escapeHtml(mapping.mappingKey)}</strong>
                    ${mapping.custom ? `<small>Added from saved-search JSON</small>` : ""}
                    ${mapping.optionFeed ? `<small>Option feed: ${escapeHtml(mapping.optionFeed)}</small>` : ""}
                  </td>
                  <td>
                    <select data-field="jsonField" aria-label="JSON field for ${escapeHtml(mapping.mappingKey)}">
                      ${jsonFieldOptions(mapping.jsonField)}
                    </select>
                  </td>
                  <td>
                    <input data-field="internalid" type="text" value="${escapeHtml(mapping.internalid || "")}" placeholder="custitem_field_id" aria-label="NetSuite internal ID for ${escapeHtml(mapping.mappingKey)}">
                  </td>
                  <td>
                    <input data-field="fieldType" type="text" value="${escapeHtml(mapping.fieldType || "")}" aria-label="Field type for ${escapeHtml(mapping.mappingKey)}">
                  </td>
                  <td><code>${escapeHtml(mapping.defaultInternalid || "")}</code></td>
                  <td>
                    ${
                      mapping.custom
                        ? `<button class="suitepim-settings-remove-row" type="button" data-action="remove-row" aria-label="Remove ${escapeHtml(mapping.jsonField)} mapping">Remove</button>`
                        : ""
                    }
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function collectMappings() {
    return state.mappings.map((mapping) => ({
      mappingKey: mapping.mappingKey,
      jsonField: mapping.jsonField,
      internalid: mapping.internalid || "",
      fieldType: mapping.fieldType || "",
      optionFeed: mapping.optionFeed || "",
    }));
  }

  function updateMappingFromControl(control) {
    const row = control?.closest("tr");
    const index = Number(row?.dataset.index);
    const field = control?.dataset.field;
    if (!Number.isInteger(index) || !field || !state.mappings[index]) return;
    state.mappings[index][field] = control.value;
    if (field === "jsonField" && state.mappings[index].custom) {
      state.mappings[index].mappingKey = `custom:${control.value}`;
      state.mappings[index].defaultJsonField = control.value;
    }
    renderUnmappedPicker();
  }

  function addMappingRow() {
    const jsonField = el.suitepimUnmappedJsonField?.value || "";
    if (!jsonField) return;
    state.mappings.push({
      mappingKey: `custom:${jsonField}`,
      defaultJsonField: jsonField,
      jsonField,
      internalid: "",
      fieldType: "Free-Form Text",
      optionFeed: "",
      defaultInternalid: "",
      defaultFieldType: "Free-Form Text",
      custom: true,
    });
    state.search = "";
    if (el.suitepimMappingSearch) el.suitepimMappingSearch.value = "";
    renderMappings();
  }

  function removeMappingRow(row) {
    const index = Number(row?.dataset.index);
    if (!Number.isInteger(index) || !state.mappings[index]?.custom) return;
    state.mappings.splice(index, 1);
    renderMappings();
  }

  async function loadSettings() {
    showStatus("Loading SuitePIM settings...", "info");
    const data = await api("/settings");
    state.jsonFields = data.jsonFields || [];
    state.mappings = data.mappings || [];
    renderMappings();
    showStatus(`Loaded ${state.mappings.length.toLocaleString()} NetSuite mapping(s).`, "success");
  }

  async function saveMappings() {
    const mappings = collectMappings();
    el.suitepimSaveMappings.disabled = true;
    showStatus("Saving NetSuite mappings...", "info");
    try {
      const data = await api("/settings/netsuite-mappings", {
        method: "POST",
        body: JSON.stringify({ environment: state.environment, mappings }),
      });
      state.mappings = data.mappings || mappings;
      state.jsonFields = data.jsonFields || state.jsonFields;
      renderMappings();
      showStatus("NetSuite mappings saved. Item Management and pushes will use these mappings.", "success");
    } finally {
      el.suitepimSaveMappings.disabled = false;
    }
  }

  function setTab(tab) {
    const isWoo = tab === "woocommerce";
    el.suitepimSettingsNetsuite.hidden = isWoo;
    el.suitepimSettingsWoo.hidden = !isWoo;
    el.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  }

  function bindEvents() {
    el.tabs.forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.tab));
    });
    el.suitepimSaveMappings.addEventListener("click", () => {
      saveMappings().catch((err) => showStatus(err.message, "error"));
    });
    el.suitepimMappingSearch.addEventListener("input", () => {
      state.search = el.suitepimMappingSearch.value || "";
      renderMappings();
    });
    el.suitepimAddMappingRow.addEventListener("click", addMappingRow);
    el.suitepimMappingsTable.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='remove-row']");
      if (!button) return;
      removeMappingRow(button.closest("tr"));
    });
    el.suitepimMappingsTable.addEventListener("input", (event) => {
      updateMappingFromControl(event.target.closest("[data-field]"));
    });
    el.suitepimMappingsTable.addEventListener("change", (event) => {
      updateMappingFromControl(event.target.closest("[data-field]"));
      renderMappings();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    state.environment = savedEnvironment();
    initEls();
    bindEvents();
    loadSettings().catch((err) => showStatus(err.message, "error"));
  });
})();
