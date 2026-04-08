/* ============================================================
   SHARED MODULE-SCOPE VARIABLES
   ============================================================ */
let token = null;
let user = null;
let userStoreName = "";

// Cashflow adjustments (used by cashflow + signoff)
let adjustments = [];
let adjustmentCounter = 1;

/* ============================================================
   STEP 1 — FOOTFALL POPUP / RESPONSIBILITY
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  /* -------------------------------------------------
     AUTH + TOKEN
  ------------------------------------------------- */
  const authRaw = storageGet?.();
  token = authRaw?.token || authRaw?.accessToken || null;

  const completeBtn = document.getElementById("completeFootfallBtn");

  function setLoading(btn, text) {
    if (!btn) return;
    btn.classList.add("eod-btn-loading");

    const txt = btn.querySelector(".btn-text");
    if (txt) txt.textContent = text;
    else btn.textContent = text;
  }

  function clearLoading(btn, text) {
    if (!btn) return;
    btn.classList.remove("eod-btn-loading");

    const txt = btn.querySelector(".btn-text");
    if (txt) txt.textContent = text;
    else btn.textContent = text;
  }

  function openPopup(event) {
    const btn = event.currentTarget;
    setLoading(btn, "Opening…");

    const w = window.open(
      "/eod/footfallPopup.html",
      "FootfallPopup",
      "width=750,height=650,scrollbars=yes,resizable=yes"
    );

    if (w) {
      w.focus();

      const timer = setInterval(() => {
        if (w.closed) {
          clearInterval(timer);

          if (btn.id === "completeFootfallBtn") {
            clearLoading(btn, "Complete Today’s Footfall");
          } else {
            clearLoading(btn, "Enter Footfall");
          }

          window.location.reload();
        }
      }, 500);
    } else {
      clearLoading(btn, "Complete Today’s Footfall");
    }
  }

  document.getElementById("openFootfallBtn")?.addEventListener("click", openPopup);
  completeBtn?.addEventListener("click", openPopup);

  /* -------------------------------------------------
     1️⃣ GET USER PROFILE
  ------------------------------------------------- */
  if (token) {
    try {
      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok && data.user) user = data.user;
    } catch (err) {
      console.warn("⚠️ Failed /api/me:", err);
    }
  }

  if (!user) user = authRaw?.user || {};

  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  console.log("👤 User:", fullName, user);

  /* -------------------------------------------------
     2️⃣ RESOLVE STORE NAME (string)
  ------------------------------------------------- */
  const userStoreRaw =
    user.primaryStore ||
    user.primarystore ||
    user.store ||
    user.storeName ||
    null;

  console.log("🏪 raw user store:", userStoreRaw);

  if (typeof userStoreRaw === "number") {
    try {
      const locRes = await fetch("/api/meta/locations", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const locData = await locRes.json();
      const locations = locData.locations || [];

      const match = locations.find((l) => Number(l.id) === Number(userStoreRaw));

      if (match) {
        userStoreName = match.name.includes(":")
          ? match.name.split(":")[1].trim()
          : match.name.trim();
      }
    } catch (err) {
      console.error("❌ Failed to fetch location names:", err);
    }
  } else if (typeof userStoreRaw === "string") {
    userStoreName = userStoreRaw.includes(":")
      ? userStoreRaw.split(":")[1].trim()
      : userStoreRaw.trim();
  }

  console.log("🏪 Final resolved userStoreName:", userStoreName);

  if (!userStoreName) {
    console.warn("⚠️ Could not resolve user’s store name.");
    return;
  }

  /* -------------------------------------------------
     3️⃣ LOAD FOOTFALL DATA
  ------------------------------------------------- */
  let footfall = [];
  try {
    const res = await fetch("/api/eod/footfall", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    footfall = data.results || [];
  } catch (err) {
    console.error("❌ Failed to load footfall:", err);
    return;
  }

  /* -------------------------------------------------
     4️⃣ FIND TODAY'S ROW FOR THIS STORE
  ------------------------------------------------- */
  const todayRow = footfall.find((r) => {
    const raw = (r["Store"] || "").replace(/\u00A0/g, " ");
    const clean = raw.includes(":") ? raw.split(":")[1].trim() : raw.trim();
    return clean.toLowerCase() === userStoreName.toLowerCase();
  });

  if (!todayRow) {
    console.warn("⚠️ No footfall row found for store", userStoreName);
    initDailyBalancing();
    return;
  }

  console.log("🟢 Today’s row:", todayRow);

  /* -------------------------------------------------
     5️⃣ RESPONSIBILITY CHECK
  ------------------------------------------------- */
  const responsibleFields = [
    "Team Leader",
    "Bed Specialist",
    "Bed Specialist 2",
  ];

  const isResponsible = responsibleFields.some((field) => {
    const val = todayRow[field];
    return val && val.trim().toLowerCase() === fullName.toLowerCase();
  });

  console.log("🔍 User responsible?", isResponsible);

  /* -------------------------------------------------
     6️⃣ UPDATE FOOTFALL BUTTON
  ------------------------------------------------- */
  if (isResponsible && completeBtn) {
    completeBtn.classList.add("eod-btn-complete");
    completeBtn.textContent = "✓ Completed Today’s Footfall";
  }

  initDailyBalancing();
});

