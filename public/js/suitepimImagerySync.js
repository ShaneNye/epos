(function () {
  const imageFields = [
    "Catalogue Image One",
    "Catalogue Image Two",
    "Catalogue Image Three",
    "Catalogue Image Four",
    "Catalogue Image Five",
  ];
  const imageryColumns = ["Internal ID", "Woo ID", "Name", ...imageFields];
  const descriptionColumns = ["Name", "Description Preview", "New Short Desc", "reasons to buy", "Web Faq's", "Page Preview"];
  const pageSize = 50;
  const state = {
    environment: "production",
    mode: "imagery",
    rows: [],
    filtered: [],
    selected: new Set(),
    page: 1,
    wooConfigured: false,
    options: null,
    modal: null,
  };

  const el = {};

  function initEls() {
    [
      "imagerySyncSearch",
      "imagerySyncRefresh",
      "imagerySyncPush",
      "imagerySyncPushAll",
      "imagerySyncStatus",
      "imagerySyncMount",
      "imagerySyncPrev",
      "imagerySyncNext",
      "imagerySyncPage",
      "imagerySyncModal",
      "imagerySyncModalTitle",
      "imagerySyncModalClose",
      "imagerySyncModalSearch",
      "imagerySyncModalOptions",
      "imagerySyncModalClear",
      "imagerySyncModalCancel",
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

  function extractImageUrl(value) {
    if (!value) return "";
    if (typeof value === "object") {
      return extractImageUrl(value.url || value.URL || value.src || value.href || value["File URL"]);
    }
    const text = String(value);
    return text.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
      || text.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1]
      || text.match(/https?:\/\/[^\s"'<>]+/i)?.[0]
      || "";
  }

  function optionImageUrl(option) {
    const raw = option?.raw || {};
    return extractImageUrl(
      raw.url || raw.URL || raw.image || raw.Image || raw.src || raw["Image URL"] || raw["File URL"] || option?.name
    );
  }

  function rowKey(row, index) {
    return String(row["Internal ID"] || row["Woo ID"] || `row-${index}`);
  }

  function showStatus(message, type = "") {
    el.imagerySyncStatus.textContent = message || "";
    el.imagerySyncStatus.className = `suitepim-status${type ? ` is-${type}` : ""}`;
  }

  async function api(path, options = {}) {
    const joiner = path.includes("?") ? "&" : "?";
    const response = await fetch(
      `/api/suitepim${path}${joiner}environment=${encodeURIComponent(state.environment)}`,
      {
        ...options,
        headers: {
          ...authHeaders(),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `SuitePim request failed: ${response.status}`);
    }
    return data;
  }

  function applySearch() {
    const query = String(el.imagerySyncSearch.value || "").trim().toLowerCase();
    state.filtered = query
      ? state.rows.filter((row) =>
          [row["Internal ID"], row["Woo ID"], row.Name].some((value) => String(value || "").toLowerCase().includes(query))
        )
      : [...state.rows];
    state.page = 1;
    render();
  }

  function activeColumns() {
    return state.mode === "descriptions" ? descriptionColumns : imageryColumns;
  }

  function displayValue(value) {
    if (Array.isArray(value)) return value.join(", ");
    return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function openDescriptionPreview(row) {
    const popup = window.open("", "suitepim-description-preview", "popup=yes,width=1000,height=800,resizable=yes,scrollbars=yes");
    if (!popup) return showStatus("Preview popup was blocked by the browser.", "warning");
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(row.Name || "Product preview")}</title><style>body{font:16px/1.55 Arial,sans-serif;color:#16273d;max-width:920px;margin:0 auto;padding:32px}h1{margin-top:0}.meta{color:#64748b}.product-description{margin-top:24px}</style></head><body><h1>${escapeHtml(row.Name || "Product preview")}</h1><p class="meta">Woo ID: ${escapeHtml(row["Woo ID"] || "")}</p><div class="product-description">${String(row["Description Preview"] || "<p>No description preview added.</p>")}</div></body></html>`);
    popup.document.close();
    popup.focus();
  }

  function renderImageButton(row, fieldName) {
    const button = document.createElement("button");
    const url = extractImageUrl(row[fieldName]);
    button.type = "button";
    button.className = "suitepim-value-btn suitepim-image-btn";
    button.innerHTML = `
      <span class="suitepim-image-btn-media">
        ${url
          ? `<img class="suitepim-image-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(fieldName)}" loading="lazy">`
          : '<div class="suitepim-image-fallback" aria-hidden="true">No image</div>'}
      </span>
      <span class="suitepim-image-btn-copy">
        <strong>${url ? "Change image" : "Select image"}</strong>
        <small>${url ? "Preview loaded" : "No image selected"}</small>
      </span>`;
    button.addEventListener("click", () => openImageModal(row, fieldName));
    return button;
  }

  function render() {
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * pageSize;
    const rows = state.filtered.slice(start, start + pageSize);

    el.imagerySyncPage.textContent = `Page ${state.page} of ${totalPages} · ${state.filtered.length.toLocaleString()} items`;
    el.imagerySyncPrev.disabled = state.page <= 1;
    el.imagerySyncNext.disabled = state.page >= totalPages;

    if (!state.rows.length) {
      el.imagerySyncMount.innerHTML = '<div class="suitepim-empty"><h2>No Woo-linked items found</h2><p>Only records with a Woo ID appear here.</p></div>';
      return;
    }

    const table = document.createElement("table");
    table.className = "suitepim-table";
    table.innerHTML = `
      <thead><tr>
        <th class="suitepim-select-col"><input type="checkbox" aria-label="Select page"></th>
        ${activeColumns().map((column) => `<th>${escapeHtml(column === "Internal ID" ? "ID" : column)}</th>`).join("")}
      </tr></thead>
      <tbody></tbody>`;

    const pageToggle = table.querySelector("thead input");
    pageToggle.checked = rows.length > 0 && rows.every((row) => state.selected.has(row._key));
    pageToggle.addEventListener("change", () => {
      rows.forEach((row) => pageToggle.checked ? state.selected.add(row._key) : state.selected.delete(row._key));
      render();
    });

    const tbody = table.querySelector("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const selectCell = document.createElement("td");
      selectCell.className = "suitepim-select-col";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selected.has(row._key);
      checkbox.setAttribute("aria-label", `Select ${row.Name || row["Woo ID"]}`);
      checkbox.addEventListener("change", () => {
        checkbox.checked ? state.selected.add(row._key) : state.selected.delete(row._key);
        showStatus(`${state.selected.size.toLocaleString()} item(s) selected.`, "info");
      });
      selectCell.appendChild(checkbox);
      tr.appendChild(selectCell);

      activeColumns().forEach((column) => {
        const td = document.createElement("td");
        td.dataset.column = column;
        if (imageFields.includes(column)) td.appendChild(renderImageButton(row, column));
        else if (column === "Page Preview") {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "suitepim-preview-btn";
          button.textContent = "Preview";
          button.addEventListener("click", () => openDescriptionPreview(row));
          td.appendChild(button);
        } else {
          if (["Description Preview", "New Short Desc"].includes(column)) {
            td.classList.add("suitepim-sync-description-cell");
            const source = document.createElement("textarea");
            source.className = "suitepim-sync-html-source";
            source.readOnly = true;
            source.rows = 8;
            source.value = String(row[column] ?? "");
            source.setAttribute("aria-label", `${column} HTML for ${row.Name || row["Woo ID"] || "product"}`);
            td.appendChild(source);
          } else {
            td.textContent = displayValue(row[column]);
          }
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    const wrap = document.createElement("div");
    wrap.className = "suitepim-table-wrap";
    wrap.appendChild(table);
    el.imagerySyncMount.replaceChildren(wrap);
  }

  async function loadOptions() {
    if (state.options) return state.options;
    const data = await api(`/options/${encodeURIComponent("Catalogue Image One")}`);
    state.options = data.options || [];
    return state.options;
  }

  async function openImageModal(row, fieldName) {
    state.modal = { row, fieldName };
    el.imagerySyncModalTitle.textContent = `Select ${fieldName}`;
    el.imagerySyncModalSearch.value = "";
    el.imagerySyncModalOptions.innerHTML = '<div class="suitepim-loading"><div class="suitepim-spinner"></div><p>Loading images...</p></div>';
    el.imagerySyncModal.classList.remove("hidden");
    try {
      await loadOptions();
      renderModalOptions();
      el.imagerySyncModalSearch.focus();
    } catch (err) {
      el.imagerySyncModalOptions.textContent = err.message;
    }
  }

  function renderModalOptions() {
    const query = el.imagerySyncModalSearch.value.trim().toLowerCase();
    if (query.length < 4) {
      el.imagerySyncModalOptions.innerHTML = '<p class="suitepim-muted-note">Type at least 4 characters to search images.</p>';
      return;
    }
    const matches = (state.options || [])
      .filter((option) => String(option.name || "").toLowerCase().includes(query))
      .slice(0, 100);
    el.imagerySyncModalOptions.innerHTML = "";
    if (!matches.length) {
      el.imagerySyncModalOptions.innerHTML = '<p class="suitepim-muted-note">No matching images found.</p>';
      return;
    }
    matches.forEach((option) => {
      const url = optionImageUrl(option);
      if (!url) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-modal-option";
      button.innerHTML = `
        <span class="suitepim-modal-option-image"><img src="${escapeHtml(url)}" alt="" loading="lazy"></span>
        <span>${escapeHtml(option.name || url)}</span>`;
      button.addEventListener("click", () => chooseImage(url));
      el.imagerySyncModalOptions.appendChild(button);
    });
  }

  function chooseImage(value) {
    if (!state.modal) return;
    state.modal.row[state.modal.fieldName] = value;
    state.selected.add(state.modal.row._key);
    closeModal();
    render();
    showStatus("Image updated locally. Push the selected item to sync it to WooCommerce.", "info");
  }

  function closeModal() {
    el.imagerySyncModal.classList.add("hidden");
    state.modal = null;
  }

  async function load(forceRefresh = false) {
    const label = state.mode === "descriptions" ? "Product Description Sync" : "Imagery Sync";
    el.imagerySyncMount.innerHTML = `<div class="suitepim-loading"><div class="suitepim-spinner"></div><p>${forceRefresh ? "Refreshing" : "Loading"} ${label}...</p></div>`;
    showStatus("");
    try {
      const search = String(el.imagerySyncSearch.value || "").trim();
      const params = new URLSearchParams();
      if (forceRefresh) params.set("refresh", "1");
      if (search) params.set("search", search);
      const query = params.toString();
      const endpoint = state.mode === "descriptions" ? "/description-sync" : "/imagery-sync";
      const data = await api(`${endpoint}${query ? `?${query}` : ""}`);
      state.rows = (data.rows || []).map((row, index) => ({ ...row, _key: rowKey(row, index) }));
      state.filtered = [...state.rows];
      state.selected.clear();
      state.page = 1;
      state.wooConfigured = !!data.wooCommerceConfigured;
      el.imagerySyncPush.disabled = !state.wooConfigured;
      el.imagerySyncPushAll.disabled = !state.wooConfigured;
      render();
      showStatus(
        `${forceRefresh ? "Refreshed" : "Loaded"} ${state.rows.length.toLocaleString()} Woo-linked item(s)${search ? ` matching “${search}”` : ""}.${state.wooConfigured ? "" : " WooCommerce credentials are not configured."}`,
        state.wooConfigured ? "success" : "warning"
      );
    } catch (err) {
      el.imagerySyncMount.innerHTML = `<div class="suitepim-empty"><h2>${label} could not load</h2><p>${escapeHtml(err.message)}</p></div>`;
      showStatus(err.message, "error");
    }
  }

  function descriptionPushBatches(rows, maxRows = 25, maxBytes = 750000) {
    const batches = [];
    let batch = [];
    rows.forEach((row) => {
      const candidate = [...batch, row];
      const bytes = new Blob([JSON.stringify({ rows: candidate, environment: state.environment })]).size;
      if (batch.length && (candidate.length > maxRows || bytes > maxBytes)) {
        batches.push(batch);
        batch = [row];
      } else {
        batch = candidate;
      }
    });
    if (batch.length) batches.push(batch);
    return batches;
  }

  async function pushRows(rows) {
    if (!rows.length) {
      showStatus("Select at least one item to push.", "warning");
      return;
    }
    el.imagerySyncPush.disabled = true;
    el.imagerySyncPushAll.disabled = true;
    const isDescriptions = state.mode === "descriptions";
    const batches = isDescriptions ? descriptionPushBatches(rows) : [rows];
    showStatus(`Pushing ${isDescriptions ? "descriptions" : "imagery"} for ${rows.length.toLocaleString()} item(s) in ${batches.length} batch${batches.length === 1 ? "" : "es"}...`, "info");
    try {
      let successful = 0;
      let failed = 0;
      const failures = [];
      for (let index = 0; index < batches.length; index += 1) {
        showStatus(`Pushing batch ${index + 1}/${batches.length} (${successful.toLocaleString()} completed)...`, "info");
        const batch = batches[index];
        const data = await api(isDescriptions ? "/description-sync/push" : "/imagery-sync/push", {
          method: "POST",
          body: JSON.stringify({
            environment: state.environment,
            rows: batch.map((row) => isDescriptions
              ? {
                  "Internal ID": row["Internal ID"] ?? "",
                  "Woo ID": row["Woo ID"] ?? "",
                  Name: row.Name ?? "",
                  "Description Preview": row["Description Preview"] ?? "",
                  "New Short Desc": row["New Short Desc"] ?? "",
                }
              : Object.fromEntries(imageryColumns.map((column) => [column, row[column] ?? ""]))),
          }),
        });
        successful += Number(data.success || 0);
        failed += Number(data.failed || 0);
        failures.push(...(data.results || []).filter((result) => !result.success));
      }
      let emailNote = "";
      if (isDescriptions && failures.length) {
        try {
          const email = await api("/description-sync/failure-email", {
            method: "POST",
            body: JSON.stringify({ failures }),
          });
          emailNote = email.sent ? ` A failure report was emailed to ${email.recipient}.` : "";
        } catch (emailError) {
          emailNote = ` Failure report email could not be sent: ${emailError.message}`;
        }
      }
      state.selected.clear();
      render();
      showStatus(`WooCommerce ${isDescriptions ? "descriptions" : "imagery"} synced for ${successful.toLocaleString()} item(s)${failed ? `; ${failed.toLocaleString()} skipped or failed` : ""}.${emailNote}`, failed ? "warning" : "success");
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      el.imagerySyncPush.disabled = !state.wooConfigured;
      el.imagerySyncPushAll.disabled = !state.wooConfigured;
    }
  }

  function pushSelected() {
    return pushRows(state.rows.filter((row) => state.selected.has(row._key)));
  }

  function pushAllDescriptions() {
    if (state.mode !== "descriptions" || !state.rows.length) return;
    if (!window.confirm(`Update all ${state.rows.length.toLocaleString()} product descriptions in WooCommerce?`)) return;
    return pushRows([...state.rows]);
  }

  function bindEvents() {
    document.querySelectorAll("[data-sync-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.syncTab;
        if (!mode || mode === state.mode) return;
        state.mode = mode;
        document.querySelectorAll("[data-sync-tab]").forEach((tab) => {
          const active = tab === button;
          tab.classList.toggle("active", active);
          tab.setAttribute("aria-selected", String(active));
        });
        el.imagerySyncSearch.value = "";
        el.imagerySyncSearch.placeholder = mode === "descriptions"
          ? "Search parent name, ID or Woo ID..."
          : "Search ID, Woo ID or name...";
        el.imagerySyncPush.textContent = mode === "descriptions"
          ? "Push descriptions to WooCommerce"
          : "Push selected to WooCommerce";
        el.imagerySyncPushAll.hidden = mode !== "descriptions";
        load(mode === "descriptions");
      });
    });
    el.imagerySyncSearch.addEventListener("input", applySearch);
    el.imagerySyncRefresh.addEventListener("click", () => load(true));
    el.imagerySyncPush.addEventListener("click", pushSelected);
    el.imagerySyncPushAll.addEventListener("click", pushAllDescriptions);
    el.imagerySyncPrev.addEventListener("click", () => { state.page -= 1; render(); });
    el.imagerySyncNext.addEventListener("click", () => { state.page += 1; render(); });
    el.imagerySyncModalSearch.addEventListener("input", renderModalOptions);
    el.imagerySyncModalClose.addEventListener("click", closeModal);
    el.imagerySyncModalCancel.addEventListener("click", closeModal);
    el.imagerySyncModalClear.addEventListener("click", () => chooseImage(""));
  }

  document.addEventListener("DOMContentLoaded", () => {
    initEls();
    bindEvents();
    load();
  });
})();
