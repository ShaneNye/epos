(function () {
  const METERS_WIDE = 100;
  const METERS_HIGH = 70;
  const PX_PER_METER = 24;
  const THEME_STORAGE_KEY = "suitepimFloorPlanTheme";
  const ASSETS = [
    { key: "single-bed", name: "Single bed", width: 0.9, height: 1.9 },
    { key: "double-bed", name: "Double bed", width: 1.35, height: 1.9 },
    { key: "king-bed", name: "King bed", width: 1.5, height: 2 },
    { key: "super-king-bed", name: "Super king bed", width: 1.8, height: 2 },
    { key: "bedside-cabinet", name: "Bedside cabinet", width: 0.5, height: 0.45 },
    { key: "wardrobe", name: "Wardrobe", width: 1.2, height: 0.6 },
    { key: "chest", name: "Chest", width: 0.9, height: 0.45 },
    { key: "stock-bin", name: "Stock bin", width: 0.8, height: 0.6 },
    { key: "wide-display-stand", name: "Wide display stand", width: 2.4, height: 0.8 },
    { key: "circle-coffee-table", name: "Circle coffee table", width: 0.9, height: 0.9, shape: "circle" },
    { key: "desk", name: "Desk", width: 1.2, height: 0.6 },
    { key: "sofa-small", name: "Sofa (small)", width: 1.5, height: 0.8 },
    { key: "sofa-medium", name: "Sofa (medium)", width: 2.0, height: 0.9 },
    { key: "sofa-large", name: "Sofa (large)", width: 2.5, height: 1.0 },
  ];
  const state = {
    locations: [],
    plans: [],
    activePlan: null,
    selectedLocationId: "",
    editMode: false,
    tool: "line",
    lockGrid: true,
    draft: null,
    movingAsset: null,
    selectedElementId: "",
    selectedAssetIds: new Set(),
    zoom: 1,
    pan: null,
    viewOnly: false,
    bins: [],
    binsLoadedForLocationId: "",
    binsLoading: false,
    binSearch: "",
    footfallRangeKey: "thisMonth",
    footfallStartDate: "",
    footfallEndDate: "",
    footfallLoading: false,
    heatmapMode: "none",
    heatmapScope: "squareFootage",
    heatmapLoading: false,
    heatmapValues: {},
    heatmapMax: 0,
    movementPaths: [],
    heatmapDetailRows: [],
    heatmapDetailLoading: false,
    heatmapDetailError: "",
    dataPanelCollapsed: true,
    analyticsLoading: false,
    analytics: {
      footfall: 0,
      soldValues: {},
      revenueValues: {},
      error: "",
    },
    highlightDraft: null,
    highlightArea: null,
    undoStack: [],
    redoStack: [],
    dirty: false,
  };

  const el = {};

  function initEls() {
    [
      "suitepimFloorPlanLocation",
      "suitepimFloorPlanFootfallTotal",
      "suitepimFloorPlanDateRange",
      "suitepimFloorPlanHeatmap",
      "suitepimFloorPlanHeatmapScopeLabel",
      "suitepimFloorPlanHeatmapScope",
      "suitepimFloorPlanStartDate",
      "suitepimFloorPlanEndDate",
      "suitepimFloorPlanStatus",
      "suitepimFloorPlanDarkMode",
      "suitepimFloorPlanEdit",
      "suitepimFloorPlanSave",
      "suitepimFloorPlanSidebar",
      "suitepimFloorPlanSidebarToggle",
      "suitepimFloorPlanSidebarBody",
      "suitepimFloorPlanNew",
      "suitepimFloorPlanList",
      "suitepimFloorPlanAssets",
      "suitepimFloorPlanAnalytics",
      "suitepimFloorPlanBinSearch",
      "suitepimFloorPlanBins",
      "suitepimFloorPlanName",
      "suitepimFloorPlanLockGrid",
      "suitepimFloorPlanCurrent",
      "suitepimFloorPlanZoomOut",
      "suitepimFloorPlanZoomIn",
      "suitepimFloorPlanZoomLabel",
      "suitepimFloorPlanCanvasWrap",
      "suitepimFloorPlanCanvas",
      "suitepimFloorPlanDataPanel",
      "suitepimFloorPlanDataPanelToggle",
      "suitepimFloorPlanDataPanelTitle",
      "suitepimFloorPlanDataPanelSummary",
      "suitepimFloorPlanDataPanelContent",
      "suitepimFloorPlanRotationControls",
      "suitepimFloorPlanRotateLeft",
      "suitepimFloorPlanRotateRight",
      "suitepimFloorPlanAssetEdit",
      "suitepimFloorPlanRotationLabel",
    ].forEach((id) => {
      el[id] = document.getElementById(id);
    });
  }

  function headers() {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    return {
      "Content-Type": "application/json",
      ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
    };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function showStatus(message, type = "info") {
    if (!el.suitepimFloorPlanStatus) return;
    el.suitepimFloorPlanStatus.dataset.type = type;
    if (type === "loading" && message) {
      el.suitepimFloorPlanStatus.innerHTML = `<span class="suitepim-floorplan-status-spinner" aria-hidden="true"></span><span>${clean(message)}</span>`;
      return;
    }
    el.suitepimFloorPlanStatus.textContent = message || "";
  }

  function applyFloorPlanTheme(mode) {
    const isDark = mode === "dark";
    document.body.classList.toggle("suitepim-floorplan-dark", isDark);
    document.getElementById("suitepimFloorPlanApp")?.classList.toggle("is-dark", isDark);
    document.querySelectorAll(".suitepim-floorplan-dark-mode-toggle").forEach((toggle) => {
      toggle.checked = isDark;
    });
  }

  function clean(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function localDate(value = new Date()) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  function addDays(date, days) {
    const next = localDate(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function toIsoDate(date) {
    const d = localDate(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function floorPlanDateRange(key = state.footfallRangeKey) {
    const today = localDate(new Date());
    if (key === "today") return { start: today, end: today };
    if (key === "yesterday") {
      const yesterday = addDays(today, -1);
      return { start: yesterday, end: yesterday };
    }
    if (key === "lastMonth") {
      const month = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { start: month, end: new Date(month.getFullYear(), month.getMonth() + 1, 0) };
    }
    if (key === "thisYear") {
      return { start: new Date(today.getFullYear(), 0, 1), end: new Date(today.getFullYear(), 11, 31) };
    }
    if (key === "lastYear") {
      return { start: new Date(today.getFullYear() - 1, 0, 1), end: new Date(today.getFullYear() - 1, 11, 31) };
    }
    if (key === "custom" && state.footfallStartDate && state.footfallEndDate) {
      return {
        start: localDate(new Date(`${state.footfallStartDate}T00:00:00`)),
        end: localDate(new Date(`${state.footfallEndDate}T00:00:00`)),
      };
    }
    return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 1, 0) };
  }

  function syncFootfallDateInputs() {
    const range = floorPlanDateRange();
    const start = range.start <= range.end ? range.start : range.end;
    const end = range.end >= range.start ? range.end : range.start;
    state.footfallStartDate = toIsoDate(start);
    state.footfallEndDate = toIsoDate(end);
    if (el.suitepimFloorPlanDateRange) el.suitepimFloorPlanDateRange.value = state.footfallRangeKey;
    if (el.suitepimFloorPlanStartDate) el.suitepimFloorPlanStartDate.value = state.footfallStartDate;
    if (el.suitepimFloorPlanEndDate) el.suitepimFloorPlanEndDate.value = state.footfallEndDate;
  }

  function planData() {
    const data = state.activePlan?.data || {};
    return {
      widthMeters: Number(data.widthMeters) || METERS_WIDE,
      heightMeters: Number(data.heightMeters) || METERS_HIGH,
      elements: Array.isArray(data.elements) ? data.elements : [],
    };
  }

  function assetByKey(key) {
    return ASSETS.find((asset) => asset.key === key) || null;
  }

  function locationNameById(locationId) {
    const id = String(locationId || state.selectedLocationId || "");
    return state.locations.find((location) => String(location.id) === id)?.name || "";
  }

  function floorPlanBinLabel(value) {
    return String(value || "").trim().replace(/^[A-Za-z]{3}\s+/, "");
  }

  function normalizeBinMatch(value) {
    return floorPlanBinLabel(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function selectedAssetElements() {
    const data = planData();
    const selectedIds = new Set(state.selectedAssetIds);
    if (state.selectedElementId) selectedIds.add(state.selectedElementId);
    return data.elements.filter((element) => element.type === "asset" && selectedIds.has(element.id));
  }

  function selectAsset(elementId, options = {}) {
    const append = Boolean(options.append);
    const preserve = Boolean(options.preserve);
    if (!append) state.selectedAssetIds.clear();
    if (!elementId) {
      state.selectedElementId = "";
      updateRotationControls();
      return;
    }

    if (preserve && state.selectedAssetIds.has(elementId)) {
      state.selectedElementId = elementId;
    } else if (append && state.selectedAssetIds.has(elementId)) {
      state.selectedAssetIds.delete(elementId);
      if (state.selectedElementId === elementId) {
        state.selectedElementId = [...state.selectedAssetIds][0] || "";
      }
    } else {
      state.selectedAssetIds.add(elementId);
      state.selectedElementId = elementId;
    }
    updateRotationControls();
  }

  function setPlanData(data) {
    if (!state.activePlan) return;
    state.activePlan.data = {
      widthMeters: Number(data.widthMeters) || METERS_WIDE,
      heightMeters: Number(data.heightMeters) || METERS_HIGH,
      elements: Array.isArray(data.elements) ? data.elements : [],
    };
  }

  function dataSnapshot() {
    return JSON.stringify(planData());
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot) return;
    setPlanData(JSON.parse(snapshot));
    state.selectedElementId = "";
    state.draft = null;
    state.movingAsset = null;
    setDirty();
    renderCanvas();
  }

  function pushHistory() {
    state.undoStack.push(dataSnapshot());
    if (state.undoStack.length > 80) state.undoStack.shift();
    state.redoStack = [];
  }

  function resetHistory() {
    state.undoStack = [];
    state.redoStack = [];
    state.selectedElementId = "";
    state.movingAsset = null;
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(dataSnapshot());
    restoreSnapshot(state.undoStack.pop());
    showStatus("Undone", "info");
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(dataSnapshot());
    restoreSnapshot(state.redoStack.pop());
    showStatus("Redone", "info");
  }

  function createEmptyPlan(locationId, options = {}) {
    return {
      id: null,
      locationId: Number(locationId),
      name: "Untitled floor plan",
      isCurrent: options.isCurrent === true,
      data: {
        widthMeters: METERS_WIDE,
        heightMeters: METERS_HIGH,
        elements: [],
      },
    };
  }

  function updateEditControls() {
    if (state.viewOnly) state.editMode = false;
    if (el.suitepimFloorPlanEdit) el.suitepimFloorPlanEdit.hidden = state.viewOnly || state.editMode;
    if (el.suitepimFloorPlanSave) el.suitepimFloorPlanSave.hidden = state.viewOnly || !state.editMode;
    if (el.suitepimFloorPlanName) el.suitepimFloorPlanName.disabled = !state.editMode;
    if (el.suitepimFloorPlanCurrent) el.suitepimFloorPlanCurrent.disabled = !state.editMode;
    document.getElementById("suitepimFloorPlanApp")?.classList.toggle("is-editing", state.editMode);
    el.suitepimFloorPlanCanvas.classList.toggle("is-editing", state.editMode);
    el.suitepimFloorPlanCanvasWrap?.classList.toggle("is-editing", state.editMode);
    document.querySelectorAll("[data-floorplan-tool], #suitepimFloorPlanLockGrid").forEach((control) => {
      control.disabled = !state.editMode;
    });
    updateSidebarMode();
  }

  function updateHeatmapControls() {
    const movementMode = state.heatmapMode === "movement";
    if (el.suitepimFloorPlanHeatmapScopeLabel) el.suitepimFloorPlanHeatmapScopeLabel.hidden = movementMode;
    if (el.suitepimFloorPlanHeatmapScope) el.suitepimFloorPlanHeatmapScope.disabled = movementMode;
  }

  function activateSidebarTab(target) {
    const visibleTabs = Array.from(document.querySelectorAll("[data-floorplan-sidebar-tab]")).filter((button) => !button.hidden);
    const tab = visibleTabs.find((button) => button.dataset.floorplanSidebarTab === target) || visibleTabs[0];
    if (!tab) return;
    document.querySelectorAll("[data-floorplan-sidebar-tab]").forEach((button) => {
      const active = button === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-floorplan-sidebar-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.floorplanSidebarPanel !== tab.dataset.floorplanSidebarTab;
    });
    if (tab.dataset.floorplanSidebarTab === "bins") loadBins();
    if (tab.dataset.floorplanSidebarTab === "analytics") loadAnalytics();
  }

  function updateSidebarMode() {
    document.querySelectorAll("[data-floorplan-sidebar-tab]").forEach((button) => {
      const mode = button.dataset.floorplanTabMode || "all";
      button.hidden = mode !== "all" && mode !== (state.editMode ? "edit" : "view");
    });
    const active = document.querySelector("[data-floorplan-sidebar-tab].active");
    if (!active || active.hidden) activateSidebarTab("files");
  }

  function updateRotationControls() {
    if (!el.suitepimFloorPlanRotationControls) return;
    const selectedAssets = selectedAssetElements();
    const selectedAsset = selectedAssets[0] || null;
    if (selectedAsset && state.editMode) {
      el.suitepimFloorPlanRotationControls.hidden = false;
      if (el.suitepimFloorPlanRotationLabel) {
        el.suitepimFloorPlanRotationLabel.textContent = selectedAssets.length > 1
          ? `${selectedAssets.length} selected`
          : `${Number(selectedAsset.rotation) || 0} deg`;
      }
      if (el.suitepimFloorPlanAssetEdit) {
        el.suitepimFloorPlanAssetEdit.dataset.selectedAssets = selectedAssets.map((asset) => asset.id).join(",");
      }
      return;
    }
    el.suitepimFloorPlanRotationControls.hidden = true;
    if (el.suitepimFloorPlanAssetEdit) {
      el.suitepimFloorPlanAssetEdit.dataset.selectedAssets = "";
    }
    return;
    const data = planData();
    const element = data.elements.find((el) => el.id === state.selectedElementId && el.type === "asset");
    
    if (element && state.editMode) {
      el.suitepimFloorPlanRotationControls.hidden = false;
      const rotation = Number(element.rotation) || 0;
      if (el.suitepimFloorPlanRotationLabel) {
        el.suitepimFloorPlanRotationLabel.textContent = `${rotation}°`;
      }
    } else {
      el.suitepimFloorPlanRotationControls.hidden = true;
    }
  }

  function rotateSelectedAsset(degrees) {
    if (!state.editMode || !state.selectedElementId) return;
    const data = planData();
    const element = data.elements.find((el) => el.id === state.selectedElementId && el.type === "asset");
    if (!element) return;
    
    pushHistory();
    const rotation = Number(element.rotation) || 0;
    element.rotation = (rotation + degrees) % 360;
    if (element.rotation < 0) element.rotation += 360;
    setPlanData(data);
    setDirty();
    renderCanvas();
    updateRotationControls();
    showStatus(`Rotated to ${element.rotation}°`, "info");
  }

  function renderLocations() {
    el.suitepimFloorPlanLocation.innerHTML = state.locations
      .map((location) => `<option value="${clean(location.id)}">${clean(location.name)}</option>`)
      .join("");
    if (state.selectedLocationId) el.suitepimFloorPlanLocation.value = state.selectedLocationId;
  }

  function renderPlanList() {
    if (!el.suitepimFloorPlanList) return;
    if (!state.plans.length) {
      el.suitepimFloorPlanList.innerHTML = `<div class="suitepim-floorplan-empty">No floor plans saved for this location. Create one to start mapping bins.</div>`;
      return;
    }

    el.suitepimFloorPlanList.innerHTML = state.plans
      .map((plan) => `
        <button type="button" class="${state.activePlan?.id === plan.id ? "active" : ""}" data-floorplan-id="${clean(plan.id)}">
          <span class="suitepim-floorplan-list-title">
            <strong>${clean(plan.name)}</strong>
            ${plan.isCurrent ? '<span class="suitepim-floorplan-current-badge">Current</span>' : ""}
          </span>
          <small>${clean(plan.data?.elements?.length ? `${plan.data.elements.length} items` : "Empty")} - ${plan.updatedAt ? new Date(plan.updatedAt).toLocaleDateString("en-GB") : "Unsaved"}</small>
        </button>
      `)
      .join("");

    el.suitepimFloorPlanList.querySelectorAll("[data-floorplan-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.dataset.floorplanId);
        const plan = state.plans.find((item) => Number(item.id) === id);
        if (!plan) return;
        state.activePlan = JSON.parse(JSON.stringify(plan));
        state.editMode = false;
        state.dirty = false;
        state.highlightArea = null;
        state.highlightDraft = null;
        resetHistory();
        renderAll();
        loadAnalytics();
      });
    });
  }

  function renderAssets() {
    if (!el.suitepimFloorPlanAssets) return;
    el.suitepimFloorPlanAssets.innerHTML = ASSETS.map((asset) => `
      <button
        type="button"
        draggable="true"
        data-floorplan-asset="${clean(asset.key)}"
        aria-label="Drag ${clean(asset.name)} onto the floor plan">
        <span class="suitepim-floorplan-asset-preview" style="--asset-ratio:${asset.width / asset.height}"></span>
        <strong>${clean(asset.name)}</strong>
      </button>
    `).join("");

    el.suitepimFloorPlanAssets.querySelectorAll("[data-floorplan-asset]").forEach((button) => {
      button.addEventListener("dragstart", (event) => {
        if (!state.editMode) {
          event.preventDefault();
          showStatus("Click Edit before placing assets", "warning");
          return;
        }
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", button.dataset.floorplanAsset || "");
      });
    });
  }

  function renderBins() {
    if (!el.suitepimFloorPlanBins) return;
    const term = state.binSearch.trim().toLowerCase();
    const bins = state.bins.filter((bin) => {
      if (!term) return true;
      return [bin.number, bin.location, bin.zone].some((value) => String(value || "").toLowerCase().includes(term));
    });

    if (state.binsLoading) {
      el.suitepimFloorPlanBins.innerHTML = `<div class="suitepim-floorplan-empty">Loading bins for this location...</div>`;
      return;
    }

    if (!bins.length) {
      const message = term
        ? "No bins match this search."
        : "No bins found for this location.";
      el.suitepimFloorPlanBins.innerHTML = `<div class="suitepim-floorplan-empty">${message}</div>`;
      return;
    }

    el.suitepimFloorPlanBins.innerHTML = bins.map((bin) => `
      <button type="button" draggable="true" data-floorplan-bin="${clean(bin.id)}">
        <strong>${clean(bin.number)}</strong>
        <small>${clean([bin.location, bin.zone].filter(Boolean).join(" - "))}</small>
      </button>
    `).join("");

    el.suitepimFloorPlanBins.querySelectorAll("[data-floorplan-bin]").forEach((button) => {
      button.addEventListener("dragstart", (event) => {
        if (!state.editMode) {
          event.preventDefault();
          showStatus("Click Edit before attaching bins", "warning");
          return;
        }
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-suitepim-bin", button.dataset.floorplanBin || "");
        event.dataTransfer.setData("text/plain", `bin:${button.dataset.floorplanBin || ""}`);
      });
    });
  }

  function renderAnalytics() {
    if (!el.suitepimFloorPlanAnalytics) return;
    const totals = analyticsTotals();
    const totalArea = planAreaSqFt();
    const revenuePerSqFt = totalArea > 0 ? totals.revenue / totalArea : 0;
    const activeHighlight = state.highlightDraft || state.highlightArea;
    const highlightAssets = activeHighlight ? assetsInRect(activeHighlight) : [];
    const highlightTotals = analyticsTotals(highlightAssets);
    const highlightArea = rectAreaSqFt(activeHighlight);
    const highlightRevenuePerSqFt = highlightArea > 0 ? highlightTotals.revenue / highlightArea : 0;
    const loading = state.analyticsLoading ? `<div class="suitepim-floorplan-analytics-note">Loading analytics...</div>` : "";
    const error = state.analytics.error ? `<div class="suitepim-floorplan-analytics-note is-error">${clean(state.analytics.error)}</div>` : "";

    el.suitepimFloorPlanAnalytics.innerHTML = `
      ${loading}
      ${error}
      <div class="suitepim-floorplan-analytics-grid">
        <div>
          <span>Footfall</span>
          <strong>${number(state.analytics.footfall)}</strong>
        </div>
        <div>
          <span>Items sold</span>
          <strong>${number(totals.itemsSold, { maximumFractionDigits: 1 })}</strong>
        </div>
        <div>
          <span>Revenue</span>
          <strong>${money(totals.revenue)}</strong>
        </div>
        <div>
          <span>Revenue / sq ft</span>
          <strong>${money(revenuePerSqFt)}</strong>
        </div>
        <div>
          <span>Total sq ft</span>
          <strong>${number(totalArea, { maximumFractionDigits: 1 })}</strong>
        </div>
      </div>
      <div class="suitepim-floorplan-highlight-card">
        <h3>Highlighted area</h3>
        <p>${activeHighlight ? `${number(highlightArea, { maximumFractionDigits: 1 })} sq ft selected` : "Hold Shift and drag on the floor plan."}</p>
        <div class="suitepim-floorplan-analytics-grid is-compact">
          <div>
            <span>Items sold</span>
            <strong>${number(highlightTotals.itemsSold, { maximumFractionDigits: 1 })}</strong>
          </div>
          <div>
            <span>Revenue</span>
            <strong>${money(highlightTotals.revenue)}</strong>
          </div>
          <div>
            <span>Revenue / sq ft</span>
            <strong>${money(highlightRevenuePerSqFt)}</strong>
          </div>
          <div>
            <span>Highlighted sq ft</span>
            <strong>${number(highlightArea, { maximumFractionDigits: 1 })}</strong>
          </div>
        </div>
      </div>
    `;
  }

  function heatmapDetailTitle() {
    if (state.heatmapMode === "sold" || state.heatmapMode === "revenue") return "Sales data";
    if (state.heatmapMode === "inventory") return "Inventory lines";
    if (state.heatmapMode === "movement") return "Inventory movement";
    return "Heat map data";
  }

  function setDataPanelCollapsed(collapsed) {
    state.dataPanelCollapsed = collapsed;
    el.suitepimFloorPlanDataPanel?.classList.toggle("is-collapsed", collapsed);
    el.suitepimFloorPlanDataPanelToggle?.setAttribute("aria-expanded", String(!collapsed));
  }

  function renderHeatmapDataPanel() {
    if (!el.suitepimFloorPlanDataPanel) return;
    const active = state.heatmapMode !== "none";
    el.suitepimFloorPlanDataPanel.hidden = !active;
    if (!active) return;

    setDataPanelCollapsed(state.dataPanelCollapsed);
    if (el.suitepimFloorPlanDataPanelTitle) el.suitepimFloorPlanDataPanelTitle.textContent = heatmapDetailTitle();
    if (el.suitepimFloorPlanDataPanelSummary) {
      el.suitepimFloorPlanDataPanelSummary.textContent = state.heatmapDetailLoading
        ? "Loading rows..."
        : `${state.heatmapDetailRows.length.toLocaleString("en-GB")} rows`;
    }
    if (!el.suitepimFloorPlanDataPanelContent) return;
    if (state.heatmapDetailLoading) {
      el.suitepimFloorPlanDataPanelContent.innerHTML = `<div class="suitepim-floorplan-data-loading"><span class="suitepim-floorplan-status-spinner" aria-hidden="true"></span><span>Loading data</span></div>`;
      return;
    }
    if (state.heatmapDetailError) {
      el.suitepimFloorPlanDataPanelContent.innerHTML = `<div class="suitepim-floorplan-analytics-note is-error">${clean(state.heatmapDetailError)}</div>`;
      return;
    }
    if (!state.heatmapDetailRows.length) {
      el.suitepimFloorPlanDataPanelContent.innerHTML = `<div class="suitepim-floorplan-empty">No rows for the selected heat map.</div>`;
      return;
    }

    const rowLimit = 500;
    const rows = state.heatmapDetailRows.slice(0, rowLimit);
    const limited = state.heatmapDetailRows.length > rowLimit
      ? `<p class="suitepim-floorplan-data-note">Showing first ${rowLimit.toLocaleString("en-GB")} rows.</p>`
      : "";
    const table = state.heatmapMode === "sold" || state.heatmapMode === "revenue"
      ? heatmapSalesRowsTable(rows)
      : state.heatmapMode === "inventory"
        ? heatmapInventoryRowsTable(rows)
        : heatmapMovementRowsTable(rows);
    el.suitepimFloorPlanDataPanelContent.innerHTML = `${limited}${table}`;
  }

  function heatmapSalesRowsTable(rows) {
    return `
      <table class="suitepim-floorplan-data-table">
        <thead><tr><th>Date</th><th>Sales order</th><th>Item</th><th>Amount</th><th>Qty</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <td>${clean(row.date || "")}</td>
            <td>${clean(row.saleTranid || row.sale_tranid || row.tranid || row.salesOrder || "")}</td>
            <td>${clean(row.displayName || row.item || "")}</td>
            <td>${money(Math.abs(Number(row.revenue || row.amount || 0)))}</td>
            <td>${number(Math.abs(Number(row.quantity || 0)), { maximumFractionDigits: 2 })}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    `;
  }

  function heatmapInventoryRowsTable(rows) {
    return `
      <table class="suitepim-floorplan-data-table">
        <thead><tr><th>Bin</th><th>Item</th><th>Lot</th><th>On hand</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <td>${clean(inventoryValue(row, ["Bin Number", "Bin", "bin", "binNumber", "binnumber", "Bin Name"]))}</td>
            <td>${clean(inventoryValue(row, ["Display Name", "displayName", "Item", "item", "Item Name", "itemName"]))}</td>
            <td>${clean(inventoryValue(row, ["Inventory Number", "inventoryNumber", "Lot Number", "lotNumber", "Lot"]))}</td>
            <td>${number(numericInventoryValue(row, ["On Hand", "onHand", "OnHand", "Quantity On Hand"]), { maximumFractionDigits: 2 })}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    `;
  }

  function heatmapMovementRowsTable(rows) {
    return `
      <table class="suitepim-floorplan-data-table">
        <thead><tr><th>Date</th><th>Document</th><th>Item</th><th>From bin</th><th>To bin</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <td>${clean(row.date || "")}</td>
            <td>${clean(row.tranid || row.documentNumber || "")}</td>
            <td>${clean(row.item || "")}</td>
            <td>${clean(row.fromBin || "")}</td>
            <td>${clean(row.toBin || "")}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    `;
  }

  async function loadBins() {
    if (!state.selectedLocationId || state.binsLoadedForLocationId === state.selectedLocationId || state.binsLoading) return;
    state.binsLoading = true;
    renderBins();
    try {
      const data = await api(`/api/suitepim/bins?locationId=${encodeURIComponent(state.selectedLocationId)}`);
      state.bins = Array.isArray(data.bins) ? data.bins : [];
      state.binsLoadedForLocationId = state.selectedLocationId;
    } catch (err) {
      state.bins = [];
      showStatus(err.message, "error");
    } finally {
      state.binsLoading = false;
      renderBins();
    }
  }

  async function loadFootfall() {
    if (!state.selectedLocationId || !state.footfallStartDate || !state.footfallEndDate) return;
    state.footfallLoading = true;
    if (el.suitepimFloorPlanFootfallTotal) el.suitepimFloorPlanFootfallTotal.textContent = "...";
    const params = new URLSearchParams({
      locationId: state.selectedLocationId,
      startDate: state.footfallStartDate,
      endDate: state.footfallEndDate,
    });
    try {
      const data = await api(`/api/suitepim/footfall?${params.toString()}`);
      if (el.suitepimFloorPlanFootfallTotal) {
        el.suitepimFloorPlanFootfallTotal.textContent = Number(data.total || 0).toLocaleString("en-GB");
      }
    } catch (err) {
      if (el.suitepimFloorPlanFootfallTotal) el.suitepimFloorPlanFootfallTotal.textContent = "-";
      showStatus(err.message, "error");
    } finally {
      state.footfallLoading = false;
    }
  }

  async function loadAnalytics() {
    if (!state.selectedLocationId || !state.footfallStartDate || !state.footfallEndDate) return;
    const data = planData();
    const assets = data.elements.filter((element) => element.type === "asset" && element.bin?.number);
    state.analyticsLoading = true;
    state.analytics.error = "";
    renderAnalytics();
    const bodyBase = {
      locationId: state.selectedLocationId,
      startDate: state.footfallStartDate,
      endDate: state.footfallEndDate,
      assets: assets.map((asset) => ({
        id: asset.id,
        bin: asset.bin,
      })),
    };
    try {
      const [footfallPayload, soldPayload, revenuePayload] = await Promise.all([
        api(`/api/suitepim/footfall?${new URLSearchParams({
          locationId: state.selectedLocationId,
          startDate: state.footfallStartDate,
          endDate: state.footfallEndDate,
        }).toString()}`),
        api("/api/suitepim/floor-plan-heatmap-values", {
          method: "POST",
          body: JSON.stringify({ ...bodyBase, mode: "sold" }),
        }),
        api("/api/suitepim/floor-plan-heatmap-values", {
          method: "POST",
          body: JSON.stringify({ ...bodyBase, mode: "revenue" }),
        }),
      ]);
      state.analytics.footfall = Number(footfallPayload.total || 0);
      state.analytics.soldValues = soldPayload.values || {};
      state.analytics.revenueValues = revenuePayload.values || {};
    } catch (err) {
      state.analytics.error = err.message || "Unable to load analytics";
    } finally {
      state.analyticsLoading = false;
      renderAnalytics();
    }
  }

  function gridMarkup(widthMeters, heightMeters) {
    const widthPx = widthMeters * PX_PER_METER;
    const heightPx = heightMeters * PX_PER_METER;
    const lines = [];

    for (let x = 0; x <= widthMeters; x += 0.25) {
      if (Math.abs(x - Math.round(x)) < 0.001) continue;
      lines.push(`<line class="subminor" x1="${x * PX_PER_METER}" y1="0" x2="${x * PX_PER_METER}" y2="${heightPx}" />`);
    }
    for (let y = 0; y <= heightMeters; y += 0.25) {
      if (Math.abs(y - Math.round(y)) < 0.001) continue;
      lines.push(`<line class="subminor" x1="0" y1="${y * PX_PER_METER}" x2="${widthPx}" y2="${y * PX_PER_METER}" />`);
    }
    for (let x = 0; x <= widthMeters; x += 1) {
      lines.push(`<line class="${x % 10 === 0 ? "major" : "minor"}" x1="${x * PX_PER_METER}" y1="0" x2="${x * PX_PER_METER}" y2="${heightPx}" />`);
    }
    for (let y = 0; y <= heightMeters; y += 1) {
      lines.push(`<line class="${y % 10 === 0 ? "major" : "minor"}" x1="0" y1="${y * PX_PER_METER}" x2="${widthPx}" y2="${y * PX_PER_METER}" />`);
    }
    for (let x = 10; x <= widthMeters; x += 10) {
      lines.push(`<text class="meter-label" x="${x * PX_PER_METER + 4}" y="14">${x}m</text>`);
    }
    for (let y = 10; y <= heightMeters; y += 10) {
      lines.push(`<text class="meter-label" x="4" y="${y * PX_PER_METER - 4}">${y}m</text>`);
    }

    return `<g class="suitepim-floorplan-grid">${lines.join("")}</g>`;
  }

  function lineGeometry(element) {
    const x1 = element.x1 * PX_PER_METER;
    const y1 = element.y1 * PX_PER_METER;
    const x2 = element.x2 * PX_PER_METER;
    const y2 = element.y2 * PX_PER_METER;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.max(Math.sqrt((dx * dx) + (dy * dy)), 1);
    const nx = -dy / length;
    const ny = dx / length;
    return { x1, y1, x2, y2, dx, dy, length, nx, ny };
  }

  function lineTag(className, x1, y1, x2, y2) {
    return `<line class="${className}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`;
  }

  function wallMarkup(element) {
    const g = lineGeometry(element);
    const offset = 3.4;
    return `
      ${lineTag("suitepim-floorplan-wall-core", g.x1, g.y1, g.x2, g.y2)}
      ${lineTag("suitepim-floorplan-wall-edge", g.x1 + g.nx * offset, g.y1 + g.ny * offset, g.x2 + g.nx * offset, g.y2 + g.ny * offset)}
      ${lineTag("suitepim-floorplan-wall-edge", g.x1 - g.nx * offset, g.y1 - g.ny * offset, g.x2 - g.nx * offset, g.y2 - g.ny * offset)}
    `;
  }

  function openingMarkup(element, className) {
    const g = lineGeometry(element);
    const offset = 4.2;
    return `
      ${lineTag(`${className} suitepim-floorplan-opening-face`, g.x1, g.y1, g.x2, g.y2)}
      ${lineTag(`${className} suitepim-floorplan-opening-edge`, g.x1 + g.nx * offset, g.y1 + g.ny * offset, g.x2 + g.nx * offset, g.y2 + g.ny * offset)}
      ${lineTag(`${className} suitepim-floorplan-opening-edge`, g.x1 - g.nx * offset, g.y1 - g.ny * offset, g.x2 - g.nx * offset, g.y2 - g.ny * offset)}
    `;
  }

  function doorSwingMarkup(element) {
    const g = lineGeometry(element);
    const radius = Math.min(g.length, PX_PER_METER * 4);
    const endX = g.x1 + g.nx * radius;
    const endY = g.y1 + g.ny * radius;
    return `
      ${lineTag("suitepim-floorplan-door-leaf", g.x1, g.y1, endX, endY)}
      <path class="suitepim-floorplan-door-swing" d="M ${g.x2.toFixed(2)} ${g.y2.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 0 ${endX.toFixed(2)} ${endY.toFixed(2)}" />
    `;
  }

  function dimensionMarkup(element) {
    const g = lineGeometry(element);
    const offset = 18;
    const tick = 5;
    const x1 = g.x1 + g.nx * offset;
    const y1 = g.y1 + g.ny * offset;
    const x2 = g.x2 + g.nx * offset;
    const y2 = g.y2 + g.ny * offset;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const angle = Math.atan2(g.dy, g.dx) * 180 / Math.PI;
    const label = `${Math.round((g.length / PX_PER_METER) * 100) / 100}m`;
    return `
      <g class="suitepim-floorplan-dimension">
        ${lineTag("suitepim-floorplan-dimension-line", x1, y1, x2, y2)}
        ${lineTag("suitepim-floorplan-dimension-tick", x1 - g.nx * tick, y1 - g.ny * tick, x1 + g.nx * tick, y1 + g.ny * tick)}
        ${lineTag("suitepim-floorplan-dimension-tick", x2 - g.nx * tick, y2 - g.ny * tick, x2 + g.nx * tick, y2 + g.ny * tick)}
        <text x="${midX.toFixed(2)}" y="${midY.toFixed(2)}" transform="rotate(${angle.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)})">${label}</text>
      </g>
    `;
  }

  function assetMarkup(element) {
    const asset = assetByKey(element.assetKey);
    const width = Number(element.width) || asset?.width || 1;
    const height = Number(element.height) || asset?.height || 1;
    const x = (Number(element.x) || 0) * PX_PER_METER;
    const y = (Number(element.y) || 0) * PX_PER_METER;
    const w = width * PX_PER_METER;
    const h = height * PX_PER_METER;
    const label = asset?.name || element.name || "Asset";
    const binLabel = floorPlanBinLabel(element.bin?.number || "");
    const mainLabel = binLabel || label;
    const selected = state.selectedElementId === element.id || state.selectedAssetIds.has(element.id);
    const rotation = Number(element.rotation) || 0;
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const rotationTransform = rotation !== 0 ? ` rotate(${rotation} ${centerX.toFixed(2)} ${centerY.toFixed(2)})` : "";
    const heatmapActive = state.heatmapMode !== "none" && state.heatmapMode !== "movement";
    const heatmapByFloor = heatmapActive && state.heatmapScope === "squareFootage";
    const heatmapValue = heatmapDisplayValue(element);
    const mainColor = heatmapActive
      ? (heatmapByFloor ? "#d8dee4" : heatmapColor(heatmapValue, state.heatmapMax))
      : (element.mainColor || "");
    const textColor = element.textColor || "";
    const rectStyle = mainColor ? ` style="fill:${clean(mainColor)}"` : "";
    const textStyle = textColor ? ` style="fill:${clean(textColor)}"` : "";
    const heatmapTitle = heatmapActive
      ? `${state.heatmapMode}${heatmapByFloor ? " per sq ft" : ""}: ${heatmapMetricLabel(heatmapValue)}`
      : "";
    const title = element.note || element.bin?.number || heatmapTitle
      ? `<title>${clean([element.bin?.number, heatmapTitle, element.note].filter(Boolean).join(" - "))}</title>`
      : "";
    const shape = element.shape || asset?.shape || "";
    const body = shape === "circle"
      ? `
        <circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${(Math.min(w, h) / 2).toFixed(2)}"${rectStyle} />
        <line x1="${(centerX - w * 0.22).toFixed(2)}" y1="${(centerY - h * 0.22).toFixed(2)}" x2="${(centerX + w * 0.22).toFixed(2)}" y2="${(centerY + h * 0.22).toFixed(2)}" />
        <line x1="${(centerX - w * 0.22).toFixed(2)}" y1="${(centerY + h * 0.22).toFixed(2)}" x2="${(centerX + w * 0.22).toFixed(2)}" y2="${(centerY - h * 0.22).toFixed(2)}" />
      `
      : `
        <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.5"${rectStyle} />
        <line x1="${(x + 4).toFixed(2)}" y1="${(y + 4).toFixed(2)}" x2="${(x + w - 4).toFixed(2)}" y2="${(y + 4).toFixed(2)}" />
        <line x1="${(x + 4).toFixed(2)}" y1="${(y + h / 2).toFixed(2)}" x2="${(x + w - 4).toFixed(2)}" y2="${(y + h / 2).toFixed(2)}" />
      `;
    return `
      <g class="suitepim-floorplan-placed-asset${selected ? " is-selected" : ""}" data-element-id="${clean(element.id)}"${rotationTransform ? ` transform="${rotationTransform}"` : ""}>
        ${title}
        ${body}
        <text class="suitepim-floorplan-asset-bin-main" x="${(x + w / 2).toFixed(2)}" y="${(y + h / 2).toFixed(2)}"${textStyle}>${clean(mainLabel)}</text>
        <text class="suitepim-floorplan-asset-size-label" x="${(x + w / 2).toFixed(2)}" y="${(y + h - 4).toFixed(2)}"${textStyle}>${clean(label)}</text>
      </g>
    `;
  }

  function elementMarkup(element, isDraft = false) {
    if (element.type === "asset") return assetMarkup(element);
    const body = element.type === "door"
      ? `${openingMarkup(element, "suitepim-floorplan-door")}${doorSwingMarkup(element)}`
      : element.type === "window"
        ? openingMarkup(element, "suitepim-floorplan-window")
        : wallMarkup(element);
    return `<g class="suitepim-floorplan-element${isDraft ? " is-draft" : ""}">${body}${dimensionMarkup(element)}</g>`;
  }

  function enclosedFloorCells(data, cellMeters) {
    const cols = Math.ceil(data.widthMeters / cellMeters);
    const rows = Math.ceil(data.heightMeters / cellMeters);
    const blocked = Array.from({ length: rows }, () => Array(cols).fill(false));
    const outside = Array.from({ length: rows }, () => Array(cols).fill(false));
    const structures = data.elements.filter((element) => ["line", "door", "window"].includes(element.type));

    structures.forEach((element) => {
      const x1 = Number(element.x1) || 0;
      const y1 = Number(element.y1) || 0;
      const x2 = Number(element.x2) || 0;
      const y2 = Number(element.y2) || 0;
      const length = Math.max(Math.hypot(x2 - x1, y2 - y1), cellMeters);
      const steps = Math.max(1, Math.ceil(length / (cellMeters / 2)));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const col = Math.floor((x1 + (x2 - x1) * t) / cellMeters);
        const row = Math.floor((y1 + (y2 - y1) * t) / cellMeters);
        if (row >= 0 && row < rows && col >= 0 && col < cols) blocked[row][col] = true;
      }
    });

    const queue = [];
    const pushOutside = (row, col) => {
      if (row < 0 || row >= rows || col < 0 || col >= cols || outside[row][col] || blocked[row][col]) return;
      outside[row][col] = true;
      queue.push([row, col]);
    };

    for (let col = 0; col < cols; col += 1) {
      pushOutside(0, col);
      pushOutside(rows - 1, col);
    }
    for (let row = 0; row < rows; row += 1) {
      pushOutside(row, 0);
      pushOutside(row, cols - 1);
    }

    while (queue.length) {
      const [row, col] = queue.shift();
      pushOutside(row - 1, col);
      pushOutside(row + 1, col);
      pushOutside(row, col - 1);
      pushOutside(row, col + 1);
    }

    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (!outside[row][col] && !blocked[row][col]) cells.push({ row, col });
      }
    }
    return cells.length ? cells : structuralBoundsFloorCells(data, cellMeters);
  }

  function structuralBoundsFloorCells(data, cellMeters) {
    const cols = Math.ceil(data.widthMeters / cellMeters);
    const rows = Math.ceil(data.heightMeters / cellMeters);
    const segments = data.elements
      .filter((element) => ["line", "door", "window"].includes(element.type))
      .map((element) => ({
        x1: Number(element.x1) || 0,
        y1: Number(element.y1) || 0,
        x2: Number(element.x2) || 0,
        y2: Number(element.y2) || 0,
      }));
    const parent = segments.map((_, index) => index);
    const find = (index) => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    const unite = (a, b) => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pb] = pa;
    };
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 1.5;
    segments.forEach((a, ai) => {
      const aPoints = [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }];
      segments.forEach((b, bi) => {
        if (bi <= ai) return;
        const bPoints = [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }];
        if (aPoints.some((ap) => bPoints.some((bp) => near(ap, bp)))) unite(ai, bi);
      });
    });
    const boxes = new Map();
    segments.forEach((segment, index) => {
      const key = find(index);
      const box = boxes.get(key) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      box.minX = Math.min(box.minX, segment.x1, segment.x2);
      box.minY = Math.min(box.minY, segment.y1, segment.y2);
      box.maxX = Math.max(box.maxX, segment.x1, segment.x2);
      box.maxY = Math.max(box.maxY, segment.y1, segment.y2);
      boxes.set(key, box);
    });
    const usableBoxes = [...boxes.values()].filter((box) => (box.maxX - box.minX) * (box.maxY - box.minY) >= 4);
    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = (col + 0.5) * cellMeters;
        const y = (row + 0.5) * cellMeters;
        if (usableBoxes.some((box) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY)) {
          cells.push({ row, col });
        }
      }
    }
    return cells;
  }

  function heatmapFloorOverlayMarkup(data) {
    if (state.heatmapMode === "none" || state.heatmapScope !== "squareFootage") return "";
    const assets = data.elements.filter((element) => element.type === "asset" && element.bin?.number);
    if (!assets.length) return "";

    const points = assets.map((element) => {
      const asset = assetByKey(element.assetKey);
      const width = Number(element.width) || asset?.width || 1;
      const height = Number(element.height) || asset?.height || 1;
      return {
        x: ((Number(element.x) || 0) + width / 2) * PX_PER_METER,
        y: ((Number(element.y) || 0) + height / 2) * PX_PER_METER,
        value: heatmapDisplayValue(element),
      };
    }).filter((point) => Number(point.value) > 0);
    if (!points.length) return "";

    const cellMeters = 0.75;
    const cell = PX_PER_METER * cellMeters;
    const influence = PX_PER_METER * 5.5;
    const sigma = PX_PER_METER * 1.9;
    const floorCells = enclosedFloorCells(data, cellMeters);
    const sampled = floorCells.map(({ row, col }) => {
        const x = col * cell;
        const y = row * cell;
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        let density = 0;

        points.forEach((point) => {
          const dx = cx - point.x;
          const dy = cy - point.y;
          const distance = Math.sqrt((dx * dx) + (dy * dy));
          if (distance > influence) return;
          const pointWeight = Math.exp(-((distance * distance) / (2 * sigma * sigma)));
          density += point.value * pointWeight;
        });

        return { x, y, value: density };
    });
    const positiveValues = sampled
      .map((sample) => Number(sample.value) || 0)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);
    const maxValue = heatmapRobustMax(positiveValues);
    const cells = sampled.map(({ x, y, value }) => {
      const color = heatmapColor(value, maxValue, 0.58);
      return `
        <rect
          class="suitepim-floorplan-heatmap-cell"
          x="${x.toFixed(2)}"
          y="${y.toFixed(2)}"
          width="${cell.toFixed(2)}"
          height="${cell.toFixed(2)}"
          style="fill:${clean(color)}" />
        `;
    });

    return `<g class="suitepim-floorplan-heatmap-layer">${cells.join("")}</g>`;
  }

  function movementOverlayMarkup(data) {
    if (state.heatmapMode !== "movement" || !state.movementPaths.length) return "";
    const assets = data.elements.filter((element) => element.type === "asset" && element.bin?.number);
    if (!assets.length) return "";

    const assetsByBin = new Map();
    assets.forEach((asset) => {
      const key = normalizeBinMatch(asset.bin?.number);
      if (key && !assetsByBin.has(key)) assetsByBin.set(key, asset);
    });

    const maxCount = Math.max(1, ...state.movementPaths.map((path) => Number(path.count) || 0));
    const paths = state.movementPaths.map((movement, index) => {
      const fromAsset = assetsByBin.get(normalizeBinMatch(movement.fromBin));
      const toAsset = assetsByBin.get(normalizeBinMatch(movement.toBin));
      if (!fromAsset || !toAsset || fromAsset.id === toAsset.id) return "";

      const from = assetCenter(fromAsset);
      const to = assetCenter(toAsset);
      const x1 = from.x * PX_PER_METER;
      const y1 = from.y * PX_PER_METER;
      const x2 = to.x * PX_PER_METER;
      const y2 = to.y * PX_PER_METER;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.max(1, Math.hypot(dx, dy));
      const normalX = -dy / length;
      const normalY = dx / length;
      const curveOffset = (18 + ((index % 4) * 7)) * (index % 2 ? -1 : 1);
      const cx = (x1 + x2) / 2 + normalX * curveOffset;
      const cy = (y1 + y2) / 2 + normalY * curveOffset;
      const count = Number(movement.count) || 0;
      const ratio = Math.max(0, Math.min(1, count / maxCount));
      const strokeWidth = 2.4 + ratio * 4.2;
      const hue = 205 - (205 * ratio);
      const color = `hsl(${hue.toFixed(0)} 84% 44%)`;
      const labelX = (x1 + x2 + cx) / 3;
      const labelY = (y1 + y2 + cy) / 3;
      const title = `${movement.fromBin} to ${movement.toBin}: ${count} movement${count === 1 ? "" : "s"}`;
      return `
        <g class="suitepim-floorplan-movement-path">
          <title>${clean(title)}</title>
          <path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}"
            style="stroke:${clean(color)};stroke-width:${strokeWidth.toFixed(2)}" marker-end="url(#suitepimFloorPlanMovementArrow)" />
          <text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}">${clean(String(count))}</text>
        </g>
      `;
    }).filter(Boolean);

    if (!paths.length) return "";
    return `
      <defs>
        <marker id="suitepimFloorPlanMovementArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 4 L 0 8 z" class="suitepim-floorplan-movement-arrow-head" />
        </marker>
      </defs>
      <g class="suitepim-floorplan-movement-layer">${paths.join("")}</g>
    `;
  }

  function highlightMarkup() {
    const rect = normalRect(state.highlightDraft || state.highlightArea);
    if (!rect) return "";
    const x = rect.x1 * PX_PER_METER;
    const y = rect.y1 * PX_PER_METER;
    const width = Math.max(0, (rect.x2 - rect.x1) * PX_PER_METER);
    const height = Math.max(0, (rect.y2 - rect.y1) * PX_PER_METER);
    if (width <= 0 || height <= 0) return "";
    return `
      <rect
        class="suitepim-floorplan-highlight-area"
        x="${x.toFixed(2)}"
        y="${y.toFixed(2)}"
        width="${width.toFixed(2)}"
        height="${height.toFixed(2)}" />
    `;
  }

  function renderCanvas() {
    if (!el.suitepimFloorPlanCanvas) return;
    const data = planData();
    const widthPx = data.widthMeters * PX_PER_METER;
    const heightPx = data.heightMeters * PX_PER_METER;
    updateHeatmapMax();
    const heatmapOverlay = heatmapFloorOverlayMarkup(data);
    const movementOverlay = movementOverlayMarkup(data);
    const highlightOverlay = highlightMarkup();
    const elements = data.elements.map((element) => elementMarkup(element)).join("");
    const draft = state.draft ? elementMarkup(state.draft, true) : "";

    el.suitepimFloorPlanCanvas.setAttribute("viewBox", `0 0 ${widthPx} ${heightPx}`);
    el.suitepimFloorPlanCanvas.style.width = `${widthPx * state.zoom}px`;
    el.suitepimFloorPlanCanvas.style.height = `${heightPx * state.zoom}px`;
    el.suitepimFloorPlanCanvas.innerHTML = `
      <rect class="suitepim-floorplan-bg" x="0" y="0" width="${widthPx}" height="${heightPx}"></rect>
      ${gridMarkup(data.widthMeters, data.heightMeters)}
      ${heatmapOverlay}
      ${movementOverlay}
      ${highlightOverlay}
      <g class="suitepim-floorplan-elements">${elements}${draft}</g>
    `;
    updateRotationControls();
  }

  function renderActivePlan() {
    const active = state.activePlan || createEmptyPlan(state.selectedLocationId || state.locations[0]?.id || 0);
    state.activePlan = active;
    if (el.suitepimFloorPlanName) el.suitepimFloorPlanName.value = active.name || "Untitled floor plan";
    if (el.suitepimFloorPlanCurrent) el.suitepimFloorPlanCurrent.checked = active.isCurrent === true;
    renderCanvas();
    updateEditControls();
    updateRotationControls();
  }

  function renderAll() {
    renderLocations();
    renderPlanList();
    renderAssets();
    renderBins();
    renderAnalytics();
    renderActivePlan();
    updateHeatmapControls();
    renderHeatmapDataPanel();
  }

  function setDirty() {
    state.dirty = true;
    showStatus("Unsaved changes", "warning");
  }

  function updateZoomLabel() {
    if (el.suitepimFloorPlanZoomLabel) {
      el.suitepimFloorPlanZoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    }
  }

  function setZoom(nextZoom) {
    const wrap = el.suitepimFloorPlanCanvasWrap;
    const previousZoom = state.zoom;
    const next = clamp(Math.round(nextZoom * 100) / 100, 0.25, 3);
    if (next === previousZoom) return;

    let anchor = null;
    if (wrap) {
      anchor = {
        x: wrap.clientWidth / 2,
        y: wrap.clientHeight / 2,
        planX: (wrap.scrollLeft + wrap.clientWidth / 2) / previousZoom,
        planY: (wrap.scrollTop + wrap.clientHeight / 2) / previousZoom,
      };
    }

    state.zoom = next;
    updateZoomLabel();
    renderCanvas();

    if (wrap && anchor) {
      wrap.scrollLeft = anchor.planX * state.zoom - anchor.x;
      wrap.scrollTop = anchor.planY * state.zoom - anchor.y;
    }
  }

  function zoomAtPoint(nextZoom, screenX, screenY) {
    const wrap = el.suitepimFloorPlanCanvasWrap;
    const previousZoom = state.zoom;
    const next = clamp(Math.round(nextZoom * 100) / 100, 0.25, 3);
    if (!wrap || next === previousZoom) return;

    const canvasX = (screenX + wrap.scrollLeft) / previousZoom;
    const canvasY = (screenY + wrap.scrollTop) / previousZoom;
    state.zoom = next;
    updateZoomLabel();
    renderCanvas();
    wrap.scrollLeft = canvasX * state.zoom - screenX;
    wrap.scrollTop = canvasY * state.zoom - screenY;
  }

  function canvasPoint(event) {
    const rect = el.suitepimFloorPlanCanvas.getBoundingClientRect();
    const data = planData();
    const rawX = ((event.clientX - rect.left) / rect.width) * data.widthMeters;
    const rawY = ((event.clientY - rect.top) / rect.height) * data.heightMeters;
    const point = state.lockGrid
      ? { x: Math.round(rawX), y: Math.round(rawY) }
      : { x: Math.round(rawX * 10) / 10, y: Math.round(rawY * 10) / 10 };

    return {
      x: Math.min(data.widthMeters, Math.max(0, point.x)),
      y: Math.min(data.heightMeters, Math.max(0, point.y)),
    };
  }

  function lockedEndPoint(start, end) {
    if (!state.lockGrid) return end;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return end;

    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: Math.round(start.x + Math.cos(snappedAngle) * distance),
      y: Math.round(start.y + Math.sin(snappedAngle) * distance),
    };
  }

  function startDrawing(event) {
    if (!state.editMode || event.button !== 0) return;
    if (event.target.closest?.(".suitepim-floorplan-placed-asset")) return;
    const point = canvasPoint(event);
    state.draft = {
      id: `draft-${Date.now()}`,
      type: state.tool,
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
    };
    renderCanvas();
  }

  function updateDrawing(event) {
    if (!state.draft) return;
    const start = { x: state.draft.x1, y: state.draft.y1 };
    const end = lockedEndPoint(start, canvasPoint(event));
    const data = planData();
    state.draft.x2 = Math.min(data.widthMeters, Math.max(0, end.x));
    state.draft.y2 = Math.min(data.heightMeters, Math.max(0, end.y));
    renderCanvas();
  }

  function finishDrawing() {
    if (!state.draft) return;
    const draft = state.draft;
    state.draft = null;
    if (draft.x1 === draft.x2 && draft.y1 === draft.y2) {
      renderCanvas();
      return;
    }
    pushHistory();
    const data = planData();
    data.elements.push({
      ...draft,
      id: `fp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    });
    setPlanData(data);
    setDirty();
    renderCanvas();
  }

  function addAssetToPlan(assetKey, event) {
    if (!state.editMode) {
      showStatus("Click Edit before placing assets", "warning");
      return;
    }
    const asset = assetByKey(assetKey);
    if (!asset) return;
    pushHistory();
    const point = canvasPoint(event);
    const data = planData();
    const x = Math.min(data.widthMeters - asset.width, Math.max(0, point.x - asset.width / 2));
    const y = Math.min(data.heightMeters - asset.height, Math.max(0, point.y - asset.height / 2));
    data.elements.push({
      id: `asset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type: "asset",
      assetKey: asset.key,
      name: asset.name,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      width: asset.width,
      height: asset.height,
      shape: asset.shape || "",
      rotation: 0,
    });
    setPlanData(data);
    selectAsset(data.elements[data.elements.length - 1].id);
    setDirty();
    renderCanvas();
  }

  function startHighlightSelection(event) {
    if (state.editMode || !event.shiftKey || event.button !== 0) return false;
    event.preventDefault();
    const point = canvasPoint(event);
    state.highlightDraft = {
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
    };
    renderCanvas();
    renderAnalytics();
    return true;
  }

  function updateHighlightSelection(event) {
    if (!state.highlightDraft) return false;
    const point = canvasPoint(event);
    state.highlightDraft.x2 = point.x;
    state.highlightDraft.y2 = point.y;
    renderCanvas();
    renderAnalytics();
    return true;
  }

  function finishHighlightSelection() {
    if (!state.highlightDraft) return false;
    const rect = normalRect(state.highlightDraft);
    state.highlightDraft = null;
    if (!rect || Math.abs(rect.x2 - rect.x1) < 0.1 || Math.abs(rect.y2 - rect.y1) < 0.1) {
      state.highlightArea = null;
    } else {
      state.highlightArea = rect;
    }
    renderCanvas();
    renderAnalytics();
    return true;
  }

  function attachBinToAsset(binId, event) {
    if (!state.editMode) {
      showStatus("Click Edit before attaching bins", "warning");
      return;
    }
    const bin = state.bins.find((item) => String(item.id) === String(binId));
    if (!bin) return;
    const asset = assetAtPoint(canvasPoint(event));
    if (!asset) {
      showStatus("Drop the bin onto an asset", "warning");
      return;
    }

    pushHistory();
    const data = planData();
    const element = data.elements.find((item) => item.id === asset.id && item.type === "asset");
    if (!element) return;
    element.bin = {
      id: String(bin.id || ""),
      number: String(bin.number || ""),
      location: String(bin.location || ""),
      zone: String(bin.zone || ""),
    };
    setPlanData(data);
    selectAsset(element.id);
    setDirty();
    renderCanvas();
    showStatus(`Attached ${bin.number}`, "success");
  }

  function assetAtPoint(point) {
    const data = planData();
    return [...data.elements].reverse().find((element) => {
      if (element.type !== "asset") return false;
      const x = Number(element.x) || 0;
      const y = Number(element.y) || 0;
      const width = Number(element.width) || 0;
      const height = Number(element.height) || 0;
      return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
    }) || null;
  }

  function startAssetMove(event) {
    if (!state.editMode || event.button !== 0) return false;
    const point = canvasPoint(event);
    const asset = assetAtPoint(point);
    if (!asset) {
      state.selectedElementId = "";
      state.selectedAssetIds.clear();
      renderCanvas();
      return false;
    }

    event.preventDefault();
    const keepGroup = !event.shiftKey && state.selectedAssetIds.size > 1 && state.selectedAssetIds.has(asset.id);
    selectAsset(asset.id, { append: event.shiftKey || keepGroup, preserve: keepGroup });
    state.movingAsset = {
      id: asset.id,
      offsetX: point.x - (Number(asset.x) || 0),
      offsetY: point.y - (Number(asset.y) || 0),
      moved: false,
      historyPushed: false,
    };
    el.suitepimFloorPlanCanvas.setPointerCapture?.(event.pointerId);
    renderCanvas();
    return true;
  }

  function updateAssetMove(event) {
    if (!state.movingAsset) return false;
    const data = planData();
    const element = data.elements.find((item) => item.id === state.movingAsset.id && item.type === "asset");
    if (!element) return false;

    if (!state.movingAsset.historyPushed) {
      pushHistory();
      state.movingAsset.historyPushed = true;
    }

    const point = canvasPoint(event);
    const width = Number(element.width) || 1;
    const height = Number(element.height) || 1;
    const x = Math.min(data.widthMeters - width, Math.max(0, point.x - state.movingAsset.offsetX));
    const y = Math.min(data.heightMeters - height, Math.max(0, point.y - state.movingAsset.offsetY));
    element.x = state.lockGrid ? Math.round(x) : Math.round(x * 100) / 100;
    element.y = state.lockGrid ? Math.round(y) : Math.round(y * 100) / 100;
    state.movingAsset.moved = true;
    setPlanData(data);
    setDirty();
    renderCanvas();
    return true;
  }

  function finishAssetMove() {
    if (!state.movingAsset) return false;
    state.movingAsset = null;
    renderCanvas();
    return true;
  }

  function startViewportPan(event) {
    if (state.editMode || event.button !== 0 || event.shiftKey || !el.suitepimFloorPlanCanvasWrap) return false;
    if (event.target.closest?.(".suitepim-floorplan-placed-asset")) return false;

    event.preventDefault();
    state.pan = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: el.suitepimFloorPlanCanvasWrap.scrollLeft,
      scrollTop: el.suitepimFloorPlanCanvasWrap.scrollTop,
    };
    el.suitepimFloorPlanCanvasWrap.classList.add("panning");
    el.suitepimFloorPlanCanvas.setPointerCapture?.(event.pointerId);
    return true;
  }

  function updateViewportPan(event) {
    if (!state.pan || !el.suitepimFloorPlanCanvasWrap) return false;
    const dx = event.clientX - state.pan.startX;
    const dy = event.clientY - state.pan.startY;
    el.suitepimFloorPlanCanvasWrap.scrollLeft = state.pan.scrollLeft - dx;
    el.suitepimFloorPlanCanvasWrap.scrollTop = state.pan.scrollTop - dy;
    return true;
  }

  function finishViewportPan() {
    if (!state.pan) return false;
    state.pan = null;
    el.suitepimFloorPlanCanvasWrap?.classList.remove("panning");
    return true;
  }

  function updateAssetElements(ids, updates = {}) {
    const selectedIds = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
    if (!selectedIds.length) return;
    const idSet = new Set(selectedIds);
    const data = planData();
    let changed = false;
    data.elements.forEach((element) => {
      if (element.type !== "asset" || !idSet.has(element.id)) return;
      if (Object.prototype.hasOwnProperty.call(updates, "mainColor")) element.mainColor = updates.mainColor || "";
      if (Object.prototype.hasOwnProperty.call(updates, "textColor")) element.textColor = updates.textColor || "";
      if (Object.prototype.hasOwnProperty.call(updates, "note")) element.note = updates.note || "";
      changed = true;
    });
    if (!changed) return;
    setPlanData(data);
    state.selectedAssetIds = new Set(selectedIds);
    state.selectedElementId = selectedIds[selectedIds.length - 1] || "";
    setDirty();
    renderCanvas();
    showStatus(selectedIds.length > 1 ? `${selectedIds.length} assets updated` : "Asset updated", "success");
  }

  function deleteElements(ids) {
    const selectedIds = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
    if (!selectedIds.length) return;
    const idSet = new Set(selectedIds);
    const data = planData();
    const before = data.elements.length;
    data.elements = data.elements.filter((element) => !idSet.has(element.id));
    if (data.elements.length === before) return;
    setPlanData(data);
    state.selectedElementId = "";
    state.selectedAssetIds.clear();
    setDirty();
    renderCanvas();
    showStatus(selectedIds.length > 1 ? `${selectedIds.length} assets deleted` : "Asset deleted", "warning");
  }

  function inventoryValue(row, keys) {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  }

  function salesAggregateKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function salesFamilyKey(value) {
    return salesAggregateKey(value)
      .replace(/[:/\\|()[\],.&+-]+/g, " ")
      .replace(/\b(single|double|king|super|small|medium|large|size|zipped|zip|drawer|drawers)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function money(value) {
    return Number(value || 0).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
  }

  function percent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  function number(value, options = {}) {
    return Number(value || 0).toLocaleString("en-GB", options);
  }

  function heatmapColor(value, max, curve = 1) {
    if (!Number(max)) return "#d8dee4";
    const rawRatio = Math.max(0, Math.min(1, Number(value) / Number(max)));
    const ratio = Math.pow(rawRatio, curve);
    const hue = 205 - (205 * ratio);
    const lightness = 84 - (36 * ratio);
    return `hsl(${hue.toFixed(0)} 82% ${lightness.toFixed(0)}%)`;
  }

  function heatmapRobustMax(values) {
    if (!values.length) return 0;
    if (values.length < 5) return values[values.length - 1];
    const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * 0.94)));
    return values[index] || values[values.length - 1] || 0;
  }

  function heatmapAssetAreaSqFt(element) {
    const asset = assetByKey(element.assetKey);
    const width = Number(element.width) || asset?.width || 1;
    const height = Number(element.height) || asset?.height || 1;
    return Math.max(0.1, width * height * 10.7639);
  }

  function planAreaSqFt() {
    const data = planData();
    const cellMeters = 0.5;
    const floorCells = enclosedFloorCells(data, cellMeters);
    if (floorCells.length) return floorCells.length * cellMeters * cellMeters * 10.7639;
    return Math.max(0.1, (Number(data.widthMeters) || 0) * (Number(data.heightMeters) || 0) * 10.7639);
  }

  function rectAreaSqFt(rect) {
    if (!rect) return 0;
    return Math.max(0, Math.abs(rect.x2 - rect.x1) * Math.abs(rect.y2 - rect.y1) * 10.7639);
  }

  function normalRect(rect) {
    if (!rect) return null;
    return {
      x1: Math.min(rect.x1, rect.x2),
      y1: Math.min(rect.y1, rect.y2),
      x2: Math.max(rect.x1, rect.x2),
      y2: Math.max(rect.y1, rect.y2),
    };
  }

  function assetCenter(element) {
    const asset = assetByKey(element.assetKey);
    const width = Number(element.width) || asset?.width || 1;
    const height = Number(element.height) || asset?.height || 1;
    return {
      x: (Number(element.x) || 0) + width / 2,
      y: (Number(element.y) || 0) + height / 2,
    };
  }

  function assetsInRect(rect) {
    const bounds = normalRect(rect);
    if (!bounds) return [];
    return planData().elements.filter((element) => {
      if (element.type !== "asset" || !element.bin?.number) return false;
      const center = assetCenter(element);
      return center.x >= bounds.x1 && center.x <= bounds.x2 && center.y >= bounds.y1 && center.y <= bounds.y2;
    });
  }

  function analyticsTotals(assets = null) {
    const targetAssets = assets || planData().elements.filter((element) => element.type === "asset" && element.bin?.number);
    return targetAssets.reduce((totals, asset) => {
      totals.itemsSold += Number(state.analytics.soldValues?.[asset.id] || 0);
      totals.revenue += Number(state.analytics.revenueValues?.[asset.id] || 0);
      return totals;
    }, { itemsSold: 0, revenue: 0 });
  }

  function heatmapDisplayValue(element) {
    const rawValue = Number(state.heatmapValues[element.id] || 0);
    if (state.heatmapScope !== "squareFootage") return rawValue;
    return rawValue / heatmapAssetAreaSqFt(element);
  }

  function updateHeatmapMax() {
    const data = planData();
    const values = data.elements
      .filter((element) => element.type === "asset")
      .map((element) => heatmapDisplayValue(element));
    state.heatmapMax = Math.max(0, ...values);
  }

  function heatmapMetricLabel(value) {
    if (state.heatmapMode === "revenue") return money(value);
    return Number(value || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 });
  }

  function numericInventoryValue(row, keys) {
    const value = inventoryValue(row, keys);
    return Number(String(value || "0").replace(/,/g, "")) || 0;
  }

  async function mapWithConcurrency(items, limit, worker) {
    const results = [];
    let index = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    });
    await Promise.all(runners);
    return results;
  }

  function findSalesForInventoryRow(row, aggregate = {}) {
    const internalId = inventoryValue(row, ["Internal ID", "internalId", "Item Internal ID", "itemInternalId", "Item ID", "itemId"]);
    const item = inventoryValue(row, ["Item", "item", "Item Name", "itemName", "Name"]);
    const parentId = inventoryValue(row, ["Parent ID", "parentId", "parentid", "Parent Internal ID", "parentInternalId"]);
    const displayName = inventoryValue(row, ["Display Name", "displayName", "displayname", "DisplayName"]);
    const byInternalId = aggregate.byInternalId || {};
    const byParentId = aggregate.byParentId || {};
    const byItem = aggregate.byItem || {};
    const byDisplayName = aggregate.byDisplayName || {};
    const byFamily = aggregate.byFamily || {};
    const matches = [
      ["parent", salesAggregateKey(parentId), byParentId[salesAggregateKey(parentId)]],
      ["display", salesAggregateKey(displayName), byDisplayName[salesAggregateKey(displayName)]],
      ["family", salesFamilyKey(displayName), byFamily[salesFamilyKey(displayName)]],
      ["family", salesFamilyKey(item), byFamily[salesFamilyKey(item)]],
      ["internal", salesAggregateKey(internalId), byInternalId[salesAggregateKey(internalId)]],
      ["item", salesAggregateKey(item), byItem[salesAggregateKey(item)]],
    ];
    const found = matches.find(([, key, match]) => key && match);
    if (!found) return { quantity: 0, revenue: 0, displayName: displayName || item, matchKey: "" };
    const [source, key, match] = found;
    return { ...match, matchKey: `${source}:${key}` };
  }

  async function loadHeatmapData() {
    if (state.heatmapMode === "none") {
      state.heatmapValues = {};
      state.heatmapMax = 0;
      state.movementPaths = [];
      state.heatmapDetailRows = [];
      state.heatmapDetailError = "";
      state.heatmapDetailLoading = false;
      renderHeatmapDataPanel();
      renderCanvas();
      return;
    }
    const data = planData();
    const assets = data.elements.filter((element) => element.type === "asset" && element.bin?.number);
    if (!assets.length) {
      state.heatmapValues = {};
      state.heatmapMax = 0;
      state.movementPaths = [];
      state.heatmapDetailRows = [];
      state.heatmapDetailError = "";
      state.heatmapDetailLoading = false;
      renderHeatmapDataPanel();
      renderCanvas();
      return;
    }

    state.heatmapLoading = true;
    state.heatmapDetailLoading = true;
    state.heatmapDetailError = "";
    state.heatmapDetailRows = [];
    state.dataPanelCollapsed = true;
    renderHeatmapDataPanel();
    showStatus("Loading heat map", "loading");
    if (state.heatmapMode === "movement") {
      const movementPayload = await api(`/api/suitepim/floor-plan-inventory-movement?${new URLSearchParams({
        locationId: state.selectedLocationId,
        startDate: state.footfallStartDate,
        endDate: state.footfallEndDate,
        includeRows: "1",
      }).toString()}`).catch((err) => ({ error: err.message, movements: [] }));
      state.heatmapValues = {};
      state.heatmapMax = 0;
      state.movementPaths = movementPayload.movements || [];
      state.heatmapDetailRows = movementPayload.rows || [];
      state.heatmapDetailError = movementPayload.error || "";
      state.heatmapDetailLoading = false;
      state.heatmapLoading = false;
      renderHeatmapDataPanel();
      renderCanvas();
      const loadError = movementPayload.error;
      showStatus(loadError ? `Movement loaded with limited data: ${loadError}` : "Inventory movement loaded", loadError ? "warning" : "success");
      return;
    }

    state.movementPaths = [];
    const heatmapPayload = await api("/api/suitepim/floor-plan-heatmap-values", {
      method: "POST",
      body: JSON.stringify({
        mode: state.heatmapMode,
        locationId: state.selectedLocationId,
        startDate: state.footfallStartDate,
        endDate: state.footfallEndDate,
        assets: assets.map((asset) => ({
          id: asset.id,
          bin: asset.bin,
        })),
      }),
    }).catch((err) => ({ error: err.message, values: {} }));
    const values = heatmapPayload.values || {};

    state.heatmapValues = values;
    state.heatmapMax = Math.max(0, ...Object.values(values).map((value) => Number(value) || 0));
    await loadHeatmapDetailRows();
    state.heatmapLoading = false;
    renderCanvas();
    const loadError = heatmapPayload.error;
    showStatus(loadError ? `Heat map loaded with limited data: ${loadError}` : "Heat map loaded", loadError ? "warning" : "success");
  }

  async function loadHeatmapDetailRows() {
    try {
      if (state.heatmapMode === "sold" || state.heatmapMode === "revenue") {
        const payload = await api(`/api/suitepim/floor-plan-sales-data?${new URLSearchParams({
          locationId: state.selectedLocationId,
          startDate: state.footfallStartDate,
          endDate: state.footfallEndDate,
          includeRows: "1",
        }).toString()}`);
        state.heatmapDetailRows = payload.rows || [];
        state.heatmapDetailError = payload.error || "";
      } else if (state.heatmapMode === "inventory") {
        const data = planData();
        const uniqueBins = [...new Set(data.elements
          .filter((element) => element.type === "asset" && element.bin?.number)
          .map((element) => element.bin.number))];
        const payloads = await mapWithConcurrency(uniqueBins, 6, (bin) => api(`/api/suitepim/floor-plan-bin-inventory?${new URLSearchParams({
          locationId: state.selectedLocationId,
          bin,
        }).toString()}`).catch((err) => ({ error: err.message, rows: [] })));
        state.heatmapDetailRows = payloads.flatMap((payload) => payload.rows || []);
        state.heatmapDetailError = payloads.find((payload) => payload.error)?.error || "";
      }
    } catch (err) {
      state.heatmapDetailRows = [];
      state.heatmapDetailError = err.message || "Unable to load heat map data rows";
    } finally {
      state.heatmapDetailLoading = false;
      renderHeatmapDataPanel();
    }
  }

  async function loadAssetInventory(ids) {
    const selectedIds = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
    const data = planData();
    const locationName = locationNameById();
    const assets = selectedIds
      .map((id) => data.elements.find((element) => element.id === id && element.type === "asset"))
      .filter((asset) => asset?.bin?.number);

    const rangeParams = {
      locationId: state.selectedLocationId,
      startDate: state.footfallStartDate,
      endDate: state.footfallEndDate,
    };
    const [salesPayload, footfallPayload] = await Promise.all([
      api(`/api/suitepim/floor-plan-sales-data?${new URLSearchParams(rangeParams).toString()}`).catch((err) => ({ error: err.message, aggregate: {} })),
      api(`/api/suitepim/footfall?${new URLSearchParams(rangeParams).toString()}`).catch((err) => ({ error: err.message, total: 0 })),
    ]);
    const aggregate = salesPayload.aggregate || {};
    const footfallTotal = Number(footfallPayload.total || 0);

    const groups = [];
    for (const asset of assets) {
      const params = new URLSearchParams({
        locationId: state.selectedLocationId,
        bin: asset.bin.number,
      });
      try {
        const payload = await api(`/api/suitepim/floor-plan-bin-inventory?${params.toString()}`);
        const rows = payload.results || payload.data || payload.inventory || payload.rows || [];
        const countedSalesKeys = new Set();
        groups.push({
          title: asset.bin.number,
          subtitle: [asset.name, asset.bin.location || locationName, asset.bin.zone, `${state.footfallStartDate} to ${state.footfallEndDate}`].filter(Boolean).join(" - "),
          footfallTotal,
          salesError: salesPayload.error || "",
          rows: rows.map((row) => {
            const sales = findSalesForInventoryRow(row, aggregate);
            const alreadyCounted = sales.matchKey && countedSalesKeys.has(sales.matchKey);
            if (sales.matchKey) countedSalesKeys.add(sales.matchKey);
            const sold = alreadyCounted ? 0 : Number(sales.quantity || 0);
            const revenue = alreadyCounted ? 0 : Number(sales.revenue || 0);
            const itemName = inventoryValue(row, ["Display Name", "displayName", "displayname", "DisplayName"]) ||
              sales.displayName ||
              inventoryValue(row, ["Item", "item", "Item Name", "itemName", "Name"]);
            return {
              item: itemName,
              lot: inventoryValue(row, ["Inventory Number", "Lot Number", "lotNumber", "Lot", "Serial/Lot Number"]),
              status: inventoryValue(row, ["Status", "Inventory Status", "inventoryStatus", "status"]),
              onHand: inventoryValue(row, ["On Hand", "onHand", "OnHand", "Quantity On Hand"]),
              sold,
              revenue: money(revenue),
              conversion: footfallTotal > 0 ? percent((sold / footfallTotal) * 100) : "0.0%",
            };
          }),
        });
      } catch (err) {
        groups.push({
          title: asset.bin.number,
          subtitle: [asset.name, asset.bin.location || locationName, asset.bin.zone, `${state.footfallStartDate} to ${state.footfallEndDate}`].filter(Boolean).join(" - "),
          footfallTotal,
          salesError: salesPayload.error || "",
          error: err.message,
          rows: [],
        });
      }
    }
    return groups;
  }

  function assetEditorDocument(primaryAsset, assets) {
    const selected = assets.length ? assets : [primaryAsset].filter(Boolean);
    const first = selected[0] || {};
    const ids = selected.map((asset) => asset.id);
    const canEdit = state.editMode;
    const title = selected.length > 1
      ? `${selected.length} assets selected`
      : (first.bin?.number || first.name || "Asset");
    const subtitle = selected.length > 1
      ? selected.map((asset) => asset.bin?.number || asset.name || "Asset").join(", ")
      : `${first.name || "Asset"} - ${locationNameById()}${first.bin?.zone ? ` - ${first.bin.zone}` : ""}`;
    return `<!doctype html>
      <html>
        <head>
          <title>${clean(title)} - Asset</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; color: #082f49; background: #f3f7fa; font-size: 12px; }
            header { padding: 14px; background: #fff; border-bottom: 1px solid #d7e3ea; }
            h1 { margin: 0 0 4px; font-size: 16px; }
            header p { margin: 0; font-weight: 700; color: #526b7a; }
            .tabs { display: flex; gap: 8px; padding: 10px 14px 0; }
            .tabs button, .actions button { border: 1px solid #0081ab; background: #fff; color: #006d8d; border-radius: 4px; padding: 7px 10px; font-weight: 800; cursor: pointer; }
            .tabs button.active, .actions button.primary { background: #0081ab; color: #fff; }
            main { padding: 12px 14px; }
            [data-panel] { display: none; }
            [data-panel].active { display: block; }
            label { display: grid; gap: 5px; margin-bottom: 12px; font-weight: 900; text-transform: uppercase; font-size: 10px; }
            input[type="color"] { width: 54px; height: 32px; padding: 2px; }
            textarea { min-height: 110px; resize: vertical; border: 1px solid #cbdce6; border-radius: 5px; padding: 8px; }
            table { width: 100%; border-collapse: collapse; background: #fff; }
            th, td { border-bottom: 1px solid #dde8ef; padding: 8px; text-align: left; }
            th { font-size: 10px; text-transform: uppercase; }
            h2 { margin: 16px 0 6px; font-size: 13px; }
            .subtle { margin: 0 0 8px; color: #526b7a; font-weight: 700; }
            .actions { display: flex; gap: 8px; }
            .danger { border-color: #ef4444 !important; color: #b91c1c !important; }
            .message { margin-left: auto; align-self: center; color: #047857; font-weight: 800; }
          </style>
        </head>
        <body>
          <header>
            <h1>${clean(title)}</h1>
            <p>${clean(subtitle)}</p>
          </header>
          <div class="tabs">
            <button type="button" class="active" data-tab="inventory">Inventory</button>
            ${canEdit ? `<button type="button" data-tab="edit">Edit</button>` : ""}
          </div>
          <main>
            <section class="active" data-panel="inventory">
              <div id="inventoryContent">Loading inventory...</div>
            </section>
            ${canEdit ? `<section data-panel="edit">
              <label>Main colour <input id="mainColor" type="color" value="${clean(first.mainColor || "#ffffff")}"></label>
              <label>Text colour <input id="textColor" type="color" value="${clean(first.textColor || "#111518")}"></label>
              <label>Note <textarea id="note">${clean(first.note || "")}</textarea></label>
              <div class="actions">
                <button class="primary" id="apply" type="button">Apply changes</button>
                <button class="danger" id="delete" type="button">Delete asset${selected.length > 1 ? "s" : ""}</button>
                <span class="message" id="message"></span>
              </div>
            </section>` : ""}
          </main>
          <script>
            const selectedAssetIds = ${JSON.stringify(ids)};
            const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;"
            })[char]);
            const renderInventory = (groups) => {
              const content = document.getElementById("inventoryContent");
              if (!groups.length) {
                content.textContent = "No selected assets with bins.";
                return;
              }
              content.innerHTML = groups.map((group) => {
                const salesNote = group.salesError
                  ? " Sales unavailable: " + escapeHtml(group.salesError)
                  : " Footfall: " + escapeHtml(group.footfallTotal || 0);
                const rows = group.rows?.length
                  ? group.rows.map((row) => "<tr><td>" + escapeHtml(row.item) + "</td><td>" + escapeHtml(row.lot) + "</td><td>" + escapeHtml(row.status) + "</td><td>" + escapeHtml(row.onHand) + "</td><td>" + escapeHtml(row.sold) + "</td><td>" + escapeHtml(row.revenue) + "</td><td>" + escapeHtml(row.conversion) + "</td></tr>").join("")
                  : "<tr><td colspan='7'>" + escapeHtml(group.error || "No stock for this bin/location.") + "</td></tr>";
                return "<h2>" + escapeHtml(group.title) + "</h2><p class='subtle'>" + escapeHtml(group.subtitle) + salesNote + "</p><table><thead><tr><th>Item</th><th>Lot Number</th><th>Status</th><th>On Hand</th><th>Sold</th><th>Revenue</th><th>Conversion</th></tr></thead><tbody>" + rows + "</tbody></table>";
              }).join("");
            };
            window.opener?.SuitePimFloorPlans?.loadAssetInventory(selectedAssetIds)
              ?.then(renderInventory)
              ?.catch((err) => {
                document.getElementById("inventoryContent").textContent = err.message || "Unable to load inventory.";
              });
            document.querySelectorAll("[data-tab]").forEach((button) => {
              button.addEventListener("click", () => {
                document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button));
                document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === button.dataset.tab));
              });
            });
            document.getElementById("apply")?.addEventListener("click", () => {
              window.opener?.SuitePimFloorPlans?.updateAssetElements(selectedAssetIds, {
                mainColor: document.getElementById("mainColor")?.value,
                textColor: document.getElementById("textColor")?.value,
                note: document.getElementById("note")?.value
              });
              document.getElementById("message").textContent = selectedAssetIds.length > 1 ? "Assets updated" : "Asset updated";
            });
            document.getElementById("delete")?.addEventListener("click", () => {
              if (!confirm("Delete selected asset" + (selectedAssetIds.length > 1 ? "s" : "") + "?")) return;
              window.opener?.SuitePimFloorPlans?.deleteElements(selectedAssetIds);
              window.close();
            });
          </script>
        </body>
      </html>`;
  }

  function openAssetEditorPopup(primaryAsset, explicitAssets = null) {
    const data = planData();
    const assets = Array.isArray(explicitAssets) && explicitAssets.length
      ? explicitAssets
      : selectedAssetElements();
    const selected = assets.length ? assets : [primaryAsset].filter(Boolean);
    if (!selected.length) return;
    const first = selected[0];
    const popup = window.open("", `suitepim-asset-${first.id}`, "width=900,height=650,menubar=no,toolbar=no,location=no");
    if (!popup) {
      showStatus("Popup blocked. Allow popups for the asset editor.", "error");
      return;
    }
    const hydrated = selected
      .map((asset) => data.elements.find((element) => element.id === asset.id && element.type === "asset") || asset)
      .filter(Boolean);
    popup.document.open();
    popup.document.write(assetEditorDocument(first, hydrated));
    popup.document.close();
    popup.focus();
  }

  async function loadLocations() {
    const path = state.viewOnly ? "/api/suitepim/floor-plan-current-locations" : "/api/meta/locations";
    const data = await api(path, { headers: { "Content-Type": "application/json" } });
    state.locations = (data.locations || []).filter((location) => location.id && location.name);
    state.selectedLocationId = String(state.locations[0]?.id || "");
    renderLocations();
  }

  async function loadPlans(preferredPlanId = "") {
    if (!state.selectedLocationId) {
      state.plans = [];
      state.activePlan = createEmptyPlan(0);
      renderAll();
      showStatus(state.viewOnly ? "No locations have a current floor plan" : "", state.viewOnly ? "warning" : "info");
      return;
    }
    showStatus("Loading floor plans...");
    const data = await api(`/api/suitepim/floor-plans?locationId=${encodeURIComponent(state.selectedLocationId)}`);
    state.plans = data.floorPlans || [];
    const selectedPlan = state.plans.find((plan) => String(plan.id) === String(preferredPlanId)) ||
      state.plans.find((plan) => plan.isCurrent) ||
      state.plans[0];
    state.activePlan = selectedPlan ? JSON.parse(JSON.stringify(selectedPlan)) : createEmptyPlan(state.selectedLocationId, { isCurrent: true });
    state.editMode = state.viewOnly ? false : !state.activePlan.id;
    state.dirty = false;
    resetHistory();
    showStatus("");
    renderAll();
    loadAnalytics();
  }

  async function savePlan() {
    if (!state.activePlan || !state.selectedLocationId) return;
    state.activePlan.name = el.suitepimFloorPlanName?.value.trim() || "Untitled floor plan";
    state.activePlan.isCurrent = el.suitepimFloorPlanCurrent?.checked === true;
    const payload = {
      locationId: Number(state.selectedLocationId),
      name: state.activePlan.name,
      isCurrent: state.activePlan.isCurrent,
      data: planData(),
    };
    showStatus("Saving...");
    const path = state.activePlan.id
      ? `/api/suitepim/floor-plans/${encodeURIComponent(state.activePlan.id)}`
      : "/api/suitepim/floor-plans";
    const method = state.activePlan.id ? "PUT" : "POST";
    const data = await api(path, { method, body: JSON.stringify(payload) });
    state.activePlan = data.floorPlan;
    const savedPlanId = data.floorPlan?.id || "";
    state.editMode = false;
    state.dirty = false;
    resetHistory();
    showStatus("Saved", "success");
    await loadPlans(savedPlanId);
  }

  function bindEvents() {
    el.suitepimFloorPlanLocation.addEventListener("change", async () => {
      state.selectedLocationId = el.suitepimFloorPlanLocation.value;
      state.bins = [];
      state.binsLoadedForLocationId = "";
      state.binSearch = "";
      if (el.suitepimFloorPlanBinSearch) el.suitepimFloorPlanBinSearch.value = "";
      loadFootfall();
      await loadPlans().catch((err) => showStatus(err.message, "error"));
      loadAnalytics();
      if (state.heatmapMode !== "none") loadHeatmapData();
    });

    el.suitepimFloorPlanSidebarToggle?.addEventListener("click", () => {
      const collapsed = el.suitepimFloorPlanSidebar.classList.toggle("is-collapsed");
      el.suitepimFloorPlanSidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      el.suitepimFloorPlanSidebarBody.hidden = collapsed;
    });

    document.querySelectorAll("[data-floorplan-sidebar-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        activateSidebarTab(tab.dataset.floorplanSidebarTab);
      });
    });

    el.suitepimFloorPlanBinSearch?.addEventListener("input", () => {
      state.binSearch = el.suitepimFloorPlanBinSearch.value || "";
      renderBins();
    });

    el.suitepimFloorPlanDateRange?.addEventListener("change", () => {
      state.footfallRangeKey = el.suitepimFloorPlanDateRange.value || "thisMonth";
      syncFootfallDateInputs();
      loadFootfall();
      loadAnalytics();
      if (state.heatmapMode !== "none") loadHeatmapData();
    });

    el.suitepimFloorPlanHeatmap?.addEventListener("change", () => {
      state.heatmapMode = el.suitepimFloorPlanHeatmap.value || "none";
      updateHeatmapControls();
      if (state.heatmapMode === "none") {
        state.heatmapValues = {};
        state.heatmapMax = 0;
        state.movementPaths = [];
        state.heatmapDetailRows = [];
        state.heatmapDetailError = "";
        state.heatmapDetailLoading = false;
        renderHeatmapDataPanel();
        renderCanvas();
        showStatus("");
        return;
      }
      loadHeatmapData();
    });

    el.suitepimFloorPlanHeatmapScope?.addEventListener("change", () => {
      state.heatmapScope = el.suitepimFloorPlanHeatmapScope.value || "bin";
      if (state.heatmapMode === "movement") return;
      updateHeatmapMax();
      renderCanvas();
    });

    el.suitepimFloorPlanDataPanelToggle?.addEventListener("click", () => {
      setDataPanelCollapsed(!state.dataPanelCollapsed);
    });

    document.querySelectorAll(".suitepim-floorplan-dark-mode-toggle").forEach((toggle) => {
      toggle.addEventListener("change", () => {
        const mode = toggle.checked ? "dark" : "light";
        localStorage.setItem(THEME_STORAGE_KEY, mode);
        applyFloorPlanTheme(mode);
      });
    });

    [el.suitepimFloorPlanStartDate, el.suitepimFloorPlanEndDate].forEach((input) => {
      input?.addEventListener("change", () => {
        state.footfallRangeKey = "custom";
        state.footfallStartDate = el.suitepimFloorPlanStartDate.value;
        state.footfallEndDate = el.suitepimFloorPlanEndDate.value;
        syncFootfallDateInputs();
        loadFootfall();
        loadAnalytics();
        if (state.heatmapMode !== "none") loadHeatmapData();
      });
    });

    el.suitepimFloorPlanNew?.addEventListener("click", () => {
      if (state.viewOnly) return;
      state.activePlan = createEmptyPlan(state.selectedLocationId, { isCurrent: !state.plans.length });
      state.editMode = true;
      state.dirty = true;
      resetHistory();
      showStatus("New floor plan");
      renderAll();
    });

    el.suitepimFloorPlanEdit?.addEventListener("click", () => {
      if (state.viewOnly) return;
      state.editMode = true;
      updateEditControls();
      showStatus("Editing");
    });

    el.suitepimFloorPlanSave?.addEventListener("click", () => {
      savePlan().catch((err) => showStatus(err.message, "error"));
    });

    el.suitepimFloorPlanName?.addEventListener("input", setDirty);
    el.suitepimFloorPlanCurrent?.addEventListener("change", () => {
      if (!state.activePlan) return;
      state.activePlan.isCurrent = el.suitepimFloorPlanCurrent.checked;
      setDirty();
      renderPlanList();
    });
    el.suitepimFloorPlanLockGrid?.addEventListener("change", () => {
      state.lockGrid = el.suitepimFloorPlanLockGrid.checked;
    });
    el.suitepimFloorPlanZoomOut?.addEventListener("click", () => setZoom(state.zoom - 0.15));
    el.suitepimFloorPlanZoomIn?.addEventListener("click", () => setZoom(state.zoom + 0.15));

    el.suitepimFloorPlanRotateLeft?.addEventListener("click", () => rotateSelectedAsset(-45));
    el.suitepimFloorPlanRotateRight?.addEventListener("click", () => rotateSelectedAsset(45));
    el.suitepimFloorPlanAssetEdit?.addEventListener("click", () => {
      const selectedIds = (el.suitepimFloorPlanAssetEdit.dataset.selectedAssets || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const data = planData();
      const selectedAssets = selectedIds
        .map((id) => data.elements.find((element) => element.id === id && element.type === "asset"))
        .filter(Boolean);
      const primary = selectedAssets[0] || data.elements.find((element) => element.id === state.selectedElementId && element.type === "asset");
      openAssetEditorPopup(primary, selectedAssets);
    });

    document.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      const floorPlansPanel = document.getElementById("suitepimFloorPlansPanel");
      if (!floorPlansPanel || floorPlansPanel.hidden) return;
      if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;

      // Undo/Redo shortcuts
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(key)) {
        event.preventDefault();
        if (key === "z" && event.shiftKey) redo();
        else if (key === "z") undo();
        else redo();
        return;
      }

      if (state.editMode && ["delete", "backspace"].includes(key)) {
        const selectedIds = state.selectedAssetIds.size
          ? Array.from(state.selectedAssetIds)
          : [state.selectedElementId].filter(Boolean);
        if (selectedIds.length) {
          event.preventDefault();
          deleteElements(selectedIds);
        }
        return;
      }

      // Asset rotation shortcuts - arrow keys
      if (!state.editMode || !state.selectedElementId) return;
      const data = planData();
      const element = data.elements.find((el) => el.id === state.selectedElementId && el.type === "asset");
      if (!element) return;

      if (["arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        pushHistory();
        const rotation = Number(element.rotation) || 0;
        const increment = key === "arrowright" ? 45 : -45;
        element.rotation = (rotation + increment) % 360;
        if (element.rotation < 0) element.rotation += 360;
        setPlanData(data);
        setDirty();
        renderCanvas();
        showStatus(`Rotated to ${element.rotation}°`, "info");
      }
    });

    document.querySelectorAll("[data-floorplan-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        state.tool = button.dataset.floorplanTool || "line";
        document.querySelectorAll("[data-floorplan-tool]").forEach((item) => {
          item.classList.toggle("active", item === button);
        });
      });
    });

    el.suitepimFloorPlanCanvas.addEventListener("pointerdown", (event) => {
      if (startHighlightSelection(event)) return;
      if (!state.editMode) {
        const asset = assetAtPoint(canvasPoint(event));
        if (asset?.bin?.number) {
          event.preventDefault();
          selectAsset(asset.id);
          renderCanvas();
          openAssetEditorPopup(asset, [asset]);
          return;
        }
      }
      if (startViewportPan(event)) return;
      if (startAssetMove(event)) return;
      startDrawing(event);
    });
    el.suitepimFloorPlanCanvas.addEventListener("pointermove", (event) => {
      if (updateHighlightSelection(event)) return;
      if (updateViewportPan(event)) return;
      if (updateAssetMove(event)) return;
      updateDrawing(event);
    });
    el.suitepimFloorPlanCanvasWrap?.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = el.suitepimFloorPlanCanvasWrap.getBoundingClientRect();
      const delta = event.deltaY > 0 ? -0.08 : 0.08;
      zoomAtPoint(state.zoom + delta, event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    el.suitepimFloorPlanCanvas.addEventListener("dragover", (event) => {
      if (!state.editMode) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    el.suitepimFloorPlanCanvas.addEventListener("drop", (event) => {
      event.preventDefault();
      const binId = event.dataTransfer.getData("application/x-suitepim-bin");
      const textPayload = event.dataTransfer.getData("text/plain") || "";
      if (binId || textPayload.startsWith("bin:")) {
        attachBinToAsset(binId || textPayload.slice(4), event);
        return;
      }
      addAssetToPlan(textPayload, event);
    });
    window.addEventListener("pointerup", () => {
      if (finishHighlightSelection()) return;
      if (finishViewportPan()) return;
      if (finishAssetMove()) return;
      finishDrawing();
    });
  }

  async function init() {
    initEls();
    if (!el.suitepimFloorPlanCanvas) return;
    state.viewOnly = document.getElementById("suitepimFloorPlanApp")?.dataset.floorplanViewOnly === "true";
    if (state.viewOnly) state.editMode = false;
    applyFloorPlanTheme(localStorage.getItem(THEME_STORAGE_KEY) || "light");
    bindEvents();
    updateEditControls();
    updateHeatmapControls();
    updateZoomLabel();
    syncFootfallDateInputs();
    await loadLocations();
    await loadFootfall();
    await loadPlans();
  }

  window.SuitePimFloorPlans = {
    updateAssetElements,
    updateAssetElement: (id, updates) => updateAssetElements([id], updates),
    loadAssetInventory,
    deleteElements,
    deleteElement: (id) => deleteElements([id]),
  };

  window.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => showStatus(err.message, "error"));
  });
})();
