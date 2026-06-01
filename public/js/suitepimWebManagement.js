(function () {
  const defaultVisibleColumns = [
    "Name",
    "Category",
    "reasons to buy",
    "Catalogue Image One",
    "New Feature Desc",
    "Lead Time",
    "Online?",
    "Inactive",
    "Page Preview",
  ];
  const columnWidthStorageKey = "suitepim:web-management:column-widths";
  const customPresetName = "Custom";
  const customPresetStoragePrefix = "suitepim:web-management:custom-preset";
  const selectColumnWidth = 42;
  const minColumnWidth = 140;
  const maxColumnWidth = 720;

  const state = {
    environment: "production",
    fields: [],
    rows: [],
    filteredRows: [],
    visibleColumns: [],
    baseline: new Map(),
    dirty: new Map(),
    selected: new Set(),
    options: new Map(),
    activeFilters: [],
    sort: { fieldName: "", direction: "" },
    filterDraft: null,
    bulkDraft: null,
    page: 1,
    pageSize: 50,
    modal: null,
    previewPopup: null,
    previewRowKey: null,
    generating: new Set(),
    inventoryRows: [],
    inventoryByItemId: new Map(),
    inventoryCommitments: [],
    inventoryLoading: null,
    inventoryLoaded: false,
    inventoryError: "",
    aiGenerationConfigured: false,
    aiGenerationModel: "",
    columnWidths: {},
    userPreferenceKey: "unknown",
    customPreset: null,
    presets: [
      {
        name: "Step 1 : Pricing",
        fields: [
          "Name",
          "Display Name",
          "Supplier Name",
          "Class",
          "Purchase Price",
          "Base Price",
          "Retail Price",
          "Sale Price",
          "Discount Percent",
          "Margin",
          "Lead Time",
          "Inactive",
        ],
        filters: [],
      },
      {
        name: "Step 2 : Mattress Metrics",
        fields: ["Name", "Comfort", "Type", "Depth", "Fillings", "Height", "Width", "Length", "Spring Type"],
        filters: [
          { field: "Class", value: "Mattress" },
          { field: "Inactive", value: false },
        ],
      },
      {
        name: "Step 2 : Bed Frame Metrics",
        fields: ["Name", "Type", "Built/Flat Packed", "Colour Filter", "Depth", "Head End Height", "Height", "Width", "Length", "Storage"],
        filters: [
          { field: "Class", value: "Bed Frames" },
          { field: "Inactive", value: false },
        ],
      },
      {
        name: "Step 3 : Imagery",
        fields: ["Name", "Catalogue Image One", "Catalogue Image Two", "Catalogue Image Three", "Catalogue Image Four", "Catalogue Image Five", "Item Image"],
        filters: [{ field: "Inactive", value: false }],
      },
      {
        name: "Step 4 : Meta Data",
        fields: ["Name", "Category", "Tags", "Lead Time"],
        filters: [{ field: "Inactive", value: false }],
      },
      {
        name: "Step 5 : Web Description",
        fields: ["Name", "New Feature Desc", "reasons to buy", "Page Preview"],
        filters: [],
      },
    ],
  };

  const toolFields = [
    { name: "Retail Price", fieldType: "Currency", toolColumn: true },
    { name: "Sale Price", fieldType: "Currency", toolColumn: true },
    { name: "Discount Percent", fieldType: "Decimal", toolColumn: true },
    { name: "Margin", fieldType: "Decimal", toolColumn: true },
    { name: "Stock on hand", fieldType: "Stock", toolColumn: true, disableField: true },
    { name: "Generate Description", fieldType: "Generate", toolColumn: true, disableField: true },
    { name: "Page Preview", fieldType: "Preview", toolColumn: true, disableField: true },
  ];

  const el = {};

  function initEls() {
    [
      "suitepimSearch",
      "suitepimStateFilter",
      "suitepimFilterField",
      "suitepimFilterValueHost",
      "suitepimAddFilterBtn",
      "suitepimClearFiltersBtn",
      "suitepimActiveFilters",
      "suitepimBulkField",
      "suitepimBulkMode",
      "suitepimBulkValueHost",
      "suitepimBulkScope",
      "suitepimApplyBulkBtn",
      "suitepimToggleFiltersBtn",
      "suitepimToggleBulkBtn",
      "suitepimColumnsBtn",
      "suitepimRefreshBtn",
      "suitepimPushBtn",
      "suitepimPresetSelect",
      "suitepimShowChildren",
      "suitepimMount",
      "suitepimStatus",
      "suitepimPushReport",
      "suitepimTotalCount",
      "suitepimVisibleCount",
      "suitepimSelectedCount",
      "suitepimChangedCount",
      "suitepimPrevPage",
      "suitepimNextPage",
      "suitepimPageLabel",
      "suitepimColumnsPanel",
      "suitepimCloseColumns",
      "suitepimColumnList",
      "suitepimModal",
      "suitepimModalTitle",
      "suitepimModalSearch",
      "suitepimModalOptions",
      "suitepimModalClose",
      "suitepimModalCancel",
      "suitepimModalSave",
      "suitepimPreviewModal",
      "suitepimPreviewTitle",
      "suitepimPreviewFrame",
      "suitepimPreviewClose",
      "suitepimPreviewDone",
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });
  }

  function authHeaders() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    if (!saved?.token) {
      window.location.href = "/index.html";
      return {};
    }
    return { Authorization: `Bearer ${saved.token}` };
  }

  function safeStorageKeyPart(value) {
    return encodeURIComponent(String(value || "unknown").trim().toLowerCase() || "unknown");
  }

  function fallbackUserPreferenceKey() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return safeStorageKeyPart(saved?.username || saved?.email || "unknown");
  }

  async function loadUserPreferenceKey() {
    state.userPreferenceKey = fallbackUserPreferenceKey();

    try {
      const res = await fetch("/api/me", { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return;
      const user = data.user || {};
      state.userPreferenceKey = safeStorageKeyPart(user.id || user.email || state.userPreferenceKey);
    } catch {
      // User-scoped preferences are a convenience; falling back keeps the page usable.
    }
  }

  function fieldByName(name) {
    return state.fields.find((field) => field.name === name);
  }

  function rowKey(row, index = 0) {
    return String(row["Internal ID"] || row["Item ID"] || row.Name || `row-${index}`);
  }

  function latestRow(rowOrKey) {
    const key = typeof rowOrKey === "string" ? rowOrKey : rowOrKey?._suitepimKey;
    return state.rows.find((row) => row._suitepimKey === key) || null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadColumnWidths() {
    try {
      const parsed = JSON.parse(localStorage.getItem(columnWidthStorageKey) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed)
          .map(([name, width]) => [name, clampColumnWidth(width)])
          .filter(([, width]) => Number.isFinite(width))
      );
    } catch {
      return {};
    }
  }

  function saveColumnWidths() {
    try {
      localStorage.setItem(columnWidthStorageKey, JSON.stringify(state.columnWidths));
    } catch {
      // Column widths are a convenience preference; failing to persist should not interrupt editing.
    }
  }

  function customPresetStorageKey() {
    return `${customPresetStoragePrefix}:${state.userPreferenceKey}`;
  }

  function cleanVisibleColumns(columns = []) {
    return [...new Set(columns)].filter((name) => fieldByName(name));
  }

  function cleanCustomFilters(filters = []) {
    return filters
      .map((filter) => {
        const fieldName = filter?.fieldName || filter?.field;
        if (!fieldByName(fieldName)) return null;
        const value = filter.value;
        if (value === "" || value == null || (Array.isArray(value) && !value.length)) return null;
        return {
          fieldName,
          value,
          valueLabel: filter.valueLabel ?? filter.label ?? "",
          internalId: filter.internalId ?? "",
          source: "manual",
        };
      })
      .filter(Boolean);
  }

  function defaultCustomPreset() {
    return {
      fields: cleanVisibleColumns(defaultVisibleColumns),
      filters: [],
    };
  }

  function loadCustomPreset() {
    try {
      const parsed = JSON.parse(localStorage.getItem(customPresetStorageKey()) || "null");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultCustomPreset();
      const fields = cleanVisibleColumns(parsed.fields || parsed.visibleColumns || []);
      return {
        fields: fields.length ? fields : cleanVisibleColumns(defaultVisibleColumns),
        filters: cleanCustomFilters(parsed.filters || []),
      };
    } catch {
      return defaultCustomPreset();
    }
  }

  function selectedPresetName() {
    return el.suitepimPresetSelect?.value || "";
  }

  function saveCustomPreset() {
    if (selectedPresetName() !== customPresetName) return;
    state.customPreset = {
      fields: cleanVisibleColumns(state.visibleColumns),
      filters: cleanCustomFilters(state.activeFilters),
    };

    try {
      localStorage.setItem(customPresetStorageKey(), JSON.stringify(state.customPreset));
    } catch {
      showStatus("Custom preset could not be saved in this browser.", "warning");
    }
  }

  function clampColumnWidth(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric)) return NaN;
    return Math.max(minColumnWidth, Math.min(maxColumnWidth, Math.round(numeric)));
  }

  function defaultColumnWidth(name) {
    const field = fieldByName(name) || {};
    if (field.fieldType === "image" || name.includes("Image")) return 220;
    if (name === "New Feature Desc") return 320;
    if (["reasons to buy", "Tags"].includes(name)) return 260;
    if (["Name", "Display Name", "Supplier Name"].includes(name)) return 240;
    if (["Currency", "Decimal", "Integer", "Float", "Number"].includes(field.fieldType)) return 140;
    if (field.fieldType === "Checkbox") return 120;
    if (field.fieldType === "Stock") return 150;
    if (["Generate", "Preview"].includes(field.fieldType)) return 150;
    return 180;
  }

  function columnWidth(name) {
    return state.columnWidths[name] || defaultColumnWidth(name);
  }

  function tableAvailableWidth(table, columns) {
    const wrapperWidth = table.parentElement?.clientWidth || el.suitepimMount?.clientWidth || 0;
    const minimumWidth = selectColumnWidth + (columns.length * minColumnWidth);
    return Math.max(minimumWidth, wrapperWidth);
  }

  function normalizedColumnWidths(columns, totalWidth) {
    const available = Math.max(0, totalWidth - selectColumnWidth);
    if (!columns.length || !available) return {};

    const base = columns.map((name) => clampColumnWidth(columnWidth(name)));
    const maxTotal = columns.length * maxColumnWidth;
    const minTotal = columns.length * minColumnWidth;
    const targetTotal = Math.max(minTotal, Math.min(maxTotal, available));
    const baseTotal = base.reduce((sum, width) => sum + width, 0) || 1;
    const scaled = base.map((width) => Math.max(minColumnWidth, Math.min(maxColumnWidth, Math.round((width / baseTotal) * targetTotal))));
    let difference = targetTotal - scaled.reduce((sum, width) => sum + width, 0);

    while (difference !== 0) {
      const direction = difference > 0 ? 1 : -1;
      const adjustable = scaled
        .map((width, index) => ({ width, index }))
        .filter(({ width }) => direction > 0 ? width < maxColumnWidth : width > minColumnWidth);
      if (!adjustable.length) break;
      adjustable.forEach(({ index }) => {
        if (difference === 0) return;
        scaled[index] += direction;
        difference -= direction;
      });
    }

    return Object.fromEntries(columns.map((name, index) => [name, scaled[index]]));
  }

  function extractImageUrl(value) {
    if (!value) return "";
    if (typeof value === "string") {
      const imgMatch = value.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) return imgMatch[1];
      const hrefMatch = value.match(/<a[^>]+href=["']([^"']+)["']/i);
      if (hrefMatch) return hrefMatch[1];
      const urlMatch = value.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) return urlMatch[0];
    }
    return "";
  }

  function optionImageUrl(option) {
    if (!option) return "";
    const raw = option.raw || {};
    return extractImageUrl(
      raw.url ||
      raw.URL ||
      raw.image ||
      raw.Image ||
      raw.src ||
      raw.Source ||
      raw["Image URL"] ||
      raw["URL"] ||
      raw.thumbnail ||
      raw.Thumbnail ||
      option.name
    );
  }

  function optionStoredValue(field, option) {
    if (!option) return "";
    if (field?.fieldType === "image") {
      return optionImageUrl(option) || option.name || "";
    }
    return option.name || "";
  }

  function imageThumb(url, alt) {
    if (!url) {
      return `<div class="suitepim-image-fallback" aria-hidden="true">No image</div>`;
    }
    return `<img class="suitepim-image-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(alt || "Image preview")}" loading="lazy" decoding="async">`;
  }

  function stripHtml(value) {
    return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function patchFeatureDescriptionPreview(html, featureText) {
    const source = String(html || "");
    if (!source) return source;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = source;
    const candidates = Array.from(wrapper.querySelectorAll("div"));
    const heading = candidates.find((node) => stripHtml(node.textContent) === "Why you will love this...");
    const copy = heading?.nextElementSibling;
    if (!copy) return source;
    copy.textContent = String(featureText || "");
    return wrapper.innerHTML;
  }

  function previewImages(row) {
    return [
      "Catalogue Image One",
      "Catalogue Image Two",
      "Catalogue Image Three",
      "Catalogue Image Four",
      "Catalogue Image Five",
    ]
      .map((fieldName) => extractImageUrl(valueText(row[fieldName])))
      .filter(Boolean)
      .filter((url, index, arr) => arr.indexOf(url) === index)
      .concat(extractImageUrl(valueText(row["Item Image"])) || "")
      .filter(Boolean)
      .filter((url, index, arr) => arr.indexOf(url) === index);
  }

  function featureList(row) {
    return [
      ["Comfort", row.Comfort],
      ["Spring Type", row["Spring Type"]],
      ["Fillings", row.Fillings],
      ["Width", row.Width],
      ["Length", row.Length],
      ["Height", row.Height],
      ["Depth", row.Depth],
      ["Storage", row.Storage],
      ["Warranty", row.Warranty],
    ].filter(([, value]) => valueText(value));
  }

  function reasonsList(row) {
    const raw = row["reasons to buy"];
    if (Array.isArray(raw)) {
      return raw
        .map((item) => {
          if (!item) return "";
          if (typeof item === "object") return item.Name || item.name || item.text || item.label || "";
          return String(item);
        })
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
  }

  function reasonsMeta(row) {
    const rawSelected = Array.isArray(row["reasons to buy"]) ? row["reasons to buy"] : null;
    if (rawSelected?.length && typeof rawSelected[0] === "object") {
      return rawSelected.map((item) => ({
        name: String(item.Name || item.name || item.text || item.label || ""),
        description: String(item.Description || item.description || item["Item Description"] || ""),
        iconUrl: extractImageUrl(item["Icon URL"] || item.iconUrl || item.icon || item.Image || ""),
        isWarrantyPeriod: boolValue(item["Is Warranty Period"]),
      })).filter((item) => item.name);
    }

    const selected = reasonsList(row);
    const selectedIds = Array.isArray(row["reasons to buy_InternalId"])
      ? row["reasons to buy_InternalId"].map((item) => String(item).trim()).filter(Boolean)
      : row["reasons to buy_InternalId"] ? [String(row["reasons to buy_InternalId"]).trim()] : [];
    const options = state.options.get("reasons to buy") || [];
    return selected.map((name, index) => {
      const selectedId = selectedIds[index] || "";
      const normalizedName = String(name).trim().toLowerCase();
      const match = options.find((option) =>
        (selectedId && String(option.id || "").trim() === selectedId) ||
        option.name.toLowerCase() === normalizedName ||
        String(option.raw?.Name || "").trim().toLowerCase() === normalizedName
      );
      const raw = match?.raw || {};
      return {
        name: String(name),
        description: String(raw.Description || raw.description || raw["Item Description"] || ""),
        iconUrl: extractImageUrl(raw["Icon URL"] || raw.iconUrl || raw.icon || raw.Image || ""),
        isWarrantyPeriod: boolValue(raw["Is Warranty Period"]),
      };
    }).filter((item) => item.name);
  }

  function extractVideoUrl(value) {
    const match = String(value || "").match(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s"'<>]+/i);
    return match ? match[0] : "";
  }

  function embedVideoUrl(value) {
    const url = String(value || "").trim();
    if (!url) return "";
    const shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
    if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${shortMatch[1]}&rel=0`;
    const watchMatch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
    if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${watchMatch[1]}&rel=0`;
    const embedMatch = url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
    if (embedMatch) return `https://www.youtube.com/embed/${embedMatch[1]}?autoplay=1&mute=1&loop=1&playlist=${embedMatch[1]}&rel=0`;
    return "";
  }

  function renderReasonList(items, emptyMessage) {
    if (!items.length) {
      return `<p class="preview-empty">${escapeHtml(emptyMessage || "No content added yet.")}</p>`;
    }
    return `
      <div class="reason-list">
        ${items.map((item) => `
          <article class="reason-card">
            <div class="reason-card-icon">
              ${item.iconUrl ? `<img src="${escapeHtml(item.iconUrl)}" alt="${escapeHtml(item.name)} icon">` : `<span>${escapeHtml(item.name.slice(0, 1).toUpperCase())}</span>`}
            </div>
            <div class="reason-card-copy">
              <strong>${escapeHtml(item.name)}</strong>
              <p>${escapeHtml(item.description || "No description added yet.")}</p>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderAccordionCard(title, body, open = false) {
    return `
      <details class="preview-accordion"${open ? " open" : ""}>
        <summary>
          <span>${escapeHtml(title)}</span>
          <span class="preview-accordion-plus">+</span>
        </summary>
        <div class="preview-accordion-body">${body}</div>
      </details>
    `;
  }

  function sizeOptions(row) {
    const raw = row["Standard-Sizes"] || row["Standard Sizes"] || row.Size || "";
    if (Array.isArray(raw)) return raw.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
    return String(raw).split(",").map((item) => item.trim()).filter(Boolean);
  }

  function formatCurrency(value) {
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) return "";
    return `\u00A3${Math.round(amount).toLocaleString()}`;
  }

  function previewDocument(row) {
    const images = previewImages(row);
    const hero = images[0] || "";
    const thumbs = images.slice(0, 4);
    const descriptionPreview = String(row["Description Preview"] || "");
    const shortDescription = String(row["New Short Desc"] || row["Short Description"] || "");
    const featureDescription = String(row["New Feature Desc"] || "");
    const featureSummary = featureDescription || shortDescription;
    const reasons = reasonsList(row);
    const reasonItems = reasonsMeta(row);
    const warrantyReasons = reasonItems.filter((item) => item.isWarrantyPeriod);
    const featureReasons = reasonItems.filter((item) => !item.isWarrantyPeriod);
    const sizes = sizeOptions(row);
    const title = escapeHtml(row.Name || row["Display Name"] || "Product Preview");
    const className = escapeHtml(valueText(row.Class));
    const retailText = formatCurrency(row["Retail Price"]);
    const purchaseText = formatCurrency(row["Purchase Price"]);
    const baseText = formatCurrency(row["Base Price"]);
    const supplier = escapeHtml(valueText(row["Supplier Name"]));
    const leadTime = escapeHtml(valueText(row["Lead Time"]));
    const comfort = escapeHtml(valueText(row.Comfort));
    const springType = escapeHtml(valueText(row["Spring Type"]));
    const fillings = escapeHtml(valueText(row.Fillings));
    const warranty = escapeHtml(valueText(row.Warranty));
    const country = escapeHtml(valueText(row["Country Of Origin"]));
    const turnable = escapeHtml(valueText(row.Turnable));
    const builtFlat = escapeHtml(valueText(row["Built/Flat Packed"]));
    const category = escapeHtml(valueText(row.Category));
    const tags = escapeHtml(valueText(row.Tags));
    const descriptionText = descriptionPreview || `<p>${escapeHtml(stripHtml(shortDescription) || "No description preview available yet.")}</p>`;
    const videoUrl = extractVideoUrl(descriptionPreview);
    const videoEmbedUrl = embedVideoUrl(videoUrl);
    const dimensions = [
      row.Width ? `${valueText(row.Width)}W` : "",
      row.Length ? `${valueText(row.Length)}L` : "",
      row.Height ? `${valueText(row.Height)}H` : "",
      row.Depth ? `${valueText(row.Depth)}D` : "",
    ].filter(Boolean).join(" x ");
    const detailItems = [
      ["Comfort", comfort],
      ["Spring Type", springType],
      ["Fillings", fillings],
      ["Dimensions", escapeHtml(dimensions)],
      ["Warranty", warranty],
      ["Country of Origin", country],
      ["Turnable", turnable],
      ["Build", builtFlat],
      ["Category", category],
      ["Tags", tags],
    ].filter(([, value]) => value);
    const summaryReasons = reasonItems.slice(0, 8);
    const productInfoHtml = detailItems.length
      ? `<div class="detail-grid">${detailItems.map(([label, value]) => `<div class="detail-row"><strong>${escapeHtml(label)}</strong><span>${value}</span></div>`).join("")}</div>`
      : `<p class="preview-empty">No product information added yet.</p>`;
    const featuresBenefitsHtml = renderReasonList(featureReasons, "No content added yet.");
    const warrantyHtml = warrantyReasons.length
      ? `
        <div class="warranty-panel">
          ${renderReasonList(warrantyReasons, "")}
          <p class="warranty-note">Full details in our terms and conditions.</p>
        </div>
      `
      : `<p class="preview-empty">No warranty information added yet.</p>`;
    const faqHtml = `
      <div class="faq-list">
        <div class="faq-item">What size mattress do I need?</div>
        <div class="faq-item">What does 60 night comfort trial mean?</div>
        <div class="faq-item">How much is delivery?</div>
        <div class="faq-item">Why do I need a mattress protector?</div>
      </div>
    `;
    const comfortTrialHtml = `
      <div class="trial-panel">
        <div class="trial-badge">60</div>
        <div>
          <strong>Enjoy 60 nights to try your new mattress</strong>
          <p>If it is not quite right, you can swap it for an alternative comfort. Guaranteed peace of mind for online and in-store purchases.</p>
        </div>
      </div>
    `;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #ffffff; color: #16273d; }
    .page { max-width: 1180px; margin: 0 auto; padding: 28px 20px 36px; background: #ffffff; }
    .breadcrumbs { color: #756c60; font-size: 12px; margin-bottom: 12px; }
    .breadcrumbs span { color: #16324f; }
    .product { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr); gap: 22px; align-items: start; }
    .gallery-shell { background: #fff; padding: 0; display: grid; gap: 14px; }
    .gallery-top { display: block; }
    .gallery-main { background: #ffffff; min-height: 412px; display: grid; place-items: center; overflow: hidden; position: relative; }
    .gallery-main img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .gallery-fallback { padding: 24px; color: #8c7d6a; font-weight: 700; }
    .gallery-dots { display: flex; justify-content: center; gap: 8px; margin-top: 4px; }
    .gallery-dots span { width: 6px; height: 6px; border-radius: 999px; background: #0b7aa6; opacity: 0.4; }
    .gallery-dots span:nth-child(2) { opacity: 1; }
    .gallery-secondary { display: grid; grid-template-columns: repeat(3, minmax(0, 150px)); gap: 16px; justify-content: start; }
    .gallery-secondary img { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: #ffffff; }
    .summary { background: #fff; padding: 8px 0 0; }
    .eyebrow { color: #8c7d6a; font-size: 11px; font-weight: 800; text-transform: uppercase; margin-bottom: 6px; }
    h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.1; color: #10253b; }
    .summary-top { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 14px; align-items: start; }
    .summary-copy { font-size: 13px; line-height: 1.55; color: #4b5563; margin-bottom: 12px; max-width: 290px; }
    .summary-icons { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 8px; }
    .summary-icon { text-align: center; }
    .summary-icon-badge { width: 54px; height: 54px; display: grid; place-items: center; margin: 0 auto 6px; overflow: visible; color: #fff; font-weight: 700; }
    .summary-icon-badge img { width: 100%; height: 100%; object-fit: contain; background: transparent; }
    .delivery-note { margin: 8px 0 8px; font-size: 11px; color: #8b7a66; }
    .price-row { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 8px; }
    .was-price { font-size: 14px; color: #7b8794; text-decoration: line-through; }
    .price { font-size: 34px; font-weight: 900; color: #0b7aa6; line-height: 1; }
    .price-note { font-size: 12px; color: #c9642a; font-weight: 700; }
    .pricing-meta { margin-top: 6px; font-size: 11px; color: #64748b; display: grid; gap: 2px; }
    .finance { background: #fff; border: 1px solid #ece2d4; padding: 10px 12px; font-size: 11px; color: #4b5563; margin: 10px 0 12px; }
    .selector-label { font-size: 12px; font-weight: 700; color: #16324f; margin: 14px 0 6px; display: block; }
    .size-select { height: 32px; border: 1px solid #d9cdbd; background: #fff; display: flex; align-items: center; padding: 0 10px; color: #6b7280; font-size: 12px; margin-bottom: 10px; }
    .purchase-panel { display: grid; grid-template-columns: 36px 24px minmax(0, 1fr); gap: 4px; margin-top: 6px; }
    .qty, .qty-plus, .cta { height: 32px; display: grid; place-items: center; font-weight: 700; }
    .qty { border: 1px solid #d7ccbb; background: #fff; color: #16324f; }
    .qty-plus { background: #0b7aa6; color: #fff; font-size: 14px; }
    .cta { background: #5eb0d4; color: #fff; font-size: 11px; }
    .buy-now { margin-top: 8px; height: 22px; background: #000; color: #fff; display: grid; place-items: center; font-size: 9px; font-weight: 700; }
    .support { margin-top: 8px; font-size: 11px; color: #475569; display: flex; gap: 10px; }
    .support strong { color: #16324f; }
    .body { margin-top: 24px; display: grid; gap: 18px; }
    .card { background: #fff; padding: 12px 12px 14px; }
    .description { color: #334155; }
    .why-box { background: #f3efe6; padding: 14px 16px; margin: 0 0 14px; }
    .why-box strong { display: block; margin-bottom: 8px; font-size: 14px; color: #252525; }
    .why-box p { margin: 0; font-size: 13px; line-height: 1.45; color: #4a4a4a; }
    .preview-accordion { margin-top: 12px; overflow: hidden; }
    .preview-accordion summary { list-style: none; display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; background: #efe6d3; font-weight: 700; font-size: 13px; cursor: pointer; }
    .preview-accordion summary::-webkit-details-marker { display: none; }
    .preview-accordion-plus { font-size: 18px; font-weight: 900; line-height: 1; }
    .preview-accordion-body { padding: 14px 4px 2px; }
    .preview-accordion-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 14px; }
    .reason-list { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 28px; }
    .reason-card { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 12px; align-items: start; }
    .reason-card-icon { width: 60px; height: 60px; display: grid; place-items: center; overflow: visible; color: #fff; font-weight: 700; }
    .reason-card-icon img { width: 100%; height: 100%; object-fit: contain; background: transparent; }
    .reason-card-copy strong { display: block; color: #16324f; margin-bottom: 3px; font-size: 14px; }
    .reason-card-copy p { margin: 0; font-size: 13px; line-height: 1.4; color: #4a4a4a; }
    .detail-grid { display: grid; gap: 7px; }
    .detail-row { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 10px; padding: 0; background: transparent; border: 0; font-size: 13px; }
    .detail-row strong { font-size: 13px; text-transform: none; color: #4b5563; }
    .detail-row span { font-weight: 400; color: #0f172a; }
    .info-card, .warranty-card, .faq-card, .trial-card { background: #fff; padding: 0; }
    .faq-list { display: grid; gap: 8px; }
    .faq-item { padding: 10px 12px; background: #eef7fb; color: #0b7aa6; font-size: 12px; font-weight: 700; }
    .trial-panel { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 12px; align-items: start; }
    .trial-badge { width: 54px; height: 54px; border-radius: 999px; background: #0b7aa6; color: #fff; display: grid; place-items: center; font-size: 24px; font-weight: 900; }
    .trial-panel p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; color: #4a4a4a; }
    .trial-panel strong, .warranty-panel strong { font-size: 13px; }
    .warranty-note { margin: 10px 0 0 64px; font-size: 11px; color: #64748b; }
    .video-link { display: inline-flex; align-items: center; gap: 8px; color: #0b7aa6; font-weight: 700; text-decoration: none; }
    .video-frame { width: 100%; aspect-ratio: 16 / 9; border: 0; display: block; background: #f5f5f5; }
    .preview-empty { margin: 0; color: #64748b; font-size: 13px; }
    @media (max-width: 980px) {
      .product, .summary-top, .preview-accordion-grid { grid-template-columns: 1fr; }
      .page { padding: 18px; }
    }
    @media (max-width: 640px) {
      .page { padding: 14px; }
      h1 { font-size: 28px; }
      .summary-icons, .gallery-secondary, .reason-list, .preview-accordion-grid { grid-template-columns: 1fr; }
      .purchase-panel { grid-template-columns: 42px 28px minmax(0, 1fr); }
      .gallery-main { min-height: 320px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="breadcrumbs">Home / Shop / <span>${title}</span></div>
    <section class="product">
      <div class="gallery-shell">
        <div class="gallery-top">
          <div>
            <div class="gallery-main">
              ${hero ? `<img src="${escapeHtml(hero)}" alt="${title}">` : `<div class="gallery-fallback">No image available</div>`}
            </div>
            <div class="gallery-dots"><span></span><span></span><span></span></div>
          </div>
        </div>
        <div class="gallery-secondary">
          ${thumbs.slice(1, 4).map((url) => `<img src="${escapeHtml(url)}" alt="${title} gallery image">`).join("")}
        </div>
      </div>
      <div class="summary">
        <div class="eyebrow">${className || "Web preview"}</div>
        <h1>${title}</h1>
        <div class="summary-top">
          <div>
            ${shortDescription ? `<div class="summary-copy">${escapeHtml(stripHtml(shortDescription))}</div>` : ""}
          </div>
          ${summaryReasons.length ? `<div class="summary-icons">${summaryReasons.slice(0, 8).map((reason) => `
            <div class="summary-icon">
              <div class="summary-icon-badge">
                ${reason.iconUrl ? `<img src="${escapeHtml(reason.iconUrl)}" alt="${escapeHtml(reason.name)} icon">` : `<span>${escapeHtml(reason.name.slice(0, 1).toUpperCase())}</span>`}
              </div>
            </div>
          `).join("")}</div>` : ""}
        </div>
        ${leadTime ? `<div class="delivery-note">Order now and get by ${leadTime}</div>` : ""}
        ${retailText ? `<div class="price-row">${baseText ? `<div class="was-price">${baseText}</div>` : ""}<div class="price">${retailText}</div><div class="price-note">from</div></div>` : ""}
        ${(purchaseText || baseText) ? `<div class="pricing-meta">${purchaseText ? `<div>Purchase price: ${purchaseText}</div>` : ""}${baseText ? `<div>Base price: ${baseText}</div>` : ""}</div>` : ""}
        <div class="finance">Klarna preview block for staged product finance messaging.</div>
        ${sizes.length ? `<label class="selector-label">Select an option</label><div class="size-select">${escapeHtml(sizes[0])}</div>` : ""}
        <div class="purchase-panel">
          <div class="qty">1</div>
          <div class="qty-plus">+</div>
          <div class="cta">Add to basket</div>
        </div>
        <div class="buy-now">Buy with G Pay</div>
        <div class="support">
          <span>Print</span>
          <span>Share</span>
        </div>
      </div>
    </section>
    <section class="body">
      <div>
        <article class="card">
          <div class="description">
            <div class="why-box">
              <strong>Why you will love this...</strong>
              <p>${escapeHtml(stripHtml(featureSummary) || "No content added yet.")}</p>
            </div>
            ${renderAccordionCard("Video", videoEmbedUrl ? `<iframe class="video-frame" src="${escapeHtml(videoEmbedUrl)}" title="${title} video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>` : (videoUrl ? `<a class="video-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(videoUrl)}</a>` : `<p class="preview-empty">No content added yet.</p>`))}
            ${renderAccordionCard("Features & Benefits", featuresBenefitsHtml, true)}
            <div class="preview-accordion-grid">
              <div class="info-card">${renderAccordionCard("Info", productInfoHtml)}</div>
              <div class="warranty-card">${renderAccordionCard("Warranty Information", warrantyHtml)}</div>
              <div class="faq-card">${renderAccordionCard("FAQs", faqHtml, true)}</div>
              <div class="trial-card">${renderAccordionCard("60 night comfort trial +", comfortTrialHtml, true)}</div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</body>
</html>`;
  }

  function openPreviewModal(row) {
    const liveRow = latestRow(row) || row;
    const title = liveRow.Name || liveRow["Display Name"] || "Page Preview";
    const features = [
      "popup=yes",
      "width=1440",
      "height=960",
      "menubar=no",
      "toolbar=no",
      "location=no",
      "status=no",
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");

    if (!state.previewPopup || state.previewPopup.closed) {
      state.previewPopup = window.open("", "suitepim-page-preview", features);
    }

    if (!state.previewPopup) {
      showStatus("Preview popup was blocked by the browser.", "warning");
      return;
    }

    state.previewRowKey = liveRow._suitepimKey || null;
    state.previewPopup.document.open();
    state.previewPopup.document.write(previewDocument(liveRow));
    state.previewPopup.document.close();
    state.previewPopup.document.title = title;
    state.previewPopup.focus();
  }

  function closePreviewModal() {
    if (state.previewPopup && !state.previewPopup.closed) {
      state.previewPopup.close();
    }
    state.previewPopup = null;
    state.previewRowKey = null;
  }

  function boolValue(value) {
    if (value === true || value === 1) return true;
    return ["true", "t", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
  }

  function canManageFeatureDescription(row) {
    return boolValue(row?.["Is Parent"]);
  }

  function isCalculatedPriceField(column) {
    return ["Purchase Price", "Base Price", "Retail Price", "Sale Price", "Discount Percent", "Margin"].includes(column);
  }

  function isBulkPricingField(column) {
    return ["Purchase Price", "Base Price", "Retail Price", "Sale Price", "Discount Percent", "Margin"].includes(column);
  }

  function isBulkTextField(field) {
    if (!field || field.disableField || field.hiddenField || fieldUsesOptions(field)) return false;
    return !["Checkbox", "Generate", "Preview", "Stock", "Link", "image", "Currency", "Decimal", "Integer", "Float", "Number"].includes(field.fieldType);
  }

  function rowSizeValue(row) {
    const raw = row?.Size;
    if (Array.isArray(raw)) {
      const sizes = raw.map((item) => String(item).trim()).filter(Boolean);
      return sizes.length === 1 ? sizes[0] : "";
    }
    const size = String(raw || "").trim();
    return size.includes(",") ? "" : size;
  }

  function prefixSizeValue(row, value) {
    const size = rowSizeValue(row);
    const text = String(value || "").trim();
    if (!size || !text) return text;
    return text.toLowerCase().startsWith(`${size.toLowerCase()} `) ? text : `${size} ${text}`;
  }

  function recalcRow(row, changedField) {
    const updated = { ...row };
    const vat = 0.2;
    const vatMultiplier = 1 + vat;
    let purchase = parseFloat(updated["Purchase Price"]) || 0;
    let base = parseFloat(updated["Base Price"]) || 0;
    let retail = parseFloat(updated["Retail Price"]) || 0;
    let sale = parseFloat(updated["Sale Price"]) || 0;
    let discount = parseFloat(updated["Discount Percent"]) || 0;
    let margin = parseFloat(updated["Margin"]) || 0;

    if (!changedField && sale > 0) {
      sale *= vatMultiplier;
    }

    if (changedField === "Base Price" && base > 0) {
      retail = base * vatMultiplier;
      if (purchase > 0) margin = retail / purchase;
    } else if (changedField === "Retail Price" && retail > 0) {
      base = retail / vatMultiplier;
      if (purchase > 0) margin = retail / purchase;
    } else if (changedField === "Margin" && purchase > 0 && margin > 0) {
      retail = purchase * margin;
      base = retail / vatMultiplier;
    } else if (changedField === "Purchase Price" && purchase > 0 && retail > 0) {
      margin = retail / purchase;
    } else if (changedField === "Sale Price" && retail > 0) {
      discount = ((retail - sale) / retail) * 100;
    } else if (changedField === "Discount Percent" && retail > 0) {
      discount = Math.max(0, Math.min(100, discount));
      sale = retail * (1 - discount / 100);
    } else if (base > 0) {
      retail = base * vatMultiplier;
      if (purchase > 0) margin = retail / purchase;
    }

    if (changedField !== "Sale Price" && changedField !== "Discount Percent" && retail > 0) {
      if (discount > 0) {
        sale = retail * (1 - Math.max(0, Math.min(100, discount)) / 100);
      } else if (sale > 0) {
        discount = ((retail - sale) / retail) * 100;
      }
    }

    if (retail > 0 && sale > 0 && changedField !== "Discount Percent") {
      discount = ((retail - sale) / retail) * 100;
    }

    updated["Purchase Price"] = purchase.toFixed(2);
    updated["Base Price"] = base.toFixed(2);
    updated["Retail Price"] = Math.round(retail);
    updated["Sale Price"] = sale ? sale.toFixed(2) : "";
    updated["Discount Percent"] = Number.isFinite(discount) ? Math.max(0, discount).toFixed(1) : "0.0";
    updated["Margin"] = margin.toFixed(1);
    return updated;
  }

  function showStatus(message, type = "info") {
    if (!el.suitepimStatus) return;
    el.suitepimStatus.textContent = message || "";
    el.suitepimStatus.dataset.type = type;
    el.suitepimStatus.hidden = !message;
  }

  function compactError(result) {
    const response = result?.response || {};
    if (response.error) return response.error;
    const priceError = Array.isArray(response.prices)
      ? response.prices.find((price) => price && price.success === false)?.error
      : null;
    if (priceError) return priceError;
    if (response.main?.error) return typeof response.main.error === "string" ? response.main.error : JSON.stringify(response.main.error);
    if (response.main?.["o:errorDetails"]) return JSON.stringify(response.main["o:errorDetails"]);
    if (response.main?.raw) return response.main.raw;
    return result?.status || "No error detail returned";
  }

  function renderPushReport(job) {
    const results = job.results || [];
    if (!el.suitepimPushReport) return;
    if (!results.length) {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
      return;
    }

    const success = results.filter((result) => result.status === "Success").length;
    const failed = results.filter((result) => result.status === "Error").length;
    const skipped = results.filter((result) => result.status === "Skipped").length;

    const rows = results.map((result) => {
      const details = JSON.stringify(result, null, 2);
      return `
        <article class="suitepim-result-item" data-status="${escapeHtml(result.status)}">
          <div class="suitepim-result-title">
            <span>${escapeHtml(result.status)}</span>
            <span>${escapeHtml(result.itemId || result.internalId || "Unknown item")}</span>
            ${result.recordType ? `<span>${escapeHtml(result.recordType)}</span>` : ""}
          </div>
          <div class="suitepim-result-message">${escapeHtml(compactError(result))}</div>
          <details class="suitepim-result-details">
            <summary>Technical details</summary>
            <pre>${escapeHtml(details)}</pre>
          </details>
        </article>
      `;
    }).join("");

    el.suitepimPushReport.hidden = false;
    el.suitepimPushReport.innerHTML = `
      <details class="suitepim-push-report-details">
        <summary class="suitepim-push-report-summary">
          <span>Push report: ${success} successful, ${failed} failed, ${skipped} skipped</span>
          <span class="suitepim-push-report-chevron" aria-hidden="true">+</span>
        </summary>
        <div class="suitepim-push-report-body">
          <div class="suitepim-push-report-header">
            <h2>Push report details</h2>
            <button type="button" id="suitepimClearPushReport">Clear</button>
          </div>
          <div class="suitepim-result-list">${rows}</div>
        </div>
      </details>
    `;
    document.getElementById("suitepimClearPushReport")?.addEventListener("click", () => {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
    });
  }

  function setLoading(message) {
    el.suitepimMount.innerHTML = `
      <div class="suitepim-loading">
        <div class="suitepim-spinner" aria-hidden="true"></div>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  async function api(path, options = {}) {
    const joiner = path.includes("?") ? "&" : "?";
    const url = `/api/suitepim${path}${joiner}environment=${encodeURIComponent(state.environment)}`;
    const headers = {
      ...authHeaders(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `SuitePim request failed: ${res.status}`);
    }
    return data;
  }

  async function loadConfig() {
    const config = await api("/web-management/config");
    state.fields = [...config.fields, ...toolFields];
    state.aiGenerationConfigured = !!config.aiGenerationConfigured;
    state.aiGenerationModel = config.aiGenerationModel || "";
    state.columnWidths = loadColumnWidths();
    state.customPreset = loadCustomPreset();
    state.visibleColumns = [...defaultVisibleColumns];
    renderFieldSelectors();
    renderColumnChooser();
    renderFilterValueControl();
    renderBulkValueControl();
    renderActiveFilters();
    renderPresetSelector();
  }

  async function loadProducts(forceRefresh = false) {
    setLoading(forceRefresh ? "Refreshing Item Management from NetSuite..." : "Loading Item Management...");
    showStatus("");
    state.rows = [];
    state.filteredRows = [];
    state.baseline.clear();
    state.dirty.clear();
    state.selected.clear();
    state.page = 1;

    const data = await api(`/web-management${forceRefresh ? "?refresh=1" : ""}`);
    state.rows = (data.rows || []).map((row, index) => ({ ...row, _suitepimKey: rowKey(row, index) }));
    state.rows.forEach((row) => state.baseline.set(row._suitepimKey, JSON.stringify(stripInternal(row))));
    const reasonsField = fieldByName("reasons to buy");
    if (reasonsField?.optionFeed) {
      await ensureOptions(reasonsField).catch(() => []);
    }
    applyFilters();
    const cache = data.cache || {};
    const cacheSuffix = cache.source === "cache"
      ? ` from cache (${Math.max(0, Math.round(Number(cache.ageSeconds || 0) / 60))} min old)`
      : cache.source === "stale"
      ? ` from cached data while NetSuite refreshes in the background (${Math.max(0, Math.round(Number(cache.ageSeconds || 0) / 60))} min old)`
      : "";
    showStatus(`Loaded ${state.rows.length.toLocaleString()} ${data.environment} web record(s)${cacheSuffix}.`, "success");
  }

  function stripInternal(row) {
    const copy = { ...row };
    delete copy._suitepimKey;
    return copy;
  }

  function baselineRow(key) {
    try {
      return JSON.parse(state.baseline.get(key) || "{}");
    } catch {
      return {};
    }
  }

  function changedPayload(row) {
    const base = baselineRow(row._suitepimKey);
    const clean = stripInternal(row);
    const payload = {
      "Internal ID": clean["Internal ID"],
      "Item ID": clean["Item ID"],
      "Record Type": clean["Record Type"],
    };
    const priceUpdates = [];

    if (JSON.stringify(clean.Name ?? null) !== JSON.stringify(base.Name ?? null)) {
      payload.Name = childItemName(clean.Name);
    }

    Object.keys(clean).forEach((key) => {
      if (key === "Internal ID" || key === "Item ID" || key === "Name") return;
      if (key.endsWith("_InternalId")) return;

      const field = fieldByName(key) || {};
      const internalIdKey = `${key}_InternalId`;
      const valueChanged = JSON.stringify(clean[key] ?? null) !== JSON.stringify(base[key] ?? null);
      const internalIdChanged = JSON.stringify(clean[internalIdKey] ?? null) !== JSON.stringify(base[internalIdKey] ?? null);

      if (!valueChanged && !internalIdChanged) return;

      if (key === "Discount Percent") return;

      if (key === "Base Price") {
        const netBasePrice = parseFloat(clean[key]);
        if (Number.isFinite(netBasePrice)) {
          priceUpdates.push({
            field: "Base Price",
            priceLevelId: 1,
            priceLevelName: "Base Price",
            price: netBasePrice,
          });
        }
      }

      if (field.fieldType === "image") {
        if (clean[internalIdKey] !== undefined) payload[internalIdKey] = clean[internalIdKey];
        return;
      }

      if (key === "Sale Price") {
        const grossSalePrice = parseFloat(clean[key]);
        if (Number.isFinite(grossSalePrice)) {
          priceUpdates.push({
            field: "Sale Price",
            priceLevelId: 4,
            priceLevelName: "Sale Price",
            price: Number((grossSalePrice / 1.2).toFixed(2)),
          });
        }
        payload[key] = Number.isFinite(grossSalePrice) ? (grossSalePrice / 1.2).toFixed(2) : "";
      } else {
        payload[key] = clean[key];
      }
      if (clean[internalIdKey] !== undefined) payload[internalIdKey] = clean[internalIdKey];
    });

    state.fields.forEach((field) => {
      const internalIdKey = `${field.name}_InternalId`;
      if (clean[internalIdKey] === undefined && base[internalIdKey] === undefined) return;
      if (JSON.stringify(clean[internalIdKey] ?? null) === JSON.stringify(base[internalIdKey] ?? null)) return;
      payload[internalIdKey] = clean[internalIdKey];
    });

    if (priceUpdates.length) payload.__priceUpdates = priceUpdates;

    return payload;
  }

  function commitSuccessfulPushResults(results = []) {
    const successful = results.filter((result) => result.status === "Success");
    if (!successful.length) return;

    const successIds = new Set(
      successful
        .map((result) => String(result.internalId || "").trim())
        .filter(Boolean)
    );

    state.rows = state.rows.map((row) => {
      const internalId = String(row["Internal ID"] || "").trim();
      if (!successIds.has(internalId)) return row;

      const clean = stripInternal(row);
      state.baseline.set(row._suitepimKey, JSON.stringify(clean));
      state.dirty.delete(row._suitepimKey);
      return row;
    });

    updateSummary();
    applyFilters();
  }

  function editableFields() {
    return state.fields.filter((field) =>
      !field.hiddenField && (!field.disableField || ["Retail Price", "Sale Price", "Discount Percent", "Margin", "Generate Description"].includes(field.name))
    );
  }

  function renderFieldOptions(select, placeholder, fields = state.fields) {
    select.innerHTML = `<option value="">${placeholder}</option>`;
    fields
      .filter((field) => !field.hiddenField)
      .forEach((field) => {
      const option = document.createElement("option");
      option.value = field.name;
      option.textContent = field.name;
      select.appendChild(option);
      });
  }

  function renderFieldSelectors() {
    renderFieldOptions(el.suitepimFilterField, "Choose field", state.fields);
    renderFieldOptions(el.suitepimBulkField, "Choose field", editableFields());
  }

  function renderPresetSelector() {
    if (!el.suitepimPresetSelect) return;
    const currentPreset = el.suitepimPresetSelect.value;
    el.suitepimPresetSelect.classList.add("suitepim-preset-native");
    el.suitepimPresetSelect.innerHTML = `
      <option value="">Default</option>
      ${state.presets.map((preset) => `<option value="${escapeHtml(preset.name)}">${escapeHtml(preset.name)}</option>`).join("")}
      <option value="${customPresetName}">${customPresetName}</option>
    `;
    if (currentPreset === customPresetName || state.presets.some((preset) => preset.name === currentPreset)) {
      el.suitepimPresetSelect.value = currentPreset;
    }

    let dropdown = document.getElementById("suitepimPresetDropdown");
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.id = "suitepimPresetDropdown";
      dropdown.className = "suitepim-preset-dropdown";
      el.suitepimPresetSelect.insertAdjacentElement("afterend", dropdown);
    }

    const selectedName = el.suitepimPresetSelect.value;
    const selected = state.presets.find((preset) => preset.name === selectedName);
    const isCustomSelected = selectedName === customPresetName;
    const customIndex = state.presets.length;
    dropdown.innerHTML = `
      <button class="suitepim-preset-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
        ${isCustomSelected ? presetLabelHtml(customPresetName, customIndex) : selected ? presetLabelHtml(selected.name, state.presets.indexOf(selected)) : `<span class="suitepim-preset-placeholder">Default</span>`}
        <span class="suitepim-preset-chevron" aria-hidden="true"></span>
      </button>
      <div class="suitepim-preset-menu" role="listbox" aria-label="Item management presets">
        <button class="suitepim-preset-option suitepim-preset-clear" type="button" role="option" data-preset-name="" aria-selected="${selected || isCustomSelected ? "false" : "true"}">
          <span class="suitepim-preset-placeholder">Default</span>
        </button>
        ${state.presets.map((preset, index) => `
          <button class="suitepim-preset-option ${presetToneClass(index)}" type="button" role="option" data-preset-name="${escapeHtml(preset.name)}" aria-selected="${preset.name === selected?.name ? "true" : "false"}">
            ${presetLabelHtml(preset.name, index)}
          </button>
        `).join("")}
        <button class="suitepim-preset-option ${presetToneClass(customIndex)}" type="button" role="option" data-preset-name="${customPresetName}" aria-selected="${isCustomSelected ? "true" : "false"}">
          ${presetLabelHtml(customPresetName, customIndex)}
        </button>
      </div>
    `;

    dropdown.querySelector(".suitepim-preset-trigger")?.addEventListener("click", () => {
      const isOpen = dropdown.classList.toggle("open");
      dropdown.querySelector(".suitepim-preset-trigger")?.setAttribute("aria-expanded", String(isOpen));
    });

    dropdown.querySelectorAll(".suitepim-preset-option").forEach((button) => {
      button.addEventListener("click", () => {
        el.suitepimPresetSelect.value = button.dataset.presetName || "";
        closePresetDropdown();
        el.suitepimPresetSelect.dispatchEvent(new Event("change", { bubbles: true }));
        renderPresetSelector();
      });
    });
  }

  function presetParts(name) {
    const marker = " : ";
    const markerIndex = name.indexOf(marker);
    if (markerIndex === -1) return { step: "", title: name };
    return {
      step: name.slice(0, markerIndex + marker.length),
      title: name.slice(markerIndex + marker.length),
    };
  }

  function presetToneClass(index) {
    return `suitepim-preset-tone-${(index % 5) + 1}`;
  }

  function presetLabelHtml(name, index) {
    const parts = presetParts(name);
    return `
      <span class="suitepim-preset-dot ${presetToneClass(index)}" aria-hidden="true"></span>
      <span class="suitepim-preset-text ${presetToneClass(index)}">
        ${parts.step ? `<span class="suitepim-preset-step">${escapeHtml(parts.step)}</span>` : ""}
        <strong>${escapeHtml(parts.title)}</strong>
      </span>
    `;
  }

  function closePresetDropdown() {
    const dropdown = document.getElementById("suitepimPresetDropdown");
    dropdown?.classList.remove("open");
    dropdown?.querySelector(".suitepim-preset-trigger")?.setAttribute("aria-expanded", "false");
  }

  function applyDefaultPreset() {
    state.visibleColumns = [...defaultVisibleColumns].filter((name) => fieldByName(name));
    state.activeFilters = state.activeFilters.filter((filter) => filter?.source !== "preset");
    state.page = 1;
    renderColumnChooser();
    renderActiveFilters();
    applyFilters();
    showStatus("Restored default table layout.", "success");
  }

  function applyCustomPreset() {
    const customPreset = state.customPreset || defaultCustomPreset();
    state.visibleColumns = cleanVisibleColumns(customPreset.fields);
    if (!state.visibleColumns.length) state.visibleColumns = cleanVisibleColumns(defaultVisibleColumns);
    state.activeFilters = cleanCustomFilters(customPreset.filters);
    state.page = 1;
    renderColumnChooser();
    renderActiveFilters();
    applyFilters();
    showStatus("Loaded Custom preset.", "success");
  }

  function normalizePresetValue(field, value) {
    if (field.fieldType === "Checkbox") return boolValue(value) ? "true" : "false";
    return value;
  }

  function presetValueLabel(field, value) {
    if (field.fieldType === "Checkbox") return value === "true" ? "Checked" : "Unchecked";
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  }

  function sameFilter(left, right) {
    if (!left || !right) return false;
    if (left.fieldName !== right.fieldName) return false;

    const leftValue = Array.isArray(left.value) ? left.value.map(String) : [String(left.value ?? "")];
    const rightValue = Array.isArray(right.value) ? right.value.map(String) : [String(right.value ?? "")];
    const leftLabel = Array.isArray(left.valueLabel) ? left.valueLabel.map(String) : [String(left.valueLabel ?? "")];
    const rightLabel = Array.isArray(right.valueLabel) ? right.valueLabel.map(String) : [String(right.valueLabel ?? "")];

    return leftValue.join("|") === rightValue.join("|") && leftLabel.join("|") === rightLabel.join("|");
  }

  function applyPreset() {
    const presetName = el.suitepimPresetSelect?.value;
    if (!presetName) {
      applyDefaultPreset();
      return;
    }

    if (presetName === customPresetName) {
      applyCustomPreset();
      return;
    }

    const preset = state.presets.find((entry) => entry.name === presetName);
    if (!preset) {
      showStatus("Preset could not be found.", "error");
      return;
    }

    const baseColumns = preset.name.endsWith(": Web Description")
      ? ["Name"]
      : ["Name", "Class", "Inactive"];
    state.visibleColumns = [...new Set([...baseColumns, ...preset.fields])].filter((name) => fieldByName(name));
    renderColumnChooser();

    const presetFilters = preset.filters
      .map((filter) => {
        const field = fieldByName(filter.field);
        if (!field) return null;
        const normalizedValue = normalizePresetValue(field, filter.value);
        return {
          fieldName: filter.field,
          value: normalizedValue,
          valueLabel: presetValueLabel(field, normalizedValue),
          source: "preset",
        };
      })
      .filter(Boolean);
    const manualFilters = state.activeFilters.filter((filter) => filter?.source !== "preset");

    state.activeFilters = [
      ...presetFilters,
      ...manualFilters.filter((filter) => !presetFilters.some((presetFilter) => sameFilter(presetFilter, filter))),
    ];

    state.page = 1;
    renderActiveFilters();
    applyFilters();
    const preservedCount = state.activeFilters.filter((filter) => filter?.source !== "preset").length;
    showStatus(
      preservedCount
        ? `Loaded ${preset.name} preset and kept ${preservedCount} manual filter${preservedCount === 1 ? "" : "s"}.`
        : `Loaded ${preset.name} preset.`,
      "success"
    );
  }

  function renderColumnChooser() {
    el.suitepimColumnList.innerHTML = "";
    state.fields.filter((field) => !field.hiddenField).forEach((field) => {
      const label = document.createElement("label");
      label.className = "suitepim-column-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.visibleColumns.includes(field.name);
      input.addEventListener("change", () => {
        if (input.checked && !state.visibleColumns.includes(field.name)) state.visibleColumns.push(field.name);
        if (!input.checked) state.visibleColumns = state.visibleColumns.filter((name) => name !== field.name);
        saveCustomPreset();
        renderTable();
      });
      label.append(input, document.createTextNode(field.name));
      el.suitepimColumnList.appendChild(label);
    });
  }

  function valueText(value) {
    if (Array.isArray(value)) return value.join(", ");
    return String(value ?? "");
  }

  function sortLabel(field, direction) {
    const numeric = ["Currency", "Decimal", "Integer", "Float", "Number"].includes(field?.fieldType);
    if (numeric) return direction === "asc" ? "Low to high" : "High to low";
    if (field?.fieldType === "Stock") return direction === "asc" ? "No stock first" : "Most stock first";
    if (field?.fieldType === "Checkbox") return direction === "asc" ? "Unchecked first" : "Checked first";
    return direction === "asc" ? "A to Z" : "Z to A";
  }

  function sortValue(row, field) {
    if (field?.fieldType === "Stock") {
      return stockRowsForDisplay(row).reduce((sum, stock) => sum + Math.max(stock.available, stock.onHand, 0), 0);
    }
    const value = row[field.name];
    if (field.fieldType === "Checkbox") return boolValue(value) ? 1 : 0;
    if (["Currency", "Decimal", "Integer", "Float", "Number"].includes(field.fieldType)) {
      const parsed = parseFloat(String(valueText(value)).replace(/[^0-9.-]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return stripHtml(valueText(value)).toLowerCase();
  }

  function compareSortValues(left, right, direction) {
    const multiplier = direction === "desc" ? -1 : 1;
    const leftEmpty = left == null || left === "";
    const rightEmpty = right == null || right === "";
    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;
    if (typeof left === "number" && typeof right === "number") return (left - right) * multiplier;
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * multiplier;
  }

  function applySort(rows) {
    const field = fieldByName(state.sort.fieldName);
    if (!field || !state.sort.direction) return rows;
    return [...rows].sort((a, b) => {
      const valueCompare = compareSortValues(sortValue(a, field), sortValue(b, field), state.sort.direction);
      if (valueCompare) return valueCompare;
      return valueText(a.Name).localeCompare(valueText(b.Name), undefined, { numeric: true, sensitivity: "base" });
    });
  }

  function sortHeaderHtml(name) {
    const field = fieldByName(name) || {};
    const selected = state.sort.fieldName === name ? state.sort.direction : "";
    return `
      <div class="suitepim-sort-header">
        <span>${escapeHtml(name)}</span>
        <select class="suitepim-sort-select" data-sort-field="${escapeHtml(name)}" aria-label="Sort ${escapeHtml(name)}">
          <option value=""${selected ? "" : " selected"}>Sort</option>
          <option value="asc"${selected === "asc" ? " selected" : ""}>${escapeHtml(sortLabel(field, "asc"))}</option>
          <option value="desc"${selected === "desc" ? " selected" : ""}>${escapeHtml(sortLabel(field, "desc"))}</option>
        </select>
      </div>
    `;
  }

  function clearHiddenSort() {
    if (state.sort.fieldName && !state.visibleColumns.includes(state.sort.fieldName)) {
      state.sort = { fieldName: "", direction: "" };
    }
  }

  function childItemName(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const parts = text.split(" : ").map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : text;
  }

  function fieldUsesOptions(field) {
    return ["List/Record", "multiple-select", "image"].includes(field?.fieldType) || field?.hasOptions || field?.optionFeed;
  }

  function optionNameById(field, id) {
    const options = state.options.get(field.name) || [];
    return options.find((option) => String(option.id) === String(id))?.name || "";
  }

  function findOptionByName(options, name) {
    const wanted = String(name || "").trim().toLowerCase();
    if (!wanted) return null;

    return options.find((option) => option.name.toLowerCase() === wanted)
      || options.find((option) => String(option.name).split(" : ").pop().trim().toLowerCase() === wanted)
      || null;
  }

  function filterLabel(filter) {
    const field = fieldByName(filter.fieldName) || {};
    if (filter.valueLabel) return filter.valueLabel;
    if (Array.isArray(filter.value)) return filter.value.join(", ");
    if (field.fieldType === "Checkbox") return filter.value === "true" ? "Checked" : "Unchecked";
    return valueText(filter.value);
  }

  function controlPlaceholder(field) {
    if (!field) return "Choose field first";
    if (field.fieldType === "Checkbox") return "";
    if (field.fieldType === "Currency") return "Enter amount";
    if (["Decimal", "Integer", "Float", "Number"].includes(field.fieldType)) return "Enter number";
    if (fieldUsesOptions(field)) return "Select value";
    return "Type value";
  }

  function emptyControl(host, text = "Choose a field first") {
    host.innerHTML = `<div class="suitepim-muted-note">${escapeHtml(text)}</div>`;
  }

  function createOptionButton({ field, multiple, value = null, valueLabel = "", onChange }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suitepim-value-btn";
    let displayValueLabel = valueLabel;

    const setLabel = () => {
      if (multiple) {
        const names = Array.isArray(displayValueLabel) ? displayValueLabel : String(displayValueLabel || "").split(",").filter(Boolean);
        button.textContent = names.length ? `${names.length} selected` : "Select";
        button.title = names.join(", ");
      } else {
        button.textContent = displayValueLabel || "Select";
        button.title = displayValueLabel || "";
      }
    };

    setLabel();
    button.addEventListener("click", async () => {
      showStatus(`Loading ${field.name} options...`);
      const options = await ensureOptions(field);
      showStatus("");
      const selected = new Set(
        multiple
          ? Array.isArray(value) ? value.map(String) : String(value || "").split(",").filter(Boolean)
          : value ? [String(value)] : []
      );

      state.modal = {
        field,
        multiple,
        options,
        selected,
        requiresSearch: field.fieldType === "image",
        minSearchLength: field.fieldType === "image" ? 4 : 0,
        onSave(ids, values, labels) {
          value = multiple ? ids : ids[0] || "";
          valueLabel = multiple ? values : values[0] || "";
          displayValueLabel = multiple ? labels : labels[0] || "";
          setLabel();
          onChange(value, valueLabel, multiple ? ids : ids[0] || "");
        },
      };
      el.suitepimModalTitle.textContent = `Select ${field.name}`;
      el.suitepimModalSearch.value = "";
      el.suitepimModalSearch.placeholder = field.fieldType === "image"
        ? "Type at least 4 characters to search images..."
        : "Search options...";
      el.suitepimModal.classList.remove("hidden");
      renderModalOptions();
    });

    return button;
  }

  async function renderTypedControl({ host, field, mode, currentValue = null, currentLabel = "", onChange }) {
    host.innerHTML = "";
    if (!field) {
      emptyControl(host);
      return;
    }

    const fieldType = field.fieldType || "Free-Form Text";

    if (fieldType === "Generate") {
      host.innerHTML = `<div class="suitepim-muted-note">No value needed. This will generate descriptions for the chosen bulk scope.</div>`;
      onChange(true, "Generate");
      return;
    }

    if (fieldType === "Checkbox") {
      const select = document.createElement("select");
      select.innerHTML = `
        <option value="">Any</option>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      `;
      select.value = currentValue ?? "";
      select.addEventListener("change", () => onChange(select.value, select.selectedOptions[0]?.textContent || ""));
      host.appendChild(select);
      return;
    }

    if (fieldUsesOptions(field)) {
      if (mode === "filter" && fieldType === "List/Record") {
        const select = document.createElement("select");
        select.innerHTML = `<option value="">All</option>`;
        host.appendChild(select);
        const options = await ensureOptions(field);
        options.forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.name;
          opt.dataset.internalid = option.id;
          opt.textContent = option.name;
          select.appendChild(opt);
        });
        select.value = currentValue || "";
        select.addEventListener("change", () => {
          const selected = select.selectedOptions[0];
          onChange(select.value, selected?.textContent || "", selected?.dataset.internalid || "");
        });
        return;
      }

      const multiple = fieldType === "multiple-select";
      host.appendChild(createOptionButton({
        field,
        multiple,
        value: currentValue,
        valueLabel: currentLabel,
        onChange,
      }));
      return;
    }

    if (fieldType === "rich-text") {
      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.placeholder = controlPlaceholder(field);
      textarea.value = currentValue ?? "";
      textarea.addEventListener("input", () => onChange(textarea.value, textarea.value));
      host.appendChild(textarea);
      return;
    }

    const input = document.createElement("input");
    input.type = ["Currency", "Decimal", "Integer", "Float", "Number"].includes(fieldType) ? "number" : "search";
    input.step = fieldType === "Currency" ? "0.01" : "0.1";
    input.placeholder = controlPlaceholder(field);
    input.value = currentValue ?? "";
    input.addEventListener("input", () => onChange(input.value, input.value));
    host.appendChild(input);
  }

  function renderActiveFilters() {
    el.suitepimActiveFilters.innerHTML = "";
    if (!state.activeFilters.length) {
      el.suitepimActiveFilters.innerHTML = `<div class="suitepim-muted-note">No field filters applied</div>`;
      return;
    }

    state.activeFilters.forEach((filter, index) => {
      const chip = document.createElement("div");
      chip.className = "suitepim-filter-chip";
      chip.classList.toggle("is-preset", filter?.source === "preset");
      const sourceLabel = filter?.source === "preset" ? "Preset" : "Manual";
      chip.innerHTML = `<span><small>${escapeHtml(sourceLabel)}</small>${escapeHtml(filter.fieldName)}: ${escapeHtml(filterLabel(filter))}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "x";
      remove.setAttribute("aria-label", `Remove ${filter.fieldName} filter`);
      remove.addEventListener("click", () => {
        state.activeFilters.splice(index, 1);
        state.page = 1;
        renderActiveFilters();
        saveCustomPreset();
        applyFilters();
      });
      chip.appendChild(remove);
      el.suitepimActiveFilters.appendChild(chip);
    });
  }

  function renderFilterValueControl() {
    const field = fieldByName(el.suitepimFilterField.value);
    state.filterDraft = { fieldName: field?.name || "", value: "", valueLabel: "", internalId: "" };
    renderTypedControl({
      host: el.suitepimFilterValueHost,
      field,
      mode: "filter",
      onChange(value, valueLabel, internalId = "") {
        state.filterDraft = {
          fieldName: field.name,
          value,
          valueLabel,
          internalId,
        };
      },
    }).catch((err) => showStatus(err.message, "error"));
  }

  function renderBulkModeOptions(field) {
    const isPricing = isBulkPricingField(field?.name);
    const isText = isBulkTextField(field);
    el.suitepimBulkMode.innerHTML = "";

    if (!isPricing && !isText) {
      el.suitepimBulkMode.hidden = true;
      el.suitepimBulkMode.disabled = true;
      return "set";
    }

    const options = isPricing
      ? [
          ["set", "Set to"],
          ["add-value", "Increase by value"],
          ["add-percent", "Increase by percent"],
        ]
      : [
          ["set", "Set to"],
          ["prefix-size", "Prefix Size"],
        ];

    options.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      el.suitepimBulkMode.appendChild(option);
    });

    el.suitepimBulkMode.hidden = false;
    el.suitepimBulkMode.disabled = false;
    return options.some(([value]) => value === el.suitepimBulkMode.value) ? el.suitepimBulkMode.value : "set";
  }

  function renderBulkValueForCurrentMode(field) {
    if (state.bulkDraft?.mode === "prefix-size") {
      el.suitepimBulkValueHost.innerHTML = `<div class="suitepim-muted-note">No value needed. Each row's Size will be prefixed to the selected text field.</div>`;
      state.bulkDraft.value = true;
      state.bulkDraft.valueLabel = "Prefix Size";
      state.bulkDraft.internalIds = null;
      return;
    }

    renderTypedControl({
      host: el.suitepimBulkValueHost,
      field,
      mode: "bulk",
      onChange(value, valueLabel, internalIds = null) {
        state.bulkDraft = {
          fieldName: field.name,
          mode: isBulkPricingField(field.name) || isBulkTextField(field) ? el.suitepimBulkMode.value : "set",
          value: field.fieldType === "Checkbox" ? value === "true" : value,
          valueLabel,
          internalIds: fieldUsesOptions(field) ? (internalIds ?? value) : null,
        };
      },
    }).catch((err) => showStatus(err.message, "error"));
  }

  function renderBulkValueControl() {
    const field = fieldByName(el.suitepimBulkField.value);
    const isPricing = isBulkPricingField(field?.name);
    const mode = renderBulkModeOptions(field);
    el.suitepimBulkMode.value = mode;
    el.suitepimBulkMode.closest(".suitepim-bulk-row")?.classList.toggle("is-pricing", isPricing);
    state.bulkDraft = {
      fieldName: field?.name || "",
      mode,
      value: field?.fieldType === "Generate" ? true : "",
      valueLabel: "",
      internalIds: null,
    };
    renderBulkValueForCurrentMode(field);
  }

  function addFilter() {
    const draft = state.filterDraft;
    if (!draft?.fieldName || draft.value === "" || draft.value == null || (Array.isArray(draft.value) && !draft.value.length)) {
      showStatus("Choose a filter field and value first.", "warning");
      return;
    }

    state.activeFilters.push({ ...draft, source: "manual" });
    el.suitepimFilterField.value = "";
    renderFilterValueControl();
    state.page = 1;
    renderActiveFilters();
    saveCustomPreset();
    applyFilters();
  }

  function clearFilters() {
    state.activeFilters = [];
    state.page = 1;
    renderActiveFilters();
    saveCustomPreset();
    applyFilters();
  }

  function matchesFieldFilter(row, filter) {
    const field = fieldByName(filter.fieldName) || {};
    const raw = row[filter.fieldName];

    if (field.fieldType === "Checkbox") {
      if (!filter.value) return true;
      return boolValue(raw) === (filter.value === "true");
    }

    if (field.fieldType === "List/Record") {
      return valueText(raw).toLowerCase() === String(filter.valueLabel || filter.value).toLowerCase();
    }

    if (field.fieldType === "multiple-select") {
      const names = Array.isArray(raw) ? raw.map((item) => String(item).toLowerCase()) : valueText(raw).toLowerCase().split(",");
      const wanted = Array.isArray(filter.valueLabel)
        ? filter.valueLabel.map((item) => String(item).toLowerCase())
        : String(filter.valueLabel || filter.value).toLowerCase().split(",");
      return wanted.every((value) => names.some((name) => name.trim() === value.trim()));
    }

    if (field.fieldType === "image") {
      return valueText(raw).toLowerCase() === String(filter.valueLabel || filter.value).toLowerCase();
    }

    return valueText(raw).toLowerCase().includes(String(filter.value).toLowerCase());
  }

  function applyFilters() {
    clearHiddenSort();
    const search = el.suitepimSearch.value.trim().toLowerCase();
    const stateFilter = el.suitepimStateFilter.value;
    const showChildren = !!el.suitepimShowChildren?.checked;

    state.filteredRows = state.rows.filter((row) => {
      if (search) {
        const haystack = [
          row["Internal ID"],
          row["Item ID"],
          row.Name,
          row["Display Name"],
          row["Supplier Name"],
          row.Class,
          row["Sub-Class"],
        ].map(valueText).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (!showChildren && !boolValue(row["Is Parent"])) return false;
      if (stateFilter === "online" && !boolValue(row["Online?"])) return false;
      if (stateFilter === "offline" && boolValue(row["Online?"])) return false;
      if (stateFilter === "active" && boolValue(row.Inactive)) return false;
      if (stateFilter === "inactive" && !boolValue(row.Inactive)) return false;
      if (stateFilter === "parent" && !boolValue(row["Is Parent"])) return false;
      if (stateFilter === "changed" && !state.dirty.has(row._suitepimKey)) return false;
      if (stateFilter === "selected" && !state.selected.has(row._suitepimKey)) return false;

      if (!state.activeFilters.every((filter) => matchesFieldFilter(row, filter))) return false;

      return true;
    });
    state.filteredRows = applySort(state.filteredRows);

    const totalPages = maxPage();
    if (state.page > totalPages) state.page = totalPages;
    updateSummary();
    renderTable();
  }

  function hasActiveTableFilter() {
    return !!(
      el.suitepimSearch?.value.trim() ||
      (el.suitepimStateFilter?.value && el.suitepimStateFilter.value !== "all") ||
      state.activeFilters.length ||
      el.suitepimShowChildren?.checked === false
    );
  }

  function filteredResultsArePaginated() {
    return !hasActiveTableFilter();
  }

  function maxPage() {
    return filteredResultsArePaginated()
      ? Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize))
      : 1;
  }

  function updateSummary() {
    if (el.suitepimTotalCount) el.suitepimTotalCount.textContent = state.rows.length.toLocaleString();
    if (el.suitepimVisibleCount) el.suitepimVisibleCount.textContent = state.filteredRows.length.toLocaleString();
    if (el.suitepimSelectedCount) el.suitepimSelectedCount.textContent = state.selected.size.toLocaleString();
    if (el.suitepimChangedCount) el.suitepimChangedCount.textContent = state.dirty.size.toLocaleString();
  }

  function pageRows() {
    if (!filteredResultsArePaginated()) return state.filteredRows;
    const start = (state.page - 1) * state.pageSize;
    return state.filteredRows.slice(start, start + state.pageSize);
  }

  function renderPagination() {
    const pagination = el.suitepimPageLabel?.closest(".suitepim-pagination");
    const paginated = filteredResultsArePaginated();
    const totalPages = maxPage();

    if (pagination) pagination.hidden = false;

    if (!paginated) {
      state.page = 1;
      if (el.suitepimPageLabel) {
        el.suitepimPageLabel.textContent = `Showing all ${state.filteredRows.length.toLocaleString()} filtered row${state.filteredRows.length === 1 ? "" : "s"}`;
      }
      if (el.suitepimPrevPage) el.suitepimPrevPage.hidden = true;
      if (el.suitepimNextPage) el.suitepimNextPage.hidden = true;
      return;
    }

    if (el.suitepimPageLabel) el.suitepimPageLabel.textContent = `Page ${state.page} of ${totalPages}`;
    if (el.suitepimPrevPage) {
      el.suitepimPrevPage.hidden = false;
      el.suitepimPrevPage.disabled = state.page <= 1;
    }
    if (el.suitepimNextPage) {
      el.suitepimNextPage.hidden = false;
      el.suitepimNextPage.disabled = state.page >= totalPages;
    }
  }

  function renderTable() {
    if (!state.rows.length) {
      el.suitepimMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>No Item Management records loaded</h2>
          <p>Use refresh once the SuitePim feed is available.</p>
        </div>
      `;
      return;
    }

    const rows = pageRows();
    const columns = state.visibleColumns.filter((name) => fieldByName(name));
    renderPagination();

    const table = document.createElement("table");
    table.className = "suitepim-table";
    table.innerHTML = `
      <colgroup>
        <col style="width: ${selectColumnWidth}px;">
        ${columns.map((name) => `<col data-column="${escapeHtml(name)}" style="width: ${columnWidth(name)}px;">`).join("")}
      </colgroup>
      <thead>
        <tr>
          <th class="suitepim-select-col"><input id="suitepimSelectPage" type="checkbox" aria-label="${filteredResultsArePaginated() ? "Select page" : "Select filtered results"}"></th>
          ${columns.map((name) => `
            <th class="${name === "Name" ? "suitepim-sticky-name-col" : ""}" data-column="${escapeHtml(name)}" style="width: ${columnWidth(name)}px;">
              ${sortHeaderHtml(name)}
              <button class="suitepim-column-resizer" type="button" title="Drag to resize column" aria-label="Resize ${escapeHtml(name)} column"></button>
            </th>
          `).join("")}
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.key = row._suitepimKey;
      if (boolValue(row["Is Parent"])) tr.classList.add("is-parent");
      if (boolValue(row.Inactive)) tr.classList.add("is-inactive");
      if (state.dirty.has(row._suitepimKey)) tr.classList.add("is-dirty");

      const selectTd = document.createElement("td");
      selectTd.className = "suitepim-select-col";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selected.has(row._suitepimKey);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selected.add(row._suitepimKey);
        else state.selected.delete(row._suitepimKey);
        updateSummary();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      columns.forEach((column) => {
        const td = document.createElement("td");
        td.dataset.column = column;
        if (column === "Name") td.classList.add("suitepim-sticky-name-col");
        if (isCellEditableText(row, column)) {
          setupEditableTextCell(td, row, column);
        } else {
          td.appendChild(renderCell(row, column));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    const tableWrap = document.createElement("div");
    tableWrap.className = "suitepim-table-wrap";
    tableWrap.appendChild(table);
    const topScroller = createTableScrollSlider("top");
    const bottomScroller = createTableScrollSlider("bottom");
    el.suitepimMount.innerHTML = "";
    el.suitepimMount.appendChild(topScroller);
    el.suitepimMount.appendChild(tableWrap);
    el.suitepimMount.appendChild(bottomScroller);
    applyColumnWidths(table, columns);
    setupTableScrollSliders(el.suitepimMount, columns, topScroller, bottomScroller);

    const pageSelector = table.querySelector("#suitepimSelectPage");
    pageSelector.checked = rows.length > 0 && rows.every((row) => state.selected.has(row._suitepimKey));
    pageSelector.addEventListener("change", () => {
      rows.forEach((row) => {
        if (pageSelector.checked) state.selected.add(row._suitepimKey);
        else state.selected.delete(row._suitepimKey);
      });
      updateSummary();
      renderTable();
    });

    table.querySelectorAll(".suitepim-sort-select").forEach((select) => {
      select.addEventListener("change", () => {
        state.sort = {
          fieldName: select.value ? select.dataset.sortField || "" : "",
          direction: select.value,
        };
        state.page = 1;
        applyFilters();
      });
    });
    setupColumnResizing(table, columns);
  }

  function createTableScrollSlider(position) {
    const wrap = document.createElement("div");
    wrap.className = `suitepim-table-scroll-slider suitepim-table-scroll-slider-${position}`;
    wrap.hidden = true;

    const track = document.createElement("div");
    track.className = "suitepim-table-scrollbar";
    track.tabIndex = 0;
    track.setAttribute("role", "scrollbar");
    track.setAttribute("aria-orientation", "horizontal");
    track.setAttribute("aria-label", position === "top" ? "Scroll table horizontally" : "Scroll table horizontally at bottom");

    const spacer = document.createElement("div");
    spacer.className = "suitepim-table-scrollbar-spacer";
    track.appendChild(spacer);
    wrap.appendChild(track);
    return wrap;
  }

  function setupTableScrollSliders(scroller, columns, ...sliderWraps) {
    const tracks = sliderWraps.map((wrap) => wrap.querySelector(".suitepim-table-scrollbar")).filter(Boolean);
    if (!tracks.length) return;

    const maxScroll = () => Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const minimumHiddenColumnWidth = () => {
      const widths = columns
        .filter((name) => name !== "Name")
        .map((name) => columnWidth(name))
        .filter((width) => Number.isFinite(width) && width > 0);
      return Math.max(80, Math.min(...widths, minColumnWidth));
    };

    const sync = () => {
      const max = maxScroll();
      const shouldShow = max >= minimumHiddenColumnWidth();
      scroller.classList.toggle("has-horizontal-table-scroll", shouldShow);
      sliderWraps.forEach((wrap) => {
        wrap.hidden = !shouldShow;
      });
      tracks.forEach((track) => {
        const spacer = track.querySelector(".suitepim-table-scrollbar-spacer");
        if (spacer) spacer.style.width = `${scroller.scrollWidth}px`;
        if (Math.abs(track.scrollLeft - scroller.scrollLeft) > 1) {
          track.scrollLeft = scroller.scrollLeft;
        }
      });
    };

    tracks.forEach((track) => {
      track.addEventListener("scroll", () => {
        if (Math.abs(scroller.scrollLeft - track.scrollLeft) > 1) {
          scroller.scrollLeft = track.scrollLeft;
        }
      }, { passive: true });
      track.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") scroller.scrollLeft -= 40;
        if (event.key === "ArrowRight") scroller.scrollLeft += 40;
      });
    });

    scroller.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync, { passive: true });
    requestAnimationFrame(sync);
  }

  function applyColumnWidths(table, columns, widths = null) {
    const totalWidth = tableAvailableWidth(table, columns);
    const nextWidths = widths || normalizedColumnWidths(columns, totalWidth);
    const tableWidth = selectColumnWidth + columns.reduce((sum, name) => sum + (nextWidths[name] || columnWidth(name)), 0);
    table.style.width = `${Math.max(totalWidth, tableWidth)}px`;
    table.style.minWidth = `${selectColumnWidth + (columns.length * minColumnWidth)}px`;
    columns.forEach((name) => {
      const width = nextWidths[name] || columnWidth(name);
      const col = table.querySelector(`col[data-column="${CSS.escape(name)}"]`);
      const th = table.querySelector(`th[data-column="${CSS.escape(name)}"]`);
      if (col) col.style.width = `${width}px`;
      if (th) th.style.width = `${width}px`;
    });
  }

  function currentRenderedWidths(table, columns) {
    return Object.fromEntries(columns.map((name) => {
      const th = table.querySelector(`th[data-column="${CSS.escape(name)}"]`);
      return [name, th?.getBoundingClientRect().width || columnWidth(name)];
    }));
  }

  function redistributeWidth(widths, targetColumn, amount) {
    let remaining = amount;
    while (Math.abs(remaining) >= 0.5) {
      const candidates = Object.keys(widths).filter((name) => {
        if (name === targetColumn) return false;
        return remaining > 0 ? widths[name] < maxColumnWidth : widths[name] > minColumnWidth;
      });
      if (!candidates.length) break;

      const share = remaining / candidates.length;
      let applied = 0;
      candidates.forEach((name) => {
        const capacity = remaining > 0 ? maxColumnWidth - widths[name] : minColumnWidth - widths[name];
        const change = remaining > 0 ? Math.min(capacity, share) : Math.max(capacity, share);
        widths[name] += change;
        applied += change;
      });
      if (Math.abs(applied) < 0.5) break;
      remaining -= applied;
    }
    return remaining;
  }

  function resizedColumnWidths(columns, targetColumn, startWidths, delta) {
    const widths = { ...startWidths };
    const index = columns.indexOf(targetColumn);
    if (index === -1 || columns.length < 2) return widths;

    const totalWidth = columns.reduce((sum, name) => sum + startWidths[name], 0);
    const targetMax = Math.min(maxColumnWidth, totalWidth - ((columns.length - 1) * minColumnWidth));
    const startWidth = startWidths[targetColumn];
    const nextTargetWidth = Math.max(minColumnWidth, Math.min(targetMax, startWidth + delta));
    const targetDelta = nextTargetWidth - startWidth;
    widths[targetColumn] = nextTargetWidth;

    const leftover = redistributeWidth(widths, targetColumn, -targetDelta);
    if (Math.abs(leftover) >= 0.5) {
      widths[targetColumn] += leftover;
    }

    const rounded = Object.fromEntries(columns.map((name) => [name, Math.round(widths[name])]));
    let roundedDifference = Math.round(totalWidth) - columns.reduce((sum, name) => sum + rounded[name], 0);
    while (roundedDifference !== 0) {
      const direction = roundedDifference > 0 ? 1 : -1;
      const adjustable = columns.find((name) =>
        name !== targetColumn && (direction > 0 ? rounded[name] < maxColumnWidth : rounded[name] > minColumnWidth)
      ) || targetColumn;
      rounded[adjustable] += direction;
      roundedDifference -= direction;
    }
    return rounded;
  }

  function setupColumnResizing(table, columns) {
    table.querySelectorAll(".suitepim-column-resizer").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        const th = handle.closest("th[data-column]");
        const column = th?.dataset.column;
        if (!column) return;
        event.preventDefault();
        handle.setPointerCapture?.(event.pointerId);

        const startX = event.clientX;
        const startWidths = currentRenderedWidths(table, columns);
        document.body.classList.add("suitepim-is-resizing-column");
        table.classList.add("is-resizing-column");

        const onPointerMove = (moveEvent) => {
          const nextWidths = resizedColumnWidths(columns, column, startWidths, moveEvent.clientX - startX);
          state.columnWidths = { ...state.columnWidths, ...nextWidths };
          applyColumnWidths(table, columns, nextWidths);
        };

        const onPointerUp = () => {
          document.body.classList.remove("suitepim-is-resizing-column");
          table.classList.remove("is-resizing-column");
          saveColumnWidths();
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          document.removeEventListener("pointercancel", onPointerUp);
        };

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerUp);
      });
    });
  }

  function isNumericField(field) {
    return ["Currency", "Decimal", "Integer", "Float", "Number"].includes(field?.fieldType);
  }

  function isCellEditableText(row, column) {
    const field = fieldByName(column) || {};
    if (column === "New Feature Desc") return false;
    if (field.disableField || field.toolColumn) return false;
    if (isNumericField(field)) return false;
    if (["Checkbox", "List/Record", "multiple-select", "image", "Link", "Generate", "Preview"].includes(field.fieldType)) return false;
    return true;
  }

  function setupEditableTextCell(td, row, column) {
    td.classList.add("suitepim-editable-cell");
    td.contentEditable = "plaintext-only";
    td.role = "textbox";
    td.tabIndex = 0;
    td.ariaLabel = `Edit ${column}`;
    td.textContent = valueText(row[column]);
    td.addEventListener("input", () => updateCell(row, column, td.textContent));
    td.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      td.blur();
    });
  }

  function numericStockValue(value) {
    const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function stockKeyPart(value) {
    return String(value || "").trim().toLowerCase();
  }

  function stockNamePart(value) {
    const text = stockKeyPart(value);
    if (!text) return "";
    const leaf = text.includes(":") ? text.split(":").pop() : text;
    return leaf
      .replace(/\([^)]*\)/g, " ")
      .replace(/podist\d+/gi, " ")
      .replace(/-\d+\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function itemInventoryId(row) {
    return String(row?.["Internal ID"] || row?.internalid || row?.id || "").trim();
  }

  function itemDisplayName(row) {
    return String(row?.["Item ID"] || row?.Name || row?.["Display Name"] || itemInventoryId(row) || "").trim();
  }

  function isChildOfParent(parent, child) {
    if (!parent || !child || parent === child || boolValue(child["Is Parent"])) return false;
    const parentFull = itemDisplayName(parent).toLowerCase();
    const childFull = itemDisplayName(child).toLowerCase();
    const parentName = String(parent.Name || "").trim().toLowerCase();
    if (parentFull && childFull.startsWith(`${parentFull} : `)) return true;
    if (parentName && childFull.startsWith(`${parentName} : `)) return true;
    return false;
  }

  function childRowsForParent(parent) {
    return state.rows.filter((row) => isChildOfParent(parent, row));
  }

  function normalizeInventoryRow(row) {
    return {
      itemId: String(row["Item ID"] || row["Item Id"] || row.itemid || row.itemId || row.Item || "").trim(),
      itemName: String(row.Name || row.Item || row["Item Name"] || "").trim(),
      location: String(row.Location || row.location || "").trim(),
      lotNumber: String(row["Inventory Number"] || row.Number || row.inventoryNumber || "").trim(),
      bin: String(row["Bin Number"] || row.Bin || row.bin || "").trim(),
      status: String(row.Status || row.status || "").trim(),
      onHand: numericStockValue(row["On Hand"] ?? row.onHand ?? row.OnHand),
      committed: numericStockValue(row.Committed ?? row.committed ?? row["Quantity Committed"] ?? row["Qty Committed"]),
      available: numericStockValue(row.Available ?? row.available ?? row["Available Qty"] ?? row["Available Quantity"]),
    };
  }

  function normalizeCommitmentRow(row) {
    const itemId = String(
      row["Internal ID"] ||
      row["Internal Id"] ||
      row.ItemId ||
      row.itemId ||
      row["Item ID"] ||
      row["Item Id"] ||
      row.itemid ||
      ""
    ).trim();
    const lotNumber = String(row["Inventory Number"] || row.Number || row.inventoryNumber || row.lotNumber || row.Lot || row["Lot Number"] || "").trim();
    const location = String(row.Location || row.location || "").trim();
    const quantity = numericStockValue(
      row["Quantity On Backorder"] ??
      row["Quantity Committed"] ??
      row.Committed ??
      row.committed ??
      row.Quantity ??
      row.quantity
    );

    return {
      itemId,
      itemName: String(row.itemName || row.Name || row.Item || row["Item Name"] || "").trim(),
      lotNumber,
      location,
      quantity,
      transaction: String(row.transactionNumber || row.Transaction || row["Document Number"] || row["Sales Order"] || row["Order Number"] || row.TranID || row.tranid || "").trim(),
      transactionId: String(row.transactionId || row["Transaction ID"] || row.internalid || "").trim(),
      transactionType: String(row.transactionType || row.Type || row.type || "").trim(),
      customer: String(row.Customer || row.customer || row.Entity || row.entity || row.Store || "").trim(),
      date: String(row.Date || row.date || row["Transaction Date"] || row.trandate || "").trim(),
      status: String(row.orderStatus || row.Status || row.status || "").trim(),
    };
  }

  function normalizeCommitmentRows(rows) {
    return (rows || []).map(normalizeCommitmentRow).filter((row) => row.quantity > 0);
  }

  function commitmentMatchesStock(commitment, stock) {
    const commitmentLot = stockKeyPart(commitment.lotNumber);
    const commitmentLocation = stockKeyPart(commitment.location);
    const stockLot = stockKeyPart(stock.lotNumber);
    const stockLocation = stockKeyPart(stock.location);
    const commitmentName = stockNamePart(commitment.itemName);
    const stockName = stockNamePart(stock.itemName);
    const lotMatches = !!(commitmentLot && stockLot && stockPartMatches(commitmentLot, stockLot));
    const locationMatches = !!(commitmentLocation && stockLocation && commitmentLocation === stockLocation);
    const itemMatches = !!(commitment.itemId && stock.itemId && commitment.itemId === stock.itemId);
    const nameMatches = !!(
      commitmentName &&
      (
        (stockName && stockPartMatches(commitmentName, stockName)) ||
        (stockLot && stockNamePart(stockLot).includes(commitmentName)) ||
        (commitmentLot && stockName && stockNamePart(commitmentLot).includes(stockName))
      )
    );

    if (!commitmentLot && !commitmentLocation) return false;
    if (commitmentLot && stockLot && !lotMatches) return false;
    if (commitmentLocation && stockLocation && !locationMatches) return false;
    if (!itemMatches && !lotMatches && !nameMatches) return false;
    return locationMatches && (itemMatches || lotMatches || nameMatches);
  }

  function stockPartMatches(a, b) {
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  function mergeInventoryRows(balanceRows, numberRows, commitmentRows = []) {
    const numberAgg = new Map();
    (numberRows || []).forEach((row) => {
      const itemId = String(row["Item Id"] || row["Item ID"] || row.itemid || row.itemId || "").trim();
      const lotNumber = String(row.Number || row["Inventory Number"] || row.inventoryNumber || "").trim();
      const location = String(row.Location || row.location || "").trim();
      if (!itemId || !lotNumber || !location) return;

      const key = `${itemId}||${stockKeyPart(lotNumber)}||${stockKeyPart(location)}`;
      const existing = numberAgg.get(key) || { onHand: 0, committed: 0, available: 0, location };
      existing.onHand += numericStockValue(row["On Hand"] ?? row.onHand ?? row.OnHand);
      existing.committed += numericStockValue(row.Committed ?? row.committed ?? row["Quantity Committed"] ?? row["Qty Committed"]);
      existing.available += numericStockValue(row.Available ?? row.available ?? row["Available Qty"] ?? row["Available Quantity"]);
      existing.location = existing.location || location;
      numberAgg.set(key, existing);
    });

    const commitments = normalizeCommitmentRows(commitmentRows);

    return (balanceRows || []).map((row) => {
      const base = normalizeInventoryRow(row);
      const key = `${base.itemId}||${stockKeyPart(base.lotNumber)}||${stockKeyPart(base.location)}`;
      const agg = numberAgg.get(key);
      const merged = agg
        ? {
            ...base,
            location: agg.location || base.location,
            onHand: agg.onHand,
            committed: agg.committed || base.committed,
            available: agg.available,
          }
        : base;
      const matchingCommitments = commitments.filter((commitment) => commitmentMatchesStock(commitment, merged));
      const detailCommitted = matchingCommitments.reduce((sum, commitment) => sum + commitment.quantity, 0);
      const inferredCommitted = Math.max(0, merged.onHand - merged.available);
      return {
        ...merged,
        committed: Math.max(merged.committed || 0, detailCommitted, inferredCommitted),
        commitmentDetails: matchingCommitments,
      };
    });
  }

  function indexInventoryRows(rows) {
    state.inventoryRows = rows.filter((row) => row.itemId);
    state.inventoryByItemId = state.inventoryRows.reduce((map, row) => {
      if (!map.has(row.itemId)) map.set(row.itemId, []);
      map.get(row.itemId).push(row);
      return map;
    }, new Map());
  }

  async function ensureInventoryBalances() {
    if (state.inventoryLoaded) return;
    if (state.inventoryLoading) return state.inventoryLoading;
    state.inventoryError = "";
    state.inventoryLoading = Promise.all([
      apiFetch("/api/netsuite/inventorybalance"),
      apiFetch("/api/netsuite/invoice-numbers").catch(() => ({ results: [] })),
      apiFetch("/api/netsuite/committed-lines").catch(() => ({ results: [] })),
    ])
      .then(([balanceData, numberData, commitmentData]) => {
        const balanceRows = balanceData.results || balanceData.rows || balanceData.items || [];
        const numberRows = numberData.results || numberData.rows || numberData.items || [];
        const commitmentRows = commitmentData.results || commitmentData.rows || commitmentData.items || [];
        state.inventoryCommitments = normalizeCommitmentRows(commitmentRows);
        indexInventoryRows(mergeInventoryRows(balanceRows, numberRows, commitmentRows));
        state.inventoryLoaded = true;
      })
      .catch((err) => {
        state.inventoryError = err.message || "Inventory unavailable";
        state.inventoryCommitments = [];
        indexInventoryRows([]);
      })
      .finally(() => {
        state.inventoryLoading = null;
        if (state.visibleColumns.includes("Stock on hand")) renderTable();
      });
    return state.inventoryLoading;
  }

  function resetInventoryBalances() {
    state.inventoryRows = [];
    state.inventoryByItemId = new Map();
    state.inventoryCommitments = [];
    state.inventoryLoading = null;
    state.inventoryLoaded = false;
    state.inventoryError = "";
  }

  async function apiFetch(url) {
    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  function stockRowsForItem(row) {
    return state.inventoryByItemId.get(itemInventoryId(row)) || [];
  }

  function stockRowsForDisplay(row) {
    if (!boolValue(row?.["Is Parent"])) return stockRowsForItem(row);
    const children = childRowsForParent(row);
    if (!children.length) return stockRowsForItem(row);
    return children.flatMap((child) => stockRowsForItem(child).map((stock) => ({ ...stock, itemName: itemDisplayName(child) })));
  }

  function hasAvailableStock(row) {
    return stockRowsForDisplay(row).some((stock) => stock.available > 0 || stock.onHand > 0);
  }

  function renderStockCell(row) {
    if (!state.inventoryLoaded && !state.inventoryLoading) {
      ensureInventoryBalances();
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "suitepim-stock-btn";

    if (state.inventoryLoading) {
      button.textContent = "Loading";
      button.disabled = true;
      return button;
    }

    const hasStock = hasAvailableStock(row);
    button.classList.toggle("has-stock", hasStock);
    button.classList.toggle("no-stock", !hasStock);
    button.title = hasStock ? "View inventory detail" : "No stock currently available";
    button.innerHTML = `
      <span class="suitepim-stock-box" aria-hidden="true"></span>
      <span>${hasStock ? "Inventory" : "No stock"}</span>
    `;
    button.addEventListener("click", () => openStockPopup(row));
    return button;
  }

  async function confirmInactiveWithStock(row) {
    await ensureInventoryBalances();
    if (!hasAvailableStock(row)) return true;
    return window.confirm("There is stock currently available for this item. Are you sure you want to set it as inactive?");
  }

  function stockReportRows(row) {
    if (!boolValue(row?.["Is Parent"])) {
      return stockRowsForItem(row).map((stock) => ({ ...stock, itemName: itemDisplayName(row) }));
    }
    const children = childRowsForParent(row);
    if (!children.length) return stockRowsForItem(row).map((stock) => ({ ...stock, itemName: itemDisplayName(row) }));
    return children.flatMap((child) => {
      const rows = stockRowsForItem(child);
      if (rows.length) return rows.map((stock) => ({ ...stock, itemName: itemDisplayName(child) }));
      return [{
        itemName: itemDisplayName(child),
        lotNumber: "",
        bin: "",
        status: "",
        onHand: 0,
        committed: 0,
        available: 0,
        commitmentDetails: [],
      }];
    });
  }

  async function openStockPopup(row) {
    if (state.inventoryLoaded && !state.inventoryCommitments.length) {
      resetInventoryBalances();
      await ensureInventoryBalances();
    }
    const isParent = boolValue(row?.["Is Parent"]);
    const rows = stockReportRows(row);
    const title = `${itemDisplayName(row) || "Item"} stock on hand`;
    const body = rows.length
      ? stockReportTable(rows, isParent)
      : `<div class="suitepim-empty-option">No inventory detail found for this item.</div>`;
    const popup = window.open("", "suitepim-stock-report", "width=1180,height=760,resizable=yes,scrollbars=yes");
    if (!popup) {
      showStatus("Stock report popup was blocked by the browser.", "warning");
      return;
    }
    popup.document.open();
    popup.document.write(stockPopupDocument(title, body, state.inventoryCommitments));
    popup.document.close();
    popup.document.title = title;
    popup.focus();
  }

  function stockReportTable(rows, includeItem) {
    const itemHeader = includeItem ? "<th>Item</th>" : "";
    const itemCells = (row) => includeItem ? `<td>${escapeHtml(row.itemName || "-")}</td>` : "";
    const committedCell = (row) => {
      const committed = numericStockValue(row.committed);
      if (!committed) return "0";
      let commitmentDetails = row.commitmentDetails || [];
      if (!commitmentDetails.length && state.inventoryCommitments.length) {
        commitmentDetails = state.inventoryCommitments.filter((commitment) => commitmentMatchesStock(commitment, row));
      }
      const details = encodeURIComponent(JSON.stringify(commitmentDetails));
      return `<button class="stock-commitment-link" type="button" data-commitments="${details}" data-item-name="${escapeHtml(row.itemName || "")}" data-lot="${escapeHtml(row.lotNumber || "-")}" data-location="${escapeHtml(row.location || "-")}">${escapeHtml(committed)}</button>`;
    };
    return `
      <section id="stockCommitmentPanel" class="commitment-panel" hidden></section>
      <div class="suitepim-stock-report-wrap">
        <table class="suitepim-stock-report">
          <thead>
            <tr>
              ${itemHeader}
              <th>Location</th>
              <th>Lot number</th>
              <th>BIN</th>
              <th>Status</th>
              <th>On hand</th>
              <th>Committed</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${itemCells(row)}
                <td data-filter-location="${escapeHtml(row.location || "-")}">${escapeHtml(row.location || "-")}</td>
                <td>${escapeHtml(row.lotNumber || "-")}</td>
                <td>${escapeHtml(row.bin || "-")}</td>
                <td data-filter-status="${escapeHtml(row.status || "-")}">${escapeHtml(row.status || "-")}</td>
                <td>${escapeHtml(row.onHand || 0)}</td>
                <td>${committedCell(row)}</td>
                <td>${escapeHtml(row.available || 0)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function stockPopupDocument(title, body, commitments = []) {
    const commitmentsJson = JSON.stringify(commitments).replace(/</g, "\\u003c");
    const filterScript = `
      <script>
        (function () {
          let allCommitments = ${commitmentsJson};

          function uniqueValues(selector, attr) {
            return Array.from(document.querySelectorAll(selector))
              .map((node) => node.getAttribute(attr) || "")
              .filter(Boolean)
              .filter((value, index, values) => values.indexOf(value) === index)
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
          }

          function populate(select, values) {
            values.forEach((value) => {
              const option = document.createElement("option");
              option.value = value;
              option.textContent = value;
              select.appendChild(option);
            });
          }

          function applyFilters() {
            const location = document.getElementById("stockLocationFilter").value;
            const status = document.getElementById("stockStatusFilter").value;
            document.querySelectorAll(".suitepim-stock-report tbody tr").forEach((row) => {
              const rowLocation = row.querySelector("[data-filter-location]")?.getAttribute("data-filter-location") || "";
              const rowStatus = row.querySelector("[data-filter-status]")?.getAttribute("data-filter-status") || "";
              row.hidden = !!((location && rowLocation !== location) || (status && rowStatus !== status));
            });
          }

          function escapeHtml(value) {
            return String(value == null ? "" : value)
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;");
          }

          function numericStockValue(value) {
            const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
            return Number.isFinite(parsed) ? parsed : 0;
          }

          function normalizeCommitmentRow(row) {
            return {
              itemId: String(row.ItemId || row.itemId || row["Item ID"] || row["Internal ID"] || "").trim(),
              itemName: String(row.itemName || row.Name || row.Item || row["Item Name"] || "").trim(),
              lotNumber: String(row.lotNumber || row["Lot Number"] || row["Inventory Number"] || row.Number || "").trim(),
              location: String(row.Location || row.location || "").trim(),
              quantity: numericStockValue(row["Quantity Committed"] ?? row.quantity ?? row.Quantity ?? row.committed ?? row.Committed),
              transaction: String(row.transactionNumber || row.Transaction || row["Document Number"] || row["Sales Order"] || row["Order Number"] || "").trim(),
              transactionId: String(row.transactionId || row["Transaction ID"] || row.internalid || "").trim(),
              transactionType: String(row.transactionType || row.Type || row.type || "").trim(),
              customer: String(row.Store || row.Customer || row.customer || row.Entity || row.entity || "").trim(),
              date: String(row.Date || row.date || row["Transaction Date"] || "").trim(),
              status: String(row.orderStatus || row.Status || row.status || "").trim(),
            };
          }

          function popupAuthHeaders() {
            const raw = sessionStorage.getItem("eposAuth") || localStorage.getItem("eposAuth") || "";
            try {
              const saved = JSON.parse(raw);
              return saved?.token ? { Authorization: \`Bearer \${saved.token}\` } : {};
            } catch {
              return {};
            }
          }

          async function ensurePopupCommitments() {
            if (allCommitments.length) return;
            const response = await fetch("/api/netsuite/committed-lines", {
              headers: popupAuthHeaders(),
              cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            const rows = data.results || data.rows || data.items || [];
            allCommitments = rows.map(normalizeCommitmentRow).filter((row) => row.quantity > 0);
          }

          function stockKeyPart(value) {
            return String(value || "").trim().toLowerCase();
          }

          function stockNamePart(value) {
            const text = stockKeyPart(value);
            if (!text) return "";
            const leaf = text.includes(":") ? text.split(":").pop() : text;
            return leaf
              .replace(/\\([^)]*\\)/g, " ")
              .replace(/podist\\d+/gi, " ")
              .replace(/-\\d+\\b/g, " ")
              .replace(/[^a-z0-9]+/g, " ")
              .trim()
              .replace(/\\s+/g, " ");
          }

          function stockPartMatches(a, b) {
            if (!a || !b) return false;
            return a === b || a.includes(b) || b.includes(a);
          }

          function findCommitmentsForRow(itemName, lot, location) {
            const rowLot = stockKeyPart(lot);
            const rowLocation = stockKeyPart(location);
            const rowName = stockNamePart(itemName || lot);
            return allCommitments.filter((detail) => {
              const detailLot = stockKeyPart(detail.lotNumber);
              const detailLocation = stockKeyPart(detail.location);
              const detailName = stockNamePart(detail.itemName || detail.lotNumber);
              const locationMatches = detailLocation && rowLocation && detailLocation === rowLocation;
              const lotMatches = detailLot && rowLot && stockPartMatches(detailLot, rowLot);
              const nameMatches = detailName && rowName && stockPartMatches(detailName, rowName);
              return locationMatches && (lotMatches || nameMatches);
            });
          }

          function dedupeCommitments(details) {
            const seen = new Set();
            return details.filter((detail) => {
              const key = [
                detail.transactionId,
                detail.transaction,
                detail.itemName,
                detail.lotNumber,
                detail.location,
                detail.quantity,
                detail.date,
              ].map((value) => String(value || "").toLowerCase()).join("|");
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }

          async function renderCommitmentDetails(button) {
            const panel = document.getElementById("stockCommitmentPanel");
            if (!panel) return;
            panel.hidden = false;
            panel.innerHTML = \`
              <div class="commitment-panel-header">
                <strong>Committed transactions</strong>
                <button type="button" id="stockCommitmentClose">Close</button>
              </div>
              <p>Loading committed transactions...</p>
            \`;
            let details = [];
            try {
              details = JSON.parse(decodeURIComponent(button.getAttribute("data-commitments") || "%5B%5D"));
            } catch {
              details = [];
            }
            const itemName = button.getAttribute("data-item-name") || "";
            const lot = button.getAttribute("data-lot") || "-";
            const location = button.getAttribute("data-location") || "-";
            if (!details.length) {
              try {
                await ensurePopupCommitments();
              } catch {
                allCommitments = [];
              }
              details = findCommitmentsForRow(itemName, lot, location);
            }
            details = dedupeCommitments(details);
            const rows = details.length
              ? details.map((detail) => \`
                <tr>
                  <td>\${escapeHtml(detail.transaction || detail.transactionId || "-")}</td>
                  <td>\${escapeHtml(detail.transactionType || "-")}</td>
                  <td>\${escapeHtml(detail.customer || "-")}</td>
                  <td>\${escapeHtml(detail.date || "-")}</td>
                  <td>\${escapeHtml(detail.status || "-")}</td>
                  <td>\${escapeHtml(detail.quantity || 0)}</td>
                </tr>
              \`).join("")
              : allCommitments.length
                ? \`<tr><td colspan="6">No matching committed transaction was found for this item name, lot, and location in the committed-lines feed.</td></tr>\`
                : \`<tr><td colspan="6">The committed-lines feed did not load into this popup. Restart the app server and refresh the Item Management page.</td></tr>\`;
            panel.innerHTML = \`
              <div class="commitment-panel-header">
                <strong>Committed transactions</strong>
                <button type="button" id="stockCommitmentClose">Close</button>
              </div>
              <p>Lot: \${escapeHtml(lot)} | Location: \${escapeHtml(location)}</p>
              <table class="commitment-table">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Type</th>
                    <th>Store / Customer</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>\${rows}</tbody>
              </table>
            \`;
            panel.hidden = false;
            document.getElementById("stockCommitmentClose")?.addEventListener("click", () => {
              panel.hidden = true;
            });
            panel.scrollIntoView({ block: "nearest" });
          }

          const locationSelect = document.getElementById("stockLocationFilter");
          const statusSelect = document.getElementById("stockStatusFilter");
          if (!locationSelect || !statusSelect) return;
          populate(locationSelect, uniqueValues("[data-filter-location]", "data-filter-location"));
          populate(statusSelect, uniqueValues("[data-filter-status]", "data-filter-status"));
          locationSelect.addEventListener("change", applyFilters);
          statusSelect.addEventListener("change", applyFilters);
          document.querySelectorAll(".stock-commitment-link").forEach((button) => {
            button.addEventListener("click", () => renderCommitmentDetails(button));
          });
        })();
      </script>
    `;

    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(title)}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              background: #f8fafc;
              color: #0f172a;
              font-family: Arial, sans-serif;
              font-size: 14px;
            }
            header {
              position: sticky;
              top: 0;
              z-index: 2;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 16px;
              padding: 18px 22px;
              border-bottom: 1px solid #dbe4ef;
              background: #fff;
            }
            h1 {
              margin: 0;
              font-size: 18px;
            }
            button {
              border: 1px solid #cbd5e1;
              border-radius: 6px;
              background: #fff;
              color: #0f172a;
              font: inherit;
              font-weight: 700;
              padding: 8px 12px;
              cursor: pointer;
            }
            main { padding: 18px 22px; }
            .filters {
              display: flex;
              flex-wrap: wrap;
              gap: 12px;
              align-items: end;
              margin-bottom: 14px;
            }
            label {
              display: grid;
              gap: 5px;
              color: #475569;
              font-size: 12px;
              font-weight: 700;
              text-transform: uppercase;
            }
            select {
              min-width: 190px;
              border: 1px solid #cbd5e1;
              border-radius: 6px;
              background: #fff;
              color: #0f172a;
              font: inherit;
              padding: 8px 10px;
            }
            .suitepim-stock-report-wrap {
              overflow: auto;
              border: 1px solid #dbe4ef;
              border-radius: 8px;
              background: #fff;
            }
            .suitepim-stock-report {
              width: 100%;
              border-collapse: collapse;
              font-size: 13px;
            }
            .suitepim-stock-report th,
            .suitepim-stock-report td {
              border-bottom: 1px solid #e2e8f0;
              padding: 10px 12px;
              text-align: left;
              white-space: nowrap;
            }
            .suitepim-stock-report th {
              position: sticky;
              top: 0;
              background: #f1f5f9;
              color: #334155;
              font-size: 12px;
              text-transform: uppercase;
            }
            .suitepim-empty-option {
              border: 1px solid #dbe4ef;
              border-radius: 8px;
              background: #fff;
              padding: 18px;
              color: #64748b;
            }
            .stock-commitment-link {
              min-width: 34px;
              border-color: #bfdbfe;
              color: #075985;
              padding: 4px 8px;
            }
            .stock-commitment-link:hover {
              background: #eff6ff;
            }
            .commitment-panel {
              margin-bottom: 14px;
              border: 1px solid #bfdbfe;
              border-radius: 8px;
              background: #eff6ff;
              padding: 12px;
            }
            .commitment-panel-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              margin-bottom: 8px;
            }
            .commitment-panel p {
              margin: 0 0 10px;
              color: #475569;
            }
            .commitment-table {
              width: 100%;
              border-collapse: collapse;
              background: #fff;
              font-size: 13px;
            }
            .commitment-table th,
            .commitment-table td {
              border-bottom: 1px solid #dbe4ef;
              padding: 8px 10px;
              text-align: left;
            }
            .commitment-table th {
              background: #dbeafe;
              color: #1e3a8a;
              font-size: 12px;
              text-transform: uppercase;
            }
          </style>
        </head>
        <body>
          <header>
            <h1>${escapeHtml(title)}</h1>
            <button type="button" onclick="window.close()">Close</button>
          </header>
          <main>
            <div class="filters">
              <label>
                Location
                <select id="stockLocationFilter">
                  <option value="">All locations</option>
                </select>
              </label>
              <label>
                Status
                <select id="stockStatusFilter">
                  <option value="">All statuses</option>
                </select>
              </label>
            </div>
            ${body}
          </main>
          ${filterScript}
        </body>
      </html>`;
  }

  function renderCell(row, column) {
    const field = fieldByName(column) || {};
    const value = row[column];

    if (field.fieldType === "Generate") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-value-btn suitepim-preview-btn";
      const isGenerating = state.generating.has(row._suitepimKey);
      const canGenerate = canManageFeatureDescription(row);
      button.textContent = isGenerating ? "Generating..." : "Generate";
      button.disabled = isGenerating || !state.aiGenerationConfigured || !canGenerate;
      button.title = !canGenerate
        ? "AI descriptions can only be generated on parent lines."
        : !state.aiGenerationConfigured
        ? "OpenAI generation is not configured on the server."
        : state.aiGenerationModel
          ? `Generate feature description with ${state.aiGenerationModel}`
          : "Generate feature description";
      button.addEventListener("click", () => generateDescription(row._suitepimKey));
      return button;
    }

    if (field.fieldType === "Stock") {
      return renderStockCell(row);
    }

    if (field.fieldType === "Preview") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-value-btn suitepim-preview-btn";
      button.textContent = "Preview";
      button.addEventListener("click", () => openPreviewModal(row._suitepimKey));
      return button;
    }

    if (field.disableField || field.fieldType === "Link") {
      const div = document.createElement("div");
      div.className = "suitepim-readonly";
      div.innerHTML = field.fieldType === "Link" && /<a\s/i.test(String(value || ""))
        ? String(value)
        : escapeHtml(valueText(value));
      return div;
    }

    if (field.fieldType === "Checkbox") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = boolValue(value);
      input.addEventListener("change", async () => {
        if (column === "Inactive" && input.checked) {
          const confirmed = await confirmInactiveWithStock(row);
          if (!confirmed) {
            input.checked = false;
            return;
          }
        }
        updateCell(row, column, input.checked);
      });
      return input;
    }

    if (field.fieldType === "List/Record" || field.fieldType === "image") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = field.fieldType === "image" ? "suitepim-value-btn suitepim-image-btn" : "suitepim-value-btn";
      if (field.fieldType === "image") {
        const url = extractImageUrl(valueText(value));
        button.innerHTML = `
          <span class="suitepim-image-btn-media">${imageThumb(url, column)}</span>
          <span class="suitepim-image-btn-copy">
            <strong>${url ? "Change image" : "Select image"}</strong>
            <small>${escapeHtml(url ? "Preview loaded" : "No image selected")}</small>
          </span>
        `;
      } else {
        button.textContent = valueText(value) || "Select";
      }
      button.addEventListener("click", () => openOptionModal({ row, field, multiple: false }));
      return button;
    }

    if (field.fieldType === "multiple-select") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-value-btn";
      const count = Array.isArray(value) ? value.length : 0;
      button.textContent = count ? `${count} selected` : "Select";
      button.title = valueText(value);
      button.addEventListener("click", () => openOptionModal({ row, field, multiple: true }));
      return button;
    }

    if (column === "New Feature Desc") {
      const wrap = document.createElement("div");
      wrap.className = "suitepim-rich-editor";
      const canEditFeatureDescription = canManageFeatureDescription(row);
      if (!canEditFeatureDescription) wrap.classList.add("is-disabled");
      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.value = valueText(value);
      textarea.disabled = !canEditFeatureDescription;
      textarea.title = canEditFeatureDescription ? "" : "Feature descriptions can only be edited on parent lines.";
      if (canEditFeatureDescription) {
        textarea.addEventListener("input", () => updateCell(row, column, textarea.value));
      }
      wrap.appendChild(textarea);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "suitepim-inline-generate-btn";
      const isGenerating = state.generating.has(row._suitepimKey);
      button.textContent = isGenerating ? "Generating..." : "Generate";
      button.disabled = isGenerating || !state.aiGenerationConfigured || !canEditFeatureDescription;
      button.title = !canEditFeatureDescription
        ? "AI descriptions can only be generated on parent lines."
        : !state.aiGenerationConfigured
        ? "OpenAI generation is not configured on the server."
        : state.aiGenerationModel
          ? `Generate feature description with ${state.aiGenerationModel}`
          : "Generate feature description";
      button.addEventListener("click", () => generateDescription(row._suitepimKey));
      wrap.appendChild(button);
      return wrap;
    }

    if (field.fieldType === "rich-text" || String(value || "").length > 80) {
      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.value = valueText(value);
      textarea.addEventListener("input", () => updateCell(row, column, textarea.value));
      return textarea;
    }

    const input = document.createElement("input");
    input.type = isNumericField(field) ? "number" : "text";
    input.step = field.fieldType === "Currency" ? "0.01" : "0.1";
    input.value = valueText(value);
    if (isCalculatedPriceField(column)) {
      input.addEventListener("input", () => updateCell(row, column, input.value, null, { recalc: true }));
    } else {
      input.addEventListener("input", () => updateCell(row, column, input.value));
    }
    return input;
  }

  function updateRenderedRow(rowKeyValue, updatedRow, changedColumn) {
    const tr = el.suitepimMount.querySelector(`tr[data-key="${CSS.escape(rowKeyValue)}"]`);
    if (!tr) return;
    tr.classList.toggle("is-dirty", state.dirty.has(rowKeyValue));

    ["Purchase Price", "Base Price", "Retail Price", "Sale Price", "Discount Percent", "Margin"].forEach((fieldName) => {
      if (fieldName === changedColumn || !state.visibleColumns.includes(fieldName)) return;
      const cell = tr.querySelector(`[data-column="${CSS.escape(fieldName)}"]`);
      if (!cell) return;
      const editable = cell.querySelector("input, textarea, button, select, [contenteditable='true'], [contenteditable='plaintext-only']");
      if (editable === document.activeElement) return;
      cell.replaceChildren(renderCell(updatedRow, fieldName));
    });
  }

  function rerenderCell(rowKeyValue, column) {
    const tr = el.suitepimMount.querySelector(`tr[data-key="${CSS.escape(rowKeyValue)}"]`);
    if (!tr) return;
    const cell = tr.querySelector(`[data-column="${CSS.escape(column)}"]`);
    const row = state.rows.find((item) => item._suitepimKey === rowKeyValue);
    if (!cell || !row) return;
    cell.replaceChildren(renderCell(row, column));
  }

  function shouldRefreshEditedCell(column) {
    const field = fieldByName(column) || {};
    return ["List/Record", "image", "multiple-select", "Preview", "Generate"].includes(field.fieldType);
  }

  function applyGeneratedFieldUpdates(row, fieldUpdates = {}) {
    const keys = Object.keys(fieldUpdates || {});
    if (!keys.length) return row;
    let current = row;
    keys.forEach((key) => {
      const nextValue = fieldUpdates[key];
      if (nextValue === undefined || nextValue === null || String(nextValue).trim() === "") return;
      updateCell(current, key, nextValue, null, { refreshCell: true });
      current = state.rows.find((item) => item._suitepimKey === row._suitepimKey) || current;
    });
    return current;
  }

  function updateCell(row, column, value, internalIds = null, options = {}) {
    if (column === "New Feature Desc" && !canManageFeatureDescription(row)) return;

    const idx = state.rows.findIndex((item) => item._suitepimKey === row._suitepimKey);
    if (idx === -1) return;

    let updated = { ...state.rows[idx], [column]: value };
    if (internalIds !== null) updated[`${column}_InternalId`] = internalIds;

    if (column === "New Feature Desc" && updated["Description Preview"]) {
      updated["Description Preview"] = patchFeatureDescriptionPreview(updated["Description Preview"], value);
    }

    if (options.recalc && isCalculatedPriceField(column)) {
      updated = recalcRow(updated, column);
    }

    state.rows[idx] = updated;
    const clean = JSON.stringify(stripInternal(updated));
    if (clean === state.baseline.get(updated._suitepimKey)) state.dirty.delete(updated._suitepimKey);
    else state.dirty.set(updated._suitepimKey, updated);
    state.selected.add(updated._suitepimKey);
    if (state.previewPopup && !state.previewPopup.closed && state.previewRowKey === updated._suitepimKey) {
      openPreviewModal(updated);
    }
    updateSummary();
    updateRenderedRow(updated._suitepimKey, updated, column);
    if (options.refreshCell || shouldRefreshEditedCell(column)) {
      rerenderCell(updated._suitepimKey, column);
    }
  }

  async function generateDescription(rowKeyValue) {
    const row = state.rows.find((item) => item._suitepimKey === rowKeyValue);
    if (!row) return;
    if (!canManageFeatureDescription(row)) {
      showStatus("AI descriptions can only be generated on parent lines.", "warning");
      return;
    }
    if (!state.aiGenerationConfigured) {
      showStatus("OpenAI generation is not configured on this server yet.", "warning");
      return;
    }

    state.generating.add(rowKeyValue);
    rerenderCell(rowKeyValue, "Generate Description");
    rerenderCell(rowKeyValue, "New Feature Desc");
    showStatus(`Generating feature description for ${valueText(row.Name || row["Display Name"] || "item")}...`, "info");

    try {
      const data = await api("/generate-description", {
        method: "POST",
        body: JSON.stringify({ row: stripInternal(row) }),
      });
      const refreshedRow = applyGeneratedFieldUpdates(row, data.fieldUpdates || {});
      updateCell(refreshedRow, "New Feature Desc", data.text, null, { refreshCell: true });
      const totalTokens = Number(data?.usage?.totalTokens || 0);
      const tokenSuffix = totalTokens ? ` (${totalTokens.toLocaleString()} tokens)` : "";
      const enrichSuffix = data.enriched ? " Product fields were also populated from EAN/GTIN lookup." : "";
      showStatus(`Generated feature description using ${data.model || "OpenAI"}${tokenSuffix}.${enrichSuffix} Review before pushing.`, "success");
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      state.generating.delete(rowKeyValue);
      rerenderCell(rowKeyValue, "Generate Description");
      rerenderCell(rowKeyValue, "New Feature Desc");
    }
  }

  async function generateDescriptionsBulk(targetRows) {
    const rowsToGenerate = targetRows.filter(canManageFeatureDescription);
    const skippedRows = targetRows.length - rowsToGenerate.length;

    if (!rowsToGenerate.length) {
      showStatus("No rows match the selected bulk action scope.", "warning");
      return;
    }

    let completed = 0;
    let totalTokens = 0;
    const skippedSuffix = skippedRows ? ` (${skippedRows.toLocaleString()} non-parent row(s) skipped)` : "";
    showStatus(`Generating descriptions for ${rowsToGenerate.length.toLocaleString()} parent row(s)${skippedSuffix}...`, "info");

    for (const targetRow of rowsToGenerate) {
      const row = state.rows.find((item) => item._suitepimKey === targetRow._suitepimKey);
      if (!row) continue;

      state.generating.add(row._suitepimKey);
      rerenderCell(row._suitepimKey, "Generate Description");
      rerenderCell(row._suitepimKey, "New Feature Desc");

      try {
        const data = await api("/generate-description", {
          method: "POST",
          body: JSON.stringify({ row: stripInternal(row) }),
        });
        totalTokens += Number(data?.usage?.totalTokens || 0);
        const refreshedRow = applyGeneratedFieldUpdates(row, data.fieldUpdates || {});
        updateCell(refreshedRow, "New Feature Desc", data.text, null, { refreshCell: true });
      } finally {
        state.generating.delete(row._suitepimKey);
        rerenderCell(row._suitepimKey, "Generate Description");
        rerenderCell(row._suitepimKey, "New Feature Desc");
      }

      completed += 1;
      showStatus(`Generated ${completed}/${rowsToGenerate.length} description(s)...`, "info");
    }

    showStatus(`Generated descriptions for ${completed.toLocaleString()} parent row(s) using ${totalTokens.toLocaleString()} tokens.${skippedSuffix} Review before pushing.`, "success");
  }

  async function ensureOptions(field) {
    if (!field.optionFeed && !field.hasOptions) return [];
    if (state.options.has(field.name)) return state.options.get(field.name);
    const data = await api(`/options/${encodeURIComponent(field.name)}`);
    const options = data.options || [];
    state.options.set(field.name, options);
    return options;
  }

  async function openOptionModal({ row, field, multiple }) {
    showStatus(`Loading ${field.name} options...`);
    const options = await ensureOptions(field);
    showStatus("");
    const currentIds = Array.isArray(row[`${field.name}_InternalId`])
      ? row[`${field.name}_InternalId`].map(String)
      : row[`${field.name}_InternalId`] ? [String(row[`${field.name}_InternalId`])] : [];
    const currentNames = Array.isArray(row[field.name])
      ? row[field.name].map((item) => String(item).trim()).filter(Boolean)
      : String(row[field.name] || "").split(",").map((item) => item.trim()).filter(Boolean);
    const selected = new Set(currentIds);

    currentNames.forEach((name) => {
      const match = findOptionByName(options, name);
      if (match?.id != null && match.id !== "") {
        selected.add(String(match.id));
      }
    });

    state.modal = {
      row,
      field,
      multiple,
      options,
      selected,
      requiresSearch: field.fieldType === "image",
      minSearchLength: field.fieldType === "image" ? 4 : 0,
    };
    el.suitepimModalTitle.textContent = `Select ${field.name}`;
    el.suitepimModalSearch.value = "";
    el.suitepimModalSearch.placeholder = field.fieldType === "image"
      ? "Type at least 4 characters to search images..."
      : "Search options...";
    el.suitepimModal.classList.remove("hidden");
    renderModalOptions();
  }

  function renderModalOptions() {
    const modal = state.modal;
    if (!modal) return;
    const term = el.suitepimModalSearch.value.trim().toLowerCase();
    const minSearchLength = Number(modal.minSearchLength || 0);
    if (modal.requiresSearch && term.length < minSearchLength) {
      el.suitepimModalOptions.innerHTML = `<div class="suitepim-empty-option">Type at least ${minSearchLength} characters to search.</div>`;
      return;
    }

    const filtered = modal.options
      .filter((option) => option.name.toLowerCase().includes(term))
      .sort((left, right) => {
        const leftSelected = modal.selected.has(String(left.id));
        const rightSelected = modal.selected.has(String(right.id));
        if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      });
    el.suitepimModalOptions.innerHTML = "";

    filtered.forEach((option) => {
      const label = document.createElement("label");
      label.className = "suitepim-modal-option";
      const input = document.createElement("input");
      input.type = modal.multiple ? "checkbox" : "radio";
      input.name = "suitepim-modal-option";
      input.checked = modal.selected.has(String(option.id));
      input.addEventListener("change", () => {
        if (!modal.multiple) modal.selected.clear();
        if (input.checked) modal.selected.add(String(option.id));
        else modal.selected.delete(String(option.id));
      });
      const copy = document.createElement("div");
      copy.className = "suitepim-modal-copy";
      copy.innerHTML = modal.field?.fieldType === "image"
        ? `
          <strong>${escapeHtml(option.name)}</strong>
          <small>${escapeHtml(String(option.id || ""))}</small>
        `
        : `<strong>${escapeHtml(option.name)}</strong>`;
      label.append(input, copy);
      el.suitepimModalOptions.appendChild(label);
    });

    if (!filtered.length) {
      el.suitepimModalOptions.innerHTML = `<div class="suitepim-empty-option">No options found</div>`;
    }
  }

  function closeModal() {
    state.modal = null;
    el.suitepimModalSearch.placeholder = "Search options...";
    el.suitepimModal.classList.add("hidden");
  }

  function saveModalSelection() {
    const modal = state.modal;
    if (!modal) return;
    const ids = Array.from(modal.selected);
    const selectedOptions = ids
      .map((id) => modal.options.find((option) => String(option.id) === String(id)))
      .filter(Boolean);
    const values = selectedOptions
      .map((option) => optionStoredValue(modal.field, option))
      .filter(Boolean);
    const labels = selectedOptions
      .map((option) => option.name)
      .filter(Boolean);

    if (typeof modal.onSave === "function") {
      modal.onSave(ids, values, labels);
      closeModal();
      return;
    }

    updateCell(modal.row, modal.field.name, modal.multiple ? values : values[0] || "", modal.multiple ? ids : ids[0] || "");
    closeModal();
  }

  async function applyBulkUpdate() {
    const field = fieldByName(state.bulkDraft?.fieldName);
    if (!field) {
      showStatus("Choose a bulk action field first.", "warning");
      return;
    }

    const draft = state.bulkDraft;
    const hasValue = field.fieldType === "Generate" || draft.mode === "prefix-size"
      ? true
      : Array.isArray(draft.value)
      ? draft.value.length > 0
      : draft.value !== "" && draft.value !== null && draft.value !== undefined;
    if (!hasValue) {
      showStatus("Choose a bulk action value first.", "warning");
      return;
    }

    const targetRows = el.suitepimBulkScope.value === "filtered"
      ? [...state.filteredRows]
      : state.rows.filter((row) => state.selected.has(row._suitepimKey));

    if (!targetRows.length) {
      showStatus("No rows match the selected bulk action scope.", "warning");
      return;
    }

    if (field.fieldType === "Generate") {
      try {
        await generateDescriptionsBulk(targetRows);
      } catch (err) {
        showStatus(err.message, "error");
      }
      return;
    }

    let updatedCount = 0;
    targetRows.forEach((row) => {
      const idx = state.rows.findIndex((item) => item._suitepimKey === row._suitepimKey);
      if (idx === -1) return;

      let value = draft.value;
      let internalIds = draft.internalIds;
      if (fieldUsesOptions(field)) {
        if (field.fieldType === "multiple-select") {
          value = Array.isArray(draft.valueLabel) ? draft.valueLabel : String(draft.valueLabel || "").split(",").filter(Boolean);
        } else if (field.fieldType === "image") {
          value = draft.valueLabel || "";
        } else {
          value = draft.valueLabel || optionNameById(field, draft.value) || "";
        }
      }

      let updated = { ...state.rows[idx], [field.name]: value };
      if (internalIds !== null && internalIds !== undefined) {
        updated[`${field.name}_InternalId`] = internalIds;
      }

      if (isBulkPricingField(field.name)) {
        const oldValue = parseFloat(state.rows[idx][field.name]) || 0;
        const amount = parseFloat(draft.value);
        if (!Number.isFinite(amount)) return;

        if (draft.mode === "add-value") {
          updated[field.name] = oldValue + amount;
        } else if (draft.mode === "add-percent") {
          updated[field.name] = oldValue * (1 + amount / 100);
        } else {
          updated[field.name] = amount;
        }
      }

      if (draft.mode === "prefix-size" && isBulkTextField(field)) {
        const nextValue = prefixSizeValue(state.rows[idx], state.rows[idx][field.name]);
        if (!nextValue || nextValue === String(state.rows[idx][field.name] || "").trim()) return;
        updated[field.name] = nextValue;
      }

      if (isCalculatedPriceField(field.name)) {
        updated = recalcRow(updated, field.name);
      }

      state.rows[idx] = updated;
      const clean = JSON.stringify(stripInternal(updated));
      if (clean === state.baseline.get(updated._suitepimKey)) state.dirty.delete(updated._suitepimKey);
      else state.dirty.set(updated._suitepimKey, updated);
      state.selected.add(updated._suitepimKey);
      updatedCount += 1;
    });

    state.page = 1;
    applyFilters();
    if (!updatedCount) {
      showStatus("No rows were updated. Check the selected rows have a Size and a text value to prefix.", "warning");
      return;
    }
    showStatus(`Bulk update applied to ${updatedCount.toLocaleString()} row(s). Review and push changes when ready.`, "success");
  }

  function togglePanel(button) {
    const panel = button.closest(".suitepim-collapsible");
    if (!panel) return;
    const collapsed = panel.classList.toggle("is-collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
  }

  async function pushSelected() {
    const rows = state.rows
      .filter((row) => state.selected.has(row._suitepimKey) && state.dirty.has(row._suitepimKey))
      .map(changedPayload);
    if (!rows.length) {
      showStatus("Select at least one changed row to push.", "warning");
      return;
    }

    el.suitepimPushBtn.disabled = true;
    if (el.suitepimPushReport) {
      el.suitepimPushReport.hidden = true;
      el.suitepimPushReport.innerHTML = "";
    }
    showStatus(`Queueing ${rows.length} selected row(s)...`, "info");

    try {
      const data = await api("/push-updates", {
        method: "POST",
        body: JSON.stringify({ rows, environment: state.environment }),
      });
      pollJob(data.jobId);
    } catch (err) {
      showStatus(err.message, "error");
      el.suitepimPushBtn.disabled = false;
    }
  }

  async function pollJob(jobId) {
    const timer = setInterval(async () => {
      try {
        const job = await api(`/push-status/${jobId}`);
        showStatus(`Push ${job.status}: ${job.processed}/${job.total} processed`, job.status === "completed" ? "success" : "info");
        if (job.status === "completed" || job.status === "error") {
          clearInterval(timer);
          el.suitepimPushBtn.disabled = false;
          commitSuccessfulPushResults(job.results || []);
          const ok = (job.results || []).filter((result) => result.status === "Success").length;
          const failed = (job.results || []).filter((result) => result.status === "Error").length;
          showStatus(`Push finished. ${ok} successful, ${failed} failed.`, failed ? "warning" : "success");
          renderPushReport(job);
        }
      } catch (err) {
        clearInterval(timer);
        el.suitepimPushBtn.disabled = false;
        showStatus(err.message, "error");
      }
    }, 2500);
  }

  function bindEvents() {
    el.suitepimSearch.addEventListener("input", () => {
      state.page = 1;
      applyFilters();
    });
    el.suitepimStateFilter.addEventListener("change", () => {
      state.page = 1;
      applyFilters();
    });
    el.suitepimShowChildren?.addEventListener("change", () => {
      state.page = 1;
      applyFilters();
    });
    el.suitepimFilterField.addEventListener("change", renderFilterValueControl);
    el.suitepimAddFilterBtn.addEventListener("click", addFilter);
    el.suitepimClearFiltersBtn.addEventListener("click", clearFilters);
    el.suitepimBulkField.addEventListener("change", renderBulkValueControl);
    el.suitepimBulkMode.addEventListener("change", () => {
      if (state.bulkDraft) state.bulkDraft.mode = el.suitepimBulkMode.value;
      const field = fieldByName(state.bulkDraft?.fieldName);
      renderBulkValueForCurrentMode(field);
    });
    el.suitepimApplyBulkBtn.addEventListener("click", applyBulkUpdate);
    el.suitepimToggleFiltersBtn.addEventListener("click", () => togglePanel(el.suitepimToggleFiltersBtn));
    el.suitepimToggleBulkBtn.addEventListener("click", () => togglePanel(el.suitepimToggleBulkBtn));
    el.suitepimRefreshBtn.addEventListener("click", () => loadProducts(true).catch((err) => showStatus(err.message, "error")));
    el.suitepimPushBtn.addEventListener("click", pushSelected);
    el.suitepimPresetSelect?.addEventListener("change", applyPreset);
    document.addEventListener("click", (event) => {
      const dropdown = document.getElementById("suitepimPresetDropdown");
      if (dropdown && !dropdown.contains(event.target)) closePresetDropdown();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePresetDropdown();
    });
    el.suitepimPrevPage.addEventListener("click", () => {
      state.page = Math.max(1, state.page - 1);
      renderTable();
    });
    el.suitepimNextPage.addEventListener("click", () => {
      state.page = Math.min(maxPage(), state.page + 1);
      renderTable();
    });
    el.suitepimColumnsBtn.addEventListener("click", () => {
      el.suitepimColumnsPanel.classList.add("open");
      el.suitepimColumnsPanel.setAttribute("aria-hidden", "false");
    });
    el.suitepimCloseColumns.addEventListener("click", () => {
      el.suitepimColumnsPanel.classList.remove("open");
      el.suitepimColumnsPanel.setAttribute("aria-hidden", "true");
    });
    el.suitepimModalSearch.addEventListener("input", renderModalOptions);
    el.suitepimModalClose.addEventListener("click", closeModal);
    el.suitepimModalCancel.addEventListener("click", closeModal);
    el.suitepimModalSave.addEventListener("click", saveModalSelection);
    el.suitepimPreviewClose?.addEventListener("click", closePreviewModal);
    el.suitepimPreviewDone?.addEventListener("click", closePreviewModal);
  }

  async function boot() {
    try {
      state.options.clear();
      state.activeFilters = [];
      await loadUserPreferenceKey();
      await loadConfig();
      await loadProducts();
    } catch (err) {
      console.error(err);
      showStatus(err.message, "error");
      el.suitepimMount.innerHTML = `
        <div class="suitepim-empty">
          <h2>Item Management could not load</h2>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  window.addEventListener("DOMContentLoaded", async () => {
    initEls();
    state.environment = "production";
    bindEvents();
    await boot();
  });
})();
