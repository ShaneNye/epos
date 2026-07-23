document.addEventListener("DOMContentLoaded", () => {
  const locationSelect = document.getElementById("qrLocation");
  const binSelect = document.getElementById("qrBin");
  const generateButton = document.getElementById("generateQr");
  const status = document.getElementById("qrGeneratorStatus");
  const saved = typeof storageGet === "function" ? storageGet() : null;
  const headers = { Authorization: `Bearer ${saved?.token || ""}` };
  let locations = [];

  async function json(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
    return data;
  }

  async function loadLocations() {
    try {
      const data = await json("/api/meta/locations");
      locations = data.locations || [];
      locationSelect.innerHTML = '<option value="">Select a location</option>' +
        locations.map((location) => `<option value="${location.id}">${location.name}</option>`).join("");
    } catch (error) {
      status.textContent = error.message;
      status.dataset.tone = "error";
    }
  }

  locationSelect.addEventListener("change", async () => {
    const location = locations.find((item) => String(item.id) === locationSelect.value);
    binSelect.disabled = true;
    generateButton.disabled = true;
    binSelect.innerHTML = "<option>Loading bins…</option>";
    if (!location) return;
    try {
      const data = await json(
        `/api/qr-journeys/inventory?locationId=${encodeURIComponent(location.id)}&location=${encodeURIComponent(location.name)}`
      );
      const bins = data.bins || [];
      binSelect.innerHTML = '<option value="">Select a bin</option>' +
        bins.map((bin) => `<option value="${bin.replace(/"/g, "&quot;")}">${bin}</option>`).join("");
      binSelect.disabled = !bins.length;
      if (!bins.length) status.textContent = "No stocked bins were found at this location.";
    } catch (error) {
      status.textContent = error.message;
      status.dataset.tone = "error";
    }
  });

  binSelect.addEventListener("change", () => { generateButton.disabled = !binSelect.value; });

  generateButton.addEventListener("click", async () => {
    const location = locations.find((item) => String(item.id) === locationSelect.value);
    const bin = binSelect.value;
    status.textContent = "Preparing products and generating QR code…";
    status.dataset.tone = "";
    generateButton.disabled = true;
    try {
      const inventoryData = await json(
        `/api/qr-journeys/inventory?locationId=${encodeURIComponent(location.id)}&location=${encodeURIComponent(location.name)}&bin=${encodeURIComponent(bin)}`
      );
      const products = inventoryData.products || [];
      const data = await json("/api/qr-journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: location.id, locationName: location.name, binName: bin, products }),
      });
      document.getElementById("qrResultTitle").textContent = `${location.name} · ${bin}`;
      const link = document.getElementById("qrJourneyUrl");
      link.href = data.url;
      link.textContent = data.url;
      document.getElementById("qrImage").src = data.qrDataUrl;
      document.getElementById("qrResult").hidden = false;
      document.getElementById("downloadQr").onclick = () => {
        const anchor = document.createElement("a");
        anchor.href = data.qrDataUrl;
        anchor.download = `${location.name}-${bin}-finance-qr.png`.replace(/[^a-z0-9.-]+/gi, "-");
        anchor.click();
      };
      document.getElementById("copyQrLink").onclick = () => navigator.clipboard.writeText(data.url);
      status.textContent = "QR code generated.";
      status.dataset.tone = "success";
    } catch (error) {
      status.textContent = error.message;
      status.dataset.tone = "error";
    } finally {
      generateButton.disabled = false;
    }
  });

  loadLocations();
});
