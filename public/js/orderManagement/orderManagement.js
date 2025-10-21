document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll("#managementTabs .tab");
  const panels = document.querySelectorAll(".tab-content .tab-panel");

  function setActive(tabName) {
    // tabs
    tabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });

    // panels (must remove/add .hidden because it's !important)
    panels.forEach(panel => {
      const isActive = panel.id === tabName;
      panel.classList.toggle("active", isActive);
      if (isActive) {
        panel.classList.remove("hidden");
      } else {
        panel.classList.add("hidden");
      }
    });
  }

  // click handlers
  tabs.forEach(tab => {
    tab.addEventListener("click", () => setActive(tab.dataset.tab));
  });

  // initial state (supports #hash deep-link if present)
  const hash = location.hash.replace("#", "");
  const initial = (hash && document.getElementById(hash)) 
    ? hash 
    : (document.querySelector(".tab.active")?.dataset.tab || tabs[0].dataset.tab);
  setActive(initial);
});
