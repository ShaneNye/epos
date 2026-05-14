(function () {
  const state = {
    loaded: false,
    users: [],
    selectedIds: new Set(),
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
    const el = byId("adminEmailAlertsStatus");
    if (!el) return;
    el.textContent = message || "";
    el.dataset.tone = tone;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || `Request failed: ${response.status}`);
    }
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  function userName(user) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || `User ${user.id}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderUsers() {
    const root = byId("adminEmailAlertsUsers");
    if (!root) return;

    if (!state.users.length) {
      root.innerHTML = `<div class="admin-empty-state">No users found.</div>`;
      return;
    }

    root.innerHTML = state.users
      .map((user) => {
        const checked = state.selectedIds.has(Number(user.id)) ? "checked" : "";
        return `
          <label class="admin-email-alert-user">
            <input type="checkbox" value="${user.id}" ${checked}>
            <span>
              <strong>${escapeHtml(userName(user))}</strong>
              <small>${escapeHtml(user.email || "")}</small>
            </span>
          </label>
        `;
      })
      .join("");

    root.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener("change", () => {
        const id = Number(input.value);
        if (input.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
      });
    });
  }

  async function loadSettings(force = false) {
    if (state.loaded && !force) return;
    setStatus("Loading...");
    try {
      const [usersData, settingsData] = await Promise.all([
        fetchJson("/api/users", { headers: authHeaders() }),
        fetchJson("/api/email-alerts/settings", { headers: authHeaders() }),
      ]);
      state.users = (usersData.users || []).filter((user) => user.email);
      state.selectedIds = new Set((settingsData.recipientUserIds || []).map((id) => Number(id)));
      state.loaded = true;
      renderUsers();
      setStatus("Loaded", "success");
    } catch (err) {
      console.error("Failed to load email alert settings:", err);
      setStatus(err.message || "Failed to load email alert settings", "error");
    }
  }

  async function saveSettings() {
    const button = byId("adminSaveEmailAlerts");
    try {
      if (button) button.disabled = true;
      setStatus("Saving...");
      const data = await fetchJson("/api/email-alerts/settings", {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ recipientUserIds: Array.from(state.selectedIds) }),
      });
      state.selectedIds = new Set((data.recipientUserIds || []).map((id) => Number(id)));
      renderUsers();
      setStatus("Saved", "success");
    } catch (err) {
      console.error("Failed to save email alert settings:", err);
      setStatus(err.message || "Failed to save email alert settings", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("adminSaveEmailAlerts")?.addEventListener("click", saveSettings);

    window.addEventListener("tab:show", (event) => {
      if (event.detail?.id === "email-alerts") loadSettings();
    });

    if (!byId("email-alerts")?.classList.contains("hidden")) {
      loadSettings();
    }
  });
})();
