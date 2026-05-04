// public/js/storage.js
function storageSet(remember, data) {
  const key = 'eposAuth';
  const raw = JSON.stringify({ ...data, savedAt: new Date().toISOString() });
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);

  if (remember) localStorage.setItem(key, raw);
  else sessionStorage.setItem(key, raw);
}

function storageGet() {
  const key = 'eposAuth';
  const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function storageClear() {
  const key = 'eposAuth';
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

(function installAuthenticatedFetch() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.__eposAuthenticatedFetchInstalled) return;

  const nativeFetch = window.fetch.bind(window);
  window.__eposAuthenticatedFetchInstalled = true;

  window.fetch = function eposAuthenticatedFetch(input, init = {}) {
    try {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input?.url || "";

      const url = new URL(rawUrl, window.location.origin);
      const isSameOriginApi =
        url.origin === window.location.origin && url.pathname.startsWith("/api/");

      if (!isSameOriginApi) {
        return nativeFetch(input, init);
      }

      const saved = storageGet();
      const token = saved?.token;
      if (!token) {
        return nativeFetch(input, init);
      }

      const headers = new Headers(init.headers || {});
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      return nativeFetch(input, { ...init, headers });
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
