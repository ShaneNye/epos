(function () {
  const state = {
    products: [],
    productById: new Map(),
    selected: null,
    inventoryRows: [],
    inventoryLoaded: false,
    scannerStream: null,
    scannerFrame: 0,
  };

  const el = {};

  document.addEventListener("DOMContentLoaded", () => {
    [
      "productHubRefresh",
      "productHubSearch",
      "productHubSuggestions",
      "productHubScan",
      "productHubResults",
      "productHubStatus",
      "productHubSelected",
      "productHubTabs",
      "productHubInfoTab",
      "productHubStockTab",
      "productHubInfoPanel",
      "productHubStockPanel",
      "productHubInfoBody",
      "productHubStockBody",
      "productHubScanner",
      "productHubScannerClose",
      "productHubVideo",
      "productHubScannerStatus",
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });

    bindEvents();
    loadProducts();
  });

  function bindEvents() {
    el.productHubRefresh?.addEventListener("click", () => loadProducts({ refresh: true }));
    el.productHubSearch?.addEventListener("input", handleSearchInput);
    el.productHubSearch?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      selectBestSearchMatch(el.productHubSearch.value);
    });
    el.productHubScan?.addEventListener("click", startScanner);
    el.productHubScannerClose?.addEventListener("click", stopScanner);
    el.productHubScanner?.addEventListener("close", stopScanner);
    el.productHubInfoTab?.addEventListener("click", () => setActiveTab("info"));
    el.productHubStockTab?.addEventListener("click", () => setActiveTab("stock"));
  }

  async function loadProducts({ refresh = false } = {}) {
    setStatus("Loading product feed...");
    clearResults();
    try {
      const url = `/api/suitepim/web-management${refresh ? "?refresh=1" : ""}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "Product feed failed");

      state.products = (data.rows || []).map((row, index) => ({
        ...row,
        _hubKey: getProductId(row) || `row-${index}`,
        _hubSearch: productSearchText(row),
      }));
      state.productById = new Map(
        state.products
          .map((row) => [getProductId(row), row])
          .filter(([id]) => id)
      );
      populateSuggestions();
      setStatus(`${state.products.length} products ready.`);
    } catch (err) {
      console.error("Product Hub product load failed:", err);
      setStatus(err.message || "Unable to load product feed.");
    }
  }

  function populateSuggestions() {
    if (!el.productHubSuggestions) return;
    el.productHubSuggestions.innerHTML = state.products
      .slice(0, 400)
      .map((row) => `<option value="${escapeHtml(resultLabel(row))}"></option>`)
      .join("");
  }

  function handleSearchInput() {
    const query = clean(el.productHubSearch?.value);
    if (!query) {
      clearResults();
      return;
    }

    const results = findProducts(query, 8);
    renderResults(results, query);
  }

  function findProducts(query, limit = 8) {
    const q = clean(query);
    if (!q) return [];

    const exactId = state.productById.get(q) || state.productById.get(String(query).trim());
    const ranked = [];
    if (exactId) ranked.push({ row: exactId, score: 0 });

    for (const row of state.products) {
      if (exactId === row) continue;
      const id = clean(getProductId(row));
      const name = clean(getProductName(row));
      const text = row._hubSearch || "";
      if (id === q) ranked.push({ row, score: 1 });
      else if (name.startsWith(q)) ranked.push({ row, score: 2 });
      else if (text.includes(q)) ranked.push({ row, score: 3 });
      if (ranked.length > limit * 4) break;
    }

    return ranked
      .sort((a, b) => a.score - b.score || getProductName(a.row).localeCompare(getProductName(b.row)))
      .slice(0, limit)
      .map((entry) => entry.row);
  }

  function renderResults(results, query) {
    if (!el.productHubResults) return;
    if (!results.length) {
      el.productHubResults.innerHTML = `<p class="product-hub-status">No products found for "${escapeHtml(query)}".</p>`;
      return;
    }

    el.productHubResults.innerHTML = results
      .map((row, index) => `
        <button class="product-hub-result" type="button" data-index="${index}">
          <strong>${escapeHtml(getProductName(row))}</strong>
          <span>${escapeHtml(resultMeta(row))}</span>
        </button>
      `)
      .join("");

    el.productHubResults.querySelectorAll(".product-hub-result").forEach((button) => {
      button.addEventListener("click", () => selectProduct(results[Number(button.dataset.index)]));
    });
  }

  function selectBestSearchMatch(value) {
    const raw = String(value || "").trim();
    const idCandidate = raw.match(/\b\d+\b/)?.[0] || raw;
    const exact = state.productById.get(idCandidate);
    if (exact) {
      selectProduct(exact);
      return;
    }

    const match = findProducts(raw, 1)[0];
    if (match) selectProduct(match);
  }

  function selectProduct(row) {
    state.selected = row;
    clearResults();
    if (el.productHubSearch) el.productHubSearch.value = getProductName(row);
    renderSelected(row);
    renderProductInfo(row);
    renderStockLoading();
    setActiveTab("info");
    if (el.productHubTabs) el.productHubTabs.classList.remove("hidden");
    loadInventoryRows().then(() => renderStock(row));
  }

  function renderSelected(row) {
    if (!el.productHubSelected) return;
    el.productHubSelected.classList.remove("is-empty");
    el.productHubSelected.innerHTML = `
      <strong>${escapeHtml(getProductName(row))}</strong>
      <span>${escapeHtml(resultMeta(row))}</span>
    `;
  }

  function renderProductInfo(row) {
    if (!el.productHubInfoBody) return;
    const entries = Object.entries(row)
      .filter(([key, value]) => !key.startsWith("_") && hasDisplayValue(value))
      .sort(([a], [b]) => fieldWeight(a) - fieldWeight(b) || a.localeCompare(b));

    el.productHubInfoBody.innerHTML = entries.length
      ? entries.map(([key, value]) => `
          <tr>
            <td>${escapeHtml(key)}</td>
            <td>${formatValue(value)}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="2">No product fields available.</td></tr>`;
  }

  async function loadInventoryRows() {
    if (state.inventoryLoaded) return;
    try {
      const [balanceRes, numbersRes] = await Promise.all([
        fetch("/api/netsuite/inventorybalance").then((r) => r.json()),
        fetch("/api/netsuite/invoice-numbers").then((r) => r.json()),
      ]);
      if (!balanceRes.ok) throw new Error("Inventory balance fetch failed");
      if (!numbersRes.ok) throw new Error("Inventory numbers fetch failed");
      state.inventoryRows = mergeInventoryRows(
        balanceRes.results || balanceRes.data || [],
        numbersRes.results || numbersRes.data || []
      );
      state.inventoryLoaded = true;
    } catch (err) {
      console.error("Product Hub inventory load failed:", err);
      state.inventoryRows = [];
      state.inventoryLoaded = true;
      throw err;
    }
  }

  function mergeInventoryRows(balanceRows, numberRows) {
    const numberAgg = new Map();
    for (const row of numberRows || []) {
      const itemId = idString(row["Item Id"] || row["Item ID"] || row.itemid);
      const inv = clean(row.Number);
      const loc = clean(row.Location);
      if (!itemId || !inv || !loc) continue;
      const key = `${itemId}||${inv}||${loc}`;
      const existing = numberAgg.get(key) || { available: 0, onHand: 0, itemId, itemName: row.Item || "" };
      existing.available += parseNumber(row.Available);
      existing.onHand += parseNumber(row["On Hand"]);
      numberAgg.set(key, existing);
    }

    const collapsed = new Map();
    for (const row of balanceRows || []) {
      const itemId = idString(row["Item ID"] || row["Item Id"] || row.itemid || row.Item);
      const inv = clean(row["Inventory Number"]);
      const loc = clean(row.Location);
      if (!itemId || !inv || !loc) continue;
      const key = `${itemId}||${inv}||${loc}`;
      if (!collapsed.has(key)) collapsed.set(key, row);
    }

    return Array.from(collapsed.values()).map((row) => {
      const itemId = idString(row["Item ID"] || row["Item Id"] || row.itemid || row.Item);
      const key = `${itemId}||${clean(row["Inventory Number"])}||${clean(row.Location)}`;
      const agg = numberAgg.get(key) || { available: 0, onHand: 0, itemId, itemName: "" };
      return {
        itemId,
        itemName: agg.itemName || row.Name || row.Item || "",
        location: row.Location || "-",
        bin: row["Bin Number"] || row.Bin || row.bin || "-",
        status: row.Status || "-",
        available: agg.available,
        onHand: agg.onHand,
      };
    });
  }

  function renderStockLoading() {
    if (!el.productHubStockBody) return;
    el.productHubStockBody.innerHTML = `<tr><td colspan="4">Loading stock...</td></tr>`;
  }

  function renderStock(row) {
    if (!el.productHubStockBody) return;
    const itemId = getProductId(row);
    const grouped = new Map();

    state.inventoryRows
      .filter((stock) => idString(stock.itemId) === idString(itemId))
      .forEach((stock) => {
        const available = parseNumber(stock.available);
        if (available <= 0) return;
        const key = `${clean(stock.location)}||${clean(stock.bin)}||${clean(stock.status)}`;
        const existing = grouped.get(key) || {
          location: stock.location || "-",
          bin: stock.bin || "-",
          status: stock.status || "-",
          available: 0,
        };
        existing.available += available;
        grouped.set(key, existing);
      });

    const rows = Array.from(grouped.values()).sort((a, b) =>
      clean(a.location).localeCompare(clean(b.location)) ||
      clean(a.bin).localeCompare(clean(b.bin)) ||
      clean(a.status).localeCompare(clean(b.status))
    );

    el.productHubStockBody.innerHTML = rows.length
      ? rows.map((stock) => `
          <tr>
            <td>${escapeHtml(stock.location)}</td>
            <td>${escapeHtml(stock.bin)}</td>
            <td>${escapeHtml(stock.status)}</td>
            <td class="align-right">${stock.available}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="4">No available stock found for this item.</td></tr>`;
  }

  async function startScanner() {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      setStatus("Barcode scanning is not available in this browser. Type or paste the internal ID instead.");
      return;
    }

    try {
      el.productHubScanner?.showModal();
      el.productHubScannerStatus.textContent = "Starting camera...";
      state.scannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      el.productHubVideo.srcObject = state.scannerStream;
      await el.productHubVideo.play();
      const detector = new BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code"] });
      scanLoop(detector);
    } catch (err) {
      console.error("Product Hub scanner failed:", err);
      el.productHubScannerStatus.textContent = "Camera could not be started. Check browser permissions.";
    }
  }

  async function scanLoop(detector) {
    if (!state.scannerStream) return;
    try {
      const codes = await detector.detect(el.productHubVideo);
      const rawValue = codes?.[0]?.rawValue;
      if (rawValue) {
        const internalId = String(rawValue).match(/\b\d+\b/)?.[0] || rawValue;
        stopScanner();
        if (el.productHubSearch) el.productHubSearch.value = internalId;
        selectBestSearchMatch(internalId);
        return;
      }
      el.productHubScannerStatus.textContent = "Point the camera at the internal ID barcode.";
    } catch {
      el.productHubScannerStatus.textContent = "Looking for a barcode...";
    }
    state.scannerFrame = window.requestAnimationFrame(() => scanLoop(detector));
  }

  function stopScanner() {
    if (state.scannerFrame) window.cancelAnimationFrame(state.scannerFrame);
    state.scannerFrame = 0;
    if (state.scannerStream) {
      state.scannerStream.getTracks().forEach((track) => track.stop());
      state.scannerStream = null;
    }
    if (el.productHubVideo) el.productHubVideo.srcObject = null;
    if (el.productHubScanner?.open) el.productHubScanner.close();
  }

  function setActiveTab(tab) {
    const isStock = tab === "stock";
    el.productHubInfoTab?.classList.toggle("active", !isStock);
    el.productHubStockTab?.classList.toggle("active", isStock);
    el.productHubInfoTab?.setAttribute("aria-selected", String(!isStock));
    el.productHubStockTab?.setAttribute("aria-selected", String(isStock));
    el.productHubInfoPanel?.classList.toggle("active", !isStock);
    el.productHubStockPanel?.classList.toggle("active", isStock);
  }

  function getProductId(row) {
    return idString(row?.["Internal ID"] || row?.internalid || row?.InternalID || row?.id || row?.["Item ID"]);
  }

  function getProductName(row) {
    return String(row?.Name || row?.name || row?.["Display Name"] || row?.displayname || row?.itemid || getProductId(row) || "Unnamed product");
  }

  function resultMeta(row) {
    const parts = [
      getProductId(row) ? `ID ${getProductId(row)}` : "",
      row?.["Display Name"] && row["Display Name"] !== row.Name ? row["Display Name"] : "",
      row?.Class || row?.class || "",
      row?.Size || "",
    ].filter(Boolean);
    return parts.join(" - ");
  }

  function resultLabel(row) {
    return `${getProductName(row)} ${getProductId(row)}`.trim();
  }

  function productSearchText(row) {
    const keys = [
      "Internal ID",
      "internalid",
      "Item ID",
      "Name",
      "Display Name",
      "Web SKU",
      "SKU",
      "EAN/GTIN",
      "UPC Code",
      "Class",
      "Size",
      "Supplier Name",
    ];
    return clean(keys.map((key) => stringifyValue(row?.[key])).join(" "));
  }

  function fieldWeight(key) {
    const order = ["Internal ID", "Name", "Display Name", "Web SKU", "EAN/GTIN", "Class", "Size", "Base Price", "Lead Time"];
    const index = order.indexOf(key);
    return index === -1 ? 100 : index;
  }

  function hasDisplayValue(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return String(value).trim() !== "";
  }

  function formatValue(value) {
    if (Array.isArray(value)) return escapeHtml(value.map(stringifyValue).filter(Boolean).join(", "));
    if (value && typeof value === "object") return escapeHtml(stringifyValue(value));
    return escapeHtml(value);
  }

  function stringifyValue(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(stringifyValue).filter(Boolean).join(", ");
    if (typeof value === "object") return value.text || value.name || value.value || value.id || JSON.stringify(value);
    return String(value);
  }

  function setStatus(message) {
    if (el.productHubStatus) el.productHubStatus.textContent = message;
  }

  function clearResults() {
    if (el.productHubResults) el.productHubResults.innerHTML = "";
  }

  function clean(value) {
    return String(value || "").trim().toLowerCase();
  }

  function idString(value) {
    return String(value || "").trim();
  }

  function parseNumber(value) {
    const parsed = Number.parseFloat(String(value ?? "0").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
