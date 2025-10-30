// public/js/reports/customerLookup.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("👥 customerLookup.js loaded");

  const lookupBtn = document.getElementById("lookupBtn");
  const lookupQuery = document.getElementById("lookupQuery");
  const tableBody = document.querySelector("#customerLookupTable tbody");
  const tableWrapper = document.querySelector(".table-wrapper");

  let allResults = [];
  let currentPage = 1;
  const pageSize = 25;
  let expandedRowId = null;

  /* =====================================================
     Render Table Rows
  ===================================================== */
  function renderPage(page = 1) {
    if (!tableBody) return;
    tableBody.innerHTML = "";

    const start = (page - 1) * pageSize;
    const pageResults = allResults.slice(start, start + pageSize);

    if (pageResults.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#999;">No results found.</td></tr>`;
      return;
    }

    for (const r of pageResults) {
      const id = r["Internal ID"] || "-";
      const name = `${r["First Name"] || ""} ${r["Last Name"] || ""}`.trim() || "-";

      const tr = document.createElement("tr");
      tr.classList.add("customer-row");
      tr.dataset.id = id;
      tr.innerHTML = `
        <td>${id}</td>
        <td>${name}</td>
        <td>
          <select class="actionSelect" data-id="${id}">
            <option value="">-- Select --</option>
            <option value="sale">New Sale</option>
            <option value="quote">New Quote</option>
          </select>
        </td>
        <td>
          <button class="btn-primary small-btn goBtn" data-id="${id}">Go</button>
        </td>
      `;
      tableBody.appendChild(tr);
    }

    renderPaginationControls();
  }

  /* =====================================================
     Expand / Collapse Row Logic (Stable + Wider Table)
  ===================================================== */
  function toggleRowExpansion(rowId) {
    // Collapse existing expanded row if open
    const existingExpanded = document.querySelector(".expanded-row");
    if (existingExpanded) {
      existingExpanded.classList.remove("expanded-visible");
      setTimeout(() => {
        existingExpanded.remove();
        tableWrapper?.classList.remove("expanded-mode");
        tableWrapper.style.maxWidth = "950px"; // revert width
      }, 200);
    }

    // Close if same row clicked again
    if (expandedRowId === rowId) {
      expandedRowId = null;
      return;
    }

    const record = allResults.find(r => String(r["Internal ID"]) === String(rowId));
    if (!record) return;
    expandedRowId = rowId;

    // Build left-side table
    const leftTable = `
      <table class="detail-table">
        <tbody>
          ${Object.entries(record)
            .map(([key, val]) => {
              const cleanVal = val === null || val === undefined || val === "" ? "<em>-</em>" : val;
              return `<tr><th>${key}</th><td>${cleanVal}</td></tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;

    // Expanded row markup
    const tr = document.createElement("tr");
    tr.classList.add("expanded-row");

    const td = document.createElement("td");
    td.colSpan = 4;
    td.innerHTML = `
      <div class="expand-panel">
        <div class="expand-left">
          <div class="panel-header">🧾 Customer Information</div>
          ${leftTable}
        </div>

        <div class="expand-divider"></div>

        <div class="expand-right">
          <div class="panel-header">📦 Related Records</div>
          <div id="expand-right-${rowId}" class="right-content">
            <div class="loading-right">Loading related records...</div>
          </div>
        </div>
      </div>
    `;
    tr.appendChild(td);

    // Insert and animate
    const targetRow = document.querySelector(`tr[data-id="${rowId}"]`);
    if (targetRow) {
      targetRow.insertAdjacentElement("afterend", tr);
      requestAnimationFrame(() => tr.classList.add("expanded-visible"));
      tableWrapper?.classList.add("expanded-mode");

      // 👇 Slightly widen table container when expanded
      tableWrapper.style.maxWidth = "1150px";

      // Load related transactions
      loadCustomerTransactions(rowId);
    }
  }

  /* =====================================================
     Load Customer Transactions (Right Panel)
  ===================================================== */
  async function loadCustomerTransactions(customerId) {
    const panel = document.getElementById(`expand-right-${customerId}`);
    if (!panel) return;

    try {
      const session = storageGet();
      const token = session?.token;
      if (!token) {
        panel.innerHTML = `<div class="error-msg">No active session — please log in again.</div>`;
        return;
      }

      const res = await fetch(`/api/netsuite/customer-transactions/${customerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      console.log("📨 Customer transactions response:", data);

      if (!data.ok || !Array.isArray(data.results) || data.results.length === 0) {
        panel.innerHTML = `<div class="no-results">No related records found.</div>`;
        return;
      }

      // Render transaction table
      const tableHTML = `
        <table class="txn-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Document #</th>
              <th>Type</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${data.results
              .map(r => {
                const date = r.date || "-";
                const doc = r.documentnumber || "-";
                const type = r.recordtype || "-";
                const status = r.statusText || r.status || "-";
                const amount =
                  r.amount !== undefined && r.amount !== null
                    ? `£${parseFloat(r.amount).toFixed(2)}`
                    : "-";
                return `
                  <tr>
                    <td>${date}</td>
                    <td>${doc}</td>
                    <td>${type}</td>
                    <td>${status}</td>
                    <td style="text-align:right;">${amount}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `;

      panel.innerHTML = tableHTML;
    } catch (err) {
      console.error("❌ Error fetching customer transactions:", err);
      panel.innerHTML = `<div class="error-msg">Error loading transactions.</div>`;
    }
  }

  /* =====================================================
     Pagination Controls
  ===================================================== */
  function renderPaginationControls() {
    let pagination = document.getElementById("pagination");
    if (!pagination) {
      pagination = document.createElement("div");
      pagination.id = "pagination";
      pagination.style.marginTop = "1rem";
      pagination.style.textAlign = "center";
      tableBody.parentElement.after(pagination);
    }

    const totalPages = Math.ceil(allResults.length / pageSize);
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      return;
    }

    pagination.innerHTML = `
      <button class="btn-secondary" id="prevPage" ${currentPage === 1 ? "disabled" : ""}>◀ Prev</button>
      <span style="margin:0 10px;">Page ${currentPage} of ${totalPages}</span>
      <button class="btn-secondary" id="nextPage" ${currentPage === totalPages ? "disabled" : ""}>Next ▶</button>
    `;

    document.getElementById("prevPage")?.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        renderPage(currentPage);
      }
    });

    document.getElementById("nextPage")?.addEventListener("click", () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderPage(currentPage);
      }
    });
  }

  /* =====================================================
     Fetch + Filter Logic
  ===================================================== */
  async function runCustomerLookup(auto = false) {
    if (!tableBody) return;
    if (!auto) console.log("🔍 Running lookup manually...");
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;">⏳ Loading...</td></tr>`;

    try {
      const res = await fetch("/api/netsuite/customer-lookup");
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];

      const query = lookupQuery?.value?.trim().toLowerCase() || "";
      allResults = query
        ? results.filter(r =>
            Object.values(r).join(" ").toLowerCase().includes(query)
          )
        : results;

      currentPage = 1;
      expandedRowId = null;
      renderPage(currentPage);
    } catch (err) {
      console.error("❌ Failed to load customer lookup:", err);
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:red;">Error fetching data</td></tr>`;
    }
  }

  /* =====================================================
     Event Handlers
  ===================================================== */
  lookupBtn?.addEventListener("click", () => runCustomerLookup(false));
  lookupQuery?.addEventListener("keypress", e => {
    if (e.key === "Enter") runCustomerLookup(false);
  });

  tableBody?.addEventListener("click", e => {
    const row = e.target.closest(".customer-row");

    if (e.target.classList.contains("goBtn")) {
      const id = e.target.dataset.id;
      console.log(`➡️ Go button clicked for customer ${id}`);
      return;
    }

    if (row && !e.target.classList.contains("actionSelect") && !e.target.classList.contains("goBtn")) {
      toggleRowExpansion(row.dataset.id);
    }
  });

  tableBody?.addEventListener("change", e => {
    if (!e.target.classList.contains("actionSelect")) return;
    const action = e.target.value;
    const custId = e.target.dataset.id;

    if (action === "sale") {
      window.location.href = `/sales/new?customer=${custId}`;
    } else if (action === "quote") {
      window.location.href = `/quote/new?customer=${custId}`;
    }

    e.target.value = "";
  });

  window.addEventListener("reports:tabchange", e => {
    if (e.detail.id === "customerLookup" && allResults.length === 0) runCustomerLookup(true);
  });

  // Auto-load initial data
  runCustomerLookup(true);
});
