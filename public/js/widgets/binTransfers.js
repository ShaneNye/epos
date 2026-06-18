// public/js/widgets/binTransfers.js
console.log("Bin Transfers Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("binTransfersWidget");
  if (!widget) return;

  let transfers = [];
  let selectedStore = "";
  let popupSearch = "";

  function getRange() {
    return window.DashboardDateFilter?.getRange() || {
      label: "Today",
      start: new Date(),
      end: new Date(),
    };
  }

  function getHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  function cell(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clean(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim();
  }

  function normalize(value) {
    return clean(value).toLowerCase();
  }

  function firstValue(row, keys) {
    for (const key of keys) {
      if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
        return row[key];
      }
    }

    const lookup = new Map(
      Object.keys(row || {}).map((key) => [key.replace(/\s+/g, "").toLowerCase(), key])
    );
    for (const key of keys) {
      const actual = lookup.get(key.replace(/\s+/g, "").toLowerCase());
      if (actual && row[actual] !== undefined && row[actual] !== null && row[actual] !== "") {
        return row[actual];
      }
    }
    return "";
  }

  function numberValue(row, keys) {
    const raw = String(firstValue(row, keys) || "0").replace(/,/g, "");
    const number = parseFloat(raw);
    return Number.isFinite(number) ? number : 0;
  }

  function rowDate(row) {
    return firstValue(row, ["Date", "Tran Date", "Transaction Date", "trandate", "date"]);
  }

  function rowInternalId(row) {
    return clean(firstValue(row, ["Internal ID", "Internal Id", "internalid", "id", "Transaction Internal ID"]));
  }

  function rowStore(row) {
    return clean(firstValue(row, ["Store", "Location", "location", "Subsidiary Location", "Inventory Location"])) || "Unknown Store";
  }

  function rowBin(row) {
    return clean(firstValue(row, ["Bin Number", "Bin", "Bin Number Name", "binnumber", "bin_number"]));
  }

  function rowLot(row) {
    return clean(firstValue(row, ["Lot Number", "Inventory Number", "Serial/Lot Number", "Serial Lot Number", "inventorynumber"]));
  }

  function rowItem(row) {
    return clean(firstValue(row, ["Item", "Item Name", "item", "Name"]));
  }

  function rowTranNumber(row) {
    return clean(firstValue(row, ["Number", "Document Number", "Transaction Number", "tranid", "Transfer Number"]));
  }

  function rowCreatedBy(row) {
    return clean(firstValue(row, ["Created By", "CreatedBy", "createdby", "Employee", "User"]));
  }

  function toIsoDate(date) {
    return window.DashboardDateFilter?.toIsoDate?.(date) || date.toISOString().slice(0, 10);
  }

  function buildTransfers(rows) {
    const grouped = new Map();

    rows.forEach((row, index) => {
      const id = rowInternalId(row) || `${rowTranNumber(row)}-${index}`;
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(row);
    });

    return Array.from(grouped.entries()).map(([internalId, rowsForTransfer]) => {
      const negative = rowsForTransfer.find((row) =>
        numberValue(row, ["Quantity", "Item Count", "Count", "qty", "quantity"]) < 0
      );
      const positive = rowsForTransfer.find((row) =>
        numberValue(row, ["Quantity", "Item Count", "Count", "qty", "quantity"]) > 0
      );
      const source = negative || rowsForTransfer[0] || {};
      const destination = positive || rowsForTransfer[1] || source;

      return {
        internalId,
        date: rowDate(source) || rowDate(destination),
        item: rowItem(source) || rowItem(destination),
        number: rowTranNumber(source) || rowTranNumber(destination),
        createdBy: rowCreatedBy(source) || rowCreatedBy(destination),
        lotNumber: rowLot(source) || rowLot(destination),
        store: rowStore(source) || rowStore(destination),
        fromBin: rowBin(source),
        toBin: rowBin(destination),
      };
    });
  }

  function storeOptions() {
    const options = new Map();
    transfers.forEach((transfer) => {
      const key = normalize(transfer.store);
      if (key && !options.has(key)) options.set(key, clean(transfer.store));
    });
    return Array.from(options.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function visibleTransfers() {
    const selected = normalize(selectedStore);
    return selected ? transfers.filter((transfer) => normalize(transfer.store) === selected) : transfers;
  }

  function storeRows() {
    const counts = new Map();
    transfers.forEach((transfer) => {
      const key = normalize(transfer.store);
      const label = clean(transfer.store) || "Unknown Store";
      if (!counts.has(key)) counts.set(key, { key, label, ids: new Set() });
      counts.get(key).ids.add(transfer.internalId);
    });

    return Array.from(counts.values())
      .map((row) => ({ ...row, count: row.ids.size }))
      .filter((row) => !selectedStore || row.key === normalize(selectedStore))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  function renderStoreOptions() {
    const select = widget.querySelector("#binTransfersStoreFilter");
    if (!select) return;

    const options = storeOptions();
    select.innerHTML = [
      `<option value="">All stores</option>`,
      ...options.map((option) => `<option value="${cell(option.key)}">${cell(option.label)}</option>`),
    ].join("");
    select.value = selectedStore;
  }

  function renderTable() {
    const rows = storeRows();
    const body = widget.querySelector("[data-bin-transfer-body]");
    if (!body) return;

    body.innerHTML = rows.length
      ? rows.map((row) => `
          <tr>
            <td>
              <button type="button" class="bin-transfer-store-link" data-store="${cell(row.key)}">
                ${cell(row.label)}
              </button>
            </td>
            <td>${row.count}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="2" class="no-data">No bin transfers found for this selection.</td></tr>`;

    body.querySelectorAll("[data-store]").forEach((button) => {
      button.addEventListener("click", () => openPopup(button.dataset.store));
    });
  }

  function renderShell() {
    const range = getRange();
    widget.innerHTML = `
      <div class="bin-transfer-header">
        <div>
          <div class="widget-header">Bin Transfers</div>
          <small>${cell(window.DashboardDateFilter?.formatRange?.(range) || range.label)}</small>
        </div>
        <select id="binTransfersStoreFilter" aria-label="Filter bin transfers by store"></select>
      </div>
      <div class="bin-transfer-table-wrap">
        <table class="bin-transfer-table">
          <thead>
            <tr>
              <th>Store</th>
              <th>Unique Transfers</th>
            </tr>
          </thead>
          <tbody data-bin-transfer-body></tbody>
        </table>
      </div>
    `;

    renderStoreOptions();
    renderTable();

    widget.querySelector("#binTransfersStoreFilter").addEventListener("change", (event) => {
      selectedStore = event.target.value;
      renderTable();
    });
  }

  function ensurePopup() {
    let popup = document.getElementById("binTransfersPopup");
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = "binTransfersPopup";
    popup.className = "bin-transfer-popup hidden";
    popup.innerHTML = `
      <div class="bin-transfer-popup-backdrop" data-bin-transfer-close></div>
      <div class="bin-transfer-popup-panel" role="dialog" aria-modal="true" aria-labelledby="binTransfersPopupTitle">
        <div class="bin-transfer-popup-header">
          <div>
            <h2 id="binTransfersPopupTitle">Bin Transfers</h2>
            <small data-bin-transfer-subtitle></small>
          </div>
          <input id="binTransfersPopupSearch" type="search" placeholder="Search item, bin or lot" aria-label="Search item, bin or lot number">
          <button type="button" class="bin-transfer-popup-close" data-bin-transfer-close aria-label="Close popup">x</button>
        </div>
        <div class="bin-transfer-popup-body"></div>
      </div>
    `;
    document.body.appendChild(popup);

    popup.addEventListener("click", (event) => {
      if (event.target.matches("[data-bin-transfer-close]")) closePopup();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePopup();
    });
    popup.querySelector("#binTransfersPopupSearch").addEventListener("input", (event) => {
      popupSearch = event.target.value;
      renderPopupBody(popup.dataset.storeKey);
    });

    return popup;
  }

  function closePopup() {
    document.getElementById("binTransfersPopup")?.classList.add("hidden");
  }

  function popupRows(storeKey) {
    const search = normalize(popupSearch);
    return transfers
      .filter((transfer) => normalize(transfer.store) === storeKey)
      .filter((transfer) => {
        if (!search) return true;
        return [transfer.item, transfer.fromBin, transfer.toBin, transfer.lotNumber, transfer.number]
          .some((value) => normalize(value).includes(search));
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function renderPopupBody(storeKey) {
    const popup = ensurePopup();
    const rows = popupRows(storeKey);
    const body = popup.querySelector(".bin-transfer-popup-body");

    body.innerHTML = rows.length
      ? `
        <table class="bin-transfer-detail-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Number</th>
              <th>Created By</th>
              <th>Lot Number</th>
              <th>From Bin Number</th>
              <th>To Bin Number</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${cell(row.date)}</td>
                <td>${cell(row.item)}</td>
                <td>${cell(row.number)}</td>
                <td>${cell(row.createdBy)}</td>
                <td>${cell(row.lotNumber)}</td>
                <td>${cell(row.fromBin)}</td>
                <td>${cell(row.toBin)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : `<div class="no-data">No bin transfers found for this search.</div>`;
  }

  function openPopup(storeKey) {
    const popup = ensurePopup();
    const store = storeOptions().find((option) => option.key === storeKey);
    popup.dataset.storeKey = storeKey;
    popupSearch = "";
    popup.querySelector("#binTransfersPopupTitle").textContent = `${store?.label || "Store"} Bin Transfers`;
    popup.querySelector("[data-bin-transfer-subtitle]").textContent = `${popupRows(storeKey).length} transfer records`;
    popup.querySelector("#binTransfersPopupSearch").value = "";
    renderPopupBody(storeKey);
    popup.classList.remove("hidden");
    popup.querySelector("#binTransfersPopupSearch").focus();
  }

  async function loadBinTransfers() {
    const range = getRange();
    widget.innerHTML = `<div class="loading">Loading bin transfers...</div>`;

    try {
      const params = new URLSearchParams({
        refresh: "1",
        startDate: toIsoDate(range.start),
        endDate: toIsoDate(range.end),
        from: toIsoDate(range.start),
        to: toIsoDate(range.end),
        _: String(Date.now()),
      });

      const res = await fetch(`/api/netsuite/bin-transfer-transactions?${params.toString()}`, {
        headers: getHeaders(),
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to load bin transfers");
      }

      const rows = Array.isArray(data.results) ? data.results : [];
      const rangeRows = window.DashboardDateFilter
        ? rows.filter((row) => window.DashboardDateFilter.isDateInRange(rowDate(row), range))
        : rows;

      transfers = buildTransfers(rangeRows);

      if (!transfers.length) {
        widget.innerHTML = `
          <div class="widget-header">Bin Transfers</div>
          <div class="no-data">No bin transfers found for ${cell(range.label.toLowerCase())}.</div>
        `;
        return;
      }

      if (selectedStore && !storeOptions().some((option) => option.key === selectedStore)) {
        selectedStore = "";
      }

      renderShell();
    } catch (err) {
      console.error("Failed to load bin transfers:", err);
      widget.innerHTML = `<div class="error">Error loading bin transfers</div>`;
    }
  }

  window.addEventListener("dashboard:date-range-change", loadBinTransfers);
  loadBinTransfers();
});
