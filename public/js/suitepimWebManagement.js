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
    filterDraft: null,
    bulkDraft: null,
    page: 1,
    pageSize: 50,
    modal: null,
    previewPopup: null,
    previewRowKey: null,
    generating: new Set(),
    aiGenerationConfigured: false,
    aiGenerationModel: "",
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
    `;
    if (state.presets.some((preset) => preset.name === currentPreset)) {
      el.suitepimPresetSelect.value = currentPreset;
    }

    let dropdown = document.getElementById("suitepimPresetDropdown");
    if (!dropdown) {
      dropdown = document.createElement("div");
      dropdown.id = "suitepimPresetDropdown";
      dropdown.className = "suitepim-preset-dropdown";
      el.suitepimPresetSelect.insertAdjacentElement("afterend", dropdown);
    }

    const selected = state.presets.find((preset) => preset.name === el.suitepimPresetSelect.value);
    dropdown.innerHTML = `
      <button class="suitepim-preset-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
        ${selected ? presetLabelHtml(selected.name, state.presets.indexOf(selected)) : `<span class="suitepim-preset-placeholder">Default</span>`}
        <span class="suitepim-preset-chevron" aria-hidden="true"></span>
      </button>
      <div class="suitepim-preset-menu" role="listbox" aria-label="Item management presets">
        <button class="suitepim-preset-option suitepim-preset-clear" type="button" role="option" data-preset-name="" aria-selected="${selected ? "false" : "true"}">
          <span class="suitepim-preset-placeholder">Default</span>
        </button>
        ${state.presets.map((preset, index) => `
          <button class="suitepim-preset-option ${presetToneClass(index)}" type="button" role="option" data-preset-name="${escapeHtml(preset.name)}" aria-selected="${preset.name === selected?.name ? "true" : "false"}">
            ${presetLabelHtml(preset.name, index)}
          </button>
        `).join("")}
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
    const presetFilterFields = new Set(presetFilters.map((filter) => filter.fieldName));
    const manualFilters = state.activeFilters.filter((filter) =>
      filter?.source !== "preset" && !presetFilterFields.has(filter.fieldName)
    );

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
      chip.innerHTML = `<span>${escapeHtml(filter.fieldName)}: ${escapeHtml(filterLabel(filter))}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "x";
      remove.setAttribute("aria-label", `Remove ${filter.fieldName} filter`);
      remove.addEventListener("click", () => {
        state.activeFilters.splice(index, 1);
        state.page = 1;
        renderActiveFilters();
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

  function renderBulkValueControl() {
    const field = fieldByName(el.suitepimBulkField.value);
    const isPricing = isBulkPricingField(field?.name);
    el.suitepimBulkMode.hidden = !isPricing;
    el.suitepimBulkMode.disabled = !isPricing;
    el.suitepimBulkMode.closest(".suitepim-bulk-row")?.classList.toggle("is-pricing", isPricing);
    state.bulkDraft = {
      fieldName: field?.name || "",
      mode: isPricing ? el.suitepimBulkMode.value : "set",
      value: field?.fieldType === "Generate" ? true : "",
      valueLabel: "",
      internalIds: null,
    };
    renderTypedControl({
      host: el.suitepimBulkValueHost,
      field,
      mode: "bulk",
      onChange(value, valueLabel, internalIds = null) {
        state.bulkDraft = {
          fieldName: field.name,
          mode: isBulkPricingField(field.name) ? el.suitepimBulkMode.value : "set",
          value: field.fieldType === "Checkbox" ? value === "true" : value,
          valueLabel,
          internalIds: fieldUsesOptions(field) ? (internalIds ?? value) : null,
        };
      },
    }).catch((err) => showStatus(err.message, "error"));
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
    applyFilters();
  }

  function clearFilters() {
    state.activeFilters = [];
    state.page = 1;
    renderActiveFilters();
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

    const maxPage = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
    if (state.page > maxPage) state.page = maxPage;
    updateSummary();
    renderTable();
  }

  function updateSummary() {
    if (el.suitepimTotalCount) el.suitepimTotalCount.textContent = state.rows.length.toLocaleString();
    if (el.suitepimVisibleCount) el.suitepimVisibleCount.textContent = state.filteredRows.length.toLocaleString();
    if (el.suitepimSelectedCount) el.suitepimSelectedCount.textContent = state.selected.size.toLocaleString();
    if (el.suitepimChangedCount) el.suitepimChangedCount.textContent = state.dirty.size.toLocaleString();
  }

  function pageRows() {
    const start = (state.page - 1) * state.pageSize;
    return state.filteredRows.slice(start, start + state.pageSize);
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
    const maxPage = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
    el.suitepimPageLabel.textContent = `Page ${state.page} of ${maxPage}`;
    el.suitepimPrevPage.disabled = state.page <= 1;
    el.suitepimNextPage.disabled = state.page >= maxPage;

    const table = document.createElement("table");
    table.className = "suitepim-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th class="suitepim-select-col"><input id="suitepimSelectPage" type="checkbox" aria-label="Select page"></th>
          ${columns.map((name) => `<th>${escapeHtml(name)}</th>`).join("")}
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
        td.appendChild(renderCell(row, column));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    const tableWrap = document.createElement("div");
    tableWrap.className = "suitepim-table-wrap";
    tableWrap.appendChild(table);
    el.suitepimMount.innerHTML = "";
    el.suitepimMount.appendChild(tableWrap);

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
      input.addEventListener("change", () => updateCell(row, column, input.checked));
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
    input.type = ["Currency", "Decimal", "Integer", "Float", "Number"].includes(field.fieldType) ? "number" : "text";
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
      const editable = cell.querySelector("input, textarea, button, select");
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
    const hasValue = field.fieldType === "Generate"
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

      if (isCalculatedPriceField(field.name)) {
        updated = recalcRow(updated, field.name);
      }

      state.rows[idx] = updated;
      const clean = JSON.stringify(stripInternal(updated));
      if (clean === state.baseline.get(updated._suitepimKey)) state.dirty.delete(updated._suitepimKey);
      else state.dirty.set(updated._suitepimKey, updated);
      state.selected.add(updated._suitepimKey);
    });

    state.page = 1;
    applyFilters();
    showStatus(`Bulk update applied to ${targetRows.length.toLocaleString()} row(s). Review and push changes when ready.`, "success");
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
      const maxPage = Math.max(1, Math.ceil(state.filteredRows.length / state.pageSize));
      state.page = Math.min(maxPage, state.page + 1);
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
