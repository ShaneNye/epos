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
        const storeRes = await fetch(`/api/meta/store/${storeId}`);
        const storeData = await storeRes.json();
        if (storeData.ok && storeData.name) {
          primaryStoreName = storeData.name.trim().toLowerCase();
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Failed to resolve current user:", err);
  }

  /* === FETCH TRANSFER ORDERS === */
  let allTOs = [];
  try {
    const res = await fetch("/api/netsuite/transfer-order-management");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const results = Array.isArray(data.results) ? data.results : [];
    allTOs = results;
    console.log(`📦 Loaded ${results.length} transfer orders from NetSuite`);

    const storeFilter = document.getElementById("toStoreFilter");
    const stores = [...new Set(results.map(r => r.Store).filter(Boolean))].sort();

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
      } else {
        storeFilter.value = "all";
      }
    } else {
      storeFilter.value = "all";
    }

    renderTable(results, storeFilter.value);

    storeFilter.addEventListener("change", () => {
      renderTable(results, storeFilter.value);
    });
  } catch (err) {
    console.error("❌ Failed to load transfer order data:", err);
    document.querySelector("#toTable tbody").innerHTML =
      `<tr><td colspan="5">Error loading data</td></tr>`;
  }

  /* === RENDER TABLE === */
  function renderTable(data, selectedStore) {
    const tbody = document.querySelector("#toTable tbody");

    const filtered =
      selectedStore === "all"
        ? data
        : data.filter(
            r =>
              r.Store &&
              r.Store.trim().toLowerCase() === selectedStore.trim().toLowerCase()
          );

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5">No transfer orders found for this store.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map(r => {
        const transferNum = r["Transfer number"] || "";
        const comingFrom = r["Coming from"] || "";
        const goingTo = r["Going To"] || "";
        const neededBy = r["Needed By"] || "";
        const relatedSO = r["Related Sales Order"] || "";
        const relatedId = r["Related SO Id"] || "";

        const relatedLink = relatedSO
          ? `<a href="/sales/view/${relatedId}" class="doc-link">${relatedSO}</a>`
          : "";

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
