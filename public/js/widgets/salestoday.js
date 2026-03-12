// public/js/widgets/salestoday.js
console.log("📊 Sales Today Widget Loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const widgetContainer = document.getElementById("salesTodayWidget");
  if (!widgetContainer) {
    console.warn("⚠️ #salesTodayWidget container not found");
    return;
  }

  widgetContainer.innerHTML = `<div class="loading">Loading today's sales...</div>`;

  try {
    const saved = storageGet?.();
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};

    const res = await fetch("/api/netsuite/widget-sales", { headers });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.results)) {
      throw new Error("Invalid or unexpected response format");
    }

    const today = new Date().toLocaleDateString("en-GB");
    const todaysOrders = data.results.filter((r) => r.Date === today);

    if (!todaysOrders.length) {
      widgetContainer.innerHTML = `<div class="no-data">No sales found for today.</div>`;
      return;
    }

    // === Group by Document Number ===
    const grouped = {};

    todaysOrders.forEach((row) => {
      const docNum = row["Document Number"];
      const internalId = row.InternalId;
      const amount = parseFloat(row.Amount) || 0;

      if (!grouped[docNum]) {
        grouped[docNum] = {
          docNum,
          internalId,
          store: row.Store,
          specialist: row["Bed Specialist"],
          total: 0,
        };
      }

      grouped[docNum].total += amount;
    });

    const groupedRows = Object.values(grouped);
    const documentCount = groupedRows.length;
    const totalRevenue = groupedRows.reduce((sum, row) => sum + row.total, 0);
    const averageOrderValue = documentCount ? totalRevenue / documentCount : 0;

    // Optional: sort highest value first
    groupedRows.sort((a, b) => b.total - a.total);

    // === Build Table ===
    const table = document.createElement("table");
    table.className = "sales-today-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Document #</th>
          <th>Store</th>
          <th>Bed Specialist</th>
          <th>Total (£)</th>
        </tr>
      </thead>
      <tbody>
        ${groupedRows
          .map(
            (o) => `
          <tr>
            <td data-label="Document #">
              <a href="/sales/view/${encodeURIComponent(o.internalId)}" class="so-link">${o.docNum}</a>
            </td>
            <td data-label="Store">${o.store || ""}</td>
            <td data-label="Bed Specialist">${o.specialist || ""}</td>
            <td data-label="Total (£)" style="text-align:right;">£${o.total.toFixed(2)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    `;

    // === Render Widget ===
    widgetContainer.innerHTML = `
      <div class="widget-header">🛒 Sales Created Today (${documentCount} orders)</div>
      <div class="table-scroll"></div>
      <div class="sales-today-summary">
        <div><strong>Document count:</strong> ${documentCount}</div>
        <div><strong>Total revenue:</strong> £${totalRevenue.toFixed(2)}</div>
        <div><strong>Avg order value:</strong> £${averageOrderValue.toFixed(2)}</div>
      </div>
    `;

    widgetContainer.querySelector(".table-scroll").appendChild(table);
  } catch (err) {
    console.error("❌ Failed to load today's sales:", err);
    widgetContainer.innerHTML = `<div class="error">Error loading sales data</div>`;
  }
});