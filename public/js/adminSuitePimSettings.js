(function () {
  const state = {
    loaded: false,
  };

  const FIELD_MAP = {
    dashboard: {
      stockManagement: "adminSuitePimStockManagementEnabled",
      floorPlans: "adminSuitePimFloorPlansEnabled",
    },
    pages: {
      itemManagement: "adminSuitePimItemManagementEnabled",
      scheduledExports: "adminSuitePimScheduledExportsEnabled",
      campaigns: "adminSuitePimCampaignsEnabled",
      productValidation: "adminSuitePimProductValidationEnabled",
      reasonsToBuy: "adminSuitePimReasonsToBuyEnabled",
      itemFaqs: "adminSuitePimItemFaqsEnabled",
      settings: "adminSuitePimSettingsEnabled",
    },
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
    const el = byId("adminSuitePimSettingsStatus");
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
        ? "SuitePim settings API is not available yet. Restart the Node server to load the new route."
        : text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      throw new Error(hint || `Request failed: ${response.status}`);
    }

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed: ${response.status}`);
    }

    return data;
  }

  function applySettings(features = {}) {
    Object.entries(FIELD_MAP).forEach(([group, fields]) => {
      const values = features[group] || {};
      Object.entries(fields).forEach(([key, id]) => {
        const input = byId(id);
        if (input) input.checked = values[key] !== false;
      });
    });
  }

  function collectSettings() {
    const features = {};
    Object.entries(FIELD_MAP).forEach(([group, fields]) => {
      features[group] = {};
      Object.entries(fields).forEach(([key, id]) => {
        features[group][key] = !!byId(id)?.checked;
      });
    });
    return features;
  }

  async function loadSettings(force = false) {
    if (state.loaded && !force) return;
    setStatus("Loading...");

    try {
      const data = await fetchJson("/api/suitepim/features", {
        headers: authHeaders(),
      });
      applySettings(data.features || {});
      state.loaded = true;
      setStatus("Loaded", "success");
    } catch (err) {
      console.error("Failed to load SuitePim settings:", err);
      setStatus(err.message || "Failed to load settings", "error");
    }
  }

  async function saveSettings() {
    const button = byId("adminSaveSuitePimSettings");

    try {
      if (button) button.disabled = true;
      setStatus("Saving...");
      const data = await fetchJson("/api/suitepim/features", {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ features: collectSettings() }),
      });
      applySettings(data.features || {});
      setStatus("Saved", "success");
    } catch (err) {
      console.error("Failed to save SuitePim settings:", err);
      setStatus(err.message || "Failed to save settings", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("adminSaveSuitePimSettings")?.addEventListener("click", saveSettings);

    window.addEventListener("tab:show", (event) => {
      if (event.detail?.id === "suitepim-features") loadSettings();
    });

    if (!document.getElementById("suitepim-features")?.classList.contains("hidden")) {
      loadSettings();
    }
  });
})();
