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
        console.log("👤 Primary store (string):", primaryStoreName);
      } else {
        const storeRes = await fetch(`/api/meta/store/${storeId}`);
        const storeData = await storeRes.json();
        if (storeData.ok && storeData.name) {
          primaryStoreName = storeData.name.trim().toLowerCase();
          console.log("👤 Primary store resolved to:", primaryStoreName);
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Could not resolve current user’s store:", err);
  }

  /* === FETCH INTERCOMPANY PURCHASE ORDERS === */
  let allPOs = [];
  try {
    const res = await fetch("/api/netsuite/intercopurchaseorders");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const results = Array.isArray(data.results) ? data.results : [];
    allPOs = results;
    console.log(`📦 Loaded ${results.length} intercompany POs`);

    const storeFilter = document.getElementById("intercoStoreFilter");
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
        console.log(`✅ Default store set to '${matchedStore}'`);
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
    console.error("❌ Failed to load Intercompany POs:", err);
    document.querySelector("#intercoTable tbody").innerHTML =
      `<tr><td colspan="4">Error loading data</td></tr>`;
  }

  /* === RENDER TABLE === */
  function renderTable(data, selectedStore) {
    const tbody = document.querySelector("#intercoTable tbody");

    const filtered =
      selectedStore === "all"
        ? data
        : data.filter(
            r =>
              r.Store &&
              r.Store.trim().toLowerCase() === selectedStore.trim().toLowerCase()
          );

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="4">No pending intercompany POs for this store.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map(r => {
        return `
          <tr>
            <td>${r["Document Number"] || ""}</td>
            <td>${r["Store"] || ""}</td>
            <td>${r["Fulfilment Centre"] || ""}</td>
            <td>${r["Intercompany Status"] || ""}</td>
          </tr>
        `;
      })
      .join("");
  }
});
