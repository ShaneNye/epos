(function () {
  const script = document.currentScript;
  const pageKey = String(script?.dataset?.pageKey || window.location.pathname).toLowerCase();
  if (!pageKey || window.__eposTooltipsLoaded) return;
  window.__eposTooltipsLoaded = true;

  function token() {
    try {
      const raw = sessionStorage.getItem("eposAuth") || localStorage.getItem("eposAuth");
      return raw ? JSON.parse(raw)?.token : "";
    } catch { return ""; }
  }

  function findLabel(fieldKey) {
    const escaped = window.CSS?.escape ? CSS.escape(fieldKey) : fieldKey.replace(/["\\]/g, "\\$&");
    const field = document.getElementById(fieldKey) || document.querySelector(`[name="${escaped}"]`);
    if (!field) return null;
    return document.querySelector(`label[for="${escaped}"]`) || field.closest("label") || field.parentElement?.querySelector("label");
  }

  function install(items) {
    const closeTip = (tip) => {
      tip.classList.remove("is-open");
      tip.closest(".epos-tooltip-label")?.setAttribute("aria-expanded", "false");
    };
    const closeOtherTips = (currentTip = null) => {
      document.querySelectorAll(".epos-tooltip-message.is-open").forEach((tip) => {
        if (tip !== currentTip) closeTip(tip);
      });
    };
    const apply = () => items.forEach((item) => {
      const label = findLabel(item.fieldKey);
      if (!label || label.dataset.tooltipReady === item.message) return;
      label.dataset.tooltipReady = item.message;
      label.classList.add("epos-tooltip-label");
      label.tabIndex = label.tabIndex >= 0 ? label.tabIndex : 0;
      label.setAttribute("role", "button");
      label.setAttribute("aria-label", `${label.textContent.trim()}: ${item.message}`);
      label.setAttribute("aria-expanded", "false");
      let tip = label.querySelector(":scope > .epos-tooltip-message");
      if (!tip) {
        tip = document.createElement("span");
        tip.className = "epos-tooltip-message";
        tip.setAttribute("role", "tooltip");
        const text = document.createElement("span");
        text.className = "epos-tooltip-text";
        const close = document.createElement("button");
        close.type = "button";
        close.className = "epos-tooltip-close";
        close.setAttribute("aria-label", "Close tooltip");
        close.textContent = "×";
        close.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeTip(tip);
          label.focus();
        });
        tip.append(text, close);
        label.appendChild(tip);
      }
      tip.querySelector(".epos-tooltip-text").textContent = item.message;
      const toggle = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const opening = !tip.classList.contains("is-open");
        closeOtherTips(tip);
        tip.classList.toggle("is-open", opening);
        label.setAttribute("aria-expanded", String(opening));
      };
      label.addEventListener("click", toggle);
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") toggle(event);
        if (event.key === "Escape") closeTip(tip);
      });
    });
    apply();
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", () => closeOtherTips());
  }

  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/css/tooltips.css";
  document.head.appendChild(style);

  fetch(`/api/tooltips?page=${encodeURIComponent(pageKey)}`, {
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  }).then((response) => response.ok ? response.json() : null)
    .then((data) => data?.tooltips?.length && install(data.tooltips))
    .catch(() => {});
})();
