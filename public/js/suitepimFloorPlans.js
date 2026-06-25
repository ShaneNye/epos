(function () {
  const METERS_WIDE = 100;
  const METERS_HIGH = 70;
  const PX_PER_METER = 24;
  const ASSETS = [
    { key: "single-bed", name: "Single bed", width: 0.9, height: 1.9 },
    { key: "double-bed", name: "Double bed", width: 1.35, height: 1.9 },
    { key: "king-bed", name: "King bed", width: 1.5, height: 2 },
    { key: "super-king-bed", name: "Super king bed", width: 1.8, height: 2 },
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
    zoom: 1,
    undoStack: [],
    redoStack: [],
    dirty: false,
  };

  const el = {};

  function initEls() {
    [
      "suitepimFloorPlanLocation",
      "suitepimFloorPlanStatus",
      "suitepimFloorPlanEdit",
      "suitepimFloorPlanSave",
      "suitepimFloorPlanSidebar",
      "suitepimFloorPlanSidebarToggle",
      "suitepimFloorPlanSidebarBody",
      "suitepimFloorPlanNew",
      "suitepimFloorPlanList",
      "suitepimFloorPlanAssets",
      "suitepimFloorPlanName",
      "suitepimFloorPlanLockGrid",
      "suitepimFloorPlanZoomOut",
      "suitepimFloorPlanZoomIn",
      "suitepimFloorPlanZoomLabel",
      "suitepimFloorPlanCanvasWrap",
      "suitepimFloorPlanCanvas",
      "suitepimFloorPlanRotationControls",
      "suitepimFloorPlanRotateLeft",
      "suitepimFloorPlanRotateRight",
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
    el.suitepimFloorPlanStatus.textContent = message || "";
    el.suitepimFloorPlanStatus.dataset.type = type;
  }

  function clean(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function createEmptyPlan(locationId) {
    return {
      id: null,
      locationId: Number(locationId),
      name: "Untitled floor plan",
      data: {
        widthMeters: METERS_WIDE,
        heightMeters: METERS_HIGH,
        elements: [],
      },
    };
  }

  function updateEditControls() {
    if (!el.suitepimFloorPlanEdit || !el.suitepimFloorPlanSave || !el.suitepimFloorPlanName) return;
    el.suitepimFloorPlanEdit.hidden = state.editMode;
    el.suitepimFloorPlanSave.hidden = !state.editMode;
    el.suitepimFloorPlanName.disabled = !state.editMode;
    el.suitepimFloorPlanCanvas.classList.toggle("is-editing", state.editMode);
    document.querySelectorAll("[data-floorplan-tool], #suitepimFloorPlanLockGrid").forEach((control) => {
      control.disabled = !state.editMode;
    });
  }

  function updateRotationControls() {
    if (!el.suitepimFloorPlanRotationControls) return;
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
    if (!state.plans.length) {
      el.suitepimFloorPlanList.innerHTML = `<div class="suitepim-floorplan-empty">No floor plans saved for this location.</div>`;
      return;
    }

    el.suitepimFloorPlanList.innerHTML = state.plans
      .map((plan) => `
        <button type="button" class="${state.activePlan?.id === plan.id ? "active" : ""}" data-floorplan-id="${clean(plan.id)}">
          <strong>${clean(plan.name)}</strong>
          <small>${plan.updatedAt ? new Date(plan.updatedAt).toLocaleDateString("en-GB") : "Unsaved"}</small>
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
        resetHistory();
        renderAll();
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
    const selected = state.selectedElementId === element.id;
    const rotation = Number(element.rotation) || 0;
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    const rotationTransform = rotation !== 0 ? ` rotate(${rotation} ${centerX.toFixed(2)} ${centerY.toFixed(2)})` : "";
    return `
      <g class="suitepim-floorplan-placed-asset${selected ? " is-selected" : ""}" data-element-id="${clean(element.id)}"${rotationTransform ? ` transform="${rotationTransform}"` : ""}>
        <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.5" />
        <line x1="${(x + 4).toFixed(2)}" y1="${(y + 4).toFixed(2)}" x2="${(x + w - 4).toFixed(2)}" y2="${(y + 4).toFixed(2)}" />
        <line x1="${(x + 4).toFixed(2)}" y1="${(y + h / 2).toFixed(2)}" x2="${(x + w - 4).toFixed(2)}" y2="${(y + h / 2).toFixed(2)}" />
        <text x="${(x + w / 2).toFixed(2)}" y="${(y + h / 2 + 3).toFixed(2)}">${clean(label)}</text>
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

  function renderCanvas() {
    if (!el.suitepimFloorPlanCanvas) return;
    const data = planData();
    const widthPx = data.widthMeters * PX_PER_METER;
    const heightPx = data.heightMeters * PX_PER_METER;
    const elements = data.elements.map((element) => elementMarkup(element)).join("");
    const draft = state.draft ? elementMarkup(state.draft, true) : "";

    el.suitepimFloorPlanCanvas.setAttribute("viewBox", `0 0 ${widthPx} ${heightPx}`);
    el.suitepimFloorPlanCanvas.style.width = `${widthPx * state.zoom}px`;
    el.suitepimFloorPlanCanvas.style.height = `${heightPx * state.zoom}px`;
    el.suitepimFloorPlanCanvas.innerHTML = `
      <rect class="suitepim-floorplan-bg" x="0" y="0" width="${widthPx}" height="${heightPx}"></rect>
      ${gridMarkup(data.widthMeters, data.heightMeters)}
      <g class="suitepim-floorplan-elements">${elements}${draft}</g>
    `;
    updateRotationControls();
  }

  function renderActivePlan() {
    const active = state.activePlan || createEmptyPlan(state.selectedLocationId || state.locations[0]?.id || 0);
    state.activePlan = active;
    el.suitepimFloorPlanName.value = active.name || "Untitled floor plan";
    renderCanvas();
    updateEditControls();
    updateRotationControls();
  }

  function renderAll() {
    renderLocations();
    renderPlanList();
    renderAssets();
    renderActivePlan();
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
    state.zoom = Math.min(3, Math.max(0.35, Math.round(nextZoom * 100) / 100));
    updateZoomLabel();
    renderCanvas();
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
      rotation: 0,
    });
    setPlanData(data);
    state.selectedElementId = data.elements[data.elements.length - 1].id;
    setDirty();
    renderCanvas();
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
      renderCanvas();
      return false;
    }

    event.preventDefault();
    state.selectedElementId = asset.id;
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

  async function loadLocations() {
    const data = await api("/api/meta/locations", { headers: { "Content-Type": "application/json" } });
    state.locations = (data.locations || []).filter((location) => location.id && location.name);
    state.selectedLocationId = String(state.locations[0]?.id || "");
    renderLocations();
  }

  async function loadPlans() {
    if (!state.selectedLocationId) return;
    showStatus("Loading floor plans...");
    const data = await api(`/api/suitepim/floor-plans?locationId=${encodeURIComponent(state.selectedLocationId)}`);
    state.plans = data.floorPlans || [];
    state.activePlan = state.plans[0] ? JSON.parse(JSON.stringify(state.plans[0])) : createEmptyPlan(state.selectedLocationId);
    state.editMode = !state.activePlan.id;
    state.dirty = false;
    resetHistory();
    showStatus("");
    renderAll();
  }

  async function savePlan() {
    if (!state.activePlan || !state.selectedLocationId) return;
    state.activePlan.name = el.suitepimFloorPlanName.value.trim() || "Untitled floor plan";
    const payload = {
      locationId: Number(state.selectedLocationId),
      name: state.activePlan.name,
      data: planData(),
    };
    showStatus("Saving...");
    const path = state.activePlan.id
      ? `/api/suitepim/floor-plans/${encodeURIComponent(state.activePlan.id)}`
      : "/api/suitepim/floor-plans";
    const method = state.activePlan.id ? "PUT" : "POST";
    const data = await api(path, { method, body: JSON.stringify(payload) });
    state.activePlan = data.floorPlan;
    state.editMode = false;
    state.dirty = false;
    resetHistory();
    showStatus("Saved", "success");
    await loadPlans();
  }

  function bindEvents() {
    el.suitepimFloorPlanLocation.addEventListener("change", async () => {
      state.selectedLocationId = el.suitepimFloorPlanLocation.value;
      await loadPlans().catch((err) => showStatus(err.message, "error"));
    });

    el.suitepimFloorPlanSidebarToggle.addEventListener("click", () => {
      const collapsed = el.suitepimFloorPlanSidebar.classList.toggle("is-collapsed");
      el.suitepimFloorPlanSidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      el.suitepimFloorPlanSidebarBody.hidden = collapsed;
    });

    document.querySelectorAll("[data-floorplan-sidebar-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.floorplanSidebarTab;
        document.querySelectorAll("[data-floorplan-sidebar-tab]").forEach((button) => {
          const active = button === tab;
          button.classList.toggle("active", active);
          button.setAttribute("aria-selected", String(active));
        });
        document.querySelectorAll("[data-floorplan-sidebar-panel]").forEach((panel) => {
          panel.hidden = panel.dataset.floorplanSidebarPanel !== target;
        });
      });
    });

    el.suitepimFloorPlanNew.addEventListener("click", () => {
      state.activePlan = createEmptyPlan(state.selectedLocationId);
      state.editMode = true;
      state.dirty = true;
      resetHistory();
      showStatus("New floor plan");
      renderAll();
    });

    el.suitepimFloorPlanEdit.addEventListener("click", () => {
      state.editMode = true;
      updateEditControls();
      showStatus("Editing");
    });

    el.suitepimFloorPlanSave.addEventListener("click", () => {
      savePlan().catch((err) => showStatus(err.message, "error"));
    });

    el.suitepimFloorPlanName.addEventListener("input", setDirty);
    el.suitepimFloorPlanLockGrid.addEventListener("change", () => {
      state.lockGrid = el.suitepimFloorPlanLockGrid.checked;
    });
    el.suitepimFloorPlanZoomOut?.addEventListener("click", () => setZoom(state.zoom - 0.15));
    el.suitepimFloorPlanZoomIn?.addEventListener("click", () => setZoom(state.zoom + 0.15));

    el.suitepimFloorPlanRotateLeft?.addEventListener("click", () => rotateSelectedAsset(-90));
    el.suitepimFloorPlanRotateRight?.addEventListener("click", () => rotateSelectedAsset(90));

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

      // Asset rotation shortcuts - arrow keys
      if (!state.editMode || !state.selectedElementId) return;
      const data = planData();
      const element = data.elements.find((el) => el.id === state.selectedElementId && el.type === "asset");
      if (!element) return;

      if (["arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        pushHistory();
        const rotation = Number(element.rotation) || 0;
        const increment = key === "arrowright" ? 90 : -90;
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
      if (startAssetMove(event)) return;
      startDrawing(event);
    });
    el.suitepimFloorPlanCanvas.addEventListener("pointermove", (event) => {
      if (updateAssetMove(event)) return;
      updateDrawing(event);
    });
    el.suitepimFloorPlanCanvas.addEventListener("dragover", (event) => {
      if (!state.editMode) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
    el.suitepimFloorPlanCanvas.addEventListener("drop", (event) => {
      event.preventDefault();
      addAssetToPlan(event.dataTransfer.getData("text/plain"), event);
    });
    window.addEventListener("pointerup", () => {
      if (finishAssetMove()) return;
      finishDrawing();
    });
  }

  async function init() {
    initEls();
    if (!el.suitepimFloorPlanCanvas) return;
    bindEvents();
    updateEditControls();
    updateZoomLabel();
    await loadLocations();
    await loadPlans();
  }

  window.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => showStatus(err.message, "error"));
  });
})();
