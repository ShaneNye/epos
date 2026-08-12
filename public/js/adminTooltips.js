document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#tooltipPagesTable tbody");
  const modal = document.getElementById("tooltipModal");
  const modalPanel = modal?.querySelector(".tooltip-modal-content");
  const rows = document.getElementById("tooltipEditorRows");
  const pageStatus = document.getElementById("tooltipAdminStatus");
  const modalStatus = document.getElementById("tooltipModalStatus");
  const search = document.getElementById("tooltipPageSearch");
  const filter = document.getElementById("tooltipPageFilter");
  const saveButton = document.getElementById("saveTooltips");
  const addButton = document.getElementById("addTooltipRow");
  if (!tableBody || !modal || !rows) return;

  let pages = [];
  let activePage = null;
  let activeRevision = 0;
  let opener = null;
  let dirty = false;
  let loadingController = null;

  const setStatus = (target, message, tone = "") => {
    target.textContent = message;
    target.dataset.tone = tone;
  };

  function filteredPages() {
    const query = search.value.trim().toLowerCase();
    return pages.filter((page) => {
      const matchesSearch = !query || `${page.name} ${page.file}`.toLowerCase().includes(query);
      const matchesFilter = filter.value === "all"
        || (filter.value === "configured" && page.configured > 0)
        || (filter.value === "unconfigured" && page.configured === 0)
        || (filter.value === "fields" && page.fields.length > 0);
      return matchesSearch && matchesFilter;
    });
  }

  function renderPages() {
    tableBody.innerHTML = "";
    const visible = filteredPages();
    if (!visible.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "admin-empty-state";
      td.textContent = "No pages match your search and filter.";
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }
    visible.forEach((page) => {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.innerHTML = `<strong></strong><small></small>`;
      name.querySelector("strong").textContent = page.name;
      name.querySelector("small").textContent = page.file;
      const available = document.createElement("td");
      available.textContent = page.fields.length;
      const configured = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `tooltip-status-badge ${page.configured ? "is-configured" : ""}`;
      badge.textContent = page.configured ? `${page.configured} configured` : "Not configured";
      configured.appendChild(badge);
      const action = document.createElement("td");
      const manage = document.createElement("button");
      manage.type = "button";
      manage.className = "action-btn action-edit";
      manage.textContent = "Manage";
      manage.disabled = page.fields.length === 0 && page.configured === 0;
      if (manage.disabled) manage.title = "No tooltip-compatible fields found on this page";
      manage.addEventListener("click", () => openPage(page, manage));
      action.appendChild(manage);
      tr.append(name, available, configured, action);
      tableBody.appendChild(tr);
    });
  }

  function markDirty() { dirty = true; }

  function addRow(item = {}, focus = false) {
    const card = document.createElement("section");
    card.className = "tooltip-editor-row";
    const fieldId = `tooltip-field-${crypto.randomUUID()}`;
    const messageId = `tooltip-message-${crypto.randomUUID()}`;
    card.innerHTML = `
      <div class="tooltip-editor-field"><label for="${fieldId}">Field</label><select id="${fieldId}" required><option value="">Select a field…</option></select></div>
      <div class="tooltip-editor-message"><label for="${messageId}">Tooltip message</label><textarea id="${messageId}" rows="3" maxlength="2000" placeholder="Write concise, helpful guidance…"></textarea><div class="tooltip-message-meta"><span class="tooltip-character-count">0 / 2000</span><button type="button" class="tooltip-preview-button">Preview</button></div></div>
      <button type="button" class="tooltip-remove" aria-label="Remove this tooltip">Remove</button>
      <div class="tooltip-admin-preview hidden" role="status"><button type="button" aria-label="Close preview">×</button><span></span></div>`;
    const select = card.querySelector("select");
    activePage.fields.forEach((field) => {
      const option = document.createElement("option");
      option.value = field.key;
      option.textContent = `${field.label} (${field.key})`;
      option.dataset.label = field.label;
      option.selected = field.key === item.fieldKey;
      select.appendChild(option);
    });
    if (item.fieldKey && !activePage.fields.some((field) => field.key === item.fieldKey)) {
      const option = new Option(`${item.fieldLabel} (${item.fieldKey})`, item.fieldKey, true, true);
      option.dataset.label = item.fieldLabel;
      select.appendChild(option);
    }
    const textarea = card.querySelector("textarea");
    const counter = card.querySelector(".tooltip-character-count");
    textarea.value = item.message || "";
    counter.textContent = `${textarea.value.length} / 2000`;
    select.addEventListener("change", markDirty);
    textarea.addEventListener("input", () => { counter.textContent = `${textarea.value.length} / 2000`; markDirty(); });
    const removeButton = card.querySelector(".tooltip-remove");
    removeButton.addEventListener("click", () => {
      const removed = card.classList.toggle("is-removed");
      removeButton.textContent = removed ? "Undo removal" : "Remove";
      removeButton.setAttribute("aria-label", removed ? "Undo removal of this tooltip" : "Remove this tooltip");
      markDirty();
    });
    const preview = card.querySelector(".tooltip-admin-preview");
    card.querySelector(".tooltip-preview-button").addEventListener("click", () => {
      preview.querySelector("span").textContent = textarea.value.trim() || "Enter a message to preview it.";
      preview.classList.remove("hidden");
    });
    preview.querySelector("button").addEventListener("click", () => preview.classList.add("hidden"));
    rows.appendChild(card);
    if (focus) select.focus();
  }

  function setEditorBusy(busy, message = "") {
    saveButton.disabled = busy;
    addButton.disabled = busy;
    if (message) setStatus(modalStatus, message);
    rows.toggleAttribute("aria-busy", busy);
  }

  async function openPage(page, trigger) {
    loadingController?.abort();
    loadingController = new AbortController();
    activePage = page;
    activeRevision = page.revision || 0;
    opener = trigger;
    dirty = false;
    rows.innerHTML = '<div class="tooltip-loading">Loading tooltips…</div>';
    document.getElementById("tooltipModalTitle").textContent = `${page.name} tooltips`;
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    setStatus(modalStatus, "");
    setEditorBusy(true);
    modalPanel.focus();
    try {
      const response = await fetch(`/api/tooltips?page=${encodeURIComponent(page.key)}`, { signal: loadingController.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load tooltips");
      if (activePage !== page) return;
      rows.innerHTML = "";
      activeRevision = data.revision || 0;
      (data.tooltips.length ? data.tooltips : [{}]).forEach((item) => addRow(item));
      dirty = false;
      setEditorBusy(false);
      rows.querySelector("select")?.focus();
    } catch (error) {
      if (error.name === "AbortError") return;
      rows.innerHTML = '<div class="admin-empty-state">The tooltip editor could not be loaded.</div>';
      setStatus(modalStatus, error.message, "error");
      setEditorBusy(false);
    }
  }

  function closeEditor(force = false) {
    if (!force && dirty && !window.confirm("Discard your unsaved tooltip changes?")) return;
    loadingController?.abort();
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
    dirty = false;
    opener?.focus();
  }

  async function loadPages(force = false) {
    if (pages.length && !force) return;
    setStatus(pageStatus, "Loading pages…");
    try {
      const response = await fetch("/api/tooltips/pages");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load pages");
      pages = data.pages;
      renderPages();
      setStatus(pageStatus, `${pages.length} pages available.`);
    } catch (error) {
      setStatus(pageStatus, error.message || "Unable to load pages", "error");
    }
  }

  search.addEventListener("input", renderPages);
  filter.addEventListener("change", renderPages);
  addButton.addEventListener("click", () => { addRow({}, true); markDirty(); });
  [document.getElementById("cancelTooltips"), document.getElementById("closeTooltips")].forEach((button) => button.addEventListener("click", () => closeEditor()));
  modal.addEventListener("click", (event) => { if (event.target === modal) closeEditor(); });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeEditor(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll('button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  saveButton.addEventListener("click", async () => {
    const cards = [...rows.querySelectorAll(".tooltip-editor-row:not(.is-removed)")];
    const tooltips = cards.map((card) => {
      const select = card.querySelector("select");
      return { fieldKey: select.value, fieldLabel: select.selectedOptions[0]?.dataset.label || "", message: card.querySelector("textarea").value.trim() };
    }).filter((item) => item.fieldKey || item.message);
    const invalidCard = cards.find((card) => {
      const select = card.querySelector("select"), textarea = card.querySelector("textarea");
      return (select.value || textarea.value.trim()) && (!select.value || !textarea.value.trim());
    });
    if (invalidCard) { setStatus(modalStatus, "Each tooltip needs a field and a message.", "error"); invalidCard.querySelector(":invalid, select, textarea").focus(); return; }
    if (new Set(tooltips.map((item) => item.fieldKey)).size !== tooltips.length) { setStatus(modalStatus, "Each field can only have one tooltip.", "error"); return; }
    setEditorBusy(true, "Saving tooltips…");
    try {
      const response = await fetch(`/api/tooltips/${encodeURIComponent(activePage.key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tooltips, revision: activeRevision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save tooltips");
      activeRevision = data.revision;
      activePage.revision = data.revision;
      activePage.configured = tooltips.length;
      dirty = false;
      renderPages();
      closeEditor(true);
      setStatus(pageStatus, `Saved ${tooltips.length} tooltip${tooltips.length === 1 ? "" : "s"} for ${activePage.name}.`, "success");
    } catch (error) {
      setStatus(modalStatus, error.message, "error");
      setEditorBusy(false);
    }
  });

  window.addEventListener("tab:show", (event) => event.detail?.id === "tooltips" && loadPages());
  if (!document.getElementById("tooltips").classList.contains("hidden")) loadPages();
});
