// public/js/widgets/outstandingActions.js
console.log("Outstanding Actions Widget Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const widget = document.getElementById("outstandingActionsWidget");
  if (!widget) return;

  let transferOrders = [];
  let cases = [];
  let selectedLocation = "";
  const NETSUITE_TRANSFER_ORDER_BASE =
    "https://7972741.app.netsuite.com/app/accounting/transactions/trnfrord.nl";

  function normalize(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim()
      .toLowerCase();
  }

  function displayLocation(value) {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/.*:\s*/i, "")
      .trim() || "Unknown";
  }

  function selectedLocationLabel() {
    const selected = normalize(selectedLocation);
    const option = uniqueLocations().find((location) => location.key === selected);
    return option?.label || displayLocation(selectedLocation);
  }

  function statusIs(row, expected) {
    const status = normalize(row.Status);
    if (expected === "fulfillment") {
      return status === "pending fulfillment" || status === "pending fulfilment";
    }
    return status === "pending receipt";
  }

  function firstValue(row, keys) {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
    return "";
  }

  function transferOrderInternalId(row) {
    return String(firstValue(row, ["Internal ID", "Internal Id", "internalid", "id"])).trim();
  }

  function transferOrderDocumentNumber(row) {
    return String(firstValue(row, ["Document Number", "Document No", "Document", "Tran ID", "tranid"])).trim();
  }

  function transferOrderNeededBy(row) {
    return firstValue(row, ["Needed By", "Due Date/Receive By", "Receive By", "Due Date"]);
  }

  function transferOrderUrl(internalId) {
    const url = new URL(NETSUITE_TRANSFER_ORDER_BASE);
    url.searchParams.set("id", internalId);
    url.searchParams.set("whence", "");
    return url.toString();
  }

  function getHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  async function getPrimaryStoreName() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    let user = saved?.user;

    if (!user) {
      try {
        const res = await fetch("/api/me");
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.user) user = data.user;
        }
      } catch {
        // ignore fallback failure
      }
    }

    if (!user?.primaryStore) return null;

    const primaryStore = String(user.primaryStore).trim();
    if (!primaryStore) return null;

    if (/^\d+$/.test(primaryStore)) {
      try {
        const storeRes = await fetch(`/api/meta/store/${primaryStore}`);
        if (storeRes.ok) {
          const storeData = await storeRes.json();
          if (storeData.ok && storeData.name) {
            return storeData.name.trim().toLowerCase();
          }
        }
      } catch {
        return null;
      }
    }

    return primaryStore.toLowerCase();
  }

  function uniqueLocations() {
    const options = new Map();
    transferOrders.forEach((row) => {
      [row.Location, row["To Location"]].forEach((location) => {
        const key = normalize(location);
        if (key && !options.has(key)) options.set(key, displayLocation(location));
      });
    });

    cases.forEach((row) => {
      const key = normalize(row.Store);
      if (key && !options.has(key)) options.set(key, displayLocation(row.Store));
    });

    return Array.from(options.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function filterRows(type) {
    const selected = normalize(selectedLocation);
    if (!selected) return [];

    if (type === "send") {
      return transferOrders.filter((row) =>
        normalize(row.Location) === selected && statusIs(row, "fulfillment")
      );
    }

    if (type === "receive") {
      return transferOrders.filter((row) =>
        normalize(row["To Location"]) === selected && statusIs(row, "receipt")
      );
    }

    return cases.filter((row) => normalize(row.Store) === selected);
  }

  function renderLocationOptions(locations) {
    const select = widget.querySelector("#outstandingActionsLocation");
    if (!select) return;

    select.innerHTML = locations
      .map((location) => `<option value="${location.key}">${location.label}</option>`)
      .join("");

    if (!selectedLocation && locations.length) selectedLocation = locations[0].key;
    select.value = selectedLocation;
  }

  function renderCounts() {
    const send = filterRows("send").length;
    const receive = filterRows("receive").length;
    const caseCount = filterRows("cases").length;

    widget.querySelector('[data-count="send"]').textContent = send;
    widget.querySelector('[data-count="receive"]').textContent = receive;
    widget.querySelector('[data-count="cases"]').textContent = caseCount;
  }

  function renderShell(locations) {
    widget.innerHTML = `
      <div class="outstanding-actions-header">
        <div class="widget-header">Outstanding Actions</div>
        <select id="outstandingActionsLocation" aria-label="Outstanding actions location"></select>
      </div>
      <div class="outstanding-actions-row">
        <button type="button" class="outstanding-action" data-action-type="send">
          <span>Transfer Orders To Send</span>
          <strong data-count="send">0</strong>
        </button>
        <button type="button" class="outstanding-action" data-action-type="receive">
          <span>Transfer Orders To Receive</span>
          <strong data-count="receive">0</strong>
        </button>
        <button type="button" class="outstanding-action" data-action-type="cases">
          <span>Outstanding Cases</span>
          <strong data-count="cases">0</strong>
        </button>
      </div>
    `;

    renderLocationOptions(locations);
    renderCounts();

    widget.querySelector("#outstandingActionsLocation").addEventListener("change", (event) => {
      selectedLocation = event.target.value;
      renderCounts();
    });

    widget.querySelectorAll("[data-action-type]").forEach((button) => {
      button.addEventListener("click", () => openPopup(button.dataset.actionType));
    });
  }

  function ensurePopup() {
    let popup = document.getElementById("outstandingActionsPopup");
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = "outstandingActionsPopup";
    popup.className = "outstanding-popup hidden";
    popup.innerHTML = `
      <div class="outstanding-popup-backdrop" data-close-popup></div>
      <div class="outstanding-popup-panel" role="dialog" aria-modal="true" aria-labelledby="outstandingPopupTitle">
        <div class="outstanding-popup-header">
          <h2 id="outstandingPopupTitle">Outstanding Actions</h2>
          <button type="button" class="outstanding-popup-close" data-close-popup aria-label="Close popup">×</button>
        </div>
        <div class="outstanding-popup-body"></div>
      </div>
    `;
    document.body.appendChild(popup);

    popup.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-popup]")) closePopup();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePopup();
    });

    return popup;
  }

  function closePopup() {
    document.getElementById("outstandingActionsPopup")?.classList.add("hidden");
  }

  function cell(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function documentLink(row) {
    const internalId = transferOrderInternalId(row);
    const documentNumber = transferOrderDocumentNumber(row) || internalId;
    if (!internalId) return cell(documentNumber);

    return `
      <a href="${cell(transferOrderUrl(internalId))}"
         class="outstanding-doc-link"
         data-transfer-order-id="${cell(internalId)}">
        ${cell(documentNumber)}
      </a>
    `;
  }

  function transferTable(rows) {
    return `
      <table class="outstanding-popup-table">
        <thead>
          <tr>
            <th>Document Number</th>
            <th>Date</th>
            <th>From</th>
            <th>To</th>
            <th>Status</th>
            <th>Needed By</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${documentLink(row)}</td>
              <td>${cell(row.Date)}</td>
              <td>${cell(row.Location)}</td>
              <td>${cell(row["To Location"])}</td>
              <td>${cell(row.Status)}</td>
              <td>${cell(transferOrderNeededBy(row))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function casesTable(rows) {
    return `
      <table class="outstanding-popup-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Case</th>
            <th>Customer</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Store</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${cell(row.Date)}</td>
              <td>${row.Case || ""}</td>
              <td>${row.Customer || ""}</td>
              <td>${cell(row.Subject)}</td>
              <td>${cell(row.Status)}</td>
              <td>${cell(row.Store)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function openPopup(type) {
    const popup = ensurePopup();
    const rows = filterRows(type);
    const titleMap = {
      send: "Transfer Orders To Send",
      receive: "Transfer Orders To Receive",
      cases: "Outstanding Cases",
    };

    popup.querySelector("#outstandingPopupTitle").textContent =
      `${titleMap[type]} - ${selectedLocationLabel()}`;
    popup.querySelector(".outstanding-popup-body").innerHTML = rows.length
      ? type === "cases" ? casesTable(rows) : transferTable(rows)
      : `<div class="no-data">No rows found for this selection.</div>`;

    popup.classList.remove("hidden");
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const link = event.target.closest(".outstanding-doc-link");
    if (!link) return;

    event.preventDefault();
    const internalId = link.dataset.transferOrderId;
    if (!internalId) return;

    window.open(
      transferOrderUrl(internalId),
      `transferOrder_${internalId}`,
      "popup=yes,width=1200,height=850,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes"
    );
  });

  async function loadData() {
    widget.innerHTML = `<div class="loading">Loading outstanding actions...</div>`;

    try {
      const headers = getHeaders();
      const [transferRes, casesRes] = await Promise.all([
        fetch(`/api/netsuite/transfer-order-widget?refresh=1&_=${Date.now()}`, {
          headers,
          cache: "no-store",
        }),
        fetch(`/api/netsuite/case-management?refresh=1&_=${Date.now()}`, {
          headers,
          cache: "no-store",
        }),
      ]);

      const [transferData, casesData] = await Promise.all([
        transferRes.json(),
        casesRes.json(),
      ]);

      if (!transferRes.ok || transferData.ok === false) {
        throw new Error(transferData.error || "Failed to load transfer orders");
      }
      if (!casesRes.ok || casesData.ok === false) {
        throw new Error(casesData.error || "Failed to load cases");
      }

      transferOrders = Array.isArray(transferData.results) ? transferData.results : [];
      cases = Array.isArray(casesData.results) ? casesData.results : [];

      const locations = uniqueLocations();
      if (!locations.length) {
        widget.innerHTML = `<div class="no-data">No outstanding actions found.</div>`;
        return;
      }

      const primaryStoreName = await getPrimaryStoreName();
      if (!selectedLocation && primaryStoreName) {
        const primaryMatch = locations.find((location) => location.key === primaryStoreName);
        if (primaryMatch) {
          selectedLocation = primaryMatch.key;
        }
      }

      renderShell(locations);
    } catch (err) {
      console.error("Failed to load outstanding actions:", err);
      widget.innerHTML = `<div class="error">Error loading outstanding actions</div>`;
    }
  }

  loadData();
});
