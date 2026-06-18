// public/js/widgets/visibility.js
console.log("Dashboard tab visibility loaded");

document.addEventListener("DOMContentLoaded", () => {
  const tabsNav = document.getElementById("dashboardTabs");
  const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));

  if (!tabsNav || !tabButtons.length || !tabPanels.length) return;

  let retries = 0;

  function normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
  }

  function getUserRoles() {
    const saved = storageGet();
    const roles = [];

    if (Array.isArray(saved?.user?.roles)) roles.push(...saved.user.roles);

    if (typeof saved?.activeRole === "string") {
      roles.push(saved.activeRole);
    } else if (saved?.activeRole?.name) {
      roles.push(saved.activeRole.name);
    }

    if (saved?.role) roles.push(saved.role);

    return [...new Set(roles.map(normalizeRole).filter(Boolean))];
  }

  function setActiveTab(tabKey) {
    tabButtons.forEach((button) => {
      const active = button.dataset.tab === tabKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });

    tabPanels.forEach((panel) => {
      const active = panel.dataset.tabPanel === tabKey;
      panel.hidden = !active;
      panel.classList.toggle("hidden", !active);
      panel.classList.toggle("active", active);
    });
  }

  function showNoTabsMessage() {
    document.querySelector(".dashboard-tab-empty")?.remove();
    const empty = document.createElement("div");
    empty.className = "no-data dashboard-tab-empty";
    empty.textContent = "You don't have permission to view any dashboard tabs.";
    tabsNav.insertAdjacentElement("afterend", empty);
  }

  function applyVisibility(config, userRoles) {
    const configByTab = new Map(
      (config || []).map((tab) => [tab.tab, (tab.roles || []).map(normalizeRole).filter(Boolean)])
    );

    const visibleTabs = [];

    tabButtons.forEach((button) => {
      const roles = configByTab.get(button.dataset.tab) || [];
      const hasAccess = !roles.length || roles.some((role) => userRoles.includes(role));
      button.hidden = !hasAccess;
      button.style.display = hasAccess ? "" : "none";
      if (hasAccess) visibleTabs.push(button.dataset.tab);
    });

    tabsNav.hidden = !visibleTabs.length;
    tabsNav.style.display = visibleTabs.length ? "flex" : "none";

    tabPanels.forEach((panel) => {
      const hasAccess = visibleTabs.includes(panel.dataset.tabPanel);
      if (!hasAccess) {
        panel.hidden = true;
        panel.classList.add("hidden");
        panel.classList.remove("active");
      }
    });

    document.querySelector(".dashboard-tab-empty")?.remove();
    if (!visibleTabs.length) {
      showNoTabsMessage();
      return;
    }

    const currentActive = tabPanels.find((panel) =>
      panel.classList.contains("active") && visibleTabs.includes(panel.dataset.tabPanel)
    );

    setActiveTab(currentActive?.dataset.tabPanel || visibleTabs[0]);
  }

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!button.hidden) setActiveTab(button.dataset.tab);
    });
  });

  async function tryLoadVisibility() {
    const userRoles = getUserRoles();

    if (!userRoles.length && retries < 5) {
      retries++;
      console.warn(`No role info found (attempt ${retries}) - retrying...`);
      return setTimeout(tryLoadVisibility, 400);
    }

    if (!userRoles.length) {
      console.warn("No role info found after retries; showing dashboard tabs");
      return;
    }

    try {
      const res = await fetch("/api/dashboard-tabs");
      if (!res.ok) throw new Error("Failed to load dashboard tab config");

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.tabs)) {
        throw new Error("Invalid dashboard tab config");
      }

      applyVisibility(data.tabs, userRoles);
    } catch (err) {
      console.error("Dashboard tab visibility load failed:", err);
    }
  }

  tryLoadVisibility();
});
