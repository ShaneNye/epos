// public/js/itemOptionsCache.js
(() => {
  const CACHE_KEY = "itemOptionsCache:v3";
  const LOCAL_EXCLUSIONS_KEY = "itemOptionsExcludedFieldNames:v1";
  const TTL_MS = 60 * 60 * 1000;

  let memoryCache = null;
  let inFlight = null;
  const itemInFlight = new Map();

  function now() {
    return Date.now();
  }

  const DEFAULT_EXCLUDED_FIELD_NAMES = [
    "adjustable bed size",
    "base option",
    "base options",
    "colour 2",
    "fabric type",
    "footend eight option",
    "footend height option",
    "mattress protector sizes",
    "size.v1",
    "windsor stained colour option",
  ];

  function normalizeExcludedFieldNames(fieldNames) {
    const seen = new Set();
    const names = [];

    (Array.isArray(fieldNames) ? fieldNames : DEFAULT_EXCLUDED_FIELD_NAMES).forEach((fieldName) => {
      const normalized = String(fieldName || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      names.push(normalized);
    });

    return names;
  }

  function isExcludedFieldName(fieldName, excludedFieldNames) {
    const normalized = String(fieldName || "").trim().toLowerCase();
    return normalizeExcludedFieldNames(excludedFieldNames).includes(normalized);
  }

  function sanitizeItemOptions(byItemId, excludedFieldNames) {
    const sanitized = {};

    Object.entries(byItemId || {}).forEach(([itemId, fields]) => {
      const nextFields = {};

      Object.entries(fields || {}).forEach(([fieldName, values]) => {
        if (isExcludedFieldName(fieldName, excludedFieldNames)) return;
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
    const excludedFieldNames = normalizeExcludedFieldNames(
      byItemId?.excludedFieldNames || existingCache?.excludedFieldNames
    );
    const merged = { ...existing, ...byItemId };
    delete merged.excludedFieldNames;

    const payload = {
      cachedAt: now(),
      byItemId: sanitizeItemOptions(merged, excludedFieldNames),
      excludedFieldNames,
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
    const excludedFieldNames = normalizeExcludedFieldNames(data.excludedFieldNames);
    const byItemId = itemId
      ? { [String(itemId)]: data.options || {} }
      : sanitizeItemOptions(data.byItemId || data.options || {}, excludedFieldNames);
    return writeLocalCache({ ...byItemId, excludedFieldNames }, { complete: !itemId }).byItemId;
  }

  function readLocalExcludedFieldNames() {
    try {
      const raw = localStorage.getItem(LOCAL_EXCLUSIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
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

  function getExcludedFieldNames() {
    const localNames = readLocalExcludedFieldNames();
    if (isFresh(memoryCache)) {
      return normalizeExcludedFieldNames([
        ...DEFAULT_EXCLUDED_FIELD_NAMES,
        ...localNames,
        ...(memoryCache.excludedFieldNames || []),
      ]);
    }

    const local = readLocalCache();
    if (isFresh(local)) {
      return normalizeExcludedFieldNames([
        ...DEFAULT_EXCLUDED_FIELD_NAMES,
        ...localNames,
        ...(local.excludedFieldNames || []),
      ]);
    }

    return normalizeExcludedFieldNames([...DEFAULT_EXCLUDED_FIELD_NAMES, ...localNames]);
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
    getExcludedFieldNames,
    clear,
    key: CACHE_KEY,
    ttlMs: TTL_MS,
  };

  // Pages preload the DB-backed option map, then fall back to per-item fetches.
})();
