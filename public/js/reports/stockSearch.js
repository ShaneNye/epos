document.addEventListener("DOMContentLoaded", async () => {
  console.log("📦 Stock Search (Merged Inventory Data) Loaded");

  const locSelect = document.getElementById("stockLocationSelect");
  const statusSelect = document.getElementById("stockStatusSelect");
  const titleEl = document.getElementById("stockLocationTitle");
  const filterInput = document.getElementById("stockFilter");
  const tbody = document.getElementById("stockTableBody");
  const scrollWrap = document.querySelector(".stock-table-scroll");

  /* =====================================================
     FETCH INVENTORY DATA
  ===================================================== */
  async function fetchInventoryData() {
    try {
      const [balanceRes, numbersRes] = await Promise.all([
        fetch("/api/netsuite/inventorybalance").then(r => r.json()),
        fetch("/api/netsuite/invoice-numbers").then(r => r.json())
      ]);

      if (!balanceRes.ok) throw new Error("Inventory balance fetch failed");
      if (!numbersRes.ok) throw new Error("Invoice numbers fetch failed");

      const balance = balanceRes.results || [];
      const numbers = numbersRes.results || [];

      console.log(`📊 Loaded ${balance.length} inventory balance records`);
      console.log(`📦 Loaded ${numbers.length} live number records`);

      // --- Merge them on Inventory Number ---
      const merged = balance.map(bal => {
        const balNum = (bal["Inventory Number"] || "").trim().toLowerCase();
        const match = numbers.find(num => 
          (num["Number"] || "").trim().toLowerCase() === balNum
        );

        const available = match ? parseInt(match["Available"] || 0, 10) : 0;
        const onHand = match ? parseInt(match["On Hand"] || 0, 10) : 0;

        return {
          itemId: bal["Item ID"] || "",
          itemName: bal["Name"] || bal["Item"] || "-",
          bin: bal["Bin Number"] || "-",
          location: bal["Location"] || "-",
          inventoryNumber: bal["Inventory Number"] || "-",
          status: bal["Status"] || "-",
          available,
          onHand
        };
      });

      console.log("🧩 Example merged record:", merged[0]);
      return merged;
    } catch (err) {
      console.error("❌ Failed to fetch or merge inventory data:", err);
      return [];
    }
  }

  /* =====================================================
     LOAD + PREPARE DATA
  ===================================================== */
  const mergedData = await fetchInventoryData();

  // Group by location
  const grouped = {};
  mergedData.forEach(item => {
    const loc = item.location || "Unknown";
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc].push(item);
  });

  const locations = Object.keys(grouped).sort();
  locSelect.innerHTML = locations.map(l => `<option value="${l}">${l}</option>`).join("");
  titleEl.textContent = locations[0] || "";

  // Populate status dropdown
  const allStatuses = [...new Set(mergedData.map(r => r.status).filter(Boolean))].sort();
  statusSelect.innerHTML = `<option value="">All Statuses</option>`;
  allStatuses.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    statusSelect.appendChild(opt);
  });

  renderTable(grouped[locations[0]] || []);

  /* =====================================================
     EVENT HANDLERS
  ===================================================== */
  locSelect.addEventListener("change", () => {
    const selectedLoc = locSelect.value;
    titleEl.textContent = selectedLoc;
    filterInput.value = "";
    statusSelect.value = "";
    renderTable(grouped[selectedLoc] || []);
  });

  filterInput.addEventListener("input", applyFilters);
  statusSelect.addEventListener("change", applyFilters);

  function applyFilters() {
    const selectedLoc = locSelect.value;
    const records = grouped[selectedLoc] || [];
    const textFilter = filterInput.value.trim().toLowerCase();
    const statusFilter = statusSelect.value;
    renderTable(records, textFilter, statusFilter);
  }

  /* =====================================================
     TABLE RENDERER
  ===================================================== */
  function renderTable(records, textFilter = "", statusFilter = "") {
    tbody.innerHTML = "";

    let filtered = records;
    if (textFilter) {
      filtered = filtered.filter(r =>
        Object.values(r).join(" ").toLowerCase().includes(textFilter)
      );
    }

    if (statusFilter) {
      filtered = filtered.filter(r => (r.status || "").trim() === statusFilter);
    }

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#999;">No items found</td></tr>`;
      return;
    }

    filtered.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.itemName}</td>
        <td>${r.inventoryNumber}</td>
        <td>${r.bin}</td>
        <td>${r.status}</td>
        <td style="text-align:right;">${r.available || 0}</td>
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
