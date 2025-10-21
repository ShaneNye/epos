// public/js/widgets/topThree.js
console.log("🏆 Top Three Sales Specialists Widget Loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const widgetContainer = document.getElementById("topThreeWidget");
  if (!widgetContainer) {
    console.warn("⚠️ #topThreeWidget container not found");
    return;
  }

  widgetContainer.innerHTML = `<div class="loading">Loading top sales specialists...</div>`;

  try {
    const saved = storageGet?.();
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};

    const res = await fetch("/api/netsuite/widget-sales", { headers });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.results)) {
      throw new Error("Invalid or unexpected response format");
    }

    // Filter today's sales
    const today = new Date().toLocaleDateString("en-GB");
    const todaysOrders = data.results.filter((r) => r.Date === today);

    if (!todaysOrders.length) {
      widgetContainer.innerHTML = `<div class="no-data">No sales found for today.</div>`;
      return;
    }

    // === Group totals by Bed Specialist ===
    const totalsBySpecialist = {};
    todaysOrders.forEach((row) => {
      const specialist = row["Bed Specialist"]?.trim() || "Unassigned";
      const amount = parseFloat(row.Amount) || 0;
      if (!totalsBySpecialist[specialist]) totalsBySpecialist[specialist] = 0;
      totalsBySpecialist[specialist] += amount;
    });

    // === Sort descending by total ===
    const sorted = Object.entries(totalsBySpecialist)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    // === Build table ===
    const table = document.createElement("table");
    table.className = "sales-today-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Rank</th>
          <th>Bed Specialist</th>
          <th>Total (£)</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
          .map(
            (s, i) => `
          <tr>
            <td data-label="Rank" style="text-align:center;">${i + 1}</td>
            <td data-label="Bed Specialist">${s.name}</td>
            <td data-label="Total (£)" style="text-align:right;">${s.total.toFixed(2)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    `;

    // === Insert Table ===
    widgetContainer.innerHTML = `
      <div class="widget-header">🏆 Top 3 Bed Specialists Today</div>
      <div class="table-scroll"></div>
    `;
    widgetContainer.querySelector(".table-scroll").appendChild(table);

  } catch (err) {
    console.error("❌ Failed to load top three specialists:", err);
    widgetContainer.innerHTML = `<div class="error">Error loading top 3 data</div>`;
  }
});
