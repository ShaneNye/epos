// public/assistant/assistantHooks.js
// Enables multiple assistant modules to register their own menu buttons safely.
window.AssistantExtensions = window.AssistantExtensions || [];

export function registerAssistantFeature(label, callback) {
  window.AssistantExtensions.push({ label, callback });
}

function renderAssistantMenu(chatBody) {
  if (!chatBody) return;

  chatBody.innerHTML = "";
  const pageTitle = document.getElementById("assistantLocation")?.textContent || "";
  const intro = document.createElement("div");
  intro.className = "assistant-message bot";
  intro.textContent = `I can help with various tasks ${pageTitle ? `(${pageTitle})` : ""}`;
  chatBody.appendChild(intro);

  if (window.AssistantExtensions.length) {
    window.AssistantExtensions.forEach((feature) => {
      const btn = document.createElement("button");
      btn.textContent = feature.label;
      btn.className = "assistant-btn";
      btn.onclick = () => feature.callback(chatBody);
      chatBody.appendChild(btn);
    });
    return;
  }

  const msg = document.createElement("div");
  msg.className = "assistant-message bot";
  msg.textContent = "No assistant features are available right now.";
  chatBody.appendChild(msg);
}

window.renderAssistantMenu = renderAssistantMenu;

import("/assistant/systemsProcesses.js").catch((error) => {
  console.warn("Systems & Processes assistant feature unavailable:", error);
});

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
});
