document.addEventListener("DOMContentLoaded", async () => {
  /* === MAIN TABS === */
  const tabs = document.querySelectorAll("#managementTabs .tab");
  const panels = document.querySelectorAll(".tab-content .tab-panel");

  function setActive(tabName) {
    tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tab === tabName));
    panels.forEach(panel => {
      const active = panel.id === tabName;
      panel.classList.toggle("active", active);
      panel.classList.toggle("hidden", !active);
    });
  }

  tabs.forEach(tab => tab.addEventListener("click", () => setActive(tab.dataset.tab)));
  const firstTab = document.querySelector(".tab.active") || tabs[0];
  if (firstTab) setActive(firstTab.dataset.tab);

  /* === SUBTABS === */
  const subtabs = document.querySelectorAll(".subtab");
  const subContents = document.querySelectorAll(".subtab-content");

  subtabs.forEach(sub => {
    sub.addEventListener("click", () => {
      const name = sub.dataset.subtab;
      subtabs.forEach(s => s.classList.toggle("active", s === sub));
      subContents.forEach(c => c.classList.toggle("hidden", c.id !== name));
    });
  });

  /* === LOAD CURRENT USER & RESOLVE STORE NAME === */
  const saved = localStorage.getItem("eposAuth");
  const parsed = saved ? JSON.parse(saved) : {};
  const headers = parsed.token ? { Authorization: `Bearer ${parsed.token}` } : {};
  let primaryStoreName = null;

  try {
    const meRes = await fetch("/api/me", { headers });
    const meData = await meRes.json();

    if (meData.ok && meData.user?.primaryStore != null) {
      const storeId = meData.user.primaryStore;
      if (isNaN(storeId)) {
        primaryStoreName = String(storeId).trim().toLowerCase();
        console.log("👤 Primary store (string):", primaryStoreName);
      } else {
const storeRes = await fetch(`/api/meta/store/${storeId}`, { headers });        const storeData = await storeRes.json();
        if (storeData.ok && storeData.name) {
          primaryStoreName = storeData.name.trim().toLowerCase();
          console.log("👤 Primary store resolved to:", primaryStoreName);
        } else {
          console.warn("⚠️ Could not resolve store name for ID:", storeId);
        }
      }
    } else {
      console.warn("⚠️ No primaryStore found in /api/me");
    }
  } catch (err) {
    console.warn("⚠️ Failed to load current user for default store:", err);
  }

  /* === FETCH ORDER MANAGEMENT DATA === */
  let allOrders = [];
  try {
const res = await fetch("/api/netsuite/order-management", { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const orders = Array.isArray(data) ? data : data.results || [];
    allOrders = orders;
    console.log(`📦 Loaded ${orders.length} orders from NetSuite`);

    const storeFilter = document.getElementById("storeFilter");
    const stores = [...new Set(orders.map(o => o.Store).filter(Boolean))].sort();

    stores.forEach(store => {
      const opt = document.createElement("option");
      opt.value = store;
      opt.textContent = store;
      storeFilter.appendChild(opt);
    });

    if (primaryStoreName) {
      const matchedStore = stores.find(
        s => s.trim().toLowerCase() === primaryStoreName
      );
      if (matchedStore) {
        storeFilter.value = matchedStore;
        console.log(`✅ Default store set to '${matchedStore}'`);
      } else {
        console.warn(`⚠️ No store match found for '${primaryStoreName}', defaulting to All`);
        storeFilter.value = "all";
      }
    } else {
      storeFilter.value = "all";
    }

    renderTables(orders, storeFilter.value);

    storeFilter.addEventListener("change", () => {
      renderTables(orders, storeFilter.value);
    });

  } catch (err) {
    console.error("❌ Failed to load orders:", err);
    document.querySelector("#readyTable tbody").innerHTML =
      `<tr><td colspan="7">Error loading data</td></tr>`;
    document.querySelector("#pendingTable tbody").innerHTML =
      `<tr><td colspan="7">Error loading data</td></tr>`;
  }

  /* === RENDER FUNCTION === */
  function renderTables(orders, selectedStore) {
    const readyBody = document.querySelector("#readyTable tbody");
    const pendingBody = document.querySelector("#pendingTable tbody");

    const filtered = selectedStore === "all"
      ? orders
      : orders.filter(
          o => o.Store && o.Store.trim().toLowerCase() === selectedStore.trim().toLowerCase()
        );

    const ready = filtered.filter(o => o["Ready For Delivery"] === "Ready for Fulfilment");
    const pending = filtered.filter(o => o["Ready For Delivery"] !== "Ready for Fulfilment");

    // === READY TABLE (updated: Document Number as anchor) ===
    const renderReadyRow = (o) => {
      const docNum = o["Document Number"]
        ? `<a href="/sales/view/${o.ID}" class="doc-link">${o["Document Number"]}</a>`
        : "";
      return `
        <tr>
          <td>${o.Date || ""}</td>
          <td>${o.Name || ""}</td>
          <td>${docNum}</td>
          <td>${o.Store || ""}</td>
          <td>${o["Order Type"] || ""}</td>
          <td>${o["Exported To DT"] === "T" ? "✅" : "❌"}</td>
          <td>${o.Schedule || ""}</td>
        </tr>
      `;
    };

    // === PENDING TABLE (updated: Document Number + Supplier POs) ===
    const renderPendingRow = (o) => {
      const docNum = o["Document Number"]
        ? `<a href="/sales/view/${o.ID}" class="doc-link">${o["Document Number"]}</a>`
        : "";
      const poList = (o["Supplier Po's"] || "")
        .split(",")
        .map(po => po.trim())
        .filter(Boolean)
        .map(po => `<a href="#" class="po-link">${po}</a>`)
        .join("<br>");

      return `
        <tr>
          <td>${o.Date || ""}</td>
          <td>${o.Name || ""}</td>
          <td>${docNum}</td>
          <td>${o.Store || ""}</td>
          <td>${o["Order Type"] || ""}</td>
          <td>${o["Exported To DT"] === "T" ? "✅" : "❌"}</td>
          <td>${poList}</td>
        </tr>
      `;
    };

    readyBody.innerHTML = ready.length
      ? ready.map(renderReadyRow).join("")
      : `<tr><td colspan="7">No ready-for-delivery orders found.</td></tr>`;

    pendingBody.innerHTML = pending.length
      ? pending.map(renderPendingRow).join("")
      : `<tr><td colspan="7">No pending orders found.</td></tr>`;
  }
});
