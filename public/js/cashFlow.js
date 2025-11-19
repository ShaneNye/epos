document.addEventListener("DOMContentLoaded", async () => {
    const token = storageGet()?.token;

    /* ================================
       PANEL 1 — Store Balances
    ================================= */
    async function loadBalances() {
        const body = document.getElementById("cashflowOverviewBody");
        body.innerHTML = `<tr><td colspan="3">Loading...</td></tr>`;

        const res = await fetch("/api/meta/locations");
        const data = await res.json();
        const locations = data.locations || [];

        body.innerHTML = "";

locations.forEach(loc => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
        <td>${loc.name}</td>
        <td>£${Number(loc.float_balance || 0).toFixed(2)}</td>
        <td>£${Number(loc.safe_balance || 0).toFixed(2)}</td>
        <td>
            <button class="btn-small btn-empty-safe" data-id="${loc.id}">
                Safe Emptied
            </button>
        </td>
    `;

    body.appendChild(tr);
});

    }

    await loadBalances();

    document.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("btn-empty-safe")) return;

    const id = e.target.dataset.id;

    if (!confirm("Confirm: Mark safe as emptied and reset to £0.00?")) {
        return;
    }

    e.target.disabled = true;
    e.target.textContent = "Processing…";

    const res = await fetch(`/api/meta/locations/${id}/safe-emptied`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();

    if (!data.ok) {
        alert("Error: " + data.error);
        e.target.disabled = false;
        e.target.textContent = "Safe Emptied";
        return;
    }

    // Refresh table
    loadBalances();
});



    /* ================================
       PANEL 2 — Store Dropdown
    ================================= */
    const storeFilter = document.getElementById("filterStore");

    async function loadStoreDropdown() {
        const res = await fetch("/api/meta/locations");
        const data = await res.json();

        (data.locations || []).forEach(loc => {
            const opt = document.createElement("option");
            opt.value = loc.id;         
            opt.textContent = loc.name;
            storeFilter.appendChild(opt);
        });
    }

    await loadStoreDropdown();


    /* ================================
       PANEL 2 — Filter Submissions
    ================================= */
    const fromEl = document.getElementById("filterFrom");
    const toEl = document.getElementById("filterTo");
    const resultsBody = document.getElementById("eodResultsBody");

    document.getElementById("filterBtn").addEventListener("click", async () => {

        const storeId = storeFilter.value || "";
        const from = fromEl.value || "";
        const to = toEl.value || "";

        resultsBody.innerHTML = `<tr><td colspan="4">Loading…</td></tr>`;

        const res = await fetch(
            "/api/eod/submissions?" +
            new URLSearchParams({ storeId, from, to }),
            { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );

        const data = await res.json();
        const rows = data.results || [];

        if (!rows.length) {
            resultsBody.innerHTML = `<tr><td colspan="4" class="empty-row">No submissions found.</td></tr>`;
            return;
        }

        resultsBody.innerHTML = "";

        rows.forEach(record => {

            /* -------------------------------------------
               COLLAPSED ROW (main summary)
            ------------------------------------------- */
            const tr = document.createElement("tr");
            tr.classList.add("eod-row");
            tr.dataset.id = record.id;

            tr.innerHTML = `
                <td>${record.date.substring(0, 10)}</td>
                <td>${record.storeName}</td>
                <td>${record.signoffUser}</td>
                <td style="text-align:right;">
                    £${record.totals.safe.toFixed(2)} / £${record.totals.float.toFixed(2)}
                </td>
            `;

            resultsBody.appendChild(tr);

            /* -------------------------------------------
               DETAIL ROW (hidden until expanded)
            ------------------------------------------- */
            const detail = document.createElement("tr");
            detail.classList.add("eod-detail-row", "hidden");

            detail.innerHTML = `
                <td colspan="4">
                    <div class="eod-details">

                        <h4>Deposits</h4>
                        <table class="inner-table">
                            <thead>
                                <tr>
                                    <th>Document</th>
                                    <th>Customer</th>
                                    <th>Method</th>
                                    <th style="text-align:right;">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${record.deposits.map(d => `
                                    <tr>
                                        <td>${d.doc}</td>
                                        <td>${d.customerName}</td>
                                        <td>${d.paymentMethod}</td>
                                        <td style="text-align:right;">£${d.amount.toFixed(2)}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>

                        <h4>Cashflow</h4>
                        <table class="inner-table">
                            <thead>
                                <tr>
                                    <th>Document</th>
                                    <th>Safe</th>
                                    <th>Float</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${record.cashflow.map(c => `
                                    <tr>
                                        <td>${c.doc}</td>
                                        <td>£${c.safe.toFixed(2)}</td>
                                        <td>£${c.float.toFixed(2)}</td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>

                        <h4>Adjustments</h4>
                        <table class="inner-table">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Location</th>
                                    <th>Reason</th>
                                    <th style="text-align:right;">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${
                                    record.adjustments.length 
                                    ? record.adjustments.map(a => `
                                        <tr>
                                            <td>${a.type}</td>
                                            <td>${a.location}</td>
                                            <td>${a.reason}</td>
                                            <td style="text-align:right;">£${a.amount.toFixed(2)}</td>
                                        </tr>
                                      `).join("")
                                    : `<tr><td colspan="4" class="empty-row">No adjustments</td></tr>`
                                }
                            </tbody>
                        </table>

                        <div class="submitted-info">
                            Submitted by <strong>${record.signoffUser}</strong><br>
                            At: ${new Date(record.createdAt).toLocaleString()}
                        </div>

                    </div>
                </td>
            `;

            resultsBody.appendChild(detail);
        });
    });


    /* ================================
       Expand / Collapse Logic
    ================================= */
    resultsBody.addEventListener("click", e => {
        const row = e.target.closest(".eod-row");
        if (!row) return;

        const detail = row.nextElementSibling;
        detail.classList.toggle("hidden");
    });
});
