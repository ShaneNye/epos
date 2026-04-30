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

    /* ==========================================================
       1️⃣ Load Current User → resolve their primary store
       ========================================================== */
    let primaryStoreName = null;

    try {
      const meRes = await fetch("/api/me", { headers });
      const meData = await meRes.json();

      const storeId = meData?.user?.primaryStore;

      if (typeof storeId === "string") {
        primaryStoreName = storeId.trim().toLowerCase();
      } else if (typeof storeId === "number") {
        const storeRes = await fetch(`/api/meta/store/${storeId}`);
        const storeData = await storeRes.json();
        if (storeData.ok && storeData.name) {
          primaryStoreName = storeData.name.trim().toLowerCase();
        }
      }

      console.log("🏪 Primary store resolved:", primaryStoreName);
    } catch (err) {
      console.warn("⚠️ Failed loading /api/me", err);
    }

    /* ==========================================================
       2️⃣ Fetch Sales Widget Feed
       ========================================================== */
    const res = await fetch(`/api/netsuite/widget-sales?refresh=1&_=${Date.now()}`, {
      headers,
      cache: "no-store",
    });
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

    /* ==========================================================
       Normalise store names ("Holdings : Tonbridge" → "tonbridge")
       ========================================================== */
    function normalizeStoreName(name) {
      return String(name || "")
        .replace(/\u00A0/g, " ")
        .replace(/.*:\s*/i, "")   
        .trim()
        .toLowerCase();
    }

    /* ==========================================================
       3️⃣ Aggregate sales + document counts
       ========================================================== */
    const storeTotals = {};
    const storeDocs = {};

    todaysOrders.forEach((r) => {
      const rawStore = r.Store?.trim() || "Unknown Store";
      const cleanStore = normalizeStoreName(rawStore);

      const docNum = (r["Document Number"] || r.Document || "").trim();
      const amount = parseFloat(r.Total || r.Gross || r.Amount || 0);

      if (!storeTotals[cleanStore]) {
        storeTotals[cleanStore] = 0;
        storeDocs[cleanStore] = new Set();
      }

      storeTotals[cleanStore] += amount;
      if (docNum) storeDocs[cleanStore].add(docNum);
    });

    const storeNames = Object.keys(storeTotals);
    const storeSales = storeNames.map((s) => storeTotals[s]);
    const storeDocCounts = storeNames.map((s) => storeDocs[s].size);

    /* ==========================================================
       4️⃣ Extract primary store totals
       ========================================================== */
    let centreSalesTotal = 0;
    let centreSalesCount = 0;

    if (primaryStoreName) {
      for (const store of storeNames) {
        if (store === primaryStoreName) {
          centreSalesTotal = storeTotals[store] || 0;
          centreSalesCount = storeDocs[store]?.size || 0;
          break;
        }
      }
    }

    console.log("🎯 Centre values →", {
      centreSalesTotal,
      centreSalesCount,
    });

    /* ==========================================================
       5️⃣ Build Highlight Arrays (no style changes)
       ========================================================== */
    const sliceCount = storeNames.length;

    // Default border widths
    const borderWidthsSales = new Array(sliceCount).fill(2);
    const borderWidthsDocs = new Array(sliceCount).fill(2);

    // Default hover offsets
    const hoverOffsetsSales = new Array(sliceCount).fill(8);
    const hoverOffsetsDocs = new Array(sliceCount).fill(6);

    // Highlight the user's store
    storeNames.forEach((store, i) => {
      if (store === primaryStoreName) {
        borderWidthsSales[i] = 4; 
        borderWidthsDocs[i] = 4;

        hoverOffsetsSales[i] = 12;
        hoverOffsetsDocs[i] = 10;
      }
    });

    /* ==========================================================
       6️⃣ Prepare widget HTML
       ========================================================== */
    widgetContainer.innerHTML = `
      <div class="widget-header">🏬 Sales by Store</div>
      <div class="chart-container">
        <canvas id="salesByStoreChart"></canvas>
      </div>
    `;

    const ctx = document.getElementById("salesByStoreChart").getContext("2d");

    /* ==========================================================
   7️⃣ Plugin: Draw text in doughnut centre (WITH STORE NAME)
   ========================================================== */
