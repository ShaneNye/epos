(function () {
  const PAGE_URLS = [
    "/suitepim",
    "/suitepim/product-data",
    "/suitepim/web-management",
    "/suitepim/product-validation",
  ];

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
