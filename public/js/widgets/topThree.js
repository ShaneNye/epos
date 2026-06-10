// public/js/widgets/topThree.js
console.log("Top Three Sales Specialists Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widgetContainer = document.getElementById("topThreeWidget");
  if (!widgetContainer) {
    console.warn("#topThreeWidget container not found");
    return;
  }

  function getRange() {
    return window.DashboardDateFilter?.getRange() || {
      label: "Today",
      start: new Date(),
      end: new Date(),
    };
  }

  async function loadTopThree() {
    const range = getRange();
    widgetContainer.innerHTML = `<div class="loading">Loading top sales specialists...</div>`;

    try {
      const saved = storageGet?.();
      const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};

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
          <div class="widget-header">Top 3 Bed Specialists</div>
          <div class="no-data">No sales found for ${range.label.toLowerCase()}.</div>
        `;
        return;
      }

      const totalsBySpecialist = {};
      orders.forEach((row) => {
        const specialist = row["Bed Specialist"]?.trim() || "Unassigned";
        const amount = parseFloat(row.Amount) || 0;
        totalsBySpecialist[specialist] = (totalsBySpecialist[specialist] || 0) + amount;
      });

      const sorted = Object.entries(totalsBySpecialist)
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      const table = document.createElement("table");
      table.className = "sales-today-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th>Rank</th>
            <th>Bed Specialist</th>
            <th>Total (\u00a3)</th>
          </tr>
        </thead>
        <tbody>
          ${sorted
            .map(
              (s, i) => `
            <tr>
              <td data-label="Rank" style="text-align:center;">${i + 1}</td>
              <td data-label="Bed Specialist">${s.name}</td>
              <td data-label="Total (\u00a3)" style="text-align:right;">${s.total.toFixed(2)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      `;

      widgetContainer.innerHTML = `
        <div class="widget-header">Top 3 Bed Specialists</div>
        <div class="table-scroll"></div>
      `;
      widgetContainer.querySelector(".table-scroll").appendChild(table);
    } catch (err) {
      console.error("Failed to load top three specialists:", err);
      widgetContainer.innerHTML = `<div class="error">Error loading top 3 data</div>`;
    }
  }

  window.addEventListener("dashboard:date-range-change", loadTopThree);
  loadTopThree();
});
