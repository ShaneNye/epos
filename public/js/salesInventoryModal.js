// public/js/salesInventoryModal.js
console.log("✅ salesInventoryModal.js loaded");

function getInventoryStoreFilterParams(row) {
  const fulfilSelect =
    row?.querySelector(".item-fulfilment") || row?.querySelector(".fulfilmentSelect");
  const fulfilmentText =
    fulfilSelect?.options?.[fulfilSelect.selectedIndex]?.textContent?.trim().toLowerCase() || "";

  if (fulfilmentText !== "in store") return "";

  const storeSelect = document.getElementById("store");
  const selectedStore = storeSelect?.selectedOptions?.[0];
  const storeName =
    selectedStore?.dataset?.storeName ||
    selectedStore?.textContent?.trim() ||
    "";

  const storeIds = [
    storeSelect?.value,
    selectedStore?.dataset?.netsuiteInternalId,
    selectedStore?.dataset?.invoiceLocationId,
    selectedStore?.dataset?.distributionLocationId,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  const qs = new URLSearchParams();
  if (storeName) qs.set("storeLocationName", storeName);
  if (storeIds.length) qs.set("storeLocationIds", [...new Set(storeIds)].join(","));
  return `&${qs.toString()}`;
}

window.getInventoryStoreFilterParams = getInventoryStoreFilterParams;

function parseInventoryDetailPart(part) {
  const tokens = String(part || "").trim().split("|");
  return {
    qty: tokens[0] || "",
    locationName: tokens[1] || "",
    locationId: tokens[2] || "",
    statusName: tokens[3] || "",
    statusId: tokens[4] || "",
    inventoryNumberName: tokens.length > 7 ? tokens.slice(5, -1).join("|") : tokens[5] || "",
    inventoryNumberId: tokens.length > 6 ? tokens[tokens.length - 1] || "" : tokens[6] || "",
  };
}

function formatInventoryDetailPart(detail) {
  return [
    detail.qty,
    detail.locationName,
    detail.locationId,
    detail.statusName,
    detail.statusId,
    String(detail.inventoryNumberName || "").replace(/\|/g, " - "),
    detail.inventoryNumberId,
  ].join("|");
}

function formatLotDetailsFromInventoryDetail(value) {
  return String(value || "")
    .split(";")
    .map((part) => {
      const detail = parseInventoryDetailPart(part);
      return [detail.locationId, detail.statusId, detail.inventoryNumberId]
        .map((token) => String(token || "").trim())
        .join("|");
    })
    .filter((part) => part.replace(/\|/g, "").trim())
    .join(";");
}

window.formatLotDetailsFromInventoryDetail = formatLotDetailsFromInventoryDetail;

function inventoryDetailMatchesSelectedStore(detailString) {
  const storeSelect = document.getElementById("store");
  const selectedStore = storeSelect?.selectedOptions?.[0];
  const storeName =
    selectedStore?.dataset?.storeName || selectedStore?.textContent?.trim() || "";
  const storeIds = new Set(
    [
      storeSelect?.value,
      selectedStore?.dataset?.netsuiteInternalId,
      selectedStore?.dataset?.invoiceLocationId,
      selectedStore?.dataset?.distributionLocationId,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
  const normalizeName = (value) =>
    String(value || "")
      .replace(/\b(store|warehouse)\b/gi, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();
  const normalizedStoreName = normalizeName(storeName);
  const details = String(detailString || "")
    .split(";")
    .map((part) => parseInventoryDetailPart(part))
    .filter((detail) => detail.locationId || detail.locationName);

  return (
    details.length > 0 &&
    details.every((detail) => {
      const locationId = String(detail.locationId || "").trim();
      if (locationId && storeIds.has(locationId)) return true;

      const locationName = normalizeName(detail.locationName);
      return (
        !!locationName &&
        !!normalizedStoreName &&
        (locationName === normalizedStoreName ||
          locationName.includes(normalizedStoreName) ||
          normalizedStoreName.includes(locationName))
      );
    })
  );
}

function promptForAutomaticStoreFulfilment(row) {
  const quantity = row.querySelector(".item-qty")?.value?.trim() || "0";
  const itemName = row.querySelector(".item-search")?.value?.trim() || "item(s)";
  const modal = document.getElementById("takenFromStoreModal");
  const message = document.getElementById("takenFromStoreMessage");
  const yesButton = document.getElementById("takenFromStoreYes");
  const noButton = document.getElementById("takenFromStoreNo");

  if (!modal || !message || !yesButton || !noButton || typeof modal.showModal !== "function") {
    row.dataset.autoFulfilmentComplete = "";
    row.dataset.autoFulfilmentStatus = "";
    row.dataset.takenFromStore = window.confirm(
      `Is the customer taking ${quantity} ${itemName} away today? - Would you like these items to automatically Fulfill?`
    )
      ? "1"
      : "";
    window.updateAutoFulfilmentNotice?.(row);
    return Promise.resolve(row.dataset.takenFromStore === "1");
  }

  message.textContent =
    `Is the customer taking ${quantity} ${itemName} away today? - Would you like these items to automatically Fulfill?`;
  modal.showModal();

  return new Promise((resolve) => {
    const finish = (accepted) => {
      row.dataset.autoFulfilmentComplete = "";
      row.dataset.autoFulfilmentStatus = "";
      row.dataset.takenFromStore = accepted ? "1" : "";
      window.updateAutoFulfilmentNotice?.(row);
      modal.close();
      resolve(accepted);
    };
    yesButton.onclick = () => finish(true);
    noButton.onclick = () => finish(false);
    modal.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
  });
}

function setInventoryCellContent(row, html, detailString) {
  const cell = row?.querySelector(".inventory-cell");
  if (!cell) return;

  cell.innerHTML = html;

  let detailField = cell.querySelector(".item-inv-detail");
  if (!detailField) {
    detailField = document.createElement("input");
    detailField.type = "hidden";
    detailField.className = "item-inv-detail";
    cell.appendChild(detailField);
  }
  detailField.value = String(detailString || "").trim();

  if (!cell.querySelector(".inv-summary")) {
    const summary = document.createElement("span");
    summary.className = "inv-summary";
    cell.appendChild(summary);
  }
}

function setLineFulfilmentToWarehouse(row) {
  const fulfilSelect =
    row?.querySelector(".item-fulfilment") || row?.querySelector(".fulfilmentSelect");
  if (!fulfilSelect) return;

  const warehouseOption = [...fulfilSelect.options].find((opt) =>
    String(opt.textContent || "").trim().toLowerCase() === "warehouse"
  );

  fulfilSelect.value = warehouseOption?.value || "2";
  fulfilSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyBackOrderToLine(row) {
  if (!row) return;

  setLineFulfilmentToWarehouse(row);
  row.dataset.backorder = "1";
  row.dataset.takenFromStore = "";
  row.dataset.autoFulfilmentComplete = "";
  row.dataset.autoFulfilmentStatus = "";
  window.updateAutoFulfilmentNotice?.(row);
  row.dataset.lotnumber = "";
  row.dataset.inventoryMeta = "";
  row.dataset.inventoryMetaJson = "";

  const detailField = row.querySelector(".item-inv-detail");
  if (detailField) detailField.value = "";
  row.dataset.invdetail = "";

  const cell = row.querySelector(".inventory-cell");
  if (cell) {
    setInventoryCellContent(row, "<strong>Back order</strong>", "");
    cell.classList.add("flash-success");
    setTimeout(() => cell.classList.remove("flash-success"), 800);
  }

  const summary = row.querySelector(".inv-summary");
  if (summary) summary.textContent = "Back order";

  window.SalesLineUI?.validateInventoryForRow?.(row);
  window.updateOrderSummary?.();
  window.updateOrderSummaryFromTable?.();
}

// 🧭 When user clicks the inventory cell or icon
document.addEventListener("click", (e) => {
  if (e.target.closest(".inventory-detail-collapse")) return;

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
    const qty =
      row.querySelector(".item-qty")?.value?.trim() ||
      row.querySelector(".qty")?.textContent?.trim() ||
      row.querySelector(".item-qty-cache")?.value?.trim() ||
      "0";
    const detail = row.dataset.invdetail || "";
    const readOnly = row.dataset.inventoryReadonly === "1" || e.target.closest("[data-readonly-inventory]");

    if (!itemId) {
      alert("Please select an item before allocating inventory.");
      return;
    }

    const storeFilter = getInventoryStoreFilterParams(row);
    const url = `/inventory.html?itemId=${encodeURIComponent(
      itemId
    )}&qty=${encodeURIComponent(qty)}&detail=${encodeURIComponent(
      detail
    )}&line=${lineIndex}${readOnly ? "&readonly=1" : ""}${storeFilter}`;

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
window.onInventorySaved = async function (itemId, detailString, lineIndex) {
  console.log("──────────────────────────────────────────────");
  console.log(`💾 onInventorySaved() called for item ${itemId}, line ${lineIndex}`);
  console.log("📦 Raw detail string received:", detailString);

  const rows = document.querySelectorAll("#orderItemsBody .order-line");
  const targetRow = rows[lineIndex];
  if (!targetRow) {
    console.warn("⚠️ No matching line found for index", lineIndex);
    return;
  }
  const setInventoryDetail = (value) => {
    if (window.salesNewItemEditor?.setInventoryDetailForRow) {
      window.salesNewItemEditor.setInventoryDetailForRow(targetRow, value);
      return;
    }
    const detailField = targetRow.querySelector(".item-inv-detail");
    const normalized = String(value || "").trim();
    if (detailField) detailField.value = normalized;
    targetRow.dataset.invdetail = normalized;
  };

  // 🧩 Parse the first inventory detail entry
  if (String(detailString || "").trim() === "__BACK_ORDER__") {
    applyBackOrderToLine(targetRow);
    return;
  }

  targetRow.dataset.backorder = "";
  targetRow.dataset.takenFromStore = "";
  targetRow.dataset.autoFulfilmentComplete = "";
  targetRow.dataset.autoFulfilmentStatus = "";
  window.updateAutoFulfilmentNotice?.(targetRow);

  const firstPart = detailString?.split(";")[0]?.trim() || "";
  const firstDetail = parseInventoryDetailPart(firstPart);
  const qty = firstDetail.qty;
  const locName = firstDetail.locationName;
  const locId = firstDetail.locationId;
  const statusName = firstDetail.statusName;
  const statusId = firstDetail.statusId;
  const invName = firstDetail.inventoryNumberName;
  const invId = firstDetail.inventoryNumberId;

  // ✅ Get fulfilment method for this line
  const fulfilSelect = targetRow.querySelector(".item-fulfilment");
  const fulfilMethod = (fulfilSelect?.value || "").trim(); // "1" = In Store, "2" = Warehouse
  const fulfilmentText =
    fulfilSelect?.options?.[fulfilSelect.selectedIndex]?.textContent?.trim().toLowerCase() || "";
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

  if (fulfilmentText === "in store") {
    // In-Store fulfilment → source matches STORE
    sameSource = inventoryDetailMatchesSelectedStore(detailString);

    console.log(
      `🎯 In-Store fulfilment → sameSource = ${sameSource ? "✅ TRUE" : "❌ FALSE"}`
    );
  } else if (fulfilmentText === "warehouse" || fulfilMethod === "2") {
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
    targetRow.dataset.inventoryMetaJson = "";
    targetRow.dataset.lotDetails = formatLotDetailsFromInventoryDetail(detailString || "");
    setInventoryDetail(detailString || "");

    const cell = targetRow.querySelector(".inventory-cell");
    if (cell) {
      setInventoryCellContent(targetRow, `
        <strong>Lot:</strong> ${invName || "-"}<br>
        <small>ID: ${invId || "-"}</small>`, detailString || "");
      cell.classList.add("flash-success");
      setTimeout(() => cell.classList.remove("flash-success"), 800);
    }

    if (fulfilmentText === "in store") {
      await promptForAutomaticStoreFulfilment(targetRow);
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
      const detail = parseInventoryDetailPart(part);
      detail.locationName = detail.locationName.replace(/\bstore\b/gi, "").trim();
      return formatInventoryDetailPart(detail);
    })
    .join(";");

  targetRow.dataset.lotnumber = "";
  targetRow.dataset.inventoryMeta = cleanedDetail;
  targetRow.dataset.lotDetails = formatLotDetailsFromInventoryDetail(cleanedDetail);
  setInventoryDetail(cleanedDetail);

  try {
    const jsonMeta = cleanedDetail.split(";").map((part) => {
      const detail = parseInventoryDetailPart(part);
      return {
        qty: detail.qty,
        locationName: detail.locationName.replace(/\bstore\b/gi, "").trim(),
        locationId: detail.locationId,
        statusName: detail.statusName,
        statusId: detail.statusId,
        inventoryNumberName: detail.inventoryNumberName,
        inventoryNumberId: detail.inventoryNumberId,
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
        const detail = parseInventoryDetailPart(part);
        return `${detail.qty}× ${detail.inventoryNumberName || ""} @ ${detail.locationName || ""}`;
      })
      .join("<br>");
    setInventoryCellContent(targetRow, display, cleanedDetail);
    cell.classList.add("flash-success");
    setTimeout(() => cell.classList.remove("flash-success"), 800);
  }

  console.log("──────────────────────────────────────────────");
};
