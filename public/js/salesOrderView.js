// public/js/salesOrderView.js

// Lightweight global crash sniffers
window.addEventListener("error", (e) =>
  console.error("💥 Uncaught error:", e.error || e.message)
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("💥 Unhandled Promise rejection:", e.reason)
);

/* =====================================================
   Shared item cache loader
===================================================== */
async function loadItemCache() {
  try {
    if (window.nsItemFeedCache?.getItems) {
      const items = await window.nsItemFeedCache.getItems();
      window.items = items;
      console.log("✅ Items loaded from shared cache:", items.length);
      return items;
    }

    console.warn("⚠️ nsItemFeedCache missing - falling back to direct fetch");
    const res = await fetch("/api/netsuite/items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = data.results || [];
    window.items = items;

    console.log("✅ Items loaded from API fallback:", items.length);
    return items;
  } catch (err) {
    console.error("❌ Failed to load items cache:", err.message || err);
    window.items = [];
    return [];
  }
}

/* ==========================================================
   TOAST NOTIFICATION
========================================================== */
(function () {
  const toast = document.getElementById("orderToast");
  if (!toast) return;

  window.showToast = function (message, type = "success") {
    toast.textContent = message;
    toast.className = `order-toast ${type}`;
    toast.classList.remove("hidden");

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 300);
    }, 3000);
  };
})();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function removeCustomerServicePanel() {
  const panel = document.getElementById("customerServiceSection");
  const row = panel?.closest(".sales-bottom-panel-row");
  panel?.remove();
  row?.classList.add("single-panel");
}

