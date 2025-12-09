// public/js/salesInventoryModal.js
console.log("✅ salesInventoryModal.js loaded");

// 🧭 When user clicks the inventory cell or icon
document.addEventListener("click", (e) => {
  if (
    e.target.classList.contains("open-inventory") ||
    e.target.closest(".inventory-cell")
  ) {
    const row = e.target.closest(".order-line");

    // 🔥 FIXED INDEX LOGIC — works for all rows
    const rows = document.querySelectorAll("#orderItemsBody .order-line");
    const lineIndex = Array.prototype.indexOf.call(rows, row);

    if (lineIndex === -1) {
      console.warn("⚠️ Could not determine lineIndex for inventory popup");
      return;
    }

    const itemId = row.querySelector(".item-internal-id")?.value?.trim();
    const qty = row.querySelector(".item-qty")?.value?.trim() || "0";
    const detail = row.dataset.invdetail || "";

    if (!itemId) {
      alert("Please select an item before allocating inventory.");
      return;
    }

    const url = `/inventory.html?itemId=${encodeURIComponent(
      itemId
    )}&qty=${encodeURIComponent(qty)}&detail=${encodeURIComponent(
      detail
    )}&line=${lineIndex}`;

    console.log("📦 Opening Inventory Detail popup:", url);

    const win = window.open(
      url,
      "InventoryDetail",
      "width=900,height=700,resizable=yes,scrollbars=yes"
    );
    if (win) win.focus();
  }
});

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
      `🎯 In-Store fulfilment → sameSource = ${sameSource ? "✅ TRUE" : "❌ FALSE"}`
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
      `🎯 Warehouse fulfilment → sameSource = ${sameSource ? "✅ TRUE" : "❌ FALSE"}`
    );
  }

  /* ----------------------------------------------------
     CASE 1: Same location → LOTNUMBER (NO TRANSFER)
  ---------------------------------------------------- */
  if (sameSource) {
    console.log("✅ Same fulfilment location — using LOTNUMBER flow");

    targetRow.dataset.lotnumber = invId || "";
    targetRow.dataset.inventoryMeta = "";
    targetRow.dataset.invdetail = "";
    targetRow.dataset.inventoryMetaJson = "";

    const cell = targetRow.querySelector(".inventory-cell");
    if (cell) {
      cell.innerHTML = `
        <strong>Lot:</strong> ${invName || "-"}<br>
        <small>ID: ${invId || "-"}</small>`;
      cell.classList.add("flash-success");
      setTimeout(() => cell.classList.remove("flash-success"), 800);
    }

    return;
  }

  /* ----------------------------------------------------
     CASE 2: Different location → EPOS META (TRANSFER REQUIRED)
  ---------------------------------------------------- */
  console.log("📦 Different source location — using EPOS META flow");

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

  const cell = targetRow.querySelector(".inventory-cell");
  if (cell) {
    const display = cleanedDetail
      .split(";")
      .map((part) => {
        const [qty, locName, , , , invName] = part.split("|");
        return `${qty}× ${invName || ""} @ ${locName || ""}`;
      })
      .join("<br>");
    cell.innerHTML = display;
    cell.classList.add("flash-success");
    setTimeout(() => cell.classList.remove("flash-success"), 800);
  }

  console.log("──────────────────────────────────────────────");
};
