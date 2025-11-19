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
    btn.classList.add("eod-btn-loading");
    btn.querySelector(".btn-text").textContent = text;
  }

  function clearLoading(btn, text) {
    btn.classList.remove("eod-btn-loading");
    btn.querySelector(".btn-text").textContent = text;
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

  document
    .getElementById("openFootfallBtn")
    .addEventListener("click", openPopup);
  completeBtn.addEventListener("click", openPopup);

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

      const match = locations.find(
        (l) => Number(l.id) === Number(userStoreRaw)
      );
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
  if (isResponsible) {
    completeBtn.classList.add("eod-btn-complete");
    completeBtn.textContent = "✓ Completed Today’s Footfall";
  }

  // When STEP 1 is fully loaded → we now allow STEP 2 to render
  initDailyBalancing();
}); // END DOMContentLoaded

/* ============================================================
   STEP 2 — DAILY BALANCING + CASHFLOW + SIGN-OFF
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

  // Cashflow table elements referenced in recalcTotals
  const totalSafeEl = document.getElementById("totalSafe");
  const totalFloatEl = document.getElementById("totalFloat");

  let allDeposits = [];
  let expandedMethod = null;
  let selectedLocationId = null;
  let locations = [];

  /* -------------------------------------------------
     HELPERS
  ------------------------------------------------- */
  function cleanStore(nsName) {
    if (!nsName) return "";
    const raw = nsName.replace(/\u00A0/g, " ");
    return raw.includes(":") ? raw.split(":")[1].trim() : raw.trim();
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
        (l) => cleanStore(l.name).toLowerCase() === userStoreName.toLowerCase()
      );
      if (matchLoc) {
        selectedLocationId = matchLoc.id;
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
    tableBody.innerHTML = "";
    expandedMethod = null;

    if (!storeName) {
      summaryPill.classList.add("hidden");
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
      summaryPill.classList.add("hidden");
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

    summaryPill.classList.remove("hidden");
    summaryText.textContent = `${storeName} — ${totalCount} deposits | £${totalAmt.toFixed(
      2
    )}`;

    methods.forEach((m) => {
      const tr = document.createElement("tr");
      tr.classList.add("method-row");
      tr.dataset.method = m.method;

      tr.innerHTML = `
        <td>${m.method}</td>
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
                    <td>${r.doc}</td>
                    <td>${r.name}</td>
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
  tableBody.addEventListener("click", (e) => {
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
      `.details-row[data-method='${method}']`
    );
    if (detail) detail.classList.remove("hidden");
  });

  /* -------------------------------------------------
     STEP 3 — CASHFLOW (CASH ONLY)
  ------------------------------------------------- */

  function recalcTotals() {
    let totalSafe = 0;
    let totalFloat = 0;

    // Deposit splits
    document.querySelectorAll(".safe-input").forEach((i) => {
      totalSafe += parseFloat(i.value || 0);
    });
    document.querySelectorAll(".float-input").forEach((i) => {
      totalFloat += parseFloat(i.value || 0);
    });

    // Adjustment rows
    adjustments.forEach((a) => {
      totalSafe += a.safe;
      totalFloat += a.float;
    });

    totalSafeEl.textContent = `£${totalSafe.toFixed(2)}`;
    totalFloatEl.textContent = `£${totalFloat.toFixed(2)}`;
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
        <td>Adjustment #${adj.id}</td>
        <td>£${adj.safe.toFixed(2)}</td>
        <td>£${adj.float.toFixed(2)}</td>
      `;

      adjBody.appendChild(row);
    });
  }

  function addAdjustmentRow(adj) {
    let safeVal = 0;
    let floatVal = 0;

    if (adj.location === "safe") safeVal = adj.amount;
    if (adj.location === "float") floatVal = adj.amount;

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
    console.log("renderCashflow CALLED with:", storeName);

    const cashBody = document.getElementById("cashflowTableBody");
    cashBody.innerHTML = "";
    totalSafeEl.textContent = "£0.00";
    totalFloatEl.textContent = "£0.00";

    if (!storeName) {
        cashBody.innerHTML = `<tr><td colspan="3" class="cashflow-empty">Select a store.</td></tr>`;
        return;
    }

    const cashDeposits = allDeposits.filter(
        d =>
            cleanStore(d["Store"]).toLowerCase() === storeName.toLowerCase() &&
            (d["Payment Method"] || "").toLowerCase().includes("cash")
    );

    if (cashDeposits.length === 0) {
        cashBody.innerHTML = `<tr><td colspan="3" class="cashflow-empty">No cash deposits today.</td></tr>`;
        return;
    }

    cashDeposits.forEach(dep => {
        const fullAmt = parseFloat(dep["Amount"] || 0);
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${dep["Document Number"]}</td>

            <!-- SAFE defaults to full amount -->
            <td>
                <input 
                    type="number" 
                    step="0.01" 
                    class="safe-input" 
                    data-full="${fullAmt}" 
                    value="${fullAmt.toFixed(2)}" 
                    data-doc="${dep["Document Number"]}"
                />
            </td>

            <!-- FLOAT defaults to zero -->
            <td>
                <input 
                    type="number" 
                    step="0.01" 
                    class="float-input" 
                    value="0.00"
                    min="0"
                    data-doc="${dep["Document Number"]}"
                />
            </td>
        `;

        cashBody.appendChild(tr);
    });

    /* ---- AUTO SYNC SAFE / FLOAT ---- */
    cashBody.addEventListener("input", (e) => {
        const floatInput = e.target.closest(".float-input");

        if (floatInput) {
            const tr = floatInput.closest("tr");
            const safeInput = tr.querySelector(".safe-input");
            const fullAmt = parseFloat(safeInput.dataset.full || 0);

            let floatVal = parseFloat(floatInput.value || 0);
            if (floatVal < 0) floatVal = 0;

            // safe = full - float
            const safeVal = Math.max(fullAmt - floatVal, 0);

            safeInput.value = safeVal.toFixed(2);
        }

        // update totals
        recalcTotals();
    });

    /* ---- Re-render adjustments & totals ---- */
    renderAdjustmentRows();
    recalcTotals();
}


  /* -------------------------------------------------
     ADJUSTMENT BUTTON POPUP
  ------------------------------------------------- */
  const adjustmentBtn = document.getElementById("openAdjustmentBtn");

  if (adjustmentBtn) {
    adjustmentBtn.addEventListener("click", () => {
      window.open(
        "/eod/cashflowAdjustment.html",
        "CashflowAdjustment",
        "width=500,height=580,resizable=yes,scrollbars=yes"
      );
    });
  } else {
    console.warn("❌ openAdjustmentBtn not found in DOM");
  }

  // Listen for popup adjustment data
  window.addEventListener("message", (event) => {
    if (event.data?.action === "cashflowAdjustment") {
      addAdjustmentRow(event.data.data);
    }
  });

  /* -------------------------------------------------
     STORE CHANGE HANDLER
  ------------------------------------------------- */
storeSelect.addEventListener("change", async () => {
    const selected = storeSelect.value;

    const matchLoc = locations.find(
        (l) => cleanStore(l.name).toLowerCase() === selected.toLowerCase()
    );
    selectedLocationId = matchLoc ? matchLoc.id : null;

    // ---- LOCK CHECK -----------------------------------------------------
    try {
        const res = await fetch(`/api/eod/check-today?storeId=${selectedLocationId}`);
        const data = await res.json();

        const lockBox = document.getElementById("eodLockedMessage");
        const lockTitle = document.getElementById("eodLockedTitle");
        const leftCol = document.querySelector(".eod-left");
        const rightCol = document.querySelector(".eod-right");

        // SAFETY: Ensure elements exist before applying hide/show
        if (!lockBox || !lockTitle) {
            console.warn("⚠️ Lock UI elements missing in DOM");
            return;
        }

        if (data.ok && data.exists) {
            // Show lock message
            lockTitle.textContent = `${data.storeName} end of day balances have already been completed`;
            lockBox.classList.remove("hidden");

            // SAFELY HIDE COLUMNS
            if (leftCol) leftCol.classList.add("hidden");
            if (rightCol) rightCol.classList.add("hidden");

            return; // STOP — do NOT render daily balance or cashflow
        }

        // ---- NO LOCK - normal flow --------------------------------------
        lockBox.classList.add("hidden");
        if (leftCol) leftCol.classList.remove("hidden");
        if (rightCol) rightCol.classList.remove("hidden");

    } catch (err) {
        console.error("🔴 Failed to check EOD lock:", err);
    }

    // Continue with the normal behaviour
    renderStore(selected);
    renderCashflow(selected);
});


  /* -------------------------------------------------
     INITIAL RENDER (default user's store)
  ------------------------------------------------- */
  if (userStoreName) {
    renderStore(userStoreName);
    renderCashflow(userStoreName);
  }

  /* -------------------------------------------------
     SIGN-OFF INITIALISATION
  ------------------------------------------------- */
  async function initSignoff() {
    if (!signoffUserSelect || !signoffSubmitBtn || !signoffConfirm) return;

    // Load users for dropdown
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

    function updateSubmitState() {
      const hasUser = !!signoffUserSelect.value;
      const isConfirmed = signoffConfirm.checked;
      signoffSubmitBtn.disabled = !(hasUser && isConfirmed);
    }

    signoffUserSelect.addEventListener("change", updateSubmitState);
    signoffConfirm.addEventListener("change", updateSubmitState);

    signoffSubmitBtn.addEventListener("click", async () => {
      signoffStatus.textContent = "";
      signoffStatus.className = "signoff-status";

      const storeName = storeSelect.value;
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
      document
        .querySelectorAll("#cashflowTableBody tr")
        .forEach((tr) => {
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
        adjustments.reduce((sum, a) => sum + a.safe, 0);
      const totalFloat =
        cashflowRows.reduce((sum, r) => sum + r.float, 0) +
        adjustments.reduce((sum, a) => sum + a.float, 0);

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

        signoffStatus.textContent = "End Of Day submitted successfully.";
        signoffStatus.classList.add("signoff-status--ok");

        // Lock UI
        signoffSubmitBtn.disabled = true;
        signoffUserSelect.disabled = true;
        signoffConfirm.disabled = true;
      } catch (err) {
        console.error("❌ EOD submit failed:", err);
        signoffStatus.textContent =
          err.message || "Failed to submit End Of Day.";
        signoffStatus.classList.add("signoff-status--error");
      }
    });
  }

  // Initialise signoff after everything else is wired
  await initSignoff();
}
