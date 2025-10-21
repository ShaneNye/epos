// public/assistant/assistant.js
console.log("🤖 assistant.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const resp = await fetch("/assistant/assistant.html");
    if (!resp.ok) throw new Error(`assistant.html fetch failed → ${resp.status}`);

    const html = await resp.text();
    document.body.insertAdjacentHTML("beforeend", html);

    // Wait for DOM to update
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

    if (!widget || !toggle || !close || !header || !form || !input || !body) return;

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
      return "an unknown page";
    }

    /* ---------- Toggle behaviour ---------- */
    toggle.addEventListener("pointerdown", () => unlockButton(toggle));
    toggle.addEventListener("click", () => {
      unlockButton(toggle);
      const pageName = detectPageName();
      locationDiv.textContent = `We are currently on ${pageName}`;
      widget.style.display = "flex";
      widget.dataset.vsaOpen = "true";
      widget.classList.add("vsa-open");
      toggle.style.display = "none";
      input.focus();
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

    /* ---------- Drag logic ---------- */
    let isDragging = false, offsetX = 0, offsetY = 0;

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

    /* ---------- Resize logic ---------- */
    const minWidth = 250, minHeight = 250;
    let isResizing = false, currentHandle = null;
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
      let newW = startW, newH = startH, newL = startL, newT = startT;

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

    /* ---------- Message sending ---------- */
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = input.value.trim();
      if (!msg) return;

      addMessage(msg, "user");
      input.value = "";
      addMessage("...", "bot");

      try {
        const res = await fetch("/api/vsa/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg }),
        });
        const data = await res.json();
        const reply = data.ok
          ? data.reply
          : "Sorry, something went wrong retrieving that info.";
        const lastBot = document.querySelector(".assistant-message.bot:last-child");
        if (lastBot) lastBot.textContent = reply;
      } catch (err) {
        const lastBot = document.querySelector(".assistant-message.bot:last-child");
        if (lastBot) lastBot.textContent = "⚠️ Couldn’t connect to the server.";
        console.error("VSA fetch failed:", err);
      }
      body.scrollTop = body.scrollHeight;
    });

    /* ---------- Helper: add chat message ---------- */
    function addMessage(text, sender) {
      const div = document.createElement("div");
      div.className = `assistant-message ${sender}`;
      div.textContent = text;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }
  } catch (err) {
    console.error("❌ assistant.js initialization failed:", err);
  }
});
