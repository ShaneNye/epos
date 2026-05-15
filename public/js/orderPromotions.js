(function () {
  const state = {
    promotions: { upsells: [], basketDiscounts: [] },
    webItemsById: new Map(),
    kioskItemsById: new Map(),
    kioskItemsByName: new Map(),
    sizeOptions: [],
    ready: false,
    syncing: false,
    syncTimer: null,
    spareLineTimer: null,
    missingBasketItems: [],
    stockByItemId: new Map(),
    stockLoading: new Set(),
    inventoryStatuses: null,
    invoiceNumbers: null,
    initialized: false,
    dismissedStockAlternatives: new Set(),
  };

  function money(value) {
    const amount = Number(value || 0);
    return `£${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getAuthHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  function itemId(item) {
    return String(
      item?.["Internal ID"] ??
      item?.["InternalId"] ??
      item?.["InternalID"] ??
      item?.internalid ??
      item?.id ??
      ""
    ).trim();
  }

  function itemName(item) {
    return String(item?.Name || item?.name || "Unnamed item").trim();
  }

  function itemClass(item) {
    return String(item?.Class || item?.class || "").trim();
  }

  function splitValues(value) {
    if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
    return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  function itemSizes(item) {
    const webItem = webItemForItem(item);
    const explicitSizes = splitValues(
      webItem["Standard-Sizes"] ||
      webItem["Standard Sizes"] ||
      webItem.Size ||
      item?.["Standard-Sizes"] ||
      item?.["Standard Sizes"] ||
      item?.Size ||
      item?.size ||
      ""
    );
    if (explicitSizes.length) return explicitSizes;

    const name = clean(itemName(item));
    return state.sizeOptions.filter((size) => itemNameMatchesSize(name, size));
  }

  function itemCategories(item) {
    const webItem = webItemForItem(item);
    return splitValues(webItem.Category || item?.Category || item?.category || item?.Categories || item?.["Web Category"] || "");
  }

  function webItemForItem(item) {
    const id = itemId(item);
    if (id && state.webItemsById.has(id)) return state.webItemsById.get(id);

    const name = clean(itemName(item));
    if (!name) return {};

    for (const row of state.webItemsById.values()) {
      const rowName = clean(fieldValue(row, ["Name", "Item Name", "itemName", "name"]));
      if (rowName && rowName === name) return row;
    }

    return {};
  }

  function kioskItemForItem(item) {
    const id = itemId(item);
    if (id && state.kioskItemsById.has(id)) return state.kioskItemsById.get(id);

    const name = clean(itemName(item));
    if (name && state.kioskItemsByName.has(name)) return state.kioskItemsByName.get(name);

    return {};
  }

  function fieldValue(record, names) {
    if (!record) return "";
    for (const name of names) {
      if (record[name] !== undefined && record[name] !== null && record[name] !== "") return record[name];
    }

    const wanted = names.map((name) => clean(name).replace(/[^a-z0-9]/g, ""));
    const key = Object.keys(record).find((entry) => wanted.includes(clean(entry).replace(/[^a-z0-9]/g, "")));
    return key ? record[key] : "";
  }

  function extractImageUrl(value) {
    if (!value) return "";

    if (Array.isArray(value)) {
      return value.map(extractImageUrl).find(Boolean) || "";
    }

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

  function imageLikeValues(record) {
    if (!record || typeof record !== "object") return [];
    return Object.entries(record)
      .filter(([key, value]) => {
        const normalized = clean(key);
        return value && (normalized.includes("image") || normalized.includes("thumbnail") || normalized.includes("catalogue"));
      })
      .map(([, value]) => value);
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
    } catch {
      return imageUrl;
    }

    return imageUrl;
  }

  function imageUrlVariants(value) {
    const image = extractImageUrl(value);
    if (!image) return [];

    const proxied = proxiedImageUrl(image);
    return [image, proxied].filter((entry, index, list) => entry && list.indexOf(entry) === index);
  }

  function uniqueImages(values) {
    const seen = new Set();
    const images = [];

    values.forEach((value) => {
      imageUrlVariants(value).forEach((url) => {
        if (seen.has(url)) return;
        seen.add(url);
        images.push(url);
      });
    });

    return images;
  }

  function itemImages(item) {
    const webItem = webItemForItem(item);
    const kioskItem = kioskItemForItem(item);
    return uniqueImages([
      fieldValue(kioskItem, ["Item Image", "ItemImage", "itemImage", "image", "Image", "Image URL", "imageUrl"]),
      ...imageLikeValues(kioskItem),
      fieldValue(item, ["Item Image", "ItemImage", "itemImage", "image", "Image", "Image URL", "imageUrl"]),
      fieldValue(webItem, [
        "Item Image",
        "ItemImage",
        "itemImage",
        "Catalogue Image One",
        "Catalogue Image Two",
        "Catalogue Image Three",
        "Catalogue Image Four",
        "Catalogue Image Five",
        "image",
        "Image",
        "Image URL",
        "imageUrl",
      ]),
      ...imageLikeValues(item),
      ...imageLikeValues(webItem),
    ]);
  }

  function itemImage(item) {
    return itemImages(item)[0] || "";
  }

  function imageMarkup(images, alt, fallbackText) {
    const urls = Array.isArray(images) ? images.filter(Boolean) : [];
    if (!urls.length) return `<span>${escapeHtml(fallbackText)}</span>`;

    return `<img src="${escapeHtml(urls[0])}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" data-fallback-srcs="${escapeHtml(JSON.stringify(urls))}" data-fallback-text="${escapeHtml(fallbackText)}">`;
  }

  window.orderPromotionsImageFallback = function (img) {
    if (!img) return;

    let urls = [];
    try {
      urls = JSON.parse(img.dataset.fallbackSrcs || "[]");
    } catch {
      urls = [];
    }

    const nextIndex = Number(img.dataset.fallbackIndex || 0) + 1;
    if (urls[nextIndex]) {
      img.dataset.fallbackIndex = String(nextIndex);
      img.src = urls[nextIndex];
      return;
    }

    const parent = img.closest(".order-upsell-thumb");
    if (parent) {
      parent.innerHTML = `<span>${escapeHtml(img.dataset.fallbackText || "EP")}</span>`;
    }
  };

  function bindImageFallbacks(root) {
    root?.querySelectorAll("img[data-fallback-srcs]").forEach((img) => {
      if (img.__orderPromotionFallbackBound) return;
      img.__orderPromotionFallbackBound = true;
      img.addEventListener("error", () => window.orderPromotionsImageFallback(img));
    });
  }

  function retailPrice(item) {
    const raw = Number(item?.["Base Price"] || 0);
    if (!Number.isFinite(raw)) return 0;
    const gross = raw > 10000 ? (raw / 100) * 120 : raw * 1.2;
    return Number.isFinite(gross) ? gross : 0;
  }

  function discountAmountForRule(rule, subtotal, item) {
    const type = String(rule?.discountType || "item_price").trim().toLowerCase();
    const value = Number(rule?.discountValue || 0);
    let amount = 0;

    if (type === "percentage") {
      amount = subtotal * Math.max(0, Math.min(100, value)) / 100;
    } else if (type === "fixed") {
      amount = Math.max(0, value);
    } else {
      amount = Math.max(0, retailPrice(item));
    }

    return Number((Number.isFinite(amount) ? amount : 0).toFixed(2));
  }

  function allItems() {
    return Array.isArray(window.items) ? window.items : [];
  }

  function findItemById(id) {
    const target = String(id || "").trim();
    if (!target) return null;
    return allItems().find((item) => itemId(item) === target) || null;
  }

  function findItemByName(name) {
    const target = String(name || "").trim().toLowerCase();
    if (!target) return null;
    return allItems().find((item) => itemName(item).toLowerCase() === target) || null;
  }

  function getEditor() {
    return window.salesNewItemEditor || window.quoteNewItemEditor || null;
  }

  function recalcTotals() {
    if (typeof window.updateOrderSummary === "function") return window.updateOrderSummary();
    if (typeof window.updateQuoteSummary === "function") return window.updateQuoteSummary();
  }

  function rows() {
    return [...document.querySelectorAll("#orderItemsBody .order-line")];
  }

  function isPromotionRow(row) {
    if (row?.dataset?.promotionKind === "basket_discount") return true;
    const id = String(row?.querySelector(".item-internal-id")?.value || "").trim();
    if (!id) return false;
    return (state.promotions.basketDiscounts || []).some((promotion) =>
      (promotion.rules || []).some((rule) => String(rule.itemId || "").trim() === id)
    );
  }

  function hasItem(row) {
    return !!String(row?.querySelector(".item-internal-id")?.value || "").trim();
  }

  function lineData(row) {
    const id = String(row.querySelector(".item-internal-id")?.value || "").trim();
    const name = String(row.querySelector(".item-search")?.value || "").trim();
    const klass = String(row.dataset.itemClass || "").trim();
    const quantity = Number(row.querySelector(".item-qty")?.value || 0);
    const salePrice = Number(row.querySelector(".item-saleprice")?.value || 0);
    const item = findItemById(id) || findItemByName(name) || {};
    return {
      row,
      id,
      name,
      klass: klass || itemClass(item),
      quantity,
      salePrice,
      sizes: itemSizes(item).map(clean),
      categories: itemCategories(item).map(clean),
    };
  }

  function manualLines() {
    return rows().filter((row) => hasItem(row) && !isPromotionRow(row)).map(lineData);
  }

  function isWarehouseLine(row) {
    const select = row?.querySelector(".item-fulfilment");
    const text = clean(select?.options?.[select.selectedIndex]?.textContent || "");
    const value = String(select?.value || "").trim();
    return text.includes("warehouse") || value === "2";
  }

  function lineInventoryStatuses(row) {
    const statuses = [];
    const rawParts = [
      row?.dataset?.inventoryMetaJson || "",
      row?.dataset?.inventoryMeta || "",
      row?.dataset?.invdetail || "",
      row?.querySelector(".item-inv-detail")?.value || "",
      row?.querySelector(".inventory-cell")?.textContent || "",
    ].filter(Boolean);

    rawParts.forEach((raw) => {
      const text = String(raw || "").trim();
      if (!text) return;

      if (text.startsWith("[") || text.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          entries.forEach((entry) => {
            if (entry?.statusName) statuses.push(String(entry.statusName));
            if (entry?.status) statuses.push(String(entry.status));
          });
          return;
        } catch {
          // Fall through to pipe parsing.
        }
      }

      text.split(";").forEach((part) => {
        const tokens = part.split("|");
        if (tokens[3]) statuses.push(tokens[3]);
      });

      if (text.toLowerCase().includes("clearance")) {
        statuses.push("clearance");
      }
    });

    return statuses.map(clean).filter(Boolean);
  }

  function isWarehouseClearanceLine(line) {
    const statuses = lineInventoryStatuses(line.row);
    return isWarehouseLine(line.row) && statuses.some((status) => status.includes("clearance"));
  }

  function subtotalForBasketRules(promotion, rule = {}) {
    const excludeClearance = promotion?.excludeClearance === true;
    const includeServices = rule?.includeServices !== false;
    return manualLines().reduce((sum, line) => {
      if (excludeClearance && isWarehouseClearanceLine(line)) return sum;
      if (!includeServices && String(line.klass || "").toLowerCase() === "service") return sum;
      return sum + Number(line.salePrice || 0);
    }, 0);
  }

  function desiredBasketLines() {
    const desired = [];
    const missing = [];

    (state.promotions.basketDiscounts || []).forEach((promotion) => {
      const rule = (promotion.rules || []).find((entry) => {
        const subtotal = subtotalForBasketRules(promotion, entry);
        const min = Number(entry.minValue || 0);
        const max = Number(entry.maxValue || 0);
        return entry.autoApply === true && subtotal >= min && subtotal <= max;
      });

      if (!rule) return;
      const subtotal = subtotalForBasketRules(promotion, rule);

      const item = findItemById(rule.itemId) || findItemByName(rule.itemName);
      if (!item) {
        missing.push(rule.itemName || rule.itemId || promotion.title);
        return;
      }

      const discountAmount = discountAmountForRule(rule, subtotal, item);
      if (!(discountAmount > 0)) return;

      desired.push({
        promotion,
        rule,
        item,
        discountAmount,
        signature: `${promotion.id}:${itemId(item)}:${String(rule.discountType || "item_price")}:${discountAmount.toFixed(2)}`,
      });
    });

    state.missingBasketItems = missing;
    return desired;
  }

  function desiredManualBasketLine(row) {
    const rowItemId = String(row?.querySelector(".item-internal-id")?.value || "").trim();
    if (!rowItemId) return null;

    for (const promotion of state.promotions.basketDiscounts || []) {
      const rule = (promotion.rules || []).find((entry) => {
        const subtotal = subtotalForBasketRules(promotion, entry);
        const min = Number(entry.minValue || 0);
        const max = Number(entry.maxValue || 0);
        return (
          entry.autoApply !== true &&
          String(entry.itemId || "").trim() === rowItemId &&
          subtotal >= min &&
          subtotal <= max
        );
      });

      if (!rule) continue;
      const subtotal = subtotalForBasketRules(promotion, rule);

      const item = findItemById(rule.itemId) || findItemByName(rule.itemName);
      const discountAmount = discountAmountForRule(rule, subtotal, item || {});
      if (!(discountAmount > 0)) return null;

      return {
        promotion,
        rule,
        item: item || {},
        discountAmount,
        signature: `${promotion.id}:${rowItemId}:${String(rule.discountType || "item_price")}:${discountAmount.toFixed(2)}`,
      };
    }

    return null;
  }

  function firstBlankRow() {
    return rows().find((row) => !hasItem(row));
  }

  function getOrCreateRow() {
    const editor = getEditor();
    let row = firstBlankRow();
    if (!row && editor?.addNewRow) {
      editor.addNewRow();
      row = firstBlankRow() || rows().at(-1);
    }
    return row || null;
  }

  function ensureBlankRow() {
    clearTimeout(state.spareLineTimer);
    state.spareLineTimer = setTimeout(() => {
      const editor = getEditor();
      if (!firstBlankRow() && editor?.addNewRow) editor.addNewRow();
    }, 150);
  }

  function markBasketRow(row, desired) {
    row.dataset.promotionKind = "basket_discount";
    row.dataset.promotionId = String(desired.promotion.id || "");
    row.dataset.promotionSignature = desired.signature;
    row.dataset.promotionAutoApply = "1";
    row.classList.add("promotion-auto-line");

    const search = row.querySelector(".item-search");
    const qty = row.querySelector(".item-qty");
    const discount = row.querySelector(".item-discount");
    const salePrice = row.querySelector(".item-saleprice");
    const deleteBtn = row.querySelector(".delete-row");

    if (search) {
      search.readOnly = true;
      search.title = desired.promotion.title || "Basket promotion";
    }
    if (qty) qty.readOnly = true;
    if (discount) discount.readOnly = true;
    if (salePrice) salePrice.readOnly = true;
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.title = "Automatic basket promotion";
    }
  }

  function markManualBasketRow(row, desired) {
    row.dataset.promotionKind = "basket_discount";
    row.dataset.promotionId = String(desired.promotion.id || "");
    row.dataset.promotionSignature = desired.signature;
    row.dataset.promotionAutoApply = "0";
    row.classList.remove("promotion-auto-line");

    const salePrice = row.querySelector(".item-saleprice");
    if (salePrice) {
      salePrice.readOnly = true;
      salePrice.title = desired.promotion.title || "Manual promotion";
    }
  }

  function clearManualBasketRow(row) {
    if (row.dataset.promotionAutoApply !== "0") return;

    delete row.dataset.promotionKind;
    delete row.dataset.promotionId;
    delete row.dataset.promotionSignature;
    delete row.dataset.promotionAutoApply;
    delete row.dataset.promotionDiscountAmount;

    const salePrice = row.querySelector(".item-saleprice");
    if (salePrice) {
      salePrice.readOnly = false;
      salePrice.title = "";
    }
  }

  function setPromotionLineAmount(row, grossDiscountAmount) {
    const discountAmount = Math.abs(Number(grossDiscountAmount || 0));
    if (!(discountAmount > 0)) return;

    const signedGross = -Number(discountAmount.toFixed(2));
    const signedNet = Number((signedGross / 1.2).toFixed(6));
    const amount = row.querySelector(".item-amount");
    const base = row.querySelector(".item-baseprice");
    const sale = row.querySelector(".item-saleprice");
    const discount = row.querySelector(".item-discount");
    const qty = row.querySelector(".item-qty");

    if (qty) qty.value = "1";
    if (amount) {
      amount.value = signedGross.toFixed(2);
      amount.dataset.unitRetail = signedGross.toFixed(2);
    }
    if (base) base.value = signedNet.toFixed(6);
    if (sale) sale.value = signedGross.toFixed(2);
    if (discount) discount.value = "0";

    row.dataset.promotionDiscountAmount = discountAmount.toFixed(2);
  }

  function applyDesiredLine(row, desired) {
    const editor = getEditor();
    if (!editor?.applyItemToRow) return false;

    editor.applyItemToRow(row, desired.item, {
      quantity: 1,
      salePrice: -Math.abs(desired.discountAmount),
      promotionMeta: {
        kind: "basket_discount",
        promotionId: desired.promotion.id,
        promotionTitle: desired.promotion.title,
      },
    });
    setPromotionLineAmount(row, desired.discountAmount);
    markBasketRow(row, desired);
    return true;
  }

  function applyManualBasketDiscounts() {
    rows()
      .filter((row) => hasItem(row) && !row.classList.contains("promotion-auto-line"))
      .forEach((row) => {
        const desired = desiredManualBasketLine(row);
        if (!desired) {
          clearManualBasketRow(row);
          return;
        }
        setPromotionLineAmount(row, desired.discountAmount);
        markManualBasketRow(row, desired);
      });
  }

  function syncBasketDiscounts() {
    if (state.syncing || !state.ready) return;
    state.syncing = true;

    try {
      const desired = desiredBasketLines();
      const desiredBySignature = new Map(desired.map((line) => [line.signature, line]));

      applyManualBasketDiscounts();

      rows()
        .filter((row) => isPromotionRow(row) && row.dataset.promotionAutoApply === "1")
        .forEach((row) => {
          if (desiredBySignature.has(row.dataset.promotionSignature || "")) return;

          const rowItemId = String(row.querySelector(".item-internal-id")?.value || "").trim();
          const matchingDesired = desired.find((line) => itemId(line.item) === rowItemId);
          if (matchingDesired) {
            applyDesiredLine(row, matchingDesired);
            return;
          }

          row.remove();
        });

      desired.forEach((line) => {
        const exists = rows().some(
          (row) => row.dataset.promotionAutoApply === "1" && row.dataset.promotionSignature === line.signature
        );
        if (exists) return;

        const row = getOrCreateRow();
        if (row) applyDesiredLine(row, line);
      });

      ensureBlankRow();
      renderUpsellPanel();
      recalcTotals();
    } finally {
      state.syncing = false;
    }
  }

  function scheduleSync() {
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(syncBasketDiscounts, 120);
  }

  function clean(value) {
    return String(value || "").trim().toLowerCase();
  }

  function safeInt(value) {
    const amount = parseInt(value, 10);
    return Number.isFinite(amount) ? amount : 0;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: getAuthHeaders(), credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  }

  async function getInventoryStatuses() {
    if (Array.isArray(state.inventoryStatuses)) return state.inventoryStatuses;
    const data = await fetchJson("/api/netsuite/inventory-status");
    state.inventoryStatuses = Array.isArray(data.results)
      ? data.results.map((row) => ({ name: row.Name || row["Name"] || "", id: row["Internal ID"] || row.id || "" }))
      : [];
    return state.inventoryStatuses;
  }

  async function getInvoiceNumbers() {
    if (Array.isArray(state.invoiceNumbers)) return state.invoiceNumbers;
    const data = await fetchJson("/api/netsuite/invoice-numbers");
    state.invoiceNumbers = Array.isArray(data.results) ? data.results : [];
    return state.invoiceNumbers;
  }

  function buildMergedStock(itemId, balanceRows, liveFeed, statuses) {
    const statusMap = {};
    (statuses || []).forEach((status) => {
      const key = clean(status.name);
      if (key) statusMap[key] = String(status.id || "");
    });

    const numberAgg = {};
    (liveFeed || []).forEach((row) => {
      const numItemId = String(row["Item Id"] || row["Item ID"] || row.itemid || "").trim();
      const inv = clean(row.Number);
      const loc = clean(row.Location);
      if (String(numItemId) !== String(itemId) || !inv || !loc) return;

      const key = `${numItemId}||${inv}||${loc}`;
      if (!numberAgg[key]) {
        numberAgg[key] = {
          available: 0,
          onHand: 0,
          invNumberId: row["inv number id"] || row["Internal ID"] || "",
          location: String(row.Location || "").trim(),
          locationId: String(row["Location ID"] || "").trim(),
        };
      }
      numberAgg[key].available += safeInt(row.Available);
      numberAgg[key].onHand += safeInt(row["On Hand"]);
      if (!numberAgg[key].invNumberId) numberAgg[key].invNumberId = row["inv number id"] || row["Internal ID"] || "";
      if (!numberAgg[key].locationId) numberAgg[key].locationId = row["Location ID"] || "";
    });

    return (balanceRows || [])
      .map((row) => {
        const balItemId = String(row["Item ID"] || row["Item Id"] || row.itemid || "").trim();
        const inv = clean(row["Inventory Number"]);
        const loc = clean(row.Location);
        const agg = numberAgg[`${balItemId}||${inv}||${loc}`] || {};
        const status = String(row.Status || "").trim();

        return {
          itemId: balItemId,
          location: agg.location || String(row.Location || "").trim(),
          locationId: String(agg.locationId || row["Location ID"] || "").trim(),
          qty: safeInt(agg.available ?? row.Available),
          onHand: safeInt(agg.onHand ?? row["On Hand"]),
          status,
          statusId: statusMap[clean(status)] || "",
          inventoryNumber: String(row["Inventory Number"] || "").trim(),
          inventoryNumberId: String(agg.invNumberId || row["Inventory Number ID"] || "").trim(),
        };
      })
      .filter((stock) => stock.itemId && stock.inventoryNumber && stock.qty > 0);
  }

  async function loadStockForItem(itemIdValue) {
    const id = String(itemIdValue || "").trim();
    if (!id || state.stockByItemId.has(id) || state.stockLoading.has(id)) return;

    state.stockLoading.add(id);
    try {
      const [balanceData, invoiceNumbers, statuses] = await Promise.all([
        fetchJson(`/api/netsuite/inventorybalance?id=${encodeURIComponent(id)}`),
        getInvoiceNumbers(),
        getInventoryStatuses(),
      ]);
      state.stockByItemId.set(id, buildMergedStock(id, balanceData.results || [], invoiceNumbers, statuses));
      renderUpsellPanel();
    } catch (err) {
      console.warn("Failed to load fulfilment suggestion stock:", err);
      state.stockByItemId.set(id, []);
    } finally {
      state.stockLoading.delete(id);
    }
  }

  function isSpecialOrderRow(row) {
    const select = row?.querySelector(".item-fulfilment");
    const selectedText = select?.options?.[select.selectedIndex]?.textContent || "";
    return clean(selectedText).includes("special order");
  }

  function selectedWarehouse() {
    const select = document.getElementById("warehouse");
    return {
      id: String(select?.value || "").trim(),
      name: String(select?.selectedOptions?.[0]?.textContent || "").trim(),
    };
  }

  function scoreStock(stock, requiredQty) {
    const warehouse = selectedWarehouse();
    const loc = clean(stock.location);
    const whName = clean(warehouse.name);
    const sameWarehouse =
      (warehouse.id && String(stock.locationId) === String(warehouse.id)) ||
      (loc && whName && (loc === whName || loc.includes(whName) || whName.includes(loc)));
    const status = clean(stock.status);
    const preferredStatus = status.includes("good") || status.includes("stock");
    const enoughQty = safeInt(stock.qty) >= Math.max(1, safeInt(requiredQty));

    return (
      (sameWarehouse ? 1000 : 0) +
      (preferredStatus ? 200 : 0) +
      (enoughQty ? 100 : 0) +
      safeInt(stock.qty)
    );
  }

  function getFulfilmentSuggestions() {
    return manualLines()
      .filter((line) => line.id && isSpecialOrderRow(line.row))
      .map((line) => {
        if (!state.stockByItemId.has(line.id)) {
          loadStockForItem(line.id);
          return null;
        }

        const stock = [...(state.stockByItemId.get(line.id) || [])]
          .filter((entry) => safeInt(entry.qty) > 0 && clean(entry.status) !== "showroom")
          .sort((a, b) => scoreStock(b, line.quantity) - scoreStock(a, line.quantity))[0];

        if (!stock) return null;
        const suggestionKey = stockSuggestionKey(line, stock);
        if (state.dismissedStockAlternatives.has(suggestionKey)) return null;

        const item = findItemById(line.id) || findItemByName(line.name);
        return { line, item, stock, suggestionKey };
      })
      .filter(Boolean);
  }

  function stockSuggestionKey(line, stock) {
    return [
      line?.row?.dataset?.line || "",
      line?.id || "",
      stockKey(stock),
    ].map((value) => String(value || "").trim()).join("::");
  }

  function stockKey(stock) {
    return [
      stock?.itemId || "",
      stock?.locationId || stock?.location || "",
      stock?.statusId || stock?.status || "",
      stock?.inventoryNumberId || stock?.inventoryNumber || "",
      stock?.inventoryNumber || "",
    ].map((value) => String(value || "").trim()).join("||");
  }

  function upsellSuggestions() {
    const lines = manualLines();

    return (state.promotions.upsells || [])
      .map((promotion) => {
        const triggerIds = Array.isArray(promotion.triggerItemIds) ? promotion.triggerItemIds.map(String) : [];
        const triggerNames = Array.isArray(promotion.triggerItemNames)
          ? promotion.triggerItemNames.map((value) => String(value || "").trim().toLowerCase())
          : [];
        const triggerClass = String(promotion.triggerClass || "").trim().toLowerCase();
        const triggerSize = String(promotion.triggerSize || "").trim().toLowerCase();
        const triggerCategory = String(promotion.triggerCategory || "").trim().toLowerCase();
        const suggestedId = String(promotion.suggestedItemId || "").trim();
        const suggestedName = String(promotion.suggestedItemName || "").trim().toLowerCase();

        const matched = lines.some((line) => {
          const lineName = line.name.toLowerCase();
          const lineClass = line.klass.toLowerCase();
          const itemMatch =
            (triggerIds.length && triggerIds.includes(line.id)) ||
            (triggerNames.length && triggerNames.includes(lineName));
          if (itemMatch) return true;

          const classOk = !triggerClass || lineClass === triggerClass;
          const sizeOk = !triggerSize || line.sizes.includes(triggerSize);
          const categoryOk = !triggerCategory || line.categories.includes(triggerCategory);
          const hasFilter = !!(triggerClass || triggerSize || triggerCategory);
          return hasFilter && classOk && sizeOk && categoryOk;
        });
        if (!matched) return null;

        const alreadyAdded = lines.some((line) => {
          const lineName = line.name.toLowerCase();
          return (suggestedId && line.id === suggestedId) || (suggestedName && lineName === suggestedName);
        });
        if (alreadyAdded) return null;

        const item = findItemById(suggestedId) || findItemByName(promotion.suggestedItemName);
        if (!item) return null;

        const retail = retailPrice(item);
        const sale = retail * (1 - Number(promotion.discountPercent || 0) / 100);
        return { promotion, item, retail, sale };
      })
      .filter(Boolean);
  }

  function ensureUpsellPanel() {
    let panel = document.getElementById("orderUpsellPanel");
    if (panel) return panel;

    panel = document.createElement("aside");
    panel.id = "orderUpsellPanel";
    panel.className = "order-upsell-panel";
    panel.hidden = true;
    panel.innerHTML = '<div class="order-upsell-empty">No active upsells</div>';
    document.body.appendChild(panel);
    return panel;
  }

  function renderUpsellPanel() {
    const panel = ensureUpsellPanel();
    const suggestions = upsellSuggestions();
    const fulfilmentSuggestions = getFulfilmentSuggestions();
    const hasMissing = state.missingBasketItems.length > 0;

    if (!suggestions.length && !fulfilmentSuggestions.length && !hasMissing) {
      panel.hidden = true;
      panel.innerHTML = "";
      document.body.classList.remove("order-upsells-visible");
      return;
    }

    panel.hidden = false;
    document.body.classList.add("order-upsells-visible");
    panel.innerHTML = `
      ${suggestions.length ? `
        <div class="order-upsell-head">
          <span>Promotions</span>
          <strong>Suggested add-ons</strong>
        </div>
      ` : ""}
      ${hasMissing ? `<p class="order-upsell-warning">Missing basket item: ${escapeHtml(state.missingBasketItems.join(", "))}</p>` : ""}
      <div class="order-upsell-list">
      ${suggestions.map(({ promotion, item, retail, sale }) => {
        const name = itemName(item);
        const fallbackText = name.slice(0, 2).toUpperCase();
        return `
        <article class="order-upsell-card">
          <div class="order-upsell-thumb">
            ${imageMarkup(itemImages(item), name, fallbackText)}
          </div>
          <div>
            <span class="order-upsell-tag">${Number(promotion.discountPercent || 0).toFixed(1).replace(/\.0$/, "")}% off</span>
            <strong>${escapeHtml(name)}</strong>
            ${promotion.message ? `<p>${escapeHtml(promotion.message)}</p>` : ""}
            <small>${money(sale)} retail ${money(retail)}</small>
          </div>
          <button type="button" class="btn-primary small-btn" data-action="add-upsell" data-promotion-id="${escapeHtml(promotion.id)}">Add</button>
        </article>
      `;
      }).join("")}
      </div>
      <div class="order-fulfilment-suggestions">
        <div class="order-upsell-head">
          <span>Fulfilment</span>
          <strong>Stock alternatives</strong>
        </div>
        ${fulfilmentSuggestions.map(({ line, item, stock, suggestionKey }) => {
          const name = item ? itemName(item) : line.name;
          const fallbackText = name.slice(0, 2).toUpperCase();
          return `
            <article class="order-upsell-card order-fulfilment-card">
              <div class="order-upsell-thumb">
                ${imageMarkup(item ? itemImages(item) : [], name, fallbackText)}
              </div>
              <div class="order-stock-copy">
                <span class="order-upsell-tag">${safeInt(stock.qty)} available</span>
                <strong>${escapeHtml(name)}</strong>
                <p>This item is Currently Available - Would you like to use this item instead of ordering one</p>
                <table class="order-stock-table">
                  <tbody>
                    <tr>
                      <th>Location</th>
                      <td>${escapeHtml(stock.location || "-")}</td>
                    </tr>
                    <tr>
                      <th>Status</th>
                      <td>${escapeHtml(stock.status || "Stock")}</td>
                    </tr>
                    <tr>
                      <th>Lot</th>
                      <td>${escapeHtml(stock.inventoryNumber || "-")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="order-stock-actions">
                <button type="button" class="btn-primary small-btn" data-action="use-stock" data-line="${escapeHtml(line.row.dataset.line || "")}" data-item-id="${escapeHtml(line.id)}" data-stock-key="${escapeHtml(stockKey(stock))}">Yes</button>
                <button type="button" class="btn-secondary small-btn" data-action="dismiss-stock" data-suggestion-key="${escapeHtml(suggestionKey)}">Dismiss</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
    bindImageFallbacks(panel);
  }

  function setFulfilmentToWarehouse(row) {
    const select = row?.querySelector(".item-fulfilment");
    if (!select) return;
    const warehouseOption = [...select.options].find((option) => clean(option.textContent).includes("warehouse"));
    if (warehouseOption) {
      select.value = warehouseOption.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function sameAsSelectedWarehouse(stock) {
    const warehouse = selectedWarehouse();
    const loc = clean(stock.location);
    const whName = clean(warehouse.name);
    return (
      (warehouse.id && String(stock.locationId) === String(warehouse.id)) ||
      (loc && whName && (loc === whName || loc.includes(whName) || whName.includes(loc)))
    );
  }

  function setInventoryDetail(row, detail) {
    const normalized = String(detail || "").trim();
    if (window.salesNewItemEditor?.setInventoryDetailForRow) {
      window.salesNewItemEditor.setInventoryDetailForRow(row, normalized);
      return;
    }
    const detailField = row.querySelector(".item-inv-detail");
    if (detailField) detailField.value = normalized;
    row.dataset.invdetail = normalized;
  }

  function applyStockSuggestion(lineId, itemIdValue, selectedStockKey) {
    const row = rows().find((entry) => String(entry.dataset.line || "") === String(lineId || ""));
    const stock = (state.stockByItemId.get(String(itemIdValue || "")) || []).find(
      (entry) => stockKey(entry) === String(selectedStockKey || "")
    );
    if (!row || !stock) return;

    const qty = Math.max(1, safeInt(row.querySelector(".item-qty")?.value || 1));
    const detail = `${qty}|${stock.location}|${stock.locationId || ""}|${stock.status || ""}|${stock.statusId || ""}|${stock.inventoryNumber || ""}|${stock.inventoryNumberId || ""}`;

    setFulfilmentToWarehouse(row);
    setInventoryDetail(row, detail);
    row.dataset.backorder = "";

    if (sameAsSelectedWarehouse(stock)) {
      row.dataset.lotnumber = stock.inventoryNumberId || stock.inventoryNumber || "";
      row.dataset.inventoryMeta = "";
      row.dataset.inventoryMetaJson = "";
    } else {
      row.dataset.lotnumber = "";
      row.dataset.inventoryMeta = detail;
      row.dataset.inventoryMetaJson = JSON.stringify([{
        qty: String(qty),
        locationName: stock.location || "",
        locationId: stock.locationId || "",
        statusName: stock.status || "",
        statusId: stock.statusId || "",
        inventoryNumberName: stock.inventoryNumber || "",
        inventoryNumberId: stock.inventoryNumberId || "",
      }]);
    }

    const cell = row.querySelector(".inventory-cell");
    if (cell) {
      cell.innerHTML = sameAsSelectedWarehouse(stock)
        ? `<strong>Lot:</strong> ${escapeHtml(stock.inventoryNumber || "-")}<br><small>ID: ${escapeHtml(stock.inventoryNumberId || "-")}</small>`
        : `${qty}x ${escapeHtml(stock.inventoryNumber || "")} @ ${escapeHtml(stock.location || "")}`;
      cell.classList.add("flash-success");
      setTimeout(() => cell.classList.remove("flash-success"), 800);
    }

    ensureBlankRow();
    scheduleSync();
  }

  function addUpsell(promotionId) {
    const promotion = (state.promotions.upsells || []).find(
      (entry) => String(entry.id) === String(promotionId)
    );
    if (!promotion) return;

    const item = findItemById(promotion.suggestedItemId) || findItemByName(promotion.suggestedItemName);
    const row = item ? getOrCreateRow() : null;
    const editor = getEditor();
    if (!item || !row || !editor?.applyItemToRow) return;

    const retail = retailPrice(item);
    editor.applyItemToRow(row, item, {
      quantity: 1,
      salePrice: retail * (1 - Number(promotion.discountPercent || 0) / 100),
      discountPercent: Number(promotion.discountPercent || 0),
    });
    row.dataset.promotionKind = "upsell";
    row.dataset.promotionId = String(promotion.id || "");
    ensureBlankRow();
    scheduleSync();
  }

  async function loadPromotions() {
    try {
      const response = await fetch("/api/promotions/active", {
        headers: getAuthHeaders(),
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Unable to load promotions");
      state.promotions = {
        upsells: Array.isArray(data.promotions?.upsells) ? data.promotions.upsells : [],
        basketDiscounts: Array.isArray(data.promotions?.basketDiscounts) ? data.promotions.basketDiscounts : [],
      };
    } catch (err) {
      console.warn("Failed to load active order promotions:", err);
      state.promotions = { upsells: [], basketDiscounts: [] };
    }
  }

  async function loadWebManagementData() {
    try {
      const data = await fetchJson("/api/suitepim/web-management");
      const rows = Array.isArray(data.rows) ? data.rows : [];
      state.webItemsById.clear();
      rows.forEach((row) => {
        const id = String(row["Internal ID"] || row["Item ID"] || row.id || "").trim();
        if (id) state.webItemsById.set(id, row);
      });
    } catch (err) {
      console.warn("Failed to load SuitePIM web management data for upsell filters:", err.message);
      state.webItemsById.clear();
    }
  }

  async function loadKioskImageData() {
    try {
      const data = await fetchJson("/api/netsuite/kiosk-items");
      const rows = Array.isArray(data.results) ? data.results : (Array.isArray(data.data) ? data.data : []);
      state.kioskItemsById.clear();
      state.kioskItemsByName.clear();

      rows.forEach((row) => {
        const id = itemId(row);
        const name = clean(itemName(row));
        if (id) state.kioskItemsById.set(id, row);
        if (name && !state.kioskItemsByName.has(name)) state.kioskItemsByName.set(name, row);
      });
    } catch (err) {
      console.warn("Failed to load kiosk item image data for promotions:", err.message);
      state.kioskItemsById.clear();
      state.kioskItemsByName.clear();
    }
  }

  function itemNameMatchesSize(cleanName, sizeValue) {
    const selectedSize = clean(sizeValue);
    if (!cleanName || !selectedSize) return false;

    if (selectedSize === "double") {
      return cleanName.includes("double") && !cleanName.includes("small double");
    }

    if (selectedSize === "king") {
      return (
        (cleanName.includes(" king") || cleanName.startsWith("king") || cleanName.includes("(king")) &&
        !cleanName.includes("super king") &&
        !cleanName.includes("zip and link") &&
        !cleanName.includes("zip & link")
      );
    }

    if (selectedSize === "single") {
      return (
        (cleanName.includes(" single") || cleanName.startsWith("single") || cleanName.includes("(single")) &&
        !cleanName.includes("small single") &&
        !cleanName.includes("euro single")
      );
    }

    return cleanName.includes(selectedSize);
  }

  async function loadSizeOptions() {
    try {
      const data = await fetchJson("/api/netsuite/sales-order-item-size");
      const sizeSet = new Set();
      (Array.isArray(data.results) ? data.results : []).forEach((row) => {
        const size = String(row.size || row.Size || row.name || row.Name || "").trim();
        if (size && size !== "- None -") sizeSet.add(size);
      });
      state.sizeOptions = Array.from(sizeSet);
    } catch (err) {
      console.warn("Failed to load sales order size data for upsell filters:", err.message);
      state.sizeOptions = [];
    }
  }

  function waitForCatalogue(timeoutMs = 8000) {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if ((Array.isArray(window.items) && window.items.length) || Date.now() - started > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  function bindEvents() {
    const body = document.getElementById("orderItemsBody");
    if (body) {
      body.addEventListener("input", scheduleSync);
      body.addEventListener("change", scheduleSync);
      body.addEventListener("click", (event) => {
        if (event.target.closest(".delete-row")) setTimeout(scheduleSync, 0);
      });

      const observer = new MutationObserver(() => scheduleSync());
      observer.observe(body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "data-invdetail",
          "data-inventory-meta",
          "data-inventory-meta-json",
          "data-lotnumber",
          "value",
        ],
      });
    }

    window.addEventListener("focus", () => scheduleSync());

    if (typeof window.onInventorySaved === "function" && window.onInventorySaved.__orderPromotionsWrapped !== true) {
      const originalOnInventorySaved = window.onInventorySaved;
      window.onInventorySaved = function (...args) {
        const result = originalOnInventorySaved.apply(this, args);
        setTimeout(scheduleSync, 0);
        setTimeout(scheduleSync, 150);
        return result;
      };
      window.onInventorySaved.__orderPromotionsWrapped = true;
    }

    ensureUpsellPanel().addEventListener("click", (event) => {
      const addButton = event.target.closest('button[data-action="add-upsell"]');
      if (addButton) addUpsell(addButton.dataset.promotionId);

      const stockButton = event.target.closest('button[data-action="use-stock"]');
      if (stockButton) {
        applyStockSuggestion(
          stockButton.dataset.line,
          stockButton.dataset.itemId,
          stockButton.dataset.stockKey
        );
      }

      const dismissButton = event.target.closest('button[data-action="dismiss-stock"]');
      if (dismissButton) {
        state.dismissedStockAlternatives.add(String(dismissButton.dataset.suggestionKey || ""));
        renderUpsellPanel();
      }
    });
  }

  async function init() {
    if (state.initialized) {
      scheduleSync();
      return;
    }
    state.initialized = true;
    bindEvents();
    await Promise.all([loadPromotions(), loadWebManagementData(), loadKioskImageData(), loadSizeOptions()]);
    await waitForCatalogue();
    state.ready = true;
    scheduleSync();
  }

  window.initOrderPromotions = init;

  document.addEventListener("DOMContentLoaded", () => {
    if (window.orderPromotionsEnabled === false) return;
    setTimeout(init, 0);
  });
})();
