(function () {
  const NAV_COLLAPSED_KEY = "suitepimNavCollapsed";
  const PAGE_URLS = [
    "/suitepim",
    "/suitepim/web-management",
    "/suitepim/scheduled-exports",
    "/suitepim/product-validation",
    "/suitepim/reasons-to-buy",
    "/suitepim/item-faqs",
    "/suitepim/settings",
  ];

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

  function prefetchDocument(url) {
    const existing = document.querySelector(`link[rel="prefetch"][href="${url}"]`);
    if (existing) return;

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = url;
    document.head.appendChild(link);
  }

  function schedulePrefetch() {
    setupSuitePimSideNav();

    const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
    const run = () => {
      PAGE_URLS
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
