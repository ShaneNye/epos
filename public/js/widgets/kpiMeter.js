// public/js/widgets/kpiMeter.js
console.log("KPI Meter Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("kpiMeterWidget");
  if (!widget) return;

  const state = {
    selectedStore: "",
    targetRows: [],
    salesRows: [],
    primaryStore: "",
    animationFrame: null,
  };

  function getHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  function normalize(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim()
      .toLowerCase();
  }

  function displayStore(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim() || "Unknown";
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    });
  }

  function localDate(value) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function addDays(date, days) {
    const d = localDate(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function daysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  function daysBetweenInclusive(start, end) {
    return Math.max(0, Math.round((localDate(end) - localDate(start)) / 86400000) + 1);
  }

  function getRange() {
    return window.DashboardDateFilter?.getRange() || {
      key: "today",
      label: "Today",
      start: new Date(),
      end: new Date(),
    };
  }

  function isFullMonthRange(range) {
    const start = localDate(range.start);
    const end = localDate(range.end);
    return start.getDate() === 1 &&
      end.getDate() === daysInMonth(end) &&
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth();
  }

  function getTargetForMonth(storeKey, key) {
    const row = state.targetRows.find((target) =>
      normalize(target.Store) === storeKey && String(target.Date || "").trim() === key
    );
    return parseFloat(row?.Target || 0) || 0;
  }

  function targetForRange(storeKey, range) {
    if (!storeKey) return 0;

    if (isFullMonthRange(range)) {
      return getTargetForMonth(storeKey, monthKey(range.start));
    }

    let total = 0;
    let cursor = localDate(range.start);
    const end = localDate(range.end);

    while (cursor <= end) {
      const key = monthKey(cursor);
      const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const overlapStart = cursor > monthStart ? cursor : monthStart;
      const overlapEnd = end < monthEnd ? end : monthEnd;
      const overlapDays = daysBetweenInclusive(overlapStart, overlapEnd);
      const monthlyTarget = getTargetForMonth(storeKey, key);

      total += (monthlyTarget / daysInMonth(cursor)) * overlapDays;
      cursor = addDays(monthEnd, 1);
    }

    return total;
  }

  function actualRevenueForRange(storeKey, range) {
    return state.salesRows
      .filter((row) => normalize(row.Store) === storeKey)
      .filter((row) => window.DashboardDateFilter?.isDateInRange(row.Date, range))
      .reduce((sum, row) => sum + (parseFloat(row.Amount || row.Total || row.Gross || 0) || 0), 0);
  }

  async function resolvePrimaryStore(headers) {
    try {
      const meRes = await fetch("/api/me", { headers });
      const meData = await meRes.json();
      const storeId = meData?.user?.primaryStore;

      if (typeof storeId === "string") return normalize(storeId);
      if (typeof storeId === "number") {
        const storeRes = await fetch(`/api/meta/store/${storeId}`);
        const storeData = await storeRes.json();
        if (storeData.ok && storeData.name) return normalize(storeData.name);
      }
    } catch (err) {
      console.warn("Failed loading primary store for KPI meter:", err);
    }
    return "";
  }

  function storeOptions() {
    const stores = new Map();
    state.targetRows.forEach((row) => {
      const key = normalize(row.Store);
      if (key && !stores.has(key)) stores.set(key, displayStore(row.Store));
    });
    state.salesRows.forEach((row) => {
      const key = normalize(row.Store);
      if (key && !stores.has(key)) stores.set(key, displayStore(row.Store));
    });

    return Array.from(stores.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function renderShell() {
    widget.innerHTML = `
      <div class="kpi-meter-header">
        <div class="widget-header">KPI Meter</div>
        <select id="kpiMeterStore" aria-label="KPI meter store"></select>
      </div>
      <div class="kpi-meter-content">
        <div class="kpi-gauge" style="--kpi-deg: 0deg;">
          <div class="kpi-gauge-inner">
            <strong data-kpi-percent>0%</strong>
            <span>of target</span>
          </div>
        </div>
        <div class="kpi-meter-stats">
          <div><span>Revenue</span><strong data-kpi-actual>£0</strong></div>
          <div><span>Target</span><strong data-kpi-target>£0</strong></div>
          <div><span>Variance</span><strong data-kpi-variance>£0</strong></div>
        </div>
      </div>
      <div class="kpi-success-message" data-kpi-success-message></div>
    `;

    const select = widget.querySelector("#kpiMeterStore");
    const options = storeOptions();
    select.innerHTML = options
      .map((store) => `<option value="${store.key}">${store.label}</option>`)
      .join("");

    if (!state.selectedStore) {
      state.selectedStore = options.find((store) => store.key === state.primaryStore)?.key || options[0]?.key || "";
    }
    select.value = state.selectedStore;
    select.addEventListener("change", (event) => {
      state.selectedStore = event.target.value;
      renderMeter();
    });

    renderMeter();
  }

  function renderMeter() {
    const range = getRange();
    const target = targetForRange(state.selectedStore, range);
    const actual = actualRevenueForRange(state.selectedStore, range);
    const percent = target > 0 ? (actual / target) * 100 : 0;
    const capped = Math.max(0, Math.min(percent, 140));
    const deg = Math.min(180, (capped / 100) * 180);
    const variance = actual - target;
    const finalPercent = Math.round(percent);
    const gauge = widget.querySelector(".kpi-gauge");
    const percentEl = widget.querySelector("[data-kpi-percent]");
    const messageEl = widget.querySelector("[data-kpi-success-message]");
    const isTargetMet = target > 0 && percent >= 100;

    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);

    gauge?.classList.toggle("is-over-target", isTargetMet);
    percentEl?.classList.toggle("is-over-target", isTargetMet);
    messageEl?.classList.toggle("is-visible", isTargetMet);
    if (messageEl) {
      messageEl.textContent = isTargetMet ? "Target hit for this period. Well done!" : "";
    }

    animateGauge(gauge, percentEl, deg, finalPercent, () => {
      if (isTargetMet) burstConfetti(gauge);
    });

    widget.querySelector("[data-kpi-actual]").textContent = formatMoney(actual);
    widget.querySelector("[data-kpi-target]").textContent = formatMoney(target);
    widget.querySelector("[data-kpi-variance]").textContent = `${variance >= 0 ? "+" : ""}${formatMoney(variance)}`;
    widget.querySelector("[data-kpi-variance]").classList.toggle("is-negative", variance < 0);
  }

  function animateGauge(gauge, percentEl, finalDeg, finalPercent, onComplete) {
    if (!gauge || !percentEl) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      gauge.style.setProperty("--kpi-deg", `${finalDeg}deg`);
      percentEl.textContent = `${finalPercent}%`;
      onComplete?.();
      return;
    }

    const duration = 750;
    const start = performance.now();
    gauge.style.setProperty("--kpi-deg", "0deg");
    percentEl.textContent = "0%";

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);

      gauge.style.setProperty("--kpi-deg", `${finalDeg * eased}deg`);
      percentEl.textContent = `${Math.round(finalPercent * eased)}%`;

      if (progress < 1) {
        state.animationFrame = requestAnimationFrame(tick);
      } else {
        state.animationFrame = null;
        onComplete?.();
      }
    }

    state.animationFrame = requestAnimationFrame(tick);
  }

  function burstConfetti(gauge) {
    if (!gauge || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    widget.querySelector(".kpi-confetti-layer")?.remove();

    const gaugeRect = gauge.getBoundingClientRect();
    const widgetRect = widget.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = "kpi-confetti-layer";
    layer.style.left = `${gaugeRect.left - widgetRect.left + gaugeRect.width / 2}px`;
    layer.style.top = `${gaugeRect.top - widgetRect.top + gaugeRect.height * 0.72}px`;

    const colors = ["#16a34a", "#22c55e", "#f5b301", "#0081ab", "#38bdf8"];

    for (let i = 0; i < 18; i += 1) {
      const angle = (-170 + Math.random() * 160) * (Math.PI / 180);
      const distance = 38 + Math.random() * 54;
      const piece = document.createElement("span");
      piece.className = "kpi-confetti-piece";
      piece.style.setProperty("--confetti-x", `${Math.cos(angle) * distance}px`);
      piece.style.setProperty("--confetti-y", `${Math.sin(angle) * distance}px`);
      piece.style.setProperty("--confetti-rotate", `${Math.round(Math.random() * 240 - 120)}deg`);
      piece.style.setProperty("--confetti-color", colors[i % colors.length]);
      piece.style.animationDelay = `${Math.random() * 80}ms`;
      layer.appendChild(piece);
    }

    widget.appendChild(layer);
    window.setTimeout(() => layer.remove(), 1100);
  }

  async function loadKpiData() {
    widget.innerHTML = `<div class="loading">Loading KPI meter...</div>`;

    try {
      const headers = getHeaders();
      const [targetsRes, salesRes, primaryStore] = await Promise.all([
        fetch(`/api/netsuite/store-targets?refresh=1&_=${Date.now()}`, { headers, cache: "no-store" }),
        fetch(`/api/netsuite/widget-sales?refresh=1&_=${Date.now()}`, { headers, cache: "no-store" }),
        resolvePrimaryStore(headers),
      ]);

      const [targetsData, salesData] = await Promise.all([targetsRes.json(), salesRes.json()]);
      if (!targetsRes.ok || targetsData.ok === false || !Array.isArray(targetsData.results)) {
        throw new Error(targetsData.error || "Invalid store targets response");
      }
      if (!salesRes.ok || salesData.ok === false || !Array.isArray(salesData.results)) {
        throw new Error(salesData.error || "Invalid sales response");
      }

      state.primaryStore = primaryStore;
      state.targetRows = targetsData.results;
      state.salesRows = salesData.results;
      renderShell();
    } catch (err) {
      console.error("Failed to load KPI meter:", err);
      widget.innerHTML = `<div class="error">Error loading KPI meter</div>`;
    }
  }

  window.addEventListener("dashboard:date-range-change", renderMeter);
  loadKpiData();
});
