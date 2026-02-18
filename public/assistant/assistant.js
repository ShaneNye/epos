// public/assistant/assistant.js
console.log("🤖 assistant.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  try {
    /* ==========================================================
       🧩 Jira Widget Loader (GLOBAL)
       Atlassian embed.js only injects on DOMContentLoaded.
       Because we load it AFTER DOMContentLoaded, we must re-dispatch
       DOMContentLoaded after embed.js loads.
       ========================================================== */
    if (!window.loadJiraWidgetOnce) {
      let jiraLoadingPromise = null;

      window.loadJiraWidgetOnce = function loadJiraWidgetOnce() {
        // ✅ Already injected?
        if (document.querySelector("iframe#jsd-widget")) {
          return Promise.resolve(true);
        }

        // Already loading
        if (jiraLoadingPromise) return jiraLoadingPromise;

        jiraLoadingPromise = new Promise((resolve, reject) => {
          // If script tag already exists, just trigger injection + wait
          const existing = document.querySelector(
            'script[src*="jsd-widget.atlassian.com/assets/embed.js"]'
          );

          if (existing) {
            // 🔥 Trigger Atlassian's DOMContentLoaded handler
            document.dispatchEvent(new Event("DOMContentLoaded"));
            return waitForIframe(resolve, reject);
          }

          // ✅ Inject script properly (this WILL execute)
          const s = document.createElement("script");
          s.src = "https://jsd-widget.atlassian.com/assets/embed.js";
          s.async = true;

          s.setAttribute("data-jsd-embedded", "");
          s.setAttribute("data-key", "715c9200-cafe-43ac-9ab7-882e97092b35");
          s.setAttribute("data-base-url", "https://jsd-widget.atlassian.com");

          s.onload = () => {
            // 🔥 Key fix: Atlassian waits for DOMContentLoaded, so fire it now
            document.dispatchEvent(new Event("DOMContentLoaded"));
            waitForIframe(resolve, reject);
          };

          s.onerror = () => {
            jiraLoadingPromise = null;
            reject(
              new Error(
                "Failed to load Jira embed.js (blocked by CSP/adblock/network)"
              )
            );
          };

          // Append to body like a normal snippet
          document.body.appendChild(s);
        });

        return jiraLoadingPromise;
      };

      function waitForIframe(resolve, reject) {
        const start = Date.now();
        const timeoutMs = 15000;

        const tick = () => {
          // Atlassian sets iframe id="jsd-widget" (from embed.js source)
          if (document.querySelector("iframe#jsd-widget")) {
            return resolve(true);
          }

          if (Date.now() - start > timeoutMs) {
            jiraLoadingPromise = null;
            return reject(
              new Error(
                "Jira widget loaded but iframe did not inject (check CSP / network follow-up calls / widget key)"
              )
            );
          }

          setTimeout(tick, 150);
        };

        tick();
      }
    }

    /* ==========================================================
       🧠 Load assistant HTML fragment
       ========================================================== */
    const resp = await fetch("/assistant/assistant.html");
    if (!resp.ok)
      throw new Error(`assistant.html fetch failed → ${resp.status}`);

    const html = await resp.text();
    document.body.insertAdjacentHTML("beforeend", html);

    // Wait for DOM update
    await new Promise((r) => requestAnimationFrame(r));

    const widget = document.getElementById("salesAssistant");
    const toggle = document.getElementById("assistantToggle");
    const close = document.getElementById("closeAssistant");
    const header = document.getElementById("assistantHeader");
    const locationDiv = document.getElementById("assistantLocation");
    const form = document.getElementById("assistantForm");
    const input = document.getElementById("assistantInput");
    const body = document.getElementById("assistantBody");
    const handles = document.querySelectorAll(".resize-handle");
    const sendBtn = form?.querySelector("button");

    if (!widget || !toggle || !close || !header || !form || !body) return;

    /* ---------- Remove input field entirely ---------- */
    if (input) input.remove();
    if (sendBtn) {
      sendBtn.textContent = "Reset";
      sendBtn.type = "button";
    }

    /* ---------- Utility ---------- */
    function unlockButton(btn) {
      if (!btn) return;
      btn.removeAttribute("disabled");
      btn.classList.remove("locked-input");
      btn.style.pointerEvents = "auto";
    }

    unlockButton(toggle);
    unlockButton(close);

    // Let page-specific scripts know we’re ready
    document.dispatchEvent(new Event("assistantReady"));

    /* ---------- Detect current page ---------- */
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
      return "an unknown page";
    }

    toggle.addEventListener("click", () => {
      unlockButton(toggle);

      const pageName = detectPageName();
      locationDiv.textContent = `We are currently on ${pageName}`;

      widget.style.display = "flex";
      widget.dataset.vsaOpen = "true";
      widget.classList.add("vsa-open");
      toggle.style.display = "none";

      /* =======================================================
         🟦 Responsive Default Expansion (only once)
         ======================================================= */
      if (!widget.dataset.userResized || widget.dataset.userResized !== "true") {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        let targetW, targetH, targetTop, targetLeft;

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

        setTimeout(() => (widget.style.transition = ""), 300);
      }

      input?.focus();
    });

    /* ---------- Close behaviour ---------- */
    close.addEventListener("pointerdown", () => unlockButton(close));
    close.addEventListener("click", () => {
      unlockButton(close);
      unlockButton(toggle);
      widget.style.display = "none";
      widget.dataset.vsaOpen = "false";
      widget.classList.remove("vsa-open");
      toggle.style.display = "block";
    });

    /* ---------- Reset Chat button ---------- */
    if (sendBtn) {
      sendBtn.addEventListener("click", () => {
        body.innerHTML = "";

        if (window.AssistantExtensions?.length) {
          const pageTitle =
            document.getElementById("assistantLocation")?.textContent || "";
          const intro = document.createElement("div");
          intro.className = "assistant-message bot";
          intro.textContent = `I can help with various tasks ${
            pageTitle ? `(${pageTitle})` : ""
          }`;
          body.appendChild(intro);

          window.AssistantExtensions.forEach((feature) => {
            const btn = document.createElement("button");
            btn.textContent = feature.label;
            btn.className = "assistant-btn";
            btn.onclick = () => feature.callback(body);
            body.appendChild(btn);
          });
        } else {
          const msg = document.createElement("div");
          msg.className = "assistant-message bot";
          msg.textContent = "No assistant features are available right now.";
          body.appendChild(msg);
        }

        body.scrollTop = 0;
      });
    }

    /* ---------- Drag logic ---------- */
    let isDragging = false,
      offsetX = 0,
      offsetY = 0;

    header.addEventListener("mousedown", (e) => {
      isDragging = true;
      const rect = widget.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      document.body.style.userSelect = "";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;
      newLeft = Math.max(
        0,
        Math.min(window.innerWidth - widget.offsetWidth, newLeft)
      );
      newTop = Math.max(
        0,
        Math.min(window.innerHeight - widget.offsetHeight, newTop)
      );
      Object.assign(widget.style, {
        left: `${newLeft}px`,
        top: `${newTop}px`,
        bottom: "auto",
        right: "auto",
        position: "fixed",
      });
    });

    /* ---------- Resize logic ---------- */
    const minWidth = 250,
      minHeight = 250;
    let isResizing = false,
      currentHandle = null;
    let startX, startY, startW, startH, startL, startT;

    handles.forEach((h) =>
      h.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isResizing = true;
        currentHandle = h;
        const r = widget.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startW = r.width;
        startH = r.height;
        startL = r.left;
        startT = r.top;
        document.body.style.userSelect = "none";
      })
    );

    document.addEventListener("mouseup", () => {
      isResizing = false;
      document.body.style.userSelect = "";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newW = startW,
        newH = startH,
        newL = startL,
        newT = startT;

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
  } catch (err) {
    console.error("❌ assistant.js initialization failed:", err);
  }
});
