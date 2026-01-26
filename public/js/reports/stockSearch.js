import { stockSearchPresets } from "/js/reports/stockPresets.js";

document.addEventListener("DOMContentLoaded", async () => {
  console.log("📦 Stock Search (Merged Inventory Data) Loaded");

  const locSelect = document.getElementById("stockLocationSelect");
  const statusSelect = document.getElementById("stockStatusSelect");
  const classSelect = document.getElementById("stockClassSelect"); // ✅ existing
  const titleEl = document.getElementById("stockLocationTitle");
  const filterInput = document.getElementById("stockFilter");
  const tbody = document.getElementById("stockTableBody");
  const scrollWrap = document.querySelector(".stock-table-scroll");

  // ✅ Presets dropdown (we'll inject this)
  let presetSelect = null;

  // ✅ prevents "location change" handler from resetting values when we set them programmatically
  let isApplyingPreset = false;

  if (!classSelect) {
    console.warn(
      "⚠️ #stockClassSelect not found. Add <select id='stockClassSelect'></select> to enable Class filtering."
    );
  }

  /* =====================================================
     Normalisation helpers
  ===================================================== */
  function clean(str) {
    return (str || "").trim().toLowerCase();
  }

  function idStr(val) {
    return val == null ? "" : String(val).trim();
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function norm(val) {
    return val == null ? "" : String(val).trim();
  }

  function getClass(r) {
    // class is stored as className in merged rows (see fetchInventoryData merge)
    return norm(r?.className || r?.Class || r?.class || r?.["Class"] || "");
  }

  /* =====================================================
     PRESETS UI + APPLY
  ===================================================== */
  function injectPresetDropdown() {
    // Try to place near other filters; fallback to body
    const host =
      document.querySelector(".stock-filters") ||
      document.querySelector("#stockFiltersWrap") ||
      document.querySelector(".stock-controls") ||
      (filterInput ? filterInput.parentElement : null) ||
      document.body;

    const wrap = document.createElement("div");
    wrap.className = "stock-preset-wrap";
    wrap.style.margin = "0 0 10px 0";

    wrap.innerHTML = `
      <label for="stockPresetSelect" style="display:block; font-weight:600; margin-bottom:6px;">
        Presets
      </label>
      <select id="stockPresetSelect" style="min-width:240px;">
        <option value="">-- Select preset --</option>
        ${Array.isArray(stockSearchPresets)
          ? stockSearchPresets
              .map(
                (p, i) =>
                  `<option value="${i}">${escapeHtml(
                    p.name || `Preset ${i + 1}`
                  )}</option>`
              )
              .join("")
          : ""}
      </select>
    `;

    // Put it at the top of the host container if possible
    if (host && host.prepend) host.prepend(wrap);
    else document.body.prepend(wrap);

    presetSelect = document.getElementById("stockPresetSelect");
  }

  function presetToMap(preset) {
    const map = {};
    (preset?.filters || []).forEach((f) => {
      const k = clean(f?.filter);
      if (!k) return;
      map[k] = f?.value ?? "";
    });
    return map;
  }

  function safeSetSelectValue(selectEl, wantedValue) {
    if (!selectEl) return;

    // Try direct match first
    selectEl.value = wantedValue;

    // If that didn't match an option, try a case-insensitive option match
    const hasDirect = Array.from(selectEl.options || []).some(
      (o) => String(o.value) === String(wantedValue)
    );

    if (!hasDirect) {
      const wantedClean = clean(wantedValue);
      const opt = Array.from(selectEl.options || []).find(
        (o) =>
          clean(o.value) === wantedClean ||
          clean(o.textContent) === wantedClean
      );
      if (opt) selectEl.value = opt.value;
    }
  }

  function applyPresetByIndex(idx) {
    if (idx === "" || idx == null) return;

    const preset = stockSearchPresets?.[Number(idx)];
    if (!preset) return;

    const m = presetToMap(preset);

    // ✅ lock out "change" handlers from treating this like user input
    isApplyingPreset = true;

    try {
      // Keep the preset selection visible
      if (presetSelect) presetSelect.value = String(idx);

      // Apply Location / Status / Class + clear text filter
      if (m.location != null) safeSetSelectValue(locSelect, m.location);
      if (m.status != null) safeSetSelectValue(statusSelect, m.status);
      if (classSelect && m.class != null) safeSetSelectValue(classSelect, m.class);

      if (filterInput) filterInput.value = "";

      // Update title
      if (titleEl && locSelect) titleEl.textContent = locSelect.value;

      // ✅ DO NOT dispatch locSelect change (your loc change handler resets everything)
      // We can just re-run the existing filter pipeline directly:
      applyFilters();
    } finally {
      // release on next tick so any synchronous handlers don't see it as "user change"
      setTimeout(() => {
        isApplyingPreset = false;
      }, 0);
    }
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
         ✅ Includes Class from invoice-numbers endpoint
      ------------------------------------------------------------------- */
      const numberAgg = {};

      for (const row of numbers) {
        const itemId = idStr(row["Item Id"] || row["Item ID"] || row["itemid"]);
        const inv = clean(row["Number"]);
        const loc = clean(row["Location"]);
        if (!itemId || !inv || !loc) continue;

        const key = `${itemId}||${inv}||${loc}`;

        if (!numberAgg[key]) {
          numberAgg[key] = {
            available: 0,
            onHand: 0,
            itemId,
            itemName: row["Item"] || "",
            invNumberId: row["inv number id"] || "",
            className: norm(row["Class"] || row["class"] || row["CLASS"] || ""),
          };
        }

        numberAgg[key].available += parseInt(row["Available"] || 0, 10) || 0;
        numberAgg[key].onHand += parseInt(row["On Hand"] || 0, 10) || 0;

        if (!numberAgg[key].className) {
          numberAgg[key].className = norm(
            row["Class"] || row["class"] || row["CLASS"] || ""
          );
        }
      }

      /* ------------------------------------------------------------------
         2️⃣ Collapse duplicate inventorybalance rows
      ------------------------------------------------------------------- */
      const collapsed = {};

      for (const bal of balance) {
        const itemId = idStr(
          bal["Item ID"] ||
            bal["Item Id"] ||
            bal["itemid"] ||
            bal["Item"]
        );
        const inv = clean(bal["Inventory Number"]);
        const loc = clean(bal["Location"]);
        if (!itemId || !inv || !loc) continue;

        const key = `${itemId}||${inv}||${loc}`;
        if (!collapsed[key]) collapsed[key] = bal;
      }

      const balanceFinal = Object.values(collapsed);

      /* ------------------------------------------------------------------
         3️⃣ Merge
      ------------------------------------------------------------------- */
      const merged = balanceFinal.map((bal) => {
        const itemId = idStr(
          bal["Item ID"] ||
            bal["Item Id"] ||
            bal["itemid"] ||
            bal["Item"]
        );

        const invClean = clean(bal["Inventory Number"]);
        const locClean = clean(bal["Location"]);
        const rawLoc = bal["Location"] || "-";

        const key = `${itemId}||${invClean}||${locClean}`;

        const agg = numberAgg[key] || {
          available: 0,
          onHand: 0,
          itemId,
          itemName: "",
          invNumberId: "",
          className: "",
        };

        return {
          itemId: agg.itemId || itemId,
          itemName: agg.itemName || bal["Name"] || bal["Item"] || "-",

          inventoryNumber: bal["Inventory Number"] || "-",
          invNumberId: agg.invNumberId || "",

          location: rawLoc,
          bin: bal["Bin Number"] || "-",
          status: bal["Status"] || "-",

          className: agg.className || "",

          available: agg.available,
          onHand: agg.onHand,
        };
      });

      console.log("🧩 Example merged record:", merged[0]);
      console.log(
        "🏷️ Example classes:",
        merged
          .map((r) => r.className)
          .filter((c) => c && c.trim())
          .slice(0, 10)
      );

      return merged;
    } catch (err) {
      console.error("❌ Inventory data load/merge failed:", err);
      return [];
    }
  }

  /* =====================================================
     GROUPING (PRODUCT ROW + EXPAND DETAILS)
  ===================================================== */
  function groupForDisplay(records) {
    const byItem = new Map();

    for (const r of records || []) {
      const itemId = idStr(r.itemId);
      if (!itemId) continue;

      const itemName = r.itemName || "-";
      const inv = r.inventoryNumber || "-";
      const bin = r.bin || "-";
      const status = r.status || "-";
      const available = parseInt(r.available, 10) || 0;
      const onHand = parseInt(r.onHand, 10) || 0;

      if (!byItem.has(itemId)) {
        byItem.set(itemId, {
          itemId,
          itemName,
          totalAvailable: 0,
          totalOnHand: 0,
          lineAgg: new Map(),
        });
      }

      const item = byItem.get(itemId);
      item.totalAvailable += available;
      item.totalOnHand += onHand;

      const lineKey = `${clean(inv)}||${clean(bin)}||${clean(status)}`;
      if (!item.lineAgg.has(lineKey)) {
        item.lineAgg.set(lineKey, {
          inventoryNumber: inv,
          bin,
          status,
          available: 0,
          onHand: 0,
        });
      }
      const line = item.lineAgg.get(lineKey);
      line.available += available;
      line.onHand += onHand;
    }

    const grouped = Array.from(byItem.values()).map((g) => {
      const lines = Array.from(g.lineAgg.values()).sort((a, b) => {
        return (
          clean(a.status).localeCompare(clean(b.status)) ||
          clean(a.bin).localeCompare(clean(b.bin)) ||
          clean(a.inventoryNumber).localeCompare(clean(b.inventoryNumber))
        );
      });

      return {
        itemId: g.itemId,
        itemName: g.itemName,
        totalAvailable: g.totalAvailable,
        totalOnHand: g.totalOnHand,
        lines,
      };
    });

    grouped.sort((a, b) => clean(a.itemName).localeCompare(clean(b.itemName)));
    return grouped;
  }

  /* =====================================================
     LOAD + PREPARE DATA
  ===================================================== */
  const mergedData = await fetchInventoryData();

  // Group by actual location name
  const groupedByLocation = {};
  mergedData.forEach((item) => {
    const loc = item.location || "Unknown";
    if (!groupedByLocation[loc]) groupedByLocation[loc] = [];
    groupedByLocation[loc].push(item);
  });

  const locations = Object.keys(groupedByLocation).sort();

  // Auto-select user's primary store
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

  // Populate location dropdown
  locSelect.innerHTML = locations
    .map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`)
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

  // Populate class dropdown
  if (classSelect) {
    const allClasses = [
      ...new Set(
        mergedData
          .map((r) => getClass(r))
          .filter((c) => c && c.trim())
      ),
    ].sort((a, b) => a.localeCompare(b));

    classSelect.innerHTML = `<option value="">All Classes</option>`;
    allClasses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      classSelect.appendChild(opt);
    });
  }

  // Inject presets dropdown
  injectPresetDropdown();

  if (presetSelect) {
    presetSelect.addEventListener("change", (e) => {
      applyPresetByIndex(e.target.value);
    });
  }

  renderTable(groupedByLocation[defaultLocName] || []);

  /* =====================================================
     EVENT HANDLERS
  ===================================================== */
  locSelect.addEventListener("change", () => {
    const loc = locSelect.value;
    titleEl.textContent = loc;

    // ✅ If this change came from a preset, do NOT reset anything
    if (isApplyingPreset) {
      applyFilters(); // will render using the new location + existing filters
      return;
    }

    // ✅ User-driven change: reset other filters + preset
    filterInput.value = "";
    statusSelect.value = "";
    if (classSelect) classSelect.value = "";
    if (presetSelect) presetSelect.value = ""; // reset preset on manual location change

    renderTable(groupedByLocation[loc] || []);
  });

  filterInput.addEventListener("input", applyFilters);
  statusSelect.addEventListener("change", applyFilters);
  if (classSelect) classSelect.addEventListener("change", applyFilters);

  function applyFilters() {
    const loc = locSelect.value;
    let data = groupedByLocation[loc] || [];

    const text = filterInput.value.trim().toLowerCase();
    const status = statusSelect.value;
    const cls = classSelect ? classSelect.value : "";

    if (text) {
      data = data.filter((r) =>
        Object.values(r).join(" ").toLowerCase().includes(text)
      );
    }

    if (status) {
      data = data.filter((r) => clean(r.status) === clean(status));
    }

    if (cls) {
      data = data.filter((r) => getClass(r) === norm(cls));
    }

    renderTable(data);
  }

  /* =====================================================
     TABLE RENDERER (Grouped + Expand)
  ===================================================== */
  function renderTable(records) {
    tbody.innerHTML = "";

    const visibleDetail = (records || []).filter(
      (r) => (parseInt(r.available, 10) || 0) > 0
    );

    const groupedItems = groupForDisplay(visibleDetail).filter(
      (g) => (parseInt(g.totalAvailable, 10) || 0) > 0
    );

    if (!groupedItems.length) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#999;">No items found</td></tr>`;
      return;
    }

    groupedItems.forEach((g) => {
      const tr = document.createElement("tr");
      tr.className = "stock-item-row";
      tr.dataset.itemId = g.itemId;

      tr.innerHTML = `
        <td class="stock-expander" style="cursor:pointer; width:34px;">➕</td>
        <td>${escapeHtml(g.itemName)}</td>
        <td style="text-align:right; font-weight:600;">${g.totalAvailable}</td>
      `;

      const detailTr = document.createElement("tr");
      detailTr.className = "stock-detail-row";
      detailTr.dataset.itemId = g.itemId;
      detailTr.style.display = "none";

      detailTr.innerHTML = `
        <td colspan="3">
          <div style="padding:10px 12px; border-left:3px solid #ddd;">
            <table style="width:100%; border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="text-align:left; padding:6px 4px;">Lot Number</th>
                  <th style="text-align:left; padding:6px 4px;">Bin</th>
                  <th style="text-align:left; padding:6px 4px;">Status</th>
                  <th style="text-align:right; padding:6px 4px;">Available</th>
                </tr>
              </thead>
              <tbody>
                ${
                  g.lines
                    .filter((l) => (parseInt(l.available, 10) || 0) > 0)
                    .map(
                      (l) => `
                        <tr>
                          <td style="padding:6px 4px;">${escapeHtml(l.inventoryNumber || "—")}</td>
                          <td style="padding:6px 4px;">${escapeHtml(l.bin || "—")}</td>
                          <td style="padding:6px 4px;">${escapeHtml(l.status || "—")}</td>
                          <td style="padding:6px 4px; text-align:right; font-weight:600;">${l.available}</td>
                        </tr>
                      `
                    )
                    .join("")
                }
              </tbody>
            </table>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
      tbody.appendChild(detailTr);

      tr.addEventListener("click", () => {
        const isOpen = detailTr.style.display !== "none";
        detailTr.style.display = isOpen ? "none" : "table-row";
        const exp = tr.querySelector(".stock-expander");
        if (exp) exp.textContent = isOpen ? "➕" : "➖";
      });
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
