(function () {
  const state = {
    loaded: false,
    defaults: [],
  };
  const LOCAL_EXCLUSIONS_KEY = "itemOptionsExcludedFieldNames:v1";

  function byId(id) {
    return document.getElementById(id);
  }

  function authHeaders(extra = {}) {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return {
      ...extra,
      ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
    };
  }

  function normalizeNames(value) {
    const lines = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
    const seen = new Set();
    const names = [];

    lines.forEach((line) => {
      const name = String(line || "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });

    return names;
  }

  function setStatus(message, tone = "") {
    const el = byId("adminItemOptionSettingsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.dataset.tone = tone;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const hint = response.status === 404
        ? "Item option settings API is not available yet. Restart the Node server to load the new route."
        : text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      throw new Error(hint || `Request failed: ${response.status}`);
    }

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed: ${response.status}`);
    }

    return data;
  }

  function applySettings(data = {}) {
    const textarea = byId("adminItemOptionExclusions");
    const names = normalizeNames(data.excludedFieldNames || []);
    state.defaults = normalizeNames(data.defaultExcludedFieldNames || []);
    if (textarea) textarea.value = names.join("\n");
    try {
      localStorage.setItem(LOCAL_EXCLUSIONS_KEY, JSON.stringify(names));
    } catch {}
  }

  async function loadSettings(force = false) {
    if (state.loaded && !force) return;
    setStatus("Loading...");

    try {
      const data = await fetchJson("/api/item-options/settings", {
        headers: authHeaders(),
      });
      applySettings(data);
      state.loaded = true;
      setStatus("Loaded", "success");
    } catch (err) {
      console.error("Failed to load item option settings:", err);
      setStatus(err.message || "Failed to load settings", "error");
    }
  }

  async function saveSettings(names) {
    const button = byId("adminSaveItemOptionSettings");

    try {
      if (button) button.disabled = true;
      setStatus("Saving...");
      const data = await fetchJson("/api/item-options/settings", {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ excludedFieldNames: normalizeNames(names) }),
      });
      applySettings(data);
      window.itemOptionsCache?.clear?.();
      setStatus("Saved", "success");
    } catch (err) {
      console.error("Failed to save item option settings:", err);
      setStatus(err.message || "Failed to save settings", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function syncItemOptions() {
    const button = byId("adminSyncItemOptions");

    try {
      if (button) button.disabled = true;
      setStatus("Syncing item options...");
      const data = await fetchJson("/api/item-options/sync", {
        method: "POST",
        headers: authHeaders(),
      });
      window.itemOptionsCache?.clear?.();
      setStatus(`Sync complete (${data.synced || 0} records)`, "success");
    } catch (err) {
      console.error("Failed to sync item options:", err);
      setStatus(err.message || "Failed to sync item options", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("adminSaveItemOptionSettings")?.addEventListener("click", () => {
      saveSettings(byId("adminItemOptionExclusions")?.value || "");
    });

    byId("adminResetItemOptionSettings")?.addEventListener("click", () => {
      saveSettings(state.defaults);
    });

    byId("adminSyncItemOptions")?.addEventListener("click", syncItemOptions);

    window.addEventListener("tab:show", (event) => {
      if (event.detail?.id === "item-options") loadSettings();
    });

    if (!document.getElementById("item-options")?.classList.contains("hidden")) {
      loadSettings();
    }
  });
})();
