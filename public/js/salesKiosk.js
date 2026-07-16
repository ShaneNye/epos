(function () {
  const DRAFT_KEY = "salesKioskDraft:v1";
  const MAX_RENDERED_GROUPS = 100;
  const state = {
    items: [],
    groups: [],
    filteredGroups: [],
    cart: [],
    promotions: {
      upsells: [],
      basketDiscounts: [],
    },
    fulfilmentMethods: [],
    activeCartIndex: null,
    renderToken: 0,
    selectedChildByGroup: {},
    pendingLineConfig: null,
    currentUser: null,
    currentStoreName: "",
    locations: [],
    matchedCustomerId: null,
    addressResults: [],
    checkoutSubmitting: false,
    checkoutStep: "customer",
    cachedCatalogue: null,
    checkoutValidatorsBound: false,
    promotionsCollapsed: true,
  };

  const KIOSK_CACHE_KEY = "nsKioskItemFeedCache:v1";
  const KIOSK_CACHE_TTL_MS = 60 * 60 * 1000;

  function byId(id) {
    return document.getElementById(id);
  }

  function money(value) {
    const amount = Number(value || 0);
    return `£${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }

  function getAuthHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    if (saved?.token) {
      return { Authorization: `Bearer ${saved.token}` };
    }
    return {};
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getField(item, names) {
    for (const key of Object.keys(item || {})) {
      const normalizedKey = String(key || "").trim().toLowerCase();
      if (names.includes(normalizedKey)) return item[key];
    }
    return null;
  }

  function getItemId(item) {
    return String(getField(item, ["internal id", "internalid", "id"]) || "").trim();
  }

  function getParentId(item) {
    return String(getField(item, ["parent"]) || "").trim();
  }

  function getItemName(item) {
    return String(getField(item, ["name", "item name"]) || "Unnamed item").trim();
  }

  function getItemClass(item) {
    return String(getField(item, ["class", "item class"]) || "Unclassified").trim();
  }

  function getItemImage(item) {
    const value = getField(item, ["item image", "itemimage", "image", "image url"]);
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function getRetailPrice(item) {
    const raw = Number(getField(item, ["base price", "baseprice"]) || 0);
    if (!Number.isFinite(raw) || raw === 0) return 0;
    return (raw / 100) * 120;
  }

  function findItemById(itemId) {
    return state.items.find((item) => getItemId(item) === String(itemId || "")) || null;
  }

  function findItemByName(itemName) {
    const target = String(itemName || "").trim().toLowerCase();
    if (!target) return null;
    return (
      state.items.find((item) => getItemName(item).trim().toLowerCase() === target) || null
    );
  }

  function findGroupForItemId(itemId) {
    return (
      state.groups.find((group) =>
        group.children.some((child) => getItemId(child) === String(itemId || ""))
      ) || null
    );
  }

  function findGroupForItemName(itemName) {
    const target = String(itemName || "").trim().toLowerCase();
    if (!target) return null;
    return (
      state.groups.find((group) =>
        group.children.some((child) => getItemName(child).trim().toLowerCase() === target)
      ) || null
    );
  }

  function isBasketDiscountLine(line) {
    return line?.promotionMeta?.kind === "basket_discount";
  }

  function getManualCartLines() {
    return state.cart.filter((line) => !isBasketDiscountLine(line));
  }

  function getBasketPromotionSubtotal() {
    return getManualCartLines().reduce(
      (sum, line) => sum + Number(line.salePrice || 0) * Number(line.quantity || 0),
      0
    );
  }

  function getCartTotal() {
    return state.cart.reduce((sum, line) => sum + line.salePrice * line.quantity, 0);
  }

  function clampMoney(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
  }

  function clampPercent(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.min(100, Math.max(0, amount));
  }

  function now() {
    return Date.now();
  }

  function readKioskCache() {
    try {
      const raw = localStorage.getItem(KIOSK_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        !Array.isArray(parsed.items) ||
        !parsed.cachedAt ||
        now() - parsed.cachedAt > KIOSK_CACHE_TTL_MS
      ) {
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn("Failed to read kiosk item cache:", err);
      return null;
    }
  }

  function writeKioskCache(items) {
    const payload = {
      cachedAt: now(),
      items: Array.isArray(items) ? items : [],
    };

    try {
      localStorage.setItem(KIOSK_CACHE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("Failed to write kiosk item cache:", err);
    }

    state.cachedCatalogue = payload;
    return payload;
  }

  function getCachedKioskItems() {
    if (
      state.cachedCatalogue &&
      Array.isArray(state.cachedCatalogue.items) &&
      state.cachedCatalogue.cachedAt &&
      now() - state.cachedCatalogue.cachedAt <= KIOSK_CACHE_TTL_MS
    ) {
      return state.cachedCatalogue.items;
    }

    const local = readKioskCache();
    if (local) {
      state.cachedCatalogue = local;
      return local.items;
    }

    return [];
  }

  async function fetchKioskItems(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = getCachedKioskItems();
      if (cached.length) return cached;
    }

    const response = await fetch("/api/netsuite/kiosk-items", {
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const items = payload.results || payload.data || [];
    writeKioskCache(items);
    return items;
  }

  function isServiceClass(itemClass) {
    return String(itemClass || "").trim().toLowerCase().includes("service");
  }

  function selectionsToSummary(selections) {
    return Object.entries(selections || {})
      .map(([field, value]) => {
        if (Array.isArray(value)) return value.length ? `${field}: ${value.join(", ")}` : "";
        return value ? `${field}: ${value}` : "";
      })
      .filter(Boolean)
      .join(" | ");
  }

  function setStatus(text) {
    const el = byId("kioskStatus");
    if (el) el.textContent = text;
  }

  function getCartDiscountTotal() {
    return state.cart.reduce((sum, line) => {
      const retail = Number(line.retailPrice || 0);
      const sale = Number(line.salePrice || 0);
      const qty = Number(line.quantity || 0);
      return sum + Math.max(0, retail - sale) * qty;
    }, 0);
  }

  function isTradeInLine(line) {
    return String(line?.name || "").toLowerCase().includes("trade in");
  }

  function getTradeInDiscountTotal() {
    return state.cart.reduce((sum, line) => {
      if (!isTradeInLine(line)) return sum;
      return sum + Math.abs(Number(line.salePrice || 0) * Number(line.quantity || 0));
    }, 0);
  }

  function buildBasketDiscountLine(promotion, rule) {
    const item = findItemById(rule?.itemId) || findItemByName(rule?.itemName);
    if (!item) return null;

    const itemClass = getItemClass(item);
    const salePrice = Number(getRetailPrice(item) || 0);

    return {
      itemId: getItemId(item),
      name: getItemName(item),
      parentName: promotion.title,
      groupId: getParentId(item) || getItemId(item),
      itemClass,
      quantity: 1,
      retailPrice: salePrice,
      salePrice,
      image: getItemImage(item),
      optionsSelections: {},
      inventoryDetail: "",
      inventoryMeta: "",
      inventoryMetaJson: "",
      lotnumber: "",
      fulfilmentMethod: "",
      fulfilmentMethodName: "",
      sourceItem: item,
      promotionMeta: {
        kind: "basket_discount",
        promotionId: promotion.id,
        promotionTitle: promotion.title,
        message: promotion.message || "",
      },
    };
  }

  function basketLineSignature(line) {
    return JSON.stringify({
      promotionId: line?.promotionMeta?.promotionId || null,
      itemId: line?.itemId || "",
      quantity: Number(line?.quantity || 0),
      salePrice: Number(line?.salePrice || 0).toFixed(2),
      title: line?.promotionMeta?.promotionTitle || "",
    });
  }

  function syncAutomaticBasketDiscounts() {
    const manualLines = getManualCartLines();
    const subtotal = getBasketPromotionSubtotal();
    const desiredLines = [];

    (state.promotions.basketDiscounts || []).forEach((promotion) => {
      const matchingRule = (promotion.rules || []).find((rule) => {
        const minValue = Number(rule.minValue || 0);
        const maxValue = Number(rule.maxValue || 0);
        return subtotal >= minValue && subtotal <= maxValue;
      });

      if (!matchingRule) return;
      const line = buildBasketDiscountLine(promotion, matchingRule);
      if (line) desiredLines.push(line);
    });

    const currentLines = state.cart.filter(isBasketDiscountLine);
    const currentSignature = currentLines.map(basketLineSignature).sort().join("|");
    const desiredSignature = desiredLines.map(basketLineSignature).sort().join("|");

    if (currentSignature === desiredSignature) return false;

    state.cart = [...manualLines, ...desiredLines];
    return true;
  }

  function getUpsellSuggestions() {
    const manualLines = getManualCartLines();

    return (state.promotions.upsells || [])
      .map((promotion) => {
        const triggerIds = Array.isArray(promotion.triggerItemIds) && promotion.triggerItemIds.length
          ? promotion.triggerItemIds.map((value) => String(value || "").trim()).filter(Boolean)
          : String(promotion.triggerItemId || "").trim()
            ? [String(promotion.triggerItemId || "").trim()]
            : [];
        const triggerNames = Array.isArray(promotion.triggerItemNames) && promotion.triggerItemNames.length
          ? promotion.triggerItemNames.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
          : String(promotion.triggerItemName || "").trim()
            ? [String(promotion.triggerItemName || "").trim().toLowerCase()]
            : [];
        const triggerClass = String(promotion.triggerClass || "").trim().toLowerCase();
        const suggestedId = String(promotion.suggestedItemId || "").trim();
        const suggestedName = String(promotion.suggestedItemName || "").trim().toLowerCase();

        const triggerMatched = manualLines.some((line) => {
          const lineItemId = String(line.itemId || "").trim();
          const lineName = String(line.name || "").trim().toLowerCase();
          const lineParentName = String(line.parentName || "").trim().toLowerCase();
          const lineClass = String(line.itemClass || "").trim().toLowerCase();
          return (
            (triggerIds.length && triggerIds.includes(lineItemId)) ||
            (triggerNames.length && (triggerNames.includes(lineName) || triggerNames.includes(lineParentName))) ||
            (triggerClass && lineClass === triggerClass)
          );
        });
        if (!triggerMatched) return null;

        const alreadyInCart = manualLines.some((line) => {
          const lineItemId = String(line.itemId || "").trim();
          const lineName = String(line.name || "").trim().toLowerCase();
          const lineParentName = String(line.parentName || "").trim().toLowerCase();
          return (
            (suggestedId && lineItemId === suggestedId) ||
            (suggestedName && (lineName === suggestedName || lineParentName === suggestedName))
          );
        });
        if (alreadyInCart) return null;

        const item = findItemById(promotion.suggestedItemId) || findItemByName(promotion.suggestedItemName);
        if (!item) return null;

        const retailPrice = Number(getRetailPrice(item) || 0);
        const salePrice = retailPrice * (1 - Number(promotion.discountPercent || 0) / 100);

        return {
          promotion,
          item,
          retailPrice,
          salePrice,
        };
      })
      .filter(Boolean);
  }

  function renderCartPromotions() {
    const panel = byId("kioskCartPromotions");
    const drawer = byId("kioskPromotionDrawer");
    const toggle = byId("kioskPromotionToggle");
    if (!panel) return;

    const suggestions = getUpsellSuggestions();
    const hasSuggestions = suggestions.length > 0;
    panel.hidden = !hasSuggestions;
    if (drawer) {
      drawer.hidden = !hasSuggestions || state.promotionsCollapsed;
      drawer.setAttribute("aria-hidden", hasSuggestions && !state.promotionsCollapsed ? "false" : "true");
    }
    if (toggle) {
      toggle.hidden = !hasSuggestions;
      toggle.setAttribute("aria-expanded", hasSuggestions && !state.promotionsCollapsed ? "true" : "false");
    }

    if (!hasSuggestions) {
      panel.innerHTML = "";
      state.promotionsCollapsed = true;
      document.body.classList.add("kiosk-promotions-collapsed");
      return;
    }

    document.body.classList.toggle("kiosk-promotions-collapsed", !!state.promotionsCollapsed);

    panel.innerHTML = `
      <div class="kiosk-promotion-panel-head">
        <span class="kiosk-promotion-panel-label">Upsells</span>
        <strong>Suggested add-ons</strong>
      </div>
      ${suggestions
      .map(({ promotion, item, retailPrice, salePrice }) => {
        const image = getItemImage(item);
        return `
        <article class="kiosk-promotion-line">
          <div class="kiosk-promotion-line-top">
            <div class="kiosk-promotion-media">
            ${
              image
                ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(getItemName(item))}" loading="lazy" decoding="async">`
                : '<div class="kiosk-promotion-media-placeholder">EPOS</div>'
            }
            </div>
            <div class="kiosk-promotion-copy">
              <div class="kiosk-promotion-topline">
                <span class="kiosk-promotion-tag">Upsell</span>
                <span class="kiosk-promotion-offer">${Number(promotion.discountPercent || 0).toFixed(1).replace(/\.0$/, "")}% off</span>
              </div>
              <strong>${escapeHtml(getItemName(item))}</strong>
              <div class="kiosk-promotion-item">${escapeHtml(promotion.title || "Suggested add-on")}</div>
              ${
                promotion.message
                  ? `<p>${escapeHtml(promotion.message)}</p>`
                  : ""
              }
              <div class="kiosk-promotion-price">
                <strong>${money(salePrice)}</strong>
                <small>Retail ${money(retailPrice)}</small>
              </div>
            </div>
          </div>
          <div class="kiosk-promotion-line-actions">
            <div class="kiosk-promotion-line-meta">Suggested from ${escapeHtml(
              promotion.triggerClass
                ? `Any ${promotion.triggerClass}`
                : (Array.isArray(promotion.triggerItemNames) && promotion.triggerItemNames.length
                  ? promotion.triggerItemNames.join(", ")
                  : (promotion.triggerItemName || "cart item"))
            )}</div>
            <div class="kiosk-promotion-actions">
              <button class="btn-primary" type="button" data-action="add-upsell" data-promotion-id="${promotion.id}">
                Add Upsell
              </button>
            </div>
          </div>
        </article>
      `;
      })
      .join("")}`;
  }

  function refreshCartState() {
    syncAutomaticBasketDiscounts();
    renderCart();
  }

  function getFulfilmentNameById(id) {
    const match = state.fulfilmentMethods.find(
      (entry) => String(entry.id || entry["Internal ID"] || "") === String(id || "")
    );
    return String(match?.name || match?.Name || "").trim();
  }

  function fulfilmentRequiresInventory(methodId) {
    const name = getFulfilmentNameById(methodId).toLowerCase();
    return name === "warehouse" || name === "in store" || name === "fulfil from store";
  }

  function inventoryDetailToSummary(detailString) {
    const detail = String(detailString || "").trim();
    if (!detail) return "No inventory selected yet.";
    return detail
      .split(";")
      .map((part) => {
        const [qty, locName, , statusName, , invName] = String(part || "").trim().split("|");
        if (!qty && !locName && !invName) return "";
        const pieces = [`${qty || "0"}x`, invName || "Stock", locName ? `@ ${locName}` : "", statusName ? `(${statusName})` : ""];
        return pieces.filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join(" | ");
  }

  function getGroupClass(group) {
    return getItemClass(group.parentItem || group.children[0] || {});
  }

  function getGroupName(group) {
    return getItemName(group.parentItem || group.children[0] || {});
  }

  function getGroupImage(group, child) {
    return getItemImage(group.parentItem) || getItemImage(child) || getItemImage(group.children[0]) || "";
  }

  function groupHasImage(group) {
    return !!getGroupImage(group, group.children[0] || group.parentItem);
  }

  function getGroupSearchBlob(group) {
    return String(group.searchBlob || "");
  }

  function buildGroups(items) {
    const itemsById = new Map(items.map((item) => [getItemId(item), item]));
    const groupMap = new Map();
    const assignedChildren = new Set();

    items.forEach((item) => {
      const parentId = getParentId(item);
      if (!parentId) return;

      const group = groupMap.get(parentId) || {
        groupId: parentId,
        parentItem: itemsById.get(parentId) || null,
        children: [],
      };
      group.children.push(item);
      if (!group.parentItem && itemsById.get(parentId)) group.parentItem = itemsById.get(parentId);
      groupMap.set(parentId, group);
      assignedChildren.add(getItemId(item));
    });

    items.forEach((item) => {
      const itemId = getItemId(item);
      if (!itemId || assignedChildren.has(itemId) || groupMap.has(itemId)) return;

      groupMap.set(itemId, {
        groupId: itemId,
        parentItem: item,
        children: [item],
      });
    });

    const groups = [...groupMap.values()]
      .map((group) => ({
        ...group,
        children: group.children.slice().sort((a, b) => getItemName(a).localeCompare(getItemName(b))),
        searchBlob: [
          getGroupName(group),
          getGroupClass(group),
          group.groupId,
          ...group.children.map((child) => `${getItemName(child)} ${getItemId(child)}`),
        ].join(" ").toLowerCase(),
      }))
      .sort((a, b) => {
        const imageRank = Number(groupHasImage(b)) - Number(groupHasImage(a));
        if (imageRank !== 0) return imageRank;
        return getGroupName(a).localeCompare(getGroupName(b));
      });

    groups.forEach((group) => {
      if (!state.selectedChildByGroup[group.groupId]) {
        state.selectedChildByGroup[group.groupId] = getItemId(group.children[0] || group.parentItem);
      }
    });

    return groups;
  }

  function getSelectedChildForGroup(group) {
    const selectedId = String(state.selectedChildByGroup[group.groupId] || "");
    return group.children.find((child) => getItemId(child) === selectedId) || group.children[0] || group.parentItem;
  }

  function renderClassFilter() {
    const select = byId("kioskClassFilter");
    if (!select) return;

    const current = select.value;
    const classes = [...new Set(state.groups.map(getGroupClass).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );

    select.innerHTML = '<option value="">All classes</option>';
    classes.forEach((itemClass) => {
      const option = document.createElement("option");
      option.value = itemClass.toLowerCase();
      option.textContent = itemClass;
      select.appendChild(option);
    });
    if (current) select.value = current;
  }

  function filterGroups() {
    const query = String(byId("kioskSearch")?.value || "").trim().toLowerCase();
    const selectedClass = String(byId("kioskClassFilter")?.value || "").trim().toLowerCase();

    state.filteredGroups = state.groups.filter((group) => {
      const classMatch = !selectedClass || getGroupClass(group).toLowerCase() === selectedClass;
      const queryMatch = !query || getGroupSearchBlob(group).includes(query);
      return classMatch && queryMatch;
    });
  }

  function renderProducts() {
    const grid = byId("kioskProductGrid");
    if (!grid) return;

    const renderToken = ++state.renderToken;
    filterGroups();

    if (!state.filteredGroups.length) {
      grid.innerHTML = '<div class="kiosk-empty">No products match the current search and class filter.</div>';
      setStatus("No matching parent items.");
      return;
    }

    const groupsToRender = state.filteredGroups.slice(0, MAX_RENDERED_GROUPS);
    const isLimited = state.filteredGroups.length > groupsToRender.length;

    grid.innerHTML = "";
    setStatus(
      isLimited
        ? `Rendering ${groupsToRender.length} of ${state.filteredGroups.length} parent cards...`
        : `Rendering ${groupsToRender.length} parent cards...`
    );

    const batchSize = 24;
    let index = 0;

    const renderBatch = () => {
      if (renderToken !== state.renderToken) return;

      const slice = groupsToRender.slice(index, index + batchSize);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = slice.map((group) => renderGroupCardMarkup(group)).join("");
      const fragment = document.createDocumentFragment();
      while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
      grid.appendChild(fragment);
      index += slice.length;

      if (index < groupsToRender.length) {
        window.requestAnimationFrame(renderBatch);
        return;
      }

      if (renderToken === state.renderToken) {
        setStatus(
          isLimited
            ? `Showing ${groupsToRender.length} of ${state.filteredGroups.length} matching parent cards. Refine search or class filter to narrow further.`
            : `${groupsToRender.length} parent cards ready to browse.`
        );
      }
    };

    window.requestAnimationFrame(renderBatch);
  }

  function renderGroupCardMarkup(group) {
    const child = getSelectedChildForGroup(group);
    const itemClass = getGroupClass(group);
    const image = getGroupImage(group, child);
    const parentName = getGroupName(group);
    const parentId = group.groupId;
    const variantSummary =
      group.children.length > 1
        ? `${group.children.length} variants`
        : "Single item";

    return `
      <article class="kiosk-card" data-group-id="${escapeHtml(parentId)}">
        <div class="kiosk-card-media">
          <span class="kiosk-card-badge">${escapeHtml(itemClass)}</span>
          ${
            image
              ? `<img class="kiosk-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(parentName)}" loading="lazy" decoding="async">`
              : '<div class="kiosk-card-media-placeholder">EPOS</div>'
          }
        </div>
        <div class="kiosk-card-body">
          <h2 class="kiosk-card-title">${escapeHtml(parentName)}</h2>
          <div class="kiosk-card-meta">
            <div class="kiosk-card-price">
              <span>Retail price</span>
              <strong class="kiosk-selected-price">${money(getRetailPrice(child))}</strong>
            </div>
            <div class="kiosk-card-id">
              <div>Parent ID ${escapeHtml(parentId)}</div>
              <div class="kiosk-card-variant-count">${escapeHtml(variantSummary)}</div>
            </div>
          </div>
          <label class="kiosk-child-picker">
            <span>Choose item</span>
            <select class="kiosk-child-select" data-group-id="${escapeHtml(parentId)}">
              ${group.children
                .map((entry) => {
                  const childId = getItemId(entry);
                  const selected = childId === String(state.selectedChildByGroup[parentId] || "") ? " selected" : "";
                  return `<option value="${escapeHtml(childId)}"${selected}>${escapeHtml(getItemName(entry))}</option>`;
                })
                .join("")}
            </select>
          </label>
          <div class="kiosk-selected-child">
            <span class="kiosk-selected-child-label">Selected child</span>
            <strong class="kiosk-selected-child-name">${escapeHtml(getItemName(child))}</strong>
            <small class="kiosk-selected-child-id">Child ID ${escapeHtml(getItemId(child))}</small>
          </div>
          <div class="kiosk-card-actions">
            <button class="btn-primary" type="button" data-action="add" data-group-id="${escapeHtml(parentId)}">Add To Cart</button>
          </div>
        </div>
      </article>
    `;
  }

  function updateGroupCard(groupId) {
    const article = document.querySelector(`.kiosk-card[data-group-id="${CSS.escape(groupId)}"]`);
    const group = state.groups.find((entry) => entry.groupId === groupId);
    if (!article || !group) return;

    const child = getSelectedChildForGroup(group);
    const imageWrap = article.querySelector(".kiosk-card-media");
    const priceEl = article.querySelector(".kiosk-selected-price");
    const childNameEl = article.querySelector(".kiosk-selected-child-name");
    const childIdEl = article.querySelector(".kiosk-selected-child-id");
    const image = getGroupImage(group, child);

    if (imageWrap) {
      const currentImg = imageWrap.querySelector(".kiosk-card-image");
      const placeholder = imageWrap.querySelector(".kiosk-card-media-placeholder");
      if (image) {
        if (currentImg) {
          currentImg.src = image;
          currentImg.alt = getItemName(child);
        } else if (placeholder) {
          placeholder.outerHTML = `<img class="kiosk-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(getItemName(child))}">`;
        }
      } else if (currentImg) {
        currentImg.outerHTML = '<div class="kiosk-card-media-placeholder">EPOS</div>';
      }
    }

    if (priceEl) priceEl.textContent = money(getRetailPrice(child));
    if (childNameEl) childNameEl.textContent = getItemName(child);
    if (childIdEl) childIdEl.textContent = `Child ID ${getItemId(child)}`;
  }

  function renderCart() {
    const list = byId("kioskCartItems");
    if (!list) return;

    renderCartPromotions();

    const total = getCartTotal();
    const discountTotal = getCartDiscountTotal();
    const tradeInTotal = getTradeInDiscountTotal();
    const lineCount = state.cart.length;
    byId("kioskCartToggleCount").textContent = String(state.cart.length);
    byId("kioskCartFooterTotal").textContent = money(total);
    byId("kioskCartFooterCount").textContent = String(lineCount);
    byId("kioskCartFooterDiscount").textContent = money(discountTotal);
    const cartTradeInWrap = byId("kioskCartFooterTradeInWrap");
    const cartTradeIn = byId("kioskCartFooterTradeIn");
    if (cartTradeInWrap) cartTradeInWrap.hidden = tradeInTotal <= 0;
    if (cartTradeIn) cartTradeIn.textContent = money(tradeInTotal);
    const summary = byId("kioskCartSummary");
    if (summary) summary.hidden = lineCount === 0;

    const pageFooter = byId("kioskPageFooter");
    if (pageFooter) {
      pageFooter.hidden = lineCount === 0;
      const footerCount = byId("kioskPageFooterCount");
      const footerTotal = byId("kioskPageFooterTotal");
      const footerDiscount = byId("kioskPageFooterDiscount");
      const footerTradeInWrap = byId("kioskPageFooterTradeInWrap");
      const footerTradeIn = byId("kioskPageFooterTradeIn");
      if (footerCount) footerCount.textContent = String(lineCount);
      if (footerTotal) footerTotal.textContent = money(total);
      if (footerDiscount) footerDiscount.textContent = money(discountTotal);
      if (footerTradeInWrap) footerTradeInWrap.hidden = tradeInTotal <= 0;
      if (footerTradeIn) footerTradeIn.textContent = money(tradeInTotal);
    }
    document.body.classList.toggle("kiosk-has-cart-summary", lineCount > 0);

    if (!lineCount) {
      setCheckoutOpen(false);
      list.innerHTML = '<div class="kiosk-empty">Your cart is empty. Add products from the catalogue to start building a sale.</div>';
      return;
    }

    list.innerHTML = state.cart
      .map((line, index) => {
        const isLockedPromotion = isBasketDiscountLine(line);
        return `
        <article class="kiosk-cart-line${isLockedPromotion ? " is-promotion-line" : ""}">
          <div class="kiosk-cart-line-top">
            <div class="kiosk-cart-thumb">
              ${
                line.image
                  ? `<img src="${escapeHtml(line.image)}" alt="${escapeHtml(line.name)}" loading="lazy" decoding="async">`
                  : '<div class="kiosk-cart-thumb-placeholder">EPOS</div>'
              }
            </div>
              <div class="kiosk-cart-head">
                <h3>${escapeHtml(line.name)}</h3>
                <div class="kiosk-cart-line-meta">${escapeHtml(line.itemClass)} | Retail ${money(line.retailPrice)} each</div>
                <div class="kiosk-cart-line-submeta">Child ID ${escapeHtml(line.itemId)}${line.parentName ? ` | Parent ${escapeHtml(line.parentName)}` : ""}</div>
                ${
                  isLockedPromotion
                    ? `<div class="kiosk-cart-line-submeta kiosk-cart-line-promo">Automatic promotion${line.promotionMeta?.promotionTitle ? ` | ${escapeHtml(line.promotionMeta.promotionTitle)}` : ""}</div>`
                    : ""
                }
                ${
                  line.fulfilmentMethodName
                    ? `<div class="kiosk-cart-line-submeta">Fulfilment ${escapeHtml(line.fulfilmentMethodName)}</div>`
                    : ""
                }
              </div>
            </div>
            <div class="kiosk-cart-line-options">${escapeHtml(selectionsToSummary(line.optionsSelections) || "No options selected yet")}</div>
            <label class="kiosk-cart-price-field">
              <span>Agreed price</span>
              <input type="number" ${isLockedPromotion ? "readonly disabled" : 'min="0"'} step="0.01" value="${line.salePrice.toFixed(2)}" data-action="price" data-cart-index="${index}">
            </label>
            <div class="kiosk-cart-line-controls">
              <input type="number" min="1" step="1" value="${line.quantity}" data-action="qty" data-cart-index="${index}" ${isLockedPromotion ? "readonly disabled" : ""}>
              ${
                isLockedPromotion
                  ? '<span class="kiosk-cart-line-lock">Auto applied</span>'
                  : `<button class="btn-secondary" type="button" data-action="cart-edit" data-cart-index="${index}">Edit</button>
            <button class="btn-primary" type="button" data-action="remove" data-cart-index="${index}">Remove</button>`
              }
          </div>
        </article>
      `;
      })
      .join("");
  }

  function setCartOpen(isOpen) {
    const drawer = byId("kioskCartDrawer");
    const toggle = byId("kioskCartToggle");
    if (!drawer || !toggle) return;

    if (!isOpen) {
      setCheckoutOpen(false);
    }
    drawer.classList.toggle("is-open", isOpen);
    drawer.setAttribute("aria-hidden", isOpen ? "false" : "true");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    document.body.classList.toggle("kiosk-cart-open", isOpen);
    if (!isOpen) state.promotionsCollapsed = true;
    document.body.classList.toggle("kiosk-promotions-collapsed", !!state.promotionsCollapsed);
    renderCartPromotions();
  }

  function setPromotionsCollapsed(collapsed) {
    state.promotionsCollapsed = !!collapsed;
    document.body.classList.toggle("kiosk-promotions-collapsed", state.promotionsCollapsed);
    renderCartPromotions();
  }

  async function ensureOptionsCached(itemId, itemData) {
    window.optionsCache = window.optionsCache || {};
    if (window.optionsCache[itemId] && Object.keys(window.optionsCache[itemId]).length) return;

    const fromDb =
      (await window.itemOptionsCache?.getOptionsForItem?.(itemId).catch(() => ({}))) || {};
    if (Object.keys(fromDb).length) {
      window.optionsCache[itemId] = fromDb;
      return;
    }

    const legacy = {};
    Object.entries(itemData || {}).forEach(([key, value]) => {
      if (!String(key).toLowerCase().startsWith("option :")) return;
      const fieldName = String(key).replace(/^option\s*:\s*/i, "").trim();
      if (!fieldName || fieldName.toLowerCase() === "size.v1") return;
      const values = String(value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (values.length) legacy[fieldName] = values;
    });
    window.optionsCache[itemId] = legacy;
  }

  async function openOptionsForCartIndex(index) {
    const line = state.cart[index];
    if (!line) return;

    await ensureOptionsCached(line.itemId, line.sourceItem);
    state.activeCartIndex = index;

    const url = `/options.html?itemId=${encodeURIComponent(line.itemId)}&selections=${encodeURIComponent(
      JSON.stringify(line.optionsSelections || {})
    )}`;
    const popup = window.open(
      url,
      "ItemOptions",
      "width=600,height=500,resizable=yes,scrollbars=yes"
    );
    popup?.focus();
  }

  async function loadFulfilmentMethods() {
    try {
      const response = await fetch("/api/netsuite/fulfilmentmethods");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.fulfilmentMethods = (payload.results || []).map((entry) => ({
        id: String(entry["Internal ID"] || entry.id || "").trim(),
        name: String(entry["Name"] || entry.name || "").trim(),
      }));
    } catch (err) {
      console.warn("Failed to load fulfilment methods for kiosk:", err);
      state.fulfilmentMethods = [];
    }
  }

  function renderLineModalFulfilment(value) {
    const select = byId("kioskLineModalFulfilment");
    if (!select) return;

    select.innerHTML = '<option value="">Select fulfilment method...</option>';
    state.fulfilmentMethods.forEach((method) => {
      const option = document.createElement("option");
      option.value = method.id;
      option.textContent = method.name;
      select.appendChild(option);
    });
    select.value = String(value || "");
  }

  function updateLineModalSummary() {
    const config = state.pendingLineConfig;
    if (!config) return;

    const quantity = Math.max(1, parseInt(byId("kioskLineModalQty")?.value || "1", 10) || 1);
    const salePrice = clampMoney(byId("kioskLineModalPrice")?.value || 0);
    const retailTotal = config.retailPrice * quantity;
    const saleTotal = salePrice * quantity;

    byId("kioskLineModalRetailTotal").textContent = money(retailTotal);
    byId("kioskLineModalDiscount").textContent = money(Math.max(0, retailTotal - saleTotal));
  }

  function syncLineModalPriceFromPercent() {
    const config = state.pendingLineConfig;
    if (!config) return;
    const percentInput = byId("kioskLineModalRetailPercent");
    const priceInput = byId("kioskLineModalPrice");
    if (!percentInput || !priceInput) return;

    const discountPercent = clampPercent(percentInput.value || 0);
    percentInput.value = discountPercent.toFixed(1).replace(/\.0$/, "");
    priceInput.value = (config.retailPrice * (1 - discountPercent / 100)).toFixed(2);
    updateLineModalSummary();
  }

  function syncLineModalPercentFromPrice() {
    const config = state.pendingLineConfig;
    if (!config) return;
    const percentInput = byId("kioskLineModalRetailPercent");
    const priceInput = byId("kioskLineModalPrice");
    if (!percentInput || !priceInput) return;

    const salePrice = clampMoney(priceInput.value || 0);
    priceInput.value = salePrice.toFixed(2);
    const discountPercent =
      config.retailPrice > 0
        ? clampPercent(((config.retailPrice - salePrice) / config.retailPrice) * 100)
        : 0;
    percentInput.value = discountPercent.toFixed(1).replace(/\.0$/, "");
    updateLineModalSummary();
  }

  function syncLineModalInventoryState() {
    const config = state.pendingLineConfig;
    if (!config) return;

    const inventoryBlock = byId("kioskLineModalInventoryBlock");
    const inventoryState = byId("kioskLineModalInventoryState");
    const inventorySummary = byId("kioskLineModalInventorySummary");
    const fulfilmentMethod = String(byId("kioskLineModalFulfilment")?.value || "").trim();
    const isService = isServiceClass(config.child ? getItemClass(config.child) : "");
    const inventoryRequired = fulfilmentRequiresInventory(fulfilmentMethod);

    if (inventoryBlock) inventoryBlock.hidden = !inventoryRequired || isService;
    if (!inventoryRequired || isService) {
      if (inventoryState) inventoryState.textContent = "Inventory allocation not required";
      if (inventorySummary) inventorySummary.textContent = "No inventory selected yet.";
      return;
    }

    const hasInventory = !!String(config.inventoryDetail || "").trim();
    if (inventoryState) {
      inventoryState.textContent = hasInventory ? "Inventory allocated for this line" : "Inventory allocation required";
    }
    if (inventorySummary) {
      inventorySummary.textContent = inventoryDetailToSummary(config.inventoryDetail || "");
    }
  }

  function syncLineModalOptionsState() {
    const config = state.pendingLineConfig;
    if (!config) return;

    const summaryText = selectionsToSummary(config.optionsSelections || {});
    const stateEl = byId("kioskLineModalOptionsState");
    const summaryEl = byId("kioskLineModalOptionsSummary");
    if (stateEl) {
      stateEl.textContent = summaryText ? "Options saved for this line" : "Options required before adding";
    }
    if (summaryEl) {
      summaryEl.textContent = summaryText || "No options selected yet.";
    }
  }

  async function openLineConfigModal(group, cartIndex = null, overrides = {}) {
    if (!state.fulfilmentMethods.length) {
      await loadFulfilmentMethods();
    }

    const child =
      overrides.child ||
      (cartIndex === null ? getSelectedChildForGroup(group) : state.cart[cartIndex]?.sourceItem);
    if (!child) return;

    await ensureOptionsCached(getItemId(child), child);

    const existingLine = cartIndex === null ? null : state.cart[cartIndex];
    const image = getItemImage(child) || getItemImage(group?.parentItem) || "";
    const retailPrice = getRetailPrice(child);
    const hasOptions = !!Object.keys(window.optionsCache?.[getItemId(child)] || {}).length;

    state.pendingLineConfig = {
      mode: cartIndex === null ? "add" : "edit",
      cartIndex,
      groupId: group?.groupId || existingLine?.groupId || getParentId(child) || getItemId(child),
      child,
      retailPrice,
      image,
      discountPercent:
        cartIndex === null && Number.isFinite(Number(overrides.discountPercent))
          ? clampPercent(overrides.discountPercent)
          : retailPrice > 0
          ? clampPercent(((retailPrice - (Number(existingLine?.salePrice ?? retailPrice) || 0)) / retailPrice) * 100)
          : 0,
      optionsSelections: { ...(existingLine?.optionsSelections || {}) },
      inventoryDetail: String(existingLine?.inventoryDetail || "").trim(),
      inventoryMeta: String(existingLine?.inventoryMeta || "").trim(),
      inventoryMetaJson: String(existingLine?.inventoryMetaJson || "").trim(),
      lotnumber: String(existingLine?.lotnumber || "").trim(),
      hasOptions,
      parentName: group ? getGroupName(group) : existingLine?.parentName || getItemName(child),
      promotionMeta: existingLine?.promotionMeta || overrides.promotionMeta || null,
    };

    const modal = byId("kioskLineModal");
    const thumb = byId("kioskLineModalThumb");
    const itemName = byId("kioskLineModalItemName");
    const itemMeta = byId("kioskLineModalItemMeta");
    const qtyInput = byId("kioskLineModalQty");
    const percentInput = byId("kioskLineModalRetailPercent");
    const priceInput = byId("kioskLineModalPrice");
    const optionsBlock = byId("kioskLineModalOptionsBlock");
    const saveButton = byId("kioskLineModalSave");

    if (thumb) {
      thumb.innerHTML = image
        ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(getItemName(child))}" loading="lazy" decoding="async">`
        : '<div class="kiosk-line-item-thumb-placeholder">EPOS</div>';
    }
    if (itemName) itemName.textContent = getItemName(child);
    if (itemMeta) {
      itemMeta.textContent = `${getItemClass(child)} | Retail ${money(retailPrice)} each | Child ID ${getItemId(child)}`;
    }
    if (qtyInput) qtyInput.value = String(existingLine?.quantity || 1);
    if (percentInput) percentInput.value = state.pendingLineConfig.discountPercent.toFixed(1).replace(/\.0$/, "");
    if (priceInput) {
      const startingPrice =
        cartIndex === null && Number.isFinite(Number(overrides.discountPercent))
          ? retailPrice * (1 - clampPercent(overrides.discountPercent) / 100)
          : Number(existingLine?.salePrice ?? retailPrice);
      priceInput.value = Number(startingPrice || 0).toFixed(2);
    }
    if (optionsBlock) optionsBlock.hidden = !hasOptions;
    if (saveButton) saveButton.textContent = cartIndex === null ? "Add To Cart" : "Save Changes";

    renderLineModalFulfilment(existingLine?.fulfilmentMethod || "");

    const fulfilmentField = byId("kioskLineModalFulfilment")?.closest(".kiosk-line-field");
    const serviceItem = isServiceClass(getItemClass(child));
    if (fulfilmentField) fulfilmentField.hidden = serviceItem;
    if (serviceItem) {
      const fulfilmentSelect = byId("kioskLineModalFulfilment");
      if (fulfilmentSelect) fulfilmentSelect.value = "";
    }

    syncLineModalOptionsState();
    syncLineModalInventoryState();
    syncLineModalPercentFromPrice();

    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("kiosk-line-modal-open");
  }

  function closeLineConfigModal() {
    const modal = byId("kioskLineModal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("kiosk-line-modal-open");
    state.pendingLineConfig = null;
  }

  function openLineModalInventoryPopup() {
    const config = state.pendingLineConfig;
    if (!config) return;

    const fulfilmentMethod = String(byId("kioskLineModalFulfilment")?.value || "").trim();
    if (!fulfilmentRequiresInventory(fulfilmentMethod)) return;

    const qty = Math.max(1, parseInt(byId("kioskLineModalQty")?.value || "1", 10) || 1);
    const detail = String(config.inventoryDetail || "").trim();
    const url =
      `/inventory.html?itemId=${encodeURIComponent(getItemId(config.child))}` +
      `&qty=${encodeURIComponent(qty)}&detail=${encodeURIComponent(detail)}&line=${encodeURIComponent("-1")}`;
    const popup = window.open(
      url,
      "InventoryDetail",
      "width=900,height=700,resizable=yes,scrollbars=yes"
    );
    popup?.focus();
  }

  function saveLineConfigFromModal() {
    const config = state.pendingLineConfig;
    if (!config) return;

    const quantity = Math.max(1, parseInt(byId("kioskLineModalQty")?.value || "1", 10) || 1);
    const salePrice = clampMoney(byId("kioskLineModalPrice")?.value || 0);
    const fulfilmentMethod = String(byId("kioskLineModalFulfilment")?.value || "").trim();

    const serviceItem = isServiceClass(getItemClass(config.child));

    if (!serviceItem && !fulfilmentMethod) {
      window.alert("Please choose a fulfilment method before adding this item.");
      return;
    }

    if (config.hasOptions && !selectionsToSummary(config.optionsSelections || {})) {
      window.alert("Please configure the item options before adding this item.");
      return;
    }

    if (!serviceItem && fulfilmentRequiresInventory(fulfilmentMethod) && !String(config.inventoryDetail || "").trim()) {
      window.alert("Please allocate inventory before adding this item.");
      return;
    }

    const lineData = {
      itemId: getItemId(config.child),
      name: getItemName(config.child),
      parentName: config.parentName,
      groupId: config.groupId,
      itemClass: getItemClass(config.child),
      quantity,
      retailPrice: config.retailPrice,
      salePrice,
      image: config.image,
      optionsSelections: { ...(config.optionsSelections || {}) },
      inventoryDetail: String(config.inventoryDetail || "").trim(),
      inventoryMeta: String(config.inventoryMeta || config.inventoryDetail || "").trim(),
      inventoryMetaJson: String(config.inventoryMetaJson || "").trim(),
      lotnumber: String(config.lotnumber || "").trim(),
      fulfilmentMethod: serviceItem ? "" : fulfilmentMethod,
      fulfilmentMethodName: serviceItem ? "" : getFulfilmentNameById(fulfilmentMethod),
      sourceItem: config.child,
      promotionMeta: config.promotionMeta || null,
    };

    if (config.mode === "edit" && Number.isInteger(config.cartIndex) && state.cart[config.cartIndex]) {
      state.cart[config.cartIndex] = {
        ...state.cart[config.cartIndex],
        ...lineData,
      };
    } else {
      state.cart.push(lineData);
    }

    refreshCartState();
    closeLineConfigModal();
  }

  function setCheckoutOpen(isOpen) {
    const drawer = byId("kioskCartDrawer");
    const panel = byId("kioskCheckoutPanel");
    const checkoutBtn = byId("kioskCartCheckout");
    const cartToggle = byId("kioskCartToggle");
    const promotionToggle = byId("kioskPromotionToggle");
    if (drawer) drawer.classList.toggle("is-checkout", isOpen);
    if (panel) panel.hidden = !isOpen;
    if (checkoutBtn) checkoutBtn.textContent = isOpen ? "Checkout Open" : "Checkout";
    document.body.classList.toggle("kiosk-checkout-open", isOpen);
    if (cartToggle) {
      cartToggle.hidden = isOpen;
      cartToggle.setAttribute("aria-hidden", isOpen ? "true" : "false");
    }
    if (promotionToggle) {
      promotionToggle.hidden = isOpen || !getUpsellSuggestions().length;
      promotionToggle.setAttribute("aria-hidden", promotionToggle.hidden ? "true" : "false");
    }
    if (isOpen) setCheckoutStep(state.checkoutStep || "customer");
  }

  function setCheckoutStep(step) {
    state.checkoutStep = ["order", "payment"].includes(step) ? step : "customer";
    const isOrder = state.checkoutStep === "order";
    const isPayment = state.checkoutStep === "payment";
    const customerStage = byId("kioskCheckoutCustomerStage");
    const orderStage = byId("kioskCheckoutOrderStage");
    const paymentStage = byId("kioskCheckoutPaymentStage");
    const customerStep = byId("kioskCheckoutStepCustomer");
    const orderStep = byId("kioskCheckoutStepOrder");
    const paymentStep = byId("kioskCheckoutStepPayment");
    const title = byId("kioskCheckoutTitleText");

    if (customerStage) customerStage.hidden = isOrder || isPayment;
    if (orderStage) orderStage.hidden = !isOrder;
    if (paymentStage) paymentStage.hidden = !isPayment;
    if (customerStep) customerStep.classList.toggle("is-active", !isOrder && !isPayment);
    if (orderStep) orderStep.classList.toggle("is-active", isOrder);
    if (paymentStep) paymentStep.classList.toggle("is-active", isPayment);
    if (title) title.textContent = isPayment ? "Payment" : isOrder ? "Order details" : "Customer details";
  }

  function getCheckoutFieldValues() {
    return {
      title: String(byId("kioskCheckoutTitle")?.value || "").trim(),
      firstName: String(byId("kioskCheckoutFirstName")?.value || "").trim(),
      lastName: String(byId("kioskCheckoutLastName")?.value || "").trim(),
      email: String(byId("kioskCheckoutEmail")?.value || "").trim(),
      contactNumber: String(byId("kioskCheckoutContactNumber")?.value || "").trim(),
      altContactNumber: String(byId("kioskCheckoutAltContactNumber")?.value || "").trim(),
      postcode: String(byId("kioskCheckoutPostcode")?.value || "").trim(),
      address1: String(byId("kioskCheckoutAddress1")?.value || "").trim(),
      address2: String(byId("kioskCheckoutAddress2")?.value || "").trim(),
      address3: String(byId("kioskCheckoutAddress3")?.value || "").trim(),
      county: String(byId("kioskCheckoutCounty")?.value || "").trim(),
      countyName:
        window.EposCountySelect?.getName?.(byId("kioskCheckoutCounty")) ||
        byId("kioskCheckoutCounty")?.selectedOptions?.[0]?.textContent?.trim() ||
        String(byId("kioskCheckoutCounty")?.value || "").trim(),
      noAddressRequired: !!byId("kioskCheckoutNoAddress")?.checked,
      store: String(byId("kioskCheckoutStore")?.value || "").trim(),
      leadSource: String(byId("kioskCheckoutLeadSource")?.value || "").trim(),
      paymentInfo: String(byId("kioskCheckoutPaymentInfo")?.value || "").trim(),
      warehouse: String(byId("kioskCheckoutWarehouse")?.value || "").trim(),
      memo: String(byId("kioskCheckoutMemo")?.value || "").trim(),
      depositMethod: String(byId("kioskCheckoutDepositMethod")?.value || "").trim(),
      depositAmount: clampMoney(byId("kioskCheckoutDepositAmount")?.value || 0),
    };
  }

  function toNameCase(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function sanitizePhoneInput(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function hasSuspiciousEmailTypos(email) {
    const normalized = String(email || "").trim().toLowerCase();
    return [
      ".con",
      ".cmo",
      ".coo",
      ".cm",
      "@gamil.",
      "@gmial.",
      "@hotnail.",
      "@outlok.",
      "@yaho.",
    ].some((fragment) => normalized.includes(fragment));
  }

  function validateEmailAddress(email) {
    const normalized = String(email || "").trim().toLowerCase();
    const basicPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!normalized) return "Email is required.";
    if (!basicPattern.test(normalized)) return "Enter a valid email address.";
    if (hasSuspiciousEmailTypos(normalized)) return "Email looks misspelled. Please double-check it.";
    return "";
  }

  function setFieldError(el, hasError) {
    if (!el) return;
    el.classList.toggle("kiosk-field-error", !!hasError);
  }

  function clearCheckoutFieldErrors() {
    document
      .querySelectorAll("#kioskCheckoutPanel .kiosk-field-error")
      .forEach((el) => el.classList.remove("kiosk-field-error"));
  }

  function bindCheckoutInputFormatting() {
    if (state.checkoutValidatorsBound) return;
    state.checkoutValidatorsBound = true;

    ["kioskCheckoutFirstName", "kioskCheckoutLastName"].forEach((id) => {
      byId(id)?.addEventListener("blur", (event) => {
        event.target.value = toNameCase(event.target.value);
      });
    });

    ["kioskCheckoutContactNumber", "kioskCheckoutAltContactNumber"].forEach((id) => {
      byId(id)?.addEventListener("input", (event) => {
        event.target.value = sanitizePhoneInput(event.target.value);
      });
    });

    byId("kioskCheckoutEmail")?.addEventListener("blur", (event) => {
      event.target.value = String(event.target.value || "").trim().toLowerCase();
      const emailError = validateEmailAddress(event.target.value);
      setFieldError(event.target, !!emailError);
      if (emailError) setCheckoutStatus(emailError, true);
    });
  }

  function setCheckoutStatus(message, isError = false) {
    const el = byId("kioskCheckoutMatchStatus");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = isError ? "#fca5a5" : "rgba(248, 250, 252, 0.78)";
  }

  function applyCheckoutNoAddressState() {
    const noAddressRequired = !!byId("kioskCheckoutNoAddress")?.checked;
    [
      "kioskCheckoutPostcode",
      "kioskCheckoutAddress1",
      "kioskCheckoutAddress2",
      "kioskCheckoutAddress3",
      "kioskCheckoutCounty",
      "kioskCheckoutFindAddress",
      "kioskCheckoutAddressResults",
    ].forEach((id) => {
      const el = byId(id);
      if (!el) return;
      if (id === "kioskCheckoutAddressResults") {
        el.hidden = noAddressRequired || !(state.addressResults || []).length;
      } else {
        el.disabled = noAddressRequired;
      }
    });

    if (noAddressRequired) {
      state.matchedCustomerId = null;
      setCheckoutStatus("New customer will be created without an address.");
    }
  }

  async function loadActivePromotions() {
    try {
      const data = await fetch("/api/promotions/active", {
        headers: getAuthHeaders(),
      }).then((res) => res.json());

      if (!data?.ok || !data.promotions) {
        throw new Error(data?.error || "Unable to load promotions");
      }

      state.promotions = {
        upsells: Array.isArray(data.promotions.upsells) ? data.promotions.upsells : [],
        basketDiscounts: Array.isArray(data.promotions.basketDiscounts)
          ? data.promotions.basketDiscounts
          : [],
      };
    } catch (err) {
      console.warn("Failed to load kiosk promotions:", err);
      state.promotions = { upsells: [], basketDiscounts: [] };
    }
  }

  async function loadCheckoutReferenceData() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};

    const requests = await Promise.all([
      fetch("/api/me", { headers }).then((res) => res.json()).catch(() => null),
      fetch("/api/meta/locations", { headers }).then((res) => res.json()).catch(() => null),
      fetch("/api/netsuite/titles").then((res) => res.json()).catch(() => null),
      fetch("/api/netsuite/leadsource").then((res) => res.json()).catch(() => null),
      fetch("/api/netsuite/paymentinfo").then((res) => res.json()).catch(() => null),
      fetch("/api/netsuite/paymentmethods").then((res) => res.json()).catch(() => null),
      fetch("/api/netsuite/warehouse").then((res) => res.json()).catch(() => null),
    ]);

    const [meData, locationsData, titlesData, leadSourcesData, paymentInfoData, paymentMethodsData, warehouseData] = requests;

    if (meData?.ok && meData.user) {
      state.currentUser = meData.user;
      byId("kioskCheckoutSalesExec").value = `${meData.user.firstName || ""} ${meData.user.lastName || ""}`.trim();
    }

    if (locationsData?.ok && Array.isArray(locationsData.locations)) {
      state.locations = locationsData.locations.slice();
      const storeSelect = byId("kioskCheckoutStore");
      if (storeSelect) {
        storeSelect.innerHTML = '<option value="">Select store</option>';
        state.locations
          .filter((loc) => !/warehouse/i.test(String(loc.name || "")))
          .forEach((loc) => {
            const option = document.createElement("option");
            option.value = String(loc.id);
            option.textContent = String(loc.name || `Store ${loc.id}`);
            storeSelect.appendChild(option);
          });
      }

      const match = state.locations.find(
        (loc) =>
          String(loc.id) === String(state.currentUser?.primaryStore || "") ||
          String(loc.name || "").trim() === String(state.currentUser?.primaryStore || "").trim()
      );
      state.currentStoreName = match?.name || "";
      if (storeSelect && match?.id != null) {
        storeSelect.value = String(match.id);
      }
    }

    const selectConfigs = [
      {
        id: "kioskCheckoutTitle",
        items: titlesData?.results || [],
        placeholder: "Select title",
        labelKeys: ["Name", "Title", "text", "label"],
      },
      {
        id: "kioskCheckoutLeadSource",
        items: leadSourcesData?.results || [],
        placeholder: "Select lead source",
        labelKeys: ["Title", "Name", "text", "label"],
      },
      {
        id: "kioskCheckoutPaymentInfo",
        items: paymentInfoData?.results || [],
        placeholder: "Select payment info",
        labelKeys: ["Name", "Title", "text", "label"],
      },
      {
        id: "kioskCheckoutDepositMethod",
        items: paymentMethodsData?.results || [],
        placeholder: "Select payment method",
        labelKeys: ["Name", "Title", "text", "label"],
      },
      {
        id: "kioskCheckoutWarehouse",
        items: warehouseData?.results || [],
        placeholder: "Select warehouse",
        labelKeys: ["Name", "Title", "text", "label"],
      },
    ];

    selectConfigs.forEach(({ id, items, placeholder, labelKeys }) => {
      const select = byId(id);
      if (!select) return;
      select.innerHTML = `<option value="">${placeholder}</option>`;
      (items || []).forEach((entry) => {
        const value = String(entry["Internal ID"] || entry.id || "").trim();
        const name = labelKeys
          .map((key) => entry[key])
          .find((candidate) => typeof candidate === "string" && candidate.trim())
          || entry.name
          || "";
        if (!value) return;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = String(name).trim() || value;
        select.appendChild(option);
      });
    });
  }

  async function lookupCheckoutAddress() {
    const postcode = String(byId("kioskCheckoutPostcode")?.value || "").trim();
    if (!postcode) {
      window.alert("Please enter a postcode first.");
      return;
    }

    const results = byId("kioskCheckoutAddressResults");
    if (results) {
      results.hidden = false;
      results.innerHTML = "<option>Searching...</option>";
    }

    try {
      const response = await fetch(`/api/fetchify/postcode/${encodeURIComponent(postcode)}`);
      const data = await response.json();
      state.addressResults = Array.isArray(data.addresses) ? data.addresses : [];

      if (!results) return;
      if (!state.addressResults.length) {
        results.innerHTML = "<option>No results found</option>";
        return;
      }

      results.innerHTML = '<option value="">Select an address</option>';
      state.addressResults.forEach((address, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = [
          address.line_1,
          address.line_2,
          address.line_3,
          address.county,
          address.postcode,
        ]
          .filter(Boolean)
          .join(", ");
        results.appendChild(option);
      });
      results.hidden = false;
    } catch (err) {
      console.error("Kiosk Fetchify lookup failed:", err);
      window.alert("Unable to fetch address details right now.");
    }
  }

  function applyCheckoutAddressSelection(index) {
    const address = state.addressResults?.[Number(index)];
    if (!address) return;
    byId("kioskCheckoutAddress1").value = address.line_1 || "";
    byId("kioskCheckoutAddress2").value = address.line_2 || "";
    byId("kioskCheckoutAddress3").value = address.line_3 || "";
    byId("kioskCheckoutCounty").value = address.county || "";
    byId("kioskCheckoutPostcode").value = address.postcode || "";
  }

  async function runCustomerMatch() {
    const values = getCheckoutFieldValues();
    if (values.noAddressRequired) {
      state.matchedCustomerId = null;
      setCheckoutStatus("New customer will be created without an address.");
      return null;
    }

    if (!values.email || !values.lastName || !values.postcode) {
      setCheckoutStatus("Enter email, last name and postcode to check for an existing customer.", true);
      return null;
    }

    try {
      setCheckoutStatus("Checking for an existing customer...");
      const qs = new URLSearchParams({
        email: values.email,
        lastName: values.lastName,
        postcode: values.postcode,
      }).toString();
      const response = await fetch(`/api/netsuite/customermatch?${qs}`);
      const data = await response.json();

      if (data.ok && Array.isArray(data.results) && data.results.length > 0) {
        const match = data.results[0];
        state.matchedCustomerId = match["Internal ID"] || match["ID"] || null;
        setCheckoutStatus(
          `Existing customer found: ${state.matchedCustomerId} - ${match["Name"] || match["Last Name"] || "Unknown"}`
        );
        return state.matchedCustomerId;
      }

      state.matchedCustomerId = null;
      setCheckoutStatus("No existing customer found. A new customer will be created.");
      return null;
    } catch (err) {
      console.error("Kiosk customer match failed:", err);
      state.matchedCustomerId = null;
      setCheckoutStatus("Customer match lookup failed.", true);
      return false;
    }
  }

  function validateCheckoutForm() {
    const values = getCheckoutFieldValues();
    const errors = [];
    clearCheckoutFieldErrors();

    if (!values.title) {
      errors.push("Title is required.");
      setFieldError(byId("kioskCheckoutTitle"), true);
    }
    if (!values.firstName) {
      errors.push("First name is required.");
      setFieldError(byId("kioskCheckoutFirstName"), true);
    }
    if (!values.lastName) {
      errors.push("Last name is required.");
      setFieldError(byId("kioskCheckoutLastName"), true);
    }

    const emailError = validateEmailAddress(values.email);
    if (emailError) {
      errors.push(emailError);
      setFieldError(byId("kioskCheckoutEmail"), true);
    }

    if (!values.leadSource) {
      errors.push("Lead source is required.");
      setFieldError(byId("kioskCheckoutLeadSource"), true);
    }
    if (!values.paymentInfo) {
      errors.push("Payment info is required.");
      setFieldError(byId("kioskCheckoutPaymentInfo"), true);
    }
    if (!values.warehouse) {
      errors.push("Warehouse is required.");
      setFieldError(byId("kioskCheckoutWarehouse"), true);
    }
    if (!values.store) {
      errors.push("Store is required.");
      setFieldError(byId("kioskCheckoutStore"), true);
    }

    if (!values.noAddressRequired) {
      if (!values.postcode) {
        errors.push("Postcode is required.");
        setFieldError(byId("kioskCheckoutPostcode"), true);
      }
      if (!values.address1) {
        errors.push("Address line 1 is required.");
        setFieldError(byId("kioskCheckoutAddress1"), true);
      }
    }

    if ((values.depositAmount > 0 && !values.depositMethod) || (values.depositMethod && !(values.depositAmount > 0))) {
      errors.push("Enter both a payment method and a deposit amount, or leave both blank.");
      setFieldError(byId("kioskCheckoutDepositMethod"), true);
      setFieldError(byId("kioskCheckoutDepositAmount"), true);
    }

    if (!state.currentUser?.id) errors.push("Current user could not be resolved.");

    return errors;
  }

  function validateCustomerStep() {
    const values = getCheckoutFieldValues();
    const errors = [];
    clearCheckoutFieldErrors();

    if (!values.title) {
      errors.push("Title is required.");
      setFieldError(byId("kioskCheckoutTitle"), true);
    }
    if (!values.firstName) {
      errors.push("First name is required.");
      setFieldError(byId("kioskCheckoutFirstName"), true);
    }
    if (!values.lastName) {
      errors.push("Last name is required.");
      setFieldError(byId("kioskCheckoutLastName"), true);
    }
    const emailError = validateEmailAddress(values.email);
    if (emailError) {
      errors.push(emailError);
      setFieldError(byId("kioskCheckoutEmail"), true);
    }

    if (!values.noAddressRequired) {
      if (!values.postcode) {
        errors.push("Postcode is required.");
        setFieldError(byId("kioskCheckoutPostcode"), true);
      }
      if (!values.address1) {
        errors.push("Address line 1 is required.");
        setFieldError(byId("kioskCheckoutAddress1"), true);
      }
    }

    return errors;
  }

  function validateOrderStep() {
    const values = getCheckoutFieldValues();
    const errors = [];
    clearCheckoutFieldErrors();

    if (!values.leadSource) {
      errors.push("Lead source is required.");
      setFieldError(byId("kioskCheckoutLeadSource"), true);
    }
    if (!values.paymentInfo) {
      errors.push("Payment info is required.");
      setFieldError(byId("kioskCheckoutPaymentInfo"), true);
    }
    if (!values.warehouse) {
      errors.push("Warehouse is required.");
      setFieldError(byId("kioskCheckoutWarehouse"), true);
    }
    if (!values.store) {
      errors.push("Store is required.");
      setFieldError(byId("kioskCheckoutStore"), true);
    }
    if (!state.currentUser?.id) errors.push("Current user could not be resolved.");

    return errors;
  }

  function validatePaymentStep() {
    const values = getCheckoutFieldValues();
    const errors = [];
    clearCheckoutFieldErrors();

    if ((values.depositAmount > 0 && !values.depositMethod) || (values.depositMethod && !(values.depositAmount > 0))) {
      errors.push("Enter both a payment method and a deposit amount, or leave both blank.");
      setFieldError(byId("kioskCheckoutDepositMethod"), true);
      setFieldError(byId("kioskCheckoutDepositAmount"), true);
    }

    return errors;
  }

  async function submitCheckout(mode = "sale") {
    if (state.checkoutSubmitting) return;

    if (!state.cart.length) {
      window.alert("Please add at least one item to the cart first.");
      return;
    }

    const errors = validateCheckoutForm();
    if (errors.length) {
      window.alert(errors.join("\n"));
      return;
    }

    state.checkoutSubmitting = true;
    const submitButton = mode === "quote" ? byId("kioskCheckoutCreateQuote") : byId("kioskCheckoutCreateSale");
    const otherButton = mode === "quote" ? byId("kioskCheckoutCreateSale") : byId("kioskCheckoutCreateQuote");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Creating...";
    }
    if (otherButton) otherButton.disabled = true;

    try {
      const customerMatchId = await runCustomerMatch();
      if (customerMatchId === false) {
        throw new Error("Customer match lookup failed. Please try again.");
      }
      const values = getCheckoutFieldValues();
      const saved = typeof storageGet === "function" ? storageGet() : null;

      const payload = {
        customer: {
          id: values.noAddressRequired ? null : customerMatchId || state.matchedCustomerId || null,
          noAddressRequired: values.noAddressRequired,
          title: values.title,
          firstName: values.firstName,
          lastName: values.lastName,
          postcode: values.postcode,
          address1: values.address1,
          address2: values.address2,
          address3: values.address3,
          county: values.county,
          countyName: values.countyName,
          contactNumber: values.contactNumber,
          altContactNumber: values.altContactNumber,
          email: values.email,
        },
        order: {
          salesExec: state.currentUser.id,
          store: values.store,
          distributionOrderType: "",
          leadSource: values.leadSource,
          paymentInfo: values.paymentInfo,
          warehouse: values.warehouse,
          memo: values.memo,
        },
        items: state.cart.map((line) => ({
          item: line.itemId,
          class: line.itemClass,
          quantity: line.quantity,
          amount: Number((line.salePrice * line.quantity).toFixed(2)),
          options: selectionsToSummary(line.optionsSelections || {}),
          fulfilmentMethod: line.fulfilmentMethod || "",
          lotnumber: line.lotnumber || "",
          inventoryMeta: line.inventoryMeta || "",
          trialOption: "",
        })),
        deposits:
          values.depositAmount > 0 && values.depositMethod
            ? [
                {
                  id: values.depositMethod,
                  name:
                    byId("kioskCheckoutDepositMethod")?.options[byId("kioskCheckoutDepositMethod").selectedIndex]?.textContent || "",
                  amount: values.depositAmount,
                },
              ]
            : [],
      };

      const url = mode === "quote" ? "/api/netsuite/quote/create" : "/api/netsuite/salesorder/create";
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!data.ok) {
        throw new Error(data.error || `${mode === "quote" ? "Quote" : "Sale"} creation failed`);
      }

      if (mode === "quote") {
        const quoteId = data.quoteId || data.response?.id || null;
        if (quoteId) window.location.href = `/quote/view/${quoteId}`;
        throw new Error("Quote was created but no quote ID was returned.");
      }

      const soId = data.salesOrderId || null;
      const tranId = data.tranId || data.response?.tranId || null;
      if (soId) localStorage.setItem("currentSalesOrderId", soId);
      if (tranId) localStorage.setItem("currentSalesOrderTranId", tranId);

      window.location.href = `/sales/view/${tranId || soId}`;
    } catch (err) {
      console.error(`Kiosk ${mode} checkout failed:`, err);
      window.alert(err.message || `Unable to create the ${mode === "quote" ? "quote" : "sale"}.`);
    } finally {
      state.checkoutSubmitting = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = mode === "quote" ? "Create Quote" : "Create Sale";
      }
      if (otherButton) otherButton.disabled = false;
    }
  }

  async function openCheckoutPanel() {
    if (!state.cart.length) {
      window.alert("Please add at least one item to the cart first.");
      return;
    }

    setCartOpen(true);
    setCheckoutStep("customer");
    setCheckoutOpen(true);
    if (!state.currentUser) {
      await loadCheckoutReferenceData();
    }
    bindCheckoutInputFormatting();
    applyCheckoutNoAddressState();
  }

  function bindEvents() {
    const scheduleRender = debounce(renderProducts, 120);

    byId("kioskSearch")?.addEventListener("input", scheduleRender);
    byId("kioskClassFilter")?.addEventListener("change", renderProducts);
    byId("kioskCartToggle")?.addEventListener("click", () => {
      const isOpen = byId("kioskCartDrawer")?.classList.contains("is-open");
      setCartOpen(!isOpen);
    });
    byId("kioskCartClose")?.addEventListener("click", () => setCartOpen(false));
    byId("kioskPromotionToggle")?.addEventListener("click", () => {
      if (!byId("kioskCartDrawer")?.classList.contains("is-open")) {
        setCartOpen(true);
      }
      setPromotionsCollapsed(!state.promotionsCollapsed);
    });
    byId("kioskPromotionClose")?.addEventListener("click", () => {
      setPromotionsCollapsed(true);
    });
    byId("kioskCartCheckout")?.addEventListener("click", openCheckoutPanel);
    byId("kioskCartClear")?.addEventListener("click", () => {
      state.cart = [];
      state.matchedCustomerId = null;
      state.checkoutStep = "customer";
      setCheckoutOpen(false);
      refreshCartState();
    });
    byId("kioskCheckoutClose")?.addEventListener("click", () => setCheckoutOpen(false));
    byId("kioskCheckoutFindAddress")?.addEventListener("click", lookupCheckoutAddress);
    byId("kioskCheckoutAddressResults")?.addEventListener("change", (event) => {
      applyCheckoutAddressSelection(event.target.value);
    });
    byId("kioskCheckoutNoAddress")?.addEventListener("change", applyCheckoutNoAddressState);
    byId("kioskCheckoutMatch")?.addEventListener("click", runCustomerMatch);
    byId("kioskCheckoutNext")?.addEventListener("click", async () => {
      const errors = validateCustomerStep();
      if (errors.length) {
        window.alert(errors.join("\n"));
        return;
      }
      const customerMatchId = await runCustomerMatch();
      if (customerMatchId === false) return;
      setCheckoutStep("order");
    });
    byId("kioskCheckoutBack")?.addEventListener("click", () => setCheckoutStep("customer"));
    byId("kioskCheckoutOrderNext")?.addEventListener("click", () => {
      const errors = validateOrderStep();
      if (errors.length) {
        window.alert(errors.join("\n"));
        return;
      }
      setCheckoutStep("payment");
    });
    byId("kioskCheckoutPaymentBack")?.addEventListener("click", () => setCheckoutStep("order"));
    byId("kioskCheckoutCreateQuote")?.addEventListener("click", () => submitCheckout("quote"));
    byId("kioskCheckoutCreateSale")?.addEventListener("click", () => submitCheckout("sale"));
    byId("kioskLineModalClose")?.addEventListener("click", closeLineConfigModal);
    byId("kioskLineModalCancel")?.addEventListener("click", closeLineConfigModal);
    byId("kioskLineModalBackdrop")?.addEventListener("click", closeLineConfigModal);
    byId("kioskLineModalQty")?.addEventListener("input", () => {
      if (state.pendingLineConfig) {
        state.pendingLineConfig.inventoryDetail = "";
        state.pendingLineConfig.inventoryMeta = "";
        state.pendingLineConfig.inventoryMetaJson = "";
        state.pendingLineConfig.lotnumber = "";
        syncLineModalInventoryState();
      }
      updateLineModalSummary();
    });
    byId("kioskLineModalRetailPercent")?.addEventListener("input", syncLineModalPriceFromPercent);
    byId("kioskLineModalPrice")?.addEventListener("input", syncLineModalPercentFromPrice);
    byId("kioskLineModalFulfilment")?.addEventListener("change", () => {
      if (state.pendingLineConfig) {
        state.pendingLineConfig.inventoryDetail = "";
        state.pendingLineConfig.inventoryMeta = "";
        state.pendingLineConfig.inventoryMetaJson = "";
        state.pendingLineConfig.lotnumber = "";
      }
      syncLineModalInventoryState();
    });
    byId("kioskLineModalSave")?.addEventListener("click", saveLineConfigFromModal);
    byId("kioskLineModalInventoryBtn")?.addEventListener("click", openLineModalInventoryPopup);
    byId("kioskLineModalOptionsBtn")?.addEventListener("click", async () => {
      const config = state.pendingLineConfig;
      if (!config) return;
      await ensureOptionsCached(getItemId(config.child), config.child);
      state.activeCartIndex = null;
      const url = `/options.html?itemId=${encodeURIComponent(getItemId(config.child))}&selections=${encodeURIComponent(
        JSON.stringify(config.optionsSelections || {})
      )}`;
      const popup = window.open(
        url,
        "ItemOptions",
        "width=600,height=500,resizable=yes,scrollbars=yes"
      );
      popup?.focus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !byId("kioskLineModal")?.hidden) {
        closeLineConfigModal();
      }
    });

    byId("kioskProductGrid")?.addEventListener("change", (event) => {
      const select = event.target.closest(".kiosk-child-select");
      if (!select) return;
      state.selectedChildByGroup[String(select.dataset.groupId || "")] = String(select.value || "");
      updateGroupCard(String(select.dataset.groupId || ""));
    });

    byId("kioskProductGrid")?.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-group-id]");
      if (!button) return;

      const group = state.groups.find((entry) => entry.groupId === String(button.dataset.groupId));
      if (!group) return;

      if (button.dataset.action === "add") {
        await openLineConfigModal(group);
        return;
      }
    });

    byId("kioskCartItems")?.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-cart-index]");
      if (!button) return;

      const index = Number(button.dataset.cartIndex);
      if (!Number.isInteger(index) || !state.cart[index]) return;
      if (isBasketDiscountLine(state.cart[index])) return;

      if (button.dataset.action === "remove") {
        state.cart.splice(index, 1);
        refreshCartState();
        return;
      }

      if (button.dataset.action === "cart-edit") {
        const line = state.cart[index];
        const group =
          state.groups.find((entry) => entry.groupId === String(line.groupId || getParentId(line.sourceItem))) ||
          null;
        await openLineConfigModal(group, index);
      }
    });

    byId("kioskCartItems")?.addEventListener("change", (event) => {
      const input = event.target.closest('input[data-cart-index]');
      if (!input) return;

      const index = Number(input.dataset.cartIndex);
      if (!Number.isInteger(index) || !state.cart[index]) return;
      if (isBasketDiscountLine(state.cart[index])) return;

      if (input.dataset.action === "qty") {
        const quantity = Math.max(1, parseInt(input.value || "1", 10) || 1);
        state.cart[index].quantity = quantity;
        input.value = String(quantity);
      }

      if (input.dataset.action === "price") {
        const price = clampMoney(input.value);
        state.cart[index].salePrice = price;
        input.value = price.toFixed(2);
      }

      refreshCartState();
    });

    byId("kioskCartPromotions")?.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-promotion-id]");
      if (!button || button.dataset.action !== "add-upsell") return;

      const promotion = (state.promotions.upsells || []).find(
        (entry) => String(entry.id) === String(button.dataset.promotionId || "")
      );
      if (!promotion) return;

      const item = findItemById(promotion.suggestedItemId) || findItemByName(promotion.suggestedItemName);
      if (!item) {
        window.alert("That promotion item is no longer available in the kiosk catalogue.");
        return;
      }

      const group = findGroupForItemId(promotion.suggestedItemId) || findGroupForItemName(promotion.suggestedItemName);
      await openLineConfigModal(group, null, {
        child: item,
        discountPercent: Number(promotion.discountPercent || 0),
      });
    });

    window.onOptionsSaved = function (itemId, selections) {
      if (state.pendingLineConfig && String(getItemId(state.pendingLineConfig.child)) === String(itemId)) {
        state.pendingLineConfig.optionsSelections = selections || {};
        syncLineModalOptionsState();
        return;
      }

      if (!Number.isInteger(state.activeCartIndex)) return;
      const line = state.cart[state.activeCartIndex];
      if (!line || String(line.itemId) !== String(itemId)) return;

      line.optionsSelections = selections || {};
      refreshCartState();
      state.activeCartIndex = null;
    };

    window.onInventorySaved = function (itemId, detailString) {
      const config = state.pendingLineConfig;
      if (!config || String(getItemId(config.child)) !== String(itemId)) return;

      config.inventoryDetail = String(detailString || "").trim();
      config.inventoryMeta = config.inventoryDetail;
      config.inventoryMetaJson = "";
      config.lotnumber = "";
      syncLineModalInventoryState();
    };
  }

  async function init() {
    bindEvents();
    refreshCartState();
    loadFulfilmentMethods();

    try {
      const cachedItems = getCachedKioskItems();
      if (cachedItems.length) {
        state.items = cachedItems;
        state.groups = buildGroups(cachedItems);
        renderClassFilter();
        renderProducts();
        await loadActivePromotions();
        refreshCartState();
        setStatus(`Loaded ${state.groups.length} parent cards from cache. Refreshing in background...`);
      } else {
        setStatus("Loading catalogue...");
      }

      state.items = await fetchKioskItems(!cachedItems.length);

      state.groups = buildGroups(state.items);
      renderClassFilter();
      renderProducts();
      await loadActivePromotions();
      refreshCartState();
    } catch (err) {
      console.error("Failed to load kiosk catalogue:", err);
      setStatus("Failed to load catalogue.");
      byId("kioskProductGrid").innerHTML =
        '<div class="kiosk-empty">The kiosk catalogue could not be loaded right now.</div>';
    }
  }

  function debounce(fn, waitMs) {
    let timeoutId = null;
    return (...args) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), waitMs);
    };
  }

  document.addEventListener("DOMContentLoaded", init);
})();
