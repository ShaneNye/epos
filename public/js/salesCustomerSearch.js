(function () {
  function getSessionToken() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token || "";
  }

  function valueFrom(obj, keys) {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== undefined && value !== null && value !== "") {
        if (typeof value === "object") return value.id || value.value || value.refName || value.name || "";
        return value;
      }
    }
    return "";
  }

  function splitFormattedAddress(value, customer = null) {
    const lines = String(value || "")
      .split(/\r?\n|<br\s*\/?>/i)
      .map((line) => line.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);

    if (lines.length > 1 && customer) {
      const customerName = [
        valueFrom(customer, ["First Name", "firstName", "firstname", "first_name"]),
        valueFrom(customer, ["Last Name", "lastName", "lastname", "last_name"]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (customerName && lines[0].toLowerCase() === customerName) lines.shift();
    }

    return {
      address1: lines[0] || "",
      address2: lines[1] || "",
      address3: lines[2] || "",
      county: lines[3] || "",
      postcode: lines.find((line) => /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(line)) || "",
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

  function normalizeAddress(address = {}, customer = null) {
    const addr = address.addressbookAddress || address.addressBookAddress || address.address || address;
    const formatted = splitFormattedAddress(
      valueFrom(addr, ["addrText", "addrtext", "text"]) ||
        valueFrom(address, [
          "Address",
          "addressbookAddress_text",
          "addressBookAddress_text",
          "address",
          "address_text",
          "addrText",
          "addrtext",
        ]),
      customer
    );

    const normalized = {
      address1:
        valueFrom(addr, ["addr1", "address1", "Address Line 1", "Address 1"]) ||
        valueFrom(address, ["Address Line 1", "Address 1"]) ||
        formatted.address1,
      address2:
        valueFrom(addr, ["addr2", "address2", "Address Line 2", "Address 2"]) ||
        valueFrom(address, ["Address Line 2", "Address 2"]) ||
        formatted.address2,
      address3:
        valueFrom(addr, ["city", "addr3", "address3", "Address Line 3", "Address 3"]) ||
        valueFrom(address, ["Address Line 3", "Address 3", "City", "Town"]) ||
        formatted.address3,
      county:
        valueFrom(addr, ["state", "county", "County ID", "State ID", "County", "State"]) ||
        valueFrom(address, ["County ID", "State ID", "County", "State"]) ||
        formatted.county,
      postcode:
        valueFrom(addr, ["zip", "postcode", "postalCode", "Postal Code", "Postcode"]) ||
        valueFrom(address, ["Postal Code", "Postcode", "Post Code", "Zip"]) ||
        formatted.postcode,
    };

    const customerName = [
      valueFrom(customer, ["First Name", "firstName", "firstname", "first_name"]),
      valueFrom(customer, ["Last Name", "lastName", "lastname", "last_name"]),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (customerName && String(normalized.address1 || "").replace(/\s+/g, " ").trim().toLowerCase() === customerName) {
      normalized.address1 = "";
    }

    return normalized;
  }

  function normalizeCustomer(customer = {}) {
    const addresses = readAddressBookItems(customer).map((address) => normalizeAddress(address, customer));
    const primaryAddress = addresses.find((address) => address.address1 || address.postcode) || normalizeAddress(customer, customer);

    return {
      id: valueFrom(customer, ["Internal ID", "InternalID", "Customer ID", "id", "internalId", "internalid"]),
      firstName: valueFrom(customer, ["First Name", "firstName", "firstname", "first_name"]),
      lastName: valueFrom(customer, ["Last Name", "lastName", "lastname", "last_name"]),
      email: valueFrom(customer, ["Email", "Customer Email", "email"]),
      contactNumber: valueFrom(customer, ["Phone", "Primary Phone", "phone", "contactNumber", "mobilePhone", "mobilephone"]),
      address1: primaryAddress.address1,
      address2: primaryAddress.address2,
      address3: primaryAddress.address3,
      county: primaryAddress.county,
      postcode: primaryAddress.postcode,
      raw: customer,
    };
  }

  function setField(name, value) {
    const field = document.querySelector(`[name="${name}"]`);
    if (!field) return;

    if (name === "county" && window.EposCountySelect?.setValue) {
      window.EposCountySelect.setValue(field, value || "");
    } else {
      field.value = value || "";
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setSelectedCustomerStatus(customer) {
    let status = document.getElementById("customerMatchStatus");
    const section = document.getElementById("customerInfoSection");
    if (!status && section) {
      status = document.createElement("div");
      status.id = "customerMatchStatus";
      status.className = "match-status";
      section.appendChild(status);
    }

    if (!status) return;
    const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Selected customer";
    const postcode = customer.postcode ? ` (${customer.postcode})` : "";
    status.innerHTML = `Selected existing customer: <strong>${customer.id || ""} - ${name}</strong>${postcode}`;
  }

  function applySelectedCustomer(record) {
    const customer = normalizeCustomer(record);

    const noAddressCheckbox = document.getElementById("noAddressRequired");
    if (noAddressCheckbox?.checked) {
      noAddressCheckbox.checked = false;
      noAddressCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
    }

    setField("firstName", customer.firstName);
    setField("lastName", customer.lastName);
    setField("postcode", customer.postcode);
    setField("address1", customer.address1);
    setField("address2", customer.address2);
    setField("address3", customer.address3);
    setField("county", customer.county);

    if (customer.email) setField("email", customer.email);
    if (customer.contactNumber) setField("contactNumber", customer.contactNumber);

    window.currentCustomerId = customer.id || null;
    if (customer.id) {
      window.EposCustomerDetailsUpdate?.show?.(customer.id, record);
      setSelectedCustomerStatus(customer);
    }

    if (typeof window.showToast === "function") window.showToast("Customer selected.", "success");
  }

  function openCustomerSearchPopup() {
    const params = new URLSearchParams();
    const token = getSessionToken();
    if (token) params.set("token", token);

    const width = 1120;
    const height = 760;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const url = `/customer-search${params.toString() ? `?${params}` : ""}`;
    window.open(url, "customerSearchPopup", `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
  }

  window.onCustomerSearchSelected = applySelectedCustomer;

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("customerSearchBtn");
    if (!btn) return;
    btn.addEventListener("click", openCustomerSearchPopup);
  });
})();
