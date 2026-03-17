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
  const firstTab = document.querySelector("#managementTabs .tab.active") || tabs[0];
  if (firstTab) setActive(firstTab.dataset.tab);

  /* === TRANSFER ORDER SUBTABS === */
  const transferOrderPanel = document.getElementById("transferOrders");
  const transferOrderSubtabs = transferOrderPanel?.querySelectorAll(".subtabs .subtab") || [];
  const transferOrderSubtabContents = transferOrderPanel?.querySelectorAll(".subtab-content") || [];

  function setTransferOrderSubtab(subtabName) {
    transferOrderSubtabs.forEach(subtab => {
      subtab.classList.toggle("active", subtab.dataset.subtab === subtabName);
    });

    transferOrderSubtabContents.forEach(content => {
      const active = content.id === subtabName;
      content.classList.toggle("hidden", !active);
    });
  }

  transferOrderSubtabs.forEach(subtab => {
    subtab.addEventListener("click", () => setTransferOrderSubtab(subtab.dataset.subtab));
  });

  const firstTransferOrderSubtab =
    transferOrderPanel?.querySelector(".subtabs .subtab.active") || transferOrderSubtabs[0];

  if (firstTransferOrderSubtab) {
    setTransferOrderSubtab(firstTransferOrderSubtab.dataset.subtab);
  }

  /* === LOAD CURRENT USER === */
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
      } else {
        const storeRes = await fetch(`/api/meta/store/${storeId}`, { headers });
        const storeData = await storeRes.json();
        if (storeData.ok && storeData.name) {
          primaryStoreName = storeData.name.trim().toLowerCase();
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Failed to resolve current user:", err);
  }

  /* === TABLE REFERENCES === */
  const salesOrdersTbody = document.querySelector("#toSalesOrdersTable tbody");
  const pendingFulfilmentTbody = document.querySelector("#toPendingFulfilmentTable tbody");
  const pendingReceiptTbody = document.querySelector("#toPendingReceiptTable tbody");
  const storeFilter = document.getElementById("toStoreFilter");

  /* === DEFAULT PLACEHOLDERS FOR FUTURE TABS === */
  if (pendingFulfilmentTbody) {
    pendingFulfilmentTbody.innerHTML = `
      <tr>
        <td colspan="5">Pending fulfilment endpoint not connected yet.</td>
      </tr>
    `;
  }

  if (pendingReceiptTbody) {
    pendingReceiptTbody.innerHTML = `
      <tr>
        <td colspan="5">Pending receipt endpoint not connected yet.</td>
      </tr>
    `;
  }

  /* === FETCH TRANSFER ORDERS (CURRENT DATASET = SALES ORDERS TAB) === */
  let allTOs = [];

  try {
    const res = await fetch("/api/netsuite/transfer-order-management", { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    allTOs = results;

    console.log(`📦 Loaded ${results.length} transfer orders from NetSuite`);

    const stores = [...new Set(results.map(r => r.Store).filter(Boolean))].sort();

    if (storeFilter) {
      storeFilter.innerHTML = `<option value="all">All Stores</option>`;

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
        storeFilter.value = matchedStore || "all";
      } else {
        storeFilter.value = "all";
      }

      renderSalesOrdersTable(allTOs, storeFilter.value);

      storeFilter.addEventListener("change", () => {
        renderSalesOrdersTable(allTOs, storeFilter.value);
      });
    } else {
      renderSalesOrdersTable(allTOs, "all");
    }
  } catch (err) {
    console.error("❌ Failed to load transfer order data:", err);

    if (salesOrdersTbody) {
      salesOrdersTbody.innerHTML = `
        <tr>
          <td colspan="5">Error loading data</td>
        </tr>
      `;
    }
  }

  /* === RENDER SALES ORDERS TAB TABLE === */
  function renderSalesOrdersTable(data, selectedStore) {
    if (!salesOrdersTbody) return;

    const filtered =
      selectedStore === "all"
        ? data
        : data.filter(r =>
            r.Store &&
            r.Store.trim().toLowerCase() === selectedStore.trim().toLowerCase()
          );

    if (!filtered.length) {
      salesOrdersTbody.innerHTML = `
        <tr>
          <td colspan="5">No transfer orders found for this store.</td>
        </tr>
      `;
      return;
    }

    salesOrdersTbody.innerHTML = filtered
      .map(r => {
        const transferNum = r["Transfer number"] || "";
        const comingFrom = r["Coming from"] || "";
        const goingTo = r["Going To"] || "";
        const neededBy = r["Needed By"] || "";
        const relatedSO = r["Related Sales Order"] || "";
        const relatedId = r["Related SO Id"] || "";

        const relatedLink =
          relatedSO && relatedId
            ? `<a href="/sales/view/${relatedId}" class="doc-link">${relatedSO}</a>`
            : (relatedSO || "");

        return `
          <tr>
            <td>${transferNum}</td>
            <td>${comingFrom}</td>
            <td>${goingTo}</td>
            <td>${neededBy}</td>
            <td>${relatedLink}</td>
          </tr>
        `;
      })
      .join("");
  }
});