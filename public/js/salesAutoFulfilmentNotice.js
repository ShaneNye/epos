(function () {
  const PENDING_MESSAGE =
    "This item is marked for auto fulfilment once the intercompany process has been completed.";
  const COMPLETE_MESSAGE = "This item has been fulfilled";
  const BACKORDERED_MESSAGE = "this item is currently on back order";
  const PENDING_FULFILMENT_MESSAGE = "this item is in and pending fulfilment";

  const STATUS_CONFIG = {
    fulfilled: {
      icon: "\u2713",
      title: "Fulfilled",
      className: "auto-fulfilment-alert--complete",
      message: COMPLETE_MESSAGE,
    },
    backordered: {
      icon: "!",
      title: "Back order",
      className: "auto-fulfilment-alert--backordered",
      message: BACKORDERED_MESSAGE,
    },
    "pending-fulfilment": {
      icon: "\u2713",
      title: "In and pending fulfilment",
      className: "auto-fulfilment-alert--pending-fulfilment",
      message: PENDING_FULFILMENT_MESSAGE,
    },
    "auto-fulfilment-pending": {
      icon: "!",
      title: "Auto fulfilment information",
      className: "",
      message: PENDING_MESSAGE,
    },
  };

  function statusForRow(row) {
    return (
      row?.dataset.autoFulfilmentStatus ||
      (row?.dataset.autoFulfilmentComplete === "1"
        ? "fulfilled"
        : row?.dataset.takenFromStore === "1"
          ? "auto-fulfilment-pending"
          : "")
    );
  }

  function ensureModal() {
    let modal = document.getElementById("autoFulfilmentInfoModal");
    if (modal) return modal;

    modal = document.createElement("dialog");
    modal.id = "autoFulfilmentInfoModal";
    modal.className = "auto-fulfilment-modal";
    modal.setAttribute("aria-labelledby", "autoFulfilmentInfoMessage");
    modal.innerHTML = `
      <p id="autoFulfilmentInfoMessage">${PENDING_MESSAGE}</p>
      <div class="auto-fulfilment-modal-actions">
        <button type="button" class="btn-primary auto-fulfilment-modal-close">OK</button>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector(".auto-fulfilment-modal-close").onclick = () => modal.close();
    return modal;
  }

  function update(row) {
    const button = row?.querySelector(".auto-fulfilment-alert");
    if (!button) return;

    const config = STATUS_CONFIG[statusForRow(row)] || null;
    button.hidden = !config;
    button.textContent = config?.icon || "!";
    button.classList.remove(
      "auto-fulfilment-alert--complete",
      "auto-fulfilment-alert--backordered",
      "auto-fulfilment-alert--pending-fulfilment"
    );
    if (config?.className) button.classList.add(config.className);
    button.title = config?.title || "Auto fulfilment information";
    button.setAttribute("aria-label", config?.title || "Auto fulfilment information");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".auto-fulfilment-alert");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const row = button.closest("tr");
    const message = STATUS_CONFIG[statusForRow(row)]?.message || PENDING_MESSAGE;
    const modal = ensureModal();
    const messageEl = modal.querySelector("#autoFulfilmentInfoMessage");
    if (messageEl) messageEl.textContent = message;

    if (typeof modal.showModal === "function") modal.showModal();
    else window.alert(message);
  });

  window.updateAutoFulfilmentNotice = update;
  window.refreshAutoFulfilmentNotices = () =>
    document.querySelectorAll("#orderItemsBody .order-line").forEach(update);
})();
