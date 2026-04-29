// public/assistant/assistant.js
console.log("assistant.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (!window.loadJiraWidgetOnce) {
      let jiraLoadingPromise = null;

      window.loadJiraWidgetOnce = function loadJiraWidgetOnce() {
        if (document.querySelector("iframe#jsd-widget")) {
          return Promise.resolve(true);
        }

        if (jiraLoadingPromise) return jiraLoadingPromise;

        jiraLoadingPromise = new Promise((resolve, reject) => {
          const existing = document.querySelector(
            'script[src*="jsd-widget.atlassian.com/assets/embed.js"]'
          );

          if (existing) {
            document.dispatchEvent(new Event("DOMContentLoaded"));
            return waitForIframe(resolve, reject);
          }

          const script = document.createElement("script");
          script.src = "https://jsd-widget.atlassian.com/assets/embed.js";
          script.async = true;
          script.setAttribute("data-jsd-embedded", "");
          script.setAttribute("data-key", "715c9200-cafe-43ac-9ab7-882e97092b35");
          script.setAttribute("data-base-url", "https://jsd-widget.atlassian.com");

          script.onload = () => {
            document.dispatchEvent(new Event("DOMContentLoaded"));
            waitForIframe(resolve, reject);
          };

          script.onerror = () => {
            jiraLoadingPromise = null;
            reject(new Error("Failed to load Jira embed.js"));
          };

          document.body.appendChild(script);
        });

        return jiraLoadingPromise;
      };

      function waitForIframe(resolve, reject) {
        const start = Date.now();
        const timeoutMs = 15000;

        const tick = () => {
          if (document.querySelector("iframe#jsd-widget")) {
            return resolve(true);
          }

          if (Date.now() - start > timeoutMs) {
            jiraLoadingPromise = null;
            return reject(new Error("Jira widget iframe did not inject"));
          }

          setTimeout(tick, 150);
        };

        tick();
      }
    }

    const resp = await fetch("/assistant/assistant.html");
    if (!resp.ok) {
      throw new Error(`assistant.html fetch failed -> ${resp.status}`);
    }

    const html = await resp.text();
    document.body.insertAdjacentHTML("beforeend", html);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const widget = document.getElementById("salesAssistant");
    const toggle = document.getElementById("assistantToggle");
    const close = document.getElementById("closeAssistant");
    const reset = document.getElementById("resetAssistant");
    const header = document.getElementById("assistantHeader");
    const locationDiv = document.getElementById("assistantLocation");
    const form = document.getElementById("assistantForm");
    const input = document.getElementById("assistantInput");
    const body = document.getElementById("assistantBody");
    const handles = document.querySelectorAll(".resize-handle");
    const sendBtn = document.getElementById("assistantSendBtn");

    if (!widget || !toggle || !close || !header || !form || !body || !input) {
      return;
    }

    function unlockButton(btn) {
      if (!btn) return;
      btn.removeAttribute("disabled");
      btn.classList.remove("locked-input");
      btn.style.pointerEvents = "auto";
    }

    function detectPageName() {
      const path = window.location.pathname.toLowerCase();
      if (path.includes("/sales/new")) return "New Sales Order";
      if (path.includes("/sales/view")) return "Sales Order View";
      if (path.includes("/orders")) return "Order Management";
      if (path.includes("/admin")) return "Admin Dashboard";
      if (path.includes("/home")) return "Home Dashboard";
      if (path.includes("/forgot")) return "Password Recovery";
      if (path.includes("/reports")) return "Reports";
      if (path.includes("/eod")) return "End Of Day";
      if (path.includes("/suitepim")) return "SuitePim";
      return "this page";
    }

    function addMessage(text, sender = "bot") {
      const div = document.createElement("div");
      div.className = `assistant-message ${sender}`;
      div.textContent = text;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
      return div;
    }

    function renderMenu() {
      if (typeof window.renderAssistantMenu === "function") {
        window.renderAssistantMenu(body);
      } else {
        body.innerHTML = "";
        addMessage(`I can help with various tasks (${detectPageName()})`, "bot");
      }
      body.scrollTop = 0;
    }

    async function sendPrompt(message) {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      if (!saved?.token) {
        addMessage("I couldn't find your session, so I can't answer that yet.", "bot");
        return;
      }

      addMessage(message, "user");
      const pending = addMessage("Thinking...", "bot");

      sendBtn.disabled = true;
      input.disabled = true;
      input.value = "";

      try {
        const response = await fetch("/api/vsa/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${saved.token}`,
          },
          body: JSON.stringify({
            message,
            pageName: detectPageName(),
            pathname: window.location.pathname,
          }),
        });

        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "The assistant could not complete that request.");
        }

        pending.textContent =
          payload.reply || "I couldn't find anything useful for that just now.";
      } catch (error) {
        console.error("VSA query failed:", error);
        pending.textContent =
          error.message || "The assistant hit a problem while answering that.";
      } finally {
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
      }
    }

    unlockButton(toggle);
    unlockButton(close);
    document.dispatchEvent(new Event("assistantReady"));

    toggle.addEventListener("click", () => {
      const pageName = detectPageName();
      locationDiv.textContent = `We are currently on ${pageName}`;

      widget.style.display = "flex";
      widget.dataset.vsaOpen = "true";
      widget.classList.add("vsa-open");
      toggle.style.display = "none";

      if (!widget.dataset.userResized || widget.dataset.userResized !== "true") {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        let targetW;
        let targetH;
        let targetTop;
        let targetLeft;

        if (screenW >= 1400) {
          targetW = 360;
          targetH = 720;
          targetTop = screenH * 0.1;
          targetLeft = screenW - targetW - 30;
        } else if (screenW >= 1000) {
          targetW = 320;
          targetH = 560;
          targetTop = screenH * 0.12;
          targetLeft = screenW - targetW - 25;
        } else {
          targetW = Math.round(screenW * 0.9);
          targetH = Math.round(screenH * 0.7);
          targetTop = screenH * 0.15;
          targetLeft = screenW * 0.05;
        }

        widget.style.transition = "all 0.25s ease";
        widget.style.width = `${targetW}px`;
        widget.style.height = `${targetH}px`;
        widget.style.left = `${targetLeft}px`;
        widget.style.top = `${Math.max(20, targetTop)}px`;

        setTimeout(() => {
          widget.style.transition = "";
        }, 300);
      }

      renderMenu();
      setTimeout(() => input.focus(), 50);
    });

    close.addEventListener("click", () => {
      unlockButton(close);
      unlockButton(toggle);
      widget.style.display = "none";
      widget.dataset.vsaOpen = "false";
      widget.classList.remove("vsa-open");
      toggle.style.display = "block";
    });

    reset?.addEventListener("click", () => {
      renderMenu();
      input.value = "";
      input.focus();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = String(input.value || "").trim();
      if (!message) return;
      await sendPrompt(message);
    });

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener("mousedown", (event) => {
      isDragging = true;
      const rect = widget.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      document.body.style.userSelect = "";
    });

    document.addEventListener("mousemove", (event) => {
      if (!isDragging) return;
      let newLeft = event.clientX - offsetX;
      let newTop = event.clientY - offsetY;

      newLeft = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, newLeft));
      newTop = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, newTop));

      Object.assign(widget.style, {
        left: `${newLeft}px`,
        top: `${newTop}px`,
        bottom: "auto",
        right: "auto",
        position: "fixed",
      });
    });

    const minWidth = 250;
    const minHeight = 250;
    let isResizing = false;
    let currentHandle = null;
    let startX;
    let startY;
    let startW;
    let startH;
    let startL;
    let startT;

    handles.forEach((handle) =>
      handle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        isResizing = true;
        currentHandle = handle;
        const rect = widget.getBoundingClientRect();
        startX = event.clientX;
        startY = event.clientY;
        startW = rect.width;
        startH = rect.height;
        startL = rect.left;
        startT = rect.top;
        widget.dataset.userResized = "true";
        document.body.style.userSelect = "none";
      })
    );

    document.addEventListener("mouseup", () => {
      isResizing = false;
      document.body.style.userSelect = "";
    });

    document.addEventListener("mousemove", (event) => {
      if (!isResizing || !currentHandle) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      let newW = startW;
      let newH = startH;
      let newL = startL;
      let newT = startT;

      if (currentHandle.classList.contains("bottom-right")) {
        newW = startW + dx;
        newH = startH + dy;
      } else if (currentHandle.classList.contains("bottom-left")) {
        newW = startW - dx;
        newH = startH + dy;
        newL = startL + dx;
      } else if (currentHandle.classList.contains("top-right")) {
        newW = startW + dx;
        newH = startH - dy;
        newT = startT + dy;
      } else if (currentHandle.classList.contains("top-left")) {
        newW = startW - dx;
        newH = startH - dy;
        newL = startL + dx;
        newT = startT + dy;
      }

      Object.assign(widget.style, {
        width: `${Math.max(minWidth, newW)}px`,
        height: `${Math.max(minHeight, newH)}px`,
        left: `${newL}px`,
        top: `${newT}px`,
        bottom: "auto",
        right: "auto",
        position: "fixed",
      });
    });
  } catch (error) {
    console.error("assistant.js initialization failed:", error);
  }
});
