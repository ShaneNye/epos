(function () {
  const imageFields = [
    "Catalogue Image One",
    "Catalogue Image Two",
    "Catalogue Image Three",
    "Catalogue Image Four",
    "Catalogue Image Five",
  ];
  const columns = ["Internal ID", "Woo ID", "Name", ...imageFields];
  const pageSize = 50;
  const state = {
    environment: "production",
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
        ${columns.map((column) => `<th>${escapeHtml(column === "Internal ID" ? "ID" : column)}</th>`).join("")}
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

      columns.forEach((column) => {
        const td = document.createElement("td");
        td.dataset.column = column;
        if (imageFields.includes(column)) td.appendChild(renderImageButton(row, column));
        else td.textContent = String(row[column] ?? "");
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
    el.imagerySyncMount.innerHTML = `<div class="suitepim-loading"><div class="suitepim-spinner"></div><p>${forceRefresh ? "Refreshing" : "Loading"} Imagery Sync...</p></div>`;
    showStatus("");
    try {
      const search = String(el.imagerySyncSearch.value || "").trim();
      const params = new URLSearchParams();
      if (forceRefresh) params.set("refresh", "1");
      if (search) params.set("search", search);
      const query = params.toString();
      const data = await api(`/imagery-sync${query ? `?${query}` : ""}`);
      state.rows = (data.rows || []).map((row, index) => ({ ...row, _key: rowKey(row, index) }));
      state.filtered = [...state.rows];
      state.selected.clear();
      state.page = 1;
      state.wooConfigured = !!data.wooCommerceConfigured;
      el.imagerySyncPush.disabled = !state.wooConfigured;
      render();
      showStatus(
        `${forceRefresh ? "Refreshed" : "Loaded"} ${state.rows.length.toLocaleString()} Woo-linked item(s)${search ? ` matching “${search}”` : ""}.${state.wooConfigured ? "" : " WooCommerce credentials are not configured."}`,
        state.wooConfigured ? "success" : "warning"
      );
    } catch (err) {
      el.imagerySyncMount.innerHTML = `<div class="suitepim-empty"><h2>Imagery Sync could not load</h2><p>${escapeHtml(err.message)}</p></div>`;
      showStatus(err.message, "error");
    }
  }

  async function pushSelected() {
    const rows = state.rows.filter((row) => state.selected.has(row._key));
    if (!rows.length) {
      showStatus("Select at least one item to push.", "warning");
      return;
    }
    el.imagerySyncPush.disabled = true;
    showStatus(`Pushing imagery for ${rows.length.toLocaleString()} item(s) to WooCommerce...`, "info");
    try {
      const data = await api("/imagery-sync/push", {
        method: "POST",
        body: JSON.stringify({
          environment: state.environment,
          rows: rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""]))),
        }),
      });
      state.selected.clear();
      render();
      showStatus(`WooCommerce imagery synced for ${data.success.toLocaleString()} item(s).`, "success");
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      el.imagerySyncPush.disabled = !state.wooConfigured;
    }
  }

  function bindEvents() {
    el.imagerySyncSearch.addEventListener("input", applySearch);
    el.imagerySyncRefresh.addEventListener("click", () => load(true));
    el.imagerySyncPush.addEventListener("click", pushSelected);
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
