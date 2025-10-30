// public/js/reports/reports.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("📑 Reports.js loaded — handling tab logic");

  const tabs = document.querySelectorAll(".tab");
  const contents = document.querySelectorAll(".tab-content");

  function activateTab(tab) {
    tabs.forEach(t => t.classList.remove("active"));
    contents.forEach(c => c.classList.add("hidden"));

    tab.classList.add("active");
    const target = document.getElementById(tab.dataset.target);
    if (target) target.classList.remove("hidden");

    // 🔔 Dispatch event so each module can listen when its tab is shown
    window.dispatchEvent(new CustomEvent("reports:tabchange", { detail: { id: tab.dataset.target } }));
  }

  tabs.forEach(tab => tab.addEventListener("click", () => activateTab(tab)));

  // Default to first active tab
  const defaultTab = document.querySelector(".tab.active") || tabs[0];
  if (defaultTab) activateTab(defaultTab);
});
