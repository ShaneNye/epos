document.addEventListener("DOMContentLoaded", () => {
  const rows = document.getElementById("financeTierRows");
  const status = document.getElementById("financeSettingsStatus");
  const saved = typeof storageGet === "function" ? storageGet() : null;
  const headers = { Authorization: `Bearer ${saved?.token || ""}` };
  const money = new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "GBP", maximumFractionDigits: 2,
  });

  function safeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function rowHtml(tier = {}) {
    return `
      <article class="finance-tier-row">
        <header class="finance-tier-title">
          <div><span class="finance-tier-number"></span><div><h3>Finance band</h3><p class="finance-tier-description"></p></div></div>
          <button type="button" class="finance-remove" title="Remove band" aria-label="Remove finance band">
            <span aria-hidden="true">×</span><span>Remove</span>
          </button>
        </header>
        <div class="finance-tier-groups">
          <fieldset class="finance-tier-group">
            <legend>Purchase value</legend>
            <div class="finance-field-pair">
              <label><span>From</span><div class="finance-prefix"><b aria-hidden="true">£</b><input type="number" data-field="minSaleAmount" min="0" step="0.01" inputmode="decimal" value="${safeNumber(tier.minSaleAmount, 0)}" required></div></label>
              <label><span>To</span><div class="finance-prefix"><b aria-hidden="true">£</b><input type="number" data-field="maxSaleAmount" min="0" step="0.01" inputmode="decimal" value="${safeNumber(tier.maxSaleAmount, 999999.99)}" required></div></label>
            </div>
          </fieldset>
          <fieldset class="finance-tier-group">
            <legend>Available term</legend>
            <div class="finance-field-pair">
              <label><span>Minimum months</span><input type="number" data-field="minTermMonths" min="1" max="120" inputmode="numeric" value="${safeNumber(tier.minTermMonths, 6)}" required></label>
              <label><span>Maximum months</span><input type="number" data-field="maxTermMonths" min="1" max="120" inputmode="numeric" value="${safeNumber(tier.maxTermMonths, 36)}" required></label>
            </div>
          </fieldset>
          <fieldset class="finance-tier-group finance-tier-costs">
            <legend>Deposit &amp; interest</legend>
            <div class="finance-cost-fields">
              <label><span>Minimum deposit</span><div class="finance-suffix"><input type="number" data-field="minimumDepositPercent" min="0" max="100" step="0.01" inputmode="decimal" value="${safeNumber(tier.minimumDepositPercent, 10)}" required><b aria-hidden="true">%</b></div></label>
              <label class="finance-switch-label">
                <span><strong>Interest bearing</strong><small>Apply an APR to this band</small></span>
                <input type="checkbox" data-field="interestBearing" ${tier.interestBearing ? "checked" : ""}>
                <i aria-hidden="true"></i>
              </label>
              <label class="finance-rate"><span>APR</span><div class="finance-suffix"><input type="number" data-field="interestRatePercent" min="0" max="100" step="0.01" inputmode="decimal" value="${safeNumber(tier.interestRatePercent, 0)}"><b aria-hidden="true">%</b></div></label>
            </div>
          </fieldset>
        </div>
        <p class="finance-tier-error" role="alert"></p>
      </article>`;
  }

  function tierValues(row) {
    const tier = {};
    row.querySelectorAll("[data-field]").forEach((input) => {
      tier[input.dataset.field] = input.type === "checkbox" ? input.checked : Number(input.value);
    });
    return tier;
  }

  function values() {
    return [...rows.querySelectorAll(".finance-tier-row")].map(tierValues);
  }

  function updateOverview() {
    const tiers = values();
    document.getElementById("financeBandCount").textContent = tiers.length;
    document.getElementById("financeCoverageRange").textContent = tiers.length
      ? `${money.format(Math.min(...tiers.map((tier) => tier.minSaleAmount || 0)))} – ${money.format(Math.max(...tiers.map((tier) => tier.maxSaleAmount || 0)))}`
      : "—";
    [...rows.querySelectorAll(".finance-tier-row")].forEach((row, index) => {
      const tier = tierValues(row);
      row.querySelector(".finance-tier-number").textContent = String(index + 1).padStart(2, "0");
      row.querySelector(".finance-tier-description").textContent =
        `${money.format(tier.minSaleAmount || 0)} to ${money.format(tier.maxSaleAmount || 0)}`;
    });
  }

  function validate(showErrors = true) {
    const rowElements = [...rows.querySelectorAll(".finance-tier-row")];
    const tiers = rowElements.map(tierValues);
    const errors = new Map();
    if (!tiers.length) return { valid: false, message: "Add at least one finance band." };

    tiers.forEach((tier, index) => {
      let message = "";
      if (!Number.isFinite(tier.minSaleAmount) || !Number.isFinite(tier.maxSaleAmount)) {
        message = "Enter a valid purchase-value range.";
      } else if (tier.minSaleAmount < 0 || tier.maxSaleAmount < tier.minSaleAmount) {
        message = "The maximum purchase value must be greater than or equal to the minimum.";
      } else if (tier.minTermMonths < 1 || tier.maxTermMonths < tier.minTermMonths) {
        message = "The maximum term must be greater than or equal to the minimum term.";
      } else if (tier.minimumDepositPercent < 0 || tier.minimumDepositPercent > 100) {
        message = "The minimum deposit must be between 0% and 100%.";
      } else if (tier.interestRatePercent < 0 || tier.interestRatePercent > 100) {
        message = "APR must be between 0% and 100%.";
      }
      if (message) errors.set(index, message);
    });

    const sorted = tiers.map((tier, index) => ({ ...tier, index }))
      .sort((a, b) => a.minSaleAmount - b.minSaleAmount);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].minSaleAmount <= sorted[index - 1].maxSaleAmount) {
        errors.set(sorted[index].index, `This range overlaps band ${sorted[index - 1].index + 1}.`);
      }
    }

    rowElements.forEach((row, index) => {
      const message = errors.get(index) || "";
      row.classList.toggle("has-error", !!message && showErrors);
      row.querySelector(".finance-tier-error").textContent = showErrors ? message : "";
    });
    return {
      valid: errors.size === 0,
      message: errors.values().next().value || "",
      firstInvalid: errors.size ? rowElements[errors.keys().next().value] : null,
    };
  }

  function bindRow(row) {
    const interest = row.querySelector('[data-field="interestBearing"]');
    const rate = row.querySelector('[data-field="interestRatePercent"]');
    const syncInterest = () => {
      rate.disabled = !interest.checked;
      if (!interest.checked) rate.value = 0;
      rate.closest(".finance-rate").classList.toggle("is-disabled", !interest.checked);
    };
    interest.addEventListener("change", () => {
      syncInterest();
      updateOverview();
      validate(false);
    });
    row.addEventListener("input", () => {
      row.classList.remove("has-error");
      row.querySelector(".finance-tier-error").textContent = "";
      updateOverview();
    });
    row.querySelector(".finance-remove").addEventListener("click", () => {
      row.remove();
      updateOverview();
      validate(false);
    });
    syncInterest();
  }

  function addRow(tier = {}) {
    rows.insertAdjacentHTML("beforeend", rowHtml(tier));
    const row = rows.lastElementChild;
    bindRow(row);
    updateOverview();
    return row;
  }

  async function load() {
    status.textContent = "Loading finance settings…";
    try {
      const response = await fetch("/api/finance-calculator/settings", { headers });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load settings");
      rows.innerHTML = "";
      data.tiers.forEach(addRow);
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
      status.dataset.tone = "error";
    }
  }

  async function saveSettings() {
    const validation = validate(true);
    if (!validation.valid) {
      status.textContent = validation.message;
      status.dataset.tone = "error";
      validation.firstInvalid?.querySelector("input")?.focus();
      validation.firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const buttons = [
      document.getElementById("saveFinanceSettings"),
      document.getElementById("saveFinanceSettingsMobile"),
    ];
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = "Saving changes…";
    status.dataset.tone = "";
    try {
      const response = await fetch("/api/finance-calculator/settings", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: values() }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save settings");
      status.textContent = "Finance settings saved successfully.";
      status.dataset.tone = "success";
    } catch (error) {
      status.textContent = error.message;
      status.dataset.tone = "error";
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  document.getElementById("addFinanceTier").addEventListener("click", () => {
    const newRow = addRow();
    newRow.scrollIntoView({ behavior: "smooth", block: "center" });
    newRow.querySelector("input")?.focus();
  });
  document.getElementById("saveFinanceSettings").addEventListener("click", saveSettings);
  document.getElementById("saveFinanceSettingsMobile").addEventListener("click", saveSettings);
  document.getElementById("previewFinanceCalculator").addEventListener("click", () => {
    window.open("/finance-calculator?amount=1500", "FinanceCalculatorPreview", "popup=yes,width=720,height=820,resizable=yes,scrollbars=yes");
  });

  load();
});
