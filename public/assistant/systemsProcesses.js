import { registerAssistantFeature } from "/assistant/assistantHooks.js";

const PAGE_ALIASES = new Map([
  ["end-of-day", "eod"],
  ["endofday", "eod"],
  ["cash-flow", "cashflow"],
]);

function storageToken() {
  const saved = typeof storageGet === "function" ? storageGet() : null;
  return saved?.token || "";
}

function normalizePage(pathname = window.location.pathname) {
  let slug = String(pathname || "")
    .replace(/^\//, "")
    .replace(/\.html$/i, "")
    .trim()
    .toLowerCase();

  if (slug.startsWith("sales/view/")) slug = "sales/view";
  if (slug.startsWith("quote/view/")) slug = "quote/view";
  if (slug === "suitepim" || slug.startsWith("suitepim/")) slug = "suitepim";

  return PAGE_ALIASES.get(slug) || slug || "home";
}

async function fetchProcessesForCurrentPage() {
  const token = storageToken();
  if (!token) return [];

  const page = normalizePage();
  const response = await fetch(`/api/systems-processes?page=${encodeURIComponent(page)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Failed to load systems and processes.");
  }
  return payload.processes || [];
}

function addMessage(text, sender, chatBody) {
  const div = document.createElement("div");
  div.className = `assistant-message ${sender}`;
  div.textContent = text;
  chatBody.appendChild(div);
  chatBody.scrollTop = chatBody.scrollHeight;
  return div;
}

function clearChat(chatBody) {
  chatBody.innerHTML = "";
}

function openProcessWindow(process) {
  const key = `systemsProcess:${process.id}:${Date.now()}`;
  localStorage.setItem(key, JSON.stringify(process));

  const width = Math.min(1120, Math.max(860, Math.round(window.screen.availWidth * 0.62)));
  const height = Math.min(820, Math.max(620, Math.round(window.screen.availHeight * 0.78)));
  const left = Math.max(20, Math.round((window.screen.availWidth - width) / 2));
  const top = Math.max(20, Math.round((window.screen.availHeight - height) / 2));

  const popup = window.open(
    `/systems-process-viewer.html?key=${encodeURIComponent(key)}`,
    `systemsProcess${process.id}`,
    [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "resizable=yes",
      "scrollbars=yes",
      "menubar=no",
      "toolbar=no",
      "location=no",
      "status=no",
    ].join(",")
  );

  if (!popup) {
    alert("Please allow pop-ups to open Systems & Processes guides.");
    localStorage.removeItem(key);
    return;
  }

  popup.focus();
}

async function startSystemsProcessesFlow(chatBody) {
  clearChat(chatBody);
  addMessage("Loading systems and processes for this page...", "bot", chatBody);

  try {
    const processes = await fetchProcessesForCurrentPage();
    clearChat(chatBody);

    if (!processes.length) {
      addMessage("There are no systems or processes documented for this page yet.", "bot", chatBody);
      return;
    }

    addMessage("Choose a systems and processes record to open:", "bot", chatBody);
    processes.forEach((process) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "assistant-btn";
      button.textContent = process.title;
      button.addEventListener("click", () => openProcessWindow(process));
      chatBody.appendChild(button);
    });
  } catch (error) {
    console.error("Systems & Processes assistant error:", error);
    clearChat(chatBody);
    addMessage(error.message || "I couldn't load systems and processes for this page.", "bot", chatBody);
  }
}

async function initSystemsProcessesAssistant() {
  if (!storageToken()) return;

  try {
    const processes = await fetchProcessesForCurrentPage();
    if (!processes.length) return;

    registerAssistantFeature("Systems & Processes", (chatBody) => {
      startSystemsProcessesFlow(chatBody);
    });
  } catch (error) {
    console.warn("Systems & Processes assistant feature hidden:", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSystemsProcessesAssistant);
} else {
  initSystemsProcessesAssistant();
}
