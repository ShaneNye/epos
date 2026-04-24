// public/js/itemOptionsCache.js
(() => {
  const CACHE_KEY = "itemOptionsCache:v2";
  const TTL_MS = 60 * 60 * 1000;

  let memoryCache = null;
  let inFlight = null;

  function now() {
    return Date.now();
  }

  function isExcludedFieldName(fieldName) {
    const normalized = String(fieldName || "").trim().toLowerCase();
    return normalized === "size.v1";
  }

  function sanitizeItemOptions(byItemId) {
    const sanitized = {};

    Object.entries(byItemId || {}).forEach(([itemId, fields]) => {
      const nextFields = {};

      Object.entries(fields || {}).forEach(([fieldName, values]) => {
        if (isExcludedFieldName(fieldName)) return;
        nextFields[fieldName] = values;
      });

      sanitized[itemId] = nextFields;
    });

    return sanitized;
  }

  function isFresh(cache) {
    return !!(
      cache &&
      cache.cachedAt &&
      cache.byItemId &&
      now() - cache.cachedAt <= TTL_MS
    );
  }

  function readLocalCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn("Failed to read item options cache:", err);
      return null;
    }
  }

  function writeLocalCache(byItemId) {
    const payload = {
      cachedAt: now(),
      byItemId: sanitizeItemOptions(byItemId),
    };

    memoryCache = payload;

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("Failed to write item options cache:", err);
    }

    return payload;
  }

  async function fetchFresh() {
    const res = await fetch("/api/item-options", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const byItemId = sanitizeItemOptions(data.byItemId || data.options || {});
    writeLocalCache(byItemId);
    return byItemId;
  }

  async function getAll({ forceRefresh = false } = {}) {
    if (!forceRefresh) {
      if (isFresh(memoryCache)) return memoryCache.byItemId;

      const local = readLocalCache();
      if (isFresh(local)) {
        memoryCache = local;
        return local.byItemId;
      }
    }

    if (inFlight) return inFlight;

    inFlight = fetchFresh().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  function getOptionsForItemSync(itemId) {
    const id = String(itemId || "").trim();
    if (!id) return {};

    if (isFresh(memoryCache)) return memoryCache.byItemId[id] || {};

    const local = readLocalCache();
    if (isFresh(local)) {
      memoryCache = local;
      return local.byItemId[id] || {};
    }

    return {};
  }

  async function getOptionsForItem(itemId) {
    const id = String(itemId || "").trim();
    if (!id) return {};

    const cached = getOptionsForItemSync(id);
    if (Object.keys(cached).length) return cached;

    const all = await getAll();
    return all[id] || {};
  }

  function clear() {
    memoryCache = null;
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (err) {
      console.warn("Failed to clear item options cache:", err);
    }
  }

  window.itemOptionsCache = {
    getAll,
    getOptionsForItem,
    getOptionsForItemSync,
    clear,
    key: CACHE_KEY,
    ttlMs: TTL_MS,
  };

  const warmup = () => {
    getAll().catch((err) => {
      console.warn("Item options cache warmup failed:", err.message);
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(warmup, { timeout: 5000 });
  } else {
    setTimeout(warmup, 2500);
  }
})();
