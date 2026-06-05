(function () {
  const state = {
    products: [],
    productById: new Map(),
    selected: null,
    inventoryRows: [],
    inventoryLoaded: false,
    googleConnected: false,
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
    const imageUrl = productImageUrl(row);
    const retailPrice = formatCurrency(row["Retail Price"] || row.retailPrice);
    const salePrice = formatCurrency(row["Sale Price"] || row.salePrice);
    const discount = formatPercent(row["Discount Percent"] || row.discountPercent);
    const meta = [
      getProductId(row) ? `Internal ID ${getProductId(row)}` : "",
      stringifyValue(row["Lead Time"] || row.leadTime),
    ].filter(Boolean);
    const detailRows = productDetailRows(row);

    el.productHubInfoBody.innerHTML = `
      <article class="product-hub-commerce">
        <div class="product-hub-media">
          ${
            imageUrl
              ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(getProductName(row))}" loading="lazy" decoding="async">`
              : `<div class="product-hub-image-fallback">No image</div>`
          }
        </div>
        <div class="product-hub-commerce-copy">
          <p class="product-hub-product-meta">${escapeHtml(meta.join(" - "))}</p>
          <h2>${escapeHtml(getProductName(row))}</h2>
          <div class="product-hub-price-row" aria-label="Product pricing">
            ${priceTile("Retail", retailPrice || "-")}
            ${priceTile("Sale", salePrice || "-")}
            ${priceTile("Discount", discount || "-")}
          </div>
        </div>
      </article>

      <section class="product-hub-detail-card" aria-label="Product details">
        <div class="product-hub-table-scroll">
          <table class="product-hub-table product-hub-detail-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              ${
                detailRows.length
                  ? detailRows.map(([key, value]) => `
                      <tr>
                        <td>${escapeHtml(key)}</td>
                        <td>${formatDetailValue(value)}</td>
                      </tr>
                    `).join("")
                  : `<tr><td colspan="2">No product details available.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
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
        lotNumber: row["Inventory Number"] || row.inventoryNumber || "-",
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
    el.productHubStockBody.innerHTML = `<tr><td colspan="6">Loading stock...</td></tr>`;
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
        const key = `${clean(stock.location)}||${clean(stock.lotNumber)}||${clean(stock.bin)}||${clean(stock.status)}`;
        const existing = grouped.get(key) || {
          key,
          location: stock.location || "-",
          lotNumber: stock.lotNumber || "-",
          bin: stock.bin || "-",
          status: stock.status || "-",
          available: 0,
        };
        existing.available += available;
        grouped.set(key, existing);
      });

    const rows = Array.from(grouped.values()).sort((a, b) =>
      clean(a.location).localeCompare(clean(b.location)) ||
      clean(a.lotNumber).localeCompare(clean(b.lotNumber)) ||
      clean(a.bin).localeCompare(clean(b.bin)) ||
      clean(a.status).localeCompare(clean(b.status))
    );

    el.productHubStockBody.innerHTML = rows.length
      ? rows.map((stock) => `
          <tr>
            <td>${escapeHtml(stock.location)}</td>
            <td>${escapeHtml(stock.lotNumber)}</td>
            <td>${escapeHtml(stock.bin)}</td>
            <td>${escapeHtml(stock.status)}</td>
            <td class="align-right">${stock.available}</td>
            <td class="product-hub-stock-action">
              <button class="product-hub-send-stock" type="button" title="Send stock row to Google Chat" aria-label="Send stock row to Google Chat" data-stock-key="${escapeHtml(stock.key)}">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M22 2 11 13"></path>
                  <path d="M22 2 15 22l-4-9-9-4 20-7z"></path>
                </svg>
              </button>
            </td>
          </tr>
        `).join("")
      : `<tr><td colspan="6">No available stock found for this item.</td></tr>`;

    if (rows.length) {
      const rowByKey = new Map(rows.map((stock) => [stock.key, stock]));
      el.productHubStockBody.querySelectorAll(".product-hub-send-stock").forEach((button) => {
        button.addEventListener("click", () => {
          const stock = rowByKey.get(button.dataset.stockKey);
          if (stock) sendStockRowToChat(button, stock);
        });
      });
    }
  }

  async function sendStockRowToChat(button, stock) {
    const connected = await ensureGoogleConnected();
    if (!connected) return;

    const saved = typeof storageGet === "function" ? storageGet() : null;
    const originalTitle = button.title;
    button.disabled = true;
    button.classList.add("is-sending");
    button.title = "Sending...";

    try {
      const res = await fetch("/api/google/self-message", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
        },
        body: JSON.stringify({ message: stockChatMessage(stock) }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.ok === false) {
        if (data.code === "GOOGLE_NOT_CONNECTED" || data.code === "GOOGLE_RECONNECT_REQUIRED") {
          state.googleConnected = false;
        }
        throw new Error(data.error || "Could not send the stock row to Google Chat.");
      }

      button.classList.remove("is-sending");
      button.classList.add("is-sent");
      button.title = "Sent";
      setStatus("Stock row sent to your Google Chat.");
      setTimeout(() => {
        button.classList.remove("is-sent");
        button.disabled = false;
        button.title = originalTitle;
      }, 1800);
    } catch (err) {
      console.error("Product Hub Google Chat send failed:", err);
      button.classList.remove("is-sending");
      button.disabled = false;
      button.title = originalTitle;
      alert(err.message || "Could not send the stock row to Google Chat.");
    }
  }

  function stockChatMessage(stock) {
    const productName = getProductName(state.selected);
    const itemId = getProductId(state.selected);
    return [
      "Product Hub stock row",
      productName ? `Item: ${productName}` : "",
      itemId ? `Internal ID: ${itemId}` : "",
      `Location: ${stock.location || "-"}`,
      `Bin: ${stock.bin || "-"}`,
      `Lot: ${stock.lotNumber || "-"}`,
      `Status: ${stock.status || "-"}`,
      `Available: ${stock.available ?? "-"}`,
    ].filter(Boolean).join("\n");
  }

  async function fetchGoogleStatus() {
    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const res = await fetch("/api/google/status", {
        cache: "no-store",
        headers: saved?.token ? { Authorization: `Bearer ${saved.token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      state.googleConnected = Boolean(res.ok && data.ok && data.connected);
      return state.googleConnected;
    } catch {
      state.googleConnected = false;
      return false;
    }
  }

  async function connectGoogle() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    if (!saved?.token) {
      alert("Please sign in again before connecting Google.");
      return false;
    }

    const res = await fetch(`/api/google/auth?format=json&returnTo=${encodeURIComponent(window.location.pathname)}`, {
      headers: { Authorization: `Bearer ${saved.token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false || !data.url) {
      alert(data.error || "Could not start Google connection.");
      return false;
    }

    return new Promise((resolve) => {
      const popup = window.open(data.url, "GoogleConnect", "width=520,height=720,resizable=yes,scrollbars=yes");
      if (!popup) {
        alert("Please allow pop-ups to connect Google.");
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(false);
      }, 2 * 60 * 1000);

      function onMessage(event) {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== "google-auth-complete") return;
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        popup.close();
        fetchGoogleStatus().then(resolve);
      }

      window.addEventListener("message", onMessage);
    });
  }

  async function ensureGoogleConnected() {
    if (state.googleConnected) return true;
    if (await fetchGoogleStatus()) return true;

    const shouldConnect = confirm("Connect your Google account to send this stock row to yourself in Google Chat?");
    if (!shouldConnect) return false;
    return connectGoogle();
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

  function priceTile(label, value) {
    return `
      <div class="product-hub-price-tile">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function productImageUrl(row) {
    const fields = [
      "Item Image",
      "Catalogue Image One",
      "Catalogue Image Two",
      "Catalogue Image Three",
      "Catalogue Image Four",
      "Catalogue Image Five",
      "imageUrl",
      "Image URL",
      "Image",
    ];
    const raw = fields.map((field) => extractImageUrl(row?.[field])).find(Boolean);
    return proxiedImageUrl(raw);
  }

  function productDetailRows(row) {
    const excluded = new Set([
      "Catalogue Image One",
      "Catalogue Image Two",
      "Catalogue Image Three",
      "Catalogue Image Four",
      "Catalogue Image Five",
      "Item Image",
      "Description Preview",
      "Detailed Description",
      "storedetaileddescription",
      "category_internalid",
      "Short Description",
      "imageUrl",
      "Image URL",
      "Image",
    ]);

    return Object.entries(row || {})
      .filter(([key, value]) => !key.startsWith("_") && !excluded.has(key) && hasDisplayValue(value))
      .sort(([a], [b]) => fieldWeight(a) - fieldWeight(b) || a.localeCompare(b));
  }

  function fieldWeight(key) {
    const order = [
      "Internal ID",
      "Name",
      "Display Name",
      "Retail Price",
      "Sale Price",
      "Discount Percent",
      "Web SKU",
      "EAN/GTIN",
      "Class",
      "Size",
      "Lead Time",
    ];
    const index = order.indexOf(key);
    return index === -1 ? 100 : index;
  }

  function hasDisplayValue(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return String(value).trim() !== "";
  }

  function formatDetailValue(value) {
    if (Array.isArray(value)) return escapeHtml(value.map(stringifyValue).filter(Boolean).join(", "));
    if (value && typeof value === "object") return escapeHtml(stringifyValue(value));
    return escapeHtml(value);
  }

  function extractImageUrl(value) {
    if (!value) return "";
    if (Array.isArray(value)) return value.map(extractImageUrl).find(Boolean) || "";
    if (typeof value === "object") {
      return extractImageUrl(
        value.url ||
        value.URL ||
        value.src ||
        value.Source ||
        value.image ||
        value.Image ||
        value.imageUrl ||
        value.thumbnail ||
        value.Thumbnail ||
        value.name ||
        value.text ||
        value.value ||
        value.refName ||
        ""
      );
    }

    const text = String(value || "").trim();
    const imgMatch = text.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch?.[1]) return imgMatch[1].replace(/&amp;/g, "&");

    const hrefMatch = text.match(/<a[^>]+href=["']([^"']+)["']/i);
    if (hrefMatch?.[1]) return hrefMatch[1].replace(/&amp;/g, "&");

    const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (urlMatch?.[0]) return urlMatch[0].replace(/&amp;/g, "&");

    return "";
  }

  function proxiedImageUrl(url) {
    const imageUrl = String(url || "").trim();
    if (!imageUrl) return "";

    try {
      const parsed = new URL(imageUrl, window.location.origin);
      const isNetSuiteMedia =
        /\.netsuite\.com$/i.test(parsed.hostname) &&
        /\/core\/media\/media\.nl$/i.test(parsed.pathname);
      if (isNetSuiteMedia) {
        return `/api/suitepim/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
      }
      return parsed.toString();
    } catch {
      return imageUrl;
    }
  }

  function formatCurrency(value) {
    const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(parsed)) return "";
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: parsed % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(parsed);
  }

  function formatPercent(value) {
    const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(parsed)) return "";
    return `${parsed.toFixed(parsed % 1 === 0 ? 0 : 1)}%`;
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
