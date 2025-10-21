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
  const subtabs = document.querySelectorAll("#quotes .subtab");
  const subContents = document.querySelectorAll("#quotes .subtab-content");

  subtabs.forEach(sub => {
    sub.addEventListener("click", () => {
      const name = sub.dataset.subtab;
      subtabs.forEach(s => s.classList.toggle("active", s === sub));
      subContents.forEach(c => c.classList.toggle("hidden", c.id !== name));
    });
  });

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

  /* === FETCH QUOTES === */
  let allQuotes = [];
  try {
    const res = await fetch("/api/netsuite/quote-management");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const quotes = Array.isArray(data.results) ? data.results : [];
    allQuotes = quotes;
    console.log(`📄 Loaded ${quotes.length} quotes from NetSuite`);

    const storeFilter = document.getElementById("quoteStoreFilter");
    const stores = [...new Set(quotes.map(q => q.Store).filter(Boolean))].sort();

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

    renderTables(quotes, storeFilter.value);

    storeFilter.addEventListener("change", () => {
      renderTables(quotes, storeFilter.value);
    });

  } catch (err) {
    console.error("❌ Failed to load quotes:", err);
    document.querySelector("#openQuotes tbody").innerHTML =
      `<tr><td colspan="5">Error loading quotes</td></tr>`;
    document.querySelector("#expiredQuotes tbody").innerHTML =
      `<tr><td colspan="5">Error loading quotes</td></tr>`;
  }

  /* === RENDER TABLES === */
  function renderTables(quotes, selectedStore) {
    const openBody = document.querySelector("#openQuotes tbody");
    const expiredBody = document.querySelector("#expiredQuotes tbody");

    const filtered = selectedStore === "all"
      ? quotes
      : quotes.filter(
          q => q.Store && q.Store.trim().toLowerCase() === selectedStore.trim().toLowerCase()
        );

    const open = filtered.filter(q => q.Status?.toLowerCase() === "open");
    const expired = filtered.filter(q => q.Status?.toLowerCase() === "expired");

    const renderRow = (q) => {
      const docNum = q["Document Number"]
        ? `<a href="/sales/view/${q["Internal ID"]}" class="doc-link">${q["Document Number"]}</a>`
        : "";
      return `
        <tr>
          <td>${q["Due Date"] || ""}</td>
          <td>${docNum}</td>
          <td>${q["Bed Specialist"] || ""}</td>
          <td>${q["Store"] || ""}</td>
          <td>${q["Status"] || ""}</td>
        </tr>
      `;
    };

    openBody.innerHTML = open.length
      ? open.map(renderRow).join("")
      : `<tr><td colspan="5">No open quotes found.</td></tr>`;

    expiredBody.innerHTML = expired.length
      ? expired.map(renderRow).join("")
      : `<tr><td colspan="5">No expired quotes found.</td></tr>`;
  }
});
