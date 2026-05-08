(function () {
  const state = {
    campaigns: [],
    rows: [],
    fields: [],
    optionCache: new Map(),
    activeId: null,
    activeRow: null,
    pushJobs: new Map(),
    activePushPoll: null,
    activePushJobId: null,
    pageLoaded: false,
  };

  const el = {};

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
    return saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
  }

  function environment() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return String(localStorage.getItem("environment") || saved?.environment || "Sandbox").toLowerCase() === "production"
      ? "production"
      : "sandbox";
  }

  function apiUrl(path) {
    const joiner = path.includes("?") ? "&" : "?";
    return `/api/suitepim${path}${joiner}environment=${encodeURIComponent(environment())}`;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed: ${response.status}`);
    return data;
  }

  function showStatus(message, type = "") {
    el.status.textContent = message || "";
    el.status.dataset.type = type;
    el.status.hidden = !message;
  }

  function rowKey(row) {
    return String(row["Internal ID"] || row["Item ID"] || row.Name || "");
  }

  function productName(row) {
    return String(row.Name || row["Item ID"] || row["Display Name"] || row["Internal ID"] || "Unnamed item");
  }

  function basePrice(row) {
    const value = Number(row["Base Price"]);
    return Number.isFinite(value) ? value : 0;
  }

  function grossSalePrice(row, discount) {
    return Number((basePrice(row) * 1.2 * (1 - discount / 100)).toFixed(2));
  }

  function activeCampaign() {
    const title = el.title.value.trim();
    return {
      id: state.activeId,
      title: title || "Untitled campaign",
      sections: Array.from(el.sections.querySelectorAll(".suitepim-campaign-section")).map((section) => ({
        label: section.querySelector(".suitepim-campaign-section-label")?.value || "",
        color: section.querySelector(".suitepim-campaign-section-color")?.value || "",
        collapsed: section.classList.contains("is-collapsed"),
        rows: Array.from(section.querySelectorAll(".suitepim-campaign-row")).map((row) => ({
          label: row.querySelector(".suitepim-campaign-row-label")?.value || "",
          discount: row.querySelector(".suitepim-campaign-discount")?.value || "",
          pos: row.querySelector(".suitepim-campaign-pos")?.value || "",
          discPos: row.querySelector(".suitepim-campaign-disc-pos")?.value || "",
          other: row.querySelector(".suitepim-campaign-other")?.value || "",
          filters: JSON.parse(row.dataset.filters || "[]"),
        })),
      })),
    };
  }

  function setCampaign(data = null, id = null) {
    state.activeId = id;
    el.title.value = data?.title || "";
    el.sections.innerHTML = "";
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    if (!sections.length) {
      createSection({ label: "Campaign Section", rows: [{}] });
    } else {
      sections.forEach((section) => createSection(section));
    }
    el.delete.disabled = !state.activeId;
    showStatus(state.activeId ? "Campaign loaded." : "New campaign ready.", "success");
  }

  function renderCampaignList() {
    const term = el.search.value.trim().toLowerCase();
    const campaigns = state.campaigns.filter((campaign) => campaign.title.toLowerCase().includes(term));
    el.count.textContent = `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`;
    if (!campaigns.length) {
      el.list.innerHTML = `<div class="suitepim-empty-option">No campaigns saved yet.</div>`;
      return;
    }

    el.list.innerHTML = campaigns
      .map((campaign) => `
        <button class="suitepim-campaign-list-item ${Number(campaign.id) === Number(state.activeId) ? "active" : ""}" type="button" data-campaign-id="${campaign.id}">
          <strong>${escapeHtml(campaign.title)}</strong>
          <span>${escapeHtml(new Date(campaign.updatedAt || campaign.createdAt || Date.now()).toLocaleString())}</span>
        </button>
      `)
      .join("");
  }

  function createSection(sectionData = {}) {
    const section = document.createElement("section");
    section.className = "suitepim-campaign-section";
    if (sectionData.collapsed) section.classList.add("is-collapsed");
    section.innerHTML = `
      <div class="suitepim-campaign-section-head">
        <input class="suitepim-campaign-section-label" type="text" placeholder="Section label" value="${escapeHtml(sectionData.label || "")}">
        <input class="suitepim-campaign-section-color" type="color" value="${escapeHtml(sectionData.color || "#dbeafe")}" title="Section color" aria-label="Section color">
        <button class="suitepim-primary-btn" type="button" data-action="add-row">Add Row</button>
        <button class="suitepim-primary-btn" type="button" data-action="push-section">Push Section</button>
        <button class="suitepim-icon-btn" type="button" data-action="toggle-section" title="Collapse" aria-label="Collapse">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
        </button>
        <button class="suitepim-icon-btn" type="button" data-action="delete-section" title="Delete section" aria-label="Delete section">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path></svg>
        </button>
      </div>
      <div class="suitepim-campaign-section-body"></div>
    `;
    const body = section.querySelector(".suitepim-campaign-section-body");
    (Array.isArray(sectionData.rows) && sectionData.rows.length ? sectionData.rows : [{}]).forEach((row) => createRow(body, row));
    const color = section.querySelector(".suitepim-campaign-section-color");
    const syncColor = () => section.style.borderLeftColor = color.value || "#dbeafe";
    color.addEventListener("input", syncColor);
    syncColor();
    el.sections.appendChild(section);
    return section;
  }

  function filterBadgeText(row) {
    const count = JSON.parse(row.dataset.filters || "[]").length;
    return count ? `${count} filter${count === 1 ? "" : "s"}` : "No filters";
  }

  function createRow(container, rowData = {}) {
    const row = document.createElement("article");
    row.className = "suitepim-campaign-row";
    row.dataset.filters = JSON.stringify(Array.isArray(rowData.filters) ? rowData.filters : []);
    row.innerHTML = `
      <div class="suitepim-campaign-row-head">
        <input class="suitepim-campaign-row-label" type="text" placeholder="Row label" value="${escapeHtml(rowData.label || "")}">
        <button class="suitepim-value-btn" type="button" data-action="filters">${filterBadgeText(row)}</button>
        <button class="suitepim-value-btn" type="button" data-action="preview">Preview</button>
        <button class="suitepim-icon-btn" type="button" data-action="delete-row" title="Delete row" aria-label="Delete row">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path></svg>
        </button>
      </div>
      <div class="suitepim-campaign-row-fields">
        <label>Discount %<input class="suitepim-campaign-discount" type="number" min="0" max="100" step="0.1" value="${escapeHtml(rowData.discount || "")}"></label>
        <label>Point of Sale<input class="suitepim-campaign-pos" type="text" value="${escapeHtml(rowData.pos || "")}"></label>
        <label>Disc Pos<input class="suitepim-campaign-disc-pos" type="text" value="${escapeHtml(rowData.discPos || "")}"></label>
        <label>Other<input class="suitepim-campaign-other" type="text" value="${escapeHtml(rowData.other || "")}"></label>
      </div>
      <div class="suitepim-campaign-products" hidden></div>
    `;
    container.appendChild(row);
    updateRowBadge(row);
    return row;
  }

  function updateRowBadge(row) {
    const button = row.querySelector('[data-action="filters"]');
    if (button) button.textContent = filterBadgeText(row);
  }

  function fieldByName(name) {
    return state.fields.find((field) => String(field.name).toLowerCase() === String(name).toLowerCase());
  }

  async function fieldOptions(fieldName) {
    if (state.optionCache.has(fieldName)) return state.optionCache.get(fieldName);
    const data = await fetchJson(apiUrl(`/options/${encodeURIComponent(fieldName)}`));
    const options = Array.isArray(data.options) ? data.options : [];
    state.optionCache.set(fieldName, options);
    return options;
  }

  function splitValues(value) {
    if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
    return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  function rowMatchesFilter(product, filter) {
    const field = fieldByName(filter.field);
    const raw = product[filter.field];
    if (!field || !filter.field) return true;

    if (field.fieldType === "Checkbox") {
      const value = String(raw).toLowerCase();
      return !filter.value || value === String(filter.value).toLowerCase();
    }

    if (Array.isArray(filter.ids) && filter.ids.length) {
      const internalIds = product[`${filter.field}_InternalId`];
      const productIds = Array.isArray(internalIds) ? internalIds.map(String) : splitValues(internalIds).map(String);
      if (productIds.length) {
        return filter.mode === "all"
          ? filter.ids.every((id) => productIds.includes(String(id)))
          : filter.ids.some((id) => productIds.includes(String(id)));
      }
    }

    const haystack = splitValues(raw).join(" ").toLowerCase();
    return haystack.includes(String(filter.value || "").toLowerCase());
  }

  function matchedProducts(row) {
    const filters = JSON.parse(row.dataset.filters || "[]");
    return state.rows.filter((product) => filters.every((filter) => rowMatchesFilter(product, filter)));
  }

  function renderProductPreview(row) {
    const host = row.querySelector(".suitepim-campaign-products");
    const discount = Number(row.querySelector(".suitepim-campaign-discount")?.value || 0);
    const matched = matchedProducts(row);
    const rows = matched.slice(0, 50).map((product) => {
      const base = basePrice(product);
      const sale = grossSalePrice(product, discount);
      return `
        <tr>
          <td>${escapeHtml(productName(product))}</td>
          <td>${escapeHtml(product["Internal ID"] || "")}</td>
          <td>${base.toFixed(2)}</td>
          <td>${(base * 1.2).toFixed(2)}</td>
          <td>${sale.toFixed(2)}</td>
        </tr>
      `;
    }).join("");
    host.hidden = !host.hidden && host.dataset.rendered === "1";
    if (host.hidden) return;
    host.dataset.rendered = "1";
    host.innerHTML = `
      <h3>Matching Products (${matched.length.toLocaleString()})</h3>
      ${matched.length ? `
        <div class="suitepim-table-wrap">
          <table class="suitepim-table suitepim-campaign-preview-table">
            <thead><tr><th>Name</th><th>ID</th><th>Base Net</th><th>Base Gross</th><th>Sale Gross</th></tr></thead>
            <tbody>${rows}${matched.length > 50 ? `<tr><td colspan="5">+ ${(matched.length - 50).toLocaleString()} more</td></tr>` : ""}</tbody>
          </table>
        </div>
      ` : `<div class="suitepim-empty-option">No products match this row.</div>`}
    `;
  }

  function collectPushRows(scope) {
    const rows = [];
    const campaign = activeCampaign();
    const sections = scope instanceof HTMLElement
      ? [scope]
      : Array.from(el.sections.querySelectorAll(".suitepim-campaign-section"));

    sections.forEach((sectionEl) => {
      sectionEl.querySelectorAll(".suitepim-campaign-row").forEach((rowEl) => {
        const discount = Number(rowEl.querySelector(".suitepim-campaign-discount")?.value || 0);
        matchedProducts(rowEl).forEach((product) => {
          const grossSale = grossSalePrice(product, discount);
          rows.push({
            "Internal ID": product["Internal ID"],
            "Item ID": product["Item ID"] || product.Name,
            "Name": product.Name,
            "Record Type": product["Record Type"],
            "Woo ID": product["Woo ID"],
            "Web SKU": product["Web SKU"],
            "Sale Price": grossSale.toFixed(2),
            __priceUpdates: [
              {
                field: "Sale Price",
                priceLevelId: 4,
                priceLevelName: "Sale Price",
                price: Number((grossSale / 1.2).toFixed(2)),
              },
            ],
            __campaignTitle: campaign.title,
          });
        });
      });
    });

    const unique = new Map();
    rows.forEach((row) => {
      if (row["Internal ID"]) unique.set(row["Internal ID"], row);
    });
    return Array.from(unique.values());
  }

  async function pushRows(rows) {
    if (!rows.length) throw new Error("No products matched this campaign.");
    const data = await fetchJson(apiUrl("/campaigns/push-batch"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, environment: environment() }),
    });
    state.pushJobs.set(data.jobId, {
      id: data.jobId,
      status: "pending",
      total: rows.length,
      processed: 0,
      results: [],
      queuePos: data.queuePos,
      queueTotal: data.queueTotal,
      type: "campaign-batch",
      batchSize: data.batchSize,
    });
    updatePushDisplay();
    schedulePushPoll(0);
    showStatus(`Campaign push queued with ${rows.length.toLocaleString()} product(s).`, "success");
  }

  function normalizePushStatus(status) {
    const text = String(status || "pending").toLowerCase();
    if (text === "done" || text === "completed" || text === "complete") return "completed";
    if (text === "error" || text === "failed") return "error";
    if (text === "running") return "running";
    return "pending";
  }

  function isTerminalPushJob(job) {
    return ["completed", "error"].includes(normalizePushStatus(job?.status));
  }

  function pushStatusLabel(status) {
    const text = normalizePushStatus(status);
    if (text === "completed") return "Finished";
    if (text === "running") return "Running";
    if (text === "error") return "Failed";
    return "Queued";
  }

  function resultError(result) {
    const wooError = result?.response?.woo?.error || "";
    const priceError = Array.isArray(result?.response?.prices)
      ? result.response.prices.find((price) => price && price.success === false)?.error
      : "";
    return result?.response?.error || wooError || priceError || "";
  }

  function resultFailureSource(result) {
    const woo = result?.response?.woo;
    const priceFailed = Array.isArray(result?.response?.prices)
      ? result.response.prices.some((price) => price && price.success === false)
      : false;
    const wooFailed = woo && woo.status !== "skipped" && woo.success === false;
    if (priceFailed && wooFailed) return "NetSuite + WooCommerce";
    if (wooFailed) return "WooCommerce";
    if (priceFailed) return "NetSuite";
    return "Campaign";
  }

  function resultWooSkipReason(result) {
    const woo = result?.response?.woo;
    return woo?.reason || woo?.error || "";
  }

  function renderPushProgress(job) {
    const total = Number(job?.total || 0);
    const processed = Math.min(total, Number(job?.processed || 0));
    const percent = total ? Math.round((processed / total) * 100) : 0;
    const results = Array.isArray(job?.results) ? job.results : [];
    const success = results.filter((result) => result.status === "Success").length;
    const skipped = results.filter((result) => result.status === "Skipped").length;
    const failed = results.filter((result) => result.status === "Error").length;
    const wooUpdated = results.filter((result) => result.response?.woo?.status === "updated").length;
    const wooSkipped = results.filter((result) => result.response?.woo?.status === "skipped").length;
    const wooFailed = results.filter((result) => result.response?.woo && result.response.woo.status !== "skipped" && result.response.woo.success === false).length;
    const recentErrors = results.filter((result) => result.status === "Error").slice(-5);
    const recentWooSkipped = results
      .filter((result) => result.response?.woo?.status === "skipped")
      .filter((result) => resultWooSkipReason(result) && resultWooSkipReason(result) !== "No Woo ID")
      .slice(-5);
    const queueText = Number(job?.queuePos || 0) > 0
      ? ` | Queue ${Number(job.queuePos).toLocaleString()} of ${Number(job.queueTotal || 0).toLocaleString()}`
      : "";
    const batchInProgress = Number(job?.batchInProgress || 0);
    const batchTotal = Number(job?.batchTotal || 0);
    const batchProcessed = Number(job?.batchProcessed || 0);
    const isBatchProcessing = normalizePushStatus(job?.status) === "running" && batchInProgress > 0;
    const batchText = batchTotal
      ? isBatchProcessing
        ? `Processing batch ${batchInProgress.toLocaleString()} of ${batchTotal.toLocaleString()}`
        : `${batchProcessed.toLocaleString()} / ${batchTotal.toLocaleString()} batches complete`
      : "";
    const modeText = job?.type === "campaign-batch"
      ? `Batch RESTlet${job.batchSize ? ` | Batch size ${Number(job.batchSize).toLocaleString()}` : ""}`
      : "Standard push";

    el.pushReport.hidden = false;
    el.pushReport.innerHTML = `
      <div class="suitepim-push-report-header">
        <h2>Campaign push ${escapeHtml(pushStatusLabel(job?.status))}</h2>
        <span>${processed.toLocaleString()} / ${total.toLocaleString()} products | ${escapeHtml(modeText)} | Job ${escapeHtml(job?.id || "")}${queueText}</span>
      </div>
      <div class="suitepim-campaign-progress ${isBatchProcessing ? "is-processing" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <span style="width:${percent}%"></span>
      </div>
      <div class="suitepim-campaign-progress-meta">
        <strong>${percent}%</strong>
        ${batchText ? `<span>${escapeHtml(batchText)}</span>` : ""}
        <span>${success.toLocaleString()} success</span>
        <span>${skipped.toLocaleString()} skipped</span>
        <span>${failed.toLocaleString()} failed</span>
        <span>Woo ${wooUpdated.toLocaleString()} updated</span>
        <span>Woo ${wooSkipped.toLocaleString()} skipped</span>
        <span>Woo ${wooFailed.toLocaleString()} failed</span>
      </div>
      ${recentErrors.length ? `
        <div class="suitepim-campaign-push-errors">
          <strong>Recent errors</strong>
          ${recentErrors.map((result) => `
            <div>
              <span>${escapeHtml(resultFailureSource(result))}: ${escapeHtml(result.itemId || result.internalId || "Item")}</span>
              <small>${escapeHtml(resultError(result) || "Unknown error")}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${recentWooSkipped.length ? `
        <div class="suitepim-campaign-push-errors">
          <strong>Recent Woo skipped</strong>
          ${recentWooSkipped.map((result) => `
            <div>
              <span>${escapeHtml(result.itemId || result.internalId || "Item")}</span>
              <small>${escapeHtml(resultWooSkipReason(result))}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
    `;
  }

  function chooseVisiblePushJob() {
    const jobs = Array.from(state.pushJobs.values());
    return jobs.find((job) => normalizePushStatus(job.status) === "running")
      || jobs.find((job) => normalizePushStatus(job.status) === "pending")
      || jobs.find((job) => isTerminalPushJob(job))
      || null;
  }

  function updatePushDisplay() {
    const job = chooseVisiblePushJob();
    state.activePushJobId = job?.id || null;
    if (!job) {
      el.pushReport.hidden = true;
      el.pushReport.innerHTML = "";
      return;
    }
    renderPushProgress(job);
  }

  function schedulePushPoll(delay = 1500) {
    if (state.activePushPoll) return;
    state.activePushPoll = setTimeout(pollPushJobs, delay);
  }

  async function pollPushJobs() {
    state.activePushPoll = null;
    const jobs = Array.from(state.pushJobs.values());
    if (!jobs.length) {
      updatePushDisplay();
      return;
    }

    await Promise.all(jobs.map(async (job) => {
      if (isTerminalPushJob(job) && job._completedAt) return;
      try {
        const latest = await fetchJson(apiUrl(`/push-status/${encodeURIComponent(job.id)}`));
        const normalized = { ...job, ...latest };
        if (isTerminalPushJob(normalized) && !job._completedAt) {
          normalized._completedAt = Date.now();
          const failed = Array.isArray(normalized.results)
            ? normalized.results.filter((result) => result.status === "Error").length
            : 0;
          showStatus(
            failed ? `Campaign push ${normalized.id} finished with ${failed.toLocaleString()} failed product(s).` : `Campaign push ${normalized.id} finished.`,
            failed ? "warning" : "success"
          );
        }
        state.pushJobs.set(job.id, normalized);
      } catch (err) {
        state.pushJobs.set(job.id, {
          ...job,
          status: "error",
          _completedAt: Date.now(),
          results: job.results || [],
          _pollError: err.message,
        });
      }
    }));

    const now = Date.now();
    state.pushJobs.forEach((job, id) => {
      if (isTerminalPushJob(job) && job._completedAt && now - job._completedAt >= 10000) {
        state.pushJobs.delete(id);
      }
    });

    updatePushDisplay();
    if (state.pushJobs.size) schedulePushPoll();
  }

  async function saveCampaign() {
    const campaign = activeCampaign();
    const method = campaign.id ? "PUT" : "POST";
    const path = campaign.id ? `/campaigns/${campaign.id}` : "/campaigns";
    const data = await fetchJson(apiUrl(path), {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        environment: environment(),
        title: campaign.title,
        data: campaign,
      }),
    });
    state.activeId = data.campaign.id;
    await loadCampaigns(false);
    renderCampaignList();
    showStatus("Campaign saved to PostgreSQL.", "success");
  }

  async function deleteCampaign() {
    if (!state.activeId) return;
    if (!window.confirm("Delete this campaign?")) return;
    await fetchJson(apiUrl(`/campaigns/${state.activeId}`), { method: "DELETE" });
    state.activeId = null;
    await loadCampaigns(false);
    setCampaign(null, null);
    renderCampaignList();
    showStatus("Campaign deleted.", "success");
  }

  async function loadCampaigns(selectFirst = true) {
    const data = await fetchJson(apiUrl("/campaigns"));
    state.campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    if (selectFirst && state.campaigns.length && !state.activeId) {
      const first = state.campaigns[0];
      setCampaign(first.data, first.id);
    }
    renderCampaignList();
  }

  async function loadProducts(forceRefresh = false) {
    const data = await fetchJson(apiUrl(`/web-management${forceRefresh ? "?refresh=1" : ""}`));
    state.rows = Array.isArray(data.rows) ? data.rows : [];
    el.productCount.textContent = `${state.rows.length.toLocaleString()} products loaded`;
  }

  async function loadConfig() {
    const data = await fetchJson(apiUrl("/web-management/config"));
    state.fields = (Array.isArray(data.fields) ? data.fields : []).filter((field) => !field.hiddenField);
  }

  function openFilterModal(row) {
    state.activeRow = row;
    const filters = JSON.parse(row.dataset.filters || "[]");
    el.filterRows.innerHTML = "";
    (filters.length ? filters : [{}]).forEach((filter) => addFilterRow(filter));
    syncFilterPreview();
    el.filterModal.classList.remove("hidden");
  }

  function closeFilterModal() {
    state.activeRow = null;
    el.filterModal.classList.add("hidden");
  }

  function addFilterRow(filter = {}) {
    const row = document.createElement("div");
    row.className = "suitepim-campaign-filter-row";
    row.innerHTML = `
      <select class="suitepim-campaign-filter-field">
        <option value="">Choose field</option>
        ${state.fields.map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(field.name)}</option>`).join("")}
      </select>
      <div class="suitepim-campaign-filter-value"></div>
      <button class="suitepim-icon-btn" type="button" data-action="remove-filter" title="Remove filter" aria-label="Remove filter">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 14h10l1-14"></path></svg>
      </button>
    `;
    const select = row.querySelector(".suitepim-campaign-filter-field");
    select.value = filter.field || "";
    select.addEventListener("change", () => renderFilterValue(row, {}));
    el.filterRows.appendChild(row);
    renderFilterValue(row, filter);
  }

  async function renderFilterValue(row, filter = {}) {
    const fieldName = row.querySelector(".suitepim-campaign-filter-field")?.value || "";
    const field = fieldByName(fieldName);
    const host = row.querySelector(".suitepim-campaign-filter-value");
    host.innerHTML = "";
    if (!field) {
      host.innerHTML = `<input type="text" disabled placeholder="Select a field">`;
      return;
    }

    if (field.fieldType === "Checkbox") {
      host.innerHTML = `
        <select class="suitepim-campaign-filter-input">
          <option value="">All</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      `;
      host.querySelector("select").value = filter.value || "";
      return;
    }

    if (field.hasOptions || field.optionFeed || field.fieldType === "List/Record" || field.fieldType === "multiple-select") {
      host.innerHTML = `<div class="suitepim-muted-note">Loading options...</div>`;
      const options = await fieldOptions(field.name);
      const multiple = field.fieldType === "multiple-select";
      host.innerHTML = `
        <select class="suitepim-campaign-filter-input" ${multiple ? "multiple" : ""}>
          ${!multiple ? `<option value="">Choose value</option>` : ""}
          ${options.map((option) => {
            const id = String(option["Internal ID"] || option.id || option.value || "");
            const name = String(option.Name || option.name || option.label || id);
            return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
          }).join("")}
        </select>
        ${multiple ? `<select class="suitepim-campaign-filter-mode"><option value="any">Any selected</option><option value="all">All selected</option></select>` : ""}
      `;
      const input = host.querySelector(".suitepim-campaign-filter-input");
      const ids = Array.isArray(filter.ids) ? filter.ids.map(String) : filter.value ? [String(filter.value)] : [];
      Array.from(input.options).forEach((option) => {
        option.selected = ids.includes(option.value);
      });
      const mode = host.querySelector(".suitepim-campaign-filter-mode");
      if (mode) mode.value = filter.mode || "any";
      return;
    }

    host.innerHTML = `<input class="suitepim-campaign-filter-input" type="text" value="${escapeHtml(filter.value || "")}" placeholder="Contains...">`;
  }

  function collectFiltersFromModal() {
    return Array.from(el.filterRows.querySelectorAll(".suitepim-campaign-filter-row")).map((row) => {
      const field = row.querySelector(".suitepim-campaign-filter-field")?.value || "";
      const fieldDef = fieldByName(field);
      const input = row.querySelector(".suitepim-campaign-filter-input");
      if (!field || !input) return null;
      if (input.multiple || fieldDef?.fieldType === "multiple-select") {
        const ids = Array.from(input.selectedOptions).map((option) => option.value).filter(Boolean);
        return ids.length ? { field, ids, mode: row.querySelector(".suitepim-campaign-filter-mode")?.value || "any" } : null;
      }
      return input.value ? { field, value: input.value } : null;
    }).filter(Boolean);
  }

  function syncFilterPreview() {
    const filters = collectFiltersFromModal();
    if (!state.activeRow) return;
    const previous = state.activeRow.dataset.filters;
    state.activeRow.dataset.filters = JSON.stringify(filters);
    el.filterPreview.textContent = `${matchedProducts(state.activeRow).length.toLocaleString()} matching products`;
    state.activeRow.dataset.filters = previous;
  }

  function saveFilters() {
    if (!state.activeRow) return;
    state.activeRow.dataset.filters = JSON.stringify(collectFiltersFromModal());
    updateRowBadge(state.activeRow);
    state.activeRow.querySelector(".suitepim-campaign-products").hidden = true;
    closeFilterModal();
  }

  function bindEvents() {
    el.search.addEventListener("input", renderCampaignList);
    el.new.addEventListener("click", () => setCampaign(null, null));
    el.refresh.addEventListener("click", () => init(true).catch((err) => showStatus(err.message, "error")));
    el.save.addEventListener("click", () => saveCampaign().catch((err) => window.alert(err.message)));
    el.delete.addEventListener("click", () => deleteCampaign().catch((err) => window.alert(err.message)));
    el.push.addEventListener("click", () => pushRows(collectPushRows()).catch((err) => window.alert(err.message)));
    el.addSection.addEventListener("click", () => createSection({ label: "Campaign Section", rows: [{}] }));

    el.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-campaign-id]");
      if (!button) return;
      const campaign = state.campaigns.find((entry) => Number(entry.id) === Number(button.dataset.campaignId));
      if (!campaign) return;
      setCampaign(campaign.data, campaign.id);
      renderCampaignList();
    });

    el.sections.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      const section = button.closest(".suitepim-campaign-section");
      const row = button.closest(".suitepim-campaign-row");
      if (action === "add-row") createRow(section.querySelector(".suitepim-campaign-section-body"), {});
      if (action === "push-section") pushRows(collectPushRows(section)).catch((err) => window.alert(err.message));
      if (action === "toggle-section") section.classList.toggle("is-collapsed");
      if (action === "delete-section") section.remove();
      if (action === "delete-row") row.remove();
      if (action === "filters") openFilterModal(row);
      if (action === "preview") renderProductPreview(row);
    });

    el.filterClose.addEventListener("click", closeFilterModal);
    el.filterCancel.addEventListener("click", closeFilterModal);
    el.filterSave.addEventListener("click", saveFilters);
    el.filterAdd.addEventListener("click", () => addFilterRow({}));
    el.filterRows.addEventListener("click", (event) => {
      const button = event.target.closest('[data-action="remove-filter"]');
      if (!button) return;
      button.closest(".suitepim-campaign-filter-row")?.remove();
      if (!el.filterRows.children.length) addFilterRow({});
      syncFilterPreview();
    });
    el.filterRows.addEventListener("change", syncFilterPreview);
    el.filterRows.addEventListener("input", syncFilterPreview);
  }

  async function init(forceRefresh = false) {
    showStatus("Loading campaigns...");
    await Promise.all([loadConfig(), loadProducts(forceRefresh), loadCampaigns(!state.pageLoaded)]);
    if (!state.campaigns.length && !state.activeId) setCampaign(null, null);
    state.pageLoaded = true;
    showStatus("Campaigns ready.", "success");
  }

  document.addEventListener("DOMContentLoaded", () => {
    Object.assign(el, {
      search: byId("suitepimCampaignSearch"),
      new: byId("suitepimCampaignNew"),
      refresh: byId("suitepimCampaignRefresh"),
      status: byId("suitepimCampaignStatus"),
      pushReport: byId("suitepimCampaignPushReport"),
      count: byId("suitepimCampaignCount"),
      list: byId("suitepimCampaignList"),
      title: byId("suitepimCampaignTitle"),
      save: byId("suitepimCampaignSave"),
      push: byId("suitepimCampaignPush"),
      delete: byId("suitepimCampaignDelete"),
      addSection: byId("suitepimCampaignAddSection"),
      productCount: byId("suitepimCampaignProductCount"),
      sections: byId("suitepimCampaignSections"),
      filterModal: byId("suitepimCampaignFilterModal"),
      filterRows: byId("suitepimCampaignFilterRows"),
      filterPreview: byId("suitepimCampaignFilterPreview"),
      filterClose: byId("suitepimCampaignFilterClose"),
      filterCancel: byId("suitepimCampaignFilterCancel"),
      filterSave: byId("suitepimCampaignFilterSave"),
      filterAdd: byId("suitepimCampaignFilterAdd"),
    });
    bindEvents();
    init().catch((err) => {
      console.error("SuitePim campaigns failed to load:", err);
      showStatus(err.message || "Failed to load campaigns.", "error");
    });
  });
})();
