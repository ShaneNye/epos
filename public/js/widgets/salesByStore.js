// public/js/widgets/salesByStore.js
console.log("🏬 Sales by Store Widget Loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const widgetContainer = document.getElementById("salesByStoreWidget");
  if (!widgetContainer) {
    console.warn("⚠️ #salesByStoreWidget container not found");
    return;
  }

  widgetContainer.innerHTML = `<div class="loading">Loading sales by store...</div>`;

  try {
    const saved = storageGet?.();
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};

    const res = await fetch("/api/netsuite/widget-sales", { headers });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.results)) {
      throw new Error("Invalid or unexpected response format");
    }

    // === Filter for today's sales ===
    const today = new Date().toLocaleDateString("en-GB");
    const todaysOrders = data.results.filter((r) => r.Date === today);

    if (!todaysOrders.length) {
      widgetContainer.innerHTML = `<div class="no-data">No sales found for today.</div>`;
      return;
    }

    // === Aggregate sales and document counts per store ===
    const storeTotals = {};
    const storeDocs = {};

    todaysOrders.forEach((r) => {
      const store = r.Store?.trim() || "Unknown Store";
      const docNum = (r["Document Number"] || r.Document || "").trim();
      const amount = parseFloat(r.Total || r.Gross || r.Amount || 0);

      if (!storeTotals[store]) {
        storeTotals[store] = 0;
        storeDocs[store] = new Set();
      }

      storeTotals[store] += amount;
      if (docNum) storeDocs[store].add(docNum);
    });

    const storeNames = Object.keys(storeTotals);
    const storeSales = storeNames.map((s) => storeTotals[s]);
    const storeDocCounts = storeNames.map((s) => storeDocs[s].size);

    // === Clear container and insert chart canvas ===
    widgetContainer.innerHTML = `
      <div class="widget-header">🏬 Sales by Store (Today)</div>
      <div class="chart-container">
        <canvas id="salesByStoreChart"></canvas>
      </div>
    `;

    const ctx = document.getElementById("salesByStoreChart").getContext("2d");

    // === Dual Doughnut Chart ===
    new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: storeNames,
        datasets: [
          {
            label: "Sales Total (£)",
            data: storeSales,
            backgroundColor: [
              "#0081ab",
              "#00a8c3",
              "#00c3c3",
              "#66d9d9",
              "#b3eded",
              "#005f73",
              "#94d2bd",
              "#0a9396",
              "#9fd8df",
            ],
            borderColor: "#ffffff",
            borderWidth: 2,
            hoverOffset: 8,
          },
          {
            label: "Document Count",
            data: storeDocCounts,
            backgroundColor: [
              "#005f73",
              "#007f89",
              "#009fad",
              "#4fc3c3",
              "#80dcdc",
              "#003f52",
              "#73bfb5",
              "#047d7f",
              "#6dcfd5",
            ],
            borderColor: "#ffffff",
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        cutout: "60%",
        radius: "90%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#333",
              font: { size: 12 },
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const datasetLabel = context.dataset.label || "";
                if (datasetLabel.includes("Sales")) {
                  const val = Number(context.raw || 0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });
                  return `${context.label}: £${val}`;
                } else {
                  return `${context.label}: ${context.raw} document${context.raw !== 1 ? "s" : ""}`;
                }
              },
            },
          },
        },
      },
    });
  } catch (err) {
    console.error("❌ Failed to load sales by store:", err);
    widgetContainer.innerHTML = `<div class="error">Error loading store data</div>`;
  }
});
