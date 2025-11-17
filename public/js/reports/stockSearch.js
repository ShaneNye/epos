document.addEventListener("DOMContentLoaded", async () => {
  console.log("📦 Stock Search (Merged Inventory Data) Loaded");

  const locSelect = document.getElementById("stockLocationSelect");
  const statusSelect = document.getElementById("stockStatusSelect");
  const titleEl = document.getElementById("stockLocationTitle");
  const filterInput = document.getElementById("stockFilter");
  const tbody = document.getElementById("stockTableBody");
  const scrollWrap = document.querySelector(".stock-table-scroll");

  /* =====================================================
     Normalisation helpers
  ===================================================== */
  function clean(str) {
    return (str || "").trim().toLowerCase();
  }

  function idStr(val) {
    return val == null ? "" : String(val).trim();
  }

  /* =====================================================
     FETCH INVENTORY DATA
  ===================================================== */
  async function fetchInventoryData() {
    try {
      const [balanceRes, numbersRes] = await Promise.all([
        fetch("/api/netsuite/inventorybalance").then((r) => r.json()),
        fetch("/api/netsuite/invoice-numbers").then((r) => r.json()),
      ]);

      if (!balanceRes.ok) throw new Error("Inventory balance fetch failed");
      if (!numbersRes.ok) throw new Error("Inventory numbers fetch failed");

      const balance = balanceRes.results || balanceRes.data || [];
      const numbers = numbersRes.results || numbersRes.data || [];

      console.log(`📊 Loaded ${balance.length} balance rows`);
      console.log(`📦 Loaded ${numbers.length} inventory number rows`);

      /* ------------------------------------------------------------------
         1️⃣ Aggregate invoice-number quantities per (itemId + number + location)
      ------------------------------------------------------------------- */
      const numberAgg = {};

      for (const row of numbers) {
        const itemId = idStr(row["Item Id"] || row["Item ID"] || row["itemid"]);
        const inv = clean(row["Number"]);
        const loc = clean(row["Location"]);
        if (!inv || !loc) continue;

        const key = `${itemId}||${inv}||${loc}`;

        if (!numberAgg[key]) {
          numberAgg[key] = {
            available: 0,
            onHand: 0,
            itemId,
            itemName: row["Item"] || "",
            invNumberId: row["inv number id"] || "",
          };
        }

        numberAgg[key].available += parseInt(row["Available"] || 0, 10) || 0;
        numberAgg[key].onHand += parseInt(row["On Hand"] || 0, 10) || 0;
      }

      /* ------------------------------------------------------------------
         2️⃣ Collapse duplicate inventorybalance rows
         NetSuite gives 1 row per BIN; we want 1 per (item + inventory number + location)
      ------------------------------------------------------------------- */
      const collapsed = {};

      for (const bal of balance) {
        const itemId = idStr(
          bal["Item ID"] ||
            bal["Item Id"] ||
            bal["itemid"] ||
            bal["Item"] // fallback, just in case
        );
        const inv = clean(bal["Inventory Number"]);
        const loc = clean(bal["Location"]);
        const key = `${itemId}||${inv}||${loc}`;

        // keep first matching row only (bin/status come from here)
        if (!collapsed[key]) {
          collapsed[key] = bal;
        }
      }

      const balanceFinal = Object.values(collapsed);

      /* ------------------------------------------------------------------
         3️⃣ Merge: status/bin from balanceFinal, qty from numberAgg
      ------------------------------------------------------------------- */
      const merged = balanceFinal.map((bal) => {
        const itemId = idStr(
          bal["Item ID"] ||
            bal["Item Id"] ||
            bal["itemid"] ||
            bal["Item"]
        );
        const inv = clean(bal["Inventory Number"]);
        const loc = clean(bal["Location"]);
        const rawLoc = bal["Location"] || "-";

        const key = `${itemId}||${inv}||${loc}`;
        const agg = numberAgg[key] || {
          available: 0,
          onHand: 0,
          itemId,
          itemName: "",
          invNumberId: "",
        };

        return {
          itemId: agg.itemId || itemId,
          itemName: agg.itemName || bal["Name"] || bal["Item"] || "-",

          inventoryNumber: bal["Inventory Number"] || "-",
          invNumberId: agg.invNumberId || "",

          location: rawLoc,
          bin: bal["Bin Number"] || "-",
          status: bal["Status"] || "-",

          available: agg.available,
          onHand: agg.onHand,
        };
      });

      console.log("🧩 Example merged record:", merged[0]);

      return merged;
    } catch (err) {
      console.error("❌ Inventory data load/merge failed:", err);
      return [];
    }
  }

  /* =====================================================
     LOAD + PREPARE DATA
  ===================================================== */
  const mergedData = await fetchInventoryData();

  // --- Group by actual location name ---
  const grouped = {};
  mergedData.forEach((item) => {
    const loc = item.location || "Unknown";
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc].push(item);
  });

  const locations = Object.keys(grouped).sort();

  // --- Auto-select user's primary store ---
  const session = storageGet();
  const primaryStoreId =
    session?.user?.location?.id ||
    session?.location_id ||
    session?.user?.location_id ||
    null;

  let defaultLocName = locations[0] || "";

  try {
    if (primaryStoreId) {
      const locRes = await fetch("/api/meta/locations");
      const locJson = await locRes.json();

      if (locJson.ok) {
        const match = locJson.locations.find(
          (l) => String(l.id) === String(primaryStoreId)
        );
        if (match && locations.includes(match.name)) {
          defaultLocName = match.name;
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Failed to map primary store name:", err);
  }

  // Populate the dropdown
  locSelect.innerHTML = locations
    .map((l) => `<option value="${l}">${l}</option>`)
    .join("");
  locSelect.value = defaultLocName;
  titleEl.textContent = defaultLocName;

  // Populate status dropdown
  const allStatuses = [
    ...new Set(mergedData.map((r) => r.status).filter(Boolean)),
  ].sort();
  statusSelect.innerHTML = `<option value="">All Statuses</option>`;
  allStatuses.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    statusSelect.appendChild(opt);
  });

  renderTable(grouped[defaultLocName] || []);

  /* =====================================================
     EVENT HANDLERS
  ===================================================== */
  locSelect.addEventListener("change", () => {
    const loc = locSelect.value;
    titleEl.textContent = loc;
    filterInput.value = "";
    statusSelect.value = "";
    renderTable(grouped[loc] || []);
  });

  filterInput.addEventListener("input", applyFilters);
  statusSelect.addEventListener("change", applyFilters);

  function applyFilters() {
    const loc = locSelect.value;
    let data = grouped[loc] || [];

    const text = filterInput.value.trim().toLowerCase();
    const status = statusSelect.value;

    if (text) {
      data = data.filter((r) =>
        Object.values(r).join(" ").toLowerCase().includes(text)
      );
    }

    if (status) {
      data = data.filter((r) => clean(r.status) === clean(status));
    }

    renderTable(data);
  }

  /* =====================================================
     TABLE RENDERER
  ===================================================== */
 function renderTable(records) {
  tbody.innerHTML = "";

  // ⬅️ NEW: Only show rows where available > 0
  const visible = records.filter(r => (parseInt(r.available, 10) || 0) > 0);

  if (!visible.length) {
    tbody.innerHTML =
      `<tr><td colspan="6" style="text-align:center;color:#999;">No items found</td></tr>`;
    return;
  }

  visible.forEach((r) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${r.itemName}</td>
      <td>${r.inventoryNumber}</td>
      <td>${r.bin}</td>
      <td>${r.status}</td>
      <td style="text-align:right;">${r.available}</td>
    `;

    tbody.appendChild(tr);
  });
}


  /* =====================================================
     SCROLL HEADER SHADOW
  ===================================================== */
  if (scrollWrap) {
    scrollWrap.addEventListener("scroll", () => {
      scrollWrap.classList.toggle("scrolled", scrollWrap.scrollTop > 0);
    });
  }
});
