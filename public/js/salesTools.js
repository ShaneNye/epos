document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#dispatchTrackAgeingTable tbody");
  const ageBucketFilter = document.getElementById("ageBucketFilter");
  const searchInput = document.getElementById("salesToolsSearch");
  const refreshButton = document.getElementById("refreshDispatchTrackAgeing");
  const count60 = document.getElementById("count60");
  const count90 = document.getElementById("count90");
  const count100 = document.getElementById("count100");

  let rows = [];

  function authHeaders() {
    const saved = localStorage.getItem("eposAuth") || sessionStorage.getItem("eposAuth");
    const parsed = saved ? JSON.parse(saved) : {};
    return parsed.token ? { Authorization: `Bearer ${parsed.token}` } : {};
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function bucketClass(bucket) {
    if (bucket === "100+") return "bucket-100";
    if (bucket === "90") return "bucket-90";
    return "bucket-60";
  }

  function matchesSearch(row, query) {
    if (!query) return true;
    return [
      row["Document Number"],
      row.dispatchTrackDocumentNumber,
      row.Name,
      row.Store,
      row["Order Type"],
      row.Schedule,
    ].some((value) => String(value || "").toLowerCase().includes(query));
  }

  function updateCounts() {
    count60.textContent = rows.filter((row) => row.ageBucket === "60").length;
    count90.textContent = rows.filter((row) => row.ageBucket === "90").length;
    count100.textContent = rows.filter((row) => row.ageBucket === "100+").length;
  }

  function render() {
    const bucket = ageBucketFilter.value;
    const query = searchInput.value.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const bucketMatch = bucket === "all" || row.ageBucket === bucket;
      return bucketMatch && matchesSearch(row, query);
    });

    if (!filtered.length) {
      tableBody.innerHTML = `<tr><td colspan="8">No Dispatch Track aged sales orders found.</td></tr>`;
      return;
    }

    tableBody.innerHTML = filtered.map((row) => {
      const id = row.ID || row.id || "";
      const documentNumber = row["Document Number"] || row.documentNumber || "";
      const documentCell = id
        ? `<a href="/sales/view/${encodeURIComponent(id)}" class="doc-link">${escapeHtml(documentNumber)}</a>`
        : escapeHtml(documentNumber);

      return `
        <tr>
          <td><span class="age-pill ${bucketClass(row.ageBucket)}">${escapeHtml(row.daysInDispatchTrack)} days</span></td>
          <td>${escapeHtml(row.dispatchTrackExportedAt)}</td>
          <td>${escapeHtml(row.Name)}</td>
          <td>${documentCell}</td>
          <td>${escapeHtml(row.dispatchTrackDocumentNumber)}</td>
          <td>${escapeHtml(row.Store)}</td>
          <td>${escapeHtml(row["Order Type"])}</td>
          <td>${escapeHtml(row.Schedule)}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadAgeingData() {
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing";
    tableBody.innerHTML = `<tr><td colspan="8">Loading Dispatch Track ageing...</td></tr>`;

    try {
      const response = await fetch(`/api/sales-tools/dispatch-track-ageing?refresh=1&_=${Date.now()}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Failed to load Dispatch Track ageing");

      rows = Array.isArray(payload.results) ? payload.results : [];
      updateCounts();
      render();
    } catch (err) {
      console.error("Failed to load Dispatch Track ageing:", err);
      rows = [];
      updateCounts();
      tableBody.innerHTML = `<tr><td colspan="8">Error loading Dispatch Track ageing.</td></tr>`;
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  }

  ageBucketFilter.addEventListener("change", render);
  searchInput.addEventListener("input", render);
  refreshButton.addEventListener("click", loadAgeingData);

  loadAgeingData();
});
