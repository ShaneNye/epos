/**
 * salesCustomerLock.js
 * -------------------------------------------------------------
 * Locks customer, contact info, order details, and order items until confirmed.
 * Allows full unlock when pencil icon clicked.
 * After first confirm, triggers confirmation alert if store or warehouse is changed.
 *
 * Update:
 *  - Payment Info is mandatory on Sales Order pages
 *  - Payment Info is OPTIONAL on Quote pages
 *  - "No address required" skips postcode requirement
 *  - "No address required" forces new customer and skips customer match lookup
 *
 * Fixes:
 *  - Cancel on store/warehouse now correctly reverts to the prior value (not null/blank)
 *  - Order items unlock after Confirm (original behaviour restored)
 */

document.addEventListener("DOMContentLoaded", () => {
  const confirmBtn = document.getElementById("confirmCustomerBtn");
  const customerSection = document.getElementById("customerInfoSection");
  const contactSection = document.getElementById("contactInfoSection");
  const orderDetailsSection = document.getElementById("orderDetailsSection");
  const orderItemsSection = document.querySelector(".order-items-section");

  if (!customerSection) return;

  const getAuthHeaders = (extra = {}) => {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return {
      ...extra,
      ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
    };
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const valueFrom = (obj, keys) => {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== undefined && value !== null && value !== "") {
        if (typeof value === "object") return value.id || value.value || value.refName || value.name || "";
        return value;
      }
    }
    return "";
  };

  const normalizeCustomerNameLine = (value) =>
    String(value || "")
      .replace(/^\d+\s+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const customerNameVariants = (customer = {}) =>
    [
      [
        valueFrom(customer, ["firstName", "firstname", "first_name"]),
        valueFrom(customer, ["lastName", "lastname", "last_name"]),
      ]
        .filter(Boolean)
        .join(" "),
      valueFrom(customer, ["entityId", "entityid"]),
      valueFrom(customer, ["altName", "altname"]),
      valueFrom(customer, ["companyName", "companyname"]),
      valueFrom(customer, ["refName", "name"]),
    ]
      .map(normalizeCustomerNameLine)
      .filter(Boolean);

  const isCustomerNameLine = (line, customer = {}) => {
    const normalizedLine = normalizeCustomerNameLine(line);
    if (!normalizedLine) return false;
    return customerNameVariants(customer).includes(normalizedLine);
  };

  function splitFormattedAddress(value, customer = null) {
    const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
    const lines = String(value || "")
      .split(/\r?\n|<br\s*\/?>/i)
      .map((line) => line.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);

    if (lines.length > 1 && customer && isCustomerNameLine(lines[0], customer)) {
      lines.shift();
    }

    let postcode = "";
    const cleaned = [];
    lines.forEach((line) => {
      const match = line.match(postcodeRegex);
      if (match) {
        postcode = match[0].toUpperCase();
        const withoutPostcode = line.replace(postcodeRegex, "").trim();
        if (withoutPostcode) cleaned.push(withoutPostcode);
        return;
      }
      cleaned.push(line);
    });

    const address1 = cleaned[0] || "";
    let address2 = "";
    let address3 = "";
    let county = "";

    if (cleaned.length === 2) {
      address3 = cleaned[1] || "";
    } else {
      address2 = cleaned[1] || "";
      address3 = cleaned[2] || "";
      county = cleaned[3] || "";
    }

    return {
      address1,
      address2,
      address3,
      county,
      postcode,
    };
  }

  function readAddressBookItems(customer = {}) {
    const items =
      customer.addressBook?.items ||
      customer.addressBook ||
      customer.addressbook?.items ||
      customer.addressbook ||
      [];

    if (Array.isArray(items)) return items;
    if (Array.isArray(items.items)) return items.items;
    return [];
  }

  function cleanAddressParts(address = {}, customer = null) {
    const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
    const out = { ...address };
    const address1 = String(out.address1 || "").replace(/\s+/g, " ").trim().toLowerCase();
    const address2 = String(out.address2 || "").trim();
    const address3 = String(out.address3 || "").trim();
    const county = String(out.county || "").trim();

    if (isCustomerNameLine(address1, customer)) {
      out.address1 = out.address2 || "";
      out.address2 = "";
    }

    if (postcodeRegex.test(address2)) {
      const match = address2.match(postcodeRegex);
      if (!out.postcode && match) out.postcode = match[0].toUpperCase();
      const withoutPostcode = address2.replace(postcodeRegex, "").trim();
      if (!out.address3 && withoutPostcode) {
        out.address3 = county && withoutPostcode.toLowerCase().endsWith(county.toLowerCase())
          ? withoutPostcode.slice(0, -county.length).trim()
          : withoutPostcode;
      }
      out.address2 = "";
      return out;
    }

    const compactAddress2 = address2.replace(/\s+/g, " ").toLowerCase();
    const townCounty = [address3, county].filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase();
    if (compactAddress2 && townCounty && compactAddress2 === townCounty) {
      out.address2 = "";
    }

    return out;
  }

  function normalizeAddress(address = {}, index = 0, customer = null) {
    const addr = address.addressbookAddress || address.addressBookAddress || address.address || address;
    const formatted = splitFormattedAddress(
      valueFrom(addr, ["addrText", "addrtext", "text"]) ||
        valueFrom(address, [
          "addressbookAddress_text",
          "addressBookAddress_text",
          "address",
          "address_text",
          "addrText",
          "addrtext",
        ]),
      customer
    );
    return cleanAddressParts({
      id: valueFrom(address, ["id", "internalId", "internalid"]),
      label: valueFrom(address, ["label", "addressLabel"]) || `Address ${index + 1}`,
      defaultShipping: address.defaultShipping === true,
      defaultBilling: address.defaultBilling === true,
      address1: valueFrom(addr, ["addr1", "address1"]) || formatted.address1,
      address2: valueFrom(addr, ["addr2", "address2"]) || formatted.address2,
      address3: valueFrom(addr, ["city", "addr3", "address3"]) || formatted.address3,
      county: valueFrom(addr, ["state", "county"]) || formatted.county,
      postcode: valueFrom(addr, ["zip", "postcode", "postalCode"]) || formatted.postcode,
    }, customer);
  }

  function normalizeCustomer(customer = {}) {
    return {
      id: valueFrom(customer, ["id", "internalId", "internalid"]),
      firstName: valueFrom(customer, ["firstName", "firstname", "first_name"]),
      lastName: valueFrom(customer, ["lastName", "lastname", "last_name"]),
      contactNumber: valueFrom(customer, ["phone", "contactNumber", "mobilePhone", "mobilephone"]),
      altContactNumber: valueFrom(customer, ["altPhone", "altphone", "altContactNumber", "homePhone", "homephone"]),
      email: valueFrom(customer, ["email"]),
      addresses: readAddressBookItems(customer).map((address, index) =>
        normalizeAddress(address, index, customer)
      ),
    };
  }

  let updateCustomerBtn = document.getElementById("updateCustomerDetailsBtn");
  if (!updateCustomerBtn) {
    updateCustomerBtn = document.createElement("button");
    updateCustomerBtn.id = "updateCustomerDetailsBtn";
    updateCustomerBtn.type = "button";
    updateCustomerBtn.className = "btn-secondary customer-update-btn hidden";
    updateCustomerBtn.textContent = "Update Customer Details";
    const addressBlock = customerSection.querySelector(".address-block");
    (addressBlock || customerSection).insertAdjacentElement("afterend", updateCustomerBtn);
  }

  let activeCustomerId = "";
  let activeCustomerRecord = null;

  function ensureCustomerUpdateModal() {
    let modal = document.getElementById("customerDetailsUpdateModal");
    if (modal) return modal;

    modal = document.createElement("dialog");
    modal.id = "customerDetailsUpdateModal";
    modal.className = "customer-details-modal";
    modal.innerHTML = `
      <form method="dialog" class="customer-details-modal-shell">
        <div class="customer-details-modal-header">
          <h2>Update Customer Details</h2>
          <button type="button" class="customer-details-close" data-customer-close aria-label="Close">&times;</button>
        </div>
        <div class="customer-details-grid">
          <label>First Name<input name="firstName" type="text" /></label>
          <label>Last Name<input name="lastName" type="text" /></label>
          <label>Contact Number<input name="contactNumber" type="tel" /></label>
          <label>Alt Contact Number<input name="altContactNumber" type="tel" /></label>
          <label>Email Address<input name="email" type="email" /></label>
        </div>
        <div class="customer-addresses-head">
          <h3>Addresses</h3>
          <button type="button" class="btn-secondary small-btn" data-add-customer-address>+ Add Address</button>
        </div>
        <div class="customer-addresses-wrap">
          <table class="customer-addresses-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Address Line 1</th>
                <th>Address Line 2</th>
                <th>Address Line 3</th>
                <th>County</th>
                <th>Postcode</th>
                <th></th>
              </tr>
            </thead>
            <tbody data-customer-addresses></tbody>
          </table>
        </div>
        <p class="customer-details-status" data-customer-status aria-live="polite"></p>
        <div class="customer-details-actions">
          <button type="button" class="btn-secondary" data-customer-cancel>Cancel</button>
          <button type="button" class="btn-primary" data-customer-save>Save Changes</button>
        </div>
      </form>
    `;
    document.body.appendChild(modal);

    modal.querySelector("[data-customer-close]")?.addEventListener("click", () => modal.close());
    modal.querySelector("[data-customer-cancel]")?.addEventListener("click", () => modal.close());
    modal.querySelector("[data-add-customer-address]")?.addEventListener("click", () => {
      appendCustomerAddressRow(modal, {});
    });
    modal.querySelector("[data-customer-save]")?.addEventListener("click", () => saveCustomerDetails(modal));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.close();
    });

    return modal;
  }

  function appendCustomerAddressRow(modal, address = {}) {
    const tbody = modal.querySelector("[data-customer-addresses]");
    if (!tbody) return;

    const tr = document.createElement("tr");
    tr.dataset.addressId = address.id || "";
    tr.dataset.defaultShipping = address.defaultShipping ? "true" : "";
    tr.dataset.defaultBilling = address.defaultBilling ? "true" : "";
    tr.innerHTML = `
      <td><input data-select-address type="radio" name="selectedCustomerAddress" /></td>
      <td><input data-address-field="address1" type="text" value="${escapeHtml(address.address1 || "")}" /></td>
      <td><input data-address-field="address2" type="text" value="${escapeHtml(address.address2 || "")}" /></td>
      <td><input data-address-field="address3" type="text" value="${escapeHtml(address.address3 || "")}" /></td>
      <td><input data-address-field="county" type="text" value="${escapeHtml(address.county || "")}" /></td>
      <td><input data-address-field="postcode" type="text" value="${escapeHtml(address.postcode || "")}" /></td>
      <td><button type="button" class="btn-secondary small-btn" data-remove-address>Remove</button></td>
    `;
    tr.querySelector("[data-remove-address]")?.addEventListener("click", () => {
      const wasSelected = !!tr.querySelector("[data-select-address]")?.checked;
      tr.remove();
      if (wasSelected) tbody.querySelector("[data-select-address]")?.click();
    });
    tbody.appendChild(tr);
    const select = tr.querySelector("[data-select-address]");
    if (select && (address.selected || address.defaultShipping || (!tbody.querySelector('[data-select-address]:checked') && tbody.children.length === 1))) {
      select.checked = true;
    }
  }

  function renderCustomerDetailsModal(customer) {
    const modal = ensureCustomerUpdateModal();
    const normalized = normalizeCustomer(customer);

    ["firstName", "lastName", "contactNumber", "altContactNumber", "email"].forEach((name) => {
      const input = modal.querySelector(`[name="${name}"]`);
      if (input) input.value = normalized[name] || "";
    });

    const tbody = modal.querySelector("[data-customer-addresses]");
    if (tbody) tbody.innerHTML = "";
    const addresses = normalized.addresses.length ? normalized.addresses : [{}];
    addresses.forEach((address) => appendCustomerAddressRow(modal, address));

    const status = modal.querySelector("[data-customer-status]");
    if (status) status.textContent = "";

    return modal;
  }

  async function fetchCustomerRecord(customerId) {
    const res = await fetch(`/api/netsuite/entity/${encodeURIComponent(customerId)}`, {
      headers: getAuthHeaders(),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to load customer details");
    return data.entity;
  }

  function collectCustomerPayload(modal) {
    const read = (name) => modal.querySelector(`[name="${name}"]`)?.value?.trim() || "";
    const rows = [...modal.querySelectorAll("[data-customer-addresses] tr")];
    const rowAddress = (row, index) => {
      const field = (name) =>
        row.querySelector(`[data-address-field="${name}"]`)?.value?.trim() || "";
      const countyField = row.querySelector('[data-address-field="county"]');
      return {
        id: row.dataset.addressId || "",
        defaultShipping: row.dataset.defaultShipping === "true" || index === 0,
        defaultBilling: row.dataset.defaultBilling === "true" || index === 0,
        address1: field("address1"),
        address2: field("address2"),
        address3: field("address3"),
        county: window.EposCountySelect?.getValue?.(countyField) || field("county"),
        countyName: window.EposCountySelect?.getName?.(countyField) || field("county"),
        postcode: field("postcode"),
        selected: !!row.querySelector("[data-select-address]")?.checked,
      };
    };
    const addresses = rows
      .map((row, index) => {
        const address = rowAddress(row, index);
        delete address.selected;
        delete address.countyName;
        return address;
      })
      .filter((address) =>
        [address.address1, address.address2, address.address3, address.county, address.postcode].some(Boolean)
      );
    const selectedRow = rows.find((row) => row.querySelector("[data-select-address]")?.checked);
    const selectedAddress = selectedRow
      ? rowAddress(selectedRow, rows.indexOf(selectedRow))
      : addresses[0] || null;

    return {
      firstName: read("firstName"),
      lastName: read("lastName"),
      contactNumber: read("contactNumber"),
      altContactNumber: read("altContactNumber"),
      email: read("email"),
      addresses,
      selectedAddress,
    };
  }

  function formatShipAddress(address = {}) {
    return [
      address.address1,
      address.address2,
      address.address3,
      address.countyName || address.county,
      address.postcode,
    ]
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  function setSelectedShipAddress(address = null) {
    if (!address) return;
    window.selectedShipAddress = formatShipAddress(address);
    window.selectedShippingAddress = { ...address, shipAddress: window.selectedShipAddress };
  }

  function applyAddressToVisibleFields(address = null) {
    if (!address) return;
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (el) el.value = value || "";
    };

    setSelectedShipAddress(address);
    set('input[name="address1"]', address.address1);
    set('input[name="address2"]', address.address2);
    set('input[name="address3"]', address.address3);
    const countyField = document.querySelector('[name="county"]');
    if (countyField) {
      window.EposCountySelect?.setValue?.(countyField, address.county);
      if (!window.EposCountySelect?.setValue) countyField.value = address.county || "";
    }
    set('input[name="postcode"]', address.postcode);
  }

  function currentDispatchTrackContext() {
    const salesOrder = window._currentSalesOrder || {};
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const isSalesView = pathParts[0] === "sales" && pathParts[1] === "view";
    return {
      salesOrderId:
        salesOrder.id ||
        salesOrder.internalId ||
        salesOrder.internalid ||
        (isSalesView ? pathParts[pathParts.length - 1] : ""),
      salesOrderTranId: salesOrder.tranId || salesOrder.tranid || "",
      warehouseId:
        document.getElementById("warehouse")?.value ||
        salesOrder.custbody_sb_warehouse?.id ||
        window.selectedWarehouseId ||
        "",
      serviceOrderNumber:
        window.currentDispatchTrackServiceOrderNumber ||
        salesOrder.dispatchTrackServiceOrderNumber ||
        "",
    };
  }

  function truthyNetSuiteFlag(value) {
    if (value && typeof value === "object") {
      return truthyNetSuiteFlag(value.id ?? value.value ?? value.refName ?? value.text);
    }
    const text = String(value ?? "").trim().toLowerCase();
    return text === "t" || text === "true" || text === "yes" || text === "1" || text === "exported";
  }

  function dispatchTrackServiceOrderFromValue(value) {
    const raw = String(value || "");
    const linkMatch = raw.match(/service-orders\/([^"'<>\s/?#]+)/i);
    if (linkMatch?.[1]) return linkMatch[1];
    const docMatch = raw.match(/\bSO[A-Z]*\d+\b/i);
    return docMatch?.[0] || "";
  }

  function valueText(value) {
    if (value && typeof value === "object") {
      return value.refName || value.text || value.name || value.value || value.id || "";
    }
    return value || "";
  }

  function elementText(selector) {
    const el = document.querySelector(selector);
    return el?.innerText || el?.textContent || "";
  }

  function currentDispatchTrackUrl() {
    const salesOrder = window._currentSalesOrder || {};
    const related = salesOrder.relatedRecords || {};
    const serviceOrderNumber =
      window.currentDispatchTrackServiceOrderNumber ||
      salesOrder.dispatchTrackServiceOrderNumber ||
      dispatchTrackServiceOrderFromValue(window.currentDispatchTrackUrl) ||
      dispatchTrackServiceOrderFromValue(elementText("#relatedDispatchTrack")) ||
      dispatchTrackServiceOrderFromValue(elementText("#relatedIntercompanySalesOrder")) ||
      dispatchTrackServiceOrderFromValue(related.custbody_sb_pairedsalesorder) ||
      dispatchTrackServiceOrderFromValue(salesOrder.custbody_sb_pairedsalesorder) ||
      dispatchTrackServiceOrderFromValue(valueText(related.custbody_sb_pairedsalesorder)) ||
      dispatchTrackServiceOrderFromValue(valueText(salesOrder.custbody_sb_pairedsalesorder));

    return (
      window.currentDispatchTrackUrl ||
      salesOrder.dispatchTrackUrl ||
      (serviceOrderNumber
        ? `https://sussexbeds.dispatchtrack.com/a18/service-orders/${encodeURIComponent(serviceOrderNumber)}`
        : "")
    );
  }

  function currentSalesOrderId() {
    const salesOrder = window._currentSalesOrder || {};
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    return (
      salesOrder.id ||
      salesOrder.internalId ||
      salesOrder.internalid ||
      (/\/sales\/view\//i.test(window.location.pathname || "") ? pathParts[pathParts.length - 1] : "")
    );
  }

  function currentVisibleShipAddress() {
    return [
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
  }

  async function patchCurrentSalesOrderShipAddress(shipAddress = "") {
    const orderId = currentSalesOrderId();
    const addressText = String(shipAddress || currentVisibleShipAddress() || "").trim();
    const contactNumber = String(document.querySelector('input[name="contactNumber"]')?.value || "").trim();
    const email = String(document.querySelector('input[name="email"]')?.value || "").trim();
    if (!/\/sales\/view\//i.test(window.location.pathname || "")) return false;
    if (!orderId || (!addressText && !contactNumber && !email)) return false;

    if (
      window._lastPatchedShipAddressOrderId === String(orderId) &&
      window._lastPatchedShipAddress === addressText &&
      window._lastPatchedCustomerContactNumber === contactNumber &&
      window._lastPatchedCustomerEmail === email
    ) {
      return true;
    }

    try {
      const res = await fetch(`/api/netsuite/salesorder/${encodeURIComponent(orderId)}/shipaddress`, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          shipAddress: addressText,
          shipaddress: addressText,
          contactNumber,
          email,
        }),
      });
      const data = await res.json().catch(() => ({}));
      console.log("Sales Order shipAddress patch response:", {
        status: res.status,
        ok: res.ok,
        data,
      });
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to update Sales Order shipAddress");
      }

      window._lastPatchedShipAddressOrderId = String(orderId);
      window._lastPatchedShipAddress = addressText;
      window._lastPatchedCustomerContactNumber = contactNumber;
      window._lastPatchedCustomerEmail = email;
      if (window._currentSalesOrder) {
        window._currentSalesOrder.shipAddress = addressText;
        window._currentSalesOrder.shippingAddress_text = addressText;
        window._currentSalesOrder.custbody_sb_interco_cus_phone = contactNumber;
        window._currentSalesOrder.custbody_sb_customer_email = email;
      }
      return true;
    } catch (err) {
      console.warn("Sales Order shipAddress patch failed:", err.message || err);
      if (typeof window.showToast === "function") {
        window.showToast("Customer saved, but Sales Order delivery address was not updated.", "warning");
      }
      return false;
    }
  }

  function orderExportedToDispatchTrack() {
    const salesOrder = window._currentSalesOrder || {};
    const related = salesOrder.relatedRecords || {};
    const dispatchTrackText = elementText("#relatedDispatchTrack").trim().toLowerCase();
    return Boolean(
      window.currentSalesOrderExportedToDispatchTrack ||
        salesOrder.exportedToDispatchTrack ||
        truthyNetSuiteFlag(related.custbody_exported_to_dispatchtrack) ||
        truthyNetSuiteFlag(salesOrder.custbody_exported_to_dispatchtrack) ||
        truthyNetSuiteFlag(salesOrder.exported_to_dispatchtrack) ||
        (dispatchTrackText && dispatchTrackText !== "not exported" && dispatchTrackText !== "-")
    );
  }

  async function createDispatchTrackAcknowledgementMemo() {
    const orderId = currentSalesOrderId();
    if (!orderId) {
      console.warn("DispatchTrack acknowledgement memo skipped: missing sales order id");
      return false;
    }

    const memoKey = `dispatchTrackCustomerPromptMemo:${orderId}`;
    if (window[memoKey]) {
      console.info("DispatchTrack acknowledgement memo already queued for this order:", orderId);
      return true;
    }
    window[memoKey] = true;

    const memoText =
      "I have accepted the order has already been exported to DispatchTrack and I have seen the prompt to update the customer order in DispatchTrack";

    try {
      const res = await fetch("/api/sales/memo", {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          orderId,
          title: "DispatchTrack customer update acknowledgement",
          type: "In-Person",
          memo: memoText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      console.log("DispatchTrack acknowledgement memo response:", {
        status: res.status,
        ok: res.ok,
        data,
      });
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to save DispatchTrack acknowledgement memo");
      }
      window.postMessage({ action: "refresh-memos" }, window.location.origin);
      return true;
    } catch (err) {
      window[memoKey] = false;
      console.warn("DispatchTrack acknowledgement memo failed:", err.message || err);
      if (typeof window.showToast === "function") {
        window.showToast("DispatchTrack prompt shown, but acknowledgement memo was not saved.", "warning");
      }
      return false;
    }
  }

  function showDispatchTrackManualUpdateNotice() {
    if (!/\/sales\/view\//i.test(window.location.pathname || "")) return;
    if (!orderExportedToDispatchTrack()) return;

    const url = currentDispatchTrackUrl();
    window.focus?.();
    const existing = document.getElementById("dispatchTrackManualUpdateNotice");
    if (existing) existing.remove();
    createDispatchTrackAcknowledgementMemo();

    const notice = document.createElement("div");
    notice.id = "dispatchTrackManualUpdateNotice";
    notice.setAttribute("role", "dialog");
    notice.style.cssText = [
      "position:fixed",
      "right:24px",
      "bottom:88px",
      "z-index:2147483000",
      "max-width:420px",
      "background:#fff",
      "border:1px solid #d8e1ea",
      "box-shadow:0 18px 45px rgba(15,23,42,.22)",
      "border-radius:8px",
      "padding:16px",
      "color:#0f2233",
      "font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");

    notice.innerHTML = `
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">DispatchTrack update required</div>
      <div style="margin-bottom:14px;">
        This order has already been exported to DispatchTrack - and customer data will not automatically update.<br><br>
        To update click here to update the order in dispatch track
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
        <button type="button" data-dt-dismiss style="border:1px solid #cfd8e3;background:#fff;border-radius:6px;padding:8px 12px;cursor:pointer;">Close</button>
        <button type="button" data-dt-open ${url ? "" : "disabled"} style="border:1px solid #007fa3;background:#007fa3;color:#fff;border-radius:6px;padding:8px 12px;cursor:pointer;${url ? "" : "opacity:.55;"}">Open DispatchTrack</button>
      </div>
    `;

    notice.querySelector("[data-dt-dismiss]")?.addEventListener("click", async () => {
      await createDispatchTrackAcknowledgementMemo();
      notice.remove();
    });
    notice.querySelector("[data-dt-open]")?.addEventListener("click", async () => {
      await createDispatchTrackAcknowledgementMemo();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
    document.body.appendChild(notice);
  }

  async function syncDispatchTrackCustomerFirstName(firstName) {
    console.info("DispatchTrack customer sync disabled pending updated API endpoint documentation.");
    return;

    const name = String(firstName || "").trim();
    if (!name) {
      console.warn("DispatchTrack customer sync skipped: missing first name");
      return;
    }

    const context = currentDispatchTrackContext();
    console.log("DispatchTrack customer sync context:", {
      ...context,
      firstName: name,
    });
    if (!context.salesOrderId && !context.salesOrderTranId && !context.serviceOrderNumber) {
      console.warn("DispatchTrack customer sync skipped: no sales order or dispatch identifier context", context);
      return;
    }

    try {
      const res = await fetch("/api/dispatchtrack/service-order/customer", {
        method: "PATCH",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          salesOrderId: context.salesOrderId,
          salesOrderTranId: context.salesOrderTranId,
          warehouseId: context.warehouseId,
          serviceOrderNumber: context.serviceOrderNumber,
          firstName: name,
        }),
      });
      const data = await res.json().catch(() => ({}));
      console.log("DispatchTrack customer sync response:", {
        status: res.status,
        ok: res.ok,
        data,
      });
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "DispatchTrack update failed");
      }
      if (data.skipped) {
        console.warn("DispatchTrack customer update skipped:", data.reason);
        return;
      }
      if (typeof window.showToast === "function") {
        window.showToast("DispatchTrack customer updated.", "success");
      }
    } catch (err) {
      console.warn("DispatchTrack customer update failed:", err.message || err);
      if (typeof window.showToast === "function") {
        window.showToast("Customer saved, but DispatchTrack was not updated.", "warning");
      }
    }
  }

  function syncVisibleCustomerFields(customer, editedPayload = null) {
    const normalized = normalizeCustomer(customer);
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (el) el.value = value || "";
    };

    set('input[name="firstName"]', editedPayload?.firstName || normalized.firstName);
    set('input[name="lastName"]', editedPayload?.lastName || normalized.lastName);
    set('input[name="contactNumber"]', editedPayload?.contactNumber || normalized.contactNumber);
    set('input[name="altContactNumber"]', editedPayload?.altContactNumber || normalized.altContactNumber);
    set('input[name="email"]', editedPayload?.email || normalized.email);

    const selectedEditedAddress = editedPayload?.selectedAddress || null;
    const editedAddresses = Array.isArray(editedPayload?.addresses) ? editedPayload.addresses : [];
    const defaultEditedAddress =
      selectedEditedAddress ||
      editedAddresses.find((address) => address.defaultShipping) ||
      editedAddresses.find((address) => address.defaultBilling) ||
      editedAddresses[0];

    const defaultAddress =
      defaultEditedAddress ||
      normalized.addresses.find((address) => address.defaultShipping) ||
      normalized.addresses.find((address) => address.defaultBilling) ||
      normalized.addresses[0];

    if (defaultAddress) {
      applyAddressToVisibleFields(defaultAddress);
    }
  }

  async function saveCustomerDetails(modal) {
    if (!activeCustomerId) return;

    const status = modal.querySelector("[data-customer-status]");
    const saveBtn = modal.querySelector("[data-customer-save]");
    const payload = collectCustomerPayload(modal);

    if (!payload.firstName || !payload.lastName || !payload.email) {
      if (status) status.textContent = "First name, last name and email are required.";
      return;
    }

    saveBtn.disabled = true;
    if (status) status.textContent = "Saving customer details...";

    try {
      const res = await fetch(`/api/netsuite/entity/${encodeURIComponent(activeCustomerId)}`, {
        method: "PATCH",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Failed to update customer");

      activeCustomerRecord = data.entity;
      syncVisibleCustomerFields(activeCustomerRecord);
      if (status) status.textContent = "Customer details updated.";
      if (typeof window.showToast === "function") window.showToast("Customer details updated.", "success");
      setTimeout(() => modal.close(), 350);
    } catch (err) {
      console.error("Customer details update failed:", err);
      if (status) status.textContent = err.message || "Failed to update customer.";
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function openCustomerDetailsModal() {
    if (!activeCustomerId) return;
    const saved = typeof storageGet === "function" ? storageGet() : null;
    const params = new URLSearchParams({ customerId: activeCustomerId });
    if (saved?.token) params.set("token", saved.token);

    const popup = window.open(
      `/customer-details?${params.toString()}`,
      "CustomerDetailsUpdate",
      "width=1100,height=760,resizable=yes,scrollbars=yes"
    );

    if (popup) {
      popup.focus();
    } else {
      window.location.href = `/customer-details?${params.toString()}`;
    }
  }

  function showCustomerDetailsUpdate(customerId, customer = null) {
    activeCustomerId = String(customerId || "").trim();
    activeCustomerRecord = customer || activeCustomerRecord;
    window.currentCustomerId = activeCustomerId || null;
    updateCustomerBtn.classList.toggle("hidden", !activeCustomerId);
    updateCustomerBtn.disabled = !activeCustomerId;
    updateCustomerBtn.classList.remove("locked-input");
    updateCustomerBtn.removeAttribute("readonly");
    updateCustomerBtn.style.pointerEvents = activeCustomerId ? "auto" : "";
    updateCustomerBtn.style.opacity = activeCustomerId ? "1" : "";
  }

  updateCustomerBtn.addEventListener("click", openCustomerDetailsModal);

  window.onCustomerDetailsUpdated = (customer, editedPayload = null) => {
    if (!customer) return;
    activeCustomerRecord = customer;
    syncVisibleCustomerFields(customer, editedPayload);
    patchCurrentSalesOrderShipAddress();
    syncDispatchTrackCustomerFirstName(editedPayload?.firstName || customer.firstName || customer.firstname);
    setTimeout(showDispatchTrackManualUpdateNotice, 300);
    if (typeof window.showToast === "function") window.showToast("Customer details updated.", "success");
  };

  window.onCustomerAddressSelected = (address) => {
    applyAddressToVisibleFields(address);
    patchCurrentSalesOrderShipAddress(formatShipAddress(address));
    if (typeof window.showToast === "function") window.showToast("Shipping address selected.", "success");
  };

  window.EposCustomerDetailsUpdate = {
    show: showCustomerDetailsUpdate,
    open: openCustomerDetailsModal,
  };

  if (!confirmBtn || !contactSection || !orderDetailsSection || !orderItemsSection) return;

  /* =========================================================
     Page detection (Sales vs Quote)
     - Quotes: /quote/new, /quote/, title includes "Quote"
     - Sales:  /sales/new, /sales/, title includes "Sales"
  ========================================================= */
  const path = (window.location.pathname || "").toLowerCase();
  const title = (document.title || "").toLowerCase();

  const isQuotePage =
    path.includes("/quote") ||
    title.includes("quote");

  // Default behaviour remains Sales-required unless clearly Quote
  const requirePaymentInfo = !isQuotePage;

  console.log(
    `🔒 salesCustomerLock active — paymentInfo required: ${requirePaymentInfo ? "YES" : "NO"}`
  );

  // === Utility: lock/unlock a section's inputs (EXCLUDES confirm/edit button)
  const setSectionLocked = (section, locked, includeButtons = false) => {
    if (!section) return;
    const selector = includeButtons
      ? "input, select, textarea, button"
      : "input, select, textarea";
    const inputs = section.querySelectorAll(selector);

    inputs.forEach((el) => {
      if (el.id === "confirmCustomerBtn") return; // never disable the main toggle
      if (el.id === "updateCustomerDetailsBtn") return;
      if (el.id === "customerSearchBtn") return;

      if (locked) {
        el.setAttribute("readonly", true);
        el.setAttribute("disabled", true);
        el.classList.add("locked-input");
      } else {
        el.removeAttribute("readonly");
        el.removeAttribute("disabled");
        el.classList.remove("locked-input");
      }
    });

    section.classList.toggle("locked", !!locked);
  };

  // Keep confirm/edit button active always
  const ensureConfirmActive = () => {
    confirmBtn.classList.remove("locked-input");
    confirmBtn.removeAttribute("disabled");
    confirmBtn.style.pointerEvents = "auto";
    confirmBtn.style.opacity = "1";
  };
  ensureConfirmActive();

  // Lock order items initially until the first confirm completes
  setSectionLocked(orderItemsSection, true, true);

  // Create or locate status element for feedback
  let matchStatus = document.getElementById("customerMatchStatus");
  if (!matchStatus) {
    matchStatus = document.createElement("div");
    matchStatus.id = "customerMatchStatus";
    matchStatus.className = "match-status";
    customerSection.appendChild(matchStatus);
  }

  // === Validation helper ===
  const validateRequiredFields = () => {
    const errors = [];

    const noAddressRequired =
      !!document.getElementById("noAddressRequired")?.checked;

    // Customer info mandatory
    const firstName = document.querySelector('input[name="firstName"]')?.value.trim() || "";
    const lastName = document.querySelector('input[name="lastName"]')?.value.trim() || "";
    const email = document.querySelector('input[name="email"]')?.value.trim() || "";
    const postcode = document.querySelector('input[name="postcode"]')?.value.trim() || "";

    if (!firstName) errors.push("First Name is required");
    if (!lastName) errors.push("Last Name is required");
    if (!email) errors.push("Email is required");

    // ✅ Only require postcode when no-address mode is OFF
    if (!noAddressRequired && !postcode) {
      errors.push("Postcode is required");
    }

    // Order details mandatory
    const leadSource = document.querySelector('select[name="leadSource"]')?.value || "";
    const paymentInfo = document.querySelector('select[name="paymentInfo"]')?.value || "";
    const warehouse = document.querySelector('select[name="warehouse"]')?.value || "";

    if (!leadSource) errors.push("Lead Source is required");

    // ✅ Only enforce Payment Info on Sales pages
    if (requirePaymentInfo && !paymentInfo) errors.push("Payment Info is required");

    if (!warehouse) errors.push("Warehouse is required");

    return { valid: errors.length === 0, errors };
  };

  // === Helper to reset item table ===
  function resetItemTable() {
    const tableBody = document.getElementById("orderItemsBody");
    if (tableBody) tableBody.innerHTML = "";
    if (typeof window.addNewRow === "function") window.addNewRow();
    if (typeof updateOrderSummary === "function") updateOrderSummary();
    if (typeof updateQuoteSummary === "function") updateQuoteSummary();
  }

  // === Track and guard Store/Warehouse changes ===
  let alertEnabled = false; // Only true after first confirm
  const storeSelect = document.getElementById("store");
  const warehouseSelect = document.getElementById("warehouse");

  // Capture previous value on focus/mousedown so cancel can revert correctly
  const bindPrevCapture = (selectEl) => {
    if (!selectEl) return;
    const capture = () => {
      selectEl.dataset.prevValue = String(selectEl.value ?? "");
    };
    selectEl.addEventListener("focus", capture, { passive: true });
    selectEl.addEventListener("mousedown", capture, { passive: true });
    capture();
  };

  bindPrevCapture(storeSelect);
  bindPrevCapture(warehouseSelect);

  const handleSelectChange = (e) => {
    if (!alertEnabled) return;

    const selectEl = e.target;
    if (!selectEl || (selectEl.id !== "store" && selectEl.id !== "warehouse")) return;

    const prevValue = selectEl.dataset.prevValue ?? String(selectEl.value ?? "");
    const newValue = String(selectEl.value ?? "");

    if (prevValue !== newValue) {
      const confirmed = confirm(
        "Changing this field will result in the item table resetting — are you sure you want to do this?"
      );
      if (confirmed) {
        resetItemTable();
        selectEl.dataset.prevValue = newValue;
      } else {
        selectEl.value = prevValue;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  };

  storeSelect?.addEventListener("change", handleSelectChange);
  warehouseSelect?.addEventListener("change", handleSelectChange);

  // === Main confirm/edit toggle ===
  confirmBtn.addEventListener("click", async () => {
    ensureConfirmActive();

    // === UNLOCK MODE === (user clicked Edit)
    if (confirmBtn.dataset.locked === "true") {
      setSectionLocked(customerSection, false);
      setSectionLocked(contactSection, false);
      setSectionLocked(orderDetailsSection, false);
      setSectionLocked(orderItemsSection, false, true);

      confirmBtn.innerHTML = "Confirm";
      confirmBtn.classList.add("btn-primary");
      confirmBtn.classList.remove("edit-btn");
      confirmBtn.dataset.locked = "false";
      matchStatus.textContent = "";
      showCustomerDetailsUpdate("");

      alertEnabled = true;
      return;
    }

    // === VALIDATION before locking ===
    const { valid, errors } = validateRequiredFields();
    if (!valid) {
      alert("❌ Please fill in all required fields:\n\n- " + errors.join("\n- "));
      return;
    }

    // === LOCK MODE === (user clicked Confirm)
    setSectionLocked(customerSection, true);
    setSectionLocked(contactSection, true);
    setSectionLocked(orderDetailsSection, true);
    setSectionLocked(orderItemsSection, true, true);

    ensureConfirmActive();

    confirmBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="currentColor" aria-label="Edit">
        <path d="M3 17.25V21h3.75l11-11.03-3.75-3.75L3 17.25z"/>
      </svg>`;
    confirmBtn.classList.remove("btn-primary");
    confirmBtn.classList.add("edit-btn");
    confirmBtn.dataset.locked = "true";

    matchStatus.innerHTML = `<div class="spinner"></div> Searching for customer match...`;

    // Gather data
    const noAddressRequired =
      !!document.getElementById("noAddressRequired")?.checked;

    const lastName = document.querySelector('input[name="lastName"]')?.value.trim() || "";
    const email = document.querySelector('input[name="email"]')?.value.trim() || "";
    const postcode = document.querySelector('input[name="postcode"]')?.value.trim() || "";

    try {
      if (noAddressRequired) {
        matchStatus.innerHTML = "🆕 New customer (No address required selected)";
        window.currentCustomerId = null;
        showCustomerDetailsUpdate("");
      } else {
        const qs = new URLSearchParams({ email, lastName, postcode }).toString();
        const res = await fetch(`/api/netsuite/customermatch?${qs}`, { method: "GET" });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.ok && Array.isArray(data.results) && data.results.length > 0) {
          const matched = data.results[0];
          const id = matched["Internal ID"] || matched["ID"] || "—";
          const name = matched["Name"] || matched["Last Name"] || "Unknown";
          const custEmail = matched["Email"] || "";
          const custPostcode = matched["Postal Code"] || "";

          matchStatus.innerHTML = `
            ✅ Existing customer found:
            <strong>${id} — ${name}</strong>
            ${custEmail ? `<span style="color:var(--muted)">(${custEmail}, ${custPostcode})</span>` : ""}
          `;
          window.currentCustomerId = id;
          showCustomerDetailsUpdate(id);
        } else {
          matchStatus.innerHTML = "🆕 New customer!";
          window.currentCustomerId = null;
          showCustomerDetailsUpdate("");
        }
      }
    } catch (err) {
      console.error("❌ Customer match lookup failed:", err);
      alert("❌ Error searching for customer.");
      window.currentCustomerId = null;
      showCustomerDetailsUpdate("");
    } finally {
      setSectionLocked(orderItemsSection, false, true);
      alertEnabled = true;
    }
  });
});
