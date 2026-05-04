// public/js/itemOptionsCache.js
(() => {
  const CACHE_KEY = "itemOptionsCache:v2";
  const TTL_MS = 60 * 60 * 1000;

  let memoryCache = null;
  let inFlight = null;
  const itemInFlight = new Map();

  function now() {
    return Date.now();
  }

  function isExcludedFieldName(fieldName) {
    const normalized = String(fieldName || "").trim().toLowerCase();
    return [
      "base option",
      "base options",
      "fabric type",
      "mattress protector sizes",
      "size.v1",
    ].includes(normalized);
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

  function writeLocalCache(byItemId, { complete = false } = {}) {
    const localCache = readLocalCache();
    const existingCache = isFresh(memoryCache) ? memoryCache : localCache;
    const existing = existingCache?.byItemId || {};
    const payload = {
      cachedAt: now(),
      byItemId: sanitizeItemOptions({ ...existing, ...byItemId }),
      complete: Boolean(complete || existingCache?.complete),
    };

    memoryCache = payload;

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("Failed to write item options cache:", err);
    }

    return payload;
  }

  async function fetchFresh(itemId = "") {
    const qs = itemId ? `?itemId=${encodeURIComponent(itemId)}` : "";
    const res = await fetch(`/api/item-options${qs}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const byItemId = itemId
      ? { [String(itemId)]: data.options || {} }
      : sanitizeItemOptions(data.byItemId || data.options || {});
    return writeLocalCache(byItemId, { complete: !itemId }).byItemId;
  }

  async function getAll({ forceRefresh = false } = {}) {
    if (!forceRefresh) {
      if (isFresh(memoryCache) && memoryCache.complete) return memoryCache.byItemId;

      const local = readLocalCache();
      if (isFresh(local) && local.complete) {
        memoryCache = local;
        return local.byItemId;
      }
    }

    if (inFlight) return inFlight;

    inFlight = fetchFresh("")
      .catch((err) => {
        console.warn("Failed to fetch item options cache:", err);
        return {};
      })
      .finally(() => {
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

    if (itemInFlight.has(id)) return itemInFlight.get(id);

    const pending = fetchFresh(id)
      .then((fresh) => fresh[id] || {})
      .finally(() => itemInFlight.delete(id));

    itemInFlight.set(id, pending);
    return pending;
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

  // Pages preload the DB-backed option map, then fall back to per-item fetches.
})();
