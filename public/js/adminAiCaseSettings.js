document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("adminAiCaseSummaryEnabled");
  const status = document.getElementById("adminAiCaseSettingsStatus");
  if (!input) return;

  function authHeaders(extra = {}) {
    const token = storageGet?.()?.token || "";
    return {
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  function setStatus(message, tone = "") {
    if (!status) return;
    status.textContent = message || "";
    status.style.color = tone === "error" ? "#c0392b" : tone === "success" ? "#18794e" : "";
  }

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {}),
      },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  async function loadSettings() {
    setStatus("Loading...");
    const data = await request("/api/ai-manager/cases/settings");
    input.checked = data.settings?.caseSummaryEnabled === true;
    setStatus("");
  }

  async function saveSettings() {
    input.disabled = true;
    setStatus("Saving...");
    try {
      await request("/api/ai-manager/cases/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            caseSummaryEnabled: input.checked,
          },
        }),
      });
      setStatus("Saved", "success");
    } catch (err) {
      console.error("Failed to save AI case settings:", err);
      input.checked = !input.checked;
      setStatus(err.message || "Failed to save", "error");
    } finally {
      input.disabled = false;
    }
  }

  input.addEventListener("change", saveSettings);

  loadSettings().catch((err) => {
    console.error("Failed to load AI case settings:", err);
    setStatus(err.message || "Failed to load", "error");
  });
});
