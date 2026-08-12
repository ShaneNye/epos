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
    const declaredLabel = document.querySelector(`[data-tooltip-field="${escaped}"]`);
    if (declaredLabel) return declaredLabel;
    const field = document.getElementById(fieldKey) || document.querySelector(`[name="${escaped}"]`);
    if (!field) return null;
    const conventionalLabel =
      document.querySelector(`label[for="${escaped}"]`) ||
      field.closest("label") ||
      field.parentElement?.querySelector("label");
    if (conventionalLabel) return conventionalLabel;

    const cell = field.closest("td");
    const table = cell?.closest("table");
    if (cell && table) {
      const cellIndex = [...cell.parentElement.children].indexOf(cell);
      const headerRow = table.tHead?.rows?.[table.tHead.rows.length - 1];
      const columnHeader = headerRow?.cells?.[cellIndex];
      if (columnHeader) return columnHeader;
    }

    return null;
  }

  function tooltipTriggerFor(label) {
    if (!label || label.tagName !== "LABEL") return label;
    const existing = label.querySelector(":scope > .epos-tooltip-label-text");
    if (existing) return existing;

    const trigger = document.createElement("span");
    trigger.className = "epos-tooltip-label-text";
    const movableNodes = [...label.childNodes].filter((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim();
      return node.nodeType === Node.ELEMENT_NODE &&
        !node.matches("input, select, textarea, button, .epos-tooltip-message");
    });
    if (!movableNodes.length) return label;
    label.insertBefore(trigger, movableNodes[0]);
    movableNodes.forEach((node) => trigger.appendChild(node));
    return trigger;
  }

  function install(items) {
    const closeTip = (tip) => {
      tip.classList.remove("is-open");
      tip._eposTooltipLabel?.setAttribute("aria-expanded", "false");
      tip.closest(".epos-tooltip-label")?.setAttribute("aria-expanded", "false");
    };
    const closeOtherTips = (currentTip = null) => {
      document.querySelectorAll(".epos-tooltip-message.is-open").forEach((tip) => {
        if (tip !== currentTip) closeTip(tip);
      });
    };
    const apply = () => items.forEach((item) => {
      const fieldLabel = findLabel(item.fieldKey);
      const label = tooltipTriggerFor(fieldLabel);
      if (!label || label.dataset.tooltipReady === item.message) return;
      label.dataset.tooltipReady = item.message;
      label.classList.add("epos-tooltip-label");
      if (fieldLabel?.matches("th, [data-tooltip-field^='item-line-']")) {
        label.classList.add("epos-tooltip-above");
      }
      label.tabIndex = label.tabIndex >= 0 ? label.tabIndex : 0;
      label.setAttribute("role", "button");
      label.setAttribute("aria-label", `${label.textContent.trim()}: ${item.message}`);
      label.setAttribute("aria-expanded", "false");
      let tip = label.querySelector(":scope > .epos-tooltip-message");
      if (!tip) {
        tip = document.createElement("span");
        tip.className = "epos-tooltip-message";
        tip._eposTooltipLabel = label;
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
        if (
          event.type === "click" &&
          event.target !== label &&
          event.target.closest?.("input, select, textarea, option, button, a")
        ) return;
        event.preventDefault();
        event.stopPropagation();
        const opening = !tip.classList.contains("is-open");
        closeOtherTips(tip);
        if (opening) {
          tip.classList.toggle("epos-tooltip-opens-above", label.classList.contains("epos-tooltip-above"));
          tip.classList.add("epos-tooltip-portal");
          document.body.appendChild(tip);
        }
        tip.classList.toggle("is-open", opening);
        label.setAttribute("aria-expanded", String(opening));
        if (opening) {
          const anchor = label.getBoundingClientRect();
          const bubble = tip.getBoundingClientRect();
          const left = Math.max(8, Math.min(anchor.left, window.innerWidth - bubble.width - 8));
          const top = label.classList.contains("epos-tooltip-above")
            ? Math.max(8, anchor.top - bubble.height - 10)
            : Math.min(window.innerHeight - bubble.height - 8, anchor.bottom + 10);
          tip.style.left = `${left}px`;
          tip.style.top = `${top}px`;
        }
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
