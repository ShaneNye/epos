(function () {
  const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  const DEFAULT_CENTER = [51.5072, -0.1276];
  const DEFAULT_ZOOM = 7;
  const NOTE_PREFIX = "3WhatWord Value :";

  let leafletPromise = null;
  let modal = null;
  let map = null;
  let marker = null;
  let postcodeMarker = null;
  let selectedWords = "";
  let targetTextarea = null;

  function authHeaders() {
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
    } catch {
      return {};
    }
  }

  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;

    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = LEAFLET_CSS;
        document.head.appendChild(link);
      }

      const script = document.createElement("script");
      script.src = LEAFLET_JS;
      script.async = true;
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error("Could not load the map library"));
      document.head.appendChild(script);
    });

    return leafletPromise;
  }

  function setStatus(message, type = "") {
    const status = modal?.querySelector("[data-w3w-status]");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", type === "error");
  }

  function setWords(words) {
    selectedWords = String(words || "").replace(/^\/+/, "").trim();
    const output = modal?.querySelector("[data-w3w-output]");
    const submit = modal?.querySelector("[data-w3w-submit]");
    if (output) output.value = selectedWords;
    if (submit) submit.disabled = !selectedWords;
  }

  function createModal() {
    const el = document.createElement("div");
    el.className = "w3w-modal";
    el.hidden = true;
    el.innerHTML = `
      <div class="w3w-modal-backdrop" data-w3w-close></div>
      <div class="w3w-modal-panel" role="dialog" aria-modal="true" aria-labelledby="w3wModalTitle">
        <header class="w3w-modal-header">
          <h2 class="w3w-modal-title" id="w3wModalTitle">what3words location</h2>
          <button type="button" class="w3w-modal-close" data-w3w-close aria-label="Close">x</button>
        </header>
        <div class="w3w-modal-body">
          <div class="w3w-postcode-row">
            <label class="w3w-postcode-label">
              Postcode
              <input type="text" data-w3w-postcode placeholder="Enter postcode">
            </label>
            <button type="button" class="btn-secondary" data-w3w-postcode-search>Find</button>
          </div>
          <div class="w3w-map" data-w3w-map></div>
          <div class="w3w-output">
            <input type="text" data-w3w-output readonly placeholder="Click the map to generate a what3words address">
            <button type="button" class="btn-secondary" data-w3w-map-link disabled>Open map</button>
          </div>
          <div class="w3w-status" data-w3w-status>Click the map to drop a pin and generate a 3 word address.</div>
        </div>
        <footer class="w3w-modal-footer">
          <button type="button" class="btn-secondary" data-w3w-close>Cancel</button>
          <button type="button" class="btn-primary" data-w3w-submit disabled>Submit</button>
        </footer>
      </div>
    `;

    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-w3w-close]")) closeModal();
      if (event.target.closest("[data-w3w-submit]")) submitWords();
      if (event.target.closest("[data-w3w-map-link]")) openMapLink();
      if (event.target.closest("[data-w3w-postcode-search]")) locatePostcodeFromModal();
    });

    el.addEventListener("keydown", (event) => {
      if (event.target.closest("[data-w3w-postcode]") && event.key === "Enter") {
        event.preventDefault();
        locatePostcodeFromModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (!el.hidden && event.key === "Escape") closeModal();
    });

    document.body.appendChild(el);
    return el;
  }

  async function convertToWords(lat, lng) {
    setStatus("Generating what3words address...");
    setWords("");
    const mapLink = modal?.querySelector("[data-w3w-map-link]");
    if (mapLink) {
      mapLink.disabled = true;
      mapLink.dataset.href = "";
    }

    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const response = await fetch(`/api/what3words/convert-to-3wa?${params}`, {
      headers: { Accept: "application/json", ...authHeaders() },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Could not generate what3words address");
    }

    setWords(payload.words);
    if (mapLink) {
      mapLink.disabled = !payload.map;
      mapLink.dataset.href = payload.map || "";
    }
    setStatus(payload.nearestPlace ? `Pinned near ${payload.nearestPlace}.` : "Pinned location ready.");
  }

  async function handleMapClick(event) {
    const { lat, lng } = event.latlng;
    if (marker) {
      marker.setLatLng(event.latlng);
    } else {
      marker = window.L.marker(event.latlng).addTo(map);
    }

    try {
      await convertToWords(lat, lng);
    } catch (err) {
      setStatus(err.message || "Could not generate what3words address", "error");
    }
  }

  async function lookupPostcode(postcode) {
    const params = new URLSearchParams({ postcode });
    const response = await fetch(`/api/what3words/postcode-location?${params}`, {
      headers: { Accept: "application/json", ...authHeaders() },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Postcode not found");
    }

    return payload;
  }

  async function locatePostcode(postcode) {
    const cleaned = String(postcode || "").trim();
    if (!cleaned) {
      setStatus("Enter a postcode to move the map.", "error");
      return;
    }

    const button = modal?.querySelector("[data-w3w-postcode-search]");
    if (button) {
      button.disabled = true;
      button.textContent = "Finding...";
    }

    try {
      setStatus("Finding postcode...");
      const result = await lookupPostcode(cleaned);
      const latLng = [result.latitude, result.longitude];
      map.setView(latLng, 17);

      if (postcodeMarker) {
        postcodeMarker.setLatLng(latLng);
      } else {
        postcodeMarker = window.L.circleMarker(latLng, {
          radius: 8,
          color: "#0081ab",
          fillColor: "#0081ab",
          fillOpacity: 0.22,
          weight: 2,
        }).addTo(map);
      }

      const input = modal?.querySelector("[data-w3w-postcode]");
      if (input) input.value = result.postcode || cleaned;
      setStatus("Postcode found. Click the exact delivery spot on the map.");
    } catch (err) {
      setStatus(err.message || "Postcode not found", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Find";
      }
      setTimeout(() => map?.invalidateSize(), 50);
    }
  }

  function locatePostcodeFromModal() {
    const input = modal?.querySelector("[data-w3w-postcode]");
    locatePostcode(input?.value || "");
  }

  async function initMap() {
    const L = await ensureLeaflet();
    const mapHost = modal.querySelector("[data-w3w-map]");

    if (!map) {
      map = L.map(mapHost).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      map.on("click", handleMapClick);
    }

    setTimeout(() => map.invalidateSize(), 50);
  }

  function mainScreenPostcode() {
    return document.querySelector('input[name="postcode"]')?.value?.trim() || "";
  }

  function openModal(textarea) {
    targetTextarea = textarea;
    modal = modal || createModal();
    modal.hidden = false;
    setWords("");
    setStatus("Click the map to drop a pin and generate a 3 word address.");
    modal.querySelector("[data-w3w-map-link]").disabled = true;
    modal.querySelector("[data-w3w-map-link]").dataset.href = "";
    const postcodeInput = modal.querySelector("[data-w3w-postcode]");
    const postcode = mainScreenPostcode();
    if (postcodeInput) postcodeInput.value = postcode;

    initMap()
      .then(() => {
        if (postcode) locatePostcode(postcode);
      })
      .catch((err) => setStatus(err.message || "Could not load map", "error"));
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  function openMapLink() {
    const href = modal?.querySelector("[data-w3w-map-link]")?.dataset.href;
    if (href) window.open(href, "_blank", "noopener");
  }

  function formatMemo(currentMemo, words) {
    const nextLine = `${NOTE_PREFIX} ${words}`;
    const existingPattern = new RegExp(`${NOTE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*.*`, "i");

    if (existingPattern.test(currentMemo)) {
      return currentMemo.replace(existingPattern, nextLine);
    }

    return currentMemo.trim() ? `${currentMemo.trim()}\n${nextLine}` : nextLine;
  }

  function submitWords() {
    if (!targetTextarea || !selectedWords) return;
    targetTextarea.value = formatMemo(targetTextarea.value || "", selectedWords);
    targetTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    targetTextarea.dispatchEvent(new Event("change", { bubbles: true }));
    closeModal();
  }

  function initButtons() {
    document.querySelectorAll("[data-w3w-open]").forEach((button) => {
      if (button.dataset.w3wReady === "true") return;
      button.dataset.w3wReady = "true";
      button.addEventListener("click", () => {
        const textarea = button.closest("label")?.querySelector('textarea[name="memo"]') ||
          document.querySelector('textarea[name="memo"]');
        if (!textarea || textarea.disabled) return;
        openModal(textarea);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initButtons);
  } else {
    initButtons();
  }
})();
