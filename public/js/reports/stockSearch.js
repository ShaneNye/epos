import { stockSearchPresets } from "/js/reports/stockPresets.js";

document.addEventListener("DOMContentLoaded", async () => {
  console.log("📦 Stock Search (Merged Inventory Data) Loaded");

  const ALL_LOC_VALUE = "__ALL__";

  const locSelect = document.getElementById("stockLocationSelect");
  const statusSelect = document.getElementById("stockStatusSelect");
  const classSelect = document.getElementById("stockClassSelect");
  const sizeSelect = document.getElementById("stockSizeSelect");
  const titleEl = document.getElementById("stockLocationTitle");
  const filterInput = document.getElementById("stockFilter");
  const tbody = document.getElementById("stockTableBody");
  const scrollWrap = document.querySelector(".stock-table-scroll");

  // ✅ table header references (so we can add/remove columns)
  const tableEl = tbody?.closest("table") || document.querySelector(".stock-table");
  const thead = tableEl ? tableEl.querySelector("thead") : null;

  // ✅ We'll hide/show this wrapper while loading (best guess selectors)
  const controlsWrap =
    document.querySelector(".stock-controls") ||
    document.querySelector(".stock-filters") ||
    document.querySelector("#stockFiltersWrap");

  // ✅ Presets dropdown (injected)
  let presetSelect = null;

  // ✅ prevents "location change" handler from resetting values when we set them programmatically
  let isApplyingPreset = false;

  // ✅ NEW: PO due-in + SO backorder data maps
  let replenishmentByItemId = new Map(); // itemId -> { totalQty, earliestDateStr }
  let backorderByItemId = new Map(); // itemId -> totalBackorderQty
  let showInboundCols = false; // only show extra cols if any item has any due-in/backorder

  if (!classSelect) {
    console.warn("⚠️ #stockClassSelect not found. Add it to enable Class filtering.");
  }
  if (!sizeSelect) {
    console.warn("⚠️ #stockSizeSelect not found. Add it to enable Size filtering.");
  }
  if (!thead) {
    console.warn("⚠️ Stock table <thead> not found. Header syncing will be skipped.");
  }

  /* =====================================================
     LOADING UI (spinner)
  ===================================================== */
  function setLoading(isLoading, colCount = 3) {
    if (controlsWrap) controlsWrap.style.display = isLoading ? "none" : "";

    if (locSelect) locSelect.disabled = !!isLoading;
    if (statusSelect) statusSelect.disabled = !!isLoading;
    if (classSelect) classSelect.disabled = !!isLoading;
    if (sizeSelect) sizeSelect.disabled = !!isLoading;
    if (filterInput) filterInput.disabled = !!isLoading;
    if (presetSelect) presetSelect.disabled = !!isLoading;

    if (isLoading && tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="${colCount}" style="padding:24px 12px; text-align:center;">
            <div style="display:inline-flex; align-items:center; gap:10px; color:#666; font-weight:600;">
              <span
                aria-hidden="true"
                style="
                  width:18px;
                  height:18px;
                  border:2px solid rgba(0,0,0,0.15);
                  border-top-color:#0081ab;
                  border-radius:50%;
                  display:inline-block;
                  animation: stockSpin 0.8s linear infinite;
                "
              ></span>
              Loading stock…
            </div>
          </td>
        </tr>
      `;
    }

    if (isLoading && !document.getElementById("stockSpinKeyframes")) {
      const style = document.createElement("style");
      style.id = "stockSpinKeyframes";
      style.textContent = `@keyframes stockSpin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }
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
    return norm(r?.className || r?.Class || r?.class || r?.["Class"] || "");
  }

  function getSize(r) {
    return norm(r?.sizeName || r?.Size || r?.size || r?.["Size"] || "");
  }

  function isAllLocationsSelected() {
    return (locSelect?.value || "") === ALL_LOC_VALUE;
  }

  function ddmmyyyyToDate(dateStr) {
    // expects "DD/MM/YYYY"
    const s = norm(dateStr);
    if (!s) return null;
    const parts = s.split("/");
    if (parts.length !== 3) return null;
    const [dd, mm, yyyy] = parts.map((p) => parseInt(p, 10));
    if (!dd || !mm || !yyyy) return null;
    return new Date(yyyy, mm - 1, dd);
  }

  function getColCount(showLocation, showInbound) {
    // expander + item + (location?) + available + (dueIn?) + (bookedIn?)
    let cols = 1 + 1 + 1; // expander, item, available
    if (showLocation) cols += 1;
    if (showInbound) cols += 2;
    return cols;
  }

  /* =====================================================
     TABLE HEADER SYNC
     - Keeps header columns aligned with body columns
  ===================================================== */
  function syncTableHeader(showLocation, showInbound) {
    if (!thead) return;

    const tr =
      thead.querySelector("tr") ||
      (() => {
        const newTr = document.createElement("tr");
        thead.appendChild(newTr);
        return newTr;
      })();

    // Header order matches body:
    // [blank expander] [Item] [Location?] [Available] [Due In (Net)?] [Booked In?]
    tr.innerHTML = `
      <th style="width:34px;"></th>
      <th>Item</th>
      ${showLocation ? `<th>Location</th>` : ``}
      <th style="text-align:right;">Available</th>
      ${
        showInbound
          ? `
            <th style="text-align:right;">Available on Backorder</th>
            <th>Booked In</th>
          `
          : ``
      }
    `;
  }

  /* =====================================================
     PRESETS UI + APPLY
  ===================================================== */
  function injectPresetDropdown() {
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
        ${
          Array.isArray(stockSearchPresets)
            ? stockSearchPresets
                .map(
                  (p, i) =>
                    `<option value="${i}">${escapeHtml(
                      p.name || `Preset ${i + 1}`
                    )}</option>`
                )
                .join("")
            : ""
        }
      </select>
    `;

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

    selectEl.value = wantedValue;

    const hasDirect = Array.from(selectEl.options || []).some(
      (o) => String(o.value) === String(wantedValue)
    );

    if (!hasDirect) {
      const wantedClean = clean(wantedValue);
      const opt = Array.from(selectEl.options || []).find(
        (o) =>
          clean(o.value) === wantedClean || clean(o.textContent) === wantedClean
      );
      if (opt) selectEl.value = opt.value;
    }
  }

  function applyPresetByIndex(idx) {
    if (idx === "" || idx == null) return;

    const preset = stockSearchPresets?.[Number(idx)];
    if (!preset) return;

    const m = presetToMap(preset);
    isApplyingPreset = true;

    try {
      if (presetSelect) presetSelect.value = String(idx);

      if (m.location != null) safeSetSelectValue(locSelect, m.location); // supports "All Locations" by text match
      if (m.status != null) safeSetSelectValue(statusSelect, m.status);
      if (classSelect && m.class != null) safeSetSelectValue(classSelect, m.class);
      if (sizeSelect && m.size != null) safeSetSelectValue(sizeSelect, m.size);

      if (filterInput) filterInput.value = "";

      if (titleEl && locSelect) {
        titleEl.textContent = isAllLocationsSelected()
          ? "All Locations"
          : locSelect.value;
      }

      // Header can change depending on location selection (All Locations)
      syncTableHeader(isAllLocationsSelected(), showInboundCols);

      applyFilters();
    } finally {
      setTimeout(() => {
        isApplyingPreset = false;
      }, 0);
    }
  }

  /* =====================================================
     FETCH INVENTORY DATA (existing)
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

      // 1) Aggregate invoice-number quantities per (itemId + number + location)
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
            sizeName: norm(row["Size"] || row["size"] || row["SIZE"] || ""),
          };
        }

        numberAgg[key].available += parseInt(row["Available"] || 0, 10) || 0;
        numberAgg[key].onHand += parseInt(row["On Hand"] || 0, 10) || 0;

        if (!numberAgg[key].className) {
          numberAgg[key].className = norm(
            row["Class"] || row["class"] || row["CLASS"] || ""
          );
        }
        if (!numberAgg[key].sizeName) {
          numberAgg[key].sizeName = norm(
            row["Size"] || row["size"] || row["SIZE"] || ""
          );
        }
      }

      // 2) Collapse duplicate inventorybalance rows
      const collapsed = {};

      for (const bal of balance) {
        const itemId = idStr(
          bal["Item ID"] || bal["Item Id"] || bal["itemid"] || bal["Item"]
        );
        const inv = clean(bal["Inventory Number"]);
        const loc = clean(bal["Location"]);
        if (!itemId || !inv || !loc) continue;

        const key = `${itemId}||${inv}||${loc}`;
        if (!collapsed[key]) collapsed[key] = bal;
      }

      const balanceFinal = Object.values(collapsed);

      // 3) Merge
      const merged = balanceFinal.map((bal) => {
        const itemId = idStr(
          bal["Item ID"] || bal["Item Id"] || bal["itemid"] || bal["Item"]
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
          sizeName: "",
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
          sizeName: agg.sizeName || "",

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
     FETCH INBOUND / BACKORDER DATA (✅ NEW)
  ===================================================== */
  async function fetchInboundAndBackorder() {
    try {
      const [replJson, backJson] = await Promise.all([
        fetch("/api/netsuite/stock-replenishment").then((r) => r.json()),
        fetch("/api/netsuite/quantity-backordered").then((r) => r.json()),
      ]);

      if (!replJson?.ok) {
        console.warn("⚠️ stock-replenishment returned not ok");
      }
      if (!backJson?.ok) {
        console.warn("⚠️ quantity-backordered returned not ok");
      }

      const replRows = replJson?.results || replJson?.data || [];
      const backRows = backJson?.results || backJson?.data || [];

      // Replenishment: sum Quantity by Internal ID + track earliest Booked In Date
      const replMap = new Map();
      for (const row of replRows) {
        const itemId = idStr(row["Internal ID"] || row["Internal Id"] || row["internalid"]);
        if (!itemId) continue;

        const qty = parseInt(row["Quantity"] || 0, 10) || 0;
        const bookedStr = norm(row["Booked In Date"] || row["Booked in Date"] || row["BookedInDate"] || "");

        if (!replMap.has(itemId)) {
          replMap.set(itemId, { totalQty: 0, earliestDateStr: "" });
        }

        const v = replMap.get(itemId);
        v.totalQty += qty;

        // earliest non-null date
        const d = ddmmyyyyToDate(bookedStr);
        if (d) {
          const cur = ddmmyyyyToDate(v.earliestDateStr);
          if (!cur || d < cur) v.earliestDateStr = bookedStr;
        }
      }

      // Backorder: sum Quantity On Backorder by Internal ID
      const backMap = new Map();
      for (const row of backRows) {
        const itemId = idStr(row["Internal ID"] || row["Internal Id"] || row["internalid"]);
        if (!itemId) continue;

        const qty = parseInt(row["Quantity On Backorder"] || 0, 10) || 0;
        if (!backMap.has(itemId)) backMap.set(itemId, 0);
        backMap.set(itemId, backMap.get(itemId) + qty);
      }

      // Should we show the extra columns at all?
      let any = false;
      for (const [, v] of replMap) {
        if ((parseInt(v.totalQty, 10) || 0) !== 0) {
          any = true;
          break;
        }
      }
      if (!any) {
        for (const [, v] of backMap) {
          if ((parseInt(v, 10) || 0) !== 0) {
            any = true;
            break;
          }
        }
      }

      return { replMap, backMap, any };
    } catch (err) {
      console.warn("⚠️ Failed to fetch inbound/backorder data:", err);
      return { replMap: new Map(), backMap: new Map(), any: false };
    }
  }

  /* =====================================================
     GROUPING (PRODUCT ROW + EXPAND DETAILS)
     - If "All Locations": group by itemId + location
     - Otherwise: group by itemId only
     - Adds inbound/backorder to summary ONLY (does not affect detail lines)
  ===================================================== */
  function groupForDisplay(records, showLocation) {
    const byKey = new Map();

    for (const r of records || []) {
      const itemId = idStr(r.itemId);
      if (!itemId) continue;

      const itemName = r.itemName || "-";
      const locName = r.location || "Unknown";

      const inv = r.inventoryNumber || "-";
      const bin = r.bin || "-";
      const status = r.status || "-";
      const available = parseInt(r.available, 10) || 0;
      const onHand = parseInt(r.onHand, 10) || 0;

      const key = showLocation ? `${itemId}||${clean(locName)}` : itemId;

      if (!byKey.has(key)) {
        byKey.set(key, {
          itemId,
          itemName,
          location: locName,
          totalAvailable: 0,
          totalOnHand: 0,
          lineAgg: new Map(), // key = inv||bin||status
        });
      }

      const g = byKey.get(key);
      g.totalAvailable += available;
      g.totalOnHand += onHand;

      const lineKey = `${clean(inv)}||${clean(bin)}||${clean(status)}`;
      if (!g.lineAgg.has(lineKey)) {
        g.lineAgg.set(lineKey, {
          inventoryNumber: inv,
          bin,
          status,
          available: 0,
          onHand: 0,
        });
      }
      const line = g.lineAgg.get(lineKey);
      line.available += available;
      line.onHand += onHand;
    }

    const grouped = Array.from(byKey.values()).map((g) => {
      const lines = Array.from(g.lineAgg.values()).sort((a, b) => {
        return (
          clean(a.status).localeCompare(clean(b.status)) ||
          clean(a.bin).localeCompare(clean(b.bin)) ||
          clean(a.inventoryNumber).localeCompare(clean(b.inventoryNumber))
        );
      });

      // ✅ inbound/backorder summary values (do NOT touch detail lines)
      const repl = replenishmentByItemId.get(g.itemId) || { totalQty: 0, earliestDateStr: "" };
      const back = backorderByItemId.get(g.itemId) || 0;

      const dueIn = parseInt(repl.totalQty, 10) || 0;
      const backQty = parseInt(back, 10) || 0;

      // "Due In (Net)" = dueIn - backorder (not below 0)
      const dueInNet = Math.max(0, dueIn - backQty);

      return {
        itemId: g.itemId,
        itemName: g.itemName,
        location: g.location,
        totalAvailable: g.totalAvailable,
        totalOnHand: g.totalOnHand,
        lines,

        // ✅ new summary-only fields
        dueInNet,
        bookedInDate: repl.earliestDateStr || "",
      };
    });

    grouped.sort((a, b) => {
      const n = clean(a.itemName).localeCompare(clean(b.itemName));
      if (n !== 0) return n;
      return showLocation
        ? clean(a.location).localeCompare(clean(b.location))
        : 0;
    });

    return grouped;
  }

  /* =====================================================
     START LOADING
  ===================================================== */
  // initial spinner (we’ll correct colspan after we know columns)
  setLoading(true, 3);

  // Fetch everything
  const [mergedData, inbound] = await Promise.all([
    fetchInventoryData(),
    fetchInboundAndBackorder(),
  ]);

  replenishmentByItemId = inbound.replMap;
  backorderByItemId = inbound.backMap;
  showInboundCols = !!inbound.any;

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

  // Populate location dropdown (includes All Locations)
  if (locSelect) {
    const locOptions = [
      `<option value="${ALL_LOC_VALUE}">All Locations</option>`,
      ...locations.map(
        (l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`
      ),
    ];
    locSelect.innerHTML = locOptions.join("");

    // default to primary store if available, else first store, else All
    if (defaultLocName && locations.includes(defaultLocName)) locSelect.value = defaultLocName;
    else if (locations.length) locSelect.value = locations[0];
    else locSelect.value = ALL_LOC_VALUE;
  }

  // Populate status dropdown
  if (statusSelect) {
    const allStatuses = [...new Set(mergedData.map((r) => r.status).filter(Boolean))].sort();
    statusSelect.innerHTML = `<option value="">All Statuses</option>`;
    allStatuses.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      statusSelect.appendChild(opt);
    });
  }

  // Populate class dropdown
  if (classSelect) {
    const allClasses = [
      ...new Set(mergedData.map((r) => getClass(r)).filter((c) => c && c.trim())),
    ].sort((a, b) => a.localeCompare(b));
    classSelect.innerHTML = `<option value="">All Classes</option>`;
    allClasses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      classSelect.appendChild(opt);
    });
  }

  // Populate size dropdown
  if (sizeSelect) {
    const allSizes = [
      ...new Set(mergedData.map((r) => getSize(r)).filter((s) => s && s.trim())),
    ].sort((a, b) => a.localeCompare(b));
    sizeSelect.innerHTML = `<option value="">All Sizes</option>`;
    allSizes.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      sizeSelect.appendChild(opt);
    });
  }

  // Inject presets dropdown
  injectPresetDropdown();
  if (presetSelect) {
    presetSelect.addEventListener("change", (e) => {
      applyPresetByIndex(e.target.value);
    });
  }

  // ✅ Sync header now that we know whether inbound cols exist + current location mode
  syncTableHeader(isAllLocationsSelected(), showInboundCols);

  // Title
  if (titleEl) {
    titleEl.textContent = isAllLocationsSelected()
      ? "All Locations"
      : (locSelect?.value || "");
  }

  function getBaseDataForCurrentLocation() {
    if (isAllLocationsSelected()) return mergedData;
    const loc = locSelect?.value;
    return groupedByLocation[loc] || [];
  }

  // First render
  renderTable(getBaseDataForCurrentLocation());

  // Loading finished
  setLoading(false, getColCount(isAllLocationsSelected(), showInboundCols));

  /* =====================================================
     EVENT HANDLERS
  ===================================================== */
  if (locSelect) {
    locSelect.addEventListener("change", () => {
      const showAll = isAllLocationsSelected();

      // header changes when switching all-locations mode
      syncTableHeader(showAll, showInboundCols);

      if (titleEl) titleEl.textContent = showAll ? "All Locations" : locSelect.value;

      if (isApplyingPreset) {
        applyFilters();
        return;
      }

      // User-driven change: reset other filters + preset
      if (filterInput) filterInput.value = "";
      if (statusSelect) statusSelect.value = "";
      if (classSelect) classSelect.value = "";
      if (sizeSelect) sizeSelect.value = "";
      if (presetSelect) presetSelect.value = "";

      renderTable(getBaseDataForCurrentLocation());
    });
  }

  if (filterInput) filterInput.addEventListener("input", applyFilters);
  if (statusSelect) statusSelect.addEventListener("change", applyFilters);
  if (classSelect) classSelect.addEventListener("change", applyFilters);
  if (sizeSelect) sizeSelect.addEventListener("change", applyFilters);

  function applyFilters() {
    let data = getBaseDataForCurrentLocation();

    const text = filterInput?.value?.trim().toLowerCase() || "";
    const status = statusSelect?.value || "";
    const cls = classSelect ? classSelect.value : "";
    const size = sizeSelect ? sizeSelect.value : "";

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

    if (size) {
      data = data.filter((r) => getSize(r) === norm(size));
    }

    renderTable(data);
  }

  /* =====================================================
     TABLE RENDERER (Grouped + Expand)
     - All Locations adds Location column
     - Inbound/backorder adds Due In (Net) + Booked In columns (summary ONLY)
     - Detail table unchanged
  ===================================================== */
  function renderTable(records) {
    tbody.innerHTML = "";

    const showLocation = isAllLocationsSelected();
    const colCount = getColCount(showLocation, showInboundCols);

    const visibleDetail = (records || []).filter(
      (r) => (parseInt(r.available, 10) || 0) > 0
    );

    const groupedItems = groupForDisplay(visibleDetail, showLocation).filter(
      (g) => (parseInt(g.totalAvailable, 10) || 0) > 0
    );

    if (!groupedItems.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:#999;">No items found</td></tr>`;
      return;
    }

    groupedItems.forEach((g) => {
      const tr = document.createElement("tr");
      tr.className = "stock-item-row";
      tr.dataset.itemId = g.itemId;

      const availTd = `<td style="text-align:right; font-weight:600;">${g.totalAvailable}</td>`;
      const dueInTd = showInboundCols
        ? `<td style="text-align:right; font-weight:600;">${g.dueInNet || 0}</td>`
        : "";
      const bookedTd = showInboundCols
        ? `<td>${escapeHtml(g.bookedInDate || "")}</td>`
        : "";

      tr.innerHTML = `
        <td class="stock-expander" style="cursor:pointer; width:34px;">➕</td>
        <td>${escapeHtml(g.itemName)}</td>
        ${showLocation ? `<td>${escapeHtml(g.location || "Unknown")}</td>` : ``}
        ${availTd}
        ${dueInTd}
        ${bookedTd}
      `;

      // Details row (hidden) - unchanged columns inside
      const detailTr = document.createElement("tr");
      detailTr.className = "stock-detail-row";
      detailTr.dataset.itemId = g.itemId;
      detailTr.style.display = "none";

      detailTr.innerHTML = `
        <td colspan="${colCount}">
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
