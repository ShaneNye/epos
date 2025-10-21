/**
 * salesCustomerLock.js
 * -------------------------------------------------------------
 * Locks customer, contact info, order details,
 * and order items until confirmed.
 * Now requires mandatory fields before allowing confirm (popup alert).
 */

document.addEventListener("DOMContentLoaded", () => {
  const confirmBtn = document.getElementById("confirmCustomerBtn");
  const customerSection = document.getElementById("customerInfoSection");
  const contactSection = document.getElementById("contactInfoSection");
  const orderDetailsSection = document.getElementById("orderDetailsSection");
  const orderItemsSection = document.querySelector(".order-items-section");

  if (!confirmBtn || !customerSection || !contactSection || !orderDetailsSection || !orderItemsSection) return;

  // === Utility: lock/unlock a section's inputs
  const setSectionLocked = (section, locked, includeButtons = false) => {
    if (!section) return;
    const selector = includeButtons ? "input, select, textarea, button" : "input, select, textarea";
    const inputs = section.querySelectorAll(selector);

    inputs.forEach(el => {
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

    if (locked) section.classList.add("locked");
    else section.classList.remove("locked");
  };

  // === Lock order items initially (must stay locked until confirm)
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
    const firstName = document.querySelector('input[name="firstName"]').value.trim();
    const lastName = document.querySelector('input[name="lastName"]').value.trim();
    const email = document.querySelector('input[name="email"]').value.trim();
    const postcode = document.querySelector('input[name="postcode"]').value.trim();

    if (!firstName) errors.push("First Name is required");
    if (!lastName) errors.push("Last Name is required");
    if (!email) errors.push("Email is required");
    if (!postcode) errors.push("Postcode is required");

    // Order details mandatory
    const leadSource = document.querySelector('select[name="leadSource"]').value;
    const paymentInfo = document.querySelector('select[name="paymentInfo"]').value;
    const warehouse = document.querySelector('select[name="warehouse"]').value;

    if (!leadSource) errors.push("Lead Source is required");
    if (!paymentInfo) errors.push("Payment Info is required");
    if (!warehouse) errors.push("Warehouse is required");

    return { valid: errors.length === 0, errors };
  };

  confirmBtn.addEventListener("click", async () => {
    // === UNLOCK MODE === (user clicked Edit)
    if (confirmBtn.dataset.locked === "true") {
      setSectionLocked(customerSection, false);
      setSectionLocked(contactSection, false);
      setSectionLocked(orderDetailsSection, false);
      setSectionLocked(orderItemsSection, true, true); // re-lock order items!

      confirmBtn.innerHTML = "Confirm";
      confirmBtn.classList.add("btn-primary");
      confirmBtn.classList.remove("edit-btn");
      confirmBtn.dataset.locked = "false";
      matchStatus.textContent = "";
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

    confirmBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 17.25V21h3.75l11-11.03-3.75-3.75L3 17.25z"/>
      </svg>`;
    confirmBtn.classList.remove("btn-primary");
    confirmBtn.classList.add("edit-btn");
    confirmBtn.dataset.locked = "true";

    matchStatus.innerHTML = `<div class="spinner"></div> Searching for customer match...`;

    // Gather data
    const firstName = document.querySelector('input[name="firstName"]').value.trim();
    const lastName = document.querySelector('input[name="lastName"]').value.trim();
    const email = document.querySelector('input[name="email"]').value.trim();
    const postcode = document.querySelector('input[name="postcode"]').value.trim();

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

      // ✅ Unlock order items only now
      setSectionLocked(orderItemsSection, false, true);

    } catch (err) {
      console.error("❌ Customer match lookup failed:", err);
      alert("❌ Error searching for customer.");
      window.currentCustomerId = null;
    }
  });
});
