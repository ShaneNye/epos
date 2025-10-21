// public/js/salesInventoryModal.js
console.log("✅ salesInventoryModal.js loaded");

// 🧭 When user clicks the inventory cell or icon
document.addEventListener("click", (e) => {
  if (
    e.target.classList.contains("open-inventory") ||
    e.target.closest(".inventory-cell")
  ) {
    const row = e.target.closest(".order-line");
    const lineIndex = [...document.querySelectorAll("#orderItemsBody .order-line")].indexOf(row);

    const itemId = row.querySelector(".item-internal-id")?.value?.trim();
    const qty = row.querySelector(".item-qty")?.value?.trim() || "0";
    const detail = row.dataset.invdetail || "";

    if (!itemId) {
      alert("Please select an item before allocating inventory.");
      return;
    }

    const url = `/inventory.html?itemId=${encodeURIComponent(itemId)}&qty=${encodeURIComponent(
      qty
    )}&detail=${encodeURIComponent(detail)}&line=${lineIndex}`;

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

  // ✅ Get the main Sales Order warehouse details
  const mainWarehouseSelect = document.getElementById("warehouse");
  const mainWarehouseName =
    mainWarehouseSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
  const mainWarehouseId = mainWarehouseSelect?.value || "";

  console.log("🏭 Warehouse Comparison:");
  console.table({
    "SO Warehouse Name": mainWarehouseName,
    "SO Warehouse ID": mainWarehouseId,
    "Popup Location Name": locName,
    "Popup Location ID": locId,
    "Inventory Name": invName,
    "Inventory ID": invId,
  });

  const sameWarehouse =
    locName &&
    (locName.trim().toLowerCase() === mainWarehouseName.trim().toLowerCase() ||
      locId === mainWarehouseId);

  console.log(`🔍 sameWarehouse = ${sameWarehouse ? "✅ TRUE" : "❌ FALSE"}`);

  /* ----------------------------------------------------
     🏭 CASE 1: Same warehouse — populate custcol_sb_lotnumber
  ---------------------------------------------------- */
  if (sameWarehouse) {
    console.log("✅ Same warehouse detected — using custcol_sb_lotnumber flow");
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

    console.log("💾 Final dataset after same-warehouse logic:", {
      lotnumber: targetRow.dataset.lotnumber || "(empty)",
      inventoryMeta: targetRow.dataset.inventoryMeta || "(empty)",
    });

    console.log("──────────────────────────────────────────────");
    return; // ✅ exit here for same-warehouse case
  }

  /* ----------------------------------------------------
     🚚 CASE 2: Different warehouse — populate EPOS meta
  ---------------------------------------------------- */
  console.log("📦 Different warehouse detected — using custcol_sb_epos_inventory_meta flow");

  targetRow.dataset.lotnumber = "";
  targetRow.dataset.inventoryMeta = detailString;
  targetRow.dataset.invdetail = detailString;

  try {
    const jsonMeta = detailString.split(";").map((part) => {
      const tokens = part.split("|");
      return {
        qty: tokens[0] || "",
        locationName: tokens[1] || "",
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
    if (detailString && detailString.trim() !== "") {
      const display = detailString
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
    const lastEntry = detailString.split(";").pop().split("|");
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

  console.log("💾 Final dataset after transfer logic:", {
    lotnumber: targetRow.dataset.lotnumber || "(empty)",
    inventoryMeta: targetRow.dataset.inventoryMeta || "(empty)",
  });
  console.log("──────────────────────────────────────────────");
};
