// public/js/widgets/salesByStore.js
console.log("Sales by Store Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widgetContainer = document.getElementById("salesByStoreWidget");
  if (!widgetContainer) {
    console.warn("#salesByStoreWidget container not found");
    return;
  }

  let chartInstance = null;
  let hoveredStoreIndex = -1;
  let lockedStoreIndex = -1;
  let accordionAnimationFrame = null;
  const LOCKED_STORE_KEY = "epos.salesByStore.lockedStore";
  const CHART_VIEW_KEY = "epos.salesByStore.chartView";

  function loadChartView() {
    try {
      const savedView = localStorage.getItem(CHART_VIEW_KEY);
      return savedView === "pie" ? "pie" : "bar";
    } catch { return "bar"; }
  }

  function saveChartView(view) {
    try { localStorage.setItem(CHART_VIEW_KEY, view === "pie" ? "pie" : "bar"); }
    catch {}
  }

  let chartView = loadChartView();

  function loadLockedStore() {
    try { return normalizeStoreName(localStorage.getItem(LOCKED_STORE_KEY) || ""); }
    catch { return ""; }
  }

  function saveLockedStore(storeName) {
    try {
      if (storeName) localStorage.setItem(LOCKED_STORE_KEY, normalizeStoreName(storeName));
      else localStorage.removeItem(LOCKED_STORE_KEY);
    } catch {}
  }

  function getRange() {
    return window.DashboardDateFilter?.getRange() || {
      label: "Today",
      start: new Date(),
      end: new Date(),
    };
  }

  function normalizeStoreName(name) {
    return String(name || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim()
      .toLowerCase();
  }

  function toTitleCase(value) {
    return String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function themeColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  async function resolvePrimaryStore(headers) {
    try {
      const meRes = await fetch("/api/me", { headers });
      const meData = await meRes.json();
      const storeId = meData?.user?.primaryStore;

      if (typeof storeId === "string") {
        return normalizeStoreName(storeId);
      }

      if (typeof storeId === "number") {
        const storeRes = await fetch(`/api/meta/store/${storeId}`);
        const storeData = await storeRes.json();
        if (storeData.ok && storeData.name) return normalizeStoreName(storeData.name);
      }
    } catch (err) {
      console.warn("Failed loading primary store:", err);
    }

    return null;
  }

  async function loadSalesByStore() {
    const range = getRange();
    widgetContainer.innerHTML = `<div class="loading">Loading sales by store...</div>`;

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    try {
      const saved = storageGet?.();
      const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
      const primaryStoreName = await resolvePrimaryStore(headers);

      const res = await fetch(`/api/netsuite/widget-sales?refresh=1&_=${Date.now()}`, {
        headers,
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok || !data.ok || !Array.isArray(data.results)) {
        throw new Error("Invalid or unexpected response format");
      }

      const orders = data.results.filter((r) =>
        window.DashboardDateFilter?.isDateInRange(r.Date, range)
      );

      if (!orders.length) {
        widgetContainer.innerHTML = `
          <div class="widget-header">Sales by Store</div>
          <div class="no-data">No sales found for ${range.label.toLowerCase()}.</div>
        `;
        return;
      }

      const storeTotals = {};
      const storeDocs = {};

      orders.forEach((r) => {
        const cleanStore = normalizeStoreName(r.Store?.trim() || "Unknown Store");
        const docNum = (r["Document Number"] || r.Document || "").trim();
        const amount = parseFloat(r.Total || r.Gross || r.Amount || 0);

        if (!storeTotals[cleanStore]) {
          storeTotals[cleanStore] = 0;
          storeDocs[cleanStore] = new Set();
        }

        storeTotals[cleanStore] += amount;
        if (docNum) storeDocs[cleanStore].add(docNum);
      });

      const storeRows = Object.keys(storeTotals)
        .map((store) => ({
          store,
          label: toTitleCase(store),
          revenue: storeTotals[store],
          documents: storeDocs[store].size,
          isPrimary: store === primaryStoreName,
        }))
        .sort((a, b) => b.revenue - a.revenue);
      const lockedStoreName = loadLockedStore();
      lockedStoreIndex = lockedStoreName
        ? storeRows.findIndex((row) => row.store === lockedStoreName)
        : -1;

      const storeLabels = storeRows.map((row) => row.label);
      const storeSales = storeRows.map((row) => row.revenue);
      const maxRevenue = Math.max(...storeSales, 0);
      const brand = themeColor("--brand", "#0081ab");
      const brandDark = themeColor("--brand-700", "#005f73");
      const accent = themeColor("--accent", "#ffbf00");

      widgetContainer.innerHTML = `
        <div class="sales-store-widget-header">
          <div class="widget-header">Sales by Store</div>
          <div class="sales-store-view-toggle" role="group" aria-label="Chart type">
            <button type="button" data-chart-view="bar" class="${chartView === "bar" ? "active" : ""}" aria-pressed="${chartView === "bar"}">Bar</button>
            <button type="button" data-chart-view="pie" class="${chartView === "pie" ? "active" : ""}" aria-pressed="${chartView === "pie"}">Pie</button>
          </div>
        </div>
        <div class="chart-container">
          <div class="sales-store-chart-stage">
            <canvas id="salesByStoreChart" role="img" aria-label="Sales by store bar chart. Hover a bar to highlight its store and view sales details."></canvas>
          </div>
        </div>
      `;

      const ctx = document.getElementById("salesByStoreChart").getContext("2d");
      widgetContainer.querySelectorAll("[data-chart-view]").forEach((button) => {
        button.addEventListener("click", () => {
          const nextView = button.dataset.chartView;
          if (nextView === chartView) return;
          chartView = nextView;
          saveChartView(chartView);
          loadSalesByStore();
        });
      });
      hoveredStoreIndex = -1;
      const applyAccordionLayout = (chart, activeIndex) => {
        const bars = chart.getDatasetMeta(0).data;
        if (!bars.length) return;
        bars.forEach((bar) => {
          if (!Number.isFinite(bar.$normalY)) bar.$normalY = bar.y;
          if (!Number.isFinite(bar.$normalHeight)) bar.$normalHeight = bar.height;
        });
        const top = chart.chartArea.top;
        const bottom = chart.chartArea.bottom;
        const targets = [];
        if (activeIndex < 0) {
          bars.forEach((bar) => targets.push({ y: bar.$normalY, height: bar.$normalHeight }));
        } else {
          const activeWeight = 2.2;
          const totalWeight = bars.length - 1 + activeWeight;
          let cursor = top;
          bars.forEach((_bar, index) => {
            const cellHeight = (bottom - top) * (index === activeIndex ? activeWeight : 1) / totalWeight;
            targets.push({ y: cursor + cellHeight / 2, height: cellHeight + 0.5 });
            cursor += cellHeight;
          });
        }

        if (accordionAnimationFrame) cancelAnimationFrame(accordionAnimationFrame);
        const starts = bars.map((bar) => ({ y: bar.y, height: bar.height }));
        const startedAt = performance.now();
        const duration = 180;
        const animate = (time) => {
          const progress = Math.min(1, (time - startedAt) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          bars.forEach((bar, index) => {
            bar.y = starts[index].y + (targets[index].y - starts[index].y) * eased;
            bar.height = starts[index].height + (targets[index].height - starts[index].height) * eased;
          });
          chart.draw();
          if (progress < 1) accordionAnimationFrame = requestAnimationFrame(animate);
          else accordionAnimationFrame = null;
        };
        accordionAnimationFrame = requestAnimationFrame(animate);
      };
      const accordionLabelsPlugin = {
        id: "salesStoreAccordionLabels",
        beforeDatasetsDraw(chart) {
          if (hoveredStoreIndex < 0 && lockedStoreIndex < 0) return;
          const { ctx: chartContext, chartArea } = chart;
          chartContext.save();
          chartContext.fillStyle = "#ffffff";
          chartContext.fillRect(0, chartArea.top - 8, Math.max(0, chartArea.left - 2), chartArea.bottom - chartArea.top + 16);
          chartContext.restore();
        },
        afterDraw(chart) {
          if (hoveredStoreIndex < 0 && lockedStoreIndex < 0) return;
          const { ctx: chartContext, chartArea } = chart;
          const bars = chart.getDatasetMeta(0).data;
          const displayedIndexes = new Set(chart.scales.y.ticks.map((tick) => Number(tick.value)));
          if (lockedStoreIndex >= 0) {
            const targetCount = Math.max(1, displayedIndexes.size);
            const interval = Math.max(1, Math.round(storeRows.length / targetCount));
            displayedIndexes.clear();
            for (let index = lockedStoreIndex; index >= 0; index -= interval) displayedIndexes.add(index);
            for (let index = lockedStoreIndex + interval; index < storeRows.length; index += interval) displayedIndexes.add(index);
          }
          const protectedIndexes = new Set();
          const revealIndex = (index) => {
            if (index < 0 || displayedIndexes.has(index)) {
              if (index >= 0) protectedIndexes.add(index);
              return;
            }
            const replacement = [...displayedIndexes]
              .filter((candidate) => !protectedIndexes.has(candidate))
              .sort((a, b) => Math.abs(a - index) - Math.abs(b - index))[0];
            if (Number.isFinite(replacement)) displayedIndexes.delete(replacement);
            displayedIndexes.add(index);
            protectedIndexes.add(index);
          };
          revealIndex(lockedStoreIndex);
          revealIndex(hoveredStoreIndex);
          const maxWidth = Math.max(20, chartArea.left - 18);

          chartContext.save();
          chartContext.fillStyle = "#1f3444";
          chartContext.font = '600 11px "Segoe UI", system-ui, sans-serif';
          chartContext.textAlign = "right";
          chartContext.textBaseline = "middle";
          [...displayedIndexes].sort((a, b) => a - b).forEach((index) => {
            const bar = bars[index];
            if (!bar || !storeRows[index]) return;
            const locked = index === lockedStoreIndex;
            const availableTextWidth = locked ? Math.max(10, maxWidth - 13) : maxWidth;
            let label = storeRows[index].label;
            while (label.length > 1 && chartContext.measureText(label).width > availableTextWidth) {
              label = `${label.slice(0, -2)}…`;
            }
            chartContext.fillText(label, chartArea.left - 8, bar.y);
            if (locked) {
              const labelWidth = chartContext.measureText(label).width;
              const lockX = chartArea.left - 8 - labelWidth - 10;
              const lockY = bar.y;
              chartContext.save();
              chartContext.strokeStyle = "#8b98a3";
              chartContext.fillStyle = "#8b98a3";
              chartContext.lineWidth = 1.2;
              chartContext.beginPath();
              chartContext.arc(lockX, lockY - 2.5, 3, Math.PI, 0);
              chartContext.stroke();
              chartContext.fillRect(lockX - 4, lockY - 2, 8, 6);
              chartContext.restore();
            }
          });
          chartContext.restore();
        },
      };
      const pieColors = storeRows.map((_row, index) => {
        const hue = 190 + (index * 31) % 145;
        const lightness = 38 + (index % 4) * 9;
        return `hsl(${hue} 62% ${lightness}%)`;
      });
      chartInstance = new Chart(ctx, {
        type: chartView,
        plugins: chartView === "bar" ? [accordionLabelsPlugin] : [],
        data: {
          labels: storeLabels,
          datasets: [
            {
              label: "Sales Total (\u00a3)",
              data: storeSales,
              backgroundColor: chartView === "pie" ? pieColors : storeRows.map((row) =>
                row.isPrimary ? brandDark : brand
              ),
              borderColor: chartView === "pie" ? "#ffffff" : storeRows.map((row) =>
                row.isPrimary ? accent : brandDark
              ),
              borderWidth: chartView === "pie" ? 2 : storeRows.map((row) => (row.isPrimary ? 2 : 1)),
              borderRadius: 2,
              barPercentage: 1,
              categoryPercentage: 1,
              hoverBackgroundColor: brandDark,
              hoverBorderColor: accent,
              hoverBorderWidth: 2,
              hoverOffset: chartView === "pie" ? 8 : 0,
            },
          ],
        },
        options: {
          indexAxis: chartView === "bar" ? "y" : "x",
          responsive: true,
          maintainAspectRatio: false,
          interaction: chartView === "bar"
            ? { mode: "nearest", axis: "y", intersect: false }
            : { mode: "nearest", intersect: true },
          animation: { duration: 180 },
          onHover: chartView === "bar" ? (_event, activeElements, chart) => {
            const pointerY = Number(_event.y);
            const bars = chart.getDatasetMeta(0).data;
            const insideRows = Number.isFinite(pointerY)
              && pointerY >= chart.chartArea.top
              && pointerY <= chart.chartArea.bottom;
            const nearestIndex = insideRows && bars.length
              ? bars.reduce((best, bar, index) => Math.abs(bar.y - pointerY) < best.distance
                ? { index, distance: Math.abs(bar.y - pointerY) }
                : best, { index: -1, distance: Infinity }).index
              : -1;
            const nextIndex = activeElements[0]?.index ?? nearestIndex;
            if (nextIndex === hoveredStoreIndex) return;
            hoveredStoreIndex = nextIndex;
            chart.canvas.style.cursor = nextIndex >= 0 ? "pointer" : "default";
            applyAccordionLayout(chart, nextIndex);
          } : undefined,
          onClick: chartView === "bar" ? (_event, activeElements, chart) => {
            const pointerY = Number(_event.y);
            const bars = chart.getDatasetMeta(0).data;
            if (!Number.isFinite(pointerY) || pointerY < chart.chartArea.top || pointerY > chart.chartArea.bottom || !bars.length) return;
            const clickedIndex = activeElements[0]?.index ?? bars.reduce((best, bar, index) => Math.abs(bar.y - pointerY) < best.distance
              ? { index, distance: Math.abs(bar.y - pointerY) }
              : best, { index: -1, distance: Infinity }).index;
            lockedStoreIndex = clickedIndex === lockedStoreIndex ? -1 : clickedIndex;
            saveLockedStore(lockedStoreIndex >= 0 ? storeRows[lockedStoreIndex].store : "");
            chart.canvas.setAttribute("aria-label", lockedStoreIndex >= 0
              ? `Sales by store bar chart. ${storeRows[lockedStoreIndex].label} label locked. Click the row again to unlock.`
              : "Sales by store bar chart. No store label locked.");
            chart.draw();
          } : undefined,
          layout: { padding: { right: 8 } },
          scales: chartView === "bar" ? {
            x: {
              beginAtZero: true,
              suggestedMax: maxRevenue ? maxRevenue * 1.1 : undefined,
              grid: { color: "#edf3f6" },
              border: { display: false },
              ticks: {
                color: "#415465",
                maxRotation: 0,
                minRotation: 0,
                maxTicksLimit: 6,
                callback: (value) => `\u00a3${Number(value).toLocaleString("en-GB")}`,
              },
            },
            y: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: "#1f3444",
                font: { size: 11, weight: 600 },
                padding: 6,
              },
            },
          } : {},
          plugins: {
            legend: chartView === "pie" ? {
              display: true,
              position: "right",
              labels: { boxWidth: 10, boxHeight: 10, padding: 8, color: "#1f3444", font: { size: 10 } },
            } : { display: false },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const row = storeRows[context.dataIndex];
                  const revenue = Number(row.revenue || 0).toLocaleString("en-GB", {
                    style: "currency",
                    currency: "GBP",
                  });
                  return `${revenue} from ${row.documents} sale${row.documents !== 1 ? "s" : ""}`;
                },
                title: (items) => storeRows[items[0]?.dataIndex]?.label || "Store",
              },
            },
          },
        },
      });
      if (chartView === "bar") ctx.canvas.addEventListener("mouseleave", () => {
        if (hoveredStoreIndex < 0 || !chartInstance) return;
        hoveredStoreIndex = -1;
        applyAccordionLayout(chartInstance, -1);
      });
    } catch (err) {
      console.error("Failed to load sales by store:", err);
      widgetContainer.innerHTML = `<div class="error">Error loading store data</div>`;
    }
  }

  window.addEventListener("dashboard:date-range-change", loadSalesByStore);
  loadSalesByStore();
});
