document.addEventListener("DOMContentLoaded", async () => {
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  const saleInput = document.getElementById("financeSaleAmount");
  const depositInput = document.getElementById("financeDeposit");
  const termInput = document.getElementById("financeTerm");
  const controls = document.getElementById("financeControls");
  const unavailable = document.getElementById("financeUnavailable");
  const loading = document.getElementById("financeLoading");
  const status = document.getElementById("financePopupStatus");
  const budgetToggle = document.getElementById("financeBudgetToggle");
  const monthlyDisplay = document.getElementById("financeMonthly");
  const budgetHelp = document.getElementById("financeBudgetHelp");
  let tiers = [];
  let activeTier = null;
  let updatingControls = false;
  let targetMonthly = 0;
  let budgetDepositBounds = null;
  const query = new URLSearchParams(location.search);
  const journeyToken = query.get("journey") || "";
  document.getElementById("financeJourneyProgress").hidden = !journeyToken;
  let journey = null;

  function payment(principal, annualRate, months) {
    if (!annualRate) return principal / months;
    const rate = annualRate / 100 / 12;
    return principal * rate / (1 - Math.pow(1 + rate, -months));
  }

  function principalForPayment(monthlyPayment, annualRate, months) {
    if (!annualRate) return monthlyPayment * months;
    const rate = annualRate / 100 / 12;
    return monthlyPayment * (1 - Math.pow(1 + rate, -months)) / rate;
  }

  function minimumDepositFor(amount, tier) {
    return amount * tier.minimumDepositPercent / 100;
  }

  function applyBudgetForTerm() {
    if (!budgetToggle.checked || !activeTier) return;
    const amount = Number(saleInput.value) || 0;
    const target = Math.max(0.01, targetMonthly || 0.01);
    const minimumDeposit = minimumDepositFor(amount, activeTier);
    const financed = principalForPayment(target, activeTier.interestRatePercent, Number(termInput.value));
    const requiredDeposit = Math.max(minimumDeposit, Math.min(amount, amount - financed));
    if (
      budgetDepositBounds &&
      (requiredDeposit < budgetDepositBounds.min || requiredDeposit > budgetDepositBounds.max)
    ) {
      budgetDepositBounds = {
        min: Math.min(budgetDepositBounds.min, requiredDeposit),
        max: Math.max(budgetDepositBounds.max, requiredDeposit),
      };
      depositInput.min = budgetDepositBounds.min.toFixed(2);
      depositInput.max = budgetDepositBounds.max.toFixed(2);
    }
    depositInput.value = requiredDeposit.toFixed(2);
    const achievable = payment(amount - requiredDeposit, activeTier.interestRatePercent, Number(termInput.value));
    budgetHelp.hidden = false;
    budgetHelp.textContent = Math.abs(achievable - target) > 0.02
      ? `The closest available payment is ${money.format(achievable)} with the minimum deposit rules.`
      : "Deposit adjusted automatically to maintain your monthly budget.";
  }

  function initialiseBudgetControls() {
    if (!budgetToggle.checked || !activeTier) return;
    const amount = Number(saleInput.value) || 0;
    const target = Math.max(0.01, targetMonthly || 0.01);
    const minimumDeposit = minimumDepositFor(amount, activeTier);
    const middleTerm = Math.round((activeTier.minTermMonths + activeTier.maxTermMonths) / 2);
    const candidates = [];
    for (let months = activeTier.minTermMonths; months <= activeTier.maxTermMonths; months += 1) {
      const requiredDeposit =
        amount - principalForPayment(target, activeTier.interestRatePercent, months);
      if (requiredDeposit >= minimumDeposit && requiredDeposit <= amount) {
        candidates.push({ months, requiredDeposit });
      }
    }
    const selected = candidates.sort(
      (a, b) => Math.abs(a.months - middleTerm) - Math.abs(b.months - middleTerm)
    )[0];
    const selectedTerm = selected?.months ?? middleTerm;
    const requiredDeposit = selected?.requiredDeposit ??
      Math.max(
        minimumDeposit,
        Math.min(
          amount,
          amount - principalForPayment(target, activeTier.interestRatePercent, selectedTerm)
        )
      );

    termInput.value = selectedTerm;
    depositInput.value = requiredDeposit.toFixed(2);

    const roomBelow = requiredDeposit - minimumDeposit;
    const roomAbove = amount - requiredDeposit;
    const balancedRoom = Math.min(roomBelow, roomAbove);
    budgetDepositBounds = balancedRoom > 0.01
      ? {
          min: requiredDeposit - balancedRoom,
          max: requiredDeposit + balancedRoom,
        }
      : null;
  }

  function chooseTermForDeposit() {
    if (!budgetToggle.checked || !activeTier) return;
    const amount = Number(saleInput.value) || 0;
    const target = Math.max(0.01, targetMonthly || 0.01);
    const principal = Math.max(0, amount - (Number(depositInput.value) || 0));
    let bestTerm = activeTier.minTermMonths;
    let bestDifference = Infinity;
    for (let months = activeTier.minTermMonths; months <= activeTier.maxTermMonths; months += 1) {
      const difference = Math.abs(payment(principal, activeTier.interestRatePercent, months) - target);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestTerm = months;
      }
    }
    termInput.value = bestTerm;
  }

  function render({ preserveBudget = false } = {}) {
    if (updatingControls) return;
    updatingControls = true;
    const amount = Number(saleInput.value) || 0;
    const tier = tiers.find((item) => amount >= item.minSaleAmount && amount <= item.maxSaleAmount);
    if (!tier) {
      activeTier = null;
      unavailable.textContent = "Finance is not configured for this sale amount.";
      unavailable.hidden = false;
      controls.hidden = true;
      updatingControls = false;
      return;
    }
    activeTier = tier;
    unavailable.hidden = true;
    controls.hidden = false;
    const tierIndex = tiers.indexOf(tier);
    const minimumDeposit = amount * tier.minimumDepositPercent / 100;
    const depositMinimum =
      budgetToggle.checked && budgetDepositBounds
        ? budgetDepositBounds.min
        : minimumDeposit;
    const depositMaximum =
      budgetToggle.checked && budgetDepositBounds
        ? budgetDepositBounds.max
        : amount;
    depositInput.min = depositMinimum.toFixed(2);
    depositInput.max = depositMaximum.toFixed(2);
    depositInput.step = amount > 1000 ? "10" : "1";
    if (
      +depositInput.value < depositMinimum ||
      +depositInput.value > depositMaximum ||
      depositInput.dataset.tier !== String(tierIndex)
    ) {
      depositInput.value = minimumDeposit.toFixed(2);
    }
    depositInput.dataset.tier = String(tierIndex);
    termInput.min = tier.minTermMonths;
    termInput.max = tier.maxTermMonths;
    if (+termInput.value < tier.minTermMonths || +termInput.value > tier.maxTermMonths) termInput.value = tier.minTermMonths;
    if (budgetToggle.checked && preserveBudget) applyBudgetForTerm();
    document.getElementById("financeDepositHelp").textContent = `Minimum ${tier.minimumDepositPercent}% (${money.format(minimumDeposit)})`;
    document.getElementById("financeTermHelp").textContent = `${tier.minTermMonths}–${tier.maxTermMonths} months`;
    const deposit = Math.max(minimumDeposit, Number(depositInput.value) || 0);
    const months = Number(termInput.value);
    document.getElementById("financeDepositValue").textContent = money.format(deposit);
    document.getElementById("financeTermValue").textContent = `${months} ${months === 1 ? "month" : "months"}`;
    const financed = Math.max(0, amount - deposit);
    const monthly = payment(financed, tier.interestRatePercent, months);
    if (!budgetToggle.checked) monthlyDisplay.textContent = money.format(monthly);
    document.getElementById("financeApr").textContent = tier.interestBearing ? `${tier.interestRatePercent}% APR` : "0% interest";
    document.getElementById("financeBorrowed").textContent = money.format(financed);
    document.getElementById("financeTotalPayable").textContent = money.format(monthly * months + deposit);
    updatingControls = false;
  }

  saleInput.value = (Number(query.get("amount")) || 0).toFixed(2);
  if (journeyToken) {
    saleInput.readOnly = true;
    saleInput.setAttribute("aria-readonly", "true");
  }
  saleInput.addEventListener("input", () => {
    budgetDepositBounds = null;
    render();
    if (budgetToggle.checked) {
      initialiseBudgetControls();
      render({ preserveBudget: true });
    }
  });
  depositInput.addEventListener("input", () => {
    if (budgetToggle.checked) chooseTermForDeposit();
    render({ preserveBudget: budgetToggle.checked });
  });
  termInput.addEventListener("input", () => {
    if (budgetToggle.checked) applyBudgetForTerm();
    render({ preserveBudget: budgetToggle.checked });
  });
  budgetToggle.addEventListener("change", () => {
    budgetHelp.hidden = !budgetToggle.checked;
    monthlyDisplay.contentEditable = budgetToggle.checked ? "true" : "false";
    monthlyDisplay.classList.toggle("is-editable", budgetToggle.checked);
    if (budgetToggle.checked) {
      targetMonthly = Number(monthlyDisplay.textContent.replace(/[^0-9.-]/g, "")) || 0.01;
      initialiseBudgetControls();
      render({ preserveBudget: true });
      monthlyDisplay.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(monthlyDisplay);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      budgetDepositBounds = null;
      budgetHelp.hidden = true;
      render();
    }
  });
  monthlyDisplay.addEventListener("input", () => {
    if (!budgetToggle.checked) return;
    targetMonthly = Number(monthlyDisplay.textContent.replace(/[^0-9.-]/g, "")) || 0.01;
    initialiseBudgetControls();
    render({ preserveBudget: true });
  });
  monthlyDisplay.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      monthlyDisplay.blur();
    }
  });
  monthlyDisplay.addEventListener("blur", () => {
    if (budgetToggle.checked) monthlyDisplay.textContent = money.format(targetMonthly);
  });
  try {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    const settingsUrl = journeyToken
      ? `/api/qr-journeys/public/${encodeURIComponent(journeyToken)}/finance-settings`
      : "/api/finance-calculator/settings";
    const response = await fetch(settingsUrl, journeyToken ? {} : {
      headers: { Authorization: `Bearer ${saved?.token || ""}` },
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load finance settings");
    tiers = data.tiers;
    render();
    if (journeyToken) await initialiseQuoteJourney();
  } catch (error) {
    status.textContent = error.message || "The finance calculator is unavailable.";
    status.dataset.tone = "error";
  } finally {
    loading.hidden = true;
  }

  async function initialiseQuoteJourney() {
    const response = await fetch(`/api/qr-journeys/public/${encodeURIComponent(journeyToken)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load quote journey");
    journey = data.journey;
    document.getElementById("financeQuoteButton").hidden = false;
  }

  const quoteButton = document.getElementById("financeQuoteButton");
  quoteButton.addEventListener("click", () => {
    if (!journey) return;
    sessionStorage.setItem(`qrJourneyFinance:${journeyToken}`, JSON.stringify({
      saleAmount: Number(saleInput.value) || 0,
      deposit: Number(depositInput.value) || 0,
      termMonths: Number(termInput.value) || 0,
      estimatedMonthlyPayment: Number(monthlyDisplay.textContent.replace(/[^0-9.-]/g, "")) || 0,
      monthlyBudgetEnabled: budgetToggle.checked,
      amountFinanced: Number(document.getElementById("financeBorrowed").textContent.replace(/[^0-9.-]/g, "")) || 0,
      totalPayable: Number(document.getElementById("financeTotalPayable").textContent.replace(/[^0-9.-]/g, "")) || 0,
      apr: document.getElementById("financeApr").textContent,
    }));
    location.href = `/quote-details?journey=${encodeURIComponent(journeyToken)}`;
  });
});
