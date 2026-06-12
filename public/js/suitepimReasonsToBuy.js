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
    refreshPopup: null,
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

  function stripHtml(value) {
    return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function splitMultiValue(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || "").split(/[\u0005,]/).map((item) => item.trim()).filter(Boolean);
  }

  function extractImageUrl(value) {
    if (!value) return "";
    const text = String(value || "");
    const imgMatch = text.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];
    const hrefMatch = text.match(/<a[^>]+href=["']([^"']+)["']/i);
    if (hrefMatch) return hrefMatch[1];
    const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
    return urlMatch ? urlMatch[0] : "";
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

  function iconLabel(row, fallback = "Selected icon") {
    return valueText(row?.Icon || row?.["Icon Selector"] || fallback);
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
    return state.fields.filter((field) => !field.disableField && field.name !== "Icon Selector");
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

  function refreshFilteredRows() {
    const search = el.suitepimSearch.value.trim().toLowerCase();
    const filter = el.suitepimStateFilter.value;

    state.filteredRows = state.rows.filter((row) => {
      if (filter === "changed" && !state.dirty.has(row._suitepimKey)) return false;
      if (filter === "new" && !row._isNew) return false;
      return rowMatchesSearch(row, search);
    });
  }

  function refreshActiveFormMeta() {
    const row = activeRow();
    const head = document.querySelector(".suitepim-reasons-form-head");
    if (!row || !head) return;

    const title = head.querySelector("h2");
    const status = head.querySelector("span");
    if (title) title.textContent = row.Name || "New Reasons To Buy record";
    if (status) {
      const isDirty = state.dirty.has(row._suitepimKey);
      status.className = isDirty ? "is-dirty" : "";
      status.textContent = isDirty ? "Changed" : "Saved";
    }
  }

  function updateField(rowKeyValue, fieldName, value, internalIds, extras = null, options = {}) {
    const idx = state.rows.findIndex((row) => row._suitepimKey === rowKeyValue);
    if (idx === -1) return;

    const updated = { ...state.rows[idx], ...(extras || {}), [fieldName]: value };
    if (internalIds !== undefined) updated[`${fieldName}_InternalId`] = internalIds;
    state.rows[idx] = updated;
    updateDirty(updated);

    if (options.render === false) {
      refreshFilteredRows();
      updateSummary();
      renderList();
      refreshActiveFormMeta();
      return;
    }

    applyFilters({ keepSelection: true });
  }

  function updateSummary() {
    return {
      total: state.rows.length,
      visible: state.filteredRows.length,
      changed: state.dirty.size,
      newRecords: state.rows.filter((row) => row._isNew).length,
    };
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
    refreshFilteredRows();

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
      textarea.addEventListener("input", () => updateField(row._suitepimKey, field.name, textarea.value, undefined, null, { render: false }));
      return textarea;
    }

    if (fieldUsesOptions(field)) {
      const wrap = document.createElement("div");
      wrap.className = field.name === "Icon" ? "suitepim-reasons-icon-field" : "suitepim-reasons-picker-row";
      if (field.name === "Icon") {
        const hasIcon = !!imageProxyUrl(row.IconUrl);
        const preview = document.createElement("div");
        preview.className = "suitepim-reasons-icon-preview";
        preview.innerHTML = `
          <span class="suitepim-reasons-icon-preview-media">${hasIcon ? iconThumb(row, row.Name || "Selected icon") : `<span class="suitepim-reasons-icon-empty">No icon</span>`}</span>
        `;
        wrap.appendChild(preview);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-value-btn";
      if (field.fieldType === "multiple-select") {
        const count = Array.isArray(value) ? value.length : String(value || "").split(",").filter(Boolean).length;
        button.textContent = count ? `${count} selected` : "Select";
      } else if (field.name === "Icon") {
        button.textContent = "Select image";
      } else {
        button.textContent = valueText(value) || "Select";
      }
      button.title = valueText(value);
      button.addEventListener("click", () => openOptionModal({ row, field, multiple: field.fieldType === "multiple-select" }));
      wrap.appendChild(button);

      if (valueText(value) && field.name !== "Icon") {
        const small = document.createElement("small");
        small.textContent = valueText(value);
        wrap.appendChild(small);
      }
      if (field.name === "Items") {
        const items = splitMultiValue(value);
        const list = document.createElement("div");
        list.className = "suitepim-reasons-items-list";
        list.innerHTML = items.length
          ? `
            <strong>${items.length.toLocaleString()} item${items.length === 1 ? "" : "s"} using this icon</strong>
            <div>${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
          `
          : `<strong>No linked items</strong>`;
        wrap.appendChild(list);
      }
      return wrap;
    }

    const input = document.createElement("input");
    input.type = ["Currency", "Decimal", "Integer", "Float", "Number"].includes(field.fieldType) ? "number" : "text";
    input.value = valueText(value);
    input.required = !!field.required;
    input.addEventListener("input", () => updateField(row._suitepimKey, field.name, input.value, undefined, null, { render: false }));
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
      label.className = modal.field.name === "Icon" ? "suitepim-modal-option suitepim-modal-option-image" : "suitepim-modal-option";
      const input = document.createElement("input");
      input.type = modal.multiple ? "checkbox" : "radio";
      input.name = "suitepim-modal-option";
      input.checked = modal.selected.has(String(option.id));
      input.addEventListener("change", () => {
        if (!modal.multiple) modal.selected.clear();
        if (input.checked) modal.selected.add(String(option.id));
        else modal.selected.delete(String(option.id));
      });
      if (modal.field.name === "Icon") {
        const imageUrl = imageProxyUrl(optionImageUrl(option));
        const media = document.createElement("span");
        media.className = "suitepim-modal-image";
        media.innerHTML = imageUrl
          ? `<img class="suitepim-image-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(option.name)}" loading="lazy" decoding="async">`
          : `<span class="suitepim-image-fallback">No image</span>`;
        const copy = document.createElement("span");
        copy.className = "suitepim-modal-copy";
        copy.innerHTML = `<strong>${escapeHtml(option.name)}</strong>`;
        label.append(input, media, copy);
      } else {
        label.append(input, document.createTextNode(option.name));
      }
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

  function optionIconUrl(option = {}) {
    const raw = option.raw || {};
    return extractImageUrl(raw["Icon URL"] || raw.IconUrl || raw.iconUrl || raw.icon_url || raw.Icon || raw.icon || raw.Image || raw.image || "");
  }

  function reasonOptionsForRows(options = []) {
    const byId = new Map();
    const byName = new Map();
    options.forEach((option) => {
      const raw = option.raw || {};
      const meta = {
        id: String(option.id || raw["Internal ID"] || "").trim(),
        name: String(option.name || raw.Name || raw.name || "").trim(),
        description: String(raw.Description || raw.description || raw["Item Description"] || "").trim(),
        iconUrl: optionIconUrl(option),
        isWarrantyPeriod: boolValue(raw["Is Warranty Period"]),
      };
      if (meta.id) byId.set(meta.id, meta);
      if (meta.name) byName.set(meta.name.toLowerCase(), meta);
    });
    return { byId, byName };
  }

  function itemReasons(row, reasonLookup) {
    const names = splitMultiValue(row["reasons to buy"]);
    const ids = splitMultiValue(row["reasons to buy_InternalId"]);
    return names.map((name, index) => {
      const id = ids[index] || "";
      const matched = reasonLookup.byId.get(id) || reasonLookup.byName.get(String(name).toLowerCase()) || {};
      return {
        id: id || matched.id || "",
        name: matched.name || name,
        description: matched.description || "",
        iconUrl: matched.iconUrl || "",
        isWarrantyPeriod: matched.isWarrantyPeriod === true,
        order: index + 1,
      };
    }).filter((item) => item.name);
  }

  function renderReasonListHtml(items, emptyMessage) {
    if (!items.length) return `<div style="margin:0; color:#64748b; font-size:13px;">${escapeHtml(emptyMessage || "No content added yet.")}</div>`;
    return `
      <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px 28px;">
        ${items.map((item) => `
          <div style="display:grid; grid-template-columns:84px minmax(0, 1fr); gap:14px; align-items:start; min-width:0;">
            <div style="width:84px; height:70px; display:block; overflow:hidden; color:#ffffff; font-weight:700;">
              ${item.iconUrl ? `<img src="${escapeHtml(item.iconUrl)}" alt="${escapeHtml(item.name)} icon" style="width:104px; height:104px; max-width:none; object-fit:contain; object-position:center top; display:block; border:0; background:transparent; margin-left:-10px;">` : `<span style="width:56px; height:56px; border-radius:999px; background:#0b7aa6; color:#ffffff; display:inline-flex; align-items:center; justify-content:center; font-weight:700;">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span>`}
            </div>
            <div style="min-width:0;">
              <strong style="display:block; color:#16324f; margin:0 0 3px; font-size:14px; line-height:1.25;">${escapeHtml(item.name)}</strong>
              <div style="margin:0; font-size:13px; line-height:1.4; color:#4a4a4a;">${escapeHtml(item.description || "No description added yet.")}</div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderAccordionHtml(title, body, open = false) {
    return `
      <details style="margin:12px 0 0; overflow:hidden;"${open ? " open" : ""}>
        <summary style="list-style:none; display:flex; align-items:center; justify-content:space-between; padding:9px 12px; background:#efe6d3; font-weight:700; font-size:13px; cursor:pointer; color:#16273d;">
          <span>${escapeHtml(title)}</span>
          <span style="font-size:18px; font-weight:900; line-height:1;">+</span>
        </summary>
        <div style="padding:14px 4px 2px;">${body}</div>
      </details>
    `;
  }

  function extractVideoUrl(value) {
    const match = String(value || "").match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>]+/i);
    return match ? match[0] : "";
  }

  function embedVideoUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    const shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
    if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${shortMatch[1]}&rel=0`;
    const watchMatch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
    if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${watchMatch[1]}&rel=0`;
    const embedMatch = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
    if (embedMatch) return `https://www.youtube.com/embed/${embedMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${embedMatch[1]}&rel=0`;
    return "";
  }

  function webShortDescriptionHtml(row, reasonLookup) {
    const reasons = itemReasons(row, reasonLookup).slice(0, 8);
    if (!reasons.length) return "";
    const rows = [];
    for (let index = 0; index < reasons.length; index += 4) rows.push(reasons.slice(index, index + 4));
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="width:auto; border-collapse:separate; border-spacing:0 14px; margin:0 auto; text-align:center;">
        <tbody>
          ${rows.map((rowItems) => `
            <tr>
              ${rowItems.map((reason) => `
                <td align="center" style="text-align:center; vertical-align:middle; padding:0 5px;">
                  ${reason.iconUrl
                    ? `<img src="${escapeHtml(reason.iconUrl)}" alt="${escapeHtml(reason.name)} icon" style="width:58px; height:auto; max-width:58px; object-fit:contain; display:inline-block; border:0; background:transparent;">`
                    : `<span style="width:58px; height:58px; border-radius:999px; background:#0b7aa6; color:#ffffff; display:inline-flex; align-items:center; justify-content:center; font-weight:700;">${escapeHtml(reason.name.slice(0, 1).toUpperCase())}</span>`}
                </td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function webDescriptionHtml(row, reasonLookup) {
    const descriptionPreview = String(row["Description Preview"] || "");
    const reasons = itemReasons(row, reasonLookup);
    const featureReasons = reasons.filter((item) => !item.isWarrantyPeriod);
    const warrantyReasons = reasons.filter((item) => item.isWarrantyPeriod);
    const shortDescription = String(row["New Short Desc"] || row["Short Description"] || "");
    const featureDescription = String(row["New Feature Desc"] || "");
    const featureSummary = featureDescription || stripHtml(shortDescription);
    const detailItems = [
      ["Width", escapeHtml(valueText(row.Width))],
      ["Height", escapeHtml(valueText(row.Height))],
      ["Depth", escapeHtml(valueText(row.Depth))],
    ].filter(([, value]) => value);
    const dimensionsHtml = detailItems.length
      ? `<div style="display:grid; gap:7px; max-width:420px;">${detailItems.map(([label, value]) => `<div style="display:grid; grid-template-columns:110px minmax(0, 1fr); gap:10px; align-items:center; padding:8px 10px; background:#f8fafc; border-left:3px solid #0b7aa6; font-size:13px;"><strong style="font-size:12px; color:#4b5563; text-transform:uppercase; letter-spacing:0.02em;">${escapeHtml(label)}</strong><span style="font-weight:700; color:#0f172a;">${value}</span></div>`).join("")}</div>`
      : `<div style="margin:0; color:#64748b; font-size:13px;">No dimension information added yet.</div>`;
    const warrantyHtml = warrantyReasons.length
      ? `<div>${renderReasonListHtml(warrantyReasons, "")}<div style="margin:10px 0 0 64px; font-size:11px; color:#64748b;">Full details in our terms and conditions.</div></div>`
      : `<div style="margin:0; color:#64748b; font-size:13px;">No warranty information added yet.</div>`;
    const faqHtml = `
      <div style="display:grid; gap:8px;">
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">What size mattress do I need?</div>
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">What does 60 night comfort trial mean?</div>
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">How much is delivery?</div>
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">Why do I need a mattress protector?</div>
      </div>
    `;
    const trialHtml = `
      <div style="display:grid; grid-template-columns:54px minmax(0, 1fr); gap:12px; align-items:start;">
        <div style="width:54px; height:54px; border-radius:999px; background:#0b7aa6; color:#ffffff; display:grid; place-items:center; font-size:24px; font-weight:900;">60</div>
        <div><strong style="font-size:13px; color:#16324f;">Enjoy 60 nights to try your new mattress</strong><div style="margin:4px 0 0; font-size:12px; line-height:1.45; color:#4a4a4a;">If it is not quite right, you can swap it for an alternative comfort. Guaranteed peace of mind for online and in-store purchases.</div></div>
      </div>
    `;
    const videoUrl = extractVideoUrl(descriptionPreview);
    const videoEmbedUrl = embedVideoUrl(videoUrl);
    const videoHtml = videoEmbedUrl
      ? `<iframe src="${escapeHtml(videoEmbedUrl)}" title="${escapeHtml(itemDisplayName(row) || "Product")} video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen style="width:100%; aspect-ratio:16 / 9; border:0; display:block; background:#f5f5f5;"></iframe>`
      : videoUrl
      ? `<a href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer noopener" style="display:inline-flex; align-items:center; gap:8px; color:#0b7aa6; font-weight:700; text-decoration:none;">${escapeHtml(videoUrl)}</a>`
      : `<div style="margin:0; color:#64748b; font-size:13px;">No content added yet.</div>`;
    return `
      <div style="font-family:Arial, Helvetica, sans-serif; line-height:1.35; color:#16273d;">
        <div style="background:#f3efe6; padding:14px 16px; margin:0 0 14px; color:#252525;">
          <strong style="display:block; margin:0 0 8px; font-size:14px;">Why you will love this...</strong>
          <div style="margin:0; font-size:13px; line-height:1.45; color:#4a4a4a;">${escapeHtml(stripHtml(featureSummary) || "No content added yet.")}</div>
        </div>
        ${renderAccordionHtml("Video", videoHtml)}
        ${renderAccordionHtml("Features & Benefits", renderReasonListHtml(featureReasons, "No content added yet."), true)}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:14px; align-items:start;">
          <div style="background:#ffffff; padding:0;">${renderAccordionHtml("Dimensions", dimensionsHtml)}</div>
          <div style="background:#ffffff; padding:0;">${renderAccordionHtml("Warranty Information", warrantyHtml)}</div>
          <div style="background:#ffffff; padding:0;">${renderAccordionHtml("FAQs", faqHtml, true)}</div>
          <div style="background:#ffffff; padding:0;">${renderAccordionHtml("60 night comfort trial +", trialHtml, true)}</div>
        </div>
      </div>
    `;
  }

  function reasonPayloadAffectsItems(row) {
    return ["Description", "Icon", "Icon_InternalId", "IconUrl"].some((key) => row[key] !== undefined);
  }

  function rowInternalId(row) {
    return String(row?.["Internal ID"] || row?.internalid || row?.id || "").trim();
  }

  function linkedItemIdsForReasons(rows = [], changedReasonIds = new Set()) {
    const ids = new Set();
    rows.forEach((row) => {
      const reasonId = String(row["Internal ID"] || "").trim();
      if (!reasonId || !changedReasonIds.has(reasonId)) return;
      splitMultiValue(row.Items_InternalId).forEach((id) => ids.add(String(id)));
    });
    return ids;
  }

  function itemDisplayName(row) {
    return String(row.Name || row["Display Name"] || row["Item ID"] || row["Internal ID"] || "").trim();
  }

  function ensureRefreshPopup() {
    if (!state.refreshPopup || state.refreshPopup.closed) {
      state.refreshPopup = window.open("", "suitepim-linked-item-refresh", "width=980,height=720,resizable=yes,scrollbars=yes");
    }
    return state.refreshPopup;
  }

  function renderRefreshPopup(rows, statusById, summary = "") {
    const popup = ensureRefreshPopup();
    if (!popup) {
      showStatus("Linked item update popup was blocked by the browser.", "warning");
      return;
    }
    const body = `
      <p class="summary">${escapeHtml(summary || `${rows.length.toLocaleString()} linked item${rows.length === 1 ? "" : "s"} will be updated.`)}</p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Internal ID</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const id = String(row["Internal ID"] || "");
            const status = statusById.get(id) || "Pending";
            return `
              <tr data-status="${escapeHtml(status)}">
                <td>${escapeHtml(itemDisplayName(row))}</td>
                <td>${escapeHtml(id)}</td>
                <td><span>${escapeHtml(status)}</span></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
    popup.document.open();
    popup.document.write(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Updating linked item descriptions</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #f8fafc; }
            header { position: sticky; top: 0; z-index: 1; background: #fff; border-bottom: 1px solid #e2e8f0; padding: 16px 18px; }
            h1 { margin: 0; font-size: 18px; }
            main { padding: 16px 18px 24px; display: grid; gap: 12px; }
            .summary { margin: 0; color: #475569; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; }
            th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
            th { background: #f1f5f9; color: #0f172a; font-size: 12px; font-weight: 900; text-transform: uppercase; }
            td { font-size: 13px; }
            td span { border-radius: 999px; background: #e2e8f0; color: #334155; display: inline-flex; font-size: 12px; font-weight: 900; padding: 4px 8px; }
            tr[data-status="Processing"] td span { background: #dbeafe; color: #1d4ed8; }
            tr[data-status="Completed"] td span { background: #dcfce7; color: #166534; }
            tr[data-status="Error"] td span { background: #fee2e2; color: #991b1b; }
          </style>
        </head>
        <body>
          <header><h1>Updating linked item descriptions</h1></header>
          <main>${body}</main>
        </body>
      </html>`);
    popup.document.close();
    popup.focus();
  }

  function pollSingleItemRefreshJob(jobId, itemRow, allRows, statusById, summaryPrefix) {
    const itemId = rowInternalId(itemRow);
    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          const job = await api(`/push-status/${jobId}`);
          const result = (job.results || []).find((item) => String(item.internalId || "") === itemId);
          if (result) {
            statusById.set(itemId, result.status === "Success" ? "Completed" : "Error");
          }
          renderRefreshPopup(allRows, statusById, `${summaryPrefix} Push ${job.status}: ${job.processed || 0}/${job.total || 1} processed.`);
          if (job.status === "completed" || job.status === "error") {
            clearInterval(timer);
            if (!result && job.status === "error") statusById.set(itemId, "Error");
            resolve(job);
          }
        } catch (err) {
          clearInterval(timer);
          statusById.set(itemId, "Error");
          renderRefreshPopup(allRows, statusById, err.message);
          resolve(null);
        }
      }, 1800);
    });
  }

  async function pushLinkedItemUpdatesSequentially(affectedRows, updates) {
    const statusById = new Map(affectedRows.map((row) => [rowInternalId(row), "Pending"]));
    renderRefreshPopup(affectedRows, statusById, `${affectedRows.length.toLocaleString()} linked item${affectedRows.length === 1 ? "" : "s"} will be updated.`);

    for (let index = 0; index < updates.length; index += 1) {
      const row = affectedRows[index];
      const id = rowInternalId(row);
      statusById.set(id, "Processing");
      renderRefreshPopup(affectedRows, statusById, `Updating ${index + 1}/${updates.length}: ${itemDisplayName(row)}`);
      try {
        const push = await api("/push-updates", {
          method: "POST",
          body: JSON.stringify({ rows: [updates[index]], environment: state.environment }),
        });
        await pollSingleItemRefreshJob(push.jobId, row, affectedRows, statusById, `Updating ${index + 1}/${updates.length}.`);
      } catch (err) {
        statusById.set(id, "Error");
        renderRefreshPopup(affectedRows, statusById, `Failed updating ${itemDisplayName(row)}: ${err.message}`);
      }
    }

    const completed = Array.from(statusById.values()).filter((status) => status === "Completed").length;
    renderRefreshPopup(affectedRows, statusById, `Finished updating linked items. ${completed}/${affectedRows.length} completed.`);
  }

  async function refreshLinkedItemsForReasons(savedRows, fullRows, saveData) {
    const successfulIds = new Set((saveData.results || [])
      .filter((result) => result.status === "Success")
      .map((result) => String(result.internalId || "").trim())
      .filter(Boolean));
    const changedReasonIds = new Set(savedRows
      .filter(reasonPayloadAffectsItems)
      .map((row) => String(row["Internal ID"] || "").trim())
      .filter((id) => id && successfulIds.has(id)));
    if (!changedReasonIds.size) return;

    renderRefreshPopup([], new Map(), "Loading linked items...");

    const [webData, optionData] = await Promise.all([
      api("/web-management?refresh=1"),
      api(`/options/${encodeURIComponent("reasons to buy")}`),
    ]);
    const reasonLookup = reasonOptionsForRows(optionData.options || []);
    const linkedItemIds = linkedItemIdsForReasons(fullRows, changedReasonIds);
    const affectedRows = (webData.rows || []).filter((row) => linkedItemIds.has(rowInternalId(row)));
    if (!affectedRows.length) {
      renderRefreshPopup([], new Map(), `No linked web items found for the ${linkedItemIds.size.toLocaleString()} allocated item${linkedItemIds.size === 1 ? "" : "s"}.`);
      return;
    }

    const updates = affectedRows.map((row) => ({
      "Internal ID": row["Internal ID"],
      "Item ID": row["Item ID"],
      "Record Type": row["Record Type"],
      "Description Preview": webDescriptionHtml(row, reasonLookup).trim(),
      "New Short Desc": webShortDescriptionHtml(row, reasonLookup).trim(),
    }));
    await pushLinkedItemUpdatesSequentially(affectedRows, updates);
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
    const dirtyRows = Array.from(state.dirty.values());
    const rows = dirtyRows.map(changedPayload);
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
      refreshLinkedItemsForReasons(rows, dirtyRows.map(stripInternal), data).catch((err) => showStatus(`Linked item refresh failed: ${err.message}`, "error"));
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
