(function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function googleDrivePreview(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
      const id = fileMatch?.[1] || parsed.searchParams.get("id");
      if (parsed.hostname.includes("drive.google.com") && id) {
        return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
      }
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function videoEmbedUrl(url, { autoplay = false } = {}) {
    const raw = String(url || "").trim();
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.replace(/^www\./, "");
      const params = autoplay ? "?autoplay=1" : "";

      if (host === "youtu.be") {
        const id = parsed.pathname.split("/").filter(Boolean)[0];
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}${params}` : "";
      }

      if (host.endsWith("youtube.com")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const id = parsed.searchParams.get("v") || parts[parts.length - 1];
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}${params}` : "";
      }

      if (host.endsWith("vimeo.com")) {
        const id = parsed.pathname.split("/").filter(Boolean).pop();
        return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}${params}` : "";
      }

      return parsed.toString();
    } catch {
      return "";
    }
  }

  function emptyPanel(message) {
    const div = document.createElement("div");
    div.className = "viewer-empty";
    div.textContent = message;
    return div;
  }

  function frame(src, title) {
    if (!src) return emptyPanel("No link has been added for this tab.");

    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.title = title;
    iframe.loading = "lazy";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    return iframe;
  }

  function setActiveTab(tabName) {
    document.querySelectorAll(".viewer-tabs button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    document.querySelectorAll(".viewer-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === tabName);
    });

    if (tabName === "video") {
      loadAutoplayVideo();
    }
  }

  function loadAutoplayVideo() {
    const videoPanel = document.querySelector('[data-panel="video"]');
    if (!videoPanel || videoPanel.dataset.loaded === "1") return;

    const src = videoPanel.dataset.videoSrc || "";
    videoPanel.textContent = "";
    videoPanel.appendChild(frame(src, videoPanel.dataset.videoTitle || "Process video"));
    videoPanel.dataset.loaded = "1";
  }

  function readProcess() {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key") || "";
    if (!key) return null;

    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function init() {
    const process = readProcess();
    const title = document.getElementById("processTitle");
    const scribePanel = document.querySelector('[data-panel="scribe"]');
    const videoPanel = document.querySelector('[data-panel="video"]');

    if (!process) {
      title.textContent = "Systems & Process";
      scribePanel.appendChild(emptyPanel("This systems and process guide could not be loaded."));
      videoPanel.appendChild(emptyPanel("This systems and process guide could not be loaded."));
      return;
    }

    document.title = `${process.title || "Systems & Process"} - EPOS`;
    title.innerHTML = escapeHtml(process.title || "Systems & Process");

    scribePanel.appendChild(frame(googleDrivePreview(process.scribeLink), `${process.title} scribe document`));
    videoPanel.dataset.videoSrc = videoEmbedUrl(process.videoLink, { autoplay: true });
    videoPanel.dataset.videoTitle = `${process.title} video`;
    videoPanel.appendChild(emptyPanel("Select the Video tab to play the process demo."));

    document.querySelector(".viewer-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-tab]");
      if (button) setActiveTab(button.dataset.tab);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
