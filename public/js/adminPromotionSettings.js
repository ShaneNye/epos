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
    const el = byId("adminPromotionSettingsStatus");
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
        ? "Promotion settings API is not available yet. Restart the Node server to load the new route."
        : text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      throw new Error(hint || `Request failed: ${response.status}`);
    }
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  function applySettings(settings = {}) {
    const production = settings.production || {};
    const sandbox = settings.sandbox || {};
    const fields = [
      ["adminProductionUpsellsEnabled", production.upsellsEnabled],
      ["adminProductionBasketDiscountsEnabled", production.basketDiscountsEnabled],
      ["adminProductionFinanceCalculatorEnabled", production.financeCalculatorEnabled],
      ["adminSandboxUpsellsEnabled", sandbox.upsellsEnabled],
      ["adminSandboxBasketDiscountsEnabled", sandbox.basketDiscountsEnabled],
      ["adminSandboxFinanceCalculatorEnabled", sandbox.financeCalculatorEnabled],
    ];

    fields.forEach(([id, value]) => {
      const input = byId(id);
      if (input) input.checked = value !== false;
    });
  }

  function hasEnvironmentSettings(settings = {}) {
    return !!(settings.production && settings.sandbox);
  }

  function settingsMatch(expected = {}, actual = {}) {
    return ["production", "sandbox"].every((environment) => {
      const wanted = expected[environment] || {};
      const received = actual[environment] || {};
      return received.upsellsEnabled === wanted.upsellsEnabled
        && received.basketDiscountsEnabled === wanted.basketDiscountsEnabled
        && received.financeCalculatorEnabled === wanted.financeCalculatorEnabled;
    });
  }

  async function loadSettings(force = false) {
    if (state.loaded && !force) return;
    setStatus("Loading...");
    try {
      const data = await fetchJson("/api/promotions/settings", {
        headers: authHeaders(),
      });
      if (!hasEnvironmentSettings(data.settings || {})) {
        throw new Error("Promotion settings API is running an older version. Restart the Node server to load the Production/Sandbox settings.");
      }
      applySettings(data.settings || {});
      state.loaded = true;
      setStatus("Loaded", "success");
    } catch (err) {
      console.error("Failed to load promotion settings:", err);
      setStatus(err.message || "Failed to load settings", "error");
    }
  }

  async function saveSettings() {
    const button = byId("adminSavePromotionSettings");
    const payload = {
      settings: {
        production: {
          upsellsEnabled: !!byId("adminProductionUpsellsEnabled")?.checked,
          basketDiscountsEnabled: !!byId("adminProductionBasketDiscountsEnabled")?.checked,
          financeCalculatorEnabled: !!byId("adminProductionFinanceCalculatorEnabled")?.checked,
        },
        sandbox: {
          upsellsEnabled: !!byId("adminSandboxUpsellsEnabled")?.checked,
          basketDiscountsEnabled: !!byId("adminSandboxBasketDiscountsEnabled")?.checked,
          financeCalculatorEnabled: !!byId("adminSandboxFinanceCalculatorEnabled")?.checked,
        },
      },
    };

    try {
      if (button) button.disabled = true;
      setStatus("Saving...");
      const data = await fetchJson("/api/promotions/settings", {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      if (!hasEnvironmentSettings(data.settings || {})) {
        throw new Error("Promotion settings API is running an older version. Restart the Node server, then save again.");
      }
      if (!settingsMatch(payload.settings, data.settings)) {
        throw new Error("Promotion settings did not persist. Restart the Node server, then save again.");
      }
      applySettings(data.settings);
      setStatus("Saved", "success");
    } catch (err) {
      console.error("Failed to save promotion settings:", err);
      setStatus(err.message || "Failed to save settings", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("adminSavePromotionSettings")?.addEventListener("click", saveSettings);

    window.addEventListener("tab:show", (event) => {
      if (event.detail?.id === "sales-features") loadSettings();
    });

    if (!document.getElementById("sales-features")?.classList.contains("hidden")) {
      loadSettings();
    }
  });
})();
