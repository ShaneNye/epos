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

  if (!confirmBtn || !customerSection || !contactSection || !orderDetailsSection || !orderItemsSection) return;

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
    const selector = includeButtons ? "input, select, textarea, button" : "input, select, textarea";
    const inputs = section.querySelectorAll(selector);

    inputs.forEach((el) => {
      if (el.id === "confirmCustomerBtn") return; // never disable the main toggle

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

    // Customer info mandatory
    const firstName = document.querySelector('input[name="firstName"]')?.value.trim() || "";
    const lastName = document.querySelector('input[name="lastName"]')?.value.trim() || "";
    const email = document.querySelector('input[name="email"]')?.value.trim() || "";
    const postcode = document.querySelector('input[name="postcode"]')?.value.trim() || "";
    const titleVal = document.querySelector('select[name="title"]')?.value || "";

    if (!firstName) errors.push("First Name is required");
    if (!lastName) errors.push("Last Name is required");
    if (!email) errors.push("Email is required");
    if (!postcode) errors.push("Postcode is required");
    if (!titleVal) errors.push("Title is required");

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
    const lastName = document.querySelector('input[name="lastName"]')?.value.trim() || "";
    const email = document.querySelector('input[name="email"]')?.value.trim() || "";
    const postcode = document.querySelector('input[name="postcode"]')?.value.trim() || "";

    try {
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
      } else {
        matchStatus.innerHTML = "🆕 New customer!";
        window.currentCustomerId = null;
      }
    } catch (err) {
      console.error("❌ Customer match lookup failed:", err);
      alert("❌ Error searching for customer.");
      window.currentCustomerId = null;
    } finally {
      setSectionLocked(orderItemsSection, false, true);
      alertEnabled = true;
    }
  });
});