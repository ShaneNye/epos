(function () {
  let salesNewFeaturePromise = null;

  function financeCalculatorEnabledOnSalesNew() {
    if (location.pathname !== "/sales/new") return Promise.resolve(true);
    if (salesNewFeaturePromise) return salesNewFeaturePromise;
    salesNewFeaturePromise = (async () => {
      try {
        const saved = typeof storageGet === "function" ? storageGet() : null;
        const response = await fetch("/api/promotions/settings", {
          headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || "Unable to load Sales features");
        const environment = data.environment === "production" ? "production" : "sandbox";
        return data.settings?.[environment]?.financeCalculatorEnabled !== false;
      } catch (error) {
        console.warn("Unable to load the Sales New finance feature setting:", error);
        return true;
      }
    })();
    return salesNewFeaturePromise;
  }

  function currentSaleAmount() {
    const text = document.getElementById("grandTotal")?.textContent || "";
    return Number(text.replace(/[^0-9.-]/g, "")) || 0;
  }

  function openFinanceCalculator(amount = currentSaleAmount()) {
    const sessionAuth = sessionStorage.getItem("eposAuth");
    if (sessionAuth) localStorage.setItem("eposAuth", sessionAuth);
    const popup = window.open(
      `/finance-calculator?amount=${encodeURIComponent(Number(amount) || 0)}`,
      "FinanceCalculator",
      "popup=yes,width=600,height=760,resizable=yes,scrollbars=yes"
    );
    if (!popup) alert("Please allow pop-ups to use the finance calculator.");
    else popup.focus();
    return popup;
  }

  async function attachTrigger() {
    const assistant = document.getElementById("assistantToggle");
    if (!assistant || document.getElementById("financeCalculatorTrigger")) return;
    if (!(await financeCalculatorEnabledOnSalesNew())) return;
    if (document.getElementById("financeCalculatorTrigger")) return;
    let hideTimer = null;
    const trigger = document.createElement("button");
    trigger.id = "financeCalculatorTrigger";
    trigger.className = "finance-flyout-trigger";
    trigger.type = "button";
    trigger.title = "Finance calculator";
    trigger.setAttribute("aria-label", "Open finance calculator");
    trigger.textContent = "£";
    trigger.addEventListener("click", () => openFinanceCalculator());
    assistant.insertAdjacentElement("beforebegin", trigger);

    const showTrigger = () => {
      clearTimeout(hideTimer);
      trigger.classList.add("is-visible");
    };
    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => trigger.classList.remove("is-visible"), 350);
    };
    assistant.addEventListener("mouseenter", showTrigger);
    assistant.addEventListener("mouseleave", scheduleHide);
    trigger.addEventListener("mouseenter", showTrigger);
    trigger.addEventListener("mouseleave", scheduleHide);
    trigger.addEventListener("focus", showTrigger);
    trigger.addEventListener("blur", scheduleHide);
  }

  document.addEventListener("assistantReady", attachTrigger);
  document.addEventListener("DOMContentLoaded", () => setTimeout(attachTrigger, 500));
  window.openFinanceCalculator = openFinanceCalculator;
})();
