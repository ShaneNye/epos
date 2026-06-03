(function transactionAutoStatus() {
  const STATUS_EVENT_KEY = "eposUserStatusChanged";
  const STATUS_CHANNEL = "epos-user-status";
  const path = window.location.pathname;
  const config = path.startsWith("/sales/new")
    ? { emoji: "\uD83E\uDDFE", text: "Processing a sale" }
    : path.startsWith("/quote/new")
      ? { emoji: "\uD83D\uDCDD", text: "Processing a quote" }
      : null;

  if (!config) return;

  const saved = typeof storageGet === "function" ? storageGet() : null;
  const token = saved?.token;
  if (!token) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const channel = typeof BroadcastChannel === "function"
    ? new BroadcastChannel(STATUS_CHANNEL)
    : null;

  function notifyStatusChanged(payload = {}) {
    try {
      localStorage.setItem(STATUS_EVENT_KEY, String(Date.now()));
    } catch {
      // Best-effort cross-window notification only.
    }
    try {
      channel?.postMessage({
        type: "user-status-changed",
        at: Date.now(),
        ...payload,
      });
    } catch {
      // Best-effort cross-window notification only.
    }
  }

  function postStatus(payload) {
    return fetch("/api/users/status", {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers,
      body: JSON.stringify(payload),
    })
      .then((res) => {
        notifyStatusChanged(payload);
        return res;
      })
      .catch((err) => {
        console.warn("Failed to update transaction status:", err);
      });
  }

  function setProcessingStatus() {
    return postStatus({
      status: "busy",
      emoji: config.emoji,
      text: config.text,
      expiresInSeconds: 150,
    });
  }

  function clearProcessingStatus() {
    return postStatus({
      status: "available",
      emoji: "",
      text: "",
      clearIfText: config.text,
    });
  }

  setProcessingStatus();
  const heartbeat = window.setInterval(setProcessingStatus, 60 * 1000);

  window.addEventListener("pagehide", () => {
    window.clearInterval(heartbeat);
    clearProcessingStatus();
  });

  window.addEventListener("beforeunload", () => {
    window.clearInterval(heartbeat);
    clearProcessingStatus();
  });
})();
