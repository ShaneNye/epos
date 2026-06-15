(function () {
  const state = {
    environment: "production",
    rows: [],
    filteredRows: [],
    baseline: new Map(),
    dirty: new Map(),
    activeKey: "",
    itemOptions: [],
    selectedItems: new Set(),
    refreshPopup: null,
  };
  const el = {};

  function byId(id) { return document.getElementById(id); }
  function initEls() {
    ["suitepimSearch", "suitepimStateFilter", "suitepimAddBtn", "suitepimRefreshBtn", "suitepimSaveBtn", "suitepimMount", "suitepimStatus", "suitepimPushReport", "suitepimModal", "suitepimModalTitle", "suitepimModalSearch", "suitepimModalOptions", "suitepimModalClose", "suitepimModalCancel", "suitepimModalSave"].forEach((id) => { el[id] = byId(id); });
  }
  function authHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    if (!saved?.token) { window.location.href = "/index.html"; return {}; }
    return { Authorization: `Bearer ${saved.token}` };
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function splitMultiValue(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || "").split(/[\u0005,]/).map((item) => item.trim()).filter(Boolean);
  }
  function rowKey(row, index = 0) {
    return String(row["Internal ID"] || row._suitepimKey || `new-${Date.now()}-${index}`);
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
    el.suitepimMount.innerHTML = `<div class="suitepim-loading"><div class="suitepim-spinner" aria-hidden="true"></div><p>${escapeHtml(message)}</p></div>`;
  }
  async function api(path, options = {}) {
    const joiner = path.includes("?") ? "&" : "?";
    const url = `/api/suitepim${path}${joiner}environment=${encodeURIComponent(state.environment)}`;
    const headers = { ...authHeaders(), ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `SuitePim request failed: ${res.status}`);
    return data;
  }
  function activeRow() {
    return state.rows.find((row) => row._suitepimKey === state.activeKey) || null;
  }
  function markDirty(row, rerender = true) {
    state.dirty.set(row._suitepimKey, stripInternal(row));
    if (rerender) applyFilters();
  }
  async function loadRows() {
    setLoading("Loading Item Faq's...");
    showStatus("");
    state.rows = [];
    state.filteredRows = [];
    state.baseline.clear();
    state.dirty.clear();
    const data = await api("/item-faqs");
    state.rows = (data.rows || []).map((row, index) => ({ ...row, _suitepimKey: rowKey(row, index) }));
    state.rows.forEach((row) => state.baseline.set(row._suitepimKey, JSON.stringify(stripInternal(row))));
    state.activeKey = state.rows[0]?._suitepimKey || "";
    applyFilters();
    showStatus(`Loaded ${state.rows.length.toLocaleString()} ${data.environment} FAQ record(s).`, "success");
  }
  function addRecord() {
    const row = { _suitepimKey: `new-${Date.now()}`, _isNew: true, "Internal ID": "", Name: "", Description: "", Items: [], Items_InternalId: [] };
    state.rows.unshift(row);
    state.baseline.set(row._suitepimKey, JSON.stringify({}));
    state.activeKey = row._suitepimKey;
    markDirty(row);
  }
  function applyFilters() {
    const term = el.suitepimSearch.value.trim().toLowerCase();
    const mode = el.suitepimStateFilter.value;
    state.filteredRows = state.rows.filter((row) => {
      if (mode === "changed" && !state.dirty.has(row._suitepimKey)) return false;
      if (mode === "new" && !row._isNew) return false;
      if (!term) return true;
      return [row.Name, row.Description, splitMultiValue(row.Items).join(" ")].join(" ").toLowerCase().includes(term);
    });
    render();
  }
  function render() {
    if (!state.rows.length) {
      el.suitepimMount.innerHTML = `<div class="suitepim-empty"><h2>No Item FAQ records loaded</h2></div>`;
      return;
    }
    el.suitepimMount.innerHTML = `
      <div class="suitepim-reasons-layout">
        <aside class="suitepim-reasons-list" aria-label="Item FAQ records">
          ${state.filteredRows.map((row) => `<button class="${row._suitepimKey === state.activeKey ? "active" : ""}" type="button" data-key="${escapeHtml(row._suitepimKey)}"><strong>${escapeHtml(row.Name || "New FAQ")}</strong><small>${escapeHtml(splitMultiValue(row.Items).length)} linked item(s)${state.dirty.has(row._suitepimKey) ? " • changed" : ""}</small></button>`).join("")}
        </aside>
        <section class="suitepim-reasons-form-panel" aria-label="Edit Item FAQ record">${renderForm(activeRow())}</section>
      </div>
    `;
  }
  function renderForm(row) {
    if (!row) return `<div class="suitepim-empty">Select a FAQ record.</div>`;
    return `
      <div class="suitepim-reasons-form-head"><div><p>${escapeHtml(row["Internal ID"] ? `Internal ID ${row["Internal ID"]}` : "New record")}</p><h2>${escapeHtml(row.Name || "New FAQ")}</h2></div></div>
      <div class="suitepim-reasons-form-grid">
        <label><span>Name</span><input data-field="Name" value="${escapeHtml(row.Name || "")}" placeholder="FAQ question"></label>
        <label><span>Description</span><textarea data-field="Description" rows="8" placeholder="FAQ answer">${escapeHtml(row.Description || "")}</textarea></label>
        <label><span>Linked items</span><button class="suitepim-multi-button" type="button" data-action="items">${escapeHtml(splitMultiValue(row.Items).length ? splitMultiValue(row.Items).join(", ") : "Select items")}</button></label>
      </div>
    `;
  }
  render = function renderItemFaqEditor() {
    if (!state.rows.length) {
      el.suitepimMount.innerHTML = `<div class="suitepim-empty"><h2>No Item FAQ records loaded</h2></div>`;
      return;
    }
    el.suitepimMount.innerHTML = `
      <div class="suitepim-reasons-layout suitepim-item-faq-layout">
        <aside class="suitepim-reasons-list" aria-label="Item FAQ records">
          <div class="suitepim-reasons-list-head">
            <h2>FAQ records</h2>
            <span>${state.filteredRows.length.toLocaleString()}</span>
          </div>
          <div class="suitepim-reasons-list-body">
            ${state.filteredRows.map((row) => `
              <button class="suitepim-reasons-record suitepim-faq-record${row._suitepimKey === state.activeKey ? " active" : ""}" type="button" data-key="${escapeHtml(row._suitepimKey)}">
                <span class="suitepim-faq-record-mark" aria-hidden="true">FAQ</span>
                <span>
                  <strong>${escapeHtml(row.Name || "New FAQ")}</strong>
                  <small>${escapeHtml(splitMultiValue(row.Items).length)} linked item(s)${state.dirty.has(row._suitepimKey) ? " - changed" : ""}</small>
                </span>
                ${state.dirty.has(row._suitepimKey) ? "<i>Changed</i>" : ""}
              </button>
            `).join("")}
          </div>
        </aside>
        <section class="suitepim-reasons-form-panel suitepim-item-faq-panel" aria-label="Edit Item FAQ record">${renderForm(activeRow())}</section>
      </div>
    `;
  };

  renderForm = function renderItemFaqForm(row) {
    if (!row) return `<div class="suitepim-empty">Select a FAQ record.</div>`;
    const linkedItems = splitMultiValue(row.Items);
    return `
      <div class="suitepim-reasons-form-head">
        <div>
          <p>${escapeHtml(row["Internal ID"] ? `Internal ID ${row["Internal ID"]}` : "New record")}</p>
          <h2>${escapeHtml(row.Name || "New FAQ")}</h2>
        </div>
        <span class="${state.dirty.has(row._suitepimKey) ? "is-dirty" : ""}">${state.dirty.has(row._suitepimKey) ? "Unsaved" : "Saved"}</span>
      </div>
      <form class="suitepim-reasons-form suitepim-item-faq-form">
        <label class="suitepim-item-faq-question">
          <span>FAQ question</span>
          <input data-field="Name" type="text" value="${escapeHtml(row.Name || "")}" placeholder="Add the customer-facing question">
        </label>
        <label class="suitepim-item-faq-answer" data-field-type="Text Area">
          <span>FAQ answer</span>
          <textarea data-field="Description" rows="8" placeholder="Add the answer shown in the website FAQ panel">${escapeHtml(row.Description || "")}</textarea>
        </label>
        <label class="suitepim-item-faq-items" data-field-type="multiple-select">
          <span>Linked items</span>
          <button class="suitepim-item-faq-items-btn" type="button" data-action="items">
            <strong>${linkedItems.length ? `${linkedItems.length.toLocaleString()} item${linkedItems.length === 1 ? "" : "s"} selected` : "Select items"}</strong>
            <small>${escapeHtml(linkedItems.length ? linkedItems.slice(0, 4).join(", ") + (linkedItems.length > 4 ? "..." : "") : "Choose which items should use this FAQ.")}</small>
          </button>
        </label>
      </form>
    `;
  };

  async function loadItemOptions() {
    if (state.itemOptions.length) return state.itemOptions;
    const data = await api("/item-faqs/options/Items");
    state.itemOptions = data.options || [];
    return state.itemOptions;
  }
  async function openItemsModal() {
    const row = activeRow();
    if (!row) return;
    const options = await loadItemOptions();
    state.selectedItems = new Set(splitMultiValue(row.Items_InternalId));
    el.suitepimModalTitle.textContent = "Select linked items";
    el.suitepimModalSearch.value = "";
    el.suitepimModal.classList.remove("hidden");
    renderItemOptions(options);
  }
  function renderItemOptions(options = state.itemOptions) {
    const term = el.suitepimModalSearch.value.trim().toLowerCase();
    const filtered = options.filter((option) => option.name.toLowerCase().includes(term)).sort((a, b) => {
      const as = state.selectedItems.has(String(a.id));
      const bs = state.selectedItems.has(String(b.id));
      if (as !== bs) return as ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    el.suitepimModalOptions.innerHTML = filtered.length ? "" : `<div class="suitepim-empty-option">No items found</div>`;
    filtered.forEach((option) => {
      const label = document.createElement("label");
      label.className = "suitepim-modal-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.selectedItems.has(String(option.id));
      input.addEventListener("change", () => {
        if (input.checked) state.selectedItems.add(String(option.id));
        else state.selectedItems.delete(String(option.id));
      });
      const copy = document.createElement("div");
      copy.className = "suitepim-modal-copy";
      copy.innerHTML = `<strong>${escapeHtml(option.name)}</strong><small>${escapeHtml(option.id)}</small>`;
      label.append(input, copy);
      el.suitepimModalOptions.appendChild(label);
    });
  }
  function saveItemsModal() {
    const row = activeRow();
    if (!row) return;
    const ids = Array.from(state.selectedItems);
    const selected = ids.map((id) => state.itemOptions.find((option) => String(option.id) === String(id))).filter(Boolean);
    row.Items_InternalId = ids;
    row.Items = selected.map((option) => option.name);
    markDirty(row);
    closeModal();
  }
  function closeModal() {
    el.suitepimModal.classList.add("hidden");
  }
  function rowInternalId(row) {
    return String(row?.["Internal ID"] || row?.internalid || row?.id || "").trim();
  }
  function itemDisplayName(row) {
    return String(row.Name || row["Display Name"] || row["Item ID"] || row["Internal ID"] || "").trim();
  }
  function successfulFaqSaveIds(data) {
    return new Set((data.results || [])
      .filter((result) => result.status !== "Error")
      .map((result) => String(result.id || result.internalId || "").trim())
      .filter(Boolean));
  }
  function baselineRowFor(row) {
    const directKey = row?._suitepimKey || "";
    const internalId = rowInternalId(row);
    try {
      if (directKey && state.baseline.has(directKey)) return JSON.parse(state.baseline.get(directKey) || "{}");
      for (const value of state.baseline.values()) {
        const parsed = JSON.parse(value || "{}");
        if (internalId && rowInternalId(parsed) === internalId) return parsed;
      }
      return {};
    } catch (_) {
      return {};
    }
  }
  function affectedItemIdsForChangedFaqs(rows) {
    const ids = new Set();
    rows.forEach((row) => {
      splitMultiValue(row.Items_InternalId).forEach((id) => ids.add(String(id)));
      splitMultiValue(baselineRowFor(row).Items_InternalId).forEach((id) => ids.add(String(id)));
    });
    return ids;
  }
  function faqFieldInternalIdKey(row) {
    return Object.keys(row || {}).find((key) => /faq/i.test(key) && /_InternalId$/.test(key)) || "";
  }
  function orderedFaqIdsForItem(row, itemId, faqRows) {
    const key = faqFieldInternalIdKey(row);
    const selectedIds = key ? splitMultiValue(row[key]).map(String) : [];
    const linkedIds = faqRows
      .filter((faq) => splitMultiValue(faq.Items_InternalId).map(String).includes(String(itemId)))
      .map((faq) => rowInternalId(faq))
      .filter(Boolean);
    const linkedSet = new Set(linkedIds);
    const ordered = selectedIds.filter((id) => linkedSet.has(String(id)));
    linkedIds.forEach((id) => {
      if (!ordered.includes(id)) ordered.push(id);
    });
    return ordered;
  }
  function faqRowsForItem(row, itemId, faqRows) {
    const byId = new Map(faqRows.map((faq) => [rowInternalId(faq), faq]));
    return orderedFaqIdsForItem(row, itemId, faqRows).map((id) => byId.get(id)).filter(Boolean);
  }
  function renderFaqPanelHtml(faqs) {
    if (!faqs.length) {
      return `<div style="display:grid; gap:8px;">
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">What size mattress do I need?</div>
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">What does 60 night comfort trial mean?</div>
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">How much is delivery?</div>
        <div style="padding:10px 12px; background:#eef7fb; color:#0b7aa6; font-size:12px; font-weight:700;">Why do I need a mattress protector?</div>
      </div>`;
    }
    return `<div style="display:grid; gap:8px;">${faqs.map((faq) => `<details style="background:#eef7fb; color:#0b7aa6; font-size:12px;"><summary style="cursor:pointer; padding:10px 12px; font-weight:700;">${escapeHtml(faq.Name || "FAQ")}</summary><div style="padding:0 12px 10px; color:#4a4a4a; line-height:1.45;">${escapeHtml(faq.Description || "No answer added yet.")}</div></details>`).join("")}</div>`;
  }
  function patchFaqPanel(html, faqHtml) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const details = Array.from(template.content.querySelectorAll("details")).find((node) => {
      const summary = node.querySelector("summary");
      return /faqs?/i.test(summary?.textContent || "");
    });
    if (!details) return String(html || "");
    const body = Array.from(details.children).find((child) => child.tagName !== "SUMMARY");
    if (body) {
      body.innerHTML = faqHtml;
    } else {
      details.insertAdjacentHTML("beforeend", `<div style="padding:14px 4px 2px;">${faqHtml}</div>`);
    }
    details.open = true;
    return template.innerHTML;
  }
  function ensureRefreshPopup() {
    if (!state.refreshPopup || state.refreshPopup.closed) {
      state.refreshPopup = window.open("", "suitepim-item-faq-linked-refresh", "width=980,height=720,resizable=yes,scrollbars=yes");
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
        <thead><tr><th>Item</th><th>Internal ID</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const id = rowInternalId(row);
            const status = statusById.get(id) || "Pending";
            return `<tr data-status="${escapeHtml(status)}"><td>${escapeHtml(itemDisplayName(row))}</td><td>${escapeHtml(id)}</td><td><span>${escapeHtml(status)}</span></td></tr>`;
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
          <title>Updating linked item FAQ descriptions</title>
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
          <header><h1>Updating linked item FAQ descriptions</h1></header>
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
          if (result) statusById.set(itemId, result.status === "Success" ? "Completed" : "Error");
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
  async function refreshLinkedItemsForFaqs(savedRows, saveData, affectedItemIds) {
    const successfulIds = successfulFaqSaveIds(saveData);
    const changedExistingIds = savedRows.map(rowInternalId).filter(Boolean);
    if (changedExistingIds.length && !changedExistingIds.some((id) => successfulIds.has(id))) return;
    if (!affectedItemIds.size) return;

    renderRefreshPopup([], new Map(), "Loading linked items...");
    const [webData, faqData] = await Promise.all([
      api("/web-management?refresh=1"),
      api("/item-faqs"),
    ]);
    const faqRows = faqData.rows || [];
    const affectedRows = (webData.rows || []).filter((row) => affectedItemIds.has(rowInternalId(row)));
    if (!affectedRows.length) {
      renderRefreshPopup([], new Map(), `No linked web items found for the ${affectedItemIds.size.toLocaleString()} allocated item${affectedItemIds.size === 1 ? "" : "s"}.`);
      return;
    }

    const updates = affectedRows.map((row) => {
      const itemId = rowInternalId(row);
      const faqs = faqRowsForItem(row, itemId, faqRows);
      const faqInternalIdKey = faqFieldInternalIdKey(row);
      const faqFieldName = faqInternalIdKey.replace(/_InternalId$/, "");
      const faqIds = faqs.map(rowInternalId).filter(Boolean);
      const update = {
        "Internal ID": row["Internal ID"],
        "Item ID": row["Item ID"],
        "Record Type": row["Record Type"],
        "Description Preview": patchFaqPanel(row["Description Preview"], renderFaqPanelHtml(faqs)).trim(),
      };
      if (faqFieldName && faqInternalIdKey) {
        update[faqFieldName] = faqs.map((faq) => faq.Name).filter(Boolean);
        update[faqInternalIdKey] = faqIds;
      }
      return {
        ...update,
      };
    });
    await pushLinkedItemUpdatesSequentially(affectedRows, updates);
  }
  async function saveChanged() {
    const rows = Array.from(state.dirty.values());
    if (!rows.length) return showStatus("No changed Item FAQ records to save.", "warning");
    if (rows.some((row) => !String(row.Name || "").trim())) return showStatus("Every FAQ needs a name before saving.", "warning");
    const affectedItemIds = affectedItemIdsForChangedFaqs(rows);
    showStatus("Saving Item FAQ records...", "info");
    const data = await api("/item-faqs/save", { method: "POST", body: JSON.stringify({ environment: state.environment, rows }) });
    const failed = (data.results || []).filter((result) => result.status === "Error");
    el.suitepimPushReport.hidden = false;
    el.suitepimPushReport.innerHTML = `<div class="suitepim-push-report-header"><h2>Item FAQ save report</h2></div><div class="suitepim-push-report-body">${(data.results || []).map((result) => `<div><strong>${escapeHtml(result.name || result.id || "FAQ")}</strong> - ${escapeHtml(result.status)}${result.error ? `: ${escapeHtml(result.error)}` : ""}</div>`).join("")}</div>`;
    showStatus(failed.length ? `${failed.length} Item FAQ record(s) failed to save.` : "Item FAQ records saved.", failed.length ? "error" : "success");
    if ((data.results || []).some((result) => result.status !== "Error")) {
      await refreshLinkedItemsForFaqs(rows, data, affectedItemIds);
    }
    await loadRows();
  }
  function bindEvents() {
    el.suitepimSearch.addEventListener("input", applyFilters);
    el.suitepimStateFilter.addEventListener("change", applyFilters);
    el.suitepimAddBtn.addEventListener("click", addRecord);
    el.suitepimRefreshBtn.addEventListener("click", () => loadRows().catch((err) => showStatus(err.message, "error")));
    el.suitepimSaveBtn.addEventListener("click", () => saveChanged().catch((err) => showStatus(err.message, "error")));
    el.suitepimMount.addEventListener("click", (event) => {
      const button = event.target.closest("[data-key]");
      if (button) { state.activeKey = button.dataset.key; render(); return; }
      if (event.target.closest("[data-action='items']")) openItemsModal().catch((err) => showStatus(err.message, "error"));
    });
    el.suitepimMount.addEventListener("input", (event) => {
      const control = event.target.closest("[data-field]");
      const row = activeRow();
      if (!control || !row) return;
      row[control.dataset.field] = control.value;
      markDirty(row, false);
    });
    el.suitepimModalSearch.addEventListener("input", () => renderItemOptions());
    el.suitepimModalClose.addEventListener("click", closeModal);
    el.suitepimModalCancel.addEventListener("click", closeModal);
    el.suitepimModalSave.addEventListener("click", saveItemsModal);
  }
  function savedEnvironment() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return String(saved?.env || "").toLowerCase() === "production" ? "production" : "sandbox";
  }
  document.addEventListener("DOMContentLoaded", () => {
    state.environment = savedEnvironment();
    initEls();
    bindEvents();
    loadRows().catch((err) => showStatus(err.message, "error"));
  });
})();
