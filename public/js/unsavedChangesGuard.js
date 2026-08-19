(function () {
  "use strict";

  let options = null;
  let userEdited = false;
  let bypass = false;
  let pendingHref = "";

  const style = document.createElement("style");
  style.textContent = `
    .unsaved-guard-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.48);display:flex;align-items:center;justify-content:center;padding:20px}
    .unsaved-guard-dialog{width:min(460px,100%);background:#fff;border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.28);padding:24px;color:#263238}
    .unsaved-guard-dialog h2{margin:0 0 10px;font-size:21px}.unsaved-guard-dialog p{margin:0 0 22px;line-height:1.5;color:#52606d}
    .unsaved-guard-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.unsaved-guard-actions button{min-height:40px;padding:8px 16px;border-radius:7px;cursor:pointer}
    .unsaved-guard-stay{background:#fff;border:1px solid #b8c2cc}.unsaved-guard-leave{background:#fff;border:1px solid #c94b4b;color:#a52828}.unsaved-guard-save{background:#176b73;border:1px solid #176b73;color:#fff}
  `;
  document.head.appendChild(style);

  function rawDirty() {
    if (!options) return false;
    try {
      return typeof options.hasChanges === "function" ? !!options.hasChanges() : userEdited;
    } catch (err) {
      console.warn("Unable to check for unsaved changes:", err);
      return true;
    }
  }

  function isDirty() {
    return !bypass && rawDirty();
  }

  function closeDialog() {
    document.querySelector(".unsaved-guard-backdrop")?.remove();
    pendingHref = "";
  }

  function leave(href) {
    bypass = true;
    window.location.href = href;
  }

  async function saveAndExit(saveButton) {
    const save = document.querySelector(".unsaved-guard-save");
    const stay = document.querySelector(".unsaved-guard-stay");
    const leaveButton = document.querySelector(".unsaved-guard-leave");
    [save, stay, leaveButton].forEach((button) => { if (button) button.disabled = true; });
    if (save) save.textContent = "Saving…";

    try {
      bypass = true;
      if (typeof options.save === "function") {
        await options.save();
      } else {
        const button = document.querySelector(options.saveButton);
        if (!button) throw new Error("The save button is unavailable.");
        button.click();
        await new Promise((resolve, reject) => {
          const started = Date.now();
          const timer = setInterval(() => {
            if (!document.documentElement.isConnected) return;
            if (!rawDirty()) { clearInterval(timer); resolve(); }
            else if (Date.now() - started > 30000) { clearInterval(timer); reject(new Error("The save did not complete.")); }
          }, 200);
        });
      }
      userEdited = false;
      if (pendingHref) leave(pendingHref);
    } catch (err) {
      bypass = false;
      [save, stay, leaveButton].forEach((button) => { if (button) button.disabled = false; });
      if (save) save.textContent = "Save and exit";
      window.showToast?.(err?.message || "Unable to save changes.", "error");
      console.error("Save and exit failed:", err);
    }
  }

  function showDialog(href) {
    if (document.querySelector(".unsaved-guard-backdrop")) return;
    pendingHref = href;
    const backdrop = document.createElement("div");
    backdrop.className = "unsaved-guard-backdrop";
    backdrop.innerHTML = `<div class="unsaved-guard-dialog" role="dialog" aria-modal="true" aria-labelledby="unsavedGuardTitle"><h2 id="unsavedGuardTitle">Unsaved changes</h2><p>You have made changes to this ${options.label || "record"}. Would you like to stay on this page, leave without saving, or save your changes and exit?</p><div class="unsaved-guard-actions"><button type="button" class="unsaved-guard-stay">Stay on page</button><button type="button" class="unsaved-guard-leave">Leave without saving</button><button type="button" class="unsaved-guard-save">Save and exit</button></div></div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector(".unsaved-guard-stay").onclick = closeDialog;
    backdrop.querySelector(".unsaved-guard-leave").onclick = () => leave(href);
    backdrop.querySelector(".unsaved-guard-save").onclick = saveAndExit;
    backdrop.querySelector(".unsaved-guard-stay").focus();
  }

  document.addEventListener("input", (event) => { if (event.isTrusted) userEdited = true; }, true);
  document.addEventListener("change", (event) => { if (event.isTrusted) userEdited = true; }, true);
  document.addEventListener("click", (event) => {
    if (!options || bypass || event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target.closest?.("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (!isDirty()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showDialog(anchor.href);
  }, true);
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.UnsavedChangesGuard = {
    configure(config) { options = config || {}; bypass = false; },
    markSaved() { userEdited = false; },
    allowNavigation() { bypass = true; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (options) return;
    if (location.pathname.includes("/sales/new")) {
      window.UnsavedChangesGuard.configure({ label: "sales order", saveButton: "#saveOrderBtn" });
    } else if (location.pathname.includes("/quote/new")) {
      window.UnsavedChangesGuard.configure({ label: "quote", saveButton: ".actions .btn-primary" });
    }
  });
})();
