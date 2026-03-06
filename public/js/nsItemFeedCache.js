// public/js/nsItemFeedCache.js
(() => {
  const CACHE_KEY = "nsItemFeedCache:v1";
  const TTL_MS = 60 * 60 * 1000; // 1 hour

  let memoryCache = null;
  let inFlightPromise = null;

  function now() {
    return Date.now();
  }

  function readLocalCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        !Array.isArray(parsed.items) ||
        !parsed.cachedAt ||
        now() - parsed.cachedAt > TTL_MS
      ) {
        return null;
      }

      return parsed;
    } catch (err) {
      console.warn("⚠️ Failed to parse local item cache:", err);
      return null;
    }
  }

  function writeLocalCache(items) {
    const payload = {
      cachedAt: now(),
      items: Array.isArray(items) ? items : [],
    };

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("⚠️ Failed to write local item cache:", err);
    }

    memoryCache = payload;
    return payload;
  }

  function isFresh(cache) {
    return !!(
      cache &&
      Array.isArray(cache.items) &&
      cache.cachedAt &&
      now() - cache.cachedAt <= TTL_MS
    );
  }

  async function fetchFreshItems() {
    const res = await fetch("/api/netsuite/items", {
      credentials: "same-origin",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = data.results || data.data || [];

    writeLocalCache(items);
    return items;
  }

  async function getItems(options = {}) {
    const { forceRefresh = false } = options;

    if (!forceRefresh) {
      if (isFresh(memoryCache)) {
        window.items = memoryCache.items;
        return memoryCache.items;
      }

      const local = readLocalCache();
      if (isFresh(local)) {
        memoryCache = local;
        window.items = local.items;
        console.log("✅ Item feed loaded from localStorage cache:", local.items.length);
        return local.items;
      }
    }

    if (inFlightPromise) {
      const items = await inFlightPromise;
      window.items = items;
      return items;
    }

    inFlightPromise = (async () => {
      try {
        console.log("📡 Fetching fresh NetSuite item feed...");
        const items = await fetchFreshItems();
        console.log("✅ Fresh item feed cached:", items.length);
        return items;
      } finally {
        inFlightPromise = null;
      }
    })();

    const items = await inFlightPromise;
    window.items = items;
    return items;
  }

  function getCachedItemsSync() {
    if (isFresh(memoryCache)) return memoryCache.items;

    const local = readLocalCache();
    if (isFresh(local)) {
      memoryCache = local;
      return local.items;
    }

    return [];
  }

  function clearItemsCache() {
    memoryCache = null;
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (err) {
      console.warn("⚠️ Failed to clear item cache:", err);
    }
  }

  window.nsItemFeedCache = {
    getItems,
    getCachedItemsSync,
    clearItemsCache,
    ttlMs: TTL_MS,
    key: CACHE_KEY,
  };
})();