// public/js/widgets/SalesForecast.js
console.log("📈 Sales Forecast Widget Loaded");

document.addEventListener("DOMContentLoaded", async () => {
  // NOTE: make sure your HTML uses id="salesForecastWidget"
  const widget = document.getElementById("salesForecastWidget");
  if (!widget) {
    console.warn("⚠️ #salesForecastWidget container not found");
    return;
  }

  widget.innerHTML = `<div class="loading">Loading sales forecast...</div>`;

  // ---------- helpers ----------
  const safeNum = (v) => {
    const n =
      typeof v === "number"
        ? v
        : parseFloat(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const parseGbDate = (ds) => {
    // "dd/mm/yyyy"
    const [dd, mm, yyyy] = String(ds || "").trim().split("/").map(Number);
    if (!dd || !mm || !yyyy) return null;
    return new Date(yyyy, mm - 1, dd);
  };

  const fmtGBP = (n) =>
    safeNum(n).toLocaleString("en-GB", { style: "currency", currency: "GBP" });

  const computeFromOrders = (rows) => {
    // Group line rows by Document Number -> totals per order
    const grouped = {};
    rows.forEach((row) => {
      const docNum = row["Document Number"];
      if (!docNum) return;
      if (!grouped[docNum]) grouped[docNum] = 0;
      grouped[docNum] += safeNum(row.Amount);
    });

    const orderTotals = Object.values(grouped);
    const count = orderTotals.length;
    const revenue = orderTotals.reduce((a, b) => a + b, 0);
    const aov = count ? revenue / count : 0;

    return { count, aov, revenue };
  };

  // Most common store in a set of rows (used to infer "primary store")
  const modeStore = (rows) => {
    const counts = {};
    rows.forEach((r) => {
      const s = String(r.Store || "").trim();
      if (!s) return;
      counts[s] = (counts[s] || 0) + 1;
    });

    let best = "";
    let bestCount = 0;
    for (const [store, c] of Object.entries(counts)) {
      if (c > bestCount) {
        best = store;
        bestCount = c;
      }
    }
    return best; // "" if none
  };

  const buildMetricRow = ({ label, inputId, value, step = "1", min = "0" }) => {
    return `
      <div class="sf-row">
        <div class="sf-label">${label}</div>
        <div class="sf-value">
          <input id="${inputId}" type="number" inputmode="decimal" min="${min}" step="${step}" value="${value}">
        </div>
      </div>
    `;
  };

  const buildDisplayRow = ({ label, valueId, valueText }) => {
    return `
      <div class="sf-row">
        <div class="sf-label">${label}</div>
        <div class="sf-value" id="${valueId}">${valueText}</div>
      </div>
    `;
  };

  const attachForecastLogic = ({
    scopeEl,
    actualCount,
    actualAov,
    showCommission,
  }) => {
    const countInput = scopeEl.querySelector("[data-role='count']");
    const aovInput = scopeEl.querySelector("[data-role='aov']");
    const revenueEl = scopeEl.querySelector("[data-role='revenue']");
    const commissionEl = scopeEl.querySelector("[data-role='commission']");
    const resetBtn = scopeEl.querySelector("[data-role='reset']");

    const recalc = () => {
      const count = safeNum(countInput.value);
      const aov = safeNum(aovInput.value);
      const revenue = count * aov;

      revenueEl.textContent = fmtGBP(revenue);

      if (showCommission && commissionEl) {
        const commission = (revenue / 100) * 2.1; // 2.1%
        commissionEl.textContent = fmtGBP(commission);
      }
    };

    // set defaults
    countInput.value = safeNum(actualCount);
    aovInput.value = safeNum(actualAov).toFixed(2);

    // events
    ["input", "change"].forEach((evt) => {
      countInput.addEventListener(evt, recalc);
      aovInput.addEventListener(evt, recalc);
    });

    resetBtn?.addEventListener("click", () => {
      countInput.value = safeNum(actualCount);
      aovInput.value = safeNum(actualAov).toFixed(2);
      recalc();
    });

    // initial calc
    recalc();
  };

  // Main tab switching: current/forecast
  const setActiveMain = (root, tabName) => {
    root.querySelectorAll(".sf-tab-main").forEach((b) => {
      b.classList.toggle("active", b.dataset.main === tabName);
    });
    root.querySelectorAll(".sf-main").forEach((p) => {
      p.classList.toggle("active", p.dataset.main === tabName);
    });
  };

  // Sub tab switching inside a main: rep/store
  const setActiveSub = (mainEl, subName) => {
    mainEl.querySelectorAll(".sf-tab-sub").forEach((b) => {
      b.classList.toggle("active", b.dataset.sub === subName);
    });
    mainEl.querySelectorAll(".sf-subpanel").forEach((p) => {
      p.classList.toggle("active", p.dataset.sub === subName);
    });
  };

  // ---------- load data ----------
  try {
    const saved = storageGet?.();
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
    const usernameEmail = String(saved?.username || "").trim().toLowerCase();

    const res = await fetch("/api/netsuite/widget-sales", { headers });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.results)) {
      throw new Error("Invalid or unexpected response format");
    }

    // Filter to current month (all data)
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();

    const monthRows = data.results.filter((r) => {
      const d = parseGbDate(r.Date);
      return d && d.getMonth() === m && d.getFullYear() === y;
    });

    const monthLabel = now.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    });

    // ✅ Sales Rep: only rows matching logged-in user's email
    const repRows = monthRows.filter((r) => {
      const rowEmail = String(r.Email || "").trim().toLowerCase();
      return rowEmail && usernameEmail && rowEmail === usernameEmail;
    });

    // Infer primary store from repRows (most common store for this user this month)
    const primaryStore = modeStore(repRows);

    // ✅ Store: all rows for inferred store (this month)
    const storeRows = primaryStore
      ? monthRows.filter((r) => String(r.Store || "").trim() === primaryStore)
      : [];

    // Compute actuals
    const repActual = computeFromOrders(repRows);
    const storeActual = computeFromOrders(storeRows);

    // ---------- Forecast defaults ----------
    const todayOfMonth = now.getDate(); // 1-31
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const project = (current) => {
      if (!todayOfMonth) return 0;
      return (safeNum(current) / todayOfMonth) * daysInMonth;
    };

    // Defaults: forecast count based on pace, aov stays same
    const repForecastDefaults = { count: project(repActual.count), aov: repActual.aov };
    const storeForecastDefaults = { count: project(storeActual.count), aov: storeActual.aov };

    // ---------- Render ----------
    widget.innerHTML = `
      <div class="sf-header">
        <div class="sf-title">📈 Sales Forecast — ${monthLabel}</div>
        <div class="sf-tabs main">
          <button class="sf-tab sf-tab-main active" data-main="current" type="button">Current</button>
          <button class="sf-tab sf-tab-main" data-main="forecast" type="button">Forecast</button>
        </div>
      </div>

      <div class="sf-mains">

        <!-- ================= CURRENT ================= -->
        <div class="sf-main active" data-main="current">

          <div class="sf-tabs sub">
            <button class="sf-tab sf-tab-sub active" data-sub="rep" type="button">Sales Rep</button>
            <button class="sf-tab sf-tab-sub" data-sub="store" type="button">Store</button>
          </div>

          <!-- Current / Sales Rep -->
          <div class="sf-subpanel active" data-sub="rep">
            <div class="sf-block">
              ${
                !usernameEmail
                  ? `<div class="no-data">No user email found in storage.</div>`
                  : !repRows.length
                  ? `<div class="no-data">No sales found this month for ${usernameEmail}.</div>`
                  : ``
              }

              ${buildMetricRow({
                label: "Total number of sales (editable)",
                inputId: "sfCurRepCount",
                value: repActual.count,
                step: "1",
                min: "0",
              }).replace('id="sfCurRepCount"', 'id="sfCurRepCount" data-role="count"')}

              ${buildMetricRow({
                label: "Average order value (editable)",
                inputId: "sfCurRepAov",
                value: repActual.aov.toFixed(2),
                step: "0.01",
                min: "0",
              }).replace('id="sfCurRepAov"', 'id="sfCurRepAov" data-role="aov"')}

              ${buildDisplayRow({
                label: "Total revenue (auto)",
                valueId: "sfCurRepRevenue",
                valueText: "£0.00",
              }).replace('id="sfCurRepRevenue"', 'id="sfCurRepRevenue" data-role="revenue"')}

              ${buildDisplayRow({
                label: "Commission estimate @ 2.1% (auto)",
                valueId: "sfCurRepCommission",
                valueText: "£0.00",
              }).replace('id="sfCurRepCommission"', 'id="sfCurRepCommission" data-role="commission"')}

              <div class="sf-actions">
                <button class="sf-reset" data-role="reset" type="button">Reset to actuals</button>
              </div>

              <div class="sf-footnote">
                Tip: adjust sales count/AOV to see the “what-if” impact for the month.
              </div>
            </div>
          </div>

          <!-- Current / Store -->
          <div class="sf-subpanel" data-sub="store">
            <div class="sf-block">
              ${
                !primaryStore
                  ? `<div class="no-data">Could not infer your primary store from your sales this month.</div>`
                  : `<div class="sf-store-label"><strong>Store:</strong> ${primaryStore}</div>`
              }

              ${buildMetricRow({
                label: "Total number of sales (editable)",
                inputId: "sfCurStoreCount",
                value: storeActual.count,
                step: "1",
                min: "0",
              }).replace('id="sfCurStoreCount"', 'id="sfCurStoreCount" data-role="count"')}

              ${buildMetricRow({
                label: "Average order value (editable)",
                inputId: "sfCurStoreAov",
                value: storeActual.aov.toFixed(2),
                step: "0.01",
                min: "0",
              }).replace('id="sfCurStoreAov"', 'id="sfCurStoreAov" data-role="aov"')}

              ${buildDisplayRow({
                label: "Total revenue (auto)",
                valueId: "sfCurStoreRevenue",
                valueText: "£0.00",
              }).replace('id="sfCurStoreRevenue"', 'id="sfCurStoreRevenue" data-role="revenue"')}

              <div class="sf-actions">
                <button class="sf-reset" data-role="reset" type="button">Reset to actuals</button>
              </div>

              <div class="sf-footnote">
                Tip: this is great for store-level targets and pacing.
              </div>
            </div>
          </div>
        </div>

        <!-- ================= FORECAST ================= -->
        <div class="sf-main" data-main="forecast">

          <div class="sf-tabs sub">
            <button class="sf-tab sf-tab-sub active" data-sub="rep" type="button">Sales Rep</button>
            <button class="sf-tab sf-tab-sub" data-sub="store" type="button">Store</button>
          </div>

          <div class="sf-forecast-note">
            Based on performance so far:
            <strong>${todayOfMonth}</strong> / <strong>${daysInMonth}</strong> days.
            <span style="white-space:nowrap;">(Defaults = current ÷ ${todayOfMonth} × ${daysInMonth})</span>
          </div>

          <!-- Forecast / Sales Rep -->
          <div class="sf-subpanel active" data-sub="rep">
            <div class="sf-block">
              ${buildMetricRow({
                label: "Forecast sales count (editable)",
                inputId: "sfFcRepCount",
                value: repForecastDefaults.count.toFixed(1),
                step: "0.1",
                min: "0",
              }).replace('id="sfFcRepCount"', 'id="sfFcRepCount" data-role="count"')}

              ${buildMetricRow({
                label: "Forecast average order value (editable)",
                inputId: "sfFcRepAov",
                value: repForecastDefaults.aov.toFixed(2),
                step: "0.01",
                min: "0",
              }).replace('id="sfFcRepAov"', 'id="sfFcRepAov" data-role="aov"')}

              ${buildDisplayRow({
                label: "Forecast revenue (auto)",
                valueId: "sfFcRepRevenue",
                valueText: "£0.00",
              }).replace('id="sfFcRepRevenue"', 'id="sfFcRepRevenue" data-role="revenue"')}

              ${buildDisplayRow({
                label: "Forecast commission @ 2.1% (auto)",
                valueId: "sfFcRepCommission",
                valueText: "£0.00",
              }).replace('id="sfFcRepCommission"', 'id="sfFcRepCommission" data-role="commission"')}

              <div class="sf-actions">
                <button class="sf-reset" data-role="reset" type="button">Reset to defaults</button>
              </div>

              <div class="sf-footnote">
                Adjust forecast count/AOV to see the end-of-month impact.
              </div>
            </div>
          </div>

          <!-- Forecast / Store -->
          <div class="sf-subpanel" data-sub="store">
            <div class="sf-block">
              ${
                !primaryStore
                  ? `<div class="no-data">Could not infer your primary store from your sales this month.</div>`
                  : `<div class="sf-store-label"><strong>Store:</strong> ${primaryStore}</div>`
              }

              ${buildMetricRow({
                label: "Forecast sales count (editable)",
                inputId: "sfFcStoreCount",
                value: storeForecastDefaults.count.toFixed(1),
                step: "0.1",
                min: "0",
              }).replace('id="sfFcStoreCount"', 'id="sfFcStoreCount" data-role="count"')}

              ${buildMetricRow({
                label: "Forecast average order value (editable)",
                inputId: "sfFcStoreAov",
                value: storeForecastDefaults.aov.toFixed(2),
                step: "0.01",
                min: "0",
              }).replace('id="sfFcStoreAov"', 'id="sfFcStoreAov" data-role="aov"')}

              ${buildDisplayRow({
                label: "Forecast revenue (auto)",
                valueId: "sfFcStoreRevenue",
                valueText: "£0.00",
              }).replace('id="sfFcStoreRevenue"', 'id="sfFcStoreRevenue" data-role="revenue"')}

              <div class="sf-actions">
                <button class="sf-reset" data-role="reset" type="button">Reset to defaults</button>
              </div>

              <div class="sf-footnote">
                This assumes you maintain the same pace for the rest of the month (unless edited).
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire main tabs (Current / Forecast)
    widget.querySelectorAll(".sf-tab-main").forEach((btn) => {
      btn.addEventListener("click", () => setActiveMain(widget, btn.dataset.main));
    });

    // Wire sub tabs within each main panel
    widget.querySelectorAll(".sf-main").forEach((mainEl) => {
      mainEl.querySelectorAll(".sf-tab-sub").forEach((btn) => {
        btn.addEventListener("click", () => setActiveSub(mainEl, btn.dataset.sub));
      });
    });

    // Attach what-if logic to each editable panel
    const curRepPanel = widget.querySelector('.sf-main[data-main="current"] .sf-subpanel[data-sub="rep"]');
    const curStorePanel = widget.querySelector('.sf-main[data-main="current"] .sf-subpanel[data-sub="store"]');
    const fcRepPanel = widget.querySelector('.sf-main[data-main="forecast"] .sf-subpanel[data-sub="rep"]');
    const fcStorePanel = widget.querySelector('.sf-main[data-main="forecast"] .sf-subpanel[data-sub="store"]');

    // IMPORTANT: these are different datasets
    attachForecastLogic({
      scopeEl: curRepPanel,
      actualCount: repActual.count,
      actualAov: repActual.aov,
      showCommission: true,
    });

    attachForecastLogic({
      scopeEl: curStorePanel,
      actualCount: storeActual.count,
      actualAov: storeActual.aov,
      showCommission: false,
    });

    // Forecast panels default from projection (but still editable)
    attachForecastLogic({
      scopeEl: fcRepPanel,
      actualCount: repForecastDefaults.count,
      actualAov: repForecastDefaults.aov,
      showCommission: true,
    });

    attachForecastLogic({
      scopeEl: fcStorePanel,
      actualCount: storeForecastDefaults.count,
      actualAov: storeForecastDefaults.aov,
      showCommission: false,
    });

    // Default active states
    setActiveMain(widget, "current");
    setActiveSub(widget.querySelector('.sf-main[data-main="current"]'), "rep");
    setActiveSub(widget.querySelector('.sf-main[data-main="forecast"]'), "rep");
  } catch (err) {
    console.error("❌ Failed to load Sales Forecast widget:", err);
    widget.innerHTML = `<div class="error">Error loading sales forecast</div>`;
  }
});
