document.addEventListener("DOMContentLoaded", () => {
  const rows = document.getElementById("financeTierRows");
  const status = document.getElementById("financeSettingsStatus");
  const saved = typeof storageGet === "function" ? storageGet() : null;
  const headers = { Authorization: `Bearer ${saved?.token || ""}` };
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  const safeNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function rowHtml(tier = {}) {
    return `
      <article class="finance-tier-row">
        <header class="finance-tier-title">
          <div><span class="finance-tier-number"></span><div><h3>Finance band</h3><p class="finance-tier-description"></p></div></div>
          <button type="button" class="finance-remove" title="Remove band" aria-label="Remove finance band"><span aria-hidden="true">×</span><span>Remove</span></button>
        </header>
        <div class="finance-tier-groups">
          <fieldset class="finance-tier-group"><legend>Order eligibility</legend>
            <label><span>Minimum order amount</span><div class="finance-prefix"><b aria-hidden="true">£</b><input type="number" data-field="minOrderAmount" min="0" step="0.01" inputmode="decimal" value="${safeNumber(tier.minOrderAmount, 500)}" required></div></label>
            <label><span>Minimum financed amount</span><div class="finance-prefix"><b aria-hidden="true">£</b><input type="number" data-field="minFinancedAmount" min="0" step="0.01" inputmode="decimal" value="${safeNumber(tier.minFinancedAmount, 0)}" required></div></label>
          </fieldset>
          <fieldset class="finance-tier-group"><legend>Term available</legend>
            <label><span>Months</span><input type="number" data-field="termMonths" min="1" max="120" inputmode="numeric" value="${safeNumber(tier.termMonths, 6)}" required></label>
          </fieldset>
          <fieldset class="finance-tier-group finance-tier-costs"><legend>Deposit &amp; interest</legend>
            <div class="finance-cost-fields">
              <label><span>Deposit required</span><div class="finance-suffix"><input type="number" data-field="depositPercent" min="0" max="100" step="0.01" inputmode="decimal" value="${safeNumber(tier.depositPercent, 0)}" required><b aria-hidden="true">%</b></div></label>
              <label><span>Example deposit</span><div class="finance-prefix"><b aria-hidden="true">£</b><input type="text" class="finance-example-deposit" value="0.00" readonly tabindex="-1"></div></label>
              <label class="finance-rate"><span>Interest rate (APR)</span><div class="finance-suffix"><input type="number" data-field="interestRatePercent" min="0" max="100" step="0.01" inputmode="decimal" value="${safeNumber(tier.interestRatePercent, 0)}" required><b aria-hidden="true">%</b></div></label>
            </div>
          </fieldset>
        </div>
        <p class="finance-tier-error" role="alert"></p>
      </article>`;
  }

  function tierValues(row) {
    const tier = {};
    row.querySelectorAll("[data-field]").forEach((input) => { tier[input.dataset.field] = Number(input.value); });
    return tier;
  }
  const values = () => [...rows.querySelectorAll(".finance-tier-row")].map(tierValues);

  function updateOverview() {
    const tiers = values();
    document.getElementById("financeBandCount").textContent = tiers.length;
    document.getElementById("financeCoverageRange").textContent = tiers.length
      ? `From ${money.format(Math.min(...tiers.map((tier) => tier.minOrderAmount || 0)))}` : "—";
    [...rows.querySelectorAll(".finance-tier-row")].forEach((row, index) => {
      const tier = tierValues(row);
      row.querySelector(".finance-tier-number").textContent = String(index + 1).padStart(2, "0");
      row.querySelector(".finance-tier-description").textContent = `${tier.termMonths || 0} months from ${money.format(tier.minOrderAmount || 0)} at ${tier.interestRatePercent || 0}% APR`;
      row.querySelector(".finance-example-deposit").value = ((tier.minOrderAmount || 0) * (tier.depositPercent || 0) / 100).toFixed(2);
    });
  }

  function validate(showErrors = true) {
    const rowElements = [...rows.querySelectorAll(".finance-tier-row")];
    const tiers = rowElements.map(tierValues);
    const errors = new Map();
    if (!tiers.length) return { valid: false, message: "Add at least one finance band." };
    const keys = new Map();
    tiers.forEach((tier, index) => {
      let message = "";
      if (!Number.isFinite(tier.minOrderAmount) || tier.minOrderAmount < 0) message = "Enter a valid minimum order amount.";
      else if (!Number.isFinite(tier.minFinancedAmount) || tier.minFinancedAmount < 0) message = "Enter a valid minimum financed amount.";
      else if (tier.termMonths < 1 || tier.termMonths > 120) message = "The term must be between 1 and 120 months.";
      else if (tier.depositPercent < 0 || tier.depositPercent > 100) message = "The deposit required must be between 0% and 100%.";
      else if (tier.interestRatePercent < 0 || tier.interestRatePercent > 100) message = "APR must be between 0% and 100%.";
      const key = `${tier.minOrderAmount}:${tier.termMonths}:${tier.interestRatePercent}`;
      if (!message && keys.has(key)) message = `This duplicates band ${keys.get(key) + 1}.`;
      if (message) errors.set(index, message);
      else keys.set(key, index);
    });
    rowElements.forEach((row, index) => {
      const message = errors.get(index) || "";
      row.classList.toggle("has-error", Boolean(message) && showErrors);
      row.querySelector(".finance-tier-error").textContent = showErrors ? message : "";
    });
    return { valid: errors.size === 0, message: errors.values().next().value || "", firstInvalid: errors.size ? rowElements[errors.keys().next().value] : null };
  }

  function bindRow(row) {
    row.addEventListener("input", () => { row.classList.remove("has-error"); row.querySelector(".finance-tier-error").textContent = ""; updateOverview(); });
    row.querySelector(".finance-remove").addEventListener("click", () => { row.remove(); updateOverview(); validate(false); });
  }
  function addRow(tier = {}) { rows.insertAdjacentHTML("beforeend", rowHtml(tier)); const row = rows.lastElementChild; bindRow(row); updateOverview(); return row; }

  async function load() {
    status.textContent = "Loading finance settings…";
    try {
      const response = await fetch("/api/finance-calculator/settings", { headers });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load settings");
      rows.innerHTML = ""; data.tiers.forEach(addRow); status.textContent = "";
    } catch (error) { status.textContent = error.message; status.dataset.tone = "error"; }
  }

  async function saveSettings() {
    const validation = validate(true);
    if (!validation.valid) { status.textContent = validation.message; status.dataset.tone = "error"; validation.firstInvalid?.querySelector("input")?.focus(); return; }
    const buttons = [document.getElementById("saveFinanceSettings"), document.getElementById("saveFinanceSettingsMobile")];
    buttons.forEach((button) => { button.disabled = true; }); status.textContent = "Saving changes…"; status.dataset.tone = "";
    try {
      const response = await fetch("/api/finance-calculator/settings", { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ tiers: values() }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save settings");
      status.textContent = "Finance settings saved successfully."; status.dataset.tone = "success";
    } catch (error) { status.textContent = error.message; status.dataset.tone = "error"; }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  }

  document.getElementById("addFinanceTier").addEventListener("click", () => { const row = addRow(); row.scrollIntoView({ behavior: "smooth", block: "center" }); row.querySelector("input")?.focus(); });
  document.getElementById("saveFinanceSettings").addEventListener("click", saveSettings);
  document.getElementById("saveFinanceSettingsMobile").addEventListener("click", saveSettings);
  document.getElementById("previewFinanceCalculator").addEventListener("click", () => window.open("/finance-calculator?amount=1500", "FinanceCalculatorPreview", "popup=yes,width=720,height=820,resizable=yes,scrollbars=yes"));
  load();
});
