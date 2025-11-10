/**
 * salesNewNsFields.js
 * Secure version — dynamically loads dropdown data via local proxy routes.
 * Uses unified populateDropdown helper for consistency across fields.
 */

document.addEventListener("DOMContentLoaded", async () => {
  /**
   * Generic helper to populate a dropdown list
   * @param {string} selector - CSS selector for <select>
   * @param {string} endpoint - API endpoint to fetch data from
   * @param {string} labelKey - Primary key for label (fallbacks handled)
   * @param {string} valueKey - Key for option value
   * @param {string} placeholder - Default placeholder text
   */
  async function populateDropdown(selector, endpoint, labelKey, valueKey, placeholder) {
    const select = document.querySelector(selector);
    if (!select) return console.warn(`⚠️ Dropdown not found for selector: ${selector}`);

    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.ok || !Array.isArray(data.results)) {
        console.error(`❌ Invalid response for ${selector}:`, data);
        return;
      }

      // Reset dropdown with placeholder
      select.innerHTML = `<option value="">${placeholder}</option>`;

      // --- ✅ Filter inactive only for Lead Source ---
      let results = data.results;
      if (endpoint.includes("leadsource")) {
        results = results.filter((item) => {
          const val = String(item.Inactive ?? "").trim().toLowerCase();
          // Treat "true", "t", "1", etc. as inactive
          return (
            !val ||
            val === "false" ||
            val === "f" ||
            val === "0" ||
            val === "null" ||
            val === "undefined"
          );
        });
        console.log(`📋 Filtered lead sources: ${results.length}/${data.results.length} active`);
      }

      // Populate options (with key safety)
      results.forEach((item) => {
        const label =
          item[labelKey] ||
          item.Title ||
          item.Name ||
          item.text ||
          item.label ||
          "Unnamed";

        const value = item[valueKey] || item.id || item.value || label;
        if (label && value) {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = label;
          select.appendChild(opt);
        }
      });

      console.log(`✅ Populated ${selector} (${results.length} options)`);
    } catch (err) {
      console.error(`❌ Failed to load ${selector}:`, err);
      select.innerHTML = `<option value="">⚠️ Failed to load data</option>`;
    }
  }

  // === Populate all dropdown fields ===

  // Customer Title (from customlist_title)
  await populateDropdown(
    'select[name="title"]',
    "/api/netsuite/titles",
    "Name", // ← Corrected key for your payload
    "Internal ID",
    "Select Title"
  );

  // Lead Source (campaign or saved search)
  await populateDropdown(
    'select[name="leadSource"]',
    "/api/netsuite/leadsource",
    "Title",
    "Internal ID",
    "Select Lead Source"
  );

  // Warehouse
  await populateDropdown(
    'select[name="warehouse"]',
    "/api/netsuite/warehouse",
    "Name",
    "Internal ID",
    "Select Warehouse"
  );

  // Payment Info
  await populateDropdown(
    'select[name="paymentInfo"]',
    "/api/netsuite/paymentinfo",
    "Name",
    "Internal ID",
    "Select Payment Info"
  );
});


// === Fulfilment Methods ===
async function populateFulfilmentMethods() {
  try {
    const res = await fetch("/api/netsuite/fulfilmentmethods");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.ok && Array.isArray(data.results)) {
      // Find all fulfilment dropdowns in the table
      const selects = document.querySelectorAll("select.item-fulfilment");

      selects.forEach(select => {
        // reset options
        select.innerHTML = '<option value="">Select fulfilment method...</option>';

        data.results.forEach(opt => {
          const option = document.createElement("option");
          option.value = opt["Internal ID"];
          option.textContent = opt["Name"];
          select.appendChild(option);
        });
      });
    }

    console.log("✅ Populated fulfilment methods");
  } catch (err) {
    console.error("❌ Failed to load fulfilment methods:", err);
  }
}

// Run on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  populateFulfilmentMethods();
});
