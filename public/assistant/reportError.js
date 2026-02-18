// public/assistant/reportError.js
console.log("🐞 VSA Report Issue Assistant active");

import { registerAssistantFeature } from "/assistant/assistantHooks.js";

document.addEventListener("DOMContentLoaded", async () => {
  const saved = storageGet?.();
  if (!saved?.token) return;

  registerAssistantFeature("Report Issue", (chatBody) => {
    startReportIssueFlow(chatBody);
  });

  function startReportIssueFlow(chatBody) {
    clearChat(chatBody);

    addMessage("No worries — I’ll open the Jira support ticket form.", "bot", chatBody);

    clearInteractive(chatBody);

    const btn = document.createElement("button");
    btn.className = "assistant-btn";
    btn.textContent = "Open Issue Reporter";

    btn.onclick = async () => {
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Opening…";

      const ok = await openSupportForm();

      btn.disabled = false;
      btn.textContent = original;

      if (ok) {
        addMessage("Support ticket form opened.", "bot", chatBody);
      } else {
        addMessage(
          "I couldn’t auto-open the form (browser blocked iframe access). Please click the “Raise Ticket” button bottom-right.",
          "bot",
          chatBody
        );
      }
    };

    chatBody.appendChild(btn);
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  async function openSupportForm() {
    // 1) Ensure loader exists
    if (typeof window.loadJiraWidgetOnce !== "function") {
      console.error("❌ window.loadJiraWidgetOnce is not defined");
      return false;
    }

    // 2) Load widget (should inject iframe#jsd-widget)
    await window.loadJiraWidgetOnce();

    // 3) Wait for iframe in parent DOM
    const iframe = await waitForIframe(15000);
    if (!iframe) {
      console.warn("⚠️ Jira iframe (#jsd-widget) not found.");
      return false;
    }

    // 4) Try to click #help-button inside iframe (same-origin only)
    try {
      const innerDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!innerDoc) {
        console.warn("⚠️ iframe has no accessible document (likely cross-origin).");
        return false;
      }

      const helpBtn = await waitForHelpButton(innerDoc, 8000);
      if (!helpBtn) {
        console.warn("⚠️ #help-button not found inside iframe.");
        return false;
      }

      helpBtn.click();
      return true;
    } catch (err) {
      // Cross-origin access will throw a DOMException
      console.warn("⚠️ Could not access iframe DOM to click help button:", err);
      return false;
    }
  }

  function waitForIframe(timeoutMs = 15000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const iframe = document.querySelector("iframe#jsd-widget");
        if (iframe) return resolve(iframe);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function waitForHelpButton(innerDoc, timeoutMs = 8000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const el = innerDoc.querySelector("#help-button");
        if (el) return resolve(el);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  /* ==========================================================
     Helpers
     ========================================================== */
  function addMessage(text, sender, targetBody) {
    const div = document.createElement("div");
    div.className = `assistant-message ${sender}`;
    div.textContent = text;
    targetBody.appendChild(div);
    targetBody.scrollTop = targetBody.scrollHeight;
  }

  function clearInteractive(targetBody) {
    targetBody
      .querySelectorAll(".assistant-btn, .assistant-select, input.assistant-select")
      .forEach((el) => el.remove());
  }

  function clearChat(targetBody) {
    targetBody.innerHTML = "";
  }
});
