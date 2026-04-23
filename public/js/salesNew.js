console.log("✅ salesNew.js loaded and running");

/* =========================================================
   🔕 HARD STOP on Sales View
   If this file is accidentally loaded on /sales/view/, nothing runs.
========================================================= */
if (window.location.pathname.includes("/sales/view/")) {
  console.log("🔕 salesNew.js fully disabled — Sales View mode");
} else {
  /* === CUSTOMER DEPOSITS (kept inside guard) === */
  let deposits = [];

  window.onDepositSaved = function (deposit) {
    deposits.push(deposit);
    renderDeposits();
    if (typeof window.updateOrderSummary === "function") window.updateOrderSummary();
  };

  function renderDeposits() {
    const section = document.getElementById("depositsSection");
    const tbody = document.querySelector("#depositsTable tbody");
    if (!tbody) return;

    if (deposits.length > 0 && section) section.style.display = "block";

    tbody.innerHTML = "";
    deposits.forEach((d) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${d.name || d.method || ""}</td><td>£${parseFloat(d.amount).toFixed(2)}</td>`;
      tbody.appendChild(tr);
    });

    if (typeof window.updateOrderSummary === "function") window.updateOrderSummary();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const saved = storageGet(); // from main.js
    if (!saved || !saved.token) return (window.location.href = "/index.html");

    const headers = { Authorization: `Bearer ${saved.token}` };
    let currentUser = null;

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

      if (show) {
        if (!select.value) select.value = "1"; // preserve previous default behaviour
      } else {
        select.value = "";
      }
    }

    const storeSelect = document.getElementById("store");
    storeSelect?.addEventListener("change", syncDistributionOrderTypeVisibility);
    storeSelect?.addEventListener("input", syncDistributionOrderTypeVisibility);

    /* =========================================================
       ✅ No Address Required helpers
    ========================================================= */
    const noAddressCheckbox = document.getElementById("noAddressRequired");

    function getAddressFields() {
      return [
        document.querySelector('input[name="postcode"]'),
        document.querySelector('input[name="address1"]'),
        document.querySelector('input[name="address2"]'),
        document.querySelector('input[name="address3"]'),
        document.querySelector('input[name="county"]'),
      ].filter(Boolean);
    }

function applyNoAddressMode() {
  const enabled = !!noAddressCheckbox?.checked;

  const postcodeField = document.querySelector('input[name="postcode"]');
  const address1Field = document.querySelector('input[name="address1"]');
  const address2Field = document.querySelector('input[name="address2"]');
  const address3Field = document.querySelector('input[name="address3"]');
  const countyField = document.querySelector('input[name="county"]');


  const addressFields = [
    postcodeField,
    address1Field,
    address2Field,
    address3Field,
    countyField,
  ].filter(Boolean);

  addressFields.forEach((field) => {
    field.required = !enabled;
    if (enabled) {
      field.removeAttribute("required");
      field.setCustomValidity("");
    } else {
      if (field === postcodeField || field === address1Field) {
        field.setAttribute("required", "required");
      }
    }
    field.classList.toggle("address-not-required", enabled);
  });

  const findBtn = document.getElementById("findAddressBtn");
  const resultsSelect = document.getElementById("addressResults");

  if (findBtn) {
    findBtn.disabled = enabled;
    findBtn.style.pointerEvents = enabled ? "none" : "";
    findBtn.style.opacity = enabled ? "0.5" : "";
  }

  if (resultsSelect) {
    resultsSelect.disabled = enabled;
    if (enabled) {
      resultsSelect.classList.add("hidden");
      resultsSelect.innerHTML = '<option value="">Select an address</option>';
    }
  }

  if (enabled) {
    window.currentCustomerId = null;
    console.log("🆕 No address required checked — forcing NEW customer creation");
  }
}

    if (noAddressCheckbox) {
      noAddressCheckbox.addEventListener("change", applyNoAddressMode);
    }

    /* === Load Current User === */
    try {
      const meRes = await fetch("/api/me", { headers });
      const meData = await meRes.json();

      if (meData.ok && meData.user) {
        currentUser = meData.user;
        console.log("🧑 Current user loaded:", currentUser);
        console.log("📦 User primaryStore:", currentUser.primaryStore);
      } else {
        console.warn("⚠️ No user data returned from /api/me");
      }
    } catch (err) {
      console.error("Failed to fetch current user:", err);
    }

    /* === Load Sales Executives === */
    try {
      const res = await fetch("/api/users", { headers });
      const data = await res.json();

      if (data.ok) {
        const execSelect = document.getElementById("salesExec");
        if (execSelect) {
          execSelect.innerHTML = '<option value="">Select Sales Executive</option>';

          const salesExecs = data.users.filter(
            (u) =>
              Array.isArray(u.roles) &&
              u.roles.some(
                (r) => r.name === "Sales Executive" || r.name === "Store Manager"
              )
          );

          salesExecs.forEach((u) => {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = `${u.firstName} ${u.lastName}`;
            execSelect.appendChild(opt);
          });

          if (currentUser && salesExecs.some((u) => u.id === currentUser.id)) {
            execSelect.value = currentUser.id;
            console.log(
              `✅ Default Sales Executive set to: ${currentUser.firstName} ${currentUser.lastName}`
            );
          }
        }
      }
    } catch (err) {
      console.error("Failed to load sales executives:", err);
    }

    /* === Load Stores === */
    try {
      const res = await fetch("/api/meta/locations", { headers });
      const data = await res.json();

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
              console.log(`🏪 Default store set to: ${match.name} (ID: ${match.id})`);
            } else {
              console.warn(
                `⚠️ No store match found for primaryStore: ${currentUser.primaryStore}`
              );
            }
          }
          syncDistributionOrderTypeVisibility();
        }
      }
    } catch (err) {
      console.error("Failed to load stores:", err);
    }

    syncDistributionOrderTypeVisibility();

    // ✅ Prefill from lookup (after user + store)
    const stored = localStorage.getItem("selectedCustomer");
    if (stored) {
      try {
        const c = JSON.parse(stored);
        console.log("🧾 Prefilling customer from lookup:", c);

        document.querySelector('input[name="firstName"]').value = c["First Name"] || "";
        document.querySelector('input[name="lastName"]').value = c["Last Name"] || "";
        document.querySelector('input[name="email"]').value = c["Email"] || "";
        document.querySelector('input[name="contactNumber"]').value = c["Phone"] || "";
        document.querySelector('input[name="postcode"]').value = c["Postal Code"] || "";
        document.querySelector('input[name="address1"]').value = c["Address 1"] || "";
        document.querySelector('input[name="address2"]').value = c["Address 2"] || "";
        document.querySelector('input[name="address3"]').value = c["Address 3"] || "";

        window.currentCustomerId = c["Internal ID"];
      } catch (err) {
        console.error("❌ Failed to parse stored customer:", err);
      } finally {
        localStorage.removeItem("selectedCustomer");
      }
    }

    if (noAddressCheckbox) {
      noAddressCheckbox.checked = false;
      applyNoAddressMode();
    }

    /* === ORDER SUMMARY CALCULATIONS === */
window.updateOrderSummary = function () {
  let grossTotal = 0;
  let discountTotal = 0;

  document.querySelectorAll("#orderItemsBody .order-line").forEach((tr) => {
    const itemId = (tr.querySelector(".item-internal-id")?.value || "").trim();
    if (!itemId) return; // ignore empty placeholder row

    const qty = parseFloat(tr.querySelector(".item-qty")?.value || 0);
    const amountGrossLine = parseFloat(tr.querySelector(".item-amount")?.value || 0);
    const salePriceGrossLine = parseFloat(tr.querySelector(".item-saleprice")?.value || 0);
    const discountPct = parseFloat(tr.querySelector(".item-discount")?.value || 0);

    if (!Number.isFinite(qty) || qty === 0) return;

    let actualGrossTotal = 0;
    let defaultGrossTotal = 0;

    const hasAmount =
      tr.querySelector(".item-amount") &&
      tr.querySelector(".item-amount").value !== "" &&
      Number.isFinite(amountGrossLine);

    const hasSalePrice =
      tr.querySelector(".item-saleprice") &&
      tr.querySelector(".item-saleprice").value !== "" &&
      Number.isFinite(salePriceGrossLine);

    // allow negative values too
    if (hasAmount) {
      defaultGrossTotal = amountGrossLine;
    } else if (hasSalePrice) {
      defaultGrossTotal = salePriceGrossLine;
    }

    if (hasSalePrice) {
      actualGrossTotal = salePriceGrossLine;
    } else if (discountPct > 0) {
      actualGrossTotal = defaultGrossTotal * (1 - discountPct / 100);
    } else {
      actualGrossTotal = defaultGrossTotal;
    }

    actualGrossTotal = Number(actualGrossTotal.toFixed(2));
    defaultGrossTotal = Number(defaultGrossTotal.toFixed(2));

    grossTotal += actualGrossTotal;

    const discountValue =
      defaultGrossTotal > actualGrossTotal
        ? Number((defaultGrossTotal - actualGrossTotal).toFixed(2))
        : 0;

    discountTotal += discountValue;
  });

  grossTotal = Number(grossTotal.toFixed(2));
  discountTotal = Number(discountTotal.toFixed(2));

  const netTotal = Number((grossTotal / 1.2).toFixed(2));
  const taxTotal = Number((grossTotal - netTotal).toFixed(2));

  const totalDeposits = deposits.reduce(
    (sum, d) => sum + (parseFloat(d.amount) || 0),
    0
  );

  const outstandingBalance = Number((grossTotal - totalDeposits).toFixed(2));

  document.getElementById("subTotal").textContent = `£${netTotal.toFixed(2)}`;
  document.getElementById("discountTotal").textContent = `£${discountTotal.toFixed(2)}`;
  document.getElementById("taxTotal").textContent = `£${taxTotal.toFixed(2)}`;
  document.getElementById("grandTotal").textContent = `£${grossTotal.toFixed(2)}`;

  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");
  if (depositsTotalCell) depositsTotalCell.textContent = `£${totalDeposits.toFixed(2)}`;
  if (balanceCell) balanceCell.textContent = `£${outstandingBalance.toFixed(2)}`;

  window.__grossTotal = grossTotal;
  window.__outstandingBalance = outstandingBalance;

  console.log("📊 Summary recalculated", {
    grossTotal,
    netTotal,
    taxTotal,
    discountTotal,
    totalDeposits,
    outstandingBalance,
  });
};

document.getElementById("orderItemsBody")?.addEventListener("input", (e) => {
  if (
    e.target.classList.contains("item-qty") ||
    e.target.classList.contains("item-discount") ||
    e.target.classList.contains("item-saleprice") ||
    e.target.classList.contains("item-amount")
  ) {
    window.updateOrderSummary();
  }
});

    const orderBody = document.getElementById("orderItemsBody");
    if (orderBody) {
      const bodyObserver = new MutationObserver(() => window.updateOrderSummary());
      bodyObserver.observe(orderBody, { childList: true });
    }

    // ✅ bind deposit popup (inside guard)
    const addDepositBtn = document.getElementById("addDepositBtn");

    function moneyToNumber(val) {
      if (val == null) return 0;
      const cleaned = String(val).replace(/[^0-9.-]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    }

    if (addDepositBtn) {
      addDepositBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const outstandingText =
          document.getElementById("outstandingBalance")?.textContent || "";
        const grandTotalText =
          document.getElementById("grandTotal")?.textContent || "";

        let amount = moneyToNumber(outstandingText);
        if (!(amount > 0)) amount = moneyToNumber(grandTotalText);

        if (!(amount > 0)) {
          amount =
            Number(window.__outstandingBalance) > 0
              ? Number(window.__outstandingBalance)
              : Number(window.__grossTotal) || 0;
        }

        console.log("🧾 outstandingText:", outstandingText);
        console.log("🧾 grandTotalText:", grandTotalText);
        console.log("🧾 amount used:", amount);

        const url =
          `${window.location.origin}/deposit.html?amount=` +
          encodeURIComponent(amount.toFixed(2));

        console.log("🧾 Opening deposit popup:", url);

        const win = window.open(
          url,
          "AddDeposit",
          "width=420,height=520,resizable=yes,scrollbars=no"
        );

        if (!win) alert("⚠️ Please allow popups for this site to add deposits.");
        else win.focus();
      };
    }

    window.updateOrderSummary();
  });

  /* === Spinner + Toast Controls (simple) === */
  const form = document.querySelector(".form-scroll");
  const spinner = document.getElementById("orderSpinner");
  const toast = document.getElementById("orderToast");
  const spinnerText = document.getElementById("orderSpinnerTitle");
  const saveOrderBtn = document.getElementById("saveOrderBtn");
  let isOrderSubmitting = false;
  let originalSaveOrderText = saveOrderBtn?.textContent || "Save Order";

  function lockForm() {
    if (form) form.classList.add("locked");
    if (spinner) spinner.classList.remove("hidden");
    if (toast) toast.classList.add("hidden");
    if (saveOrderBtn) {
      originalSaveOrderText = saveOrderBtn.textContent || originalSaveOrderText;
      saveOrderBtn.disabled = true;
      saveOrderBtn.setAttribute("aria-busy", "true");
      saveOrderBtn.textContent = "Saving...";
    }
    if (spinnerText) spinnerText.textContent = "Creating order…";
  }

  function unlockForm() {
    if (form) form.classList.remove("locked");
    if (spinner) spinner.classList.add("hidden");
    if (saveOrderBtn) {
      saveOrderBtn.disabled = false;
      saveOrderBtn.removeAttribute("aria-busy");
      saveOrderBtn.textContent = originalSaveOrderText;
    }
  }

  function showToast(message, type = "success") {
    if (!toast) return;
    toast.textContent = message;
    toast.className = `order-toast ${type}`;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 300);
    }, 3000);
  }

  /* =========================================================
     ✅ Mandatory validations before save
  ========================================================= */
  function validateCustomerBeforeSave() {
    const firstName = document.querySelector('input[name="firstName"]')?.value.trim() || "";
    const lastName = document.querySelector('input[name="lastName"]')?.value.trim() || "";
    const noAddressRequired = !!document.getElementById("noAddressRequired")?.checked;

    if (!firstName || !lastName) {
      alert("⚠️ First Name and Last Name are required.");
      return false;
    }

    if (!noAddressRequired) {
      const postcode = document.querySelector('input[name="postcode"]')?.value.trim() || "";
      const address1 = document.querySelector('input[name="address1"]')?.value.trim() || "";

      if (!postcode || !address1) {
        alert("⚠️ Postcode and Address Line 1 are required unless 'No address required' is checked.");
        return false;
      }
    }

    return true;
  }

function validateOrderBeforeSave() {
  const rows = [...document.querySelectorAll("#orderItemsBody .order-line")];

  const itemRows = rows.filter((r) =>
    (r.querySelector(".item-internal-id")?.value || "").trim()
  );

  if (itemRows.length === 0) {
    alert("⚠️ Please add at least one item to the sales order before saving.");
    return false;
  }

  rows.forEach((r) => r.classList.remove("row-error"));
  rows.forEach((r) => {
    r.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
  });

  let ok = true;
  const errors = [];

  itemRows.forEach((row, idx) => {
    const lineNo = row.getAttribute("data-line") ?? String(idx + 1);

    const itemClass = (row.dataset.itemClass || "").trim().toLowerCase();
    const isService = itemClass === "service";

    const fulfilSel = row.querySelector(".item-fulfilment");
    const fulfilId = (fulfilSel?.value || "").trim();
    const fulfilText =
      fulfilSel?.options?.[fulfilSel.selectedIndex]?.textContent?.trim().toLowerCase() || "";

    if (!isService && !fulfilId) {
      ok = false;
      errors.push(`• Line ${lineNo}: Fulfilment Method is required.`);
      row.classList.add("row-error");
      if (fulfilSel) fulfilSel.classList.add("field-error");
    }

    // ✅ If the row has an Options button, require some saved options value
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
        } catch (err) {
          hasJsonValue = false;
        }
      }

      const hasSummaryValue = !!optionsSummary;

      if (!hasJsonValue && !hasSummaryValue) {
        ok = false;
        errors.push(`• Line ${lineNo}: Item Options must be selected.`);
        row.classList.add("row-error");

        const optCell = row.querySelector(".options-cell");
        if (optCell) optCell.classList.add("field-error");
      }
    }

    const requiresInv =
      !isService && (fulfilText === "warehouse" || fulfilText === "in store");

    if (requiresInv) {
      const invHidden = row.querySelector(".item-inv-detail");
      const invHasValue = !!(invHidden?.value || "").trim();

      const hasLot = !!(row.dataset.lotnumber || "").trim();
      const hasMeta = !!(row.dataset.inventoryMeta || "").trim();

      if (!invHasValue && !hasLot && !hasMeta) {
        ok = false;
        errors.push(
          `• Line ${lineNo}: Inventory Detail is required for "${
            fulfilText === "warehouse" ? "Warehouse" : "In Store"
          }".`
        );
        row.classList.add("row-error");

        const invCell = row.querySelector(".inventory-cell");
        if (invCell) invCell.classList.add("field-error");
      }
    }
  });

  if (!ok) {
    alert("Please fix the following before saving:\n\n" + errors.join("\n"));
  }

  return ok;
}

  /* === SAVE ORDER HANDLER (simple spinner only) === */
  document.addEventListener("click", async (e) => {
    const saveButton = e.target.closest("#saveOrderBtn");
    if (saveButton) {
      e.preventDefault();

      if (isOrderSubmitting || saveButton.disabled) return;
      if (!validateCustomerBeforeSave()) return;
      if (!validateOrderBeforeSave()) return;

      const noAddressRequired =
        !!document.getElementById("noAddressRequired")?.checked;

      if (noAddressRequired) {
        const confirmed = window.confirm(
          "You are opting create this sale without an Address - This will create a new customer for this sale"
        );

        if (!confirmed) return;
      }

      const customer = {
        id: noAddressRequired ? null : window.currentCustomerId || null,
        noAddressRequired,
        title: document.querySelector('select[name="title"]').value,
        firstName: document.querySelector('input[name="firstName"]').value,
        lastName: document.querySelector('input[name="lastName"]').value,
        postcode: document.querySelector('input[name="postcode"]').value,
        address1: document.querySelector('input[name="address1"]').value,
        address2: document.querySelector('input[name="address2"]').value,
        address3: document.querySelector('input[name="address3"]').value,
        county: document.querySelector('input[name="county"]').value,
        contactNumber: document.querySelector('input[name="contactNumber"]').value,
        altContactNumber: document.querySelector('input[name="altContactNumber"]').value,
        email: document.querySelector('input[name="email"]').value,
      };

      const order = {
        salesExec: document.getElementById("salesExec").value,
        store: document.getElementById("store").value,
        distributionOrderType:
          document.getElementById("distributionOrderTypeWrapper")?.style.display === "none"
            ? ""
            : document.getElementById("distributionOrderType")?.value || "",
        leadSource: document.querySelector('select[name="leadSource"]').value,
        paymentInfo: document.getElementById("paymentInfo").value,
        warehouse: document.getElementById("warehouse").value,
        memo: document.querySelector('textarea[name="memo"]').value.trim(),
      };

      const items = [...document.querySelectorAll("#orderItemsBody .order-line")]
        .map((tr) => {
          const item = tr.querySelector(".item-internal-id")?.value.trim();
          if (!item) return null;

          const quantity = parseFloat(tr.querySelector(".item-qty").value || 0);
          const amount = parseFloat(tr.querySelector(".item-saleprice").value || 0);
          const options = tr.querySelector(".options-summary")?.innerText || "";
          const fulfilmentMethod = tr.querySelector(".item-fulfilment").value;

          const lotnumber = tr.dataset.lotnumber || "";
          const inventoryMeta = tr.dataset.inventoryMeta || "";

          const trialSel = tr.querySelector(".sixty-night-select");
          const trialOption = (trialSel?.value || "").trim();

          return {
            item,
            quantity,
            amount,
            options,
            fulfilmentMethod,
            lotnumber,
            inventoryMeta,
            trialOption,
          };
        })
        .filter((line) => line !== null);

      try {
        isOrderSubmitting = true;
        const body = { customer, order, items, deposits };
        console.log("🏷 noAddressRequired:", noAddressRequired);
        console.log("💰 Including deposits in payload:", deposits);
        await submitOrder(body);
      } finally {
        isOrderSubmitting = false;
      }
    }
  });

  async function submitOrder(orderPayload) {
    let createdSuccessfully = false;

    try {
      lockForm();
      console.log("📦 Sending order payload:", orderPayload);

      const saved = storageGet();
      const headers = {
        "Content-Type": "application/json",
        ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
      };

      if (!saved?.token) {
        console.warn("⚠️ No session token found — request may fail with 401");
      }

      console.log("📡 Sending order request with headers:", headers);

      const res = await fetch("/api/netsuite/salesorder/create", {
        method: "POST",
        headers,
        body: JSON.stringify(orderPayload),
      });

      const data = await res.json();
      console.log("🪵 [API Response]", data);

      if (!data.ok) {
        console.error("❌ Order failed:", data.error);
        showToast(`❌ ${data.error || "Order creation failed"}`, "error");
        unlockForm();
        return;
      }

      const soId = data.salesOrderId || null;
      const tranId = data.tranId || data.response?.tranId || null;

      if (soId) localStorage.setItem("currentSalesOrderId", soId);
      if (tranId) localStorage.setItem("currentSalesOrderTranId", tranId);
      createdSuccessfully = true;

      showToast(
        `✅ Order ${tranId || soId} created successfully! Redirecting...`,
        "success"
      );

      const savedAuth = storageGet();
      if (savedAuth && savedAuth.token) {
        localStorage.setItem("eposAuth", JSON.stringify(savedAuth));
        console.log("💾 Promoted session token to localStorage for redirect persistence");
      } else {
        console.warn("⚠️ No auth token found to persist before redirect");
      }

      setTimeout(() => {
        if (tranId) {
          console.log(`➡️ Redirecting to /sales/view/${tranId}`);
          window.location.href = `/sales/view/${tranId}`;
        } else if (soId) {
          console.log(`➡️ Redirecting to /sales/view/${soId}`);
          window.location.href = `/sales/view/${soId}`;
        } else {
          console.warn("⚠️ No tranId or soId found — redirecting to /home as fallback");
          window.location.href = "/home";
        }
      }, 1500);
    } catch (err) {
      console.error("❌ Error submitting order:", err);
      showToast("❌ Something went wrong while creating the order.", "error");
    } finally {
      if (!createdSuccessfully) unlockForm();
    }
  }
}
