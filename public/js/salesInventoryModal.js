// 🧩 Called by popup after Save
window.onInventorySaved = function (itemId, detailString, lineIndex) {
  console.log("──────────────────────────────────────────────");
  console.log(`💾 onInventorySaved() called for item ${itemId}, line ${lineIndex}`);
  console.log("📦 Raw detail string received:", detailString);

  const rows = document.querySelectorAll("#orderItemsBody .order-line");
  const targetRow = rows[lineIndex];
  if (!targetRow) {
    console.warn("⚠️ No matching line found for index", lineIndex);
    return;
  }

  // 🧩 Parse the first inventory detail entry
  const firstPart = detailString?.split(";")[0]?.trim() || "";
  const [qty, locName, locId, statusName, statusId, invName, invId] =
    firstPart.split("|");

  // ✅ Get fulfilment method for this line
  const fulfilSelect = targetRow.querySelector(".item-fulfilment");
  const fulfilMethod = (fulfilSelect?.value || "").trim(); // "1" = In Store, "2" = Warehouse
  console.log("🚚 Line fulfilment method:", fulfilMethod);

  // ✅ Get the main Sales Order warehouse details
  const mainWarehouseSelect = document.getElementById("warehouse");
  const mainWarehouseName =
    mainWarehouseSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
  const mainWarehouseId = mainWarehouseSelect?.value || "";

  // ✅ Get the selected Store details
  const storeSelect = document.getElementById("store");
  const storeName = storeSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
  const storeId = storeSelect?.value || "";

  console.log("🏭 Warehouse / Store Comparison:");
  console.table({
    "SO Warehouse Name": mainWarehouseName,
    "SO Warehouse ID": mainWarehouseId,
    "SO Store Name": storeName,
    "SO Store ID": storeId,
    "Popup Location Name": locName,
    "Popup Location ID": locId,
    "Inventory Name": invName,
    "Inventory ID": invId,
  });

  // ============================================================
  // Decide if the selected inventory is already at the fulfilment location
  //   fulfilMethod = "1"  → compare against STORE
  //   fulfilMethod = "2"  → compare against WAREHOUSE
  // ============================================================
  const locLower = (locName || "").trim().toLowerCase();
  const whLower = mainWarehouseName.trim().toLowerCase();
  const storeLower = storeName.trim().toLowerCase();

  let sameSource = false;

  if (fulfilMethod === "1") {
    // In-Store fulfilment → source matches STORE
    sameSource =
      !!locName &&
      (locLower === storeLower ||
        locLower.includes(storeLower) ||
        storeLower.includes(locLower) ||
        (locId && storeId && String(locId) === String(storeId)));

    console.log(
      `🎯 In-Store fulfilment → sameSource (location vs STORE) = ${
        sameSource ? "✅ TRUE" : "❌ FALSE"
      }`
    );
  } else if (fulfilMethod === "2") {
    // Warehouse fulfilment → source matches WAREHOUSE
    sameSource =
      !!locName &&
      (locLower === whLower ||
        locLower.includes(whLower) ||
        whLower.includes(locLower) ||
        (locId && mainWarehouseId && String(locId) === String(mainWarehouseId)));

    console.log(
      `🎯 Warehouse fulfilment → sameSource (location vs WAREHOUSE) = ${
        sameSource ? "✅ TRUE" : "❌ FALSE"
      }`
    );
  } else {
    // Fallback to old behaviour (compare with warehouse)
    sameSource =
      !!locName &&
      (locLower === whLower ||
        locLower.includes(whLower) ||
        whLower.includes(locLower) ||
        (locId && mainWarehouseId && String(locId) === String(mainWarehouseId)));

    console.log(
      `🎯 Unknown fulfilment → fallback sameSource (vs WAREHOUSE) = ${
        sameSource ? "✅ TRUE" : "❌ FALSE"
      }`
    );
  }

  /* ----------------------------------------------------
     🏭 / 🏪 CASE 1: Same source location
     - In-Store: stock already in STORE
     - Warehouse: stock already in WAREHOUSE
     → Use LOTNUMBER flow (no transfer metadata)
  ---------------------------------------------------- */
  if (sameSource) {
    console.log("✅ Same fulfilment location detected — using custcol_sb_lotnumber flow");
    console.log(`🎯 Storing Inventory Number ID = ${invId}`);

    targetRow.dataset.lotnumber = invId || "";
    targetRow.dataset.inventoryMeta = "";
    targetRow.dataset.invdetail = "";
    targetRow.dataset.inventoryMetaJson = "";

    const cell = targetRow.querySelector(".inventory-cell");
    if (cell) {
      cell.innerHTML = `
        <strong>Lot:</strong> ${invName || "-"}<br>
        <small>ID: ${invId || "-"}</small>
      `;
      cell.classList.add("flash-success");
      setTimeout(() => cell.classList.remove("flash-success"), 800);
    }

    console.log("💾 Final dataset after SAME-SOURCE logic:", {
      lotnumber: targetRow.dataset.lotnumber || "(empty)",
      inventoryMeta: targetRow.dataset.inventoryMeta || "(empty)",
    });

    console.log("──────────────────────────────────────────────");
    return; // ✅ exit here for same-location case
  }

  /* ----------------------------------------------------
     🚚 CASE 2: Different source location
     - In-Store: source != store → NEED TRANSFER
     - Warehouse: source != warehouse → NEED TRANSFER
     → Use EPOS META flow
  ---------------------------------------------------- */
  console.log("📦 Different source location detected — using custcol_sb_epos_inventory_meta flow");

  // 🧹 Clean up the detail string to remove "Store" from location names
  const cleanedDetail = detailString
    .split(";")
    .map((part) => {
      const tokens = part.split("|");
      if (tokens.length > 1 && tokens[1]) {
        tokens[1] = tokens[1].replace(/\bstore\b/gi, "").trim();
      }
      return tokens.join("|");
    })
    .join(";");

  targetRow.dataset.lotnumber = "";
  targetRow.dataset.inventoryMeta = cleanedDetail;
  targetRow.dataset.invdetail = cleanedDetail;

  try {
    const jsonMeta = cleanedDetail.split(";").map((part) => {
      const tokens = part.split("|");
      return {
        qty: tokens[0] || "",
        locationName: (tokens[1] || "").replace(/\bstore\b/gi, "").trim(),
        locationId: tokens[2] || "",
        statusName: tokens[3] || "",
        statusId: tokens[4] || "",
        inventoryNumberName: tokens[5] || "",
        inventoryNumberId: tokens[6] || "",
      };
    });
    targetRow.dataset.inventoryMetaJson = JSON.stringify(jsonMeta);
  } catch (err) {
    console.warn("⚠️ Failed to convert inventory meta to JSON:", err);
  }

  // === Update the visible cell summary
  const cell = targetRow.querySelector(".inventory-cell");
  if (cell) {
    if (cleanedDetail && cleanedDetail.trim() !== "") {
      const display = cleanedDetail
        .split(";")
        .map((part) => {
          const [qty, locName, , , , invName] = part.split("|");
          return `${qty}× ${invName || ""} @ ${locName || ""}`;
        })
        .join("<br>");
      cell.innerHTML = display;
    } else {
      cell.textContent = "—";
    }
    cell.classList.add("flash-success");
    setTimeout(() => cell.classList.remove("flash-success"), 800);
  }

  // ✅ Log for validation
  try {
    const lastEntry = cleanedDetail.split(";").pop().split("|");
    console.log("🧩 Parsed final saved fields:", {
      qty: lastEntry[0],
      locationName: lastEntry[1],
      locationId: lastEntry[2],
      statusName: lastEntry[3],
      statusId: lastEntry[4],
      inventoryName: lastEntry[5],
      inventoryId: lastEntry[6],
    });
  } catch (e) {
    console.warn("⚠️ Could not log parsed fields:", e);
  }

  console.log("💾 Final dataset after TRANSFER logic:", {
    lotnumber: targetRow.dataset.lotnumber || "(empty)",
    inventoryMeta: targetRow.dataset.inventoryMeta || "(empty)",
  });
  console.log("──────────────────────────────────────────────");
};
