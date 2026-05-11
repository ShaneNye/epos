(function () {
  const state = {
    pages: [],
    processes: [],
    editing: null,
  };

  const els = {};

  function authHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Request failed.");
    }
    return payload;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function pageLabel(value) {
    return state.pages.find((page) => page.value === value)?.label || value;
  }

  function populatePageSelects() {
    const options = state.pages
      .map((page) => `<option value="${escapeHtml(page.value)}">${escapeHtml(page.label)}</option>`)
      .join("");

    els.page.innerHTML = `<option value="">Select a page</option>${options}`;
    els.filterPage.innerHTML = `<option value="">All pages</option>${options}`;
  }

  function resetForm() {
    state.editing = null;
    els.id.value = "";
    els.form.reset();
    els.saveBtn.textContent = "Save Process";
  }

  function fillForm(process) {
    state.editing = process;
    els.id.value = process.id;
    els.title.value = process.title || "";
    els.page.value = process.page || "";
    els.scribeLink.value = process.scribeLink || "";
    els.videoLink.value = process.videoLink || "";
    els.saveBtn.textContent = "Update Process";
    els.title.focus();
  }

  function renderTable() {
    const filterPage = els.filterPage.value;
    const rows = state.processes.filter((process) => !filterPage || process.page === filterPage);

    if (!rows.length) {
      els.tableBody.innerHTML = `
        <tr>
          <td class="systems-processes-empty" colspan="5">No systems or processes found.</td>
        </tr>
      `;
      return;
    }

    els.tableBody.innerHTML = rows
      .map((process) => `
        <tr>
          <td>${escapeHtml(process.title)}</td>
          <td>${escapeHtml(pageLabel(process.page))}</td>
          <td>${process.scribeLink ? `<a href="${escapeHtml(process.scribeLink)}" target="_blank" rel="noopener">Open</a>` : ""}</td>
          <td>${process.videoLink ? `<a href="${escapeHtml(process.videoLink)}" target="_blank" rel="noopener">Open</a>` : ""}</td>
          <td class="actions">
            <button type="button" class="action-btn action-edit" data-action="edit" data-id="${process.id}">Edit</button>
            <button type="button" class="action-btn action-delete" data-action="delete" data-id="${process.id}">Delete</button>
          </td>
        </tr>
      `)
      .join("");
  }

  async function loadData() {
    const [pagesPayload, processesPayload] = await Promise.all([
      fetchJson("/api/systems-processes/pages"),
      fetchJson("/api/systems-processes"),
    ]);

    state.pages = pagesPayload.pages || [];
    state.processes = processesPayload.processes || [];
    populatePageSelects();
    renderTable();
  }

  async function saveProcess(event) {
    event.preventDefault();

    const payload = {
      title: els.title.value.trim(),
      page: els.page.value,
      scribeLink: els.scribeLink.value.trim(),
      videoLink: els.videoLink.value.trim(),
    };

    const id = els.id.value;
    const method = id ? "PUT" : "POST";
    const url = id ? `/api/systems-processes/${encodeURIComponent(id)}` : "/api/systems-processes";

    els.saveBtn.disabled = true;
    try {
      await fetchJson(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      resetForm();
      await loadData();
    } catch (error) {
      console.error("Failed to save systems process:", error);
      alert(error.message || "Failed to save systems process.");
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  async function deleteProcess(id) {
    if (!confirm("Delete this systems process?")) return;
    try {
      await fetchJson(`/api/systems-processes/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadData();
      if (String(els.id.value) === String(id)) resetForm();
    } catch (error) {
      console.error("Failed to delete systems process:", error);
      alert(error.message || "Failed to delete systems process.");
    }
  }

  function bindEvents() {
    els.form.addEventListener("submit", saveProcess);
    els.cancelBtn.addEventListener("click", resetForm);
    els.newBtn.addEventListener("click", () => {
      resetForm();
      els.title.focus();
    });
    els.filterPage.addEventListener("change", renderTable);

    els.tableBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const process = state.processes.find((item) => String(item.id) === String(button.dataset.id));
      if (!process) return;

      if (button.dataset.action === "edit") fillForm(process);
      if (button.dataset.action === "delete") deleteProcess(process.id);
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    Object.assign(els, {
      form: document.getElementById("processForm"),
      id: document.getElementById("processId"),
      title: document.getElementById("processTitle"),
      page: document.getElementById("processPage"),
      scribeLink: document.getElementById("processScribeLink"),
      videoLink: document.getElementById("processVideoLink"),
      filterPage: document.getElementById("processFilterPage"),
      tableBody: document.querySelector("#processTable tbody"),
      saveBtn: document.getElementById("saveProcessBtn"),
      cancelBtn: document.getElementById("cancelProcessBtn"),
      newBtn: document.getElementById("newProcessBtn"),
    });

    if (!els.form || !els.tableBody) return;
    bindEvents();

    try {
      await loadData();
    } catch (error) {
      console.error("Failed to load systems processes:", error);
      els.tableBody.innerHTML = `
        <tr>
          <td class="systems-processes-empty" colspan="5">Failed to load systems and processes.</td>
        </tr>
      `;
    }
  });
})();
