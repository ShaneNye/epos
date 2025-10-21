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

  /* === FETCH CASES === */
  let allCases = [];
  try {
    const res = await fetch("/api/netsuite/case-management");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const cases = Array.isArray(data.results) ? data.results : [];
    allCases = cases;
    console.log(`📋 Loaded ${cases.length} cases from NetSuite`);

    const storeFilter = document.getElementById("caseStoreFilter");
    const stores = [...new Set(cases.map(c => c.Store).filter(Boolean))].sort();

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

    renderTable(cases, storeFilter.value);
    storeFilter.addEventListener("change", () =>
      renderTable(cases, storeFilter.value)
    );
  } catch (err) {
    console.error("❌ Failed to load case data:", err);
    document.querySelector("#caseTable tbody").innerHTML =
      `<tr><td colspan="6">Error loading data</td></tr>`;
  }

  /* === RENDER TABLE === */
  function renderTable(cases, selectedStore) {
    const tbody = document.querySelector("#caseTable tbody");

    const filtered = selectedStore === "all"
      ? cases
      : cases.filter(
          c =>
            c.Store &&
            c.Store.trim().toLowerCase() === selectedStore.trim().toLowerCase()
        );

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6">No cases found for this store.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map(c => {
        // "Case" and "Customer" fields already contain HTML links
        const caseLink = c["Case"] || "";
        const customerLink = c["Customer"] || "";
        return `
          <tr>
            <td>${c["Date"] || ""}</td>
            <td>${caseLink}</td>
            <td>${customerLink}</td>
            <td>${c["Subject"] || ""}</td>
            <td>${c["Status"] || ""}</td>
            <td>${c["Store"] || ""}</td>
          </tr>
        `;
      })
      .join("");
  }
});