async function applyCustomerServiceReleaseVisibility(headers) {
  try {
    const response = await fetch("/api/releases/settings", {
      headers,
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Release settings request failed: ${response.status}`);
    }

    if (data.settings?.customerServiceVisible === false) {
      removeCustomerServicePanel();
    }
  } catch (err) {
    console.warn("Could not load release settings; leaving Customer Service panel visible.", err.message || err);
  }
}

function resolveCustomerNameParts(entity = {}, displayName = "") {
  const firstName = String(entity.firstName ?? entity.firstname ?? "").trim();
  const lastName = String(entity.lastName ?? entity.lastname ?? "").trim();

  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const fallbackName = String(displayName || "").trim();
  if (!fallbackName) return { firstName: "", lastName: "" };

  const [fallbackFirstName, ...fallbackLastName] = fallbackName.split(/\s+/);
  return {
    firstName: fallbackFirstName || "",
    lastName: fallbackLastName.join(" "),
  };
}

function normalizeCustomerNameLine(value) {
  return String(value || "")
    .replace(/^\d+\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function customerNameVariants(entity = {}, displayName = "", nameParts = {}) {
  const values = [
    [nameParts.firstName, nameParts.lastName].filter(Boolean).join(" "),
    displayName,
    entity.entityId,
    entity.entityid,
    entity.altName,
    entity.altname,
    entity.companyName,
    entity.companyname,
    entity.refName,
    entity.name,
  ];

  return values.map(normalizeCustomerNameLine).filter(Boolean);
}

function isCustomerNameAddressLine(line, entity = {}, displayName = "", nameParts = {}) {
  const normalizedLine = normalizeCustomerNameLine(line);
  if (!normalizedLine) return false;
  return customerNameVariants(entity, displayName, nameParts).includes(normalizedLine);
}

function isSalesViewLockExemptControl(el) {
  return Boolean(
    el?.closest?.("#menu") ||
      el?.id === "assistantToggle" ||
      el?.id === "updateCustomerDetailsBtn" ||
      el?.classList?.contains("auto-fulfilment-alert") ||
      el?.closest?.("#takenFromStoreModal, #autoFulfilmentInfoModal") ||
      el?.closest?.("#salesAssistant")
  );
}

function ensureCustomerUpdateButtonUnlocked() {
  const button = document.getElementById("updateCustomerDetailsBtn");
  if (!button) return;
  button.disabled = false;
  button.removeAttribute("disabled");
  button.removeAttribute("readonly");
  button.classList.remove("locked-input");
  button.style.pointerEvents = "auto";
  button.style.opacity = "1";
}

function setupSalesViewTabs() {
  const tabs = [...document.querySelectorAll(".sales-view-tab")];
  if (!tabs.length) return;

  const panels = {
    items: document.getElementById("salesTabItems"),
    related: document.getElementById("salesTabRelated"),
    closedLines: document.getElementById("salesTabClosedLines"),
    customFields: document.getElementById("salesTabCustomFields"),
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.salesTab;
      tabs.forEach((next) => {
        const active = next === tab;
        next.classList.toggle("active", active);
        next.setAttribute("aria-selected", active ? "true" : "false");
      });

      Object.entries(panels).forEach(([name, panel]) => {
        if (!panel) return;
        const active = name === target;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
    });
  });
}

function extractNetSuiteListValue(value) {
  if (!value) return { id: "", refName: "" };
  if (typeof value === "object") {
    const first = Array.isArray(value.items) ? value.items[0] : value;
    return {
      id: String(first?.id || first?.value || first?.internalId || first?.internalid || "").trim(),
      refName: String(first?.refName || first?.name || first?.text || first?.label || "").trim(),
    };
  }
  return { id: String(value).trim(), refName: "" };
}

function setSalesExecFromNetSuite(so, users = []) {
  const select = document.getElementById("salesExec");
  if (!select) return;

  const nsExec = extractNetSuiteListValue(so?.custbody_sb_bedspecialist);
  if (!nsExec.id && !nsExec.refName) return;

  const execMatch = users.find((u) => {
    const userNsId = String(u.netsuiteId || u.netsuiteid || "").trim();
    const userName = `${u.firstName || ""} ${u.lastName || ""}`.trim().toLowerCase();
    return (
      (nsExec.id && userNsId === nsExec.id) ||
      (nsExec.refName && userName && userName === nsExec.refName.toLowerCase())
    );
  });

  if (execMatch) {
    select.value = String(execMatch.id);
    return;
  }

  const fallbackValue = nsExec.id ? `netsuite:${nsExec.id}` : `netsuite-name:${nsExec.refName}`;
  if (![...select.options].some((option) => option.value === fallbackValue)) {
    const opt = document.createElement("option");
    opt.value = fallbackValue;
    opt.textContent = nsExec.refName || `NetSuite Employee ${nsExec.id}`;
    opt.dataset.netsuiteId = nsExec.id || "";
    select.appendChild(opt);
  }
  select.value = fallbackValue;
}

function recordList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.values)) return value.values;

  if (typeof value === "object") {
    if (value.id || value.refName || value.name || value.text) return [value];
    return [];
  }

  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text) => ({ refName: text }));
}

function hasRelatedRecord(value) {
  return recordList(value).some((record) => recordId(record) || recordLabel(record));
}

function recordLabel(record) {
  return String(record?.refName || record?.name || record?.text || record?.value || record?.id || "").trim();
}

function recordId(record) {
  return String(record?.id || record?.internalId || record?.internalid || "").trim();
}

function netSuiteRecordUrl(so, recordType, id) {
  const base = String(so?._netSuiteAppBaseUrl || "").replace(/\/$/, "");
  if (!base || !id) return "";

  const paths = {
    salesorder: "/app/accounting/transactions/salesord.nl",
    purchaseorder: "/app/accounting/transactions/purchord.nl",
    estimate: "/app/accounting/transactions/estimate.nl",
  };

  const path = paths[recordType];
  return path ? `${base}${path}?id=${encodeURIComponent(id)}` : "";
}

function renderOrderNumberLink(containerId, tranId, so, recordType = "salesorder") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const label = escapeHtml(tranId || "");
  const url = netSuiteRecordUrl(so, recordType, so?.id || so?.internalId || so?.internalid);
  
  if (url) {
    container.innerHTML = `<a href="${escapeHtml(url)}" class="related-popup-link" title="Open in NetSuite">${label}</a>`;
  } else {
    container.textContent = label;
  }
}

function renderRecordLinks(containerId, records, so, recordType, emptyText = "-") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const list = recordList(records);
  if (!list.length) {
    container.textContent = emptyText;
    return;
  }

  const html = list
    .map((record) => {
      const id = recordId(record);
      const label = escapeHtml(recordLabel(record) || id || "Open");
      const url = netSuiteRecordUrl(so, recordType, id);
      return url
        ? `<a href="${escapeHtml(url)}" class="related-popup-link">${label}</a>`
        : `<span>${label}</span>`;
    })
    .join("");

  container.innerHTML = list.length > 1 ? `<div class="related-records-list">${html}</div>` : html;
}

function isCheckedNetSuiteField(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "object") {
    return isCheckedNetSuiteField(value.id ?? value.value ?? value.refName ?? value.text);
  }
  const text = String(value).trim().toLowerCase();
  return text === "t" || text === "true" || text === "yes" || text === "1";
}

function isPendingFulfillmentSalesOrder(so) {
  const statusId = String(so?.orderStatus?.id || so?.orderstatus?.id || so?.orderstatus || so?.status || "")
    .trim()
    .toUpperCase();
  const statusName = String(
    so?.orderStatus?.refName ||
      so?.orderstatus?.refName ||
      so?.statusRef ||
      (typeof so?.status === "object" ? so.status.refName : so?.status) ||
      ""
  )
    .trim()
    .toUpperCase();
  const compact = `${statusId} ${statusName}`.replace(/[^A-Z]/g, "");
  return statusId === "B" || compact.includes("PENDINGFULFILLMENT");
}

function extractHref(html) {
  const text = String(html || "");
  const hrefMatch = text.match(/href=["']([^"']+)["']/i);
  if (hrefMatch?.[1]) return hrefMatch[1].replace(/&amp;/g, "&");
  if (/^https?:\/\//i.test(text.trim())) return text.trim();
  return "";
}

function extractDispatchTrackServiceOrderNumber(value) {
  const raw = String(value || "");
  const match = raw.match(/service-orders\/([^"'<>\s/?#]+)/i);
  if (match?.[1]) return match[1];
  const fallback = raw.match(/\bSO[A-Z]*\d+\b/i);
  return fallback?.[0] || "";
}

function renderDispatchTrack(value, scheduleHtml = "") {
  const container = document.getElementById("relatedDispatchTrack");
  if (!container) return;

  if (!isCheckedNetSuiteField(value)) {
    container.textContent = "Not exported";
    window.currentDispatchTrackServiceOrderNumber = "";
    window.currentDispatchTrackUrl = "";
    window.currentSalesOrderExportedToDispatchTrack = false;
    return;
  }

  const href = extractHref(scheduleHtml);
  const serviceOrderNumber = extractDispatchTrackServiceOrderNumber(href || scheduleHtml);
  window.currentDispatchTrackServiceOrderNumber = serviceOrderNumber;
  window.currentDispatchTrackUrl =
    href ||
    (serviceOrderNumber
      ? `https://sussexbeds.dispatchtrack.com/a18/service-orders/${encodeURIComponent(serviceOrderNumber)}`
      : "");
  window.currentSalesOrderExportedToDispatchTrack = true;
  if (window._currentSalesOrder) {
    window._currentSalesOrder.dispatchTrackServiceOrderNumber = serviceOrderNumber;
    window._currentSalesOrder.dispatchTrackUrl = window.currentDispatchTrackUrl;
    window._currentSalesOrder.exportedToDispatchTrack = true;
  }

  if (href) {
    container.innerHTML = `<a href="${escapeHtml(href)}" class="related-popup-link">Schedule</a>`;
    return;
  }

  container.textContent = "Schedule unavailable";
}

function labelCustomFieldType(value) {
  const labels = {
    free_form_text: "Free-form Text",
    list_record: "List/Record",
    number: "Number",
    currency: "Currency",
  };
  return labels[value] || value || "";
}

function formatCustomFieldValue(field) {
  if (field?.error) return `Unavailable: ${field.error}`;
  const value = field?.displayValue ?? field?.value ?? "";
  if (value === null || value === undefined || value === "") return "-";

  if (field.fieldType === "currency") {
    const amount = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(amount) ? `\u00a3${amount.toFixed(2)}` : String(value);
  }

  if (field.fieldType === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : String(value);
  }

  return String(value);
}

function customFieldCurrentValue(field) {
  return field?.value ?? "";
}

function collectCustomFieldPayload() {
  return [...document.querySelectorAll(".custom-field-control")].map((control) => ({
    id: control.dataset.customFieldId,
    value: control.value,
  }));
}

function customFieldsSignature(fields = collectCustomFieldPayload()) {
  return JSON.stringify(
    (Array.isArray(fields) ? fields : [])
      .map((field) => ({
        id: String(field.id || ""),
        value: String(field.value ?? ""),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

function customFieldsHaveChanges() {
  return customFieldsSignature() !== (window._lastCustomFieldsSignature || "[]");
}

function unlockCustomFieldControls() {
  document.querySelectorAll(".custom-field-control").forEach((control) => {
    control.disabled = false;
    control.classList.remove("locked-input");
  });
}

function customFieldInputHtml(field) {
  const value = customFieldCurrentValue(field);
  const id = escapeHtml(field.id);
  const label = escapeHtml(field.appLabel || field.fieldInternalId || "Custom Field");
  const baseAttrs = `data-custom-field-id="${id}" aria-label="${label}"`;

  if (field.fieldType === "list_record") {
    const options = Array.isArray(field.options) ? field.options : [];
    const currentValue = String(value ?? "");
    const hasCurrent = options.some((option) => String(option.id) === currentValue);
    const currentLabel = field.displayValue || currentValue;
    const optionHtml = [
      `<option value="">Select</option>`,
      ...(!hasCurrent && currentValue
        ? [`<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentLabel)}</option>`]
        : []),
      ...options.map((option) => {
        const optionValue = String(option.id || "");
        const selected = optionValue === currentValue ? " selected" : "";
        return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(option.name || optionValue)}</option>`;
      }),
    ].join("");

    return `
      <select class="custom-field-control" ${baseAttrs} data-always-editable="true">
        ${optionHtml}
      </select>
      ${field.optionsError ? `<small class="related-custom-field-error">${escapeHtml(field.optionsError)}</small>` : ""}
    `;
  }

  if (field.fieldType === "number" || field.fieldType === "currency") {
    return `<input class="custom-field-control" ${baseAttrs} data-always-editable="true" type="number" step="0.01" value="${escapeHtml(value ?? "")}" />`;
  }

  return `<input class="custom-field-control" ${baseAttrs} data-always-editable="true" type="text" value="${escapeHtml(value ?? "")}" />`;
}

function renderCustomFields(customFields = []) {
  const tbody = document.getElementById("customFieldsBody");
  if (!tbody) return;

  const fields = Array.isArray(customFields) ? customFields : [];
  window._currentCustomFields = fields;
  if (!fields.length) {
    tbody.innerHTML = `
      <tr>
        <td class="custom-fields-empty">No custom fields are visible for this sales order.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = fields
    .map((field) => {
      const typeLabel = labelCustomFieldType(field.fieldType);
      const label = field.appLabel || field.fieldInternalId || "Custom Field";
      const valueClass = field.error ? " related-custom-field-error" : "";
      return `
        <tr>
          <th>
            ${escapeHtml(label)}
            ${typeLabel ? `<small class="related-custom-field-type">${escapeHtml(typeLabel)}</small>` : ""}
          </th>
          <td class="${valueClass.trim()}">
            ${field.error ? escapeHtml(formatCustomFieldValue(field)) : customFieldInputHtml(field)}
          </td>
        </tr>
      `;
    })
    .join("");

  window._lastCustomFieldsSignature = customFieldsSignature();
  unlockCustomFieldControls();
}

function renderRelatedRecords(so, orderManagementRow = null) {
  const related = so?.relatedRecords || {};
  const pairedSalesOrder =
    related.custbody_sb_pairedsalesorder || so?.custbody_sb_pairedsalesorder;

  renderRecordLinks(
    "relatedIntercompanySalesOrder",
    pairedSalesOrder,
    so,
    "salesorder",
    "-"
  );

  if (related.intercompanyPurchaseOrdersNotApplicable) {
    const container = document.getElementById("relatedIntercompanyPurchaseOrder");
    if (container) container.textContent = "N/A";
  } else {
    renderRecordLinks(
      "relatedIntercompanyPurchaseOrder",
      related.intercompanyPurchaseOrders || so?.intercompanyPurchaseOrders,
      so,
      "purchaseorder",
      "-"
    );
  }

  renderRecordLinks(
    "relatedSupplierPurchaseOrders",
    related.custbody_sb_relatedpurchaseorders || so?.custbody_sb_relatedpurchaseorders,
    so,
    "purchaseorder",
    "-"
  );
  renderDispatchTrack(
    related.custbody_exported_to_dispatchtrack ?? so?.custbody_exported_to_dispatchtrack,
    orderManagementRow?.Schedule || ""
  );
  updateManageIntercompanyButton(
    isPendingFulfillmentSalesOrder(so) && !hasRelatedRecord(pairedSalesOrder)
  );
  renderCustomFields(so?.customFields || []);
}

async function openIntercompanyConsole() {
  const w = 1300;
  const h = 850;
  const left = (window.screen.width / 2) - (w / 2);
  const top = (window.screen.height / 2) - (h / 2);
  const popup = window.open(
    "about:blank",
    "IntercompanyConsole",
    `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes`
  );

  if (!popup || popup.closed || typeof popup.closed === "undefined") {
    alert("Please allow popups for this site to open the Intercompany Console.");
    return;
  }

  popup.document.write("<p style=\"font-family: sans-serif; padding: 1rem;\">Opening Intercompany Console...</p>");

  try {
    const res = await fetch("/api/config/intercompany-url");
    const data = await res.json();
    const url = String(data?.url || "").trim();

    if (!res.ok || !url) {
      popup.close();
      alert("Intercompany URL is not configured.");
      return;
    }

    popup.location.href = url;
    popup.focus();
  } catch (err) {
    popup.close();
    console.error("Failed to load intercompany URL:", err);
    alert("Failed to load Intercompany URL.");
  }
}

function updateManageIntercompanyButton(show) {
  const button = document.getElementById("manageIntercompanyBtn");
  if (!button) return;
  button.classList.toggle("hidden", !show);
}

function bindManageIntercompanyButton() {
  const button = document.getElementById("manageIntercompanyBtn");
  if (!button || button.dataset.bound === "1") return;
  button.dataset.bound = "1";
  button.addEventListener("click", openIntercompanyConsole);
}

async function loadRelatedRecords(headers, so, tranId) {
  try {
    const res = await fetch(
      `/api/netsuite/salesorder/${encodeURIComponent(tranId)}/related-records?_=${Date.now()}`,
      { headers, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Related records request failed");

    so._netSuiteAppBaseUrl = data.netSuiteAppBaseUrl || so._netSuiteAppBaseUrl;
    so.relatedRecords = data.relatedRecords || {};
    Object.assign(so, so.relatedRecords);
    so.customFields = data.customFields || [];
    renderRelatedRecords(so);
    return so.relatedRecords;
  } catch (err) {
    console.warn("⚠️ Could not load related records:", err.message || err);
    return null;
  }
}

async function loadOrderManagementRow(headers, so, tranId) {
  const related = so?.relatedRecords || {};
  if (!isCheckedNetSuiteField(related.custbody_exported_to_dispatchtrack ?? so?.custbody_exported_to_dispatchtrack)) {
    return null;
  }

  try {
    const res = await fetch("/api/netsuite/order-management", { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = data.results || data.data || (Array.isArray(data) ? data : []);
    return rows.find((row) => {
      return (
        String(row.ID || row.Id || row.id || "") === String(so?.id || tranId) ||
        String(row["Document Number"] || "").trim() === String(so?.tranId || "").trim()
      );
    }) || null;
  } catch (err) {
    console.warn("⚠️ Could not load DispatchTrack schedule link:", err.message || err);
    return null;
  }
}

async function loadSalesOrderDeposits(headers, tranId) {
  try {
    const res = await fetch(
      `/api/netsuite/salesorder/${encodeURIComponent(tranId)}/deposits?refresh=1&_=${Date.now()}`,
      { headers, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Deposit request failed");

    window._currentDeposits = Array.isArray(data.deposits) ? data.deposits : [];
    renderDeposits(window._currentDeposits);
    return window._currentDeposits;
  } catch (err) {
    console.warn("⚠️ Could not load deposits:", err.message || err);
    window._currentDeposits = window._currentDeposits || [];
    return window._currentDeposits;
  }
}

async function loadSalesOrderRefunds(headers, tranId) {
  try {
    const res = await fetch(
      `/api/netsuite/salesorder/${encodeURIComponent(tranId)}/refunds?filtered=1&refresh=1&_=${Date.now()}`,
      { headers, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Refund request failed");

    return Array.isArray(data.refunds) ? data.refunds : [];
  } catch (err) {
    console.warn("⚠️ Could not load refunds:", err.message || err);
    return [];
  }
}

window.debugLoadAllCustomerRefunds = async function (tranId = "", limit = 500) {
  const saved = typeof storageGet === "function" ? storageGet() : null;
  const token = saved?.token || "";
  const id =
    tranId ||
    window._currentSalesOrder?.id ||
    window.location.pathname.split("/").filter(Boolean).pop() ||
    "";
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(
    `/api/netsuite/salesorder/${encodeURIComponent(id)}/refunds?limit=${encodeURIComponent(limit)}&_=${Date.now()}`,
    { headers, cache: "no-store" }
  );
  const data = await res.json().catch(() => null);
  console.log("All customer refunds debug:", data);
  return data;
};

function renderCustomerServiceCases(cases = [], state = "") {
  const container = document.getElementById("customerServiceCases");
  if (!container) return;

  if (state === "loading") {
    container.innerHTML = '<p class="customer-service-empty">Loading cases...</p>';
    return;
  }

  if (state === "error") {
    container.innerHTML = '<p class="customer-service-empty">Unable to load cases.</p>';
    return;
  }

  const rows = Array.isArray(cases) ? cases : [];
  if (!rows.length) {
    container.innerHTML = '<p class="customer-service-empty">No cases found.</p>';
    return;
  }

  container.innerHTML = `
    <table class="styled-table customer-service-cases-table">
      <thead>
        <tr>
          <th>Case #</th>
          <th>Title</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.caseNumber || item.id || "-")}</td>
            <td>${escapeHtml(item.title || "-")}</td>
            <td>
              <button
                class="btn-secondary open-case-btn"
                type="button"
                data-case-id="${escapeHtml(item.id || "")}"
                data-case-number="${escapeHtml(item.caseNumber || "")}"
              >Open</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadCustomerServiceCases(headers, salesOrderId) {
  const section = document.getElementById("customerServiceSection");
  if (!section) return [];

  const id = String(salesOrderId || "").trim();
  if (!/^\d+$/.test(id)) {
    renderCustomerServiceCases([]);
    return [];
  }

  renderCustomerServiceCases([], "loading");
  try {
    const res = await fetch(
      `/api/netsuite/salesorder/${encodeURIComponent(id)}/cases?_=${Date.now()}`,
      { headers, cache: "no-store" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);

    const cases = Array.isArray(data.cases) ? data.cases : [];
    renderCustomerServiceCases(cases);
    return cases;
  } catch (err) {
    console.warn("⚠️ Could not load customer service cases:", err.message || err);
    renderCustomerServiceCases([], "error");
    return [];
  }
}

function salesViewCustomerInfo(so = window._currentSalesOrder || {}) {
  const entity = so.entityFull || so.entity || {};
  const displayName =
    so.entityFull?.companyName ||
    so.entityFull?.companyname ||
    so.entityFull?.altName ||
    so.entityFull?.altname ||
    so.entity?.refName ||
    so.entity?.name ||
    "";
  const parts = resolveCustomerNameParts(so.entityFull || {}, displayName);
  const name = [parts.firstName, parts.lastName].filter(Boolean).join(" ") || String(displayName || "").trim();
  return {
    id: String(so.entityFull?.id || so.entity?.id || entity.id || "").trim(),
    name,
  };
}

function salesViewStoreInfo(so = window._currentSalesOrder || {}) {
  const storeId = String(so.store || "").trim();
  const storeSelect = document.getElementById("store");
  const selectedStoreOption = storeSelect?.options?.[storeSelect.selectedIndex] || null;
  const selectedStoreId = String(storeSelect?.value || "").trim();
  const selectedStoreName = String(
    selectedStoreOption?.dataset?.storeName ||
    selectedStoreOption?.textContent ||
    ""
  ).trim();
  const selectedStoreNetSuiteId = String(
    selectedStoreOption?.dataset?.netsuiteId ||
    selectedStoreOption?.dataset?.netsuiteInternalId ||
    ""
  ).trim();
  const selectedDistributionLocationId = String(selectedStoreOption?.dataset?.distributionLocationId || "").trim();
  const selectedStoreManager = String(selectedStoreOption?.dataset?.storeManager || "").trim();
  const locations = Array.isArray(window._salesLocations) ? window._salesLocations : [];
  const wantedStoreId = storeId || selectedStoreId;
  const match = locations.find((location) => {
    const id = String(location.id || location.locationId || location.location_id || "").trim();
    return id && id === wantedStoreId;
  });

  return {
    id: wantedStoreId,
    name: String(match?.name || match?.storeName || match?.store_name || so.storeName || selectedStoreName || "").trim(),
    netSuiteId: String(
      match?.netsuiteInternalId ||
      match?.netsuite_internal_id ||
      match?.netsuiteId ||
      match?.netsuiteid ||
      selectedStoreNetSuiteId ||
      ""
    ).trim(),
    distributionLocationId: String(
      match?.distributionLocationId ||
      match?.distribution_location_id ||
      selectedDistributionLocationId ||
      ""
    ).trim(),
    storeManager: String(match?.store_manager || match?.storeManager || selectedStoreManager || "").trim(),
  };
}

function currentSalesViewCaseItems() {
  return [...document.querySelectorAll("#orderItemsBody tr.order-line")]
    .map((row) => {
      const id = String(row.querySelector(".item-internal-id")?.value || row.dataset.itemId || "").trim();
      const itemCell = row.cells?.[1] || null;
      const itemCellDirectText = itemCell
        ? [...itemCell.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || "")
            .join(" ")
            .trim()
        : "";
      const name = String(
        row.querySelector(".item-search")?.value ||
        row.querySelector(".item-search")?.textContent ||
        itemCellDirectText ||
        ""
      ).replace(/\s+/g, " ").trim();
      return { id, name };
    })
    .filter((item) => item.id && item.name)
    .filter((item, index, list) => list.findIndex((next) => next.id === item.id) === index);
}

function openRaiseCasePopup() {
  const customer = salesViewCustomerInfo();
  const so = window._currentSalesOrder || {};
  const store = salesViewStoreInfo(so);
  window._raiseCaseItems = currentSalesViewCaseItems();
  const params = new URLSearchParams({
    salesOrderId: String(so.id || so.internalId || so.internalid || ""),
    customerId: customer.id || "",
    customerName: customer.name || "",
    store: store.id || "",
    storeName: store.name || "",
    storeNetSuiteId: store.netSuiteId || "",
    storeDistributionLocationId: store.distributionLocationId || "",
    storeManager: store.storeManager || "",
  });
  const popup = window.open(
    `${window.location.origin}/raiseCase.html?${params.toString()}`,
    "RaiseCase",
    "width=780,height=620,resizable=yes,scrollbars=yes"
  );
  if (popup) popup.focus();
  else alert("Please allow popups for this site to raise a case.");
}

function openExistingCasePopup(caseId) {
  const cleanCaseId = String(caseId || "").trim();
  if (!cleanCaseId) return;

  const customer = salesViewCustomerInfo();
  const so = window._currentSalesOrder || {};
  const store = salesViewStoreInfo(so);
  window._raiseCaseItems = currentSalesViewCaseItems();
  const params = new URLSearchParams({
    caseId: cleanCaseId,
    salesOrderId: String(so.id || so.internalId || so.internalid || ""),
    customerId: customer.id || "",
    customerName: customer.name || "",
    store: store.id || "",
    storeName: store.name || "",
    storeNetSuiteId: store.netSuiteId || "",
    storeDistributionLocationId: store.distributionLocationId || "",
    storeManager: store.storeManager || "",
  });
  const popup = window.open(
    `${window.location.origin}/raiseCase.html?${params.toString()}`,
    "RaiseCase",
    "width=780,height=620,resizable=yes,scrollbars=yes"
  );
  if (popup) popup.focus();
  else alert("Please allow popups for this site to open a case.");
}

function bindRaiseCasePopup() {
  const button = document.getElementById("raiseCaseBtn");
  if (!button || button.dataset.bound === "1") return;

  button.dataset.bound = "1";
  button.addEventListener("click", openRaiseCasePopup);
}

function bindOpenCasePopup() {
  if (window._openCasePopupBound) return;
  window._openCasePopupBound = true;

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".open-case-btn");
    if (!button) return;
    openExistingCasePopup(button.dataset.caseId);
  });
}

function bindSupportCaseCreatedRefresh() {
  if (window._supportCaseCreatedRefreshBound) return;
  window._supportCaseCreatedRefreshBound = true;

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.action !== "support-case-created") return;

    const saved = typeof storageGet === "function" ? storageGet() : null;
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
    const so = window._currentSalesOrder || {};
    const salesOrderId = so.id || so.internalId || so.internalid || "";
    loadCustomerServiceCases(headers, salesOrderId);
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest(".related-popup-link");
  if (!link) return;

  event.preventDefault();
  const win = window.open(
    link.href,
    "RelatedRecord",
    "width=1200,height=800,resizable=yes,scrollbars=yes"
  );
  if (win) win.focus();
  else window.location.href = link.href;
});

document.addEventListener("input", (event) => {
  if (!event.target.closest(".custom-field-control")) return;
  const status = document.getElementById("customFieldsStatus");
  if (status) status.textContent = "Unsaved changes";
});

document.addEventListener("change", (event) => {
  if (!event.target.closest(".custom-field-control")) return;
  const status = document.getElementById("customFieldsStatus");
  if (status) status.textContent = "Unsaved changes";
});

async function saveCustomFieldsForCurrentOrder({ button = null, showNoChanges = false } = {}) {
  const savedAuth = storageGet?.();
  const token = savedAuth?.token;
  if (!token) return (window.location.href = "/index.html");

  const parts = window.location.pathname.split("/").filter(Boolean);
  const tranId = parts[parts.length - 1];
  const salesOrderId =
    window._currentSalesOrder?.id ||
    window._currentSalesOrder?.internalId ||
    window._currentSalesOrder?.internalid ||
    tranId;
  const status = document.getElementById("customFieldsStatus");
  const fields = collectCustomFieldPayload();
  const signature = customFieldsSignature(fields);

  if (signature === (window._lastCustomFieldsSignature || "[]")) {
    if (showNoChanges) {
      if (status) status.textContent = "No custom field changes";
      showToast?.("No custom field changes to save.", "success");
    }
    return { ok: true, changed: false };
  }

  if (button) {
    button.disabled = true;
    button.classList.add("locked-input");
  }
  if (status) status.textContent = "Saving...";

  try {
    const res = await fetch(`/api/netsuite/salesorder/${encodeURIComponent(salesOrderId)}/custom-fields`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fields }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save custom fields");

    if (window._currentSalesOrder) {
      window._currentSalesOrder.customFields = data.customFields || [];
    }
    renderCustomFields(data.customFields || []);
    window._lastCustomFieldsSignature = customFieldsSignature();
    showToast?.("Custom fields saved.", "success");
    return { ok: true, changed: true };
  } catch (err) {
    console.error("Custom field save failed:", err);
    if (status) status.textContent = err.message || "Save failed";
    showToast?.(err.message || "Custom field save failed", "error");
    return { ok: false, changed: true, error: err };
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("locked-input");
    }
  }
}

/* =====================================================
   Main Sales Order View Loader
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("💡 SalesOrderView init");
  window.orderPromotionsEnabled = false;
  setupSalesViewTabs();
  bindManageIntercompanyButton();

  function normaliseStoreName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isDistributionStoreName(name) {
    const normalised = normaliseStoreName(name);
    return normalised === "distribution ltd" || normalised.includes("distribution ltd");
  }

  function syncDistributionOrderTypeVisibility() {
    const wrapper = document.getElementById("distributionOrderTypeWrapper");
    const select = document.getElementById("distributionOrderType");
    const storeSelect = document.getElementById("store");
    if (!wrapper || !select || !storeSelect) return;

    const selectedOption = storeSelect.options[storeSelect.selectedIndex];
    const selectedStoreName =
      selectedOption?.dataset?.storeName ||
      selectedOption?.textContent?.trim() ||
      "";
    const show =
      selectedOption?.dataset?.distributionStore === "true" ||
      isDistributionStoreName(selectedStoreName);

    wrapper.style.display = show ? "flex" : "none";
    select.disabled = !show;

    if (!show) select.value = "";
  }

  const storeSelect = document.getElementById("store");
  storeSelect?.addEventListener("change", syncDistributionOrderTypeVisibility);
  storeSelect?.addEventListener("input", syncDistributionOrderTypeVisibility);

  const overlay = document.getElementById("loadingOverlay");
  overlay?.classList.remove("hidden");

  // ---- Auth / token ----
  let saved = storageGet?.();
  if (!saved || !saved.token) {
    await new Promise((r) => setTimeout(r, 300));
    saved = storageGet?.();
  }
  if (!saved || !saved.token) {
    console.error("🚫 No auth token – redirecting to login");
    return (window.location.href = "/index.html");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${saved.token}`,
  };

  await applyCustomerServiceReleaseVisibility(headers);
  bindRaiseCasePopup();
  bindOpenCasePopup();
  bindSupportCaseCreatedRefresh();

  const mePromise = fetch("/api/me", { headers })
    .then((res) => res.json())
    .catch((err) => {
      console.warn("Failed to load current user:", err);
      return {};
    });
  const usersPromise = fetch("/api/users", { headers })
    .then((res) => res.json())
    .catch((err) => {
      console.error("Failed to load sales executives:", err);
      return {};
    });
  const locationsPromise = fetch("/api/meta/locations", { headers })
    .then((res) => res.json())
    .catch((err) => {
      console.error("Failed to load stores:", err);
      return {};
    });

  populateSalesExecAndStore(mePromise, usersPromise, locationsPromise);

  /* =====================================================
     Populate Sales Executive & Store Dropdowns
  ===================================================== */
  async function populateSalesExecAndStore(mePromise, usersPromise, locationsPromise) {
    let currentUser = null;

    try {
      const meData = await mePromise;
      if (meData.ok && meData.user) {
        currentUser = meData.user;
        console.log("🧑 Current user:", currentUser);
      }
    } catch (err) {
      console.warn("⚠️ Failed to load current user:", err);
    }

    try {
      const data = await usersPromise;

      if (data.ok) {
        const execSelect = document.getElementById("salesExec");
        if (execSelect) {
          execSelect.innerHTML = '<option value="">Select Sales Executive</option>';

          const salesExecs = data.users.filter(
            (u) => Array.isArray(u.roles) && u.roles.some((r) => r.name === "Sales Executive")
          );

          salesExecs.forEach((u) => {
            const opt = document.createElement("option");
            opt.value = u.id; // app user id
            opt.textContent = `${u.firstName} ${u.lastName}`;
            execSelect.appendChild(opt);
          });

          if (currentUser && salesExecs.some((u) => u.id === currentUser.id)) {
            execSelect.value = currentUser.id;
            console.log("✔ Auto-set Sales Exec to current user");
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to load sales executives:", err);
    }

    try {
      const data = await locationsPromise;

      if (data.ok) {
        const storeSelect = document.getElementById("store");
        if (storeSelect) {
          storeSelect.innerHTML = '<option value="">Select Store</option>';

          const filteredLocations = data.locations.filter(
            (loc) => !/warehouse/i.test(loc.name)
          );

          filteredLocations.forEach((loc) => {
            const opt = document.createElement("option");
            opt.value = String(loc.id);
            opt.textContent = loc.name;
            opt.dataset.storeName = loc.name || "";
            opt.dataset.netsuiteInternalId = loc.netsuite_internal_id || "";
            opt.dataset.invoiceLocationId = loc.invoice_location_id || "";
            opt.dataset.distributionLocationId = loc.distribution_location_id || "";
            opt.dataset.storeManager = loc.store_manager || "";
            opt.dataset.distributionStore = isDistributionStoreName(loc.name)
              ? "true"
              : "false";
            storeSelect.appendChild(opt);
          });

          if (currentUser && currentUser.primaryStore) {
            const match = filteredLocations.find(
              (l) =>
                String(l.id) === String(currentUser.primaryStore) ||
                l.name === currentUser.primaryStore
            );

            if (match) {
              storeSelect.value = String(match.id);
              syncDistributionOrderTypeVisibility();
              console.log("✔ Auto-set store to:", match.name);
            }
          }
          syncDistributionOrderTypeVisibility();
        }
      }
    } catch (err) {
      console.error("❌ Failed to load stores:", err);
    }
  }

  // ---- Sales Order ID from URL ----
  const pathParts = window.location.pathname.split("/");
  const tranId = pathParts.pop() || pathParts.pop();
  if (!tranId) {
    alert("No Sales Order ID found in URL.");
    console.error("❌ Missing tranId from URL");
    return;
  }
  const salesOrderQuery = new URLSearchParams({
    lite: "1",
    deposits: "0",
    refresh: "1",
    _: String(Date.now()),
  });
  window._currentDeposits = [];
  const depositsPromise = /^\d+$/.test(String(tranId || ""))
    ? loadSalesOrderDeposits(headers, tranId)
    : Promise.resolve([]);
  const refundsPromise = /^\d+$/.test(String(tranId || ""))
    ? loadSalesOrderRefunds(headers, tranId)
    : Promise.resolve([]);

  try {
    // ==================================================
    // 1️⃣ Load everything in parallel where possible
    // ==================================================
    const [_items, soRes, locJson, userJson, fulfilRes] = await Promise.all([
      loadItemCache(),
      fetch(`/api/netsuite/salesorder/${tranId}?${salesOrderQuery.toString()}`, {
        headers,
        cache: "no-store",
      }),
      locationsPromise,
      usersPromise,
      fetch("/api/netsuite/fulfilmentmethods").catch(() => null),
    ]);

    const soJson = await soRes.json();
    if (!soRes.ok || !soJson || soJson.ok === false) {
      throw new Error(soJson?.error || `Server returned ${soRes.status}`);
    }

    const so = soJson.salesOrder || soJson;
    window._currentSalesOrder = so;
    if (!so) throw new Error("No salesOrder object in response");
    console.log("✅ Sales Order loaded:", so.tranId || tranId);
    const salesOrderInternalIdForCustomFields =
      so?.id || so?.internalId || so?.internalid || tranId;
    renderRelatedRecords(so);

    await loadRelatedRecords(headers, so, salesOrderInternalIdForCustomFields);
    loadCustomerServiceCases(headers, salesOrderInternalIdForCustomFields);
    loadOrderManagementRow(headers, so, salesOrderInternalIdForCustomFields).then((orderManagementRow) => {
      if (orderManagementRow) renderRelatedRecords(so, orderManagementRow);
    }).catch((err) => {
      console.warn("Could not refresh related records with order-management data:", err.message || err);
    });

    const locations = locJson.locations || locJson.data || [];
    window._salesLocations = locations;

    const users = userJson.users || userJson.data || [];
    window._salesUsers = users;

    let fulfilmentMethods = [];
    if (fulfilRes && fulfilRes.ok) {
      const fJson = await fulfilRes.json();
      fulfilmentMethods = fJson.results || [];
    }

    window._fulfilmentMap = fulfilmentMethods.map((f) => ({
      id: String(f["Internal ID"] || f.id),
      name: f["Name"] || f.name,
    }));

    // ==================================================
    // 2️⃣ Render Deposits
    // ==================================================
    const salesOrderInternalId = so?.id || so?.internalId || so?.internalid || tranId;
    let refunds = await refundsPromise;
    if (Array.isArray(soJson.deposits) && soJson.deposits.length) {
      window._currentDeposits = soJson.deposits;
    } else {
      window._currentDeposits = await depositsPromise;
      if (
        window._currentDeposits.length === 0 &&
        String(salesOrderInternalId || "") &&
        String(salesOrderInternalId) !== String(tranId)
      ) {
        window._currentDeposits = await loadSalesOrderDeposits(headers, salesOrderInternalId);
      }
    }
    if (
      refunds.length === 0 &&
      String(salesOrderInternalId || "") &&
      String(salesOrderInternalId) !== String(tranId)
    ) {
      refunds = await loadSalesOrderRefunds(headers, salesOrderInternalId);
    }
    window._currentDeposits = [...window._currentDeposits, ...refunds];
    renderDeposits(window._currentDeposits);

    // ==================================================
    // 3️⃣ Populate header + customer + order meta
    // ==================================================
    renderOrderNumberLink("orderNumber", so.tranId || tranId, so, "salesorder");

    function formatOrderStatus(so) {
      const codeMap = {
        A: "Pending Approval",
        B: "Pending Fulfillment",
        C: "Cancelled",
        D: "Partially Fulfilled",
        E: "Pending Billing / Partially Fulfilled",
        F: "Pending Billing",
        G: "Billed",
        H: "Closed",
      };
      const normalizeStatusCode = (value) =>
        String(value || "")
          .trim()
          .split(":")
          .pop()
          .toUpperCase();

      if (typeof so?.status === "string" && so.status.trim()) {
        const normalizedStatus = so.status.trim();
        return codeMap[normalizeStatusCode(normalizedStatus)] || normalizedStatus;
      }

      if (
        so?.status &&
        typeof so.status === "object" &&
        typeof so.status.refName === "string" &&
        so.status.refName.trim()
      ) {
        const normalizedStatusRef = so.status.refName.trim();
        return codeMap[normalizeStatusCode(normalizedStatusRef)] || normalizedStatusRef;
      }

      const statusRef =
        (typeof so?.statusRef === "string" && so.statusRef.trim()) ||
        (typeof so?.orderStatus?.refName === "string" && so.orderStatus.refName.trim()) ||
        (typeof so?.orderstatus?.refName === "string" && so.orderstatus.refName.trim()) ||
        "";

      if (statusRef) {
        const normalized = statusRef.trim();
        const statusCodeLabel = codeMap[normalizeStatusCode(normalized)];
        if (statusCodeLabel) return statusCodeLabel;

        const explicitMap = {
          _pendingApproval: "Pending Approval",
          _pendingFulfillment: "Pending Fulfillment",
          _cancelled: "Cancelled",
          _partiallyFulfilled: "Partially Fulfilled",
          _pendingBilling: "Pending Billing",
          _pendingBillingPartFulfilled: "Pending Billing / Partially Fulfilled",
          _fullyBilled: "Billed",
          _closed: "Closed",
          pendingApproval: "Pending Approval",
          pendingFulfillment: "Pending Fulfillment",
          billed: "Billed",
          cancelled: "Cancelled",
          closed: "Closed",
          pendingBilling: "Pending Billing",
          partiallyFulfilled: "Partially Fulfilled",
          pendingBillingPartFulfilled: "Pending Billing / Partially Fulfilled",
        };

        if (explicitMap[normalized]) {
          return explicitMap[normalized];
        }

        return normalized
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }

      const statusId = String(so?.orderStatus?.id || so?.orderstatus?.id || so?.orderstatus || "")
        .trim()
        .split(":")
        .pop()
        .toUpperCase();

      return codeMap[statusId] || statusId || "-";
    }

    const orderStatusEl = document.getElementById("orderStatus");
    if (orderStatusEl) {
      orderStatusEl.textContent = formatOrderStatus(so);
    }

    try {
      const fullName = String(so.entity?.refName || "").trim();
      const customerName = resolveCustomerNameParts(so.entityFull, fullName);

      document.querySelector('input[name="firstName"]').value =
        customerName.firstName;

      document.querySelector('input[name="lastName"]').value =
        customerName.lastName;

      const addressItems = so.entityFull?.addressbook?.items || [];
      const defaultAddress =
        addressItems.find((a) => a.defaultShipping) ||
        addressItems.find((a) => a.defaultBilling) ||
        addressItems[0] ||
        null;

      const addr = defaultAddress?.addressbookAddress || {};
      const rawAddress =
        so.shipAddress ||
        so.shippingAddress_text ||
        so.billAddress ||
        so.billingAddress_text ||
        "";

      if (rawAddress) {
        let addressLines = String(rawAddress).split("\n").map((l) => l.trim()).filter(Boolean);
        const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

        const firstLineLooksLikeLabel =
          addressLines.length > 1 &&
          !postcodeRegex.test(addressLines[0]) &&
          (isCustomerNameAddressLine(addressLines[0], so.entityFull, fullName, customerName) ||
            /\d/.test(addressLines[1] || ""));

        if (firstLineLooksLikeLabel) {
          addressLines.shift();
        }

        let postcode = "";
        let countryLine = "";
        const cleanedAddress = [];

        for (const line of addressLines) {
          if (postcodeRegex.test(line)) {
            const match = line.match(postcodeRegex);
            if (match) postcode = match[0].toUpperCase();

            const townPart = line.replace(postcodeRegex, "").trim();
            if (townPart) cleanedAddress.push(townPart);
          } else if (
            /(United Kingdom|UK|England|Scotland|Wales|Northern Ireland)/i.test(line)
          ) {
            countryLine = line;
          } else {
            cleanedAddress.push(line);
          }
        }

        const countySuffixRegex =
          /\b(East Sussex|West Sussex|Kent|Surrey|Essex|Hampshire|London|Greater London|Devon|Cornwall|Dorset|Somerset|Norfolk|Suffolk|Yorkshire|North Yorkshire|South Yorkshire|West Yorkshire|Lancashire|Cheshire)\b$/i;
        const splitTownCounty = (line) => {
          const value = String(line || "").trim();
          const countyMatch = value.match(countySuffixRegex);
          if (!countyMatch) return { town: value, county: "" };

          const countyValue = countyMatch[1].trim();
          return {
            town: value.slice(0, value.length - countyValue.length).trim(),
            county: countyValue,
          };
        };

        let address1 = cleanedAddress[0] || "";
        let address2 = "";
        let address3 = "";
        let county = "";

        if (cleanedAddress.length === 2) {
          const townCounty = splitTownCounty(cleanedAddress[1]);
          address3 = townCounty.town || cleanedAddress[1] || "";
          county = townCounty.county || "";
        } else {
          address2 = cleanedAddress[1] || "";
          address3 = cleanedAddress[2] || "";
          if (address3) {
            const townCounty = splitTownCounty(address3);
            address3 = townCounty.town || address3;
            county = townCounty.county;
          }
        }

        document.querySelector('input[name="address1"]').value = address1;
        document.querySelector('input[name="address2"]').value = address2;
        document.querySelector('input[name="address3"]').value = address3;
        const countyField = document.querySelector('[name="county"]');
        if (countyField) {
          window.EposCountySelect?.setValue?.(countyField, county);
          if (!window.EposCountySelect?.setValue) countyField.value = county;
        }
        document.querySelector('input[name="postcode"]').value = postcode || "";
        document.querySelector('input[name="country"]').value =
          countryLine || "United Kingdom";
      } else if (defaultAddress && addr) {
        const rawAddr1 = String(addr.addr1 || "").trim();
        const rawAddr2 = String(addr.addr2 || "").trim();
        const addr1IsCustomerName = isCustomerNameAddressLine(
          rawAddr1,
          so.entityFull,
          fullName,
          customerName
        );

        document.querySelector('input[name="address1"]').value = addr1IsCustomerName ? rawAddr2 : rawAddr1;
        document.querySelector('input[name="address2"]').value = addr1IsCustomerName ? "" : rawAddr2;
        document.querySelector('input[name="address3"]').value = addr.city || "";
        const countyField = document.querySelector('[name="county"]');
        if (countyField) {
          window.EposCountySelect?.setValue?.(countyField, addr.state || "");
          if (!window.EposCountySelect?.setValue) countyField.value = addr.state || "";
        }
        document.querySelector('input[name="postcode"]').value = addr.zip || "";
        document.querySelector('input[name="country"]').value =
          addr.country?.refName || addr.country || "United Kingdom";
      } else {
        let addressLines = rawAddress
          ? String(rawAddress).split("\n").map((l) => l.trim()).filter(Boolean)
          : [];

        if (
          addressLines.length &&
          isCustomerNameAddressLine(addressLines[0], so.entityFull, fullName, customerName)
        ) {
          addressLines.shift();
        }

        const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
        let postcode = "";
        let countryLine = "";
        const cleanedAddress = [];

        for (const line of addressLines) {
          if (postcodeRegex.test(line)) {
            const match = line.match(postcodeRegex);
            if (match) postcode = match[0].toUpperCase();

            const townPart = line.replace(postcodeRegex, "").trim();
            if (townPart) cleanedAddress.push(townPart);
          } else if (
            /(United Kingdom|UK|England|Scotland|Wales|Northern Ireland)/i.test(line)
          ) {
            countryLine = line;
          } else {
            cleanedAddress.push(line);
          }
        }

        const countySuffixRegex =
          /\b(East Sussex|West Sussex|Kent|Surrey|Essex|Hampshire|London|Greater London|Devon|Cornwall|Dorset|Somerset|Norfolk|Suffolk|Yorkshire|North Yorkshire|South Yorkshire|West Yorkshire|Lancashire|Cheshire)\b$/i;
        const splitTownCounty = (line) => {
          const value = String(line || "").trim();
          const countyMatch = value.match(countySuffixRegex);
          if (!countyMatch) return { town: value, county: "" };

          const countyValue = countyMatch[1].trim();
          return {
            town: value.slice(0, value.length - countyValue.length).trim(),
            county: countyValue,
          };
        };

        let address1 = cleanedAddress[0] || "";
        let address2 = "";
        let address3 = "";
        let county = "";

        if (cleanedAddress.length === 2) {
          const townCounty = splitTownCounty(cleanedAddress[1]);
          address3 = townCounty.town || cleanedAddress[1] || "";
          county = townCounty.county || "";
        } else {
          address2 = cleanedAddress[1] || "";
          address3 = cleanedAddress[2] || "";
          if (address3) {
            const townCounty = splitTownCounty(address3);
            address3 = townCounty.town || address3;
            county = townCounty.county;
          }
        }

        document.querySelector('input[name="address1"]').value = address1;
        document.querySelector('input[name="address2"]').value = address2;
        document.querySelector('input[name="address3"]').value = address3;
        const countyField = document.querySelector('[name="county"]');
        if (countyField) {
          window.EposCountySelect?.setValue?.(countyField, county);
          if (!window.EposCountySelect?.setValue) countyField.value = county;
        }
        document.querySelector('input[name="postcode"]').value = postcode || "";
        document.querySelector('input[name="country"]').value =
          countryLine || "United Kingdom";
      }
    } catch (err) {
      console.warn("⚠️ Address population failed:", err.message);
    }

    const customerContact = so.entityFull || {};
    document.querySelector('input[name="email"]').value =
      customerContact.email || so.email || "";
    document.querySelector('input[name="contactNumber"]').value =
      customerContact.phone || so.custbody4 || so.phone || "";
    document.querySelector('input[name="altContactNumber"]').value =
      customerContact.altPhone || so.altPhone || "";
    document.querySelector('textarea[name="memo"]').value = so.memo || "";

    window.EposCustomerDetailsUpdate?.show?.(
      so.entityFull?.id || so.entity?.id || customerContact.id,
      so.entityFull || customerContact
    );

    try {
      const entity = so.entityFull || {};
      const titleObj = entity.custentity_title || entity.title || null;
      if (titleObj?.id) {
        const titleSelect = document.querySelector('select[name="title"]');
        if (titleSelect) {
          const match = Array.from(titleSelect.options).find(
            (opt) => String(opt.value) === String(titleObj.id)
          );
          if (match) titleSelect.value = titleObj.id;
        }
      }
    } catch (err) {
      console.warn("⚠️ Title population skipped:", err.message);
    }

    try {
      setSalesExecFromNetSuite(so, users);

      const subsidiaryId =
        so.subsidiary?.id || so.location?.id || so.custbody_sb_primarystore?.id || null;

      if (subsidiaryId && locations.length) {
        const storeMatch = locations.find(
          (loc) =>
            String(loc.netsuite_internal_id) === String(subsidiaryId) ||
            String(loc.invoice_location_id) === String(subsidiaryId)
        );
        if (storeMatch) document.querySelector("#store").value = storeMatch.id;
      }

      const distributionTypeSelect = document.getElementById("distributionOrderType");
      if (distributionTypeSelect) {
        distributionTypeSelect.value = so.custbody_sb_is_web_order?.id || "";
      }
      syncDistributionOrderTypeVisibility();

      document.querySelector('select[name="leadSource"]').value = so.leadSource?.id || "";
      document.querySelector("#paymentInfo").value =
        so.custbody_sb_paymentinfo?.id || "";
      document.querySelector("#warehouse").value =
        so.custbody_sb_warehouse?.id || "";
    } catch (err) {
      console.warn("⚠️ Order meta population failed:", err.message);
    }

    try {
      const warehouseSelect = document.getElementById("warehouse");
      if (warehouseSelect) {
        const updateWarehouseCache = () => {
          window.selectedWarehouseId = warehouseSelect.value.trim();
          window.selectedWarehouseName =
            warehouseSelect.options[warehouseSelect.selectedIndex]?.textContent.trim() || "";
        };
        updateWarehouseCache();
        warehouseSelect.addEventListener("change", updateWarehouseCache);
      }
    } catch (err) {
      console.error("❌ Warehouse cache failed:", err.message);
    }

    unlockCustomFieldControls();

    // ==================================================
    // 4️⃣ Render Item Lines
    // ==================================================
    if (typeof window.renderSalesViewLines !== "function") {
      throw new Error("renderSalesViewLines() not found — did salesViewItemLine.js load?");
    }

    window.renderSalesViewLines({
      so,
      fulfilmentMethods: window._fulfilmentMap || [],
    });

    // ==================================================
    // 6️⃣ Lock / unlock form depending on order status
    // ==================================================
    const statusId = String(so.orderStatus?.id || so.orderstatus?.id || so.orderstatus || so.status || "")
      .trim()
      .toUpperCase();
    const statusNameForEdit = String(
      so.orderStatus?.refName ||
        so.orderstatus?.refName ||
        so.statusRef ||
        (typeof so.status === "object" ? so.status.refName : so.status) ||
        ""
    )
      .trim()
      .toUpperCase();
    const compactStatusId = `${statusId} ${statusNameForEdit}`.replace(/[^A-Z]/g, "");
    const isPendingApproval = statusId === "A" || compactStatusId.includes("PENDINGAPPROVAL");
    const isPendingFulfillment =
      statusId === "B" ||
      compactStatusId.includes("PENDINGFULFILLMENT") ||
      compactStatusId.includes("PENDINGFULFILMENT");

    if (isPendingApproval) {
      window.orderPromotionsEnabled = true;
      window.initOrderPromotions?.();
    }

    if (isPendingApproval) {
      console.log("🔓 Pending approval – unlock editable sales order fields");

      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        if (isSalesViewLockExemptControl(el)) return;

        const isStoreField = el.id === "store" || el.name === "store";
        const isCustomField = el.classList.contains("custom-field-control");

        const allowEdit =
          isCustomField ||
          /*
          el.name === "title" ||
          el.name === "firstName" ||
          el.name === "lastName" ||
          el.name === "email" ||
          el.name === "contactNumber" ||
          el.name === "altContactNumber" ||
          el.name === "address1" ||
          el.name === "address2" ||
          el.name === "address3" ||
          el.name === "county" ||
          el.name === "postcode" ||
          */
          el.name === "country" ||
          el.name === "memo" ||
          el.id === "salesExec" ||
          el.id === "distributionOrderType" ||
          el.name === "leadSource" ||
          el.id === "paymentInfo" ||
          el.id === "warehouse" ||
          el.classList.contains("item-search") ||
          el.classList.contains("item-qty") ||
          el.classList.contains("item-discount") ||
          el.classList.contains("item-saleprice") ||
          el.classList.contains("item-fulfilment") ||
          el.classList.contains("fulfilmentSelect") ||
          el.classList.contains("open-inventory") ||
          el.classList.contains("item-inv-detail") ||
          el.classList.contains("open-options") ||
          el.classList.contains("delete-row") ||
          el.id === "addItemBtn" ||
          el.id === "saveOrderBtn" ||
          el.id === "commitOrderBtn" ||
          el.id === "newMemoBtn" ||
          el.id === "printBtn" ||
          el.id === "addDepositBtn" ||
          el.classList.contains("sales-view-tab");

        if (allowEdit && !isStoreField) {
          el.disabled = false;
          el.classList.remove("locked-input");
        } else {
          el.disabled = true;
          el.classList.add("locked-input");
        }
      });
    } else if (isPendingFulfillment) {
      console.log("📝 Pending fulfillment – allow only memo field editing");

      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        if (isSalesViewLockExemptControl(el)) return;

        if (el.classList.contains("custom-field-control")) {
          el.disabled = false;
          el.classList.remove("locked-input");
        } else if (el.name === "memo") {
          el.disabled = false;
          el.classList.remove("locked-input");
        } else if (
          el.id === "newMemoBtn" ||
          el.id === "raiseCaseBtn" ||
          el.id === "printBtn" ||
          el.id === "manageIntercompanyBtn" ||
          el.classList.contains("open-inventory") ||
          el.classList.contains("open-options") ||
          el.classList.contains("w3w-notes-btn") ||
          el.classList.contains("sales-view-tab")
        ) {
          el.disabled = false;
          el.classList.remove("locked-input");
        } else {
          el.disabled = true;
          el.classList.add("locked-input");
        }
      });

      const addDepositBtn = document.getElementById("addDepositBtn");
      if (addDepositBtn) {
        addDepositBtn.disabled = true;
        addDepositBtn.classList.add("locked-input");
      }
    } else {
      console.log("🔒 Not pending approval or fulfillment – lock everything (read-only)");

      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        if (isSalesViewLockExemptControl(el)) return;

        if (el.classList.contains("custom-field-control")) {
          el.disabled = false;
          el.classList.remove("locked-input");
          return;
        }

        if (
          el.id === "newMemoBtn" ||
          el.id === "printBtn" ||
          el.classList.contains("sales-view-tab")
        ) return;

        el.disabled = true;
        el.classList.add("locked-input");
      });

      const addDepositBtn = document.getElementById("addDepositBtn");
      if (addDepositBtn) {
        addDepositBtn.disabled = true;
        addDepositBtn.classList.add("locked-input");
      }
    }

    // ==================================================
    // 7️⃣ Summary + Action button + Add Deposit
    // ==================================================
    updateOrderSummaryFromTable();
    updateActionButton(so.orderStatus || so.orderstatus || so.status || {}, tranId, so);

    const addDepositBtn = document.getElementById("addDepositBtn");

    function cleanMoneyText(rawValue) {
      if (rawValue == null) return 0;
      const cleaned = String(rawValue).replace(/[^0-9.-]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    }

    if (addDepositBtn) {
      addDepositBtn.disabled = false;
      addDepositBtn.classList.remove("locked-input");

      addDepositBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const outstandingText =
          document.getElementById("outstandingBalance")?.textContent || "";
        const grandTotalText =
          document.getElementById("grandTotal")?.textContent || "";

        let amount = cleanMoneyText(outstandingText);
        if (!(amount > 0)) amount = cleanMoneyText(grandTotalText);

        const popup = window.open(
          `${window.location.origin}/deposit.html?amount=${encodeURIComponent(
            amount.toFixed(2)
          )}`,
          "AddDeposit",
          "width=420,height=520,resizable=yes,scrollbars=no"
        );

        if (!popup) {
          alert("⚠️ Please allow popups for this site to add deposits.");
        } else {
          popup.focus();
        }
      };
    }

    ensureCustomerUpdateButtonUnlocked();

    const currentStatusId = String(
      so.orderStatus?.id || so.orderstatus?.id || so.orderstatus || so.status || ""
    )
      .trim()
      .toUpperCase();
    const warmItemOptions = () => {
      window.itemOptionsCache?.getAll?.().catch((err) => {
        console.warn("Failed to warm item options:", err.message);
      });
    };

    if (currentStatusId === "A") {
      setTimeout(warmItemOptions, 250);
    } else if ("requestIdleCallback" in window) {
      window.requestIdleCallback(warmItemOptions, { timeout: 5000 });
    } else {
      setTimeout(warmItemOptions, 2500);
    }
  } catch (err) {
    console.error("❌ Load failure:", err.message || err);
    alert("Failed to load Sales Order details. " + (err.message || err));
  } finally {
    overlay?.classList.add("hidden");
  }

  syncDistributionOrderTypeVisibility();
});

/* =====================================================
   Memo Panel
===================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const auth = storageGet?.();
  const token = auth?.token || null;

  const memoPanel = document.getElementById("memoPanel");
  const memoHeader = document.querySelector(".memo-header");
  const memoTableBody = document.querySelector("#memoTable tbody");
  const noMemosMsg = document.getElementById("noMemosMsg");

  if (!memoPanel || !memoHeader || !memoTableBody) return;

  const parts = window.location.pathname.split("/");
  const orderId = parts.pop() || parts.pop();

  memoHeader.addEventListener("click", () => {
    memoPanel.classList.toggle("expanded");
  });

  document.getElementById("newMemoBtn")?.addEventListener("click", () => {
    if (!token) return alert("Missing session token");
    const url = `/memo.html?orderId=${orderId}&token=${token}`;
    const w = window.open(
      url,
      "MemoPopup",
      "width=550,height=600,resizable=yes,scrollbars=yes"
    );
    if (!w) alert("Please allow popups.");
  });

  async function loadMemos() {
    try {
      const res = await fetch(`/api/sales/memo/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      memoTableBody.innerHTML = "";
      updateMemoHeader(data.memos?.length || 0);

      if (!data.ok || !data.memos?.length) {
        noMemosMsg.style.display = "block";
        return;
      }

      noMemosMsg.style.display = "none";

      const frag = document.createDocumentFragment();
      data.memos.forEach((m) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${m["Date"] || ""}</td>
          <td>${m["Author"] || ""}</td>
          <td>${m["Title"] || ""}</td>
          <td>${m["Type"] || ""}</td>
          <td>${m["Memo"] || ""}</td>
        `;
        frag.appendChild(tr);
      });

      memoTableBody.appendChild(frag);
    } catch (err) {
      console.error("❌ Failed to load memos:", err.message || err);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.data?.action === "refresh-memos") {
      loadMemos();
    }
  });

  loadMemos();
});

function updateMemoHeader(count) {
  const header = document.getElementById("memoHeaderTitle");
  if (!header) return;
  header.textContent = !count ? "Memos" : `Memos (${count})`;
}

/* =====================================================
   Deposits rendering + totals
===================================================== */
function signedDepositAmount(deposit) {
  if (window.EposFinancials?.depositAmount) {
    return window.EposFinancials.depositAmount(deposit);
  }
  const amount = parseFloat(deposit?.amount || 0) || 0;
  const type = String(deposit?.type || deposit?.Type || "").trim().toLowerCase();
  return type === "customer refund" ? -Math.abs(amount) : amount;
}

function renderDeposits(deposits) {
  const section = document.getElementById("depositsSection");
  const tbody = document.querySelector("#depositsTable tbody");
  const count = document.getElementById("depositCount");
  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");
  if (!section || !tbody) return;

  if (!Array.isArray(deposits) || deposits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">No deposits found.</td></tr>`;
    section.classList.remove("hidden");
    section.style.display = "block";
    if (depositsTotalCell) depositsTotalCell.textContent = "£0.00";
    if (balanceCell) balanceCell.textContent = "£0.00";
    return;
  }

  section.classList.remove("hidden");
  section.style.display = "block";
  if (count) count.textContent = deposits.length;
  tbody.innerHTML = "";

  let totalDeposits = 0;
  const frag = document.createDocumentFragment();

  deposits.forEach((d) => {
    const amount = signedDepositAmount(d);
    totalDeposits += amount;

    const tr = document.createElement("tr");
    const tdLink = document.createElement("td");
    tdLink.innerHTML = d.link || "-";

    const tdMethod = document.createElement("td");
    tdMethod.textContent = String(d.type || "").trim().toLowerCase() === "customer refund"
      ? "Customer Refund"
      : d.method || "-";

    const tdAmount = document.createElement("td");
    tdAmount.textContent = `£${amount.toFixed(2)}`;

    tr.append(tdLink, tdMethod, tdAmount);
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  updateDepositTotals(totalDeposits);
}

function updateDepositTotals(totalDeposits) {
  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");

  const grandTotalText = document.getElementById("grandTotal")?.textContent || "£0.00";
  const grandTotal = parseFloat(grandTotalText.replace(/[£,]/g, "")) || 0;

  let outstanding = grandTotal - totalDeposits;
  outstanding = Math.round(outstanding * 100) / 100;
  if (Math.abs(outstanding) < 0.005) outstanding = 0;

  if (depositsTotalCell) {
    depositsTotalCell.textContent = `£${totalDeposits.toFixed(2)}`;
  }

  if (balanceCell) {
    balanceCell.textContent = `£${outstanding.toFixed(2)}`;
    balanceCell.style.color = outstanding === 0 ? "#008060" : "#d00000";
    balanceCell.style.fontWeight = "600";
  }
}

/* =====================================================
   Deposit saved from popup
===================================================== */
window.onDepositSaved = async (deposit) => {
  if (!deposit || !deposit.id || !deposit.amount) return;

  const soId = window.location.pathname.split("/").pop();
  const addBtn = document.getElementById("addDepositBtn");
  const spinner = document.getElementById("depositSpinner");

  try {
    spinner?.classList.remove("hidden");
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.classList.add("locked-input");
    }

    const savedAuth = storageGet?.();
    const token = savedAuth?.token;

    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`/api/netsuite/salesorder/${soId}/add-deposit`, {
      method: "POST",
      headers,
      body: JSON.stringify(deposit),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Deposit creation failed");

    const newDeposit = {
      link: data.link || "-",
      amount: deposit.amount,
      method: deposit.name,
      soId,
    };

    window._currentDeposits = window._currentDeposits || [];
    window._currentDeposits.push(newDeposit);
    renderDeposits(window._currentDeposits);

    showToast?.(`✅ Deposit £${Number(deposit.amount).toFixed(2)} added`, "success");
  } catch (err) {
    console.error("❌ Add deposit failed:", err.message || err);
    showToast?.(`❌ ${err.message || err}`, "error");
  } finally {
    spinner?.classList.add("hidden");
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.classList.remove("locked-input");
    }
  }
};

/* =====================================================
   Summary from table
===================================================== */
function updateOrderSummaryFromTable() {
  console.log("🧮 updateOrderSummaryFromTable()");

  const rows = document.querySelectorAll("#orderItemsBody tr.order-line");
  if (!rows.length) return;

  let grossTotal = 0;
  let discountTotal = 0;
  let netTotal = 0;
  let taxTotal = 0;

  rows.forEach((row, idx) => {
    const itemId = (row.querySelector(".item-internal-id")?.value || "").trim();
    const qtyInp = row.querySelector(".item-qty");
    const discInp = row.querySelector(".item-discount");
    const saleInp = row.querySelector(".item-saleprice");
    const amountInp = row.querySelector(".item-amount");

    if (itemId && qtyInp && discInp && saleInp && amountInp) {
      const qty = parseFloat(qtyInp.value || 0) || 0;
      if (!qty) return;

      const amountGrossLine = parseFloat(amountInp.value || 0) || 0;
      const saleGrossLine = parseFloat(saleInp.value || 0) || 0;
      const discountPct = parseFloat(discInp.value || 0) || 0;
      const vatFree = !!row.querySelector(".vat-free-checkbox")?.checked;

      let defaultGrossTotal = 0;
      let actualGrossTotal = 0;

      if (Number.isFinite(amountGrossLine) && amountGrossLine !== 0) {
        defaultGrossTotal = amountGrossLine;
      } else if (Number.isFinite(saleGrossLine) && saleGrossLine !== 0) {
        defaultGrossTotal = saleGrossLine;
      }

      if (Number.isFinite(saleGrossLine) && saleGrossLine !== 0) {
        actualGrossTotal = saleGrossLine;
      } else if (discountPct > 0 && defaultGrossTotal > 0) {
        actualGrossTotal = defaultGrossTotal * (1 - discountPct / 100);
      } else {
        actualGrossTotal = defaultGrossTotal;
      }

      defaultGrossTotal = Number(defaultGrossTotal.toFixed(2));
      actualGrossTotal = Number(actualGrossTotal.toFixed(2));

      grossTotal += actualGrossTotal;
      if (vatFree) {
        netTotal += actualGrossTotal;
      } else {
        const lineNet = Number((actualGrossTotal / 1.2).toFixed(2));
        netTotal += lineNet;
        taxTotal += Number((actualGrossTotal - lineNet).toFixed(2));
      }

      const lineDiscount =
        defaultGrossTotal > 0 && actualGrossTotal >= 0
          ? Math.max(0, defaultGrossTotal - actualGrossTotal)
          : 0;

      discountTotal += lineDiscount;

      console.log(`🧾 Editable row ${idx}`, {
        itemId,
        qty,
        amountGrossLine,
        saleGrossLine,
        discountPct,
        defaultGrossTotal,
        actualGrossTotal,
        lineDiscount,
      });

      return;
    }

    const amountEl = row.querySelector(".amount");
    const saleEl = row.querySelector(".saleprice");

    if (!saleEl) return;

    const sale = parseFloat((saleEl.textContent || "").replace(/[£,]/g, "")) || 0;
    const amount = amountEl
      ? parseFloat((amountEl.textContent || "").replace(/[£,]/g, "")) || 0
      : sale;

    grossTotal += sale;
    const vatFree = !!row.querySelector(".vat-free-checkbox")?.checked;
    if (vatFree) {
      netTotal += sale;
    } else {
      const lineNet = Number((sale / 1.2).toFixed(2));
      netTotal += lineNet;
      taxTotal += Number((sale - lineNet).toFixed(2));
    }

    const lineDiscount =
      amount > 0 && sale >= 0 ? Math.max(0, amount - sale) : 0;

    discountTotal += lineDiscount;
  });

  grossTotal = Number(grossTotal.toFixed(2));
  discountTotal = Number(discountTotal.toFixed(2));
  netTotal = Number(netTotal.toFixed(2));
  taxTotal = Number(taxTotal.toFixed(2));

  const subTotalEl = document.getElementById("subTotal");
  const discountEl = document.getElementById("discountTotal");
  const taxEl = document.getElementById("taxTotal");
  const grandEl = document.getElementById("grandTotal");

  if (subTotalEl) subTotalEl.textContent = `£${netTotal.toFixed(2)}`;
  if (discountEl) discountEl.textContent = `£${discountTotal.toFixed(2)}`;
  if (taxEl) taxEl.textContent = `£${taxTotal.toFixed(2)}`;
  if (grandEl) grandEl.textContent = `£${grossTotal.toFixed(2)}`;

  if (typeof updateDepositTotals === "function") {
    const totalDeposits = Array.isArray(window._currentDeposits)
      ? window._currentDeposits.reduce((sum, d) => sum + signedDepositAmount(d), 0)
      : 0;

    updateDepositTotals(totalDeposits);
  }

  console.log("📊 Summary recalculated", {
    grossTotal,
    netTotal,
    taxTotal,
    discountTotal,
  });
}

document.getElementById("orderItemsBody")?.addEventListener("input", (e) => {
  if (
    e.target.classList.contains("item-qty") ||
    e.target.classList.contains("item-discount") ||
    e.target.classList.contains("item-saleprice") ||
    e.target.classList.contains("item-amount")
  ) {
    updateOrderSummaryFromTable();
  }
});

document.getElementById("orderItemsBody")?.addEventListener("change", (e) => {
  if (e.target.classList.contains("vat-free-checkbox")) {
    updateOrderSummaryFromTable();
  }
});

function receiptMoneyValue(value) {
  return parseFloat(String(value || "0").replace(/[^0-9.-]/g, "")) || 0;
}

function receiptSelectedText(selector) {
  const el = typeof selector === "string" ? document.querySelector(selector) : selector;
  return el?.options?.[el.selectedIndex]?.textContent?.trim() || "";
}

function receiptCellText(row, selector, fallbackCellIndex) {
  const direct = row.querySelector(selector);
  if (direct) {
    if ("value" in direct) return direct.value?.trim() || "";
    return direct.innerText?.trim() || direct.textContent?.trim() || "";
  }
  const cell = row.children?.[fallbackCellIndex];
  return cell?.innerText?.trim() || cell?.textContent?.trim() || "";
}

function salesOrderViewBooleanFieldValue(value) {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (Array.isArray(value)) return value.some(salesOrderViewBooleanFieldValue);
  if (typeof value === "object") {
    return salesOrderViewBooleanFieldValue(
      value.value ?? value.id ?? value.refName ?? value.text ?? value.name ?? value.label
    );
  }

  const normalized = String(value).trim().toLowerCase();
  return ["t", "true", "1", "yes", "y", "checked", "closed"].includes(normalized);
}

function salesOrderViewLineIsClosed(line = {}) {
  if (typeof window.salesViewLineIsClosed === "function") {
    return window.salesViewLineIsClosed(line);
  }

  return [
    line.isclosed,
    line.isClosed,
    line.closed,
    line._closed,
    line.lineclosed,
    line.lineClosed,
    line["Is Closed"],
    line["Line Closed"],
    line["Closed"],
  ].some(salesOrderViewBooleanFieldValue);
}

function buildSalesReceiptPayloadFromDom(tranId) {
  const so = window._currentSalesOrder || {};
  const items = [...document.querySelectorAll("#orderItemsBody tr.order-line")]
    .map((row) => {
      const itemId = row.querySelector(".item-internal-id")?.value?.trim() || row.dataset.itemId || "";
      const name = receiptCellText(row, ".item-search", 1);
      if (!itemId && !name) return null;

      const quantity = receiptMoneyValue(receiptCellText(row, ".item-qty", 2)) || 1;
      const saleGrossLine = receiptMoneyValue(
        row.querySelector(".item-saleprice")?.value ||
          row.querySelector(".saleprice")?.innerText ||
          row.children?.[7]?.innerText
      );
      const retailGrossLine =
        receiptMoneyValue(
          row.querySelector(".item-amount")?.value ||
            row.querySelector(".amount")?.innerText ||
            row.children?.[4]?.innerText
        ) || saleGrossLine;

      return {
        name: name || "Item",
        options: receiptCellText(row, ".options-summary", 2),
        quantity,
        retailGrossLine,
        saleGrossLine,
        inventoryDetail: row.querySelector(".item-inv-detail")?.value || "",
        inventoryMeta: row.dataset.inventoryMeta || "",
      };
    })
    .filter(Boolean);

  return {
    type: "sale",
    customer: {
      firstName: document.querySelector('input[name="firstName"]')?.value || "",
      lastName: document.querySelector('input[name="lastName"]')?.value || "",
      address1: document.querySelector('input[name="address1"]')?.value || "",
      address2: document.querySelector('input[name="address2"]')?.value || "",
      address3: document.querySelector('input[name="address3"]')?.value || "",
      county: document.querySelector('[name="county"]')?.value || "",
      postcode: document.querySelector('input[name="postcode"]')?.value || "",
      email: document.querySelector('input[name="email"]')?.value || "",
      contactNumber: document.querySelector('input[name="contactNumber"]')?.value || "",
    },
    order: {
      tranId: so.tranId || tranId,
      salesDate: so.tranDate || so.trandate || "",
      salesExecName: receiptSelectedText(document.getElementById("salesExec")) ||
        so.custbody_sb_bedspecialist?.refName ||
        "",
      store: document.getElementById("store")?.value || "",
      storeName: receiptSelectedText(document.getElementById("store")),
      paymentInfoName: receiptSelectedText(document.getElementById("paymentInfo")) ||
        so.custbody_sb_paymentinfo?.refName ||
        "",
    },
    items,
    deposits: Array.isArray(window._currentDeposits) ? window._currentDeposits : [],
  };
}

/* =====================================================
   Print receipt
===================================================== */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#printBtn");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const parts = window.location.pathname.split("/").filter(Boolean);
  const tranId = parts[parts.length - 1];

  if (!tranId) {
    alert("⚠️ Could not determine receipt transaction ID.");
    return;
  }

  const payload = buildSalesReceiptPayloadFromDom(tranId);
  const url = window.EposPendingReceipt?.create?.("sale", payload) || `/sales/reciept/${tranId}`;
  const receiptWin = window.open(url, "_blank");

  if (!receiptWin) {
    window.location.href = url;
    return;
  }

  receiptWin.focus();
});

/* =====================================================
   Commit / save buttons
===================================================== */
function showCommitInline(message = "Committing…") {
  const wrap = document.getElementById("commitInlineStatus");
  const text = document.getElementById("commitInlineText");
  if (text) text.textContent = message;
  wrap?.classList.remove("hidden");
}

function hideCommitInline() {
  document.getElementById("commitInlineStatus")?.classList.add("hidden");
}

function validateSalesViewItemsBeforeSave() {
  const rows = [...document.querySelectorAll("#orderItemsBody .order-line")];
  const errors = [];

  rows.forEach((row) => {
    row.classList.remove("row-error");
    row.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
  });

  const dirtyEmptyRows = rows.filter((row) => {
    const itemId = (row.querySelector(".item-internal-id")?.value || "").trim();
    if (itemId) return false;

    const itemText = (row.querySelector(".item-search")?.value || "").trim();
    const amount = parseFloat(row.querySelector(".item-amount")?.value || "0") || 0;
    const sale = parseFloat(row.querySelector(".item-saleprice")?.value || "0") || 0;
    const discount = parseFloat(row.querySelector(".item-discount")?.value || "0") || 0;
    const options = (row.querySelector(".options-summary")?.innerText || "").trim();
    return !!(itemText || amount !== 0 || sale !== 0 || discount !== 0 || options);
  });

  dirtyEmptyRows.forEach((row) => {
    const lineNo = row.getAttribute("data-line") || "?";
    errors.push(`• Line ${lineNo}: Select a valid item from the item search.`);
    row.classList.add("row-error");
    row.querySelector(".item-search")?.classList.add("field-error");
  });

  const itemRows = rows.filter((row) =>
    (row.querySelector(".item-internal-id")?.value || "").trim()
  );

  if (itemRows.length === 0) {
    alert("⚠️ Please add at least one item to the sales order before saving.");
    return false;
  }

  itemRows.forEach((row, idx) => {
    const lineNo = row.getAttribute("data-line") || String(idx + 1);
    const itemClass = (row.dataset.itemClass || "").trim().toLowerCase();
    const isService = itemClass === "service" || itemClass.includes("service");

    const qtyEl = row.querySelector(".item-qty") || row.querySelector(".item-qty-cache");
    const quantity = parseFloat(qtyEl?.value || "0") || 0;
    if (quantity <= 0) {
      errors.push(`• Line ${lineNo}: Quantity must be greater than zero.`);
      row.classList.add("row-error");
      qtyEl?.classList.add("field-error");
    }

    const fulfilSel = row.querySelector(".item-fulfilment") || row.querySelector(".fulfilmentSelect");
    const fulfilId = (fulfilSel?.value || "").trim();
    const fulfilText =
      fulfilSel?.options?.[fulfilSel.selectedIndex]?.textContent?.trim().toLowerCase() ||
      row.querySelector(".fulfilment-cell")?.textContent?.trim().toLowerCase() ||
      "";

    if (!isService && !fulfilId) {
      errors.push(`• Line ${lineNo}: Fulfilment Method is required.`);
      row.classList.add("row-error");
      fulfilSel?.classList.add("field-error");
    }

    const hasOptionsButton = !!row.querySelector(".open-options");
    if (hasOptionsButton) {
      const optionsJson = (row.querySelector(".item-options-json")?.value || "").trim();
      const optionsSummary = (row.querySelector(".options-summary")?.innerText || "").trim();

      let hasJsonValue = false;
      if (optionsJson && optionsJson !== "{}") {
        try {
          const parsed = JSON.parse(optionsJson);
          hasJsonValue = Object.values(parsed).some((val) => {
            if (Array.isArray(val)) return val.length > 0;
            return !!String(val || "").trim();
          });
        } catch {
          hasJsonValue = false;
        }
      }

      if (!hasJsonValue && !optionsSummary) {
        errors.push(`• Line ${lineNo}: Item Options must be selected.`);
        row.classList.add("row-error");
        row.querySelector(".options-cell")?.classList.add("field-error");
      }
    }

    const requiresInventory =
      !isService && (fulfilText === "warehouse" || fulfilText === "in store");

    if (requiresInventory) {
      const invHidden = row.querySelector(".item-inv-detail");
      const invHasValue = !!(invHidden?.value || "").trim();
      const hasLot = !!(row.dataset.lotnumber || "").trim();
      const hasMeta = !!(row.dataset.inventoryMeta || "").trim();
      const isBackOrder = row.dataset.backorder === "1";

      if (!invHasValue && !hasLot && !hasMeta && !isBackOrder) {
        errors.push(
          `• Line ${lineNo}: Inventory Detail is required for "${
            fulfilText === "warehouse" ? "Warehouse" : "In Store"
          }".`
        );
        row.classList.add("row-error");
        (
          row.querySelector(".inventory-cell") ||
          row.querySelector(".inventory-cell-wrapper")
        )?.classList.add("field-error");
      }
    }

    const trialSelect = row.querySelector(".sixty-night-select");
    const trialVisible =
      trialSelect &&
      trialSelect.offsetParent !== null &&
      trialSelect.closest(".sixty-night-cell")?.style.display !== "none";

    if (trialVisible && !(trialSelect.value || "").trim()) {
      errors.push(`â€¢ Line ${lineNo}: 60 Night Trial is required.`);
      row.classList.add("row-error");
      trialSelect.classList.add("field-error");
    }
  });

  if (errors.length) {
    alert("Please fix the following before saving:\n\n" + errors.join("\n"));
    return false;
  }

  return true;
}

function ensureSalesViewClientLineKey(row) {
  if (!row) return "";
  if (!row.dataset.clientLineKey) {
    const lineHint = row.dataset.line || "row";
    row.dataset.clientLineKey = `sv-${lineHint}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }
  return row.dataset.clientLineKey;
}

function applySavedSalesLineIdentity(restletResult) {
  const updatedLines = Array.isArray(restletResult?.updatedLines)
    ? restletResult.updatedLines
    : [];
  if (!updatedLines.length) return false;

  let applied = false;

  updatedLines.forEach((line) => {
    const clientLineKey = String(line?.clientLineKey || "").trim();
    const savedLineId = String(line?.lineId || line?.line || "").trim();
    const savedLineIndex = Number(line?.lineIndex ?? line?.line);
    let row = null;

    if (clientLineKey) {
      row = [...document.querySelectorAll("#orderItemsBody tr.order-line")].find(
        (candidate) => candidate.dataset.clientLineKey === clientLineKey
      );
    }

    if (!row && Number.isFinite(savedLineIndex)) {
      row = [...document.querySelectorAll("#orderItemsBody tr.order-line")].find(
        (candidate) => Number(candidate.dataset.line) === savedLineIndex
      );
    }

    if (!row || !savedLineId) return;

    row.dataset.lineid = savedLineId;
    row.dataset.isnew = "";

    const currentLines = window._currentSalesOrder?.item?.items;
    if (Array.isArray(currentLines)) {
      const existing = currentLines.find(
        (currentLine) => String(currentLine?.lineId || "").trim() === savedLineId
      );
      if (!existing) {
        currentLines.push({
          lineId: savedLineId,
          item: { id: row.querySelector(".item-internal-id")?.value?.trim() || "" },
        });
      }
    }

    applied = true;
  });

  return applied;
}

function updateActionButton(orderStatusObj, tranId, so) {
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;

  wrapper.innerHTML = "";

  function showCommitInlineLocal(message = "Working…") {
    const wrap = document.getElementById("commitInlineStatus");
    const text = document.getElementById("commitInlineText");
    if (text) text.textContent = message;
    wrap?.classList.remove("hidden");
  }

  function hideCommitInlineLocal() {
    document.getElementById("commitInlineStatus")?.classList.add("hidden");
  }

  function showCommitOverlay(message = "Committing Sales Order...") {
    const overlay = document.getElementById("commitSpinner");
    if (!overlay) return;
    const text = overlay.querySelector("p");
    if (text) text.textContent = message;
    overlay.classList.remove("hidden");
  }

  function hideCommitOverlay() {
    document.getElementById("commitSpinner")?.classList.add("hidden");
  }

  const statusId =
    typeof orderStatusObj === "string"
      ? orderStatusObj.trim().toUpperCase()
      : String(orderStatusObj?.id || "").toUpperCase();
  const statusName =
    typeof orderStatusObj === "string"
      ? ""
      : String(orderStatusObj?.refName || "").toLowerCase();

  const isPendingApproval = statusId === "A" || statusName.includes("approval");
  const isPendingFulfillment = statusId === "B" || statusName.includes("fulfillment");

  if (!isPendingApproval && !isPendingFulfillment) return;

  function setOrderMutationBusy(isBusy) {
    window._salesOrderMutationInFlight = !!isBusy;
    wrapper.setAttribute("aria-busy", isBusy ? "true" : "false");

    ["saveOrderBtn", "commitOrderBtn"].forEach((buttonId) => {
      const button = document.getElementById(buttonId);
      if (!button) return;
      button.disabled = !!isBusy;
      button.classList.toggle("locked-input", !!isBusy);
    });
  }

  function orderMutationIsBusy() {
    return window._salesOrderMutationInFlight === true;
  }

  if (isPendingFulfillment) {
    // For pending fulfillment, only show Save button (for memo updates)
    wrapper.innerHTML = `
      <button id="saveOrderBtn" class="btn-secondary">Save</button>
    `;
  } else {
    // For pending approval, show both Save and Commit buttons
    wrapper.innerHTML = `
      <button id="saveOrderBtn" class="btn-secondary">Save</button>
      <button id="commitOrderBtn" class="btn-primary">Commit</button>
    `;
  }

  function collectEditableSalesLines() {
    return [...document.querySelectorAll("#orderItemsBody tr.order-line")]
      .map((row, rowIndex) => {
        let itemId = row.querySelector(".item-internal-id")?.value?.trim() || "";

        if (!itemId) {
          const itemName = row.querySelector(".item-search")?.value?.trim() || "";
          if (itemName && Array.isArray(window.items)) {
            const match = window.items.find(
              (it) =>
                String(it["Name"] || "").trim().toLowerCase() ===
                itemName.toLowerCase()
            );
            itemId = String(match?.["Internal ID"] || "").trim();
          }
        }

        const quantity =
          parseFloat(
            row.querySelector(".item-qty")?.value ||
              row.querySelector(".item-qty-cache")?.value ||
              row.querySelector(".qty")?.textContent ||
              "0"
          ) || 0;

        const fulfilSel =
          row.querySelector(".item-fulfilment") ||
          row.querySelector(".fulfilmentSelect");

        let fulfilmentMethod = fulfilSel?.value?.trim() || "";
        const itemClass = String(row.dataset.itemClass || "").trim();
        const isServiceLine = itemClass.toLowerCase().includes("service");

        if (!fulfilmentMethod && !isServiceLine) {
          const currentRef =
            row.querySelector(".fulfilment-cell")?.textContent?.trim() || "";
          if (currentRef && Array.isArray(window._fulfilmentMap)) {
            const match = window._fulfilmentMap.find(
              (f) => f.name?.toLowerCase() === currentRef.toLowerCase()
            );
            fulfilmentMethod = match?.id || "";
          }
        }

        if (isServiceLine) fulfilmentMethod = "";

        const inventoryDetail = row.querySelector(".item-inv-detail")?.value || "";
        const inventoryMeta = row.dataset.inventoryMeta || "";
        const lotnumber = row.dataset.lotnumber || "";
        const lotDetails =
          window.salesViewFormatLotDetailsFromInventoryDetail?.(inventoryMeta || inventoryDetail) ||
          window.formatLotDetailsFromInventoryDetail?.(inventoryMeta || inventoryDetail) ||
          row.dataset.lotDetails ||
          "";
        const discountPct =
          parseFloat(
            row.querySelector(".item-discount")?.value ||
              row.querySelector(".discount")?.textContent?.replace(/[^0-9.-]/g, "") ||
              "0"
          ) || 0;
        const saleGrossLine =
          parseFloat(
            row.querySelector(".item-saleprice")?.value ||
              row.querySelector(".saleprice")?.textContent?.replace(/[^0-9.-]/g, "") ||
              "0"
          ) || 0;
        const amountGrossLine =
          parseFloat(
            row.querySelector(".item-amount")?.value ||
              row.querySelector(".amount")?.textContent?.replace(/[^0-9.-]/g, "") ||
              "0"
          ) || 0;

        const optionsText =
          row
            .querySelector(".options-summary")
            ?.innerHTML?.trim()
            .replace(/<br\s*\/?>/gi, "\n") || "";
        const vatFree = !!row.querySelector(".vat-free-checkbox")?.checked;
        const trialOption = row.querySelector(".sixty-night-select")?.value?.trim() || "";
        const takenFromStore = row.dataset.takenFromStore === "1";
        const clientLineKey = ensureSalesViewClientLineKey(row);

        const netAmount = Number.isFinite(amountGrossLine)
          ? Number((amountGrossLine / 1.2).toFixed(2))
          : 0;

        return {
          lineId: row.dataset.lineid || "",
          clientLineKey,
          lineIndex: Number.isFinite(Number(row.dataset.line))
            ? Number(row.dataset.line)
            : rowIndex,
          itemId,
          item: itemId ? { id: itemId } : undefined,
          class: itemClass,
          quantity,
          fulfilmentMethod: fulfilmentMethod || null,
          inventoryDetail: inventoryDetail || null,
          inventoryMeta: inventoryMeta || null,
          lotnumber: lotnumber || null,
          lotDetails: lotDetails || null,
          discountPct,
          discount: discountPct,
          saleGrossLine,
          amountGrossLine,
          grossAmount: amountGrossLine,
          grossSaleprice: saleGrossLine,
          netAmount,
          amount: amountGrossLine,
          saleprice: saleGrossLine,
          optionsSummary: optionsText || null,
          trialOption: trialOption || null,
          takenFromStore,
          taxCode: vatFree ? "10" : "",
          isNew: !row.dataset.lineid,
        };
      })
      .filter((r) => r.itemId && r.quantity > 0);
  }

  function buildPayloadFromUI() {
    const selectedSalesExecUserId = document.getElementById("salesExec")?.value || "";

    const selectedSalesExecUser = (window._salesUsers || []).find(
      (u) => String(u.id) === String(selectedSalesExecUserId)
    );

    const selectedSalesExecNsId =
      selectedSalesExecUser?.netsuiteId ||
      selectedSalesExecUser?.netsuiteid ||
      document.getElementById("salesExec")?.selectedOptions?.[0]?.dataset?.netsuiteId ||
      null;
    const shipAddress = [
      document.querySelector('input[name="address1"]')?.value,
      document.querySelector('input[name="address2"]')?.value,
      document.querySelector('input[name="address3"]')?.value,
      window.EposCountySelect?.getName?.(document.querySelector('[name="county"]')) ||
        document.querySelector('[name="county"]')?.value,
      document.querySelector('input[name="postcode"]')?.value,
    ]
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .join("\n");

    const headerUpdates = {
      title: document.querySelector('select[name="title"]')?.value || null,
      firstName:
        document.querySelector('input[name="firstName"]')?.value?.trim() || null,
      lastName:
        document.querySelector('input[name="lastName"]')?.value?.trim() || null,
      email: document.querySelector('input[name="email"]')?.value?.trim() || null,
      contactNumber:
        document.querySelector('input[name="contactNumber"]')?.value?.trim() || null,
      altContactNumber:
        document.querySelector('input[name="altContactNumber"]')?.value?.trim() || null,
      address1:
        document.querySelector('input[name="address1"]')?.value?.trim() || null,
      address2:
        document.querySelector('input[name="address2"]')?.value?.trim() || null,
      address3:
        document.querySelector('input[name="address3"]')?.value?.trim() || null,
      county:
        document.querySelector('[name="county"]')?.value?.trim() || null,
      postcode:
        document.querySelector('input[name="postcode"]')?.value?.trim() || null,
      country:
        document.querySelector('input[name="country"]')?.value?.trim() || null,
      memo: document.querySelector('textarea[name="memo"]')?.value?.trim() || null,
      salesExec: selectedSalesExecNsId,
      distributionOrderType:
        document.getElementById("distributionOrderTypeWrapper")?.style.display === "none"
          ? null
          : document.getElementById("distributionOrderType")?.value || null,
      leadSource: document.querySelector('select[name="leadSource"]')?.value || null,
      paymentInfo: document.getElementById("paymentInfo")?.value || null,
      store: document.getElementById("store")?.value || null,
      storeName: document.getElementById("store")?.selectedOptions?.[0]?.textContent?.trim() || null,
      warehouse: document.getElementById("warehouse")?.value || null,
      shipaddress: window.selectedShipAddress || shipAddress || null,
    };

    const lines = collectEditableSalesLines();
    const visibleLineIds = new Set(
      [...document.querySelectorAll("#orderItemsBody tr.order-line")]
        .map((row) => String(row.dataset.lineid || "").trim())
        .filter(Boolean)
    );

    const originalLineIds = (so?.item?.items || [])
      .filter((line) => !salesOrderViewLineIsClosed(line))
      .map((line) => String(line.lineId || "").trim())
      .filter(Boolean);

    const deletedLineIds = originalLineIds.filter((id) => !visibleLineIds.has(id));

    console.log("Sales order save payload summary:", {
      lines: lines.length,
      deletedLines: deletedLineIds.length,
      headerFields: Object.keys(headerUpdates).filter((key) => headerUpdates[key] != null),
    });

    if ((so?.item?.items || []).length > 0 && lines.length === 0) {
      throw new Error(
        "No item lines were collected from the sales order view. Please refresh before saving."
      );
    }

    return {
      headerUpdates,
      lines,
      deletedLineIds,
    };
  }

  function stableSalesSaveSignature(payload) {
    return JSON.stringify(payload || {});
  }

  function salesOrderUiHasChanges() {
    try {
      const payload = buildPayloadFromUI();
      return stableSalesSaveSignature(payload) !== window._lastSalesOrderSaveSignature;
    } catch (err) {
      console.warn("Could not compare Sales Order save signature:", err.message || err);
      return true;
    }
  }

  function salesOrderHasAnyUnsavedChanges() {
    return salesOrderUiHasChanges() || customFieldsHaveChanges();
  }

  function refreshCommitButtonLabel() {
    const button = document.getElementById("commitOrderBtn");
    if (!button) return;
    button.textContent = salesOrderHasAnyUnsavedChanges() ? "Save & Commit" : "Commit";
  }

  function bindSalesOrderDirtyTracking() {
    if (wrapper.dataset.dirtyTrackingBound === "1") return;
    wrapper.dataset.dirtyTrackingBound = "1";

    const refresh = () => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(refreshCommitButtonLabel);
      } else {
        refreshCommitButtonLabel();
      }
    };

    const orderRoot = document.querySelector("main") || document;
    orderRoot.addEventListener("input", refresh);
    orderRoot.addEventListener("change", refresh);
    orderRoot.addEventListener("click", (event) => {
      if (
        event.target.closest(".delete-row") ||
        event.target.closest("#addItemBtn") ||
        event.target.closest(".open-inventory") ||
        event.target.closest(".open-options")
      ) {
        setTimeout(refreshCommitButtonLabel, 0);
      }
    });
  }

  async function saveSalesOrderChanges({
    token,
    button = null,
    reloadAfterSave = false,
    showNoChangeToast = true,
  } = {}) {
    let payload;
    let signature;
    try {
      payload = buildPayloadFromUI();
      signature = stableSalesSaveSignature(payload);
    } catch (err) {
      console.error("Sales order payload build failed:", err.message || err);
      throw err;
    }

    const hasOrderChanges = signature !== window._lastSalesOrderSaveSignature;
    const hasCustomChanges = customFieldsHaveChanges();

    if (!hasOrderChanges && !hasCustomChanges) {
      if (showNoChangeToast) showToast?.("No order changes to save.", "success");
      return { changed: false };
    }

    let restletResult = null;
    if (hasOrderChanges) {
      const res = await fetch(`/api/netsuite/salesorder/${tranId}/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save order");
      restletResult = data.restletResult;
      applySavedSalesLineIdentity(restletResult);
      window._lastSalesOrderSaveSignature = stableSalesSaveSignature(buildPayloadFromUI());
    }

    if (hasCustomChanges) {
      const customResult = await saveCustomFieldsForCurrentOrder({ button });
      if (!customResult.ok) throw customResult.error || new Error("Failed to save custom fields");
    }

    refreshCommitButtonLabel();

    if (reloadAfterSave) {
      setTimeout(() => {
        window.location.reload();
      }, 800);
    }

    return { changed: true, restletResult };
  }

  try {
    window._lastSalesOrderSaveSignature = stableSalesSaveSignature(buildPayloadFromUI());
  } catch (err) {
    console.warn("Could not create initial Sales Order save signature:", err.message || err);
    window._lastSalesOrderSaveSignature = "";
  }

  bindSalesOrderDirtyTracking();
  refreshCommitButtonLabel();

  const saveBtn = document.getElementById("saveOrderBtn");
  if (saveBtn) {
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    const freshSaveBtn = document.getElementById("saveOrderBtn");

    freshSaveBtn.addEventListener("click", async () => {
      if (orderMutationIsBusy()) return;

      const savedAuth = storageGet?.();
      const token = savedAuth?.token;
      if (!token) return (window.location.href = "/index.html");

      if (isPendingApproval && !validateSalesViewItemsBeforeSave()) return;

      setOrderMutationBusy(true);
      showCommitInlineLocal("Saving…");

      try {
        const saveResult = await saveSalesOrderChanges({
          token,
          button: freshSaveBtn,
          reloadAfterSave: true,
        });

        if (saveResult.changed) {
          showToast?.("Saved (not committed)", "success");
          showCommitInlineLocal("Saved");
        } else {
          showCommitInlineLocal("No changes");
          setTimeout(() => hideCommitInlineLocal(), 800);
        }
      } catch (err) {
        console.error("❌ Save error:", err.message || err);
        showToast?.(`❌ ${err.message || err}`, "error");
        showCommitInlineLocal("Save failed ❌");
        setTimeout(() => hideCommitInlineLocal(), 1500);
      } finally {
        setOrderMutationBusy(false);
      }
    });
  }

window.onInventorySaved = function (itemId, detailString, lineIndex) {
  try {
    let row = null;

    // ✅ 1) prefer exact row remembered when popup was opened
    if (window.__salesInventoryTargetRowLine != null) {
      row = document.querySelector(
        `#orderItemsBody tr.order-line[data-line="${window.__salesInventoryTargetRowLine}"]`
      );
    }

    // ✅ 2) fallback to callback lineIndex
    if (!row && lineIndex != null) {
      row = document.querySelector(
        `#orderItemsBody tr.order-line[data-line="${lineIndex}"]`
      );
    }

    // ✅ 3) final fallback by item id (best effort)
    if (!row && itemId) {
      const matches = [
        ...document.querySelectorAll("#orderItemsBody tr.order-line"),
      ].filter(
        (r) =>
          String(r.querySelector(".item-internal-id")?.value || "").trim() ===
          String(itemId).trim()
      );

      row = matches[matches.length - 1] || null;
    }

    if (!row) {
      console.warn("⚠️ onInventorySaved: row not found", { itemId, lineIndex });
      return;
    }

    if (String(detailString || "").trim() === "__BACK_ORDER__") {
      row.dataset.lotDetails = "";
      row.dataset.lotnumber = "";
      row.dataset.inventoryMeta = "";
      row.dataset.invdetail = "";
      const backOrderInput = row.querySelector(".item-inv-detail");
      if (backOrderInput) backOrderInput.value = "";
      refreshCommitButtonLabel();
      return;
    }

    row.dataset.lotDetails =
      window.salesViewFormatLotDetailsFromInventoryDetail?.(detailString || "") ||
      window.formatLotDetailsFromInventoryDetail?.(detailString || "") ||
      "";
    row.dataset.invdetail = detailString || "";

    const invInp = row.querySelector(".item-inv-detail");
    if (invInp) invInp.value = detailString || "";

    const summary = row.querySelector(".inv-summary");
    if (summary) summary.textContent = detailString || "";

    const btn = row.querySelector(".open-inventory");
    const qty =
      parseInt(
        row.querySelector(".item-qty")?.value ||
          row.querySelector(".item-qty-cache")?.value ||
          "0",
        10
      ) || 0;

    const allocated = (detailString || "")
      .split(";")
      .map((p) => parseInt(p.trim().split("|")[0], 10) || 0)
      .reduce((a, b) => a + b, 0);

    if (btn) btn.textContent = qty > 0 && allocated === qty ? "✅" : "📦";

    const fulfilSel =
      row.querySelector(".item-fulfilment") || row.querySelector(".fulfilmentSelect");
    if (fulfilSel && window.SalesLineUI?.validateInventoryForRow) {
      window.SalesLineUI.validateInventoryForRow(row);
    }

    if (typeof updateOrderSummaryFromTable === "function") {
      updateOrderSummaryFromTable();
    }

    refreshCommitButtonLabel();

    // ✅ clear remembered target after successful writeback
    window.__salesInventoryTargetRowLine = null;
    window.__salesInventoryTargetItemId = null;

    console.log("✅ Inventory saved into Sales View row", {
      targetRowLine: row.dataset.line,
      itemId,
      lineIndex,
    });
  } catch (err) {
    console.error("❌ onInventorySaved failed:", err.message || err);
  }
};

  const commitBtn = document.getElementById("commitOrderBtn");
  if (!commitBtn) return;

  commitBtn.replaceWith(commitBtn.cloneNode(true));
  const freshCommitBtn = document.getElementById("commitOrderBtn");

  freshCommitBtn.addEventListener("click", async () => {
    if (orderMutationIsBusy()) return;

    const savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    if (!validateSalesViewItemsBeforeSave()) return;

    setOrderMutationBusy(true);
    const requiresSaveFirst = salesOrderHasAnyUnsavedChanges();
    const initialMessage = requiresSaveFirst
      ? "Saving Sales Order..."
      : "Committing Sales Order....";
    showCommitInlineLocal(initialMessage);
    showCommitOverlay(initialMessage);

    try {
      if (requiresSaveFirst) {
        await saveSalesOrderChanges({
          token,
          button: null,
          showNoChangeToast: false,
        });
      }

      showCommitInlineLocal("Committing Sales Order....");
      showCommitOverlay("Committing Sales Order....");

      const payload = buildPayloadFromUI();
      const res = await fetch(`/api/netsuite/salesorder/${tranId}/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to commit order");

      showToast?.(`Order ${tranId} approved!`, "success");
      showCommitInlineLocal("Committed. Refreshing...");
      showCommitOverlay("Committed. Refreshing...");

      setTimeout(() => {
        const refreshUrl = new URL(window.location.href);
        refreshUrl.searchParams.set("refresh", "1");
        refreshUrl.searchParams.set("_", String(Date.now()));
        window.location.replace(refreshUrl.toString());
      }, 1000);
    } catch (err) {
      console.error("Commit error:", err.message || err);
      showToast?.(`${err.message || err}`, "error");

      showCommitInlineLocal("Commit failed");
      hideCommitOverlay();
      setTimeout(() => hideCommitInlineLocal(), 2000);

      setOrderMutationBusy(false);
    }
  });
}
