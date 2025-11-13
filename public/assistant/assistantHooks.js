// public/assistant/assistantHooks.js
// Enables multiple assistant modules to register their own menu buttons safely.
window.AssistantExtensions = window.AssistantExtensions || [];

export function registerAssistantFeature(label, callback) {
  window.AssistantExtensions.push({ label, callback });
}

// When the assistant opens, render all registered feature buttons.
document.addEventListener("assistantReady", () => {
  const toggle = document.getElementById("assistantToggle");
  const body = document.getElementById("assistantBody");

  if (!toggle || !body) return;

  toggle.addEventListener("click", () => {
    setTimeout(() => {
      renderAssistantMenu(body);
    }, 300);
  });

  function renderAssistantMenu(chatBody) {
    chatBody.innerHTML = "";
    const pageTitle = document.getElementById("assistantLocation")?.textContent || "";
    const intro = document.createElement("div");
    intro.className = "assistant-message bot";
    intro.textContent = `I can help with various tasks ${pageTitle ? `(${pageTitle})` : ""}`;
    chatBody.appendChild(intro);

    // Build buttons from all registered features
    window.AssistantExtensions.forEach((feature) => {
      const btn = document.createElement("button");
      btn.textContent = feature.label;
      btn.className = "assistant-btn";
      btn.onclick = () => feature.callback(chatBody);
      chatBody.appendChild(btn);
    });
  }
});
