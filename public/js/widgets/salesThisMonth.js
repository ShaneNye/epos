// public/js/widgets/salesthismonth.js
console.log("📊 Sales This Month Widget Loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const widgetContainer = document.getElementById("salesThisMonthWidget");
  if (!widgetContainer) {
    console.warn("⚠️ #salesThisMonthWidget container not found");
    return;
  }

  widgetContainer.innerHTML = `<div class="loading">Loading this month's sales...</div>`;

  try {
    const saved = storageGet?.(); // from storage.js :contentReference[oaicite:0]{index=0}
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};

    // fetch data from backend route (same as Sales Today)
    const res = await fetch(`/api/netsuite/widget-sales?refresh=1&_=${Date.now()}`, {
      headers,
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok || !data.ok || !Array.isArray(data.results)) {
      throw new Error("Invalid or unexpected response format");
    }

    // === Filter only THIS MONTH's sales ===
    // Your Date field is "dd/mm/yyyy" (en-GB)
    const now = new Date();
    const thisMonth = now.getMonth();     // 0-11
    const thisYear = now.getFullYear();   // yyyy

    const monthOrders = data.results.filter((r) => {
      const ds = String(r.Date || "").trim(); // "20/10/2025"
      const [dd, mm, yyyy] = ds.split("/").map(Number);
      if (!dd || !mm || !yyyy) return false;
      return (yyyy === thisYear && (mm - 1) === thisMonth);
    });

    if (!monthOrders.length) {
      widgetContainer.innerHTML = `<div class="no-data">No sales found for this month.</div>`;
      return;
    }

    // === Group by Document Number ===
    const grouped = {};
    monthOrders.forEach((row) => {
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

    // Optional: sort by total desc
    const groupedRows = Object.values(grouped).sort((a, b) => b.total - a.total);

    // === Build Table ===
    const table = document.createElement("table");
    table.className = "sales-month-table";
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
            <td data-label="Total (£)" style="text-align:right;">${o.total.toFixed(2)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    `;

    const monthLabel = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

    widgetContainer.innerHTML = `
      <div class="widget-header">🗓️ Sales This Month (${monthLabel}) — ${groupedRows.length} orders</div>
      <div class="table-scroll"></div>
    `;
    widgetContainer.querySelector(".table-scroll").appendChild(table);
  } catch (err) {
    console.error("❌ Failed to load this month's sales:", err);
    widgetContainer.innerHTML = `<div class="error">Error loading sales data</div>`;
  }
});
