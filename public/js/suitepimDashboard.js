(function () {
  function activateTab(tab) {
    const target = tab?.dataset?.suitepimDashboardTab;
    if (!target) return;

    document.querySelectorAll("[data-suitepim-dashboard-tab]").forEach((button) => {
      const isActive = button === tab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    document.querySelectorAll("[data-suitepim-dashboard-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.suitepimDashboardPanel !== target;
    });
  }

  function bindDashboardTabs() {
    const tabs = Array.from(document.querySelectorAll("[data-suitepim-dashboard-tab]"));
    if (!tabs.length) return;

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateTab(tab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();

        const lastIndex = tabs.length - 1;
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? lastIndex
            : event.key === "ArrowLeft"
              ? (index === 0 ? lastIndex : index - 1)
              : (index === lastIndex ? 0 : index + 1);

        tabs[nextIndex].focus();
        activateTab(tabs[nextIndex]);
      });
    });

    activateTab(tabs.find((tab) => tab.classList.contains("active")) || tabs[0]);
  }

  window.addEventListener("DOMContentLoaded", bindDashboardTabs);
})();