/* ============================================================
   STEP 2 — DAILY BALANCING + CASHFLOW + SIGN-OFF + PRINT
   ============================================================ */

async function initDailyBalancing() {
  console.log(
    "🟦 Initialising Daily Balancing with store:",
    userStoreName,
    "token:",
    token
  );

  const storeSelect = document.getElementById("dailyBalanceStoreSelect");
  const tableBody = document.getElementById("dailyBalanceTableBody");
  const summaryPill = document.getElementById("dailyBalanceSummaryPill");
  const summaryText = document.getElementById("dailyBalanceSummaryText");

  // Sign-off elements
  const signoffUserSelect = document.getElementById("signoffUserSelect");
  const signoffConfirm = document.getElementById("signoffConfirm");
  const signoffSubmitBtn = document.getElementById("signoffSubmitBtn");
  const signoffStatus = document.getElementById("signoffStatus");

  // Print button
  const printBtn = document.getElementById("printEodBtn");

  // Cashflow
  const totalSafeEl = document.getElementById("totalSafe");
  const totalFloatEl = document.getElementById("totalFloat");
  const currentFloatBalanceEl = document.getElementById("currentFloatBalance");
  const cashBody = document.getElementById("cashflowTableBody");

  let allDeposits = [];
  let expandedMethod = null;
  let selectedLocationId = null;
  let locations = [];
  let currentEodRecordId = null;
  let isEodLocked = false;

  console.log("🖨 printBtn found:", !!printBtn);

  /* -------------------------------------------------
     HELPERS
  ------------------------------------------------- */
  function cleanStore(nsName) {
    if (!nsName) return "";
    const raw = String(nsName).replace(/\u00A0/g, " ");
    return raw.includes(":") ? raw.split(":")[1].trim() : raw.trim();
  }

  function formatMoney(val) {
    return `£${Number(val || 0).toFixed(2)}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function buildStoreMatchLocationId(storeName) {
    const matchLoc = locations.find(
      (l) =>
        cleanStore(l.name).toLowerCase() ===
        String(storeName || "").toLowerCase()
    );
    return matchLoc ? matchLoc.id : null;
  }

  function updateCurrentFloatBalance() {
    if (!currentFloatBalanceEl) return;

    if (!selectedLocationId || !Array.isArray(locations) || !locations.length) {
      currentFloatBalanceEl.textContent = "£0.00";
      return;
    }

    const loc = locations.find((l) => Number(l.id) === Number(selectedLocationId));

    const floatBal = Number(
      loc?.float_balance ??
      loc?.floatBalance ??
      loc?.float ??
      0
    ) || 0;

    currentFloatBalanceEl.textContent = `£${floatBal.toFixed(2)}`;
  }

  function refreshPrintButton() {
    const shouldEnable = !!isEodLocked && !!currentEodRecordId;
    if (!printBtn) return;

    printBtn.disabled = !shouldEnable;
    printBtn.classList.toggle("is-disabled", !shouldEnable);

    console.log("🖨 refreshPrintButton()", {
      isEodLocked,
      currentEodRecordId,
      shouldEnable,
    });
  }

  function setPrintEnabled(enabled) {
    if (!printBtn) return;
    printBtn.disabled = !enabled;
    printBtn.classList.toggle("is-disabled", !enabled);

    console.log("🖨 setPrintEnabled:", {
      enabled,
      disabled: printBtn.disabled,
    });
  }

function setEodReadOnly(locked) {
  isEodLocked = locked;

  document.getElementById("openFootfallBtn")?.toggleAttribute("disabled", locked);
  document.getElementById("completeFootfallBtn")?.toggleAttribute("disabled", locked);

  // ✅ Keep store selector available even when current store is locked
  if (storeSelect) {
    storeSelect.removeAttribute("disabled");
  }

  document.getElementById("openAdjustmentBtn")?.toggleAttribute("disabled", locked);

  document.querySelectorAll(".safe-input, .float-input").forEach((el) => {
    el.toggleAttribute("disabled", locked);
  });

  signoffUserSelect?.toggleAttribute("disabled", locked);
  signoffConfirm?.toggleAttribute("disabled", locked);

  if (signoffSubmitBtn) {
    if (locked) {
      signoffSubmitBtn.disabled = true;
    } else {
      updateSubmitState();
    }
  }

  document.body.classList.toggle("eod-readonly", locked);

  refreshPrintButton();
}

  async function checkTodayLock(storeId) {
    if (!storeId) return { ok: true, exists: false };

    const res = await fetch(`/api/eod/check-today?storeId=${storeId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    return res.json();
  }

  function applyLockState(data) {
    const lockBox = document.getElementById("eodLockedMessage");
    const lockTitle = document.getElementById("eodLockedTitle");

    console.log("🔒 applyLockState incoming:", data);

    if (data?.ok && data.exists) {
      currentEodRecordId = data.recordId || null;

      if (lockBox && lockTitle) {
        lockTitle.textContent = `${data.storeName} end of day balances have already been completed`;
        lockBox.classList.remove("hidden");
      }

      setEodReadOnly(true);
      refreshPrintButton();
      return true;
    }

    currentEodRecordId = null;

    if (lockBox) lockBox.classList.add("hidden");

    setEodReadOnly(false);
    refreshPrintButton();
    return false;
  }

  async function printEodReport() {
    try {
      console.log("🖨 printEodReport() called", {
        currentEodRecordId,
        selectedLocationId,
        storeValue: storeSelect?.value,
        userStoreName,
      });

      const selectedStore = storeSelect?.value || userStoreName || "";
      const locationId =
        selectedLocationId || buildStoreMatchLocationId(selectedStore);

      if (!selectedStore || !locationId) {
        alert("Please select a valid store first.");
        return;
      }

      let recordId = currentEodRecordId;

      if (!recordId) {
        const checkData = await checkTodayLock(locationId);

        if (!checkData.ok) {
          throw new Error(checkData.error || "Failed to check today's EOD record");
        }

        if (!checkData.exists || !checkData.recordId) {
          alert("No End Of Day record found for today for this store.");
          return;
        }

        recordId = checkData.recordId;
        currentEodRecordId = recordId;
      }

      const reportRes = await fetch(`/api/eod/report/${recordId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const reportData = await reportRes.json();

      console.log("🖨 report fetch status:", reportRes.status);
      console.log("🖨 report response:", reportData);

      if (!reportRes.ok || !reportData.ok || !reportData.report) {
        throw new Error(reportData.error || "Failed to load EOD report");
      }

      const report = reportData.report;

      console.log("🖨 opening print window");

      const printWindow = window.open(
        "",
        "_blank",
        "width=1000,height=900,scrollbars=yes,resizable=yes"
      );

      if (!printWindow) {
        alert("Please allow popups for this site.");
        return;
      }

      const depositRows = Array.isArray(report.deposits)
        ? report.deposits
            .map(
              (d) => `
                <tr>
                  <td>${escapeHtml(d.doc || "")}</td>
                  <td>${escapeHtml(d.customerName || "")}</td>
                  <td>${escapeHtml(d.paymentMethod || "")}</td>
                  <td style="text-align:right;">${formatMoney(d.amount)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4" class="muted">No deposit data</td></tr>`;

      const cashflowRows = Array.isArray(report.cashflow)
        ? report.cashflow
            .map(
              (r) => `
                <tr>
                  <td>${escapeHtml(r.doc || "")}</td>
                  <td style="text-align:right;">${formatMoney(r.safe)}</td>
                  <td style="text-align:right;">${formatMoney(r.float)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="3" class="muted">No cashflow data</td></tr>`;

      const adjustmentRows =
        Array.isArray(report.adjustments) && report.adjustments.length
          ? report.adjustments
              .map(
                (a) => `
                <tr>
                  <td>${escapeHtml(a.reason || `Adjustment #${a.id || ""}`)}</td>
                  <td>${escapeHtml(a.location || "")}</td>
                  <td style="text-align:right;">${formatMoney(a.safe)}</td>
                  <td style="text-align:right;">${formatMoney(a.float)}</td>
                  <td style="text-align:right;">${formatMoney(a.amount)}</td>
                </tr>
              `
              )
              .join("")
          : `<tr><td colspan="5" class="muted">No adjustments</td></tr>`;

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>EOD Report - ${escapeHtml(report.store || "")}</title>
          <style>
            body {
              font-family: "Segoe UI", Arial, sans-serif;
              color: #222;
              margin: 0;
              padding: 24px;
              background: #fff;
            }
            .header {
              border-bottom: 2px solid #0081ab;
              padding-bottom: 14px;
              margin-bottom: 24px;
            }
            h1 {
              margin: 0 0 10px;
              font-size: 28px;
              color: #0081ab;
            }
            h2 {
              margin: 28px 0 10px;
              font-size: 18px;
              color: #222;
            }
            .meta {
              display: grid;
              grid-template-columns: repeat(2, minmax(240px, 1fr));
              gap: 8px 24px;
              font-size: 14px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 8px;
              font-size: 14px;
            }
            th, td {
              border: 1px solid #d8d8d8;
              padding: 8px 10px;
              vertical-align: top;
            }
            th {
              background: #0081ab;
              color: #fff;
              text-align: left;
            }
            .totals {
              width: 360px;
              margin-top: 24px;
            }
            .totals td:first-child {
              font-weight: 600;
            }
            .totals td:last-child {
              text-align: right;
            }
            .muted {
              color: #666;
            }
            .footer-note {
              margin-top: 28px;
              font-size: 12px;
              color: #666;
            }
            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>End Of Day Report</h1>
            <div class="meta">
              <div><strong>Store:</strong> ${escapeHtml(report.store || "")}</div>
              <div><strong>Date:</strong> ${escapeHtml(report.date || "")}</div>
              <div><strong>Signed Off By:</strong> ${escapeHtml(report.signoffName || "")}</div>
              <div><strong>Confirmation:</strong> ${report.confirmation ? "Yes" : "No"}</div>
              <div><strong>Location ID:</strong> ${escapeHtml(report.locationId || "")}</div>
              <div><strong>EOD ID:</strong> ${escapeHtml(report.id || "")}</div>
            </div>
          </div>

          <h2>Deposits</h2>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Customer</th>
                <th>Payment Method</th>
                <th style="text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${depositRows}
            </tbody>
          </table>

          <h2>Cashflow</h2>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th style="text-align:right;">Safe</th>
                <th style="text-align:right;">Float</th>
              </tr>
            </thead>
            <tbody>
              ${cashflowRows}
            </tbody>
          </table>

          <h2>Adjustments</h2>
          <table>
            <thead>
              <tr>
                <th>Reason</th>
                <th>Location</th>
                <th style="text-align:right;">Safe</th>
                <th style="text-align:right;">Float</th>
                <th style="text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${adjustmentRows}
            </tbody>
          </table>

          <table class="totals">
            <tbody>
              <tr>
                <td>Total Safe</td>
                <td>${formatMoney(report.totals?.safe)}</td>
              </tr>
              <tr>
                <td>Total Float</td>
                <td>${formatMoney(report.totals?.float)}</td>
              </tr>
            </tbody>
          </table>

          <div class="footer-note">
            Generated from EPOS End Of Day
          </div>

          <script>
            window.onload = function () {
              window.print();
            };
          </script>
        </body>
        </html>
      `;

      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    } catch (err) {
      console.error("❌ Failed to print EOD report:", err);
      alert(err.message || "Failed to generate EOD report");
    }
  }

  /* -------------------------------------------------
     LOAD LOCATIONS
  ------------------------------------------------- */
  try {
    const res = await fetch("/api/meta/locations", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    locations = data.locations || [];

    if (storeSelect) {
      storeSelect.innerHTML = `<option value="">Select Store...</option>`;

      locations.forEach((loc) => {
        const clean = cleanStore(loc.name);
        const opt = document.createElement("option");
        opt.value = clean;
        opt.textContent = clean;
        storeSelect.appendChild(opt);
      });

      if (userStoreName) {
        storeSelect.value = userStoreName;

        const matchLoc = locations.find(
          (l) =>
            cleanStore(l.name).toLowerCase() === userStoreName.toLowerCase()
        );

        if (matchLoc) {
          selectedLocationId = matchLoc.id;
        }

        updateCurrentFloatBalance();
      }
    }
  } catch (e) {
    console.error("❌ Failed to load locations", e);
  }

  /* -------------------------------------------------
     LOAD DEPOSIT DATA
  ------------------------------------------------- */
  try {
    const res = await fetch("/api/eod/daily-balance", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    allDeposits = data.results || [];
    console.log("💰 Loaded deposits:", allDeposits.length);
  } catch (err) {
    console.error("❌ Failed to load daily balance", err);
  }

  /* -------------------------------------------------
     RENDER STORE ➝ GROUPED PAYMENT METHODS
  ------------------------------------------------- */
  function renderStore(storeName) {
    if (!tableBody) return;

    tableBody.innerHTML = "";
    expandedMethod = null;

    if (!storeName) {
      summaryPill?.classList.add("hidden");
      tableBody.innerHTML = `
        <tr><td colspan="3" class="daily-balance-empty">
          Select a store to view customer deposits.
        </td></tr>`;
      return;
    }

    const matching = allDeposits.filter(
      (r) => cleanStore(r["Store"]).toLowerCase() === storeName.toLowerCase()
    );

    if (matching.length === 0) {
      summaryPill?.classList.add("hidden");
      tableBody.innerHTML = `
        <tr><td colspan="3" class="daily-balance-empty">
          No deposits found for this store.
        </td></tr>`;
      return;
    }

    const grouped = {};
    matching.forEach((row) => {
      const method = row["Payment Method"] || "Unknown";
      const amt = parseFloat(row["Amount"] || 0);

      if (!grouped[method]) {
        grouped[method] = {
          method,
          count: 0,
          total: 0,
          rows: [],
        };
      }

      grouped[method].count++;
      grouped[method].total += amt;
      grouped[method].rows.push({
        doc: row["Document Number"],
        name: row["Customer Name"],
        amount: amt,
      });
    });

    const methods = Object.values(grouped);
    const totalAmt = methods.reduce((sum, m) => sum + m.total, 0);
    const totalCount = methods.reduce((sum, m) => sum + m.count, 0);

    summaryPill?.classList.remove("hidden");
    if (summaryText) {
      summaryText.textContent = `${storeName} — ${totalCount} deposits | £${totalAmt.toFixed(
        2
      )}`;
    }

    methods.forEach((m) => {
      const tr = document.createElement("tr");
      tr.classList.add("method-row");
      tr.dataset.method = m.method;

      tr.innerHTML = `
        <td>${escapeHtml(m.method)}</td>
        <td>${m.count}</td>
        <td style="text-align:right;">£${m.total.toFixed(2)}</td>
      `;

      const detail = document.createElement("tr");
      detail.classList.add("details-row", "hidden");
      detail.dataset.method = m.method;

      detail.innerHTML = `
        <td colspan="3">
          <div class="details-inner">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Customer</th>
                  <th style="text-align:right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${m.rows
                  .map(
                    (r) => `
                  <tr>
                    <td>${escapeHtml(r.doc)}</td>
                    <td>${escapeHtml(r.name)}</td>
                    <td style="text-align:right;">£${r.amount.toFixed(2)}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </td>
      `;

      tableBody.appendChild(tr);
      tableBody.appendChild(detail);
    });
  }

  /* -------------------------------------------------
     EXPAND/COLLAPSE
  ------------------------------------------------- */
  tableBody?.addEventListener("click", (e) => {
    if (isEodLocked) return;

    const row = e.target.closest(".method-row");
    if (!row) return;

    const method = row.dataset.method;

    tableBody
      .querySelectorAll(".method-row")
      .forEach((r) => r.classList.remove("method-row--expanded"));

    tableBody
      .querySelectorAll(".details-row")
      .forEach((r) => r.classList.add("hidden"));

    if (expandedMethod === method) {
      expandedMethod = null;
      return;
    }

    expandedMethod = method;
    row.classList.add("method-row--expanded");

    const detail = tableBody.querySelector(
      `.details-row[data-method="${method}"]`
    );
    if (detail) detail.classList.remove("hidden");
  });

  /* -------------------------------------------------
     STEP 3 — CASHFLOW (CASH ONLY)
  ------------------------------------------------- */
  function recalcTotals() {
    let totalSafe = 0;
    let totalFloat = 0;

    document.querySelectorAll(".safe-input").forEach((i) => {
      totalSafe += parseFloat(i.value || 0);
    });

    document.querySelectorAll(".float-input").forEach((i) => {
      totalFloat += parseFloat(i.value || 0);
    });

    adjustments.forEach((a) => {
      totalSafe += Number(a.safe || 0);
      totalFloat += Number(a.float || 0);
    });

    if (totalSafeEl) totalSafeEl.textContent = `£${totalSafe.toFixed(2)}`;
    if (totalFloatEl) totalFloatEl.textContent = `£${totalFloat.toFixed(2)}`;
  }

  function renderAdjustmentRows() {
    const adjBody = document.getElementById("cashflowAdjustmentRows");
    if (!adjBody) {
      console.error("❌ cashflowAdjustmentRows tbody NOT FOUND");
      return;
    }

    adjBody.innerHTML = "";

    adjustments.forEach((adj) => {
      const row = document.createElement("tr");
      row.classList.add("cashflow-adjustment-row");

      row.innerHTML = `
        <td>${escapeHtml(adj.reason || `Adjustment #${adj.id}`)}</td>
        <td>£${Number(adj.safe || 0).toFixed(2)}</td>
        <td>£${Number(adj.float || 0).toFixed(2)}</td>
      `;

      adjBody.appendChild(row);
    });
  }

  function addAdjustmentRow(adj) {
    let safeVal = 0;
    let floatVal = 0;

    if (adj.location === "safe") safeVal = Number(adj.amount || 0);
    if (adj.location === "float") floatVal = Number(adj.amount || 0);

    adjustments.push({
      id: adjustmentCounter++,
      ...adj,
      safe: safeVal,
      float: floatVal,
    });

    renderAdjustmentRows();
    recalcTotals();
  }

  function renderCashflow(storeName) {
    if (!cashBody) return;

    cashBody.innerHTML = "";
    if (totalSafeEl) totalSafeEl.textContent = "£0.00";
    if (totalFloatEl) totalFloatEl.textContent = "£0.00";

    if (!storeName) {
      cashBody.innerHTML = `
        <tr><td colspan="3" class="cashflow-empty">Select a store.</td></tr>
      `;
      return;
    }

    const cashDeposits = allDeposits.filter(
      (d) =>
        cleanStore(d["Store"]).toLowerCase() === storeName.toLowerCase() &&
        (d["Payment Method"] || "").toLowerCase().includes("cash")
    );

    if (cashDeposits.length === 0) {
      cashBody.innerHTML = `
        <tr><td colspan="3" class="cashflow-empty">No cash deposits today.</td></tr>
      `;
      renderAdjustmentRows();
      recalcTotals();
      return;
    }

    cashDeposits.forEach((dep) => {
      const fullAmt = parseFloat(dep["Amount"] || 0);
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHtml(dep["Document Number"] || "")}</td>
        <td>
          <input
            type="number"
            step="0.01"
            class="safe-input"
            data-full="${fullAmt}"
            value="${fullAmt.toFixed(2)}"
            data-doc="${escapeHtml(dep["Document Number"] || "")}"
          />
        </td>
        <td>
          <input
            type="number"
            step="0.01"
            class="float-input"
            value="0.00"
            min="0"
            data-doc="${escapeHtml(dep["Document Number"] || "")}"
          />
        </td>
      `;

      cashBody.appendChild(tr);
    });

    renderAdjustmentRows();
    recalcTotals();

    if (isEodLocked) {
      setEodReadOnly(true);
    }
  }

  cashBody?.addEventListener("input", (e) => {
    if (isEodLocked) return;

    const floatInput = e.target.closest(".float-input");
    if (floatInput) {
      const tr = floatInput.closest("tr");
      const safeInput = tr?.querySelector(".safe-input");
      const fullAmt = parseFloat(safeInput?.dataset.full || 0);

      let floatVal = parseFloat(floatInput.value || 0);
      if (Number.isNaN(floatVal) || floatVal < 0) floatVal = 0;
      if (floatVal > fullAmt) floatVal = fullAmt;

      floatInput.value = floatVal.toFixed(2);

      const safeVal = Math.max(fullAmt - floatVal, 0);
      if (safeInput) safeInput.value = safeVal.toFixed(2);
    }

    recalcTotals();
  });

  /* -------------------------------------------------
     ADJUSTMENT BUTTON POPUP
  ------------------------------------------------- */
  const adjustmentBtn = document.getElementById("openAdjustmentBtn");

  if (adjustmentBtn) {
    adjustmentBtn.addEventListener("click", () => {
      if (isEodLocked) return;

      window.open(
        "/eod/cashflowAdjustment.html",
        "CashflowAdjustment",
        "width=500,height=580,resizable=yes,scrollbars=yes"
      );
    });
  }

  window.addEventListener("message", (event) => {
    if (isEodLocked) return;

    if (event.data?.action === "cashflowAdjustment") {
      addAdjustmentRow(event.data.data);
    }
  });

  /* -------------------------------------------------
     PRINT BUTTON
  ------------------------------------------------- */
  setPrintEnabled(false);

  printBtn?.addEventListener("click", async () => {
    console.log("🖨 Print button clicked", {
      disabled: printBtn.disabled,
      isEodLocked,
      currentEodRecordId,
      selectedLocationId,
      storeValue: storeSelect?.value,
      userStoreName,
    });

    if (printBtn.disabled) return;
    await printEodReport();
  });

  /* -------------------------------------------------
     STORE CHANGE HANDLER
  ------------------------------------------------- */
  storeSelect?.addEventListener("change", async () => {
    const selected = storeSelect.value;
    selectedLocationId = buildStoreMatchLocationId(selected);
    updateCurrentFloatBalance();

    renderStore(selected);
    renderCashflow(selected);

    try {
      const data = await checkTodayLock(selectedLocationId);
      applyLockState(data);
    } catch (err) {
      console.error("🔴 Failed to check EOD lock:", err);
      applyLockState({ ok: true, exists: false });
    }
  });

  /* -------------------------------------------------
     INITIAL RENDER
  ------------------------------------------------- */
  if (userStoreName) {
    selectedLocationId = buildStoreMatchLocationId(userStoreName);
    updateCurrentFloatBalance();

    renderStore(userStoreName);
    renderCashflow(userStoreName);

    try {
      const data = await checkTodayLock(selectedLocationId);
      applyLockState(data);
    } catch (err) {
      console.error("🔴 Initial EOD lock check failed:", err);
      applyLockState({ ok: true, exists: false });
    }
  }

  /* -------------------------------------------------
     SIGN-OFF INITIALISATION
  ------------------------------------------------- */
  async function initSignoff() {
    if (!signoffUserSelect || !signoffSubmitBtn || !signoffConfirm) return;

    try {
      const res = await fetch("/api/users", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      const users = data.users || data || [];

      users.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent =
          `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email;
        signoffUserSelect.appendChild(opt);
      });
    } catch (err) {
      console.error("❌ Failed to load users for signoff", err);
    }

    updateSubmitState();

    signoffUserSelect.addEventListener("change", updateSubmitState);
    signoffConfirm.addEventListener("change", updateSubmitState);

    signoffSubmitBtn.addEventListener("click", async () => {
      if (isEodLocked) return;

      signoffStatus.textContent = "";
      signoffStatus.className = "signoff-status";

      const storeName = storeSelect?.value;
      if (!storeName) {
        signoffStatus.textContent = "Please select a store in Step 2.";
        signoffStatus.classList.add("signoff-status--error");
        return;
      }

      const depositsForStore = allDeposits.filter(
        (d) => cleanStore(d["Store"]).toLowerCase() === storeName.toLowerCase()
      );

      const depositsPayload = depositsForStore.map((d) => ({
        doc: d["Document Number"],
        amount: parseFloat(d["Amount"] || 0),
        paymentMethod: d["Payment Method"] || "",
        customerName: d["Customer Name"] || "",
      }));

      const cashflowRows = [];
      document.querySelectorAll("#cashflowTableBody tr").forEach((tr) => {
        const firstTd = tr.querySelector("td");
        if (!firstTd) return;

        const doc = firstTd.textContent.trim();
        const safeInput = tr.querySelector(".safe-input");
        const floatInput = tr.querySelector(".float-input");

        if (!safeInput && !floatInput) return;

        const safe = parseFloat(safeInput?.value || 0);
        const float = parseFloat(floatInput?.value || 0);

        cashflowRows.push({ doc, safe, float });
      });

      const totalSafe =
        cashflowRows.reduce((sum, r) => sum + r.safe, 0) +
        adjustments.reduce((sum, a) => sum + Number(a.safe || 0), 0);

      const totalFloat =
        cashflowRows.reduce((sum, r) => sum + r.float, 0) +
        adjustments.reduce((sum, a) => sum + Number(a.float || 0), 0);

      const payload = {
        store: storeName,
        locationId: selectedLocationId,
        date: new Date().toISOString().slice(0, 10),
        signoffUserId: Number(signoffUserSelect.value),
        confirmation: signoffConfirm.checked,
        deposits: depositsPayload,
        cashflow: cashflowRows,
        adjustments,
        totals: {
          safe: totalSafe,
          float: totalFloat,
        },
      };

      console.log("📦 EOD submit payload:", payload);

      try {
        const res = await fetch("/api/eod/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Unknown EOD submit error");
        }

        currentEodRecordId = data.eodId || null;

        signoffStatus.textContent = "End Of Day submitted successfully.";
        signoffStatus.classList.add("signoff-status--ok");

        applyLockState({
          ok: true,
          exists: true,
          recordId: currentEodRecordId,
          storeName: storeName,
        });
      } catch (err) {
        console.error("❌ EOD submit failed:", err);
        signoffStatus.textContent =
          err.message || "Failed to submit End Of Day.";
        signoffStatus.classList.add("signoff-status--error");
      }
    });
  }

  function updateSubmitState() {
    if (!signoffSubmitBtn || !signoffUserSelect || !signoffConfirm) return;

    if (isEodLocked) {
      signoffSubmitBtn.disabled = true;
      return;
    }

    const hasUser = !!signoffUserSelect.value;
    const isConfirmed = signoffConfirm.checked;
    signoffSubmitBtn.disabled = !(hasUser && isConfirmed);
  }

  await initSignoff();
}