(function () {
  const NAV_COLLAPSED_KEY = "suitepimNavCollapsed";
  const DEFAULT_FEATURES = {
    dashboard: {
      stockManagement: true,
      floorPlans: true,
    },
    pages: {
      itemManagement: true,
      scheduledExports: true,
      campaigns: true,
      productValidation: true,
      reasonsToBuy: true,
      itemFaqs: true,
      settings: true,
    },
  };
  const PAGE_FEATURES = {
    "/suitepim/web-management": "itemManagement",
    "/suitepim/product-data": "itemManagement",
    "/suitepim/scheduled-exports": "scheduledExports",
    "/suitepim/product-validation": "productValidation",
    "/suitepim/campaigns": "campaigns",
    "/suitepim/item-faqs": "itemFaqs",
    "/suitepim/settings": "settings",
    "/suitepim/reasons-to-buy": "reasonsToBuy",
  };
  const ALL_PAGE_URLS = [
    "/suitepim",
    "/suitepim/web-management",
    "/suitepim/scheduled-exports",
    "/suitepim/product-validation",
    "/suitepim/reasons-to-buy",
    "/suitepim/item-faqs",
    "/suitepim/settings",
  ];

  function authHeaders(extra = {}) {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return {
      ...extra,
      ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
    };
  }

  function normalizePath(value) {
    const path = String(value || "").replace(/\/$/, "") || "/";
    return path.endsWith(".html") ? path.slice(0, -5) : path;
  }

  function normalizeFeatures(value = {}) {
    const dashboard = value.dashboard && typeof value.dashboard === "object" ? value.dashboard : {};
    const pages = value.pages && typeof value.pages === "object" ? value.pages : {};
    return {
      dashboard: Object.fromEntries(
        Object.entries(DEFAULT_FEATURES.dashboard).map(([key, fallback]) => [key, dashboard[key] !== false && fallback])
      ),
      pages: Object.fromEntries(
        Object.entries(DEFAULT_FEATURES.pages).map(([key, fallback]) => [key, pages[key] !== false && fallback])
      ),
    };
  }

  async function loadSuitePimFeatures() {
    try {
      const response = await fetch("/api/suitepim/features", {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const data = await response.json();
      return normalizeFeatures(data.features || {});
    } catch (err) {
      console.warn("SuitePim feature settings unavailable:", err.message);
      return normalizeFeatures();
    }
  }

  function dashboardEnabled(features) {
    return features.dashboard.stockManagement !== false || features.dashboard.floorPlans !== false;
  }

  function setupSuitePimSideNav() {
    const nav = document.querySelector(".suitepim-subnav");
    if (!nav || nav.dataset.sideNavBound === "1") return;

    nav.dataset.sideNavBound = "1";
    const collapsed = localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
    document.body.classList.toggle("suitepim-nav-open", !collapsed);
    document.body.classList.toggle("suitepim-nav-collapsed", collapsed);

    nav.querySelectorAll(".suitepim-subnav-link").forEach((link) => {
      const label = String(link.textContent || "").trim();
      if (label) link.title = label;
    });

    const itemManagementLink = nav.querySelector('a[href="/suitepim/web-management"]');
    if (itemManagementLink && !nav.querySelector('a[href="/suitepim/scheduled-exports"]')) {
      const scheduledLink = document.createElement("a");
      scheduledLink.className = "suitepim-subnav-link";
      if (window.location.pathname.replace(/\/$/, "") === "/suitepim/scheduled-exports") scheduledLink.classList.add("active");
      scheduledLink.href = "/suitepim/scheduled-exports";
      scheduledLink.title = "Scheduled Exports";
      scheduledLink.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M8 2v4"></path>
          <path d="M16 2v4"></path>
          <path d="M4 9h16"></path>
          <path d="M5 5h14v15H5z"></path>
          <path d="M12 13v3l2 1"></path>
        </svg>
        Scheduled Exports
      `;
      itemManagementLink.insertAdjacentElement("afterend", scheduledLink);
    }

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "suitepim-side-nav-close";
    closeButton.setAttribute("aria-label", "Collapse SuitePim navigation");
    closeButton.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M15 6l-6 6 6 6"></path>
      </svg>
    `;

    const heading = document.createElement("div");
    heading.className = "suitepim-side-nav-head";
    heading.innerHTML = `
      <div>
        <span>SuitePim</span>
        <strong>Sections</strong>
      </div>
    `;
    heading.prepend(closeButton);

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "suitepim-side-nav-tab";
    tab.setAttribute("aria-label", "Open SuitePim navigation");
    tab.innerHTML = `<span>SuitePim</span>`;
    document.body.appendChild(tab);

    function setCollapsed(nextCollapsed) {
      document.body.classList.toggle("suitepim-nav-open", !nextCollapsed);
      document.body.classList.toggle("suitepim-nav-collapsed", nextCollapsed);
      localStorage.setItem(NAV_COLLAPSED_KEY, nextCollapsed ? "1" : "0");
    }

    closeButton.addEventListener("click", () => setCollapsed(true));
    tab.addEventListener("click", () => setCollapsed(false));

    nav.prepend(heading);
  }

  function hideDisabledNavLinks(features) {
    const nav = document.querySelector(".suitepim-subnav");
    if (!nav) return;

    nav.querySelectorAll(".suitepim-subnav-link").forEach((link) => {
      const path = normalizePath(link.getAttribute("href"));
      const pageFeature = PAGE_FEATURES[path];
      const isDashboard = path === "/suitepim";
      const isEnabled = isDashboard
        ? dashboardEnabled(features)
        : !pageFeature || features.pages[pageFeature] !== false;
      link.hidden = !isEnabled;
      link.setAttribute("aria-hidden", String(!isEnabled));
    });
  }

  function setDashboardTabState(id, enabled) {
    const tab = document.getElementById(`${id}Tab`);
    const panel = document.getElementById(`${id}Panel`);
    if (tab) {
      tab.hidden = !enabled;
      tab.disabled = !enabled;
      tab.setAttribute("aria-hidden", String(!enabled));
    }
    if (panel) {
      panel.dataset.suitepimFeatureDisabled = enabled ? "0" : "1";
      if (!enabled) panel.hidden = true;
    }
  }

  function showDashboardDisabledMessage() {
    const existing = document.getElementById("suitepimDashboardDisabledMessage");
    if (existing) {
      existing.hidden = false;
      return;
    }

    const tabs = document.querySelector(".suitepim-dashboard-tabs");
    if (!tabs) return;

    const message = document.createElement("section");
    message.id = "suitepimDashboardDisabledMessage";
    message.className = "suitepim-dashboard-panel";
    message.innerHTML = `
      <div class="suitepim-empty-state">
        <h2>SuitePim dashboard is switched off</h2>
        <p>Enable Stock Management or Floor Plans in Admin to show dashboard content.</p>
      </div>
    `;
    tabs.insertAdjacentElement("afterend", message);
  }

  function applyDashboardFeatures(features) {
    const hasDashboardTabs = document.querySelector("[data-suitepim-dashboard-tab]");
    if (!hasDashboardTabs) return;

    setDashboardTabState("suitepimStockManagement", features.dashboard.stockManagement !== false);
    setDashboardTabState("suitepimFloorPlans", features.dashboard.floorPlans !== false);

    const enabledTabs = Array.from(document.querySelectorAll("[data-suitepim-dashboard-tab]"))
      .filter((tab) => !tab.hidden && !tab.disabled);
    const disabledMessage = document.getElementById("suitepimDashboardDisabledMessage");

    if (!enabledTabs.length) {
      document.querySelectorAll("[data-suitepim-dashboard-panel]").forEach((panel) => {
        panel.hidden = true;
      });
      showDashboardDisabledMessage();
      return;
    }

    if (disabledMessage) disabledMessage.hidden = true;

    const active = enabledTabs.find((tab) => tab.classList.contains("active"));
    const tabToActivate = active || enabledTabs[0];
    tabToActivate.click();
  }

  function redirectIfCurrentPageDisabled(features) {
    const currentPath = normalizePath(window.location.pathname);
    const pageFeature = PAGE_FEATURES[currentPath];
    if (pageFeature && features.pages[pageFeature] === false) {
      window.location.replace("/suitepim");
    }
  }

  function enabledPrefetchUrls(features) {
    return ALL_PAGE_URLS.filter((url) => {
      if (url === "/suitepim") return dashboardEnabled(features);
      const key = PAGE_FEATURES[url];
      return !key || features.pages[key] !== false;
    });
  }

  function prefetchDocument(url) {
    const existing = document.querySelector(`link[rel="prefetch"][href="${url}"]`);
    if (existing) return;

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = url;
    document.head.appendChild(link);
  }

  async function schedulePrefetch() {
    setupSuitePimSideNav();
    const features = await loadSuitePimFeatures();
    hideDisabledNavLinks(features);
    applyDashboardFeatures(features);
    redirectIfCurrentPageDisabled(features);

    const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
    const run = () => {
      enabledPrefetchUrls(features)
        .filter((url) => url !== currentPath)
        .forEach(prefetchDocument);
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      window.setTimeout(run, 1000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedulePrefetch, { once: true });
  } else {
    schedulePrefetch();
  }
})();