const centreTextPlugin = {
  id: "centreText",
  afterDraw(chart) {
    const { ctx, chartArea: { width, height } } = chart;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 💠 Primary Store Name (Top Line)
    if (primaryStoreName) {
      const storeLabel =
        primaryStoreName.charAt(0).toUpperCase() + primaryStoreName.slice(1);
      ctx.fillStyle = "#555";
      ctx.font = "600 14px Segoe UI";
      ctx.fillText(storeLabel, width / 2, height / 2 - 32);
    }

    // 💷 Sales Total (Middle Line)
    ctx.fillStyle = "#0081ab";
    ctx.font = "700 20px Segoe UI";
    ctx.fillText(`£${centreSalesTotal.toFixed(2)}`, width / 2, height / 2 - 10);

    // 🧾 Sales Count (Bottom Line)
    ctx.fillStyle = "#333";
    ctx.font = "600 14px Segoe UI";
    ctx.fillText(
      `${centreSalesCount} sale${centreSalesCount !== 1 ? "s" : ""}`,
      width / 2,
      height / 2 + 14
    );

    ctx.restore();
  }
};


    /* ==========================================================
       8️⃣ Render Doughnut Chart
       ========================================================== */
    new Chart(ctx, {
      type: "doughnut",
      plugins: [centreTextPlugin],
      data: {
        labels: storeNames,
        datasets: [
          {
            label: "Sales Total (£)",
            data: storeSales,
            backgroundColor: [
              "#0081ab", "#00a8c3", "#00c3c3", "#66d9d9", "#b3eded",
              "#005f73", "#94d2bd", "#0a9396", "#9fd8df",
            ],
            borderColor: "#ffffff",
            borderWidth: borderWidthsSales,
            hoverOffset: hoverOffsetsSales,
          },
          {
            label: "Document Count",
            data: storeDocCounts,
            backgroundColor: [
              "#005f73", "#007f89", "#009fad", "#4fc3c3", "#80dcdc",
              "#003f52", "#73bfb5", "#047d7f", "#6dcfd5",
            ],
            borderColor: "#ffffff",
            borderWidth: borderWidthsDocs,
            hoverOffset: hoverOffsetsDocs,
          },
        ],
      },

      /* ==========================================================
         9️⃣ External Tooltip (Store + Sales + Doc Count)
         ========================================================== */
      options: {
        cutout: "60%",
        radius: "90%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },

          tooltip: {
            enabled: false,
            external: function (context) {
              let tooltipEl = document.getElementById("chartjs-external-tooltip");

              // Create tooltip if missing
              if (!tooltipEl) {
                tooltipEl = document.createElement("div");
                tooltipEl.id = "chartjs-external-tooltip";
                tooltipEl.style.position = "absolute";
                tooltipEl.style.background = "#000000cc";
                tooltipEl.style.color = "white";
                tooltipEl.style.padding = "6px 10px";
                tooltipEl.style.borderRadius = "6px";
                tooltipEl.style.pointerEvents = "none";
                tooltipEl.style.whiteSpace = "nowrap";
                tooltipEl.style.fontSize = "12px";
                document.body.appendChild(tooltipEl);
              }

              const tooltip = context.tooltip;

              // Hide when not active
              if (!tooltip || tooltip.opacity === 0) {
                tooltipEl.style.opacity = 0;
                return;
              }

              // 🔥 Build full tooltip content (title + both body lines)
              let html = "";

              // Store name (title)
              if (tooltip.title && tooltip.title.length > 0) {
                html += `<div style="font-weight:600;margin-bottom:3px;">${tooltip.title[0]}</div>`;
              }

              // Dataset lines
              if (tooltip.body) {
                tooltip.body.forEach((b) => {
                  html += `<div>${b.lines.join(" ")}</div>`;
                });
              }

              tooltipEl.innerHTML = html;

              const chartRect = context.chart.canvas.getBoundingClientRect();

              // Always place tooltip OUTSIDE (to the right)
              const x = chartRect.right + 12;
              const y = chartRect.top + tooltip.caretY;

              tooltipEl.style.opacity = 1;
              tooltipEl.style.left = x + "px";
              tooltipEl.style.top = y + "px";
            }
          }
        }
      }
    });

  } catch (err) {
    console.error("❌ Failed to load sales by store:", err);
    widgetContainer.innerHTML = `<div class="error">Error loading store data</div>`;
  }
});
