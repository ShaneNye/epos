document.addEventListener("DOMContentLoaded", async () => {
    const auth = storageGet?.() || {};
    const token = auth.token || auth.accessToken || null;

    let isAdmin = false;

    function csvEscape(value) {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function downloadCurrentEodResultsAsCsv() {
    const resultsBody = document.getElementById("eodResultsBody");
    if (!resultsBody) {
        alert("No results table found.");
        return;
    }

    const summaryRows = Array.from(resultsBody.querySelectorAll("tr.eod-row"));

    if (!summaryRows.length) {
        alert("There are no rendered End Of Day results to export.");
        return;
    }

    const cleanMoney = (value) =>
        String(value ?? "").replace(/£/g, "").replace(/,/g, "").trim();

    const parseTotals = (totalsText) => {
        const parts = String(totalsText || "").split("/");
        return {
            safe: cleanMoney(parts[0] || ""),
            float: cleanMoney(parts[1] || "")
        };
    };

    const getSectionTable = (detailContainer, headingText) => {
        if (!detailContainer) return null;

        const headings = Array.from(detailContainer.querySelectorAll("h4"));
        const heading = headings.find(
            h => h.textContent.trim().toLowerCase() === headingText.toLowerCase()
        );

        if (!heading) return null;

        let el = heading.nextElementSibling;
        while (el) {
            if (el.tagName === "TABLE") return el;
            if (el.tagName === "H4") break;
            el = el.nextElementSibling;
        }

        return null;
    };

    const headers = [
        "Row Type",
        "Date",
        "Store",
        "Submitted By",
        "Total Safe",
        "Total Float",
        "Document",
        "Customer",
        "Payment Method",
        "Deposit Amount",
        "Adjustment Type",
        "Adjustment Location",
        "Adjustment Reason",
        "Adjustment Amount"
    ];

    const lines = [headers.map(csvEscape).join(",")];

    summaryRows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 4) return;

        const date = cells[0].textContent.trim();
        const store = cells[1].textContent.trim();
        const submittedBy = cells[2].textContent.trim();
        const totals = parseTotals(cells[3].textContent.trim());

        // 1) Summary row
        lines.push([
            "SUMMARY",
            date,
            store,
            submittedBy,
            totals.safe,
            totals.float,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            ""
        ].map(csvEscape).join(","));

        const detailRow = row.nextElementSibling;
        const detailContainer = detailRow?.querySelector(".eod-details");
        if (!detailContainer) return;

        // 2) Deposit rows
        const depositsTable = getSectionTable(detailContainer, "Deposits");
        if (depositsTable) {
            const depositRows = Array.from(depositsTable.querySelectorAll("tbody tr"));

            depositRows.forEach((depRow) => {
                const depCells = depRow.querySelectorAll("td");
                if (depCells.length < 4) return;

                const doc = depCells[0].textContent.trim();
                const customer = depCells[1].textContent.trim();
                const method = depCells[2].textContent.trim();
                const amount = cleanMoney(depCells[3].textContent.trim());

                lines.push([
                    "DEPOSIT",
                    date,
                    store,
                    submittedBy,
                    "",
                    "",
                    doc,
                    customer,
                    method,
                    amount,
                    "",
                    "",
                    "",
                    ""
                ].map(csvEscape).join(","));
            });
        }

        // 3) Adjustment rows
        const adjustmentsTable = getSectionTable(detailContainer, "Adjustments");
        if (adjustmentsTable) {
            const adjustmentRows = Array.from(adjustmentsTable.querySelectorAll("tbody tr"));

            adjustmentRows.forEach((adjRow) => {
                const adjCells = adjRow.querySelectorAll("td");
                if (adjCells.length < 4) return;

                // Skip "No adjustments" row
                if (adjCells.length === 1 || /no adjustments/i.test(adjCells[0].textContent.trim())) {
                    return;
                }

                const type = adjCells[0].textContent.trim();
                const location = adjCells[1].textContent.trim();
                const reason = adjCells[2].textContent.trim();
                const amount = cleanMoney(adjCells[3].textContent.trim());

                lines.push([
                    "ADJUSTMENT",
                    date,
                    store,
                    submittedBy,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    type,
                    location,
                    reason,
                    amount
                ].map(csvEscape).join(","));
            });
        }
    });

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");

    const a = document.createElement("a");
    a.href = url;
    a.download = `eod-submissions-${yyyy}-${mm}-${dd}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
}


document.getElementById("downloadCsvBtn")?.addEventListener("click", () => {
    downloadCurrentEodResultsAsCsv();
});
    /* ================================
       CURRENT USER / ROLE CHECK
    ================================= */
async function resolveIsAdmin() {
    const saved = storageGet?.() || {};
    const userRoles = [];

    if (Array.isArray(saved?.user?.roles)) {
        saved.user.roles.forEach(role => {
            if (typeof role === "string") {
                userRoles.push(role);
            } else if (role?.name) {
                userRoles.push(role.name);
            }
        });
    }

    if (typeof saved?.activeRole === "string") {
        userRoles.push(saved.activeRole);
    } else if (saved?.activeRole?.name) {
        userRoles.push(saved.activeRole.name);
    }

    if (typeof saved?.role === "string") {
        userRoles.push(saved.role);
    } else if (saved?.role?.name) {
        userRoles.push(saved.role.name);
    }

    const normalizedRoles = [...new Set(
        userRoles
            .map(r => String(r || "").trim().toLowerCase())
            .filter(Boolean)
    )];

    isAdmin = normalizedRoles.includes("admin");

    console.log("🔐 resolveIsAdmin()", {
        rawRoles: userRoles,
        normalizedRoles,
        isAdmin
    });
}

    await resolveIsAdmin();

    /* ================================
       PANEL 1 — Store Balances
    ================================= */
async function loadBalances() {
    const body = document.getElementById("cashflowOverviewBody");
    body.innerHTML = `<tr><td colspan="5">Loading...</td></tr>`;

    try {
        const res = await fetch("/api/meta/locations", {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const data = await res.json();
        const locations = data.locations || [];

        body.innerHTML = "";

        if (!locations.length) {
            body.innerHTML = `<tr><td colspan="5" class="empty-row">No locations found.</td></tr>`;
            return;
        }

        locations.forEach(loc => {
            const tr = document.createElement("tr");

            const floatVal = Number(loc.float_balance || 0).toFixed(2);
            const safeVal = Number(loc.safe_balance || 0).toFixed(2);

            tr.innerHTML = `
                <td>${loc.name}</td>
                <td>
                    ${
                        isAdmin
                            ? `<input
                                    type="number"
                                    step="0.01"
                                    class="balance-input float-balance-input"
                                    data-id="${loc.id}"
                                    value="${floatVal}"
                               />`
                            : `£${floatVal}`
                    }
                </td>
                <td>
                    ${
                        isAdmin
                            ? `<input
                                    type="number"
                                    step="0.01"
                                    class="balance-input safe-balance-input"
                                    data-id="${loc.id}"
                                    value="${safeVal}"
                               />`
                            : `£${safeVal}`
                    }
                </td>
                <td>
                    <button class="btn-small btn-empty-safe" data-id="${loc.id}">
                        Empty Safe
                    </button>
                </td>
                <td>
                    ${
                        isAdmin
                            ? `<button class="btn-small btn-save-balances" data-id="${loc.id}">
                                   Save
                               </button>`
                            : `<span class="muted-text">—</span>`
                    }
                </td>
            `;

            body.appendChild(tr);
        });
    } catch (err) {
        console.error("❌ Failed to load balances:", err);
        body.innerHTML = `<tr><td colspan="5" class="empty-row">Failed to load balances.</td></tr>`;
    }
}

    await loadBalances();

    document.addEventListener("click", async (e) => {
        /* --------------------------------
           SAFE EMPTIED
        -------------------------------- */
        if (e.target.classList.contains("btn-empty-safe")) {
            const id = e.target.dataset.id;

            if (!confirm("Confirm: Mark safe as emptied and reset to £0.00?")) {
                return;
            }

            e.target.disabled = true;
            e.target.textContent = "Processing…";

            try {
                const res = await fetch(`/api/meta/locations/${id}/safe-emptied`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                    }
                });

                const data = await res.json();

                if (!data.ok) {
                    throw new Error(data.error || "Failed to empty safe");
                }

                await loadBalances();
            } catch (err) {
                alert("Error: " + err.message);
                e.target.disabled = false;
                e.target.textContent = "Safe Emptied";
            }

            return;
        }

        /* --------------------------------
           ADMIN SAVE BALANCES
        -------------------------------- */
        if (e.target.classList.contains("btn-save-balances")) {
            if (!isAdmin) {
                alert("You do not have permission to update balances.");
                return;
            }

            const id = e.target.dataset.id;
            const row = e.target.closest("tr");
            if (!row) return;

            const floatInput = row.querySelector(".float-balance-input");
            const safeInput = row.querySelector(".safe-balance-input");

            const floatBalance = Number(floatInput?.value || 0);
            const safeBalance = Number(safeInput?.value || 0);

            if (Number.isNaN(floatBalance) || Number.isNaN(safeBalance)) {
                alert("Please enter valid numeric balances.");
                return;
            }

            if (floatBalance < 0 || safeBalance < 0) {
                alert("Balances cannot be negative.");
                return;
            }

            e.target.disabled = true;
            e.target.textContent = "Saving…";

            try {
                const res = await fetch(`/api/meta/locations/${id}/balances`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({
                        float_balance: floatBalance,
                        safe_balance: safeBalance
                    })
                });

                const data = await res.json();

                if (!data.ok) {
                    throw new Error(data.error || "Failed to update balances");
                }

                e.target.textContent = "Saved";
                setTimeout(() => {
                    loadBalances();
                }, 500);
            } catch (err) {
                console.error("❌ Failed to save balances:", err);
                alert("Error: " + err.message);
                e.target.disabled = false;
                e.target.textContent = "Save";
            }

            return;
        }
    });

    /* ================================
       PANEL 2 — Store Dropdown
    ================================= */
    const storeFilter = document.getElementById("filterStore");

    async function loadStoreDropdown() {
        const res = await fetch("/api/meta/locations", {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
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
            "/api/eod/submissions?" + new URLSearchParams({ storeId, from, to }),
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