(function () {
  const state = {
    promotions: [],
    items: [],
    classes: [],
    selectedTriggerIds: [],
    labelToItem: new Map(),
    idToItem: new Map(),
    editingUpsellId: null,
    editingBasketDiscountId: null,
  };

  function byId(id) {
    return document.getElementById(id);
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
    if (saved?.token) {
      return { Authorization: `Bearer ${saved.token}` };
    }
    return {};
  }

  function setStatus(message, isError = false) {
    const el = byId("promotionsStatus");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#b91c1c" : "var(--brand)";
  }

  function formatDateRange(startDate, endDate) {
    return `${startDate || "?"} to ${endDate || "?"}`;
  }

  function itemField(item, names) {
    for (const key of Object.keys(item || {})) {
      const normalized = String(key || "").trim().toLowerCase();
      if (names.includes(normalized)) return item[key];
    }
    return "";
  }

  function getItemId(item) {
    return String(itemField(item, ["internal id", "internalid", "id"]) || "").trim();
  }

  function getItemName(item) {
    return String(itemField(item, ["name", "item name"]) || "Unnamed item").trim();
  }

  function getItemClass(item) {
    return String(itemField(item, ["class", "item class"]) || "Unclassified").trim();
  }

  function makeItemLabel(item) {
    return `${getItemName(item)} | ID ${getItemId(item)} | ${getItemClass(item)}`;
  }

  function describeTriggerSummary(promotion) {
    const triggerNames = Array.isArray(promotion.triggerItemNames)
      ? promotion.triggerItemNames.filter(Boolean)
      : [];
    const triggerClass = String(promotion.triggerClass || "").trim();
    const parts = [];

    if (triggerNames.length) {
      parts.push(triggerNames.join(", "));
    } else if (promotion.triggerItemName || promotion.triggerItemId) {
      parts.push(promotion.triggerItemName || promotion.triggerItemId);
    }

    if (triggerClass) {
      parts.push(`Any ${triggerClass}`);
    }

    return parts.join(" | ") || "No triggers";
  }

  function findItem(inputValue) {
    const raw = String(inputValue || "").trim();
    if (!raw) return null;
    if (state.labelToItem.has(raw)) return state.labelToItem.get(raw);
    if (state.idToItem.has(raw)) return state.idToItem.get(raw);
    const idMatch = raw.match(/\bID\s+(.+?)\s*(\||$)/i);
    if (idMatch && state.idToItem.has(idMatch[1].trim())) {
      return state.idToItem.get(idMatch[1].trim());
    }
    return null;
  }

  function setItemPreview(inputId, previewId) {
    const input = byId(inputId);
    const preview = byId(previewId);
    if (!input || !preview) return;

    const item = findItem(input.value);
    if (!input.value.trim()) {
      preview.textContent = "";
      preview.classList.remove("is-error");
      return;
    }

    if (!item) {
      preview.textContent = "Select an item from the kiosk catalogue.";
      preview.classList.add("is-error");
      return;
    }

    preview.textContent = `${getItemName(item)} | ID ${getItemId(item)} | ${getItemClass(item)}`;
    preview.classList.remove("is-error");
  }

  function setTriggerPreview() {
    const container = byId("upsellTriggerItems");
    const classSelect = byId("upsellTriggerClass");
    const preview = byId("upsellTriggerPreview");
    if (!container || !preview) return;

    const names = state.selectedTriggerIds
      .map((id) => state.idToItem.get(id))
      .filter(Boolean)
      .map((item) => `${getItemName(item)} | ID ${getItemId(item)} | ${getItemClass(item)}`);
    const triggerClass = String(classSelect?.value || "").trim();
    const parts = [];

    if (names.length) {
      parts.push(`${names.length} trigger item${names.length === 1 ? "" : "s"} selected: ${names.join(", ")}`);
    }
    if (triggerClass) {
      parts.push(`Class trigger: Any ${triggerClass}`);
    }

    if (!parts.length) {
      preview.textContent = "No trigger items or class selected yet.";
      preview.classList.remove("is-error");
      return;
    }

    preview.textContent = parts.join(" | ");
    preview.classList.remove("is-error");
  }

  function renderSelectedTriggers() {
    const container = byId("upsellTriggerItems");
    if (!container) return;

    if (!state.selectedTriggerIds.length) {
      container.innerHTML = '<div class="promotion-trigger-empty">No trigger items added.</div>';
      setTriggerPreview();
      return;
    }

    container.innerHTML = state.selectedTriggerIds
      .map((id) => state.idToItem.get(id))
      .filter(Boolean)
      .map((item) => `
        <div class="promotion-trigger-chip">
          <span>${escapeHtml(getItemName(item))} <small>ID ${escapeHtml(getItemId(item))} | ${escapeHtml(getItemClass(item))}</small></span>
          <button type="button" class="promotion-trigger-remove" data-trigger-id="${escapeHtml(getItemId(item))}" aria-label="Remove trigger item">×</button>
        </div>
      `)
      .join("");

    setTriggerPreview();
  }

  function addSelectedTriggerFromInput() {
    const input = byId("upsellTriggerSearch");
    if (!input) return;
    const item = findItem(input.value);
    if (!item) {
      window.alert("Choose a valid trigger item from the kiosk catalogue.");
      return;
    }
    const itemId = getItemId(item);
    if (!itemId) return;
    if (!state.selectedTriggerIds.includes(itemId)) {
      state.selectedTriggerIds.push(itemId);
    }
    input.value = "";
    renderSelectedTriggers();
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }
    return data;
  }

  async function loadCatalogue() {
    const payload = await fetchJson("/api/netsuite/kiosk-items");
    state.items = Array.isArray(payload.results) ? payload.results : [];
    state.classes = [];
    state.labelToItem.clear();
    state.idToItem.clear();

    const datalist = byId("promotionItemOptions");
    const classSelect = byId("upsellTriggerClass");

    const options = [];
    const classSet = new Set();
    state.items.forEach((item) => {
      const id = getItemId(item);
      if (!id) return;
      const label = makeItemLabel(item);
      const itemName = getItemName(item);
      const itemClass = getItemClass(item);
      state.labelToItem.set(label, item);
      state.idToItem.set(id, item);
      options.push(`<option value="${escapeHtml(label)}"></option>`);
      if (itemClass) classSet.add(itemClass);
    });

    state.classes = Array.from(classSet).sort((a, b) => a.localeCompare(b));

    if (datalist) {
      datalist.innerHTML = options.join("");
    }
    if (classSelect) {
      classSelect.innerHTML = `
        <option value="">No class trigger</option>
        ${state.classes.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
      `;
    }
    renderSelectedTriggers();
    setTriggerPreview();
  }

  async function loadPromotions() {
    setStatus("Loading promotions...");
    const data = await fetchJson("/api/promotions", {
      headers: getAuthHeaders(),
    });
    state.promotions = Array.isArray(data.promotions) ? data.promotions : [];
    renderTables();
    setStatus(`Loaded ${state.promotions.length} promotions.`);
  }

  function getUpsells() {
    return state.promotions.filter((promotion) => promotion.type === "upsell");
  }

  function getBasketDiscounts() {
    return state.promotions.filter((promotion) => promotion.type === "basket_discount");
  }

  function renderTables() {
    renderUpsells();
    renderBasketDiscounts();
  }

  function renderUpsells() {
    const body = document.querySelector("#upsellTable tbody");
    if (!body) return;

    const rows = getUpsells();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;">No upsells configured yet.</td></tr>';
      return;
    }

    body.innerHTML = rows
      .map((promotion) => `
        <tr>
          <td>
            <strong>${escapeHtml(promotion.title)}</strong>
            ${promotion.message ? `<span class="promotion-note">${escapeHtml(promotion.message)}</span>` : ""}
          </td>
          <td>${escapeHtml(describeTriggerSummary(promotion))}</td>
          <td>${escapeHtml(promotion.suggestedItemName || promotion.suggestedItemId)}</td>
          <td>${Number(promotion.discountPercent || 0).toFixed(1).replace(/\.0$/, "")}%</td>
          <td>${escapeHtml(formatDateRange(promotion.startDate, promotion.endDate))}</td>
          <td>
            <span class="promotion-status-badge ${promotion.isActive ? "is-active" : "is-inactive"}">
              ${promotion.isActive ? "Active" : "Inactive"}
            </span>
          </td>
          <td class="actions">
            <button class="action-btn action-edit" type="button" data-action="edit-upsell" data-id="${promotion.id}">Edit</button>
            <button class="action-btn action-delete" type="button" data-action="delete-promotion" data-id="${promotion.id}">Delete</button>
          </td>
        </tr>
      `)
      .join("");
  }

  function renderBasketDiscounts() {
    const body = document.querySelector("#basketDiscountTable tbody");
    if (!body) return;

    const rows = getBasketDiscounts();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;">No basket discounts configured yet.</td></tr>';
      return;
    }

    body.innerHTML = rows
      .map((promotion) => {
        const rules = Array.isArray(promotion.rules) ? promotion.rules : [];
        const rulesSummary = rules.length
          ? rules
              .map(
                (rule) =>
                  `£${Number(rule.minValue || 0).toFixed(2)} to £${Number(rule.maxValue || 0).toFixed(2)}: ${escapeHtml(rule.itemName || rule.itemId)}`
              )
              .join("<br>")
          : "No rules";

        return `
          <tr>
            <td>
              <strong>${escapeHtml(promotion.title)}</strong>
              ${promotion.message ? `<span class="promotion-note">${escapeHtml(promotion.message)}</span>` : ""}
            </td>
            <td>${escapeHtml(formatDateRange(promotion.startDate, promotion.endDate))}</td>
            <td>${rulesSummary}</td>
            <td>
              <span class="promotion-status-badge ${promotion.isActive ? "is-active" : "is-inactive"}">
                ${promotion.isActive ? "Active" : "Inactive"}
              </span>
            </td>
            <td class="actions">
              <button class="action-btn action-edit" type="button" data-action="edit-basket" data-id="${promotion.id}">Edit</button>
              <button class="action-btn action-delete" type="button" data-action="delete-promotion" data-id="${promotion.id}">Delete</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function openModal(modalId) {
    byId(modalId)?.classList.remove("hidden");
  }

  function closeModal(modalId) {
    byId(modalId)?.classList.add("hidden");
  }

  function resetUpsellForm() {
    state.editingUpsellId = null;
    byId("upsellForm")?.reset();
    byId("upsellPromotionId").value = "";
    byId("upsellDiscountPercent").value = "0";
    byId("upsellIsActive").checked = true;
    byId("upsellModalTitle").textContent = "Add Upsell";
    byId("upsellTriggerClass").value = "";
    state.selectedTriggerIds = [];
    if (byId("upsellTriggerSearch")) byId("upsellTriggerSearch").value = "";
    renderSelectedTriggers();
    setItemPreview("upsellSuggestedItem", "upsellSuggestedPreview");
  }

  function fillUpsellForm(promotion) {
    resetUpsellForm();
    state.editingUpsellId = promotion.id;
    byId("upsellPromotionId").value = String(promotion.id);
    byId("upsellTitle").value = promotion.title || "";
    const triggerIds = Array.isArray(promotion.triggerItemIds) && promotion.triggerItemIds.length
      ? promotion.triggerItemIds
      : promotion.triggerItemId
        ? [promotion.triggerItemId]
        : [];
    state.selectedTriggerIds = triggerIds.map((value) => String(value || "").trim()).filter(Boolean);
    byId("upsellTriggerClass").value = promotion.triggerClass || "";
    byId("upsellSuggestedItem").value = promotion.suggestedItemName && promotion.suggestedItemId
      ? `${promotion.suggestedItemName} | ID ${promotion.suggestedItemId}`
      : promotion.suggestedItemId || "";
    byId("upsellDiscountPercent").value = Number(promotion.discountPercent || 0).toFixed(1).replace(/\.0$/, "");
    byId("upsellMessage").value = promotion.message || "";
    byId("upsellStartDate").value = promotion.startDate || "";
    byId("upsellEndDate").value = promotion.endDate || "";
    byId("upsellIsActive").checked = promotion.isActive !== false;
    byId("upsellModalTitle").textContent = "Edit Upsell";
    renderSelectedTriggers();
    setItemPreview("upsellSuggestedItem", "upsellSuggestedPreview");
  }

  function createBasketRuleRow(rule = {}) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input class="basket-rule-min" type="number" min="0" step="0.01" value="${Number(rule.minValue || 0).toFixed(2)}"></td>
      <td><input class="basket-rule-max" type="number" min="0" step="0.01" value="${Number(rule.maxValue || 0).toFixed(2)}"></td>
      <td>
        <input class="basket-rule-item promotions-rule-item" type="text" list="promotionItemOptions" placeholder="Start typing an item name or ID" value="${escapeHtml(rule.itemName && rule.itemId ? `${rule.itemName} | ID ${rule.itemId}` : rule.itemId || "")}">
        <div class="promotion-item-preview"></div>
      </td>
      <td class="actions"><button class="action-btn action-delete promotions-rule-remove" type="button">Remove</button></td>
    `;

    const itemInput = row.querySelector(".basket-rule-item");
    const preview = row.querySelector(".promotion-item-preview");
    const syncPreview = () => {
      const item = findItem(itemInput.value);
      if (!itemInput.value.trim()) {
        preview.textContent = "";
        preview.classList.remove("is-error");
        return;
      }
      if (!item) {
        preview.textContent = "Select an item from the kiosk catalogue.";
        preview.classList.add("is-error");
        return;
      }
      preview.textContent = `${getItemName(item)} | ID ${getItemId(item)} | ${getItemClass(item)}`;
      preview.classList.remove("is-error");
    };

    itemInput.addEventListener("input", syncPreview);
    itemInput.addEventListener("change", syncPreview);
    row.querySelector(".promotions-rule-remove").addEventListener("click", () => {
      row.remove();
      if (!byId("basketRulesBody").children.length) {
        byId("basketRulesBody").appendChild(createBasketRuleRow());
      }
    });
    syncPreview();
    return row;
  }

  function resetBasketDiscountForm() {
    state.editingBasketDiscountId = null;
    byId("basketDiscountForm")?.reset();
    byId("basketDiscountPromotionId").value = "";
    byId("basketDiscountIsActive").checked = true;
    byId("basketDiscountModalTitle").textContent = "Add Basket Discount";
    const body = byId("basketRulesBody");
    body.innerHTML = "";
    body.appendChild(createBasketRuleRow());
  }

  function fillBasketDiscountForm(promotion) {
    resetBasketDiscountForm();
    state.editingBasketDiscountId = promotion.id;
    byId("basketDiscountPromotionId").value = String(promotion.id);
    byId("basketDiscountTitle").value = promotion.title || "";
    byId("basketDiscountMessage").value = promotion.message || "";
    byId("basketDiscountStartDate").value = promotion.startDate || "";
    byId("basketDiscountEndDate").value = promotion.endDate || "";
    byId("basketDiscountIsActive").checked = promotion.isActive !== false;
    byId("basketDiscountModalTitle").textContent = "Edit Basket Discount";

    const body = byId("basketRulesBody");
    body.innerHTML = "";
    const rules = Array.isArray(promotion.rules) && promotion.rules.length ? promotion.rules : [{}];
    rules.forEach((rule) => body.appendChild(createBasketRuleRow(rule)));
  }

  function parseUpsellPayload() {
    const selectedTriggerItems = state.selectedTriggerIds
      .map((id) => state.idToItem.get(String(id || "").trim()))
      .filter(Boolean);
    const triggerClass = String(byId("upsellTriggerClass").value || "").trim();
    const suggestedItem = findItem(byId("upsellSuggestedItem").value);
    if (!selectedTriggerItems.length && !triggerClass) {
      throw new Error("Choose at least one trigger item or a trigger class.");
    }
    if (!suggestedItem) throw new Error("Choose a valid suggested item.");

    const title = String(byId("upsellTitle").value || "").trim();
    const startDate = byId("upsellStartDate").value;
    const endDate = byId("upsellEndDate").value;
    if (!title) throw new Error("Promotion title is required.");
    if (!startDate || !endDate) throw new Error("Start date and end date are required.");

    return {
      type: "upsell",
      title,
      message: String(byId("upsellMessage").value || "").trim(),
      triggerItemId: getItemId(selectedTriggerItems[0]),
      triggerItemName: getItemName(selectedTriggerItems[0]),
      triggerItemIds: selectedTriggerItems.map((item) => getItemId(item)),
      triggerItemNames: selectedTriggerItems.map((item) => getItemName(item)),
      triggerClass,
      suggestedItemId: getItemId(suggestedItem),
      suggestedItemName: getItemName(suggestedItem),
      discountPercent: Number(byId("upsellDiscountPercent").value || 0),
      startDate,
      endDate,
      isActive: !!byId("upsellIsActive").checked,
    };
  }

  function parseBasketDiscountPayload() {
    const title = String(byId("basketDiscountTitle").value || "").trim();
    const startDate = byId("basketDiscountStartDate").value;
    const endDate = byId("basketDiscountEndDate").value;
    if (!title) throw new Error("Promotion title is required.");
    if (!startDate || !endDate) throw new Error("Start date and end date are required.");

    const rules = Array.from(document.querySelectorAll("#basketRulesBody tr")).map((row) => {
      const item = findItem(row.querySelector(".basket-rule-item")?.value || "");
      if (!item) throw new Error("Every basket discount row needs a valid item.");
      return {
        minValue: Number(row.querySelector(".basket-rule-min")?.value || 0),
        maxValue: Number(row.querySelector(".basket-rule-max")?.value || 0),
        itemId: getItemId(item),
        itemName: getItemName(item),
      };
    });

    return {
      type: "basket_discount",
      title,
      message: String(byId("basketDiscountMessage").value || "").trim(),
      startDate,
      endDate,
      isActive: !!byId("basketDiscountIsActive").checked,
      rules,
    };
  }

  async function savePromotion(payload, id = null) {
    const url = id ? `/api/promotions/${id}` : "/api/promotions";
    const method = id ? "PUT" : "POST";
    await fetchJson(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify(payload),
    });
    await loadPromotions();
  }

  async function deletePromotion(id) {
    if (!window.confirm("Delete this promotion?")) return;
    await fetchJson(`/api/promotions/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    await loadPromotions();
  }

  function bindEvents() {
    byId("addUpsellBtn")?.addEventListener("click", () => {
      resetUpsellForm();
      openModal("upsellModal");
    });

    byId("addBasketDiscountBtn")?.addEventListener("click", () => {
      resetBasketDiscountForm();
      openModal("basketDiscountModal");
    });

    byId("cancelUpsellBtn")?.addEventListener("click", () => closeModal("upsellModal"));
    byId("cancelBasketDiscountBtn")?.addEventListener("click", () => closeModal("basketDiscountModal"));
    byId("addBasketRuleBtn")?.addEventListener("click", () => {
      byId("basketRulesBody").appendChild(createBasketRuleRow());
    });

    byId("addUpsellTriggerBtn")?.addEventListener("click", addSelectedTriggerFromInput);
    byId("upsellTriggerSearch")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addSelectedTriggerFromInput();
      }
    });
    byId("upsellTriggerClass")?.addEventListener("change", setTriggerPreview);

    byId("upsellSuggestedItem")?.addEventListener("input", () => {
      setItemPreview("upsellSuggestedItem", "upsellSuggestedPreview");
    });
    byId("upsellSuggestedItem")?.addEventListener("change", () => {
      setItemPreview("upsellSuggestedItem", "upsellSuggestedPreview");
    });

    byId("saveUpsellBtn")?.addEventListener("click", async () => {
      try {
        await savePromotion(parseUpsellPayload(), state.editingUpsellId);
        closeModal("upsellModal");
        setStatus("Upsell saved.");
      } catch (err) {
        window.alert(err.message || "Failed to save upsell.");
      }
    });

    byId("saveBasketDiscountBtn")?.addEventListener("click", async () => {
      try {
        await savePromotion(parseBasketDiscountPayload(), state.editingBasketDiscountId);
        closeModal("basketDiscountModal");
        setStatus("Basket discount saved.");
      } catch (err) {
        window.alert(err.message || "Failed to save basket discount.");
      }
    });

    document.body.addEventListener("click", async (event) => {
      const removeTriggerButton = event.target.closest("button[data-trigger-id]");
      if (removeTriggerButton) {
        state.selectedTriggerIds = state.selectedTriggerIds.filter((id) => id !== String(removeTriggerButton.dataset.triggerId || "").trim());
        renderSelectedTriggers();
        return;
      }

      const button = event.target.closest("button[data-action][data-id]");
      if (!button) return;

      const id = Number(button.dataset.id);
      const promotion = state.promotions.find((entry) => Number(entry.id) === id);
      if (!promotion) return;

      if (button.dataset.action === "edit-upsell") {
        fillUpsellForm(promotion);
        openModal("upsellModal");
        return;
      }

      if (button.dataset.action === "edit-basket") {
        fillBasketDiscountForm(promotion);
        openModal("basketDiscountModal");
        return;
      }

      if (button.dataset.action === "delete-promotion") {
        try {
          await deletePromotion(id);
          setStatus("Promotion deleted.");
        } catch (err) {
          window.alert(err.message || "Failed to delete promotion.");
        }
      }
    });

    ["upsellModal", "basketDiscountModal"].forEach((modalId) => {
      byId(modalId)?.addEventListener("click", (event) => {
        if (event.target.id === modalId) closeModal(modalId);
      });
    });
  }

  async function init() {
    bindEvents();

    try {
      await loadCatalogue();
      await loadPromotions();
    } catch (err) {
      console.error("Promotions page failed to load:", err);
      setStatus(err.message || "Failed to load promotions.", true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
