(function () {
  const state = {
    loaded: false,
  };

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

  function setStatus(message, tone = "") {
    const el = byId("adminReleaseSettingsStatus");
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
        ? "Release settings API is not available yet. Restart the Node server to load the new route."
        : text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      throw new Error(hint || `Request failed: ${response.status}`);
    }

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed: ${response.status}`);
    }

    return data;
  }

  function applySettings(data = {}) {
    const input = byId("adminCustomerServiceReleaseEnabled");
    if (input) input.checked = data.settings?.customerServiceEnabled !== false;

    const environment = data.environment === "production" ? "Production" : "Sandbox";
    setStatus(`Loaded (${environment})`, "success");
  }

  async function loadSettings(force = false) {
    if (state.loaded && !force) return;
    setStatus("Loading...");

    try {
      const data = await fetchJson("/api/releases/settings", {
        headers: authHeaders(),
      });
      applySettings(data);
      state.loaded = true;
    } catch (err) {
      console.error("Failed to load release settings:", err);
      setStatus(err.message || "Failed to load settings", "error");
    }
  }

  async function saveSettings() {
    const button = byId("adminSaveReleaseSettings");
    const payload = {
      settings: {
        customerServiceEnabled: !!byId("adminCustomerServiceReleaseEnabled")?.checked,
      },
    };

    try {
      if (button) button.disabled = true;
      setStatus("Saving...");
      const data = await fetchJson("/api/releases/settings", {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      applySettings(data);
      setStatus("Saved", "success");
    } catch (err) {
      console.error("Failed to save release settings:", err);
      setStatus(err.message || "Failed to save settings", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("adminSaveReleaseSettings")?.addEventListener("click", saveSettings);

    window.addEventListener("tab:show", (event) => {
      if (event.detail?.id === "releases") loadSettings();
    });

    if (!document.getElementById("releases")?.classList.contains("hidden")) {
      loadSettings();
    }
  });
})();
