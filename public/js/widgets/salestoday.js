// public/js/widgets/salestoday.js
console.log("📊 Sales Today Widget Loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const widgetContainer = document.getElementById("salesTodayWidget");
  if (!widgetContainer) {
    console.warn("⚠️ #salesTodayWidget container not found");
    return;
  }

  // show loading message
  widgetContainer.innerHTML = `<div class="loading">Loading today's sales...</div>`;

  try {
    const saved = storageGet?.();
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};

    // fetch data from backend route
    const res = await fetch("/api/netsuite/widget-sales", { headers });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.results)) {
      throw new Error("Invalid or unexpected response format");
    }

    // Filter only today's sales
    const today = new Date().toLocaleDateString("en-GB"); // e.g. "20/10/2025"
    const todaysOrders = data.results.filter((r) => r.Date === today);

    if (!todaysOrders.length) {
      widgetContainer.innerHTML = `<div class="no-data">No sales found for today.</div>`;
      return;
    }

    // === Group by Document Number ===
    const grouped = {};
    todaysOrders.forEach((row) => {
      const docNum = row["Document Number"];
      const amount = parseFloat(row.Amount) || 0;

      if (!grouped[docNum]) {
        grouped[docNum] = {
          docNum,
          store: row.Store,
          specialist: row["Bed Specialist"],
          total: 0,
        };
      }
      grouped[docNum].total += amount;
    });

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
        ${Object.values(grouped)
          .map(
            (o) => `
          <tr>
            <td data-label="Document #">
              <a href="https://7972741-sb1.app.netsuite.com/app/accounting/transactions/salesord.nl?tranid=${encodeURIComponent(
                o.docNum
              )}" target="_blank">${o.docNum}</a>
            </td>
            <td data-label="Store">${o.store}</td>
            <td data-label="Bed Specialist">${o.specialist}</td>
            <td data-label="Total (£)" style="text-align:right;">${o.total.toFixed(2)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    `;

    // === Insert Table into Widget ===
    widgetContainer.innerHTML = `
      <div class="widget-header">🛒 Sales Created Today (${Object.keys(grouped).length} orders)</div>
      <div class="table-scroll"></div>
    `;
    widgetContainer.querySelector(".table-scroll").appendChild(table);
  } catch (err) {
    console.error("❌ Failed to load today's sales:", err);
    widgetContainer.innerHTML = `<div class="error">Error loading sales data</div>`;
  }
});
