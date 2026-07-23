document.addEventListener("DOMContentLoaded", () => {
  const rows = document.getElementById("financeTierRows");
  const status = document.getElementById("financeSettingsStatus");
  const saved = typeof storageGet === "function" ? storageGet() : null;
  const headers = { Authorization: `Bearer ${saved?.token || ""}` };

  function rowHtml(tier = {}) {
    return `
      <div class="finance-tier-row">
        <label><span>From</span><div class="finance-prefix"><b>£</b><input type="number" data-field="minSaleAmount" min="0" step="0.01" value="${tier.minSaleAmount ?? 0}" required></div></label>
        <label><span>To</span><div class="finance-prefix"><b>£</b><input type="number" data-field="maxSaleAmount" min="0" step="0.01" value="${tier.maxSaleAmount ?? 999999.99}" required></div></label>
        <div class="finance-term-pair"><label><span>Min</span><input type="number" data-field="minTermMonths" min="1" max="120" value="${tier.minTermMonths ?? 6}" required></label><label><span>Max</span><input type="number" data-field="maxTermMonths" min="1" max="120" value="${tier.maxTermMonths ?? 36}" required></label></div>
        <label><span>Deposit</span><div class="finance-suffix"><input type="number" data-field="minimumDepositPercent" min="0" max="100" step="0.01" value="${tier.minimumDepositPercent ?? 10}" required><b>%</b></div></label>
        <label class="finance-switch-label"><span>Interest bearing</span><input type="checkbox" data-field="interestBearing" ${tier.interestBearing ? "checked" : ""}><i></i></label>
        <label class="finance-rate"><span>APR</span><div class="finance-suffix"><input type="number" data-field="interestRatePercent" min="0" max="100" step="0.01" value="${tier.interestRatePercent ?? 0}"><b>%</b></div></label>
        <button type="button" class="finance-remove" title="Remove band" aria-label="Remove band">×</button>
      </div>`;
  }

  function bindRow(row) {
    const interest = row.querySelector('[data-field="interestBearing"]');
    const rate = row.querySelector('[data-field="interestRatePercent"]');
    const sync = () => { rate.disabled = !interest.checked; if (!interest.checked) rate.value = 0; };
    interest.addEventListener("change", sync);
    row.querySelector(".finance-remove").addEventListener("click", () => row.remove());
    sync();
  }

  function addRow(tier) {
    rows.insertAdjacentHTML("beforeend", rowHtml(tier));
    bindRow(rows.lastElementChild);
  }

  function values() {
    return [...rows.querySelectorAll(".finance-tier-row")].map((row) => {
      const tier = {};
      row.querySelectorAll("[data-field]").forEach((input) => {
        tier[input.dataset.field] = input.type === "checkbox" ? input.checked : Number(input.value);
      });
      return tier;
    });
  }

  async function load() {
    try {
      const response = await fetch("/api/finance-calculator/settings", { headers });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load settings");
      rows.innerHTML = "";
      data.tiers.forEach(addRow);
    } catch (error) {
      status.textContent = error.message;
      status.dataset.tone = "error";
    }
  }

  document.getElementById("addFinanceTier").addEventListener("click", () => addRow());
  document.getElementById("saveFinanceSettings").addEventListener("click", async () => {
    status.textContent = "Saving…";
    status.dataset.tone = "";
    try {
      const response = await fetch("/api/finance-calculator/settings", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: values() }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to save settings");
      status.textContent = "Finance settings saved.";
      status.dataset.tone = "success";
    } catch (error) {
      status.textContent = error.message;
      status.dataset.tone = "error";
    }
  });

  load();
});
