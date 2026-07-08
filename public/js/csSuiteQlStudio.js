document.addEventListener("DOMContentLoaded", () => {
  const el = {
    query: document.getElementById("suiteQlStudioQuery"),
    run: document.getElementById("runSuiteQlStudioBtn"),
    meta: document.getElementById("suiteQlStudioMeta"),
    output: document.getElementById("suiteQlStudioOutput"),
    table: document.getElementById("suiteQlStudioTable"),
    maxRows: document.getElementById("suiteQlStudioMaxRows"),
  };

  function authHeaders(extra = {}) {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    const token = saved?.token || "";
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderTable(rows = []) {
    if (!rows.length) {
      el.table.hidden = true;
      el.table.innerHTML = "";
      return;
    }
    const columns = Array.from(rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())).slice(0, 24);
    el.table.hidden = false;
    el.table.innerHTML = `
      <table class="suiteql-studio-table">
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.slice(0, 100).map((row) => `
            <tr>${columns.map((column) => `<td>${escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  async function runSuiteQl() {
    const query = String(el.query?.value || "").trim();
    const maxRows = Number(el.maxRows?.value || 1000);
    if (!query) {
      el.meta.textContent = "Enter a SuiteQL query first.";
      return;
    }

    el.run.disabled = true;
    el.meta.textContent = "Running...";
    el.output.textContent = "";
    renderTable([]);

    try {
      const response = await fetch("/api/cs-workflows/suiteql/run", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, maxRows }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);

      const rows = Array.isArray(data.rows) ? data.rows : [];
      const count = data.count ?? rows.length;
      const elapsed = Number.isFinite(Number(data.elapsedMs)) ? ` in ${Number(data.elapsedMs)}ms` : "";
      const capped = data.capped ? " (more rows available)" : "";
      el.meta.textContent = `${count} row${count === 1 ? "" : "s"}${elapsed}${capped}`;
      renderTable(rows);
      el.output.textContent = JSON.stringify(data.raw ?? rows, null, 2);
    } catch (err) {
      el.meta.textContent = "SuiteQL failed.";
      el.output.textContent = JSON.stringify({
        success: false,
        message: err.message || "SuiteQL failed",
      }, null, 2);
    } finally {
      el.run.disabled = false;
    }
  }

  el.run?.addEventListener("click", runSuiteQl);
});
