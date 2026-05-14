(function () {
  let loaded = false;

  function authHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  function setStatus(message, tone = "") {
    const el = document.getElementById("salesOrderFeedbackStatus");
    if (!el) return;
    el.textContent = message || "";
    if (tone) el.dataset.tone = tone;
    else delete el.dataset.tone;
  }

  function pct(value) {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  function score(value) {
    const n = Number(value || 0);
    return n ? n.toFixed(2) : "-";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fillTable(tableId, rows, columns, emptyText) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}">${emptyText}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((row) => {
        const cells = columns.map((column) => `<td>${escapeHtml(column(row))}</td>`).join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
  }

  async function loadSalesOrderExperience() {
    setStatus("Loading...");

    try {
      const res = await fetch("/api/sales-order-experience/analytics", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load feedback analytics.");

      fillTable(
        "salesOrderFeedbackGroupTable",
        data.groupPivot || [],
        [
          (row) => row.month || "-",
          (row) => Number(row.created_count || 0).toLocaleString(),
          (row) => Number(row.response_count || 0).toLocaleString(),
          (row) => pct(row.response_rate),
          (row) => score(row.average_score),
        ],
        "No SalesOrder experience data yet."
      );

      fillTable(
        "salesOrderFeedbackStoreTable",
        data.storePivot || [],
        [
          (row) => row.month || "-",
          (row) => row.store_name || "Unknown Store",
          (row) => Number(row.created_count || 0).toLocaleString(),
          (row) => Number(row.response_count || 0).toLocaleString(),
          (row) => pct(row.response_rate),
          (row) => score(row.average_score),
        ],
        "No store feedback data yet."
      );

      fillTable(
        "salesOrderFeedbackCommentsTable",
        data.comments || [],
        [
          (row) => row.submitted_at || "-",
          (row) => row.document_type || "-",
          (row) => row.store_name || "Unknown Store",
          (row) => Number(row.score || 0),
          (row) => row.comment || "",
        ],
        "No low-score comments yet."
      );

      loaded = true;
      setStatus("Loaded", "success");
    } catch (err) {
      console.error("SalesOrder feedback admin load failed:", err);
      setStatus(err.message || "Failed to load analytics.", "error");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document
      .getElementById("refreshSalesOrderFeedback")
      ?.addEventListener("click", loadSalesOrderExperience);
  });

  window.addEventListener("tab:show", (event) => {
    if (event.detail?.id === "sales-order-feedback" && !loaded) {
      loadSalesOrderExperience();
    }
  });
})();
