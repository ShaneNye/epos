// public/js/widgets/visibility.js
console.log("Dashboard tab visibility loaded");

document.addEventListener("DOMContentLoaded", () => {
  const tabsNav = document.getElementById("dashboardTabs");
  const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));

  if (!tabsNav || !tabButtons.length || !tabPanels.length) return;

  function normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
  }

  function getStoredActiveRole() {
    const saved = storageGet();
    if (typeof saved?.activeRole === "string") return normalizeRole(saved.activeRole);
    if (saved?.activeRole?.name) return normalizeRole(saved.activeRole.name);
    if (typeof saved?.role === "string") return normalizeRole(saved.role);
    if (saved?.role?.name) return normalizeRole(saved.role.name);
    return "";
  }

  async function resolveActiveRole() {
    const saved = storageGet();
    if (!saved?.token) return "";
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) return "";
      return normalizeRole(data.activeRole || data.user?.activeRole);
    } catch (error) {
      console.error("Could not resolve active dashboard role:", error);
      return "";
    }
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
    // The server session is authoritative. Stored role is only a fallback for
    // transient /api/me failures and is never expanded to all assigned roles.
    const activeRole = await resolveActiveRole() || getStoredActiveRole();
    if (!activeRole) {
      tabsNav.hidden = true;
      tabPanels.forEach((panel) => { panel.hidden = true; panel.classList.add("hidden"); });
      showNoTabsMessage();
      return;
    }

    try {
      const res = await fetch("/api/dashboard-tabs");
      if (!res.ok) throw new Error("Failed to load dashboard tab config");

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.tabs)) {
        throw new Error("Invalid dashboard tab config");
      }

      applyVisibility(data.tabs, [activeRole]);
    } catch (err) {
      console.error("Dashboard tab visibility load failed:", err);
      tabsNav.hidden = true;
      tabPanels.forEach((panel) => { panel.hidden = true; panel.classList.add("hidden"); });
      showNoTabsMessage();
    }
  }

  window.addEventListener("epos:active-role-ready", tryLoadVisibility);
  tryLoadVisibility();
});
