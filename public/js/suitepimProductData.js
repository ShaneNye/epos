(function () {
  const state = {
    environment: "production",
    fields: [],
    rows: [],
    filteredRows: [],
    visibleColumns: [],
    baseline: new Map(),
    dirty: new Map(),
    selected: new Set(),
    options: new Map(),
    activeFilters: [],
    filterDraft: null,
    bulkDraft: null,
    page: 1,
    pageSize: 50,
    modal: null,
  };

  const toolFields = [
    { name: "Retail Price", fieldType: "Currency", toolColumn: true },
    { name: "Margin", fieldType: "Decimal", toolColumn: true },
  ];

  const el = {};

  function initEls() {
    [
      "suitepimSearch",
      "suitepimStateFilter",
      "suitepimFilterField",
      "suitepimFilterValueHost",
      "suitepimAddFilterBtn",
      "suitepimClearFiltersBtn",
      "suitepimActiveFilters",
      "suitepimBulkField",
      "suitepimBulkMode",
      "suitepimBulkValueHost",
      "suitepimBulkScope",
      "suitepimApplyBulkBtn",
      "suitepimToggleFiltersBtn",
      "suitepimToggleBulkBtn",
      "suitepimColumnsBtn",
      "suitepimRefreshBtn",
      "suitepimPushBtn",
      "suitepimMount",
      "suitepimStatus",
      "suitepimPushReport",
      "suitepimTotalCount",
      "suitepimVisibleCount",
      "suitepimSelectedCount",
      "suitepimChangedCount",
      "suitepimPrevPage",
      "suitepimNextPage",
      "suitepimPageLabel",
      "suitepimColumnsPanel",
      "suitepimCloseColumns",
      "suitepimColumnList",
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

  function fieldByName(name) {
    return state.fields.find((field) => field.name === name);
  }

  function rowKey(row, index = 0) {
    return String(row["Internal ID"] || row["Item ID"] || row.Name || `row-${index}`);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function boolValue(value) {
    if (value === true || value === 1) return true;
    return ["true", "t", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
  }

  function isCalculatedPriceField(column) {
    return ["Purchase Price", "Base Price", "Retail Price", "Margin"].includes(column);
  }

  function isBulkPricingField(column) {
    return ["Purchase Price", "Base Price", "Retail Price", "Margin"].includes(column);
  }

  function recalcRow(row, changedField) {
    const updated = { ...row };
    const vat = 0.2;
    let purchase = parseFloat(updated["Purchase Price"]) || 0;
    let base = parseFloat(updated["Base Price"]) || 0;
    let retail = parseFloat(updated["Retail Price"]) || 0;
    let margin = parseFloat(updated["Margin"]) || 0;

    if (changedField === "Base Price" && base > 0) {
      retail = base * (1 + vat);
      if (purchase > 0) margin = retail / purchase;
    } else if (changedField === "Retail Price" && retail > 0) {
      base = retail / (1 + vat);
      if (purchase > 0) margin = retail / purchase;
    } else if (changedField === "Margin" && purchase > 0 && margin > 0) {
      retail = purchase * margin;
      base = retail / (1 + vat);
    } else if (changedField === "Purchase Price" && purchase > 0 && retail > 0) {
      margin = retail / purchase;
    } else if (base > 0) {
      retail = base * (1 + vat);
      if (purchase > 0) margin = retail / purchase;
    }

    updated["Purchase Price"] = purchase.toFixed(2);
    updated["Base Price"] = base.toFixed(2);
    updated["Retail Price"] = Math.round(retail);
    updated["Margin"] = margin.toFixed(1);
    return updated;
  }

  function showStatus(message, type = "info") {
    if (!el.suitepimStatus) return;
    el.suitepimStatus.textContent = message || "";
    el.suitepimStatus.dataset.type = type;
    el.suitepimStatus.hidden = !message;
  }

  function compactError(result) {
    const response = result?.response || {};
    if (response.error) return response.error;
    const priceError = Array.isArray(response.prices)
      ? response.prices.find((price) => price && price.success === false)?.error
      : null;
    if (priceError) return priceError;
    if (response.main?.error) return typeof response.main.error === "string" ? response.main.error : JSON.stringify(response.main.error);
    if (response.main?.["o:errorDetails"]) return JSON.stringify(response.main["o:errorDetails"]);
    if (response.main?.raw) return response.main.raw;
    return result?.status || "No error detail returned";
  }

  function renderPushReport(job) {
    const results = job.results || [];
    if (!el.suitepimPushReport) return;
    if (!results.length) {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
      return;
    }

    const success = results.filter((result) => result.status === "Success").length;
    const failed = results.filter((result) => result.status === "Error").length;
    const skipped = results.filter((result) => result.status === "Skipped").length;

    const rows = results.map((result) => {
      const details = JSON.stringify(result, null, 2);
      return `
        <article class="suitepim-result-item" data-status="${escapeHtml(result.status)}">
          <div class="suitepim-result-title">
            <span>${escapeHtml(result.status)}</span>
            <span>${escapeHtml(result.itemId || result.internalId || "Unknown item")}</span>
            ${result.recordType ? `<span>${escapeHtml(result.recordType)}</span>` : ""}
          </div>
          <div class="suitepim-result-message">${escapeHtml(compactError(result))}</div>
          <details class="suitepim-result-details">
            <summary>Technical details</summary>
            <pre>${escapeHtml(details)}</pre>
          </details>
        </article>
      `;
    }).join("");

    el.suitepimPushReport.hidden = false;
    el.suitepimPushReport.innerHTML = `
      <div class="suitepim-push-report-header">
        <h2>Push report: ${success} successful, ${failed} failed, ${skipped} skipped</h2>
        <button type="button" id="suitepimClearPushReport">Clear</button>
      </div>
      <div class="suitepim-result-list">${rows}</div>
    `;
    document.getElementById("suitepimClearPushReport")?.addEventListener("click", () => {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
    });
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
    const config = await api("/config");
    state.fields = [...config.fields, ...toolFields];
    state.visibleColumns = [
      "Name",
      "Display Name",
      "Supplier Name",
      "Class",
      "Purchase Price",
      "Base Price",
      "Retail Price",
      "Margin",
      "Lead Time",
      "Inactive",
    ];
    renderFieldSelectors();
    renderColumnChooser();
    renderFilterValueControl();
    renderBulkValueControl();
    renderActiveFilters();
  }

  async function loadProducts() {
    setLoading("Loading ProductData...");
    showStatus("");
    state.rows = [];
    state.filteredRows = [];
    state.baseline.clear();
    state.dirty.clear();
    state.selected.clear();
    state.page = 1;

    const data = await api("/products");
    state.rows = (data.rows || []).map((row, index) => ({ ...row, _suitepimKey: rowKey(row, index) }));
    state.rows.forEach((row) => state.baseline.set(row._suitepimKey, JSON.stringify(stripInternal(row))));
    applyFilters();
    showStatus(`Loaded ${state.rows.length.toLocaleString()} ${data.environment} records.`, "success");
  }

  function stripInternal(row) {
    const copy = { ...row };
    delete copy._suitepimKey;
    return copy;
  }

  function baselineRow(key) {
    try {
      return JSON.parse(state.baseline.get(key) || "{}");
    } catch {
      return {};
    }
  }

  function changedPayload(row) {
    const base = baselineRow(row._suitepimKey);
    const clean = stripInternal(row);
    const payload = {
      "Internal ID": clean["Internal ID"],
      "Item ID": clean["Item ID"],
      "Name": clean.Name,
      "Record Type": clean["Record Type"],
    };

    Object.keys(clean).forEach((key) => {
      if (key === "Internal ID" || key === "Item ID" || key === "Name") return;
      if (key.endsWith("_InternalId")) return;
      if (JSON.stringify(clean[key] ?? null) === JSON.stringify(base[key] ?? null)) return;

      payload[key] = clean[key];
      const internalIdKey = `${key}_InternalId`;
      if (clean[internalIdKey] !== undefined) payload[internalIdKey] = clean[internalIdKey];
    });

    return payload;
  }

  function editableFields() {
    return state.fields.filter((field) => !field.disableField || ["Retail Price", "Margin"].includes(field.name));
  }

  function renderFieldOptions(select, placeholder, fields = state.fields) {
    select.innerHTML = `<option value="">${placeholder}</option>`;
    fields.forEach((field) => {
      const option = document.createElement("option");
      option.value = field.name;
      option.textContent = field.name;
      select.appendChild(option);
    });
  }

  function renderFieldSelectors() {
    renderFieldOptions(el.suitepimFilterField, "Choose field", state.fields);
    renderFieldOptions(el.suitepimBulkField, "Choose field", editableFields());
  }

  function renderColumnChooser() {
    el.suitepimColumnList.innerHTML = "";
    state.fields.forEach((field) => {
      const label = document.createElement("label");
      label.className = "suitepim-column-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.visibleColumns.includes(field.name);
      input.addEventListener("change", () => {
        if (input.checked && !state.visibleColumns.includes(field.name)) state.visibleColumns.push(field.name);
        if (!input.checked) state.visibleColumns = state.visibleColumns.filter((name) => name !== field.name);
        renderTable();
      });
      label.append(input, document.createTextNode(field.name));
      el.suitepimColumnList.appendChild(label);
    });
  }

  function valueText(value) {
    if (Array.isArray(value)) return value.join(", ");
    return String(value ?? "");
  }

  function fieldUsesOptions(field) {
    return ["List/Record", "multiple-select", "image"].includes(field?.fieldType) || field?.hasOptions || field?.optionFeed;
  }

  function optionNameById(field, id) {
    const options = state.options.get(field.name) || [];
    return options.find((option) => String(option.id) === String(id))?.name || "";
  }

  function filterLabel(filter) {
    const field = fieldByName(filter.fieldName) || {};
    if (filter.valueLabel) return filter.valueLabel;
    if (Array.isArray(filter.value)) return filter.value.join(", ");
    if (field.fieldType === "Checkbox") return filter.value === "true" ? "Checked" : "Unchecked";
    return valueText(filter.value);
  }

  function controlPlaceholder(field) {
    if (!field) return "Choose field first";
    if (field.fieldType === "Checkbox") return "";
    if (field.fieldType === "Currency") return "Enter amount";
    if (["Decimal", "Integer", "Float", "Number"].includes(field.fieldType)) return "Enter number";
    if (fieldUsesOptions(field)) return "Select value";
    return "Type value";
  }

  function emptyControl(host, text = "Choose a field first") {
    host.innerHTML = `<div class="suitepim-muted-note">${escapeHtml(text)}</div>`;
  }

  function createOptionButton({ field, multiple, value = null, valueLabel = "", onChange }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suitepim-value-btn";

    const setLabel = () => {
      if (multiple) {
        const names = Array.isArray(valueLabel) ? valueLabel : String(valueLabel || "").split(",").filter(Boolean);
        button.textContent = names.length ? `${names.length} selected` : "Select";
        button.title = names.join(", ");
      } else {
        button.textContent = valueLabel || "Select";
        button.title = valueLabel || "";
      }
    };

    setLabel();
    button.addEventListener("click", async () => {
      showStatus(`Loading ${field.name} options...`);
      const options = await ensureOptions(field);
      showStatus("");
      const selected = new Set(
        multiple
          ? Array.isArray(value) ? value.map(String) : String(value || "").split(",").filter(Boolean)
          : value ? [String(value)] : []
      );

      state.modal = {
        field,
        multiple,
        options,
        selected,
        onSave(ids, names) {
          value = multiple ? ids : ids[0] || "";
          valueLabel = multiple ? names : names[0] || "";
          setLabel();
          onChange(value, valueLabel);
        },
      };
      el.suitepimModalTitle.textContent = `Select ${field.name}`;
      el.suitepimModalSearch.value = "";
      el.suitepimModal.classList.remove("hidden");
      renderModalOptions();
    });

    return button;
  }

  async function renderTypedControl({ host, field, mode, currentValue = null, currentLabel = "", onChange }) {
    host.innerHTML = "";
    if (!field) {
      emptyControl(host);
      return;
    }

    const fieldType = field.fieldType || "Free-Form Text";

    if (fieldType === "Checkbox") {
      const select = document.createElement("select");
      select.innerHTML = `
        <option value="">Any</option>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      `;
      select.value = currentValue ?? "";
      select.addEventListener("change", () => onChange(select.value, select.selectedOptions[0]?.textContent || ""));
      host.appendChild(select);
      return;
    }

    if (fieldUsesOptions(field)) {
      if (mode === "filter" && fieldType === "List/Record") {
        const select = document.createElement("select");
        select.innerHTML = `<option value="">All</option>`;
        host.appendChild(select);
        const options = await ensureOptions(field);
        options.forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.name;
          opt.dataset.internalid = option.id;
          opt.textContent = option.name;
          select.appendChild(opt);
        });
        select.value = currentValue || "";
        select.addEventListener("change", () => {
          const selected = select.selectedOptions[0];
          onChange(select.value, selected?.textContent || "", selected?.dataset.internalid || "");
        });
        return;
      }

      const multiple = fieldType === "multiple-select";
      host.appendChild(createOptionButton({
        field,
        multiple,
        value: currentValue,
        valueLabel: currentLabel,
        onChange,
      }));
      return;
    }

    if (fieldType === "rich-text") {
      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.placeholder = controlPlaceholder(field);
      textarea.value = currentValue ?? "";
      textarea.addEventListener("input", () => onChange(textarea.value, textarea.value));
      host.appendChild(textarea);
      return;
    }

    const input = document.createElement("input");
    input.type = ["Currency", "Decimal", "Integer", "Float", "Number"].includes(fieldType) ? "number" : "search";
    input.step = fieldType === "Currency" ? "0.01" : "0.1";
    input.placeholder = controlPlaceholder(field);
    input.value = currentValue ?? "";
    input.addEventListener("input", () => onChange(input.value, input.value));
    host.appendChild(input);
  }

  function renderActiveFilters() {
    el.suitepimActiveFilters.innerHTML = "";
    if (!state.activeFilters.length) {
      el.suitepimActiveFilters.innerHTML = `<div class="suitepim-muted-note">No field filters applied</div>`;
      return;
    }

    state.activeFilters.forEach((filter, index) => {
      const chip = document.createElement("div");
      chip.className = "suitepim-filter-chip";
      chip.innerHTML = `<span>${escapeHtml(filter.fieldName)}: ${escapeHtml(filterLabel(filter))}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "x";
      remove.setAttribute("aria-label", `Remove ${filter.fieldName} filter`);
      remove.addEventListener("click", () => {
        state.activeFilters.splice(index, 1);
        state.page = 1;
        renderActiveFilters();
        applyFilters();
      });
      chip.appendChild(remove);
      el.suitepimActiveFilters.appendChild(chip);
    });
  }

  function renderFilterValueControl() {
    const field = fieldByName(el.suitepimFilterField.value);
    state.filterDraft = { fieldName: field?.name || "", value: "", valueLabel: "", internalId: "" };
    renderTypedControl({
      host: el.suitepimFilterValueHost,
      field,
      mode: "filter",
      onChange(value, valueLabel, internalId = "") {
        state.filterDraft = {
          fieldName: field.name,
          value,
          valueLabel,
          internalId,
        };
      },
    }).catch((err) => showStatus(err.message, "error"));
  }

  function renderBulkValueControl() {
    const field = fieldByName(el.suitepimBulkField.value);
    const isPricing = isBulkPricingField(field?.name);
    el.suitepimBulkMode.hidden = !isPricing;
    el.suitepimBulkMode.disabled = !isPricing;
    el.suitepimBulkMode.closest(".suitepim-bulk-row")?.classList.toggle("is-pricing", isPricing);
    state.bulkDraft = {
      fieldName: field?.name || "",
      mode: isPricing ? el.suitepimBulkMode.value : "set",
      value: "",
      valueLabel: "",
      internalIds: null,
    };
    renderTypedControl({
      host: el.suitepimBulkValueHost,
      field,
      mode: "bulk",
      onChange(value, valueLabel) {
        state.bulkDraft = {
          fieldName: field.name,
          mode: isBulkPricingField(field.name) ? el.suitepimBulkMode.value : "set",
          value: field.fieldType === "Checkbox" ? value === "true" : value,
          valueLabel,
          internalIds: fieldUsesOptions(field) ? value : null,
        };
      },
    }).catch((err) => showStatus(err.message, "error"));
  }

  function addFilter() {
    const draft = state.filterDraft;
    if (!draft?.fieldName || draft.value === "" || draft.value == null || (Array.isArray(draft.value) && !draft.value.length)) {
      showStatus("Choose a filter field and value first.", "warning");
      return;
    }

    state.activeFilters.push({ ...draft });
    el.suitepimFilterField.value = "";
    renderFilterValueControl();
    state.page = 1;
    renderActiveFilters();
    applyFilters();
  }

  function clearFilters() {
    state.activeFilters = [];
    state.page = 1;
    renderActiveFilters();
    applyFilters();
  }

  function matchesFieldFilter(row, filter) {
    const field = fieldByName(filter.fieldName) || {};
    const raw = row[filter.fieldName];

    if (field.fieldType === "Checkbox") {
      if (!filter.value) return true;
      return boolValue(raw) === (filter.value === "true");
    }

    if (field.fieldType === "List/Record") {
      return valueText(raw).toLowerCase() === String(filter.valueLabel || filter.value).toLowerCase();
    }

    if (field.fieldType === "multiple-select") {
      const names = Array.isArray(raw) ? raw.map((item) => String(item).toLowerCase()) : valueText(raw).toLowerCase().split(",");
      const wanted = Array.isArray(filter.valueLabel)
        ? filter.valueLabel.map((item) => String(item).toLowerCase())
        : String(filter.valueLabel || filter.value).toLowerCase().split(",");
      return wanted.every((value) => names.some((name) => name.trim() === value.trim()));
    }

    if (field.fieldType === "image") {
      return valueText(raw).toLowerCase() === String(filter.valueLabel || filter.value).toLowerCase();
    }

    return valueText(raw).toLowerCase().includes(String(filter.value).toLowerCase());
  }

  function applyFilters() {
    const search = el.suitepimSearch.value.trim().toLowerCase();
    const stateFilter = el.suitepimStateFilter.value;

    state.filteredRows = state.rows.filter((row) => {
      if (search) {
        const haystack = [
          row["Internal ID"],
          row["Item ID"],
          row.Name,
          row["Display Name"],
          row["Supplier Name"],
          row.Class,
          row["Sub-Class"],
        ].map(valueText).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (stateFilter === "active" && boolValue(row.Inactive)) return false;
      if (stateFilter === "inactive" && !boolValue(row.Inactive)) return false;
      if (stateFilter === "parent" && !boolValue(row["Is Parent"])) return false;
      if (stateFilter === "changed" && !state.dirty.has(row._suitepimKey)) return false;
      if (stateFilter === "selected" && !state.selected.has(row._suitepimKey)) return false;

      if (!state.activeFilters.every((filter) => matchesFieldFilter(row, filter))) return false;

      return true;
    });

    const maxPage = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
    if (state.page > maxPage) state.page = maxPage;
    updateSummary();
    renderTable();
  }

  function updateSummary() {
    el.suitepimTotalCount.textContent = state.rows.length.toLocaleString();
    el.suitepimVisibleCount.textContent = state.filteredRows.length.toLocaleString();
    el.suitepimSelectedCount.textContent = state.selected.size.toLocaleString();
    el.suitepimChangedCount.textContent = state.dirty.size.toLocaleString();
  }

  function pageRows() {
    const start = (state.page - 1) * state.pageSize;
    return state.filteredRows.slice(start, start + state.pageSize);
  }

  function renderTable() {
    if (!state.rows.length) {
      el.suitepimMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>No ProductData records loaded</h2>
          <p>Use refresh once the SuitePim feed is available.</p>
        </div>
      `;
      return;
    }

    const rows = pageRows();
    const columns = state.visibleColumns.filter((name) => fieldByName(name));
    const maxPage = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
    el.suitepimPageLabel.textContent = `Page ${state.page} of ${maxPage}`;
    el.suitepimPrevPage.disabled = state.page <= 1;
    el.suitepimNextPage.disabled = state.page >= maxPage;

    const table = document.createElement("table");
    table.className = "suitepim-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th class="suitepim-select-col"><input id="suitepimSelectPage" type="checkbox" aria-label="Select page"></th>
          ${columns.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.key = row._suitepimKey;
      if (boolValue(row["Is Parent"])) tr.classList.add("is-parent");
      if (boolValue(row.Inactive)) tr.classList.add("is-inactive");
      if (state.dirty.has(row._suitepimKey)) tr.classList.add("is-dirty");

      const selectTd = document.createElement("td");
      selectTd.className = "suitepim-select-col";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selected.has(row._suitepimKey);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selected.add(row._suitepimKey);
        else state.selected.delete(row._suitepimKey);
        updateSummary();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      columns.forEach((column) => {
        const td = document.createElement("td");
        td.dataset.column = column;
        td.appendChild(renderCell(row, column));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    el.suitepimMount.innerHTML = "";
    el.suitepimMount.appendChild(table);

    const pageSelector = table.querySelector("#suitepimSelectPage");
    pageSelector.checked = rows.length > 0 && rows.every((row) => state.selected.has(row._suitepimKey));
    pageSelector.addEventListener("change", () => {
      rows.forEach((row) => {
        if (pageSelector.checked) state.selected.add(row._suitepimKey);
        else state.selected.delete(row._suitepimKey);
      });
      updateSummary();
      renderTable();
    });
  }

  function renderCell(row, column) {
    const field = fieldByName(column) || {};
    const value = row[column];

    if (field.disableField || field.fieldType === "Link") {
      const div = document.createElement("div");
      div.className = "suitepim-readonly";
      div.innerHTML = field.fieldType === "Link" && /<a\s/i.test(String(value || ""))
        ? String(value)
        : escapeHtml(valueText(value));
      return div;
    }

    if (field.fieldType === "Checkbox") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = boolValue(value);
      input.addEventListener("change", () => updateCell(row, column, input.checked));
      return input;
    }

    if (field.fieldType === "List/Record" || field.fieldType === "image") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-value-btn";
      button.textContent = valueText(value) || "Select";
      button.addEventListener("click", () => openOptionModal({ row, field, multiple: false }));
      return button;
    }

    if (field.fieldType === "multiple-select") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-value-btn";
      const count = Array.isArray(value) ? value.length : 0;
      button.textContent = count ? `${count} selected` : "Select";
      button.title = valueText(value);
      button.addEventListener("click", () => openOptionModal({ row, field, multiple: true }));
      return button;
    }

    if (field.fieldType === "rich-text" || String(value || "").length > 80) {
      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.value = valueText(value);
      textarea.addEventListener("input", () => updateCell(row, column, textarea.value));
      return textarea;
    }

    const input = document.createElement("input");
    input.type = ["Currency", "Decimal", "Integer", "Float", "Number"].includes(field.fieldType) ? "number" : "text";
    input.step = field.fieldType === "Currency" ? "0.01" : "0.1";
    input.value = valueText(value);
    input.addEventListener("input", () => updateCell(row, column, input.value));
    if (isCalculatedPriceField(column)) {
      let lastCommittedValue = input.value;
      const commit = () => {
        if (input.value === lastCommittedValue) return;
        lastCommittedValue = input.value;
        updateCell(row, column, input.value, null, { recalc: true });
      };
      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);
    }
    return input;
  }

  function updateRenderedRow(rowKeyValue, updatedRow, changedColumn) {
    const tr = el.suitepimMount.querySelector(`tr[data-key="${CSS.escape(rowKeyValue)}"]`);
    if (!tr) return;
    tr.classList.toggle("is-dirty", state.dirty.has(rowKeyValue));

    ["Purchase Price", "Base Price", "Retail Price", "Margin"].forEach((fieldName) => {
      if (fieldName === changedColumn || !state.visibleColumns.includes(fieldName)) return;
      const cell = tr.querySelector(`[data-column="${CSS.escape(fieldName)}"]`);
      if (!cell) return;
      const editable = cell.querySelector("input, textarea, button, select");
      if (editable === document.activeElement) return;
      cell.replaceChildren(renderCell(updatedRow, fieldName));
    });
  }

  function updateCell(row, column, value, internalIds = null, options = {}) {
    const idx = state.rows.findIndex((item) => item._suitepimKey === row._suitepimKey);
    if (idx === -1) return;

    let updated = { ...state.rows[idx], [column]: value };
    if (internalIds !== null) updated[`${column}_InternalId`] = internalIds;

    if (options.recalc && isCalculatedPriceField(column)) {
      updated = recalcRow(updated, column);
    }

    state.rows[idx] = updated;
    const clean = JSON.stringify(stripInternal(updated));
    if (clean === state.baseline.get(updated._suitepimKey)) state.dirty.delete(updated._suitepimKey);
    else state.dirty.set(updated._suitepimKey, updated);
    state.selected.add(updated._suitepimKey);
    updateSummary();
    updateRenderedRow(updated._suitepimKey, updated, column);
  }

  async function ensureOptions(field) {
    if (!field.optionFeed && !field.hasOptions) return [];
    if (state.options.has(field.name)) return state.options.get(field.name);
    const data = await api(`/options/${encodeURIComponent(field.name)}`);
    const options = data.options || [];
    state.options.set(field.name, options);
    return options;
  }

  async function openOptionModal({ row, field, multiple }) {
    showStatus(`Loading ${field.name} options...`);
    const options = await ensureOptions(field);
    showStatus("");
    const currentIds = Array.isArray(row[`${field.name}_InternalId`])
      ? row[`${field.name}_InternalId`].map(String)
      : row[`${field.name}_InternalId`] ? [String(row[`${field.name}_InternalId`])] : [];
    const selected = new Set(currentIds);

    state.modal = { row, field, multiple, options, selected };
    el.suitepimModalTitle.textContent = `Select ${field.name}`;
    el.suitepimModalSearch.value = "";
    el.suitepimModal.classList.remove("hidden");
    renderModalOptions();
  }

  function renderModalOptions() {
    const modal = state.modal;
    if (!modal) return;
    const term = el.suitepimModalSearch.value.trim().toLowerCase();
    const filtered = modal.options.filter((option) => option.name.toLowerCase().includes(term));
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
    const names = ids
      .map((id) => modal.options.find((option) => String(option.id) === String(id))?.name)
      .filter(Boolean);

    if (typeof modal.onSave === "function") {
      modal.onSave(ids, names);
      closeModal();
      return;
    }

    updateCell(modal.row, modal.field.name, modal.multiple ? names : names[0] || "", modal.multiple ? ids : ids[0] || "");
    closeModal();
  }

  function applyBulkUpdate() {
    const field = fieldByName(state.bulkDraft?.fieldName);
    if (!field) {
      showStatus("Choose a bulk action field first.", "warning");
      return;
    }

    const draft = state.bulkDraft;
    const hasValue = Array.isArray(draft.value)
      ? draft.value.length > 0
      : draft.value !== "" && draft.value !== null && draft.value !== undefined;
    if (!hasValue) {
      showStatus("Choose a bulk action value first.", "warning");
      return;
    }

    const targetRows = el.suitepimBulkScope.value === "filtered"
      ? [...state.filteredRows]
      : state.rows.filter((row) => state.selected.has(row._suitepimKey));

    if (!targetRows.length) {
      showStatus("No rows match the selected bulk action scope.", "warning");
      return;
    }

    targetRows.forEach((row) => {
      const idx = state.rows.findIndex((item) => item._suitepimKey === row._suitepimKey);
      if (idx === -1) return;

      let value = draft.value;
      let internalIds = draft.internalIds;
      if (fieldUsesOptions(field)) {
        value = field.fieldType === "multiple-select"
          ? Array.isArray(draft.valueLabel) ? draft.valueLabel : String(draft.valueLabel || "").split(",").filter(Boolean)
          : draft.valueLabel || optionNameById(field, draft.value) || "";
      }

      let updated = { ...state.rows[idx], [field.name]: value };
      if (internalIds !== null && internalIds !== undefined) {
        updated[`${field.name}_InternalId`] = internalIds;
      }

      if (isBulkPricingField(field.name)) {
        const oldValue = parseFloat(state.rows[idx][field.name]) || 0;
        const amount = parseFloat(draft.value);
        if (!Number.isFinite(amount)) return;

        if (draft.mode === "add-value") {
          updated[field.name] = oldValue + amount;
        } else if (draft.mode === "add-percent") {
          updated[field.name] = oldValue * (1 + amount / 100);
        } else {
          updated[field.name] = amount;
        }
      }

      if (isCalculatedPriceField(field.name)) {
        updated = recalcRow(updated, field.name);
      }

      state.rows[idx] = updated;
      const clean = JSON.stringify(stripInternal(updated));
      if (clean === state.baseline.get(updated._suitepimKey)) state.dirty.delete(updated._suitepimKey);
      else state.dirty.set(updated._suitepimKey, updated);
      state.selected.add(updated._suitepimKey);
    });

    state.page = 1;
    applyFilters();
    showStatus(`Bulk update applied to ${targetRows.length.toLocaleString()} row(s). Review and push changes when ready.`, "success");
  }

  function togglePanel(button) {
    const panel = button.closest(".suitepim-collapsible");
    if (!panel) return;
    const collapsed = panel.classList.toggle("is-collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
  }

  async function pushSelected() {
    const rows = state.rows
      .filter((row) => state.selected.has(row._suitepimKey) && state.dirty.has(row._suitepimKey))
      .map(changedPayload);
    if (!rows.length) {
      showStatus("Select at least one changed row to push.", "warning");
      return;
    }

    el.suitepimPushBtn.disabled = true;
    if (el.suitepimPushReport) {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
    }
    showStatus(`Queueing ${rows.length} selected row(s)...`, "info");

    try {
      const data = await api("/push-updates", {
        method: "POST",
        body: JSON.stringify({ rows, environment: state.environment }),
      });
      pollJob(data.jobId);
    } catch (err) {
      showStatus(err.message, "error");
      el.suitepimPushBtn.disabled = false;
    }
  }

  async function pollJob(jobId) {
    const timer = setInterval(async () => {
      try {
        const job = await api(`/push-status/${jobId}`);
        showStatus(`Push ${job.status}: ${job.processed}/${job.total} processed`, job.status === "completed" ? "success" : "info");
        if (job.status === "completed" || job.status === "error") {
          clearInterval(timer);
          el.suitepimPushBtn.disabled = false;
          const ok = (job.results || []).filter((result) => result.status === "Success").length;
          const failed = (job.results || []).filter((result) => result.status === "Error").length;
          showStatus(`Push finished. ${ok} successful, ${failed} failed.`, failed ? "warning" : "success");
          renderPushReport(job);
        }
      } catch (err) {
        clearInterval(timer);
        el.suitepimPushBtn.disabled = false;
        showStatus(err.message, "error");
      }
    }, 2500);
  }

  function bindEvents() {
    el.suitepimSearch.addEventListener("input", () => {
      state.page = 1;
      applyFilters();
    });
    el.suitepimStateFilter.addEventListener("change", () => {
      state.page = 1;
      applyFilters();
    });
    el.suitepimFilterField.addEventListener("change", renderFilterValueControl);
    el.suitepimAddFilterBtn.addEventListener("click", addFilter);
    el.suitepimClearFiltersBtn.addEventListener("click", clearFilters);
    el.suitepimBulkField.addEventListener("change", renderBulkValueControl);
    el.suitepimBulkMode.addEventListener("change", () => {
      if (state.bulkDraft) state.bulkDraft.mode = el.suitepimBulkMode.value;
    });
    el.suitepimApplyBulkBtn.addEventListener("click", applyBulkUpdate);
    el.suitepimToggleFiltersBtn.addEventListener("click", () => togglePanel(el.suitepimToggleFiltersBtn));
    el.suitepimToggleBulkBtn.addEventListener("click", () => togglePanel(el.suitepimToggleBulkBtn));
    el.suitepimRefreshBtn.addEventListener("click", () => loadProducts().catch((err) => showStatus(err.message, "error")));
    el.suitepimPushBtn.addEventListener("click", pushSelected);
    el.suitepimPrevPage.addEventListener("click", () => {
      state.page = Math.max(1, state.page - 1);
      renderTable();
    });
    el.suitepimNextPage.addEventListener("click", () => {
      const maxPage = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
      state.page = Math.min(maxPage, state.page + 1);
      renderTable();
    });
    el.suitepimColumnsBtn.addEventListener("click", () => {
      el.suitepimColumnsPanel.classList.add("open");
      el.suitepimColumnsPanel.setAttribute("aria-hidden", "false");
    });
    el.suitepimCloseColumns.addEventListener("click", () => {
      el.suitepimColumnsPanel.classList.remove("open");
      el.suitepimColumnsPanel.setAttribute("aria-hidden", "true");
    });
    el.suitepimModalSearch.addEventListener("input", renderModalOptions);
    el.suitepimModalClose.addEventListener("click", closeModal);
    el.suitepimModalCancel.addEventListener("click", closeModal);
    el.suitepimModalSave.addEventListener("click", saveModalSelection);
  }

  async function boot() {
    try {
      state.options.clear();
      state.activeFilters = [];
      await loadConfig();
      await loadProducts();
    } catch (err) {
      console.error(err);
      showStatus(err.message, "error");
      el.suitepimMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>ProductData could not load</h2>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  window.addEventListener("DOMContentLoaded", async () => {
    initEls();
    state.environment = "production";
    bindEvents();
    await boot();
  });
})();
