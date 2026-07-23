document.addEventListener("DOMContentLoaded", async () => {
  const token = location.pathname.split("/").filter(Boolean).pop();
  const list = document.getElementById("qrProductList");
  const pickerButton = document.getElementById("qrProductPickerButton");
  const pickerMenu = document.getElementById("qrProductPickerMenu");
  const totalElement = document.getElementById("qrSelectedTotal");
  const continueButton = document.getElementById("qrContinue");
  const status = document.getElementById("qrShopStatus");
  const selectionCount = document.getElementById("qrSelectionCount");
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  let journey;
  const addedIndexes = new Set();
  const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  function imageMarkup(product, className = "") {
    return product.image
      ? `<img class="${className}" src="${escapeHtml(product.image)}" alt="" loading="lazy">`
      : `<span class="${className} qr-product-image-fallback">${escapeHtml(product.name.charAt(0))}</span>`;
  }

  function priceMarkup(variant, compact = false) {
    if (!variant) return "";
    const retail = Number(variant.retailPrice || variant.price || 0);
    const sale = Number(variant.salePrice || variant.price || 0);
    const discount = Number(variant.discountPercent || 0);
    if (discount > 0 && sale < retail) {
      return `<span class="qr-sale-price${compact ? " is-compact" : ""}"><s>${money.format(retail)}</s><strong>${money.format(sale)}</strong><em>${discount}% off</em></span>`;
    }
    return money.format(sale);
  }

  function handleImageError(event) {
    const image = event.target.closest("img");
    if (!image) return;
    const productContainer = image.closest("[data-product-index]");
    const product = journey?.products?.[Number(productContainer?.dataset.productIndex)];
    const fallback = document.createElement("span");
    fallback.className = `${image.className} qr-product-image-fallback`;
    fallback.textContent = product?.name?.charAt(0) || "?";
    image.replaceWith(fallback);
  }

  function selectedVariant(card, product) {
    const choices = Object.fromEntries(
      [...card.querySelectorAll("select[data-option]")].map((select) => [select.dataset.option, select.value])
    );
    const optionNames = product.optionFields
      .filter((field) => field.affectsVariant !== false)
      .map((field) => field.name);
    if (optionNames.some((name) => !choices[name])) return null;
    return product.variants.find((variant) =>
      optionNames.every((name) => variant.options[name] === choices[name])
    ) || (optionNames.length ? null : product.variants[0]);
  }

  function selection() {
    return [...list.querySelectorAll(".qr-product-card")].map((card) => {
      const product = journey.products[Number(card.dataset.index)];
      const variant = selectedVariant(card, product);
      if (!variant) return null;
      return {
        parentId: product.id,
        parentName: product.name,
        itemId: variant.id,
        itemName: variant.name,
        price: variant.price,
        retailPrice: variant.retailPrice,
        salePrice: variant.salePrice,
        discountPercent: variant.discountPercent,
        options: Object.fromEntries([...card.querySelectorAll("select[data-option]")]
          .map((select) => [select.dataset.option, select.value])),
      };
    }).filter(Boolean);
  }

  function renderPicker() {
    pickerMenu.innerHTML = journey.products.map((product, index) => `
      <button type="button" role="option" aria-selected="${addedIndexes.has(index)}" class="qr-picker-item" data-add-index="${index}" data-product-index="${index}" ${addedIndexes.has(index) ? "disabled" : ""}>
        ${imageMarkup(product, "qr-picker-thumbnail")}
        <span><strong>${escapeHtml(product.name)}</strong><small>${addedIndexes.has(index) ? "Added" : product.optionFields.length ? "Options available" : priceMarkup(product.variants[0], true)}</small></span>
        <b>${addedIndexes.has(index) ? "✓" : "+"}</b>
      </button>`).join("");
  }

  function productCard(product, index) {
    return `
      <article class="qr-product-card is-selected" data-index="${index}" data-product-index="${index}">
        <div class="qr-added-product-head">
          ${imageMarkup(product, "qr-added-product-image")}
          <span><strong>${escapeHtml(product.name)}</strong><small>Added product</small></span>
          <b class="qr-product-price">${product.optionFields.length ? "Select options" : priceMarkup(product.variants[0])}</b>
          <button type="button" class="qr-remove-product" aria-label="Remove ${escapeHtml(product.name)}">×</button>
        </div>
        <div class="qr-options" ${product.optionFields.length ? "" : "hidden"}>
          ${product.optionFields.map((field) => `<label>${escapeHtml(field.name)}<select data-option="${escapeHtml(field.name)}"><option value="">Choose ${escapeHtml(field.name)}</option>${field.values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}</select></label>`).join("")}
        </div>
      </article>`;
  }

  function addProduct(index) {
    if (addedIndexes.has(index)) return;
    addedIndexes.add(index);
    list.insertAdjacentHTML("beforeend", productCard(journey.products[index], index));
    renderPicker();
    pickerMenu.hidden = true;
    pickerButton.setAttribute("aria-expanded", "false");
    update();
    list.querySelector(`[data-index="${index}"] select, [data-index="${index}"] .qr-remove-product`)?.focus();
  }

  function update() {
    list.querySelector(".qr-empty-state")?.remove();
    if (!addedIndexes.size) {
      list.innerHTML = '<p class="qr-empty-state">No products added yet. Choose a product above to get started.</p>';
    }
    selectionCount.textContent = `${addedIndexes.size} ${addedIndexes.size === 1 ? "product" : "products"}`;
    let valid = addedIndexes.size > 0;
    list.querySelectorAll(".qr-product-card").forEach((card) => {
      const product = journey.products[Number(card.dataset.index)];
      const incomplete = [...card.querySelectorAll("select")].some((select) => !select.value);
      if (incomplete) valid = false;
      const variant = selectedVariant(card, product);
      const price = card.querySelector(".qr-product-price");
      if (variant) {
        price.innerHTML = priceMarkup(variant);
        price.dataset.pending = "false";
      } else {
        price.textContent = incomplete ? "Select all options" : "Combination unavailable";
        price.dataset.pending = "true";
        valid = false;
      }
    });
    const items = selection();
    totalElement.textContent = money.format(items.reduce((sum, item) => sum + item.price, 0));
    continueButton.disabled = !valid || items.length !== addedIndexes.size;
  }

  pickerButton.addEventListener("click", () => {
    pickerMenu.hidden = !pickerMenu.hidden;
    pickerButton.setAttribute("aria-expanded", pickerMenu.hidden ? "false" : "true");
    if (!pickerMenu.hidden) pickerMenu.querySelector(".qr-picker-item:not(:disabled)")?.focus();
  });
  pickerButton.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      pickerMenu.hidden = false;
      pickerButton.setAttribute("aria-expanded", "true");
      pickerMenu.querySelector(".qr-picker-item:not(:disabled)")?.focus();
    }
  });
  pickerMenu.addEventListener("keydown", (event) => {
    const options = [...pickerMenu.querySelectorAll(".qr-picker-item:not(:disabled)")];
    const index = options.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      pickerMenu.hidden = true;
      pickerButton.setAttribute("aria-expanded", "false");
      pickerButton.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      options[(index + offset + options.length) % options.length]?.focus();
    }
  });
  pickerMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-index]");
    if (button && !button.disabled) addProduct(Number(button.dataset.addIndex));
  });
  pickerMenu.addEventListener("error", handleImageError, true);
  list.addEventListener("error", handleImageError, true);
  list.addEventListener("change", update);
  list.addEventListener("click", (event) => {
    const remove = event.target.closest(".qr-remove-product");
    if (!remove) return;
    const card = remove.closest(".qr-product-card");
    addedIndexes.delete(Number(card.dataset.index));
    card.remove();
    renderPicker();
    update();
    pickerButton.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".qr-product-picker")) {
      pickerMenu.hidden = true;
      pickerButton.setAttribute("aria-expanded", "false");
    }
  });

  try {
    const response = await fetch(`/api/qr-journeys/public/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error);
    journey = data.journey;
    const priority = new Map([
      ["mattress", 0], ["bases only", 1], ["headboards", 2], ["bed frames", 3], ["pillows", 4],
    ]);
    journey.products.sort((a, b) =>
      (priority.get(String(a.className || "").toLowerCase()) ?? 99) -
      (priority.get(String(b.className || "").toLowerCase()) ?? 99) ||
      String(a.name).localeCompare(String(b.name))
    );
    document.getElementById("qrShopStore").textContent = journey.location_name;
    renderPicker();
    update();
  } catch (error) {
    status.textContent = error.message || "This product journey is unavailable.";
    status.dataset.tone = "error";
  }

  continueButton.addEventListener("click", () => {
    const items = selection();
    const total = items.reduce((sum, item) => sum + item.price, 0);
    sessionStorage.setItem(`qrJourneySelection:${token}`, JSON.stringify(items));
    location.href = `/finance-calculator?journey=${encodeURIComponent(token)}&amount=${encodeURIComponent(total)}`;
  });
});
