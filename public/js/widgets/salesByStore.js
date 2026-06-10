// public/js/widgets/salesByStore.js
console.log("Sales by Store Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widgetContainer = document.getElementById("salesByStoreWidget");
  if (!widgetContainer) {
    console.warn("#salesByStoreWidget container not found");
    return;
  }

  let chartInstance = null;

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

      const storeLabels = storeRows.map((row) => row.label);
      const storeSales = storeRows.map((row) => row.revenue);
      const maxRevenue = Math.max(...storeSales, 0);

      widgetContainer.innerHTML = `
        <div class="widget-header">Sales by Store</div>
        <div class="chart-container">
          <canvas id="salesByStoreChart"></canvas>
        </div>
      `;

      const ctx = document.getElementById("salesByStoreChart").getContext("2d");
      chartInstance = new Chart(ctx, {
        type: "bar",
        data: {
          labels: storeLabels,
          datasets: [
            {
              label: "Sales Total (\u00a3)",
              data: storeSales,
              backgroundColor: storeRows.map((row) =>
                row.isPrimary ? "#005f73" : "#0081ab"
              ),
              borderColor: storeRows.map((row) =>
                row.isPrimary ? "#ffbf00" : "#006f94"
              ),
              borderWidth: storeRows.map((row) => (row.isPrimary ? 2 : 1)),
              borderRadius: 4,
              barPercentage: 0.72,
              categoryPercentage: 0.78,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 8 } },
          scales: {
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
              },
            },
          },
          plugins: {
            legend: { display: false },
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
              },
            },
          },
        },
      });
    } catch (err) {
      console.error("Failed to load sales by store:", err);
      widgetContainer.innerHTML = `<div class="error">Error loading store data</div>`;
    }
  }

  window.addEventListener("dashboard:date-range-change", loadSalesByStore);
  loadSalesByStore();
});
