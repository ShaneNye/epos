document.addEventListener("DOMContentLoaded", () => {
  const panels = Array.from(document.querySelectorAll(".ai-prompt-panel[data-prompt-scope]"));
  if (!panels.length) return;

  const state = {
    prompts: {},
    defaults: {},
    loaded: false,
  };

  function authHeaders() {
    const token = storageGet?.()?.token || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/suitepim${path}`, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || "AI prompt request failed");
    }
    return payload;
  }

  function setStatus(panel, message, tone = "muted") {
    const status = panel.querySelector(".ai-prompt-status");
    if (!status) return;
    status.textContent = message || "";
    status.style.color = tone === "error" ? "#c0392b" : tone === "success" ? "#18794e" : "";
  }

  function collectElements(panel) {
    return Array.from(panel.querySelectorAll("textarea"))
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  function addRow(panel, value = "") {
    const body = panel.querySelector("tbody");
    if (!body) return;

    const row = document.createElement("tr");
    const promptCell = document.createElement("td");
    const actionCell = document.createElement("td");
    const textarea = document.createElement("textarea");
    const removeButton = document.createElement("button");

    actionCell.className = "actions";
    textarea.value = value;
    textarea.placeholder = "Add a prompt instruction...";
    removeButton.type = "button";
    removeButton.className = "action-btn action-delete";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      row.remove();
      if (!body.querySelector("tr")) addRow(panel);
      setStatus(panel, "Unsaved changes");
    });
    textarea.addEventListener("input", () => setStatus(panel, "Unsaved changes"));

    promptCell.appendChild(textarea);
    actionCell.appendChild(removeButton);
    row.append(promptCell, actionCell);
    body.appendChild(row);
  }

  function renderPanel(panel, elements = []) {
    const body = panel.querySelector("tbody");
    if (!body) return;
    body.innerHTML = "";
    const rows = elements.length ? elements : [""];
    rows.forEach((value) => addRow(panel, value));
  }

  async function savePanel(panel, elements) {
    const scope = panel.dataset.promptScope;
    const cleaned = elements || collectElements(panel);
    if (!cleaned.length) {
      setStatus(panel, "Add at least one prompt element before saving.", "error");
      return;
    }

    setStatus(panel, "Saving...");
    const payload = await api(`/ai-prompts/product-descriptions/${encodeURIComponent(scope)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: cleaned }),
    });
    state.prompts[scope] = payload.elements || cleaned;
    renderPanel(panel, state.prompts[scope]);
    setStatus(panel, "Saved", "success");
  }

  async function loadPrompts() {
    const payload = await api("/ai-prompts/product-descriptions");
    state.prompts = payload.prompts || {};
    state.defaults = payload.defaults || {};
    panels.forEach((panel) => {
      const scope = panel.dataset.promptScope;
      renderPanel(panel, state.prompts[scope] || []);
      setStatus(panel, "");
    });
    state.loaded = true;
  }

  panels.forEach((panel) => {
    panel.querySelector(".ai-prompt-add")?.addEventListener("click", () => {
      addRow(panel);
      setStatus(panel, "Unsaved changes");
    });

    panel.querySelector(".ai-prompt-save")?.addEventListener("click", async () => {
      try {
        await savePanel(panel);
      } catch (error) {
        console.error("Failed to save AI prompt:", error);
        setStatus(panel, error.message || "Failed to save prompt.", "error");
      }
    });

    panel.querySelector(".ai-prompt-reset")?.addEventListener("click", async () => {
      try {
        const defaults = state.defaults[panel.dataset.promptScope] || [];
        renderPanel(panel, defaults);
        await savePanel(panel, defaults);
      } catch (error) {
        console.error("Failed to reset AI prompt:", error);
        setStatus(panel, error.message || "Failed to reset prompt.", "error");
      }
    });
  });

  window.addEventListener("tab:show", (event) => {
    if (event.detail?.id === "ai-manager" && !state.loaded) {
      loadPrompts().catch((error) => {
        console.error("Failed to load AI prompts:", error);
        panels.forEach((panel) => setStatus(panel, error.message || "Failed to load prompts.", "error"));
      });
    }
  });

  if (!document.getElementById("ai-manager")?.classList.contains("hidden")) {
    loadPrompts().catch((error) => {
      console.error("Failed to load AI prompts:", error);
      panels.forEach((panel) => setStatus(panel, error.message || "Failed to load prompts.", "error"));
    });
  }
});
