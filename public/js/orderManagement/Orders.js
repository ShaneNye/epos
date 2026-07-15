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
  const ordersPanel = document.getElementById("orders");
  const subtabs = ordersPanel?.querySelectorAll(".subtab") || [];
  const subContents = ordersPanel?.querySelectorAll(".subtab-content") || [];

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
  let billedOrders = [];
  let billedSearchTimer = null;
  let billedSearchController = null;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatMoney = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return escapeHtml(value || "");
    return amount.toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
    });
  };

  const setBilledMessage = (message) => {
    const billedBody = document.querySelector("#billedTable tbody");
    if (billedBody) billedBody.innerHTML = `<tr><td colspan="7">${escapeHtml(message)}</td></tr>`;
  };

  const renderBilledTable = (orders, selectedStore, searchTerm = "") => {
    const billedBody = document.querySelector("#billedTable tbody");
    const billedTab = document.querySelector('#orders .subtab[data-subtab="billed"]');
    if (!billedBody) return;

    const query = searchTerm.trim();
    const filtered = orders;

    if (billedTab) billedTab.textContent = `Billed Orders (${filtered.length})`;

    if (query.length < 2) {
      setBilledMessage("Search for a sales order or customer to load billed orders.");
      return;
    }

    billedBody.innerHTML = filtered.length
      ? filtered.map(o => {
          const id = escapeHtml(o.ID || "");
          const doc = escapeHtml(o["Document Number"] || "");
          const docNum = doc && id
            ? `<a href="/sales/view/${id}" class="doc-link">${doc}</a>`
            : doc;
          return `
            <tr>
              <td>${escapeHtml(o.Date || "")}</td>
              <td>${escapeHtml(o.Name || "")}</td>
              <td>${docNum}</td>
              <td>${escapeHtml(o.Store || "")}</td>
              <td>${escapeHtml(o["Order Type"] || "")}</td>
              <td>${escapeHtml(o.Status || "")}</td>
              <td>${formatMoney(o.Amount)}</td>
            </tr>
          `;
        }).join("")
      : `<tr><td colspan="7">No billed orders found for this search.</td></tr>`;
  };

  const loadBilledOrders = async (searchTerm, selectedStore) => {
    const query = searchTerm.trim();
    if (query.length < 2) {
      billedOrders = [];
      renderBilledTable(billedOrders, selectedStore, query);
      return;
    }

    if (billedSearchController) billedSearchController.abort();
    billedSearchController = new AbortController();
    setBilledMessage("Searching billed orders...");

    try {
      const params = new URLSearchParams({ q: query, _: String(Date.now()) });
      const res = await fetch(`/api/netsuite/order-management/billed-orders?${params}`, {
        headers,
        cache: "no-store",
        signal: billedSearchController.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      billedOrders = Array.isArray(data.results) ? data.results : [];
      renderBilledTable(billedOrders, selectedStore, query);
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Failed to load billed orders:", err);
      billedOrders = [];
      setBilledMessage(err.message || "Error loading billed orders.");
      const billedTab = document.querySelector('#orders .subtab[data-subtab="billed"]');
      if (billedTab) billedTab.textContent = "Billed Orders (0)";
    }
  };

  const scheduleBilledSearch = (searchTerm, selectedStore) => {
    clearTimeout(billedSearchTimer);
    billedSearchTimer = setTimeout(() => {
      loadBilledOrders(searchTerm, selectedStore);
    }, 300);
  };

  try {
    const res = await fetch(`/api/netsuite/order-management?refresh=1&_=${Date.now()}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const orders = Array.isArray(data) ? data : data.results || [];
    allOrders = orders;
    console.log(`📦 Loaded ${orders.length} orders from NetSuite`);

    const storeFilter = document.getElementById("storeFilter");
    const orderSearch = document.getElementById("orderSearch");
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

    renderTables(orders, storeFilter.value, orderSearch?.value || "");
    renderBilledTable(billedOrders, storeFilter.value, orderSearch?.value || "");

    storeFilter.addEventListener("change", () => {
      renderTables(orders, storeFilter.value, orderSearch?.value || "");
      renderBilledTable(billedOrders, storeFilter.value, orderSearch?.value || "");
    });

    orderSearch?.addEventListener("input", () => {
      renderTables(orders, storeFilter.value, orderSearch.value);
      scheduleBilledSearch(orderSearch.value, storeFilter.value);
    });

  } catch (err) {
    console.error("❌ Failed to load orders:", err);
    document.querySelector("#readyTable tbody").innerHTML =
      `<tr><td colspan="7">Error loading data</td></tr>`;
    document.querySelector("#pendingTable tbody").innerHTML =
      `<tr><td colspan="7">Error loading data</td></tr>`;
  }

  /* === RENDER FUNCTION === */
  function renderTables(orders, selectedStore, searchTerm = "") {
    const readyBody = document.querySelector("#readyTable tbody");
    const pendingBody = document.querySelector("#pendingTable tbody");
    const query = searchTerm.trim().toLowerCase();

    const storeFiltered = selectedStore === "all"
      ? orders
      : orders.filter(
          o => o.Store && o.Store.trim().toLowerCase() === selectedStore.trim().toLowerCase()
        );

    const filtered = query
      ? storeFiltered.filter(o => {
          const documentNumber = String(o["Document Number"] || "").toLowerCase();
          const customerName = String(o.Name || "").toLowerCase();
          return documentNumber.includes(query) || customerName.includes(query);
        })
      : storeFiltered;

    const ready = filtered.filter(o => o["Ready For Delivery"] === "ready for fulfilment");
    const pending = filtered.filter(o => o["Ready For Delivery"] !== "ready for fulfilment");

    const readyTab = document.querySelector('#orders .subtab[data-subtab="ready"]');
    const pendingTab = document.querySelector('#orders .subtab[data-subtab="pending"]');
    const billedTab = document.querySelector('#orders .subtab[data-subtab="billed"]');
    if (readyTab) readyTab.textContent = `Ready for Delivery (${ready.length})`;
    if (pendingTab) pendingTab.textContent = `Pending Orders (${pending.length})`;
    if (billedTab) billedTab.textContent = `Billed Orders (${billedOrders.length})`;

    // === READY TABLE (updated: Document Number as anchor) ===
    const isOrderOnHold = (order) =>
      String(order?.["Order On Hold?"] || order?.orderOnHold || "").trim().toLowerCase() === "on hold";

    const renderReadyRow = (o) => {
      const docNum = o["Document Number"]
        ? `<a href="/sales/view/${o.ID}" class="doc-link">${o["Document Number"]}</a>`
        : "";
      return `
        <tr class="${isOrderOnHold(o) ? "order-on-hold-row" : ""}">
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
        <tr class="${isOrderOnHold(o) ? "order-on-hold-row" : ""}">
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
