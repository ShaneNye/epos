document.addEventListener("DOMContentLoaded", () => {
  const NODE_WIDTH = 210;
  const NODE_HEIGHT = 88;
  const MIN_SURFACE_WIDTH = 1600;
  const MIN_SURFACE_HEIGHT = 1000;

  const state = {
    workflows: [],
    statuses: [],
    records: [],
    selectedRecordId: "",
    selectedRecordFieldId: "",
    expandedRecordId: "",
    expandedSublistId: "",
    currentId: "",
    nodes: [],
    edges: [],
    selectedNodeId: "",
    selectedEdgeId: "",
    drag: null,
    portDrag: null,
    pathPreview: null,
    pan: null,
    suppressClick: false,
    undo: [],
    redo: [],
    zoom: 1,
    surfaceWidth: MIN_SURFACE_WIDTH,
    surfaceHeight: MIN_SURFACE_HEIGHT,
    settings: {
      executionMode: "actionMessageOnly",
      pathwayDebug: false,
    },
    criteria: [],
    debug: null,
    debugTimer: null,
  };

  const el = {
    select: document.getElementById("workflowSelect"),
    name: document.getElementById("workflowName"),
    description: document.getElementById("workflowDescription"),
    criteriaRules: document.getElementById("workflowCriteriaRules"),
    executionMode: document.getElementById("workflowExecutionMode"),
    pathwayDebug: document.getElementById("workflowPathwayDebug"),
    canvas: document.getElementById("workflowCanvas"),
    workflowShell: document.querySelector(".workflow-shell[data-workflow-panel='builder']"),
    workflowSidebarToggle: document.getElementById("workflowSidebarToggle"),
    workflowSidebarExpandToggle: document.getElementById("workflowSidebarExpandToggle"),
    deleteWorkflow: document.getElementById("deleteWorkflowBtn"),
    deleteWorkflowConfirm: document.getElementById("deleteWorkflowConfirm"),
    cancelDeleteWorkflow: document.getElementById("cancelDeleteWorkflowBtn"),
    confirmDeleteWorkflow: document.getElementById("confirmDeleteWorkflowBtn"),
    surface: document.getElementById("workflowSurface"),
    edges: document.getElementById("workflowEdges"),
    zoomLabel: document.getElementById("workflowZoomLabel"),
    darkModeToggles: Array.from(document.querySelectorAll(".workflow-dark-mode-toggle")),
    status: document.getElementById("workflowStatus"),
    undo: document.getElementById("undoWorkflowBtn"),
    redo: document.getElementById("redoWorkflowBtn"),
    refresh: document.getElementById("refreshWorkflowsBtn"),
    refreshRecords: document.getElementById("refreshWorkflowRecordsBtn"),
    existingList: document.getElementById("existingWorkflowsList"),
    recordsList: document.getElementById("workflowRecordsList"),
    recordForm: document.getElementById("workflowRecordForm"),
    recordId: document.getElementById("workflowRecordId"),
    recordLabel: document.getElementById("workflowRecordLabel"),
    recordInternalId: document.getElementById("workflowRecordInternalId"),
    newRecord: document.getElementById("newWorkflowRecordBtn"),
    addRecordInline: document.getElementById("addWorkflowRecordInlineBtn"),
    deleteRecord: document.getElementById("deleteWorkflowRecordBtn"),
    fieldForm: document.getElementById("workflowRecordFieldForm"),
    fieldId: document.getElementById("workflowRecordFieldId"),
    fieldLabel: document.getElementById("workflowRecordFieldLabel"),
    fieldInternalId: document.getElementById("workflowRecordFieldInternalId"),
    fieldType: document.getElementById("workflowRecordFieldType"),
    fieldSortOrder: document.getElementById("workflowRecordFieldSortOrder"),
    fieldListQuery: document.getElementById("workflowRecordFieldListQuery"),
    fieldSuiteQlBtn: document.getElementById("workflowRecordFieldSuiteQlBtn"),
    fieldSuiteQlState: document.getElementById("workflowRecordFieldSuiteQlState"),
    suiteQlDialog: document.getElementById("workflowSuiteQlDialog"),
    suiteQlEditor: document.getElementById("workflowSuiteQlEditor"),
    suiteQlClose: document.getElementById("closeWorkflowSuiteQlBtn"),
    suiteQlCancel: document.getElementById("cancelWorkflowSuiteQlBtn"),
    suiteQlSave: document.getElementById("saveWorkflowSuiteQlBtn"),
    fieldContext: document.getElementById("workflowRecordFieldContext"),
    fieldsList: document.getElementById("workflowRecordFieldsList"),
    sublistsList: document.getElementById("workflowRecordSublistsList"),
    newField: document.getElementById("newWorkflowRecordFieldBtn"),
    addSublist: document.getElementById("addWorkflowSublistBtn"),
    deleteField: document.getElementById("deleteWorkflowRecordFieldBtn"),
    navTab: document.getElementById("csWorkflowNavTab"),
    navClose: document.getElementById("csWorkflowNavClose"),
    navLinks: Array.from(document.querySelectorAll("[data-workflow-view]")),
    panels: Array.from(document.querySelectorAll("[data-workflow-panel]")),
    builderTabs: Array.from(document.querySelectorAll("[data-builder-tab]")),
    builderPanels: Array.from(document.querySelectorAll("[data-builder-panel]")),
    hint: document.getElementById("connectHint"),
    props: document.getElementById("nodeProperties"),
    emptyProps: document.getElementById("emptyProperties"),
    nodeLabel: document.getElementById("nodeLabel"),
    nodeQuestionLabel: document.getElementById("nodeQuestionLabel"),
    nodeQuestion: document.getElementById("nodeQuestion"),
    nodeActionMessage: document.getElementById("nodeActionMessage"),
    actionConfigWrap: document.getElementById("actionConfigWrap"),
    actionType: document.getElementById("actionTypeSelect"),
    actionMandatory: document.getElementById("actionMandatoryCheckbox"),
    itemLineItemWrap: document.getElementById("itemLineItemWrap"),
    itemLineItem: document.getElementById("itemLineItemSelect"),
    itemLineInputWrap: document.getElementById("itemLineInputWrap"),
    itemLineInput: document.getElementById("itemLineInputSelect"),
    itemLineSourceWrap: document.getElementById("itemLineSourceWrap"),
    itemLineSource: document.getElementById("itemLineSourceSelect"),
    itemLineMapWrap: document.getElementById("itemLineMapWrap"),
    itemLineMapButton: document.getElementById("addItemLineMappingBtn"),
    itemLineMappings: document.getElementById("itemLineMappingsList"),
    createRecordTargetWrap: document.getElementById("createRecordTargetWrap"),
    createRecordTarget: document.getElementById("createRecordTargetSelect"),
    createRecordMapWrap: document.getElementById("createRecordMapWrap"),
    createRecordMapButton: document.getElementById("openCreateRecordMapBtn"),
    startStatusWrap: document.getElementById("startStatusWrap"),
    startCaseStatus: document.getElementById("startCaseStatus"),
    inputConfigWrap: document.getElementById("inputConfigWrap"),
    inputType: document.getElementById("inputTypeSelect"),
    inputListSourceWrap: document.getElementById("inputListSourceWrap"),
    inputListSource: document.getElementById("inputListSourceSelect"),
    inputListFieldWrap: document.getElementById("inputListFieldWrap"),
    inputListField: document.getElementById("inputListFieldSelect"),
    addInputField: document.getElementById("addInputFieldBtn"),
    inputFieldsList: document.getElementById("inputFieldsList"),
    questionWrap: document.getElementById("questionTextWrap"),
    actionWrap: document.getElementById("actionMessageWrap"),
    checkWrap: document.getElementById("checkConfigWrap"),
    checkRecordType: document.getElementById("checkRecordType"),
    checkInputSourceWrap: document.getElementById("checkInputSourceWrap"),
    checkInputSource: document.getElementById("checkInputSource"),
    affectedItemSourceWrap: document.getElementById("affectedItemSourceWrap"),
    checkAffectedItemSource: document.getElementById("checkAffectedItemSource"),
    checkRules: document.getElementById("checkRules"),
    responseWrap: document.getElementById("responseOptionsWrap"),
    responseOptions: document.getElementById("responseOptions"),
    pathRulesWrap: document.getElementById("pathRulesWrap"),
    pathRules: document.getElementById("pathRules"),
    suiteQlStudioQuery: document.getElementById("suiteQlStudioQuery"),
    suiteQlStudioRun: document.getElementById("runSuiteQlStudioBtn"),
    suiteQlStudioMeta: document.getElementById("suiteQlStudioMeta"),
    suiteQlStudioOutput: document.getElementById("suiteQlStudioOutput"),
    suiteQlStudioTable: document.getElementById("suiteQlStudioTable"),
    suiteQlStudioDialog: document.getElementById("suiteQlStudioDialog"),
    suiteQlStudioOpen: document.getElementById("openSuiteQlStudioBtn"),
    suiteQlStudioClose: document.getElementById("closeSuiteQlStudioBtn"),
  };

  function authHeaders(extra = {}) {
    const saved = typeof storageGet === "function" ? storageGet() : null;
    const token = saved?.token || "";
    return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  function uid(prefix = "node") {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  function setStatus(message) {
    el.status.textContent = message || "";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setZoom(nextZoom) {
    state.zoom = clamp(nextZoom, 0.2, 1.8);
    applySurfaceSize();
    if (el.zoomLabel) el.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function applySurfaceSize() {
    if (el.surface) {
      el.surface.style.transform = `scale(${state.zoom})`;
      el.surface.style.width = `${state.surfaceWidth * state.zoom}px`;
      el.surface.style.height = `${state.surfaceHeight * state.zoom}px`;
    }
    if (el.edges) {
      el.edges.setAttribute("width", String(state.surfaceWidth));
      el.edges.setAttribute("height", String(state.surfaceHeight));
      el.edges.style.width = `${state.surfaceWidth}px`;
      el.edges.style.height = `${state.surfaceHeight}px`;
    }
  }

  function updateSurfaceBounds() {
    const maxNodeX = state.nodes.reduce((max, node) => Math.max(max, Number(node.x || 0) + NODE_WIDTH + 520), MIN_SURFACE_WIDTH);
    const maxNodeY = state.nodes.reduce((max, node) => Math.max(max, Number(node.y || 0) + NODE_HEIGHT + 420), MIN_SURFACE_HEIGHT);
    state.surfaceWidth = Math.max(MIN_SURFACE_WIDTH, Math.ceil(maxNodeX / 200) * 200);
    state.surfaceHeight = Math.max(MIN_SURFACE_HEIGHT, Math.ceil(maxNodeY / 200) * 200);
    applySurfaceSize();
  }

  function workflowBounds() {
    if (!state.nodes.length) return null;
    const xs = state.nodes.map((node) => Number(node.x || 0));
    const ys = state.nodes.map((node) => Number(node.y || 0));
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs.map((x) => x + NODE_WIDTH));
    const maxY = Math.max(...ys.map((y) => y + NODE_HEIGHT));
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function fitWorkflowToView() {
    const bounds = workflowBounds();
    if (!bounds || !el.canvas) return;
    updateSurfaceBounds();
    const padding = 90;
    const availableWidth = Math.max(240, el.canvas.clientWidth - 24);
    const availableHeight = Math.max(240, el.canvas.clientHeight - 24);
    const zoom = Math.min(
      1,
      availableWidth / Math.max(1, bounds.width + padding * 2),
      availableHeight / Math.max(1, bounds.height + padding * 2)
    );
    setZoom(zoom);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    el.canvas.scrollLeft = Math.max(0, centerX * state.zoom - el.canvas.clientWidth / 2);
    el.canvas.scrollTop = Math.max(0, centerY * state.zoom - el.canvas.clientHeight / 2);
  }

  function setNavOpen(open) {
    document.body.classList.toggle("cs-workflow-nav-open", open);
    el.navTab?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function showWorkflowView(view) {
    el.panels.forEach((panel) => {
      panel.hidden = panel.dataset.workflowPanel !== view;
    });
    el.navLinks.forEach((link) => {
      link.classList.toggle("active", link.dataset.workflowView === view);
    });
  }

  function activeBuilderTab() {
    return el.builderTabs.find((tab) => tab.classList.contains("active"))?.dataset.builderTab || "workflow";
  }

  function setBuilderTab(tabName) {
    const nextTab = tabName || "workflow";
    el.builderTabs.forEach((tab) => {
      const active = tab.dataset.builderTab === nextTab;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    el.builderPanels.forEach((panel) => {
      panel.hidden = panel.dataset.builderPanel !== nextTab;
    });
  }

  function switchToNodePropertiesFromWorkflowTab() {
    if (activeBuilderTab() === "workflow") setBuilderTab("nodeProperties");
  }

  function selectedNode() {
    return state.nodes.find((node) => node.id === state.selectedNodeId) || null;
  }

  function selectedEdge() {
    return state.edges.find((edge) => edge.id === state.selectedEdgeId) || null;
  }

  function snapshot() {
    return JSON.stringify({
      nodes: state.nodes,
      edges: state.edges,
      selectedNodeId: state.selectedNodeId,
      selectedEdgeId: state.selectedEdgeId,
      settings: state.settings,
      criteria: state.criteria,
    });
  }

  function restoreSnapshot(value) {
    if (!value) return;
    const next = JSON.parse(value);
    state.nodes = Array.isArray(next.nodes) ? next.nodes : [];
    state.edges = Array.isArray(next.edges) ? next.edges : [];
    state.selectedNodeId = next.selectedNodeId || "";
    state.selectedEdgeId = next.selectedEdgeId || "";
    state.settings = normaliseWorkflowSettings(next.settings);
    state.criteria = normaliseWorkflowCriteria(next.criteria);
    renderWorkflowSettings();
    renderWorkflowCriteria();
    render();
    updateHistoryButtons();
  }

  function pushHistory(before = snapshot()) {
    if (before === snapshot()) return;
    state.undo.push(before);
    if (state.undo.length > 80) state.undo.shift();
    state.redo = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (el.undo) el.undo.disabled = state.undo.length === 0;
    if (el.redo) el.redo.disabled = state.redo.length === 0;
  }

  function undoWorkflow() {
    const previous = state.undo.pop();
    if (!previous) return;
    state.redo.push(snapshot());
    restoreSnapshot(previous);
    setStatus("Undone.");
  }

  function redoWorkflow() {
    const next = state.redo.pop();
    if (!next) return;
    state.undo.push(snapshot());
    restoreSnapshot(next);
    setStatus("Redone.");
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/cs-workflows${path}`, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  }

  function applyWorkflowTheme(mode) {
    const isDark = mode === "dark";
    document.body.classList.toggle("cs-workflow-dark", isDark);
    el.darkModeToggles.forEach((toggle) => { toggle.checked = isDark; });
  }

  applyWorkflowTheme(localStorage.getItem("csWorkflowTheme") || "light");

  function renderWorkflowSelect() {
    el.select.innerHTML = '<option value="">New workflow</option>' + state.workflows
      .map((workflow) => `<option value="${workflow.id}">${escapeHtml(workflow.name)}</option>`)
      .join("");
    el.select.value = state.currentId || "";
  }

  function workflowStats(workflow = {}) {
    const definition = workflow.definition || {};
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
    const edges = Array.isArray(definition.edges) ? definition.edges : [];
    const questions = nodes.filter((node) => node.type === "question" || node.type === "input").length;
    const actions = nodes.filter((node) => node.type === "action").length;
    const framework = nodes.filter((node) => ["check", "break", "closeCase"].includes(node.type)).length;
    return `${questions} prompt${questions === 1 ? "" : "s"} - ${actions} action${actions === 1 ? "" : "s"} - ${framework} framework - ${edges.length} path${edges.length === 1 ? "" : "s"}`;
  }
  function renderExistingWorkflows() {
    if (!el.existingList) return;
    if (!state.workflows.length) {
      el.existingList.innerHTML = '<p class="workflow-status">No workflows have been saved yet.</p>';
      return;
    }

    el.existingList.innerHTML = state.workflows.map((workflow) => `
      <article class="existing-workflow-row${String(workflow.id) === String(state.currentId) ? " active" : ""}">
        <div class="existing-workflow-title">
          <strong>${escapeHtml(workflow.name || "Untitled workflow")}</strong>
          <span>${escapeHtml(workflow.description || "No description")}</span>
        </div>
        <div class="existing-workflow-meta">${escapeHtml(workflowStats(workflow))}</div>
        <button type="button" class="btn-secondary" data-edit-workflow="${escapeHtml(workflow.id)}">Edit</button>
      </article>
    `).join("");
  }

  function selectedRecord() {
    return state.records.find((record) => String(record.id) === String(state.selectedRecordId)) || null;
  }

  function selectedRecordField() {
    const record = selectedRecord();
    return (record?.fields || []).find((field) => String(field.id) === String(state.selectedRecordFieldId)) || null;
  }

  function fieldUsesListQuery(fieldType = "") {
    const clean = String(fieldType || "").trim().toLowerCase();
    return clean === "list/record" || clean === "multiple select";
  }

  function updateFieldSuiteQlControls() {
    const querySet = !!String(el.fieldListQuery?.value || "").trim();
    const queryApplies = fieldUsesListQuery(el.fieldType?.value);
    if (el.fieldSuiteQlBtn) el.fieldSuiteQlBtn.disabled = !selectedRecord() || !queryApplies;
    if (el.fieldSuiteQlState) {
      el.fieldSuiteQlState.textContent = queryApplies ? (querySet ? "Query set" : "Not set") : "Not applicable";
      el.fieldSuiteQlState.classList.toggle("is-set", querySet && queryApplies);
    }
  }

  function renderRecordManagement() {
    if (!el.recordsList) return;
    const record = selectedRecord();
    const field = selectedRecordField();

    el.recordId.value = record?.id || "";
    el.recordLabel.value = record?.label || "";
    el.recordInternalId.value = record?.internalId || "";
    el.deleteRecord.hidden = !record;

    el.fieldContext.textContent = record ? `Fields for ${record.label}` : "Select or save a record first.";
    el.fieldForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
      if (control.id === "newWorkflowRecordFieldBtn") control.disabled = !record;
      else if (control.type !== "hidden") control.disabled = !record;
    });
    el.fieldId.value = field?.id || "";
    el.fieldLabel.value = field?.label || "";
    el.fieldInternalId.value = field?.internalId || "";
    el.fieldType.value = field?.fieldType || "free-form text";
    el.fieldSortOrder.value = field?.sortOrder ?? 0;
    el.fieldListQuery.value = field?.listValuesQuery || "";
    el.deleteField.hidden = !field;
    updateFieldSuiteQlControls();

    el.recordsList.innerHTML = state.records.length
      ? state.records.map((item) => `
        <button type="button" class="workflow-record-row${String(item.id) === String(state.selectedRecordId) ? " active" : ""}" data-record-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.internalId)} · ${(item.fields || []).length} field${(item.fields || []).length === 1 ? "" : "s"}</small>
        </button>
      `).join("")
      : '<p class="workflow-status">No records configured yet.</p>';

    el.fieldsList.innerHTML = record?.fields?.length
      ? record.fields.map((item) => `
        <button type="button" class="workflow-record-field-row${String(item.id) === String(state.selectedRecordFieldId) ? " active" : ""}" data-field-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.internalId)} · ${escapeHtml(item.fieldType)}</small>
        </button>
      `).join("")
      : '<p class="workflow-status">No fields configured for this record.</p>';
  }

  const renderRecordManagementBase = renderRecordManagement;
  renderRecordManagement = function renderRecordManagementTableView() {
    renderRecordManagementBase();
    const record = selectedRecord();
    if (el.recordsList) {
      el.recordsList.innerHTML = state.records.length
        ? state.records.map((item) => `
          <article class="workflow-record-row${String(item.id) === String(state.selectedRecordId) ? " active" : ""}${String(item.id) === String(state.expandedRecordId) ? " expanded" : ""}" data-record-id="${escapeHtml(item.id)}">
            <button type="button" class="workflow-record-select" data-record-select="${escapeHtml(item.id)}">
              <strong>${escapeHtml(item.label || "New Record")}</strong>
              <small>${(item.fields || []).length} field${(item.fields || []).length === 1 ? "" : "s"}</small>
            </button>
            <button type="button" class="record-more-btn" data-toggle-record="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.label || "record")}">...</button>
            <div class="record-inline-grid">
              <label>
                Label
                <input data-record-label="${escapeHtml(item.id)}" value="${escapeHtml(item.label)}" placeholder="e.g. Sales Order">
              </label>
              <label>
                Record Type ID
                <input data-record-internal-id="${escapeHtml(item.id)}" value="${escapeHtml(item.internalId)}" placeholder="e.g. salesorder">
              </label>
            </div>
            <div class="record-inline-actions">
              <button type="button" class="btn-secondary" data-save-record-inline="${escapeHtml(item.id)}">Save</button>
              <button type="button" class="btn-danger" data-delete-record-inline="${escapeHtml(item.id)}">Delete</button>
            </div>
          </article>
        `).join("")
        : '<p class="workflow-status">No records configured yet.</p>';
    }
    if (!el.fieldsList) return;
    const typeOptions = (selected = "free-form text") => [
      "free-form text",
      "Decimal",
      "Text-area",
      "Freeform-text",
      "date",
      "checkbox",
      "list/record",
      "multiple select",
    ].map((type) => `<option value="${escapeHtml(type)}" ${type === selected ? "selected" : ""}>${escapeHtml(type)}</option>`).join("");
    el.fieldsList.innerHTML = record?.fields?.length
      ? record.fields.map((item) => `
        <tr class="workflow-record-field-row${String(item.id) === String(state.selectedRecordFieldId) ? " active" : ""}" data-field-id="${escapeHtml(item.id)}">
          <td class="field-drag-cell"><button type="button" class="field-drag-handle" draggable="true" data-field-drag="${escapeHtml(item.id)}" aria-label="Drag to reorder">...</button></td>
          <td><input data-field-label="${escapeHtml(item.id)}" value="${escapeHtml(item.label)}" placeholder="e.g. Customer"></td>
          <td><input data-field-internal-id="${escapeHtml(item.id)}" value="${escapeHtml(item.internalId)}" placeholder="e.g. entity"></td>
          <td><select data-field-type="${escapeHtml(item.id)}">${typeOptions(item.fieldType)}</select></td>
          <td class="record-suiteql-cell">
            ${fieldUsesListQuery(item.fieldType)
              ? `<button type="button" class="btn-secondary record-suiteql-edit" data-edit-field-suiteql="${escapeHtml(item.id)}">${item.listValuesQuery ? "Edit SuiteQL" : "Add SuiteQL"}</button>
                 ${item.listValuesQuery ? '<span class="record-suiteql-state is-set">Query set</span>' : '<span class="record-suiteql-state">Not set</span>'}`
              : '<span class="record-suiteql-state">Not applicable</span>'}
          </td>
          <td class="record-row-actions">
            <button type="button" class="btn-secondary" data-save-field-inline="${escapeHtml(item.id)}">Save</button>
            <button type="button" class="btn-danger" data-delete-field-inline="${escapeHtml(item.id)}">Delete</button>
          </td>
        </tr>
      `).join("")
      : '<tr class="workflow-record-field-empty"><td colspan="6">No fields configured for this record.</td></tr>';
    if (el.addSublist) el.addSublist.disabled = !record;
    if (el.sublistsList) {
      el.sublistsList.innerHTML = record?.sublists?.length
        ? record.sublists.map((sublist) => `
          <article class="record-sublist-card${String(sublist.id) === String(state.expandedSublistId) ? " expanded" : ""}" data-sublist-id="${escapeHtml(sublist.id)}">
            <div class="record-sublist-head">
              <button type="button" class="workflow-record-select" data-toggle-sublist="${escapeHtml(sublist.id)}">
                <strong>${escapeHtml(sublist.label || "Sublist")}</strong>
                <small>${escapeHtml(sublist.internalId || "sublistId")} - ${(sublist.fields || []).length} field${(sublist.fields || []).length === 1 ? "" : "s"}</small>
              </button>
              <button type="button" class="btn-secondary" data-add-sublist-field="${escapeHtml(sublist.id)}">Add Field</button>
            </div>
            <div class="record-sublist-config">
              <label>
                Label
                <input data-sublist-label="${escapeHtml(sublist.id)}" value="${escapeHtml(sublist.label)}" placeholder="e.g. Items">
              </label>
              <label>
                Sublist ID
                <input data-sublist-internal-id="${escapeHtml(sublist.id)}" value="${escapeHtml(sublist.internalId)}" placeholder="e.g. item">
              </label>
              <label>
                Sort Order
                <input data-sublist-sort-order="${escapeHtml(sublist.id)}" type="number" step="1" value="${escapeHtml(sublist.sortOrder ?? 0)}">
              </label>
              <div class="record-inline-actions">
                <button type="button" class="btn-secondary" data-save-sublist="${escapeHtml(sublist.id)}">Save Sublist</button>
                <button type="button" class="btn-danger" data-delete-sublist="${escapeHtml(sublist.id)}">Delete Sublist</button>
              </div>
            </div>
            <table class="record-fields-table record-sublist-fields-table">
              <thead>
                <tr>
                  <th aria-label="Reorder"></th>
                  <th>Label</th>
                  <th>Internal ID</th>
                  <th>Field Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${(sublist.fields || []).length ? sublist.fields.map((field) => `
                  <tr data-sublist-field-id="${escapeHtml(field.id)}" data-sublist-parent-id="${escapeHtml(sublist.id)}">
                    <td class="field-drag-cell"><button type="button" class="field-drag-handle" draggable="true" data-sublist-field-drag="${escapeHtml(field.id)}" aria-label="Drag to reorder">...</button></td>
                    <td><input data-sublist-field-label="${escapeHtml(field.id)}" value="${escapeHtml(field.label)}" placeholder="e.g. Quantity"></td>
                    <td><input data-sublist-field-internal-id="${escapeHtml(field.id)}" value="${escapeHtml(field.internalId)}" placeholder="e.g. quantity"></td>
                    <td><select data-sublist-field-type="${escapeHtml(field.id)}">${typeOptions(field.fieldType)}</select></td>
                    <td class="record-row-actions">
                      <button type="button" class="btn-secondary" data-save-sublist-field="${escapeHtml(field.id)}">Save</button>
                      <button type="button" class="btn-danger" data-delete-sublist-field="${escapeHtml(field.id)}">Delete</button>
                    </td>
                  </tr>
                `).join("") : '<tr class="workflow-record-field-empty"><td colspan="5">No fields configured for this sublist.</td></tr>'}
              </tbody>
            </table>
          </article>
        `).join("")
        : '<p class="workflow-status">No sublists configured for this record.</p>';
    }
  };

  function clearRecordForm() {
    state.selectedRecordId = "";
    state.selectedRecordFieldId = "";
    renderRecordManagement();
  }

  function clearFieldForm() {
    state.selectedRecordFieldId = "";
    renderRecordManagement();
  }

  function normaliseWorkflowSettings(settings = {}) {
    return {
      executionMode: settings.executionMode === "fullExecution" ? "fullExecution" : "actionMessageOnly",
      pathwayDebug: settings.pathwayDebug === true,
    };
  }

  function normaliseWorkflowCriteria(criteria = []) {
    return (Array.isArray(criteria) ? criteria : []).map((rule) => ({
      source: ["case", "salesOrder", "intercompanySalesOrder"].includes(rule?.source) ? rule.source : "case",
      field: String(rule?.field || ""),
      operator: ["equals", "notEquals", "greaterThan", "lessThan", "isSet", "isNotSet"].includes(rule?.operator) ? rule.operator : "equals",
      compareType: rule?.compareType === "field" ? "field" : "static",
      compareField: String(rule?.compareField || ""),
      staticValue: String(rule?.staticValue || ""),
      staticValueLabel: String(rule?.staticValueLabel || ""),
    }));
  }

  function currentWorkflowDefinition() {
    ensureStartNode();
    return {
      nodes: state.nodes,
      edges: state.edges,
      settings: normaliseWorkflowSettings(state.settings),
      criteria: normaliseWorkflowCriteria(state.criteria),
    };
  }

  function renderWorkflowSettings() {
    const settings = normaliseWorkflowSettings(state.settings);
    state.settings = settings;
    if (el.executionMode) el.executionMode.value = settings.executionMode;
    if (el.pathwayDebug) el.pathwayDebug.checked = settings.pathwayDebug;
  }

  function recordKey(value = "") {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function workflowCriteriaRecord(source = "case") {
    const target = source === "case" ? "supportcase" : "salesorder";
    return state.records.find((record) => recordKey(record.internalId) === target) ||
      state.records.find((record) => recordKey(record.label) === (source === "case" ? "case" : "salesorder")) ||
      null;
  }

  function workflowCriteriaSourceLabel(source = "case") {
    return ({
      case: "Case",
      salesOrder: "Sales Order",
      intercompanySalesOrder: "Intercompany Sales Order",
    })[source] || "Case";
  }

  function workflowCriteriaFields(source = "case") {
    return workflowCriteriaRecord(source)?.fields || [];
  }

  function workflowCriteriaField(source = "case", internalId = "") {
    return workflowCriteriaFields(source).find((field) => field.internalId === internalId) || null;
  }

  function defaultWorkflowCriteriaRule(source = "case") {
    const fields = workflowCriteriaFields(source);
    return {
      source,
      field: fields[0]?.internalId || "",
      operator: "equals",
      compareType: "static",
      compareField: fields[1]?.internalId || fields[0]?.internalId || "",
      staticValue: "",
      staticValueLabel: "",
    };
  }

  function renderWorkflowCriteriaFieldOptions(source = "case", selectedValue = "") {
    const fields = workflowCriteriaFields(source);
    if (!fields.length) return '<option value="">No fields mapped</option>';
    return fields.map((field) => `
      <option value="${escapeHtml(field.internalId)}" ${field.internalId === selectedValue ? "selected" : ""}>${escapeHtml(field.label)}</option>
    `).join("");
  }

  function renderWorkflowCriteria() {
    if (!el.criteriaRules) return;
    state.criteria = normaliseWorkflowCriteria(state.criteria);
    if (!state.criteria.length) {
      el.criteriaRules.innerHTML = '<p class="workflow-status">No criteria set. This workflow will show for every case.</p>';
      return;
    }
    el.criteriaRules.innerHTML = state.criteria.map((rule, index) => {
      const field = workflowCriteriaField(rule.source, rule.field);
      const compareType = rule.compareType === "field" ? "field" : "static";
      const useSearchValue = compareType === "static" && fieldUsesSearchOptions(field);
      return `
        <div class="check-rule-row" data-workflow-criteria-index="${index}">
          <div class="check-rule-grid">
            <label>
              Record
              <select data-workflow-criteria-source="${index}">
                <option value="case" ${rule.source === "case" ? "selected" : ""}>Case</option>
                <option value="salesOrder" ${rule.source === "salesOrder" ? "selected" : ""}>Sales Order</option>
                <option value="intercompanySalesOrder" ${rule.source === "intercompanySalesOrder" ? "selected" : ""}>Intercompany Sales Order</option>
              </select>
            </label>
            <label>
              Field
              <select data-workflow-criteria-field="${index}">
                ${renderWorkflowCriteriaFieldOptions(rule.source, rule.field)}
              </select>
            </label>
            <label>
              Test
              <select data-workflow-criteria-operator="${index}">
                <option value="equals" ${rule.operator === "equals" ? "selected" : ""}>Equals</option>
                <option value="notEquals" ${rule.operator === "notEquals" ? "selected" : ""}>Does not equal</option>
                <option value="greaterThan" ${rule.operator === "greaterThan" ? "selected" : ""}>Greater than</option>
                <option value="lessThan" ${rule.operator === "lessThan" ? "selected" : ""}>Less than</option>
                <option value="isSet" ${rule.operator === "isSet" ? "selected" : ""}>Is set</option>
                <option value="isNotSet" ${rule.operator === "isNotSet" ? "selected" : ""}>Is not set</option>
              </select>
            </label>
          </div>
          <div class="check-rule-compare">
            <label>
              Compare To
              <select data-workflow-criteria-compare-type="${index}">
                <option value="static" ${compareType === "static" ? "selected" : ""}>Static value</option>
                <option value="field" ${compareType === "field" ? "selected" : ""}>Another field</option>
              </select>
            </label>
            <label>
              Value
              ${compareType === "field"
                ? `<select data-workflow-criteria-compare-field="${index}">${renderWorkflowCriteriaFieldOptions(rule.source, rule.compareField)}</select>`
                : useSearchValue
                  ? `<div class="check-option-search" data-workflow-criteria-option-search="${index}" data-record-id="${escapeHtml(field.recordTypeId)}" data-field-id="${escapeHtml(field.id)}">
                      <input type="search" data-workflow-criteria-option-search-input="${index}" value="${escapeHtml(rule.staticValueLabel || rule.staticValue || "")}" placeholder="Search ${escapeHtml(field.label)}" autocomplete="off">
                      <input type="hidden" data-workflow-criteria-static-value="${index}" value="${escapeHtml(rule.staticValue || "")}">
                      <div class="check-option-results" data-workflow-criteria-option-results="${index}" hidden></div>
                    </div>`
                  : `<input data-workflow-criteria-static-value="${index}" value="${escapeHtml(rule.staticValue || "")}" placeholder="Static value">`}
            </label>
          </div>
          <button type="button" class="btn-secondary" data-remove-workflow-criteria="${index}">Remove Criteria</button>
        </div>
      `;
    }).join("");
  }

  function startNode() {
    return state.nodes.find((node) => node.type === "start") || null;
  }

  function ensureStartNode() {
    const starts = state.nodes.filter((node) => node.type === "start");
    let start = starts[0] || null;
    if (!start) {
      start = {
        id: "workflow_start",
        type: "start",
        x: 60,
        y: 80,
        ...nodeDefaults("start"),
      };
      state.nodes.unshift(start);
    }
    starts.slice(1).forEach((duplicate) => {
      state.edges = state.edges.filter((edge) => edge.from !== duplicate.id && edge.to !== duplicate.id);
      state.nodes = state.nodes.filter((node) => node.id !== duplicate.id);
    });
    start.id = start.id || "workflow_start";
    start.label = "Start";
    start.locked = true;
    start.startStatusId = start.startStatusId || "";
    start.startStatusName = start.startStatusName || "";
    return start;
  }

  function renderStartStatusOptions() {
    if (!el.startCaseStatus) return;
    const selected = el.startCaseStatus.value || selectedNode()?.startStatusId || "";
    el.startCaseStatus.innerHTML = '<option value="">No status change</option>' + state.statuses
      .map((status) => `<option value="${escapeHtml(status.id)}">${escapeHtml(status.name)}</option>`)
      .join("");
    el.startCaseStatus.value = selected;
  }

  function userInitials(user = {}) {
    const name = String(user.name || `${user.firstName || ""} ${user.lastName || ""}` || user.email || "").trim();
    const parts = name.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "") || "?").toUpperCase();
  }

  function debugAvatarMarkup(user = {}) {
    const image = String(user.profileImage || user.avatar || user.picture || "").trim();
    if (image) return `<span class="workflow-debug-avatar"><img src="${escapeHtml(image)}" alt="${escapeHtml(user.name || "User")}"></span>`;
    return `<span class="workflow-debug-avatar">${escapeHtml(userInitials(user))}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderSuiteQlStudioTable(rows = []) {
    if (!el.suiteQlStudioTable) return;
    if (!rows.length) {
      el.suiteQlStudioTable.hidden = true;
      el.suiteQlStudioTable.innerHTML = "";
      return;
    }
    const columns = Array.from(rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())).slice(0, 24);
    el.suiteQlStudioTable.hidden = false;
    el.suiteQlStudioTable.innerHTML = `
      <table class="suiteql-studio-table">
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.slice(0, 100).map((row) => `
            <tr>${columns.map((column) => `<td>${escapeHtml(row?.[column] ?? "")}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function nodeSummary(node) {
    if (node.type === "start") return node.startStatusName ? `Set status to ${node.startStatusName}` : "Workflow starts here";
    if (node.type === "question") return node.question || "Question";
    if (node.type === "input") return node.question || "Input prompt";
    if (node.type === "closeCase") return "Workflow resolves here";
    return node.message || `${nodeTypeLabel(node.type)} notes`;
  }

  function nodeTypeLabel(type) {
    return ({
      start: "Start",
      question: "Question",
      action: "Action",
      input: "Input",
      check: "Check",
      break: "Break",
      closeCase: "Close Case",
    })[type] || "Node";
  }

  function nodeDefaults(type) {
    return ({
      start: {
        label: "Start",
        question: "",
        message: "",
        options: [],
        locked: true,
        startStatusId: "",
        startStatusName: "",
      },
      question: {
        label: "Question",
        question: "Ask a customer service question...",
        message: "",
        options: [{ label: "Yes" }, { label: "No" }],
      },
      action: {
        label: "Action",
        question: "",
        message: "Action message...",
        options: [],
        actionConfig: {
          type: "",
        },
      },
      input: {
        label: "Input",
        question: "Request information from the user or customer...",
        message: "Framework: user input or customer email request will be wired later.",
        options: [],
        inputConfig: {
          type: "string",
          listSource: "salesOrderItems",
          listField: "",
        },
      },
      check: {
        label: "Check",
        question: "",
        message: "Framework: check a transaction, item line, or field value later.",
        options: [{ label: "Pass" }, { label: "Fail" }],
        checkConfig: {
          recordType: "affectedItem",
          affectedItemSource: "storeSalesOrder",
          rules: [],
        },
      },
      break: {
        label: "Break",
        question: "",
        message: "Framework: execute actions so far, save progress, and resume later.",
        options: [],
      },
      closeCase: {
        label: "Close Case",
        question: "",
        message: "Framework: workflow resolves and the case can be closed later.",
        options: [],
      },
    })[type] || {
      label: "Action",
      question: "",
      message: "Action message...",
      options: [],
    };
  }

  const BUILT_IN_CHECK_FIELD_OPTIONS = {
    affectedItem: [
      { value: "quantity", label: "Quantity" },
      { value: "quantitycommitted", label: "Quantity Committed" },
      { value: "location", label: "Where is this being fulfilled from" },
      { value: "item", label: "Item" },
      { value: "rate", label: "Rate" },
      { value: "amount", label: "Amount" },
      { value: "expectedshipdate", label: "Expected Ship Date" },
      { value: "custcol_sb_lot_details", label: "Lot Details" },
    ],
    input: [
      { value: "value", label: "Input value" },
    ],
  };

  function customRecordValue(recordId) {
    return `record:${recordId}`;
  }

  function customRecordIdFromValue(value = "") {
    const match = String(value || "").match(/^record:(\d+)$/);
    return match ? match[1] : "";
  }

  function checkRecordLabel(recordType) {
    if (recordType === "affectedItem") return "Affected item";
    if (recordType === "input") return "Input";
    const recordId = customRecordIdFromValue(recordType);
    return state.records.find((record) => String(record.id) === String(recordId))?.label || "this record";
  }

  function defaultCheckRule() {
    return {
      field: "quantitycommitted",
      operator: "equals",
      compareType: "field",
      compareField: "quantity",
      staticValue: "",
    };
  }

  function ensureCheckConfig(node) {
    node.checkConfig = node.checkConfig || {};
    node.checkConfig.recordType = node.checkConfig.recordType || "affectedItem";
    node.checkConfig.inputNodeId = node.checkConfig.inputNodeId || "";
    node.checkConfig.affectedItemSource = node.checkConfig.affectedItemSource || "storeSalesOrder";
    node.checkConfig.rules = Array.isArray(node.checkConfig.rules) ? node.checkConfig.rules : [];
    return node.checkConfig;
  }

  function ensureInputConfig(node) {
    node.inputConfig = node.inputConfig || {};
    node.inputConfig.type = node.inputConfig.type || "string";
    node.inputConfig.listSource = node.inputConfig.listSource || "salesOrderItems";
    node.inputConfig.listField = node.inputConfig.listField || "";
    if (!Array.isArray(node.inputConfig.fields) || !node.inputConfig.fields.length) {
      node.inputConfig.fields = [{
        id: `input_${Date.now()}`,
        label: node.question || node.label || "Response",
        type: node.inputConfig.type || "string",
        listSource: node.inputConfig.listSource || "salesOrderItems",
        listField: node.inputConfig.listField || "",
      }];
    }
    node.inputConfig.fields = node.inputConfig.fields.map((field, index) => ({
      id: field.id || `input_${Date.now()}_${index}`,
      label: field.label || `Response ${index + 1}`,
      type: ["string", "currency", "list", "boolean"].includes(field.type) ? field.type : "string",
      listSource: field.listSource || "salesOrderItems",
      listField: field.listField || "",
    }));
    return node.inputConfig;
  }

  function ensureActionConfig(node) {
    node.actionConfig = node.actionConfig || {};
    node.actionConfig.type = node.actionConfig.type || "";
    node.actionConfig.mandatory = node.actionConfig.mandatory !== false;
    node.actionConfig.createRecord = node.actionConfig.createRecord && typeof node.actionConfig.createRecord === "object"
      ? node.actionConfig.createRecord
      : {};
    node.actionConfig.createRecord.targetRecord = node.actionConfig.createRecord.targetRecord || "salesOrder";
    node.actionConfig.createRecord.sourceRecord = node.actionConfig.createRecord.sourceRecord || "storeSalesOrder";
    node.actionConfig.createRecord.mappings = Array.isArray(node.actionConfig.createRecord.mappings)
      ? node.actionConfig.createRecord.mappings
      : [];
    node.actionConfig.itemLineAction = node.actionConfig.itemLineAction && typeof node.actionConfig.itemLineAction === "object"
      ? node.actionConfig.itemLineAction
      : {};
    node.actionConfig.itemLineAction.itemSource = node.actionConfig.itemLineAction.itemSource || "caseAffectedItem";
    node.actionConfig.itemLineAction.inputNodeId = node.actionConfig.itemLineAction.inputNodeId || "";
    node.actionConfig.itemLineAction.target = node.actionConfig.itemLineAction.target || node.actionConfig.itemLineAction.source || "storeSalesOrder";
    node.actionConfig.itemLineAction.source = node.actionConfig.itemLineAction.target;
    node.actionConfig.itemLineAction.sourceRecord = node.actionConfig.itemLineAction.sourceRecord || "storeSalesOrder";
    node.actionConfig.itemLineAction.mappings = Array.isArray(node.actionConfig.itemLineAction.mappings)
      ? node.actionConfig.itemLineAction.mappings
      : [];
    return node.actionConfig;
  }

  function portKey(label = "") {
    return label || "__next";
  }

  function defaultOutputPort(index = 0, total = 1) {
    return {
      side: "right",
      t: total > 1 ? clamp(0.28 + index * (0.44 / Math.max(1, total - 1)), 0.18, 0.82) : 0.5,
    };
  }

  function portPosition(node, kind, label = "", index = 0, total = 1) {
    if (kind === "input") return node.inputPort || { side: "left", t: 0.5 };
    return node.outputPorts?.[portKey(label)] || defaultOutputPort(index, total);
  }

  function portStyle(position) {
    const t = clamp(Number(position.t ?? 0.5), 0.08, 0.92);
    if (position.side === "top") return `left:${t * NODE_WIDTH}px;top:0;transform:translate(-50%, -50%);`;
    if (position.side === "bottom") return `left:${t * NODE_WIDTH}px;top:${NODE_HEIGHT}px;transform:translate(-50%, -50%);`;
    if (position.side === "left") return `left:0;top:${t * NODE_HEIGHT}px;transform:translate(-50%, -50%);`;
    return `left:${NODE_WIDTH}px;top:${t * NODE_HEIGHT}px;transform:translate(-50%, -50%);`;
  }

  function portPoint(node, kind, label = "", index = 0, total = 1) {
    const position = portPosition(node, kind, label, index, total);
    const t = clamp(Number(position.t ?? 0.5), 0.08, 0.92);
    if (position.side === "top") return { x: node.x + t * NODE_WIDTH, y: node.y };
    if (position.side === "bottom") return { x: node.x + t * NODE_WIDTH, y: node.y + NODE_HEIGHT };
    if (position.side === "left") return { x: node.x, y: node.y + t * NODE_HEIGHT };
    return { x: node.x + NODE_WIDTH, y: node.y + t * NODE_HEIGHT };
  }

  function renderNodePorts(node) {
    if (node.type === "question" || node.type === "check") {
      const options = Array.isArray(node.options) ? node.options.filter((option) => option?.label) : [];
      if (!options.length) return "";
      return `
        <div class="workflow-output-ports" aria-label="Response paths">
          ${options.map((option, index) => `
            <button type="button" class="workflow-output-port" draggable="true" data-port-node="${escapeHtml(node.id)}" data-port-label="${escapeHtml(option.label)}" style="${portStyle(portPosition(node, "output", option.label, index, options.length))}">${escapeHtml(option.label)}</button>
          `).join("")}
        </div>
      `;
    }

    if (node.type === "closeCase") return "";

    return `
      <div class="workflow-output-ports" aria-label="Action path">
        <button type="button" class="workflow-output-port" draggable="true" data-port-node="${escapeHtml(node.id)}" data-port-label="" style="${portStyle(portPosition(node, "output", "", 0, 1))}">Next</button>
      </div>
    `;
  }

  function renderNodes() {
    el.surface.querySelectorAll(".workflow-node").forEach((node) => node.remove());
    state.nodes.forEach((node) => {
      const div = document.createElement("div");
      const debugNodeIds = new Set((state.debug?.nodeIds || []).map(String));
      const debugActionNodeIds = new Set((state.debug?.actionNodeIds || []).map(String));
      const debugActive =
        state.debug &&
        String(state.debug.workflowId || "") === String(state.currentId || "") &&
        String(state.debug.nodeId || "") === String(node.id);
      const debugVisited = state.debug && String(state.debug.workflowId || "") === String(state.currentId || "") && debugNodeIds.has(String(node.id));
      const debugAction = state.debug && String(state.debug.workflowId || "") === String(state.currentId || "") && debugActionNodeIds.has(String(node.id));
      div.className = `workflow-node ${node.type}${node.id === state.selectedNodeId ? " selected" : ""}${debugVisited ? " debug-visited" : ""}${debugAction ? " debug-action" : ""}${debugActive ? " debug-active" : ""}`;
      div.dataset.nodeId = node.id;
      div.style.left = `${node.x}px`;
      div.style.top = `${node.y}px`;
      div.innerHTML = `
        <span class="workflow-input-port" data-input-node="${escapeHtml(node.id)}" title="Drop a path here" style="${portStyle(portPosition(node, "input"))}"></span>
        ${debugActive ? debugAvatarMarkup(state.debug.user || {}) : ""}
        <strong>${escapeHtml(node.label || nodeTypeLabel(node.type))}</strong>
        <small>${escapeHtml(nodeSummary(node))}</small>
        ${renderNodePorts(node)}
      `;
      div.addEventListener("pointerdown", startNodeDrag);
      div.addEventListener("click", onNodeClick);
      div.querySelectorAll(".workflow-output-port").forEach((port) => {
        port.addEventListener("pointerdown", startPortPointerDown);
        port.addEventListener("click", (event) => event.stopPropagation());
        port.addEventListener("dragstart", startPathDrag);
      });
      div.querySelectorAll(".workflow-input-port").forEach((port) => {
        port.addEventListener("pointerdown", startPortPointerDown);
        port.addEventListener("dragover", allowPathDrop);
        port.addEventListener("dragleave", clearPathDrop);
        port.addEventListener("drop", dropPathOnInput);
      });
      el.surface.appendChild(div);
    });
  }

  function refreshNodeSelection() {
    el.surface.querySelectorAll(".workflow-node").forEach((node) => {
      const active = node.dataset.nodeId === state.selectedNodeId;
      node.classList.toggle("selected", active);
    });
    renderProperties();
  }

  function renderEdges() {
    el.edges.innerHTML = "";
    const debugEdgeIds = new Set((state.debug?.edgeIds || []).map(String));
    state.edges.forEach((edge) => {
      const from = state.nodes.find((node) => node.id === edge.from);
      const to = state.nodes.find((node) => node.id === edge.to);
      if (!from || !to) return;
      const optionIndex = Math.max(0, (from.options || []).findIndex((option) => option.label === edge.label));
      const optionCount = Array.isArray(from.options) && from.options.length ? from.options.length : 1;
      const start = portPoint(from, "output", edge.label || "", optionIndex, optionCount);
      const end = portPoint(to, "input");
      const x1 = start.x;
      const y1 = start.y;
      const x2 = end.x;
      const y2 = end.y;
      const midX = (x1 + x2) / 2;
      const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const debugEdge = state.debug && String(state.debug.workflowId || "") === String(state.currentId || "") && debugEdgeIds.has(String(edge.id));
      const isCheckPass = from.type === "check" && String(edge.label || "").trim().toLowerCase() === "pass";
      const isCheckFail = from.type === "check" && String(edge.label || "").trim().toLowerCase() === "fail";
      const edgeTone = isCheckPass ? " pass-path" : isCheckFail ? " fail-path" : "";
      path.setAttribute("class", `workflow-edge${edgeTone}${edge.id === state.selectedEdgeId ? " selected" : ""}${debugEdge ? " debug-path" : ""}`);
      path.dataset.edgeId = edge.id;
      path.setAttribute("d", pathD);
      path.addEventListener("pointerdown", (event) => event.stopPropagation());
      path.addEventListener("click", onEdgeClick);
      el.edges.appendChild(path);
      hitPath.setAttribute("class", "workflow-edge-hit");
      hitPath.dataset.edgeId = edge.id;
      hitPath.setAttribute("d", pathD);
      hitPath.addEventListener("pointerdown", (event) => event.stopPropagation());
      hitPath.addEventListener("click", onEdgeClick);
      el.edges.appendChild(hitPath);
      if (edge.label && !isCheckPass && !isCheckFail) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "workflow-edge-label");
        text.setAttribute("x", String(midX - 20));
        text.setAttribute("y", String(((y1 + y2) / 2) - 6));
        text.textContent = edge.label;
        el.edges.appendChild(text);
      }
    });
    renderPathPreview();
  }

  function canvasPointFromClient(clientX, clientY) {
    const rect = el.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left + el.canvas.scrollLeft) / state.zoom,
      y: (clientY - rect.top + el.canvas.scrollTop) / state.zoom,
    };
  }

  function renderPathPreview() {
    const preview = state.pathPreview;
    if (!preview?.from) return;
    const from = state.nodes.find((node) => node.id === preview.from);
    if (!from) return;
    const optionIndex = Math.max(0, (from.options || []).findIndex((option) => option.label === preview.label));
    const optionCount = Array.isArray(from.options) && from.options.length ? from.options.length : 1;
    const start = portPoint(from, "output", preview.label || "", optionIndex, optionCount);
    const end = preview.toPoint || start;
    const midX = (start.x + end.x) / 2;
    const pathD = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "workflow-edge-preview");
    path.setAttribute("d", pathD);
    el.edges.appendChild(path);
  }

  function renderProperties() {
    const node = selectedNode();
    const edge = selectedEdge();
    const keepInputOpen = !!el.inputConfigWrap?.open;
    const keepActionOpen = !!el.actionConfigWrap?.open;
    const keepCheckOpen = !!el.checkWrap?.open;
    const keepResponseOpen = !!el.responseWrap?.open;
    const keepPathRulesOpen = !!el.pathRulesWrap?.open;
    el.props.hidden = !node;
    el.emptyProps.hidden = !!node;
    document.getElementById("deleteNodeBtn").hidden = false;
    if (!node && edge) {
      el.emptyProps.hidden = false;
      el.emptyProps.innerHTML = '<strong>Selected path</strong><p class="workflow-status">Press Delete to remove this path.</p>';
      return;
    }
    el.emptyProps.innerHTML = "Select a workflow element.";
    if (!node) return;

    el.nodeLabel.value = node.label || "";
    el.nodeQuestion.value = node.question || "";
    el.nodeActionMessage.value = node.message || "";
    el.nodeLabel.closest("label").hidden = node.type === "start";
    el.questionWrap.hidden = node.type !== "question";
    el.actionWrap.hidden = node.type === "start";
    if (el.actionConfigWrap) el.actionConfigWrap.hidden = node.type !== "action";
    if (el.startStatusWrap) el.startStatusWrap.hidden = node.type !== "start";
    if (el.startCaseStatus) el.startCaseStatus.value = node.startStatusId || "";
    if (el.inputConfigWrap) el.inputConfigWrap.hidden = node.type !== "input";
    el.checkWrap.hidden = node.type !== "check";
    el.responseWrap.hidden = !(node.type === "question" || node.type === "check");
    if (el.nodeQuestionLabel) el.nodeQuestionLabel.textContent = "Question";
    if (el.inputConfigWrap) el.inputConfigWrap.open = node.type === "input" ? keepInputOpen : false;
    if (el.actionConfigWrap) el.actionConfigWrap.open = node.type === "action" ? keepActionOpen : false;
    el.checkWrap.open = node.type === "check" ? keepCheckOpen : false;
    el.responseWrap.open = (node.type === "question" || node.type === "check") ? keepResponseOpen : false;
    if (el.pathRulesWrap) {
      el.pathRulesWrap.hidden = node.type === "start";
      el.pathRulesWrap.open = node.type === "start" ? false : keepPathRulesOpen;
    }
    renderInputConfig(node);
    renderActionConfig(node);
    renderCheckConfig(node);
    renderResponseOptions(node);
    renderPathRules(node);
    document.getElementById("deleteNodeBtn").hidden = node.type === "start";
  }

  function checkFieldOptions(recordType) {
    if (recordType === "affectedItem") {
      const fields = salesOrderItemSublist()?.fields || [];
      if (fields.length) {
        return fields.map((field) => ({
          value: field.internalId,
          label: field.label,
          id: field.id,
          recordTypeId: field.recordTypeId,
          fieldType: field.fieldType,
          listValuesQuery: field.listValuesQuery || "",
        }));
      }
    }
    if (BUILT_IN_CHECK_FIELD_OPTIONS[recordType]) return BUILT_IN_CHECK_FIELD_OPTIONS[recordType];
    const recordId = customRecordIdFromValue(recordType);
    const record = state.records.find((item) => String(item.id) === String(recordId));
    return (record?.fields || []).map((field) => ({
      value: field.internalId,
      label: field.label,
      id: field.id,
      recordTypeId: field.recordTypeId,
      fieldType: field.fieldType,
      listValuesQuery: field.listValuesQuery || "",
    }));
  }

  function checkInputNode(config = {}) {
    return state.nodes.find((node) => String(node.id) === String(config.inputNodeId || "")) || null;
  }

  function checkInputUsesSalesOrderItems(config = {}) {
    const input = checkInputNode(config);
    if (input?.type !== "input") return false;
    const fields = Array.isArray(input.inputConfig?.fields) ? input.inputConfig.fields : [];
    if (fields.some((field) => field.type === "list" && field.listSource === "salesOrderItems")) return true;
    return input.inputConfig?.type === "list" && input.inputConfig?.listSource === "salesOrderItems";
  }

  function checkFieldRecordType(config = {}) {
    if (config.recordType === "input" && checkInputUsesSalesOrderItems(config)) return "affectedItem";
    return config.recordType || "affectedItem";
  }

  function inputRecordSourceOptions(selectedValue = "") {
    const options = [
      `<option value="salesOrderItems" ${selectedValue === "salesOrderItems" ? "selected" : ""}>Sales order items</option>`,
      `<option value="item" ${selectedValue === "item" ? "selected" : ""}>Item</option>`,
      ...state.records.map((record) => {
        const value = customRecordValue(record.id);
        return `<option value="${escapeHtml(value)}" ${selectedValue === value ? "selected" : ""}>${escapeHtml(record.label)}</option>`;
      }),
    ];
    return options.join("");
  }

  function inputSourceRecord(source = "") {
    const recordId = customRecordIdFromValue(source);
    return state.records.find((record) => String(record.id) === String(recordId)) || null;
  }

  function inputTypeOptions(selectedValue = "string") {
    return ["string", "currency", "list", "boolean"].map((type) => `
      <option value="${escapeHtml(type)}" ${type === selectedValue ? "selected" : ""}>${escapeHtml(type === "currency" ? "Currency" : type === "boolean" ? "Boolean" : type === "list" ? "List" : "string")}</option>
    `).join("");
  }

  function inputFieldListOptions(config = {}, field = {}) {
    const record = inputSourceRecord(field.listSource);
    const fields = Array.isArray(record?.fields) ? record.fields : [];
    if (!fields.length) return '<option value="">No fields configured</option>';
    return fields.map((item) => `
      <option value="${escapeHtml(item.internalId)}" ${item.internalId === field.listField ? "selected" : ""}>${escapeHtml(item.label)}</option>
    `).join("");
  }

  function renderInputFields(config = {}) {
    if (!el.inputFieldsList) return;
    const fields = Array.isArray(config.fields) ? config.fields : [];
    el.inputFieldsList.innerHTML = fields.length
      ? fields.map((field, index) => {
        const isList = field.type === "list";
        const record = inputSourceRecord(field.listSource);
        if (isList && record && Array.isArray(record.fields) && record.fields.length && !record.fields.some((item) => item.internalId === field.listField)) {
          field.listField = record.fields[0].internalId || "";
        }
        return `
          <div class="input-field-config" data-input-field-row="${escapeHtml(field.id)}">
            <label>
              Label
              <input data-input-field-label="${escapeHtml(field.id)}" type="text" value="${escapeHtml(field.label)}" placeholder="e.g. Refund amount">
            </label>
            <label>
              Type
              <select data-input-field-type="${escapeHtml(field.id)}">${inputTypeOptions(field.type)}</select>
            </label>
            <label ${isList ? "" : "hidden"}>
              Source
              <select data-input-field-source="${escapeHtml(field.id)}">${inputRecordSourceOptions(field.listSource)}</select>
            </label>
            <label ${isList && inputSourceRecord(field.listSource) ? "" : "hidden"}>
              Field
              <select data-input-field-list-field="${escapeHtml(field.id)}">${inputFieldListOptions(config, field)}</select>
            </label>
            <button type="button" class="btn-secondary input-field-remove" data-remove-input-field="${escapeHtml(field.id)}" ${fields.length <= 1 ? "disabled" : ""}>Remove</button>
          </div>
        `;
      }).join("")
      : '<p class="workflow-status">No inputs configured.</p>';
  }

  function renderInputConfig(node) {
    if (!node || node.type !== "input" || !el.inputConfigWrap) return;
    const config = ensureInputConfig(node);
    const validTypes = new Set(["string", "currency", "list", "boolean"]);
    if (!validTypes.has(config.type)) config.type = "string";
    renderInputFields(config);
    el.inputType.value = config.type;
    const isList = config.type === "list";
    el.inputListSourceWrap.hidden = !isList;
    el.inputListFieldWrap.hidden = true;
    if (!isList) return;

    el.inputListSource.innerHTML = inputRecordSourceOptions(config.listSource);
    if (![...el.inputListSource.options].some((option) => option.value === config.listSource)) {
      config.listSource = "salesOrderItems";
    }
    el.inputListSource.value = config.listSource;

    const record = inputSourceRecord(config.listSource);
    if (!record) {
      config.listField = "";
      return;
    }

    const fields = Array.isArray(record.fields) ? record.fields : [];
    el.inputListFieldWrap.hidden = false;
    el.inputListField.innerHTML = fields.length
      ? fields.map((field) => `<option value="${escapeHtml(field.internalId)}" ${field.internalId === config.listField ? "selected" : ""}>${escapeHtml(field.label)}</option>`).join("")
      : '<option value="">No fields configured</option>';
    if (fields.length && !fields.some((field) => field.internalId === config.listField)) {
      config.listField = fields[0].internalId || "";
    }
    el.inputListField.value = config.listField || "";
  }

  function renderActionConfig(node) {
    if (!node || node.type !== "action" || !el.actionConfigWrap) return;
    const config = ensureActionConfig(node);
    const validTypes = new Set(["", "itemLineAction", "closeSalesLine", "closeIntercompanyLine", "closeSupplierPurchaseOrderLine", "createRecord"]);
    if (!validTypes.has(config.type)) config.type = "";
    el.actionType.value = config.type;
    if (el.actionMandatory) el.actionMandatory.checked = config.mandatory !== false;
    [
      el.itemLineItemWrap,
      el.itemLineInputWrap,
      el.itemLineSourceWrap,
      el.itemLineMapWrap,
      el.itemLineMappings,
      el.createRecordTargetWrap,
      el.createRecordMapWrap,
    ].forEach((nodeEl) => {
      if (nodeEl) nodeEl.hidden = true;
    });
    renderItemLineActionConfig(node);
    renderCreateRecordActionConfig(node);
  }

  function salesOrderRecord() {
    return workflowRecordByKeys(["salesorder", "sales_order"]);
  }

  function salesOrderItemSublist() {
    const record = salesOrderRecord();
    return (record?.sublists || []).find((sublist) =>
      normaliseRecordLookup(sublist.internalId) === "item" ||
      normaliseRecordLookup(sublist.label) === "items" ||
      normaliseRecordLookup(sublist.label) === "item"
    ) || (record?.sublists || [])[0] || null;
  }

  function renderItemLineMappings(config = {}) {
    const mappings = Array.isArray(config.mappings) ? config.mappings : [];
    if (!el.itemLineMappings) return;
    el.itemLineMappings.innerHTML = mappings.length
      ? `<p class="workflow-status">${mappings.length} item line field mapping${mappings.length === 1 ? "" : "s"} configured.</p>`
      : '<p class="workflow-status">No item line mappings configured.</p>';
  }

  function renderItemLineActionConfig(node) {
    const config = ensureActionConfig(node);
    const itemLine = config.itemLineAction;
    const isItemLineAction = config.type === "itemLineAction";
    [el.itemLineItemWrap, el.itemLineSourceWrap, el.itemLineMapWrap, el.itemLineMappings].forEach((nodeEl) => {
      if (nodeEl) nodeEl.hidden = !isItemLineAction;
    });
    if (!isItemLineAction) return;

    itemLine.itemSource = itemLine.itemSource || "caseAffectedItem";
    if (el.itemLineItem) el.itemLineItem.value = itemLine.itemSource || "caseAffectedItem";
    if (el.itemLineInputWrap) el.itemLineInputWrap.hidden = itemLine.itemSource !== "input";
    itemLine.target = itemLine.target || itemLine.source || "storeSalesOrder";
    itemLine.source = itemLine.target;
    if (el.itemLineSource) el.itemLineSource.value = itemLine.target || "storeSalesOrder";
    if (el.itemLineInput) {
      const inputs = state.nodes.filter((candidate) => candidate.type === "input" && candidate.id !== node.id);
      el.itemLineInput.innerHTML = inputs.length
        ? inputs.map((input) => `<option value="${escapeHtml(input.id)}" ${input.id === itemLine.inputNodeId ? "selected" : ""}>${escapeHtml(inputNodeLabel(input))}</option>`).join("")
        : '<option value="">No input nodes available</option>';
      if (inputs.length && !inputs.some((input) => input.id === itemLine.inputNodeId)) itemLine.inputNodeId = inputs[0].id;
      el.itemLineInput.value = itemLine.inputNodeId || "";
    }
    if (el.itemLineMapButton) {
      const count = Array.isArray(itemLine.mappings) ? itemLine.mappings.length : 0;
      el.itemLineMapButton.textContent = count ? `MAP (${count})` : "MAP";
    }
    renderItemLineMappings(itemLine);
  }

  const CREATE_RECORD_TARGETS = {
    salesOrder: { label: "Sales Order", keys: ["salesorder", "sales_order"] },
    customerDeposit: { label: "Customer Deposit", keys: ["customerdeposit", "customer_deposit"] },
    customerRefund: { label: "Customer Refund", keys: ["customerrefund", "customer_refund"] },
    returnAuthorization: { label: "Return Authorisation", keys: ["returnauthorization", "return_authorization", "returnauthorisation", "return_authorisation"] },
  };

  function normaliseRecordLookup(value = "") {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function workflowRecordByKeys(keys = []) {
    const wanted = keys.map(normaliseRecordLookup);
    return state.records.find((record) =>
      wanted.includes(normaliseRecordLookup(record.internalId)) ||
      wanted.includes(normaliseRecordLookup(record.label))
    ) || null;
  }

  function createRecordSourceRecord(source = "storeSalesOrder") {
    if (source === "case") return workflowRecordByKeys(["supportcase", "case"]);
    return workflowRecordByKeys(["salesorder", "sales_order"]);
  }

  function createRecordTargetRecord(target = "salesOrder") {
    return workflowRecordByKeys(CREATE_RECORD_TARGETS[target]?.keys || []);
  }

  function createRecordFieldOptions(fields = [], selectedValue = "") {
    if (!fields.length) return '<option value="">No fields mapped</option>';
    return fields.map((field) => `
      <option value="${escapeHtml(field.internalId)}" ${field.internalId === selectedValue ? "selected" : ""}>${escapeHtml(field.label)}</option>
    `).join("");
  }

  function defaultCreateRecordMapping(config = {}) {
    const sourceFields = createRecordSourceRecord(config.sourceRecord)?.fields || [];
    const targetFields = createRecordTargetRecord(config.targetRecord)?.fields || [];
    return {
      sourceType: "record",
      sourceInputId: "",
      sourceInputType: "",
      sourceField: sourceFields[0]?.internalId || "",
      sourceChildField: "",
      sourceChildRecord: "",
      sourceFieldPath: [],
      targetField: targetFields[0]?.internalId || "",
      mode: "source",
      valueMode: "id",
      staticValue: "",
    };
  }

  function renderCreateRecordActionConfig(node) {
    const config = ensureActionConfig(node);
    const createConfig = config.createRecord;
    const isCreateRecord = config.type === "createRecord";
    if (el.createRecordTargetWrap) el.createRecordTargetWrap.hidden = !isCreateRecord;
    if (el.createRecordMapWrap) el.createRecordMapWrap.hidden = !isCreateRecord;
    if (!isCreateRecord) return;

    if (el.createRecordTarget) el.createRecordTarget.value = createConfig.targetRecord || "salesOrder";
    if (el.createRecordMapButton) {
      const count = Array.isArray(createConfig.mappings) ? createConfig.mappings.length : 0;
      el.createRecordMapButton.textContent = count ? `MAP (${count})` : "MAP";
    }
  }

  function checkFieldOption(recordType, fieldValue = "") {
    return checkFieldOptions(recordType).find((field) => field.value === fieldValue) || null;
  }

  function fieldUsesSearchOptions(field = null) {
    return !!field && fieldUsesListQuery(field.fieldType) && !!String(field.listValuesQuery || "").trim() && field.id && field.recordTypeId;
  }

  function renderFieldOptions(recordType, selectedValue = "") {
    return checkFieldOptions(recordType).map((field) => `
      <option value="${escapeHtml(field.value)}" ${field.value === selectedValue ? "selected" : ""}>${escapeHtml(field.label)}</option>
    `).join("");
  }

  function nodeCanReach(startId, targetId) {
    const seen = new Set();
    const stack = [String(startId || "")];
    const target = String(targetId || "");
    while (stack.length) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      if (current === target) return true;
      seen.add(current);
      state.edges
        .filter((edge) => String(edge.from) === current)
        .forEach((edge) => stack.push(String(edge.to)));
    }
    return false;
  }

  function availableInputNodesForCheck(checkNode) {
    const inputs = state.nodes.filter((node) => node.type === "input" && node.id !== checkNode.id);
    const upstream = inputs.filter((node) => nodeCanReach(node.id, checkNode.id));
    return upstream.length ? upstream : inputs;
  }

  function inputNodeLabel(node = {}) {
    return node.question || node.label || "Input";
  }

  function renderCheckConfig(node) {
    if (node.type !== "check") return;
    const config = ensureCheckConfig(node);
    const recordOptions = [
      '<option value="affectedItem">Affected item</option>',
      '<option value="input">Input</option>',
      ...state.records.map((record) => `<option value="${escapeHtml(customRecordValue(record.id))}">${escapeHtml(record.label)}</option>`),
    ];
    el.checkRecordType.innerHTML = recordOptions.join("");
    if (![...el.checkRecordType.options].some((option) => option.value === config.recordType)) {
      config.recordType = "affectedItem";
    }
    el.checkRecordType.value = config.recordType;
    if (el.affectedItemSourceWrap) el.affectedItemSourceWrap.hidden = config.recordType !== "affectedItem";
    if (el.checkAffectedItemSource) el.checkAffectedItemSource.value = config.affectedItemSource || "storeSalesOrder";
    if (el.checkInputSourceWrap) {
      el.checkInputSourceWrap.hidden = config.recordType !== "input";
      if (config.recordType === "input") {
        const inputs = availableInputNodesForCheck(node);
        el.checkInputSource.innerHTML = inputs.length
          ? inputs.map((input) => `<option value="${escapeHtml(input.id)}" ${input.id === config.inputNodeId ? "selected" : ""}>${escapeHtml(inputNodeLabel(input))}</option>`).join("")
          : '<option value="">No input nodes available</option>';
        if (inputs.length && !inputs.some((input) => input.id === config.inputNodeId)) {
          config.inputNodeId = inputs[0].id;
        }
        el.checkInputSource.value = config.inputNodeId || "";
      }
    }
    el.checkRules.innerHTML = config.rules.length
      ? config.rules.map((rule, index) => renderCheckRule(checkFieldRecordType(config), rule, index)).join("")
      : `<p class="workflow-status">No checks added for ${escapeHtml(checkRecordLabel(config.recordType))}.</p>`;
  }

  function renderCheckRule(recordType, rule = {}, index = 0) {
    const isInputRecord = recordType === "input";
    const compareType = isInputRecord ? "static" : (rule.compareType || "field");
    const selectedField = checkFieldOption(recordType, rule.field || "");
    const useSearchValue = compareType === "static" && fieldUsesSearchOptions(selectedField);
    return `
      <div class="check-rule-row" data-check-rule-index="${index}">
        <div class="check-rule-grid">
          <label>
            Field
            <select data-check-field="${index}">
              ${renderFieldOptions(recordType, rule.field || "")}
            </select>
          </label>
          <label>
            Test
            <select data-check-operator="${index}">
              <option value="equals" ${rule.operator === "equals" ? "selected" : ""}>Equals</option>
              <option value="notEquals" ${rule.operator === "notEquals" ? "selected" : ""}>Does not equal</option>
              <option value="greaterThan" ${rule.operator === "greaterThan" ? "selected" : ""}>Greater than</option>
              <option value="lessThan" ${rule.operator === "lessThan" ? "selected" : ""}>Less than</option>
              <option value="isSet" ${rule.operator === "isSet" ? "selected" : ""}>Is set</option>
              <option value="isNotSet" ${rule.operator === "isNotSet" ? "selected" : ""}>Is not set</option>
            </select>
          </label>
        </div>
        <div class="check-rule-compare">
          <label>
            Compare To
            <select data-check-compare-type="${index}">
              ${isInputRecord ? "" : `<option value="field" ${compareType === "field" ? "selected" : ""}>Another field</option>`}
              <option value="static" ${compareType === "static" ? "selected" : ""}>Static value</option>
            </select>
          </label>
          <label>
            Value
            ${compareType === "field"
              ? `<select data-check-compare-field="${index}">${renderFieldOptions(recordType, rule.compareField || "")}</select>`
              : useSearchValue
                ? `<div class="check-option-search" data-check-option-search="${index}" data-record-id="${escapeHtml(selectedField.recordTypeId)}" data-field-id="${escapeHtml(selectedField.id)}">
                    <input type="search" data-check-option-search-input="${index}" value="${escapeHtml(rule.staticValueLabel || rule.staticValue || "")}" placeholder="Search ${escapeHtml(selectedField.label)}" autocomplete="off">
                    <input type="hidden" data-check-static-value="${index}" value="${escapeHtml(rule.staticValue || "")}">
                    <div class="check-option-results" data-check-option-results="${index}" hidden></div>
                  </div>`
                : `<input data-check-static-value="${index}" value="${escapeHtml(rule.staticValue || "")}" placeholder="Static value">`}
          </label>
        </div>
        <button type="button" class="btn-secondary" data-remove-check-rule="${index}">Remove Check</button>
      </div>
    `;
  }

  function renderResponseOptions(node) {
    el.responseOptions.innerHTML = "";
    (node.options || []).forEach((option, index) => {
      const row = document.createElement("div");
      row.className = "response-option-row";
      row.innerHTML = `
        <input value="${escapeHtml(option.label || "")}" data-option-index="${index}" placeholder="Response option">
        <button type="button" data-remove-option="${index}">Remove</button>
      `;
      el.responseOptions.appendChild(row);
    });
  }

  function renderPathRules(node) {
    const outgoing = state.edges.filter((edge) => edge.from === node.id);
    el.pathRules.innerHTML = "";
    if (!outgoing.length) {
      el.pathRules.innerHTML = '<p class="workflow-status">No outgoing paths yet.</p>';
      return;
    }

    outgoing.forEach((edge) => {
      const target = state.nodes.find((item) => item.id === edge.to);
      const row = document.createElement("div");
      row.className = "path-rule-row";
      const options = (node.type === "question" || node.type === "check")
        ? (node.options || []).map((option) => `
            <option value="${escapeHtml(option.label || "")}" ${edge.label === option.label ? "selected" : ""}>${escapeHtml(option.label || "")}</option>
          `).join("")
        : "";
      row.innerHTML = `
        <small>To ${escapeHtml(target?.label || target?.type || "node")}</small>
        <div class="path-rule-controls">
          ${(node.type === "question" || node.type === "check")
            ? `<select data-edge-label="${escapeHtml(edge.id)}">${options}</select>`
            : `<input data-edge-label="${escapeHtml(edge.id)}" value="${escapeHtml(edge.label || "")}" placeholder="Optional path label">`}
          <button type="button" data-remove-edge="${escapeHtml(edge.id)}">Remove</button>
        </div>
      `;
      el.pathRules.appendChild(row);
    });
  }

  function render() {
    ensureStartNode();
    updateSurfaceBounds();
    renderNodes();
    renderEdges();
    renderProperties();
    renderExistingWorkflows();
    updateHistoryButtons();
  }

  function startNewWorkflow() {
    const before = snapshot();
    state.currentId = "";
    state.nodes = [];
    state.edges = [];
    state.settings = normaliseWorkflowSettings();
    state.debug = null;
    ensureStartNode();
    state.selectedNodeId = "";
    state.selectedEdgeId = "";
    el.select.value = "";
    el.name.value = "";
    el.description.value = "";
    renderWorkflowSettings();
    setBuilderTab("workflow");
    showWorkflowView("builder");
    render();
    setDeleteWorkflowPromptVisible(false);
    updateWorkflowDeleteButton();
    pushHistory(before);
    setStatus("New workflow");
  }

  function addNode(type, x, y) {
    const before = snapshot();
    const defaults = nodeDefaults(type);
    const node = {
      ...defaults,
      id: uid(type),
      type,
      x: Number.isFinite(x) ? x : 80 + state.nodes.length * 28,
      y: Number.isFinite(y) ? y : 80 + state.nodes.length * 28,
      options: Array.isArray(defaults.options) ? defaults.options.map((option) => ({ ...option })) : [],
    };
    state.nodes.push(node);
    state.selectedNodeId = node.id;
    switchToNodePropertiesFromWorkflowTab();
    render();
    pushHistory(before);
  }

  function startNodeDrag(event) {
    const node = state.nodes.find((item) => item.id === event.currentTarget.dataset.nodeId);
    if (!node) return;
    state.selectedNodeId = node.id;
    state.selectedEdgeId = "";
    state.drag = {
      node,
      startX: event.clientX,
      startY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
      moved: false,
      before: snapshot(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    refreshNodeSelection();
  }

  function startPortPointerDown(event) {
    event.stopPropagation();
    if (!event.shiftKey) return;
    event.preventDefault();

    const nodeId = event.currentTarget.dataset.inputNode || event.currentTarget.dataset.portNode || "";
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node) return;

    state.selectedNodeId = node.id;
    state.selectedEdgeId = "";
    state.portDrag = {
      node,
      kind: event.currentTarget.dataset.inputNode ? "input" : "output",
      label: event.currentTarget.dataset.portLabel || "",
      before: snapshot(),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setStatus("Move the connector around the node border.");
  }

  function nearestBorderPosition(node, clientX, clientY) {
    const rect = el.canvas.getBoundingClientRect();
    const localX = (clientX - rect.left + el.canvas.scrollLeft) / state.zoom - node.x;
    const localY = (clientY - rect.top + el.canvas.scrollTop) / state.zoom - node.y;
    const distances = [
      { side: "top", value: Math.abs(localY), t: localX / NODE_WIDTH },
      { side: "right", value: Math.abs(localX - NODE_WIDTH), t: localY / NODE_HEIGHT },
      { side: "bottom", value: Math.abs(localY - NODE_HEIGHT), t: localX / NODE_WIDTH },
      { side: "left", value: Math.abs(localX), t: localY / NODE_HEIGHT },
    ].sort((a, b) => a.value - b.value);
    return {
      side: distances[0].side,
      t: clamp(distances[0].t, 0.08, 0.92),
    };
  }

  function updateDraggedPort(event) {
    if (!state.portDrag) return false;
    const { node, kind, label } = state.portDrag;
    const position = nearestBorderPosition(node, event.clientX, event.clientY);
    if (kind === "input") {
      node.inputPort = position;
    } else {
      node.outputPorts = node.outputPorts || {};
      node.outputPorts[portKey(label)] = position;
    }
    state.portDrag.moved = true;
    render();
    return true;
  }

  function startCanvasPan(event) {
    if (event.button !== 0) return;
    if (event.target.closest?.(".workflow-node, .workflow-output-port, .workflow-input-port, .workflow-edge, .workflow-edge-hit, .workflow-edge-label")) return;
    event.preventDefault();
    state.selectedNodeId = "";
    state.selectedEdgeId = "";
    state.pan = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: el.canvas.scrollLeft,
      scrollTop: el.canvas.scrollTop,
    };
    el.canvas.classList.add("panning");
    el.canvas.setPointerCapture(event.pointerId);
    renderProperties();
  }

  function onNodeClick(event) {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    const id = event.currentTarget.dataset.nodeId;
    state.selectedNodeId = id;
    state.selectedEdgeId = "";
    switchToNodePropertiesFromWorkflowTab();
    render();
  }

  function onEdgeClick(event) {
    event.stopPropagation();
    event.preventDefault();
    state.selectedEdgeId = event.currentTarget.dataset.edgeId || "";
    state.selectedNodeId = "";
    render();
  }

  function startPathDrag(event) {
    event.stopPropagation();
    const from = event.currentTarget.dataset.portNode || "";
    const label = event.currentTarget.dataset.portLabel || "";
    state.pathPreview = {
      from,
      label,
      toPoint: canvasPointFromClient(event.clientX, event.clientY),
    };
    renderEdges();
    event.dataTransfer.effectAllowed = "link";
    event.dataTransfer.setData("application/x-workflow-path", JSON.stringify({ from, label }));
    event.dataTransfer.setData("text/plain", "workflow-path");
    setStatus(label ? `Dragging path from "${label}".` : "Dragging path.");
  }

  function allowPathDrop(event) {
    if (!Array.from(event.dataTransfer.types || []).includes("application/x-workflow-path")) return;
    event.preventDefault();
    const to = event.currentTarget.dataset.inputNode || "";
    const node = state.nodes.find((item) => item.id === to);
    state.pathPreview = {
      ...(state.pathPreview || {}),
      toPoint: node ? portPoint(node, "input") : canvasPointFromClient(event.clientX, event.clientY),
    };
    renderEdges();
    event.currentTarget.classList.add("drag-over");
  }

  function clearPathDrop(event) {
    event.currentTarget.classList.remove("drag-over");
  }

  function dropPathOnInput(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove("drag-over");
    const raw = event.dataTransfer.getData("application/x-workflow-path");
    if (!raw) return;
    let path = null;
    try {
      path = JSON.parse(raw);
    } catch {
      return;
    }
    const to = event.currentTarget.dataset.inputNode || "";
    if (!path.from || !to || path.from === to) return;
    const before = snapshot();
    state.edges.push({ id: uid("edge"), from: path.from, to, label: path.label || "" });
    state.pathPreview = null;
    state.selectedNodeId = path.from;
    state.selectedEdgeId = "";
    render();
    pushHistory(before);
    setStatus(path.label ? `Connected "${path.label}".` : "Connected path.");
  }

  el.canvas.addEventListener("dragover", (event) => {
    if (!state.pathPreview) return;
    if (!Array.from(event.dataTransfer?.types || []).includes("application/x-workflow-path")) return;
    event.preventDefault();
    state.pathPreview.toPoint = canvasPointFromClient(event.clientX, event.clientY);
    renderEdges();
  });

  el.canvas.addEventListener("dragleave", (event) => {
    if (!state.pathPreview) return;
    if (el.canvas.contains(event.relatedTarget)) return;
    state.pathPreview = null;
    renderEdges();
  });

  document.addEventListener("dragend", () => {
    if (!state.pathPreview) return;
    state.pathPreview = null;
    renderEdges();
  });

  document.addEventListener("pointermove", (event) => {
    if (updateDraggedPort(event)) return;

    if (state.pan) {
      const dx = event.clientX - state.pan.startX;
      const dy = event.clientY - state.pan.startY;
      el.canvas.scrollLeft = state.pan.scrollLeft - dx;
      el.canvas.scrollTop = state.pan.scrollTop - dy;
      return;
    }

    if (!state.drag) return;
    const dx = event.clientX - state.drag.startX;
    const dy = event.clientY - state.drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.drag.moved = true;
    state.drag.node.x = Math.max(0, state.drag.nodeX + dx / state.zoom);
    state.drag.node.y = Math.max(0, state.drag.nodeY + dy / state.zoom);
    render();
  });

  document.addEventListener("pointerup", () => {
    if (state.portDrag) {
      if (state.portDrag.moved) pushHistory(state.portDrag.before);
      state.portDrag = null;
    }

    if (state.pan) {
      state.pan = null;
      el.canvas.classList.remove("panning");
    }

    if (state.drag?.moved) {
      state.suppressClick = true;
      pushHistory(state.drag.before);
    }
    state.drag = null;
  });

  document.querySelectorAll(".toolbox-item").forEach((tool) => {
    tool.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", tool.dataset.nodeType);
      event.dataTransfer.effectAllowed = "copy";
    });
    tool.addEventListener("click", () => {
      setStatus("Drag questions or actions into the workspace to add them.");
    });
  });

  el.canvas.addEventListener("dragover", (event) => event.preventDefault());
  el.canvas.addEventListener("pointerdown", startCanvasPan);
  el.edges.addEventListener("pointerdown", (event) => {
    if (event.target !== el.edges) return;
    startCanvasPan(event);
  });
  el.canvas.addEventListener("drop", (event) => {
    event.preventDefault();
    if (Array.from(event.dataTransfer.types || []).includes("application/x-workflow-path")) {
      return;
    }
    const type = event.dataTransfer.getData("text/plain");
    if (!type) return;
    const rect = el.canvas.getBoundingClientRect();
    addNode(
      type,
      (event.clientX - rect.left + el.canvas.scrollLeft) / state.zoom,
      (event.clientY - rect.top + el.canvas.scrollTop) / state.zoom
    );
  });

  el.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const previousZoom = state.zoom;
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    const nextZoom = clamp(previousZoom + delta, 0.2, 1.8);
    if (nextZoom === previousZoom) return;

    const rect = el.canvas.getBoundingClientRect();
    const node = selectedNode();
    const screenX = node ? el.canvas.clientWidth / 2 : event.clientX - rect.left;
    const screenY = node ? el.canvas.clientHeight / 2 : event.clientY - rect.top;
    const canvasX = node
      ? Number(node.x || 0) + NODE_WIDTH / 2
      : (screenX + el.canvas.scrollLeft) / previousZoom;
    const canvasY = node
      ? Number(node.y || 0) + NODE_HEIGHT / 2
      : (screenY + el.canvas.scrollTop) / previousZoom;
    setZoom(nextZoom);
    el.canvas.scrollLeft = canvasX * state.zoom - screenX;
    el.canvas.scrollTop = canvasY * state.zoom - screenY;
  }, { passive: false });

  const setWorkflowSidebarCollapsed = (collapsed) => {
    el.workflowShell?.classList.toggle("sidebar-collapsed", collapsed);
    if (el.workflowSidebarToggle) {
      el.workflowSidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      el.workflowSidebarToggle.setAttribute("aria-label", collapsed ? "Expand workflow panel" : "Collapse workflow panel");
      el.workflowSidebarToggle.setAttribute("title", collapsed ? "Expand panel" : "Collapse panel");
      const icon = el.workflowSidebarToggle.querySelector("span");
      if (icon) icon.textContent = collapsed ? "›" : "‹";
    }
    if (el.workflowSidebarExpandToggle) {
      el.workflowSidebarExpandToggle.hidden = !collapsed;
    }
  };

  el.workflowSidebarToggle?.addEventListener("click", () => {
    setWorkflowSidebarCollapsed(!el.workflowShell?.classList.contains("sidebar-collapsed"));
  });

  el.workflowSidebarExpandToggle?.addEventListener("click", () => {
    setWorkflowSidebarCollapsed(false);
  });

  el.darkModeToggles.forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const mode = toggle.checked ? "dark" : "light";
      localStorage.setItem("csWorkflowTheme", mode);
      applyWorkflowTheme(mode);
    });
  });

  [el.nodeLabel, el.nodeQuestion, el.nodeActionMessage].forEach((input) => {
    input.addEventListener("focus", () => {
      input.dataset.editSnapshot = snapshot();
    });
    input.addEventListener("change", () => {
      if (input.dataset.editSnapshot) pushHistory(input.dataset.editSnapshot);
      input.dataset.editSnapshot = "";
    });
    input.addEventListener("input", () => {
      const node = selectedNode();
      if (!node) return;
      node.label = el.nodeLabel.value;
      node.question = el.nodeQuestion.value;
      node.message = el.nodeActionMessage.value;
      renderNodes();
    });
  });

  [el.executionMode, el.pathwayDebug].forEach((input) => {
    if (!input) return;
    input.addEventListener("focus", () => {
      input.dataset.editSnapshot = snapshot();
    });
    input.addEventListener("change", () => {
      const before = input.dataset.editSnapshot || snapshot();
      state.settings = normaliseWorkflowSettings({
        executionMode: el.executionMode?.value,
        pathwayDebug: !!el.pathwayDebug?.checked,
      });
      renderWorkflowSettings();
      pushHistory(before);
      input.dataset.editSnapshot = "";
    });
  });

  document.getElementById("addWorkflowCriteriaBtn")?.addEventListener("click", () => {
    const before = snapshot();
    state.criteria = normaliseWorkflowCriteria(state.criteria);
    state.criteria.push(defaultWorkflowCriteriaRule("case"));
    renderWorkflowCriteria();
    pushHistory(before);
  });

  el.criteriaRules?.addEventListener("change", (event) => {
    const mappings = [
      ["workflowCriteriaSource", "source"],
      ["workflowCriteriaField", "field"],
      ["workflowCriteriaOperator", "operator"],
      ["workflowCriteriaCompareType", "compareType"],
      ["workflowCriteriaCompareField", "compareField"],
      ["workflowCriteriaStaticValue", "staticValue"],
    ];
    const match = mappings.find(([datasetKey]) => event.target.dataset[datasetKey] !== undefined);
    if (!match) return;
    const [datasetKey, property] = match;
    const index = Number(event.target.dataset[datasetKey]);
    if (!Number.isFinite(index)) return;
    state.criteria = normaliseWorkflowCriteria(state.criteria);
    if (!state.criteria[index]) return;
    const before = snapshot();
    state.criteria[index][property] = event.target.value;
    if (property === "source") {
      state.criteria[index] = defaultWorkflowCriteriaRule(event.target.value);
    }
    if (property === "field") {
      state.criteria[index].staticValue = "";
      state.criteria[index].staticValueLabel = "";
    }
    if (property === "compareType") {
      const fields = workflowCriteriaFields(state.criteria[index].source);
      state.criteria[index].compareField = state.criteria[index].compareField || fields[0]?.internalId || "";
      state.criteria[index].staticValue = state.criteria[index].staticValue || "";
    }
    renderWorkflowCriteria();
    pushHistory(before);
  });

  el.criteriaRules?.addEventListener("focusin", (event) => {
    const index = Number(event.target.dataset.workflowCriteriaOptionSearchInput);
    if (!Number.isFinite(index)) return;
    const picker = event.target.closest("[data-workflow-criteria-option-search]");
    const results = picker?.querySelector("[data-workflow-criteria-option-results]");
    if (!picker || !results || !results.hidden) return;
    loadCheckOptionResults(picker, results, event.target.value || "", "workflowCriteria").catch((err) => {
      results.hidden = false;
      results.innerHTML = `<button type="button" class="check-option-empty">${escapeHtml(err.message || "Could not load options")}</button>`;
    });
  });

  el.criteriaRules?.addEventListener("input", (event) => {
    const index = Number(event.target.dataset.workflowCriteriaOptionSearchInput);
    if (!Number.isFinite(index)) return;
    const picker = event.target.closest("[data-workflow-criteria-option-search]");
    const results = picker?.querySelector("[data-workflow-criteria-option-results]");
    if (!picker || !results) return;
    window.clearTimeout(picker._searchTimer);
    picker._searchTimer = window.setTimeout(() => {
      loadCheckOptionResults(picker, results, event.target.value || "", "workflowCriteria").catch((err) => {
        results.hidden = false;
        results.innerHTML = `<button type="button" class="check-option-empty">${escapeHtml(err.message || "Could not load options")}</button>`;
      });
    }, 220);
  });

  el.criteriaRules?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-workflow-criteria-option-id]");
    if (option) {
      selectWorkflowCriteriaOption(option);
      return;
    }
    const index = Number(event.target.dataset.removeWorkflowCriteria);
    if (!Number.isFinite(index)) return;
    const before = snapshot();
    state.criteria = normaliseWorkflowCriteria(state.criteria);
    state.criteria.splice(index, 1);
    renderWorkflowCriteria();
    pushHistory(before);
  });

  el.startCaseStatus?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "start") return;
    const before = snapshot();
    node.startStatusId = el.startCaseStatus.value || "";
    node.startStatusName = el.startCaseStatus.selectedOptions?.[0]?.textContent || "";
    if (!node.startStatusId) node.startStatusName = "";
    render();
    pushHistory(before);
  });

  el.addInputField?.addEventListener("click", () => {
    const node = selectedNode();
    if (!node || node.type !== "input") return;
    const before = snapshot();
    const config = ensureInputConfig(node);
    config.fields.push({
      id: `input_${Date.now()}`,
      label: `Response ${config.fields.length + 1}`,
      type: "string",
      listSource: "salesOrderItems",
      listField: "",
    });
    render();
    el.inputConfigWrap.open = true;
    pushHistory(before);
  });

  el.inputFieldsList?.addEventListener("input", (event) => {
    const id = event.target.dataset.inputFieldLabel;
    if (!id) return;
    const node = selectedNode();
    if (!node || node.type !== "input") return;
    const field = ensureInputConfig(node).fields.find((item) => String(item.id) === String(id));
    if (!field) return;
    field.label = event.target.value || "";
  });

  el.inputFieldsList?.addEventListener("change", (event) => {
    const node = selectedNode();
    if (!node || node.type !== "input") return;
    const before = snapshot();
    const config = ensureInputConfig(node);
    const typeId = event.target.dataset.inputFieldType;
    const sourceId = event.target.dataset.inputFieldSource;
    const listFieldId = event.target.dataset.inputFieldListField;
    const id = typeId || sourceId || listFieldId;
    const field = config.fields.find((item) => String(item.id) === String(id));
    if (!field) return;
    if (typeId) {
      field.type = event.target.value || "string";
      if (field.type !== "list") {
        field.listSource = "salesOrderItems";
        field.listField = "";
      }
    }
    if (sourceId) {
      field.listSource = event.target.value || "salesOrderItems";
      const record = inputSourceRecord(field.listSource);
      field.listField = Array.isArray(record?.fields) && record.fields.length ? record.fields[0].internalId || "" : "";
    }
    if (listFieldId) field.listField = event.target.value || "";
    config.type = config.fields[0]?.type || "string";
    config.listSource = config.fields[0]?.listSource || "salesOrderItems";
    config.listField = config.fields[0]?.listField || "";
    render();
    el.inputConfigWrap.open = true;
    pushHistory(before);
  });

  el.inputFieldsList?.addEventListener("click", (event) => {
    const id = event.target.dataset.removeInputField;
    if (!id) return;
    const node = selectedNode();
    if (!node || node.type !== "input") return;
    const before = snapshot();
    const config = ensureInputConfig(node);
    if (config.fields.length <= 1) return;
    config.fields = config.fields.filter((field) => String(field.id) !== String(id));
    config.type = config.fields[0]?.type || "string";
    config.listSource = config.fields[0]?.listSource || "salesOrderItems";
    config.listField = config.fields[0]?.listField || "";
    render();
    el.inputConfigWrap.open = true;
    pushHistory(before);
  });

  el.inputType?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "input") return;
    const before = snapshot();
    const config = ensureInputConfig(node);
    config.type = el.inputType.value || "string";
    if (config.type !== "list") {
      config.listSource = "salesOrderItems";
      config.listField = "";
    }
    render();
    el.inputConfigWrap.open = true;
    pushHistory(before);
  });

  el.inputListSource?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "input") return;
    const before = snapshot();
    const config = ensureInputConfig(node);
    config.listSource = el.inputListSource.value || "salesOrderItems";
    const record = inputSourceRecord(config.listSource);
    config.listField = Array.isArray(record?.fields) && record.fields.length ? record.fields[0].internalId || "" : "";
    render();
    el.inputConfigWrap.open = true;
    pushHistory(before);
  });

  el.inputListField?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "input") return;
    const before = snapshot();
    ensureInputConfig(node).listField = el.inputListField.value || "";
    render();
    el.inputConfigWrap.open = true;
    pushHistory(before);
  });

  el.actionType?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const before = snapshot();
    const config = ensureActionConfig(node);
    config.type = el.actionType.value || "";
    if (config.type === "createRecord" && !config.createRecord.mappings.length) {
      config.createRecord.mappings.push(defaultCreateRecordMapping(config.createRecord));
    }
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
  });

  el.actionMandatory?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const before = snapshot();
    ensureActionConfig(node).mandatory = el.actionMandatory.checked;
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
  });

  el.itemLineItem?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const before = snapshot();
    ensureActionConfig(node).itemLineAction.itemSource = el.itemLineItem.value || "caseAffectedItem";
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
  });

  el.itemLineInput?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const before = snapshot();
    ensureActionConfig(node).itemLineAction.inputNodeId = el.itemLineInput.value || "";
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
  });

  el.itemLineSource?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const before = snapshot();
    const itemLine = ensureActionConfig(node).itemLineAction;
    const nextTarget = el.itemLineSource.value || "storeSalesOrder";
    if ((itemLine.target || itemLine.source || "storeSalesOrder") !== nextTarget) {
      itemLine.mappings = [];
    }
    itemLine.target = nextTarget;
    itemLine.source = itemLine.target;
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
  });

  el.itemLineMapButton?.addEventListener("click", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const itemLine = ensureActionConfig(node).itemLineAction;
    itemLine.target = itemLine.target || itemLine.source || "storeSalesOrder";
    itemLine.source = itemLine.target;
    localStorage.setItem("csCreateRecordMapDraft", JSON.stringify({
      mapMode: "itemLineAction",
      nodeId: node.id,
      workflowId: state.currentId || "",
      records: state.records,
      nodes: state.nodes,
      edges: state.edges,
      itemLineAction: itemLine,
    }));
    window.open(
      "/cs-workflows/create-record-map",
      "csItemLineMap",
      "width=1180,height=760,resizable=yes,scrollbars=yes"
    );
    render();
    el.actionConfigWrap.open = true;
  });

  el.createRecordTarget?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const before = snapshot();
    const createConfig = ensureActionConfig(node).createRecord;
    createConfig.targetRecord = el.createRecordTarget.value || "salesOrder";
    createConfig.mappings = createConfig.mappings.map((mapping) => ({
      ...mapping,
      targetField: createRecordTargetRecord(createConfig.targetRecord)?.fields?.[0]?.internalId || "",
    }));
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
  });

  el.createRecordSource?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const before = snapshot();
    const createConfig = ensureActionConfig(node).createRecord;
    createConfig.sourceRecord = el.createRecordSource.value || "storeSalesOrder";
    createConfig.mappings = createConfig.mappings.map((mapping) => ({
      ...mapping,
      sourceField: createRecordSourceRecord(createConfig.sourceRecord)?.fields?.[0]?.internalId || "",
    }));
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
  });

  el.createRecordMapButton?.addEventListener("click", () => {
    const node = selectedNode();
    if (!node || node.type !== "action") return;
    const createConfig = ensureActionConfig(node).createRecord;
    if (!createConfig.mappings.length) {
      createConfig.mappings.push(defaultCreateRecordMapping(createConfig));
    }
    localStorage.setItem("csCreateRecordMapDraft", JSON.stringify({
      nodeId: node.id,
      workflowId: state.currentId || "",
      records: state.records,
      nodes: state.nodes,
      edges: state.edges,
      createRecord: createConfig,
    }));
    window.open(
      "/cs-workflows/create-record-map",
      "csCreateRecordMap",
      "width=1180,height=760,resizable=yes,scrollbars=yes"
    );
    render();
    el.actionConfigWrap.open = true;
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const payload = event.data || {};
    if (!["cs-create-record-map-saved", "cs-item-line-map-saved"].includes(payload.type)) return;
    const node = state.nodes.find((item) => String(item.id) === String(payload.nodeId));
    if (!node || node.type !== "action") return;
    const before = snapshot();
    const config = ensureActionConfig(node);
    if (payload.type === "cs-item-line-map-saved") {
      config.type = "itemLineAction";
      config.itemLineAction = {
        ...config.itemLineAction,
        ...(payload.itemLineAction || {}),
        mappings: Array.isArray(payload.itemLineAction?.mappings) ? payload.itemLineAction.mappings : [],
      };
      config.itemLineAction.target = config.itemLineAction.target || config.itemLineAction.source || "storeSalesOrder";
      config.itemLineAction.source = config.itemLineAction.target;
      state.selectedNodeId = node.id;
      render();
      el.actionConfigWrap.open = true;
      pushHistory(before);
      setStatus("Item line mapping updated. Saving workflow...");
      saveWorkflow()
        .then(() => setStatus("Item line mapping saved."))
        .catch((err) => setStatus(err.message || "Item line mapping updated, but workflow save failed."));
      return;
    }
    config.type = "createRecord";
    config.createRecord = {
      ...config.createRecord,
      ...(payload.createRecord || {}),
      mappings: Array.isArray(payload.createRecord?.mappings) ? payload.createRecord.mappings : [],
    };
    state.selectedNodeId = node.id;
    render();
    el.actionConfigWrap.open = true;
    pushHistory(before);
    setStatus("Create record mapping updated. Saving workflow...");
    saveWorkflow()
      .then(() => setStatus("Create record mapping saved."))
      .catch((err) => setStatus(err.message || "Create record mapping updated, but workflow save failed."));
  });

  document.getElementById("addOptionBtn").addEventListener("click", () => {
    const node = selectedNode();
    if (!node) return;
    const before = snapshot();
    node.options = Array.isArray(node.options) ? node.options : [];
    node.options.push({ label: "New option" });
    render();
    pushHistory(before);
  });

  el.checkRecordType.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "check") return;
    const before = snapshot();
    const config = ensureCheckConfig(node);
    config.recordType = el.checkRecordType.value || "affectedItem";
    config.affectedItemSource = config.affectedItemSource || "storeSalesOrder";
    if (config.recordType === "input") {
      const inputs = availableInputNodesForCheck(node);
      config.inputNodeId = inputs[0]?.id || "";
    }
    const fieldRecordType = checkFieldRecordType(config);
    config.rules = config.rules.map((rule) => ({
      ...rule,
      field: checkFieldOptions(fieldRecordType)[0]?.value || "",
      compareField: checkFieldOptions(fieldRecordType)[1]?.value || checkFieldOptions(fieldRecordType)[0]?.value || "",
      compareType: fieldRecordType === "input" ? "static" : rule.compareType || "field",
    }));
    render();
    el.checkWrap.open = true;
    pushHistory(before);
  });

  el.checkInputSource?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "check") return;
    const before = snapshot();
    const config = ensureCheckConfig(node);
    config.inputNodeId = el.checkInputSource.value || "";
    const fieldRecordType = checkFieldRecordType(config);
    config.rules = config.rules.map((rule) => ({
      ...rule,
      field: checkFieldOptions(fieldRecordType)[0]?.value || "",
      compareField: checkFieldOptions(fieldRecordType)[1]?.value || checkFieldOptions(fieldRecordType)[0]?.value || "",
      compareType: fieldRecordType === "input" ? "static" : "field",
    }));
    render();
    el.checkWrap.open = true;
    pushHistory(before);
  });

  el.checkAffectedItemSource?.addEventListener("change", () => {
    const node = selectedNode();
    if (!node || node.type !== "check") return;
    const before = snapshot();
    const config = ensureCheckConfig(node);
    config.affectedItemSource = el.checkAffectedItemSource.value || "storeSalesOrder";
    render();
    el.checkWrap.open = true;
    pushHistory(before);
  });

  document.getElementById("addCheckRuleBtn").addEventListener("click", () => {
    const node = selectedNode();
    if (!node || node.type !== "check") return;
    const before = snapshot();
    const config = ensureCheckConfig(node);
    const fieldRecordType = checkFieldRecordType(config);
    const fields = checkFieldOptions(fieldRecordType);
    config.rules.push({
      ...defaultCheckRule(),
      field: fields[1]?.value || fields[0]?.value || "",
      compareField: fields[0]?.value || "",
      compareType: fieldRecordType === "input" ? "static" : "field",
    });
    render();
    el.checkWrap.open = true;
    pushHistory(before);
  });

  el.checkRules.addEventListener("change", updateCheckRuleFromEvent);
  el.checkRules.addEventListener("focusin", (event) => {
    const index = Number(event.target.dataset.checkOptionSearchInput);
    if (!Number.isFinite(index)) return;
    const picker = event.target.closest("[data-check-option-search]");
    const results = picker?.querySelector("[data-check-option-results]");
    if (!picker || !results || !results.hidden) return;
    loadCheckOptionResults(picker, results, event.target.value || "").catch((err) => {
      results.hidden = false;
      results.innerHTML = `<button type="button" class="check-option-empty">${escapeHtml(err.message || "Could not load options")}</button>`;
    });
  });
  el.checkRules.addEventListener("input", (event) => {
    const index = Number(event.target.dataset.checkOptionSearchInput);
    if (!Number.isFinite(index)) return;
    const picker = event.target.closest("[data-check-option-search]");
    const results = picker?.querySelector("[data-check-option-results]");
    if (!picker || !results) return;
    window.clearTimeout(picker._searchTimer);
    picker._searchTimer = window.setTimeout(() => {
      loadCheckOptionResults(picker, results, event.target.value || "").catch((err) => {
        results.hidden = false;
        results.innerHTML = `<button type="button" class="check-option-empty">${escapeHtml(err.message || "Could not load options")}</button>`;
      });
    }, 220);
  });
  el.checkRules.addEventListener("click", (event) => {
    const option = event.target.closest("[data-check-option-id]");
    if (option) {
      selectCheckOption(option);
      return;
    }
    const index = Number(event.target.dataset.removeCheckRule);
    if (!Number.isFinite(index)) return;
    const node = selectedNode();
    if (!node || node.type !== "check") return;
    const before = snapshot();
    ensureCheckConfig(node).rules.splice(index, 1);
    render();
    el.checkWrap.open = true;
    pushHistory(before);
  });

  async function loadCheckOptionResults(picker, results, search = "", mode = "check") {
    const recordId = picker.dataset.recordId;
    const fieldId = picker.dataset.fieldId;
    if (!recordId || !fieldId) return;
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    const data = await api(`/records/${encodeURIComponent(recordId)}/fields/${encodeURIComponent(fieldId)}/options${params.toString() ? `?${params}` : ""}`);
    const options = Array.isArray(data.options) ? data.options : [];
    results.hidden = false;
    const idAttr = mode === "workflowCriteria" ? "data-workflow-criteria-option-id" : "data-check-option-id";
    const nameAttr = mode === "workflowCriteria" ? "data-workflow-criteria-option-name" : "data-check-option-name";
    results.innerHTML = options.length
      ? options.map((item) => `
        <button type="button" ${idAttr}="${escapeHtml(item.id)}" ${nameAttr}="${escapeHtml(item.name)}">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(item.id)}</small>
        </button>
      `).join("")
      : '<button type="button" class="check-option-empty">No matches</button>';
  }

  function selectCheckOption(option) {
    const picker = option.closest("[data-check-option-search]");
    const index = Number(picker?.dataset.checkOptionSearch);
    const node = selectedNode();
    if (!picker || !node || !Number.isFinite(index)) return;
    const config = ensureCheckConfig(node);
    if (!config.rules[index]) return;
    const before = snapshot();
    config.rules[index].staticValue = option.dataset.checkOptionId || "";
    config.rules[index].staticValueLabel = option.dataset.checkOptionName || option.dataset.checkOptionId || "";
    render();
    el.checkWrap.open = true;
    pushHistory(before);
  }

  function selectWorkflowCriteriaOption(option) {
    const picker = option.closest("[data-workflow-criteria-option-search]");
    const index = Number(picker?.dataset.workflowCriteriaOptionSearch);
    if (!picker || !Number.isFinite(index)) return;
    state.criteria = normaliseWorkflowCriteria(state.criteria);
    if (!state.criteria[index]) return;
    const before = snapshot();
    state.criteria[index].staticValue = option.dataset.workflowCriteriaOptionId || "";
    state.criteria[index].staticValueLabel = option.dataset.workflowCriteriaOptionName || option.dataset.workflowCriteriaOptionId || "";
    renderWorkflowCriteria();
    pushHistory(before);
  }

  function updateCheckRuleFromEvent(event) {
    const node = selectedNode();
    if (!node || node.type !== "check") return;
    const config = ensureCheckConfig(node);
    const mappings = [
      ["checkField", "field"],
      ["checkOperator", "operator"],
      ["checkCompareType", "compareType"],
      ["checkCompareField", "compareField"],
      ["checkStaticValue", "staticValue"],
    ];
    const match = mappings.find(([datasetKey]) => event.target.dataset[datasetKey] !== undefined);
    if (!match) return;
    const [datasetKey, property] = match;
    const index = Number(event.target.dataset[datasetKey]);
    if (!Number.isFinite(index) || !config.rules[index]) return;
    const before = snapshot();
    config.rules[index][property] = event.target.value;
    if (property === "field") {
      config.rules[index].staticValue = "";
      config.rules[index].staticValueLabel = "";
    }
    if (property === "compareType") {
      const fields = checkFieldOptions(checkFieldRecordType(config));
      config.rules[index].compareField = config.rules[index].compareField || fields[0]?.value || "";
      config.rules[index].staticValue = config.rules[index].staticValue || "";
    }
    render();
    el.checkWrap.open = true;
    pushHistory(before);
  }

  el.responseOptions.addEventListener("input", (event) => {
    const index = Number(event.target.dataset.optionIndex);
    const node = selectedNode();
    if (!node || !Number.isFinite(index)) return;
    node.options[index].label = event.target.value;
    renderNodes();
  });

  el.responseOptions.addEventListener("focusin", (event) => {
    if (event.target.dataset.optionIndex === undefined) return;
    event.target.dataset.editSnapshot = snapshot();
  });

  el.responseOptions.addEventListener("change", (event) => {
    if (event.target.dataset.optionIndex === undefined) return;
    if (event.target.dataset.editSnapshot) pushHistory(event.target.dataset.editSnapshot);
    event.target.dataset.editSnapshot = "";
  });

  el.responseOptions.addEventListener("click", (event) => {
    const index = Number(event.target.dataset.removeOption);
    const node = selectedNode();
    if (!node || !Number.isFinite(index)) return;
    const before = snapshot();
    node.options.splice(index, 1);
    render();
    pushHistory(before);
  });

  el.pathRules.addEventListener("focusin", (event) => {
    if (!event.target.dataset.edgeLabel) return;
    event.target.dataset.editSnapshot = snapshot();
  });

  el.pathRules.addEventListener("input", (event) => {
    const edgeId = event.target.dataset.edgeLabel;
    if (!edgeId) return;
    const edge = state.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    edge.label = event.target.value;
    renderEdges();
  });

  el.pathRules.addEventListener("change", (event) => {
    const edgeId = event.target.dataset.edgeLabel;
    if (!edgeId) return;
    const edge = state.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    edge.label = event.target.value;
    if (event.target.dataset.editSnapshot) pushHistory(event.target.dataset.editSnapshot);
    event.target.dataset.editSnapshot = "";
    renderEdges();
  });

  el.pathRules.addEventListener("click", (event) => {
    const edgeId = event.target.dataset.removeEdge;
    if (!edgeId) return;
    const before = snapshot();
    state.edges = state.edges.filter((edge) => edge.id !== edgeId);
    if (state.selectedEdgeId === edgeId) state.selectedEdgeId = "";
    render();
    pushHistory(before);
  });

  function deleteSelectedWorkflowItem() {
    if (!state.selectedNodeId && !state.selectedEdgeId) return false;
    const before = snapshot();

    if (state.selectedNodeId) {
      const id = state.selectedNodeId;
      const node = state.nodes.find((item) => item.id === id);
      if (node?.type === "start") {
        setStatus("Start node cannot be deleted.");
        return false;
      }
      state.nodes = state.nodes.filter((node) => node.id !== id);
      state.edges = state.edges.filter((edge) => edge.from !== id && edge.to !== id);
      state.selectedNodeId = "";
      state.selectedEdgeId = "";
      render();
      pushHistory(before);
      setStatus("Node deleted.");
      return true;
    }

    if (state.selectedEdgeId) {
      state.edges = state.edges.filter((edge) => edge.id !== state.selectedEdgeId);
      state.selectedEdgeId = "";
      render();
      pushHistory(before);
      setStatus("Path deleted.");
      return true;
    }

    return false;
  }

  document.getElementById("deleteNodeBtn").addEventListener("click", deleteSelectedWorkflowItem);

  document.getElementById("newWorkflowBtn")?.addEventListener("click", startNewWorkflow);

  el.undo?.addEventListener("click", undoWorkflow);
  el.redo?.addEventListener("click", redoWorkflow);
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const isUndo = (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
    const isRedo = (event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey));
    const isDelete = key === "delete" || key === "backspace";
    if (!isUndo && !isRedo && !isDelete) return;
    if (/^(input|textarea|select)$/i.test(event.target?.tagName || "")) return;
    event.preventDefault();
    if (isUndo) undoWorkflow();
    if (isRedo) redoWorkflow();
    if (isDelete) deleteSelectedWorkflowItem();
  });

  async function saveWorkflow() {
    const payload = {
      name: el.name.value.trim(),
      description: el.description.value.trim(),
      definition: currentWorkflowDefinition(),
      isActive: true,
    };
    if (!payload.name) {
      setStatus("Workflow name is required.");
      return;
    }
    const path = state.currentId ? `/${state.currentId}` : "";
    const method = state.currentId ? "PUT" : "POST";
    const data = await api(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.currentId = String(data.workflow.id);
    setStatus("Saved");
    await loadWorkflows(state.currentId);
  }

  function setDeleteWorkflowPromptVisible(visible) {
    if (el.deleteWorkflowConfirm) el.deleteWorkflowConfirm.hidden = !visible;
  }

  function updateWorkflowDeleteButton() {
    if (el.deleteWorkflow) {
      el.deleteWorkflow.disabled = !state.currentId;
      el.deleteWorkflow.title = state.currentId ? "Delete workflow" : "Save the workflow before deleting it";
    }
  }

  async function deleteCurrentWorkflow() {
    if (!state.currentId) {
      setStatus("Save the workflow before deleting it.");
      return;
    }
    const deletedId = state.currentId;
    await api(`/${encodeURIComponent(deletedId)}`, { method: "DELETE" });
    setDeleteWorkflowPromptVisible(false);
    state.currentId = "";
    state.nodes = [];
    state.edges = [];
    state.selectedNodeId = "";
    state.selectedEdgeId = "";
    state.criteria = [];
    state.settings = normaliseWorkflowSettings();
    state.undo = [];
    state.redo = [];
    el.name.value = "";
    el.description.value = "";
    ensureStartNode();
    renderWorkflowSettings();
    renderWorkflowCriteria();
    render();
    updateHistoryButtons();
    updateWorkflowDeleteButton();
    setStatus("Workflow deleted.");
    await loadWorkflows();
    setBuilderTab("workflow");
  }

  document.getElementById("saveWorkflowBtn")?.addEventListener("click", () => {
    setDeleteWorkflowPromptVisible(false);
    saveWorkflow().catch((err) => setStatus(err.message || "Failed to save workflow."));
  });

  el.deleteWorkflow?.addEventListener("click", () => {
    if (!state.currentId) {
      setStatus("Save the workflow before deleting it.");
      return;
    }
    setDeleteWorkflowPromptVisible(true);
  });

  el.cancelDeleteWorkflow?.addEventListener("click", () => {
    setDeleteWorkflowPromptVisible(false);
  });

  el.confirmDeleteWorkflow?.addEventListener("click", () => {
    deleteCurrentWorkflow().catch((err) => setStatus(err.message || "Failed to delete workflow."));
  });

  function loadWorkflowIntoEditor(workflow) {
    state.currentId = workflow?.id ? String(workflow.id) : "";
    el.name.value = workflow?.name || "";
    el.description.value = workflow?.description || "";
    state.nodes = Array.isArray(workflow?.definition?.nodes) ? workflow.definition.nodes : [];
    state.edges = Array.isArray(workflow?.definition?.edges) ? workflow.definition.edges : [];
    ensureStartNode();
    state.settings = normaliseWorkflowSettings(workflow?.definition?.settings);
    state.criteria = normaliseWorkflowCriteria(workflow?.definition?.criteria);
    state.debug = null;
    state.selectedNodeId = "";
    state.selectedEdgeId = "";
    renderWorkflowSettings();
    renderWorkflowCriteria();
    setBuilderTab("workflow");
    renderWorkflowSelect();
    render();
    updateWorkflowDeleteButton();
    setDeleteWorkflowPromptVisible(false);
    window.requestAnimationFrame(fitWorkflowToView);
    try {
      const savedDebug = JSON.parse(localStorage.getItem("csWorkflowDebug") || "null");
      if (savedDebug) applyWorkflowDebug(savedDebug);
    } catch {}
  }

  async function loadWorkflows(selectId = "") {
    const data = await api("");
    state.workflows = data.workflows || [];
    renderWorkflowSelect();
    renderExistingWorkflows();
    if (selectId) {
      const workflow = state.workflows.find((item) => String(item.id) === String(selectId));
      if (workflow) loadWorkflowIntoEditor(workflow);
    }
    updateWorkflowDeleteButton();
  }

  async function loadWorkflowRecords() {
    const data = await api("/records");
    state.records = Array.isArray(data.records) ? data.records : [];
    if (state.selectedRecordId && !state.records.some((record) => String(record.id) === String(state.selectedRecordId))) {
      state.selectedRecordId = "";
      state.selectedRecordFieldId = "";
    }
    if (state.expandedRecordId && !state.records.some((record) => String(record.id) === String(state.expandedRecordId))) {
      state.expandedRecordId = "";
    }
    if (!state.selectedRecordId && state.records.length) {
      state.selectedRecordId = String(state.records[0].id);
    }
    renderRecordManagement();
    renderWorkflowCriteria();
    renderProperties();
  }

  async function saveWorkflowRecord(event) {
    event.preventDefault();
    const id = String(el.recordId.value || "").trim();
    const payload = {
      label: el.recordLabel.value.trim(),
      internalId: el.recordInternalId.value.trim(),
    };
    const data = await api(id ? `/records/${id}` : "/records", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.selectedRecordId = String(data.record?.id || id || "");
    state.selectedRecordFieldId = "";
    await loadWorkflowRecords();
    setStatus("Record saved.");
  }

  async function deleteWorkflowRecord() {
    const id = String(el.recordId.value || "").trim();
    if (!id) return;
    await api(`/records/${id}`, { method: "DELETE" });
    state.selectedRecordId = "";
    state.selectedRecordFieldId = "";
    await loadWorkflowRecords();
    setStatus("Record deleted.");
  }

  async function saveWorkflowRecordField(event) {
    event.preventDefault();
    const recordId = String(state.selectedRecordId || "").trim();
    if (!recordId) {
      setStatus("Select or save a record first.");
      return;
    }
    const id = String(el.fieldId.value || "").trim();
    const payload = {
      label: el.fieldLabel.value.trim(),
      internalId: el.fieldInternalId.value.trim(),
      fieldType: el.fieldType.value,
      sortOrder: Number(el.fieldSortOrder.value || 0),
      listValuesQuery: fieldUsesListQuery(el.fieldType.value) ? el.fieldListQuery.value.trim() : "",
    };
    const data = await api(id ? `/records/${recordId}/fields/${id}` : `/records/${recordId}/fields`, {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.selectedRecordFieldId = String(data.field?.id || id || "");
    await loadWorkflowRecords();
    setStatus("Field saved.");
  }

  async function deleteWorkflowRecordField() {
    const recordId = String(state.selectedRecordId || "").trim();
    const fieldId = String(el.fieldId.value || "").trim();
    if (!recordId || !fieldId) return;
    await api(`/records/${recordId}/fields/${fieldId}`, { method: "DELETE" });
    state.selectedRecordFieldId = "";
    await loadWorkflowRecords();
    setStatus("Field deleted.");
  }

  async function saveInlineRecord(recordId) {
    const id = String(recordId || "").trim();
    const payload = {
      label: el.recordsList.querySelector(`[data-record-label="${CSS.escape(id)}"]`)?.value.trim() || "",
      internalId: el.recordsList.querySelector(`[data-record-internal-id="${CSS.escape(id)}"]`)?.value.trim() || "",
    };
    const data = await api(id ? `/records/${id}` : "/records", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.selectedRecordId = String(data.record?.id || id || "");
    await loadWorkflowRecords();
    setStatus("Record saved.");
  }

  async function addInlineRecord() {
    const data = await api("/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "New Record", internalId: `record_${Date.now()}` }),
    });
    state.selectedRecordId = String(data.record?.id || "");
    state.expandedRecordId = state.selectedRecordId;
    state.selectedRecordFieldId = "";
    await loadWorkflowRecords();
    setStatus("Record added.");
  }

  async function deleteInlineRecord(recordId) {
    const id = String(recordId || "").trim();
    if (!id) return;
    await api(`/records/${id}`, { method: "DELETE" });
    state.selectedRecordId = "";
    state.expandedRecordId = "";
    state.selectedRecordFieldId = "";
    await loadWorkflowRecords();
    setStatus("Record deleted.");
  }

  async function addInlineField() {
    const recordId = String(state.selectedRecordId || "").trim();
    if (!recordId) {
      setStatus("Select or add a record first.");
      return;
    }
    const nextSortOrder = ((selectedRecord()?.fields || []).length + 1) * 10;
    const data = await api(`/records/${recordId}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "New Field",
        internalId: `field_${Date.now()}`,
        fieldType: "free-form text",
        sortOrder: nextSortOrder,
        listValuesQuery: "",
      }),
    });
    state.selectedRecordFieldId = String(data.field?.id || "");
    await loadWorkflowRecords();
    setStatus("Field added.");
  }

  async function saveInlineField(fieldId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const id = String(fieldId || "").trim();
    if (!recordId || !id) return;
    const field = (selectedRecord()?.fields || []).find((item) => String(item.id) === id) || {};
    const row = el.fieldsList.querySelector(`[data-field-id="${CSS.escape(id)}"]`);
    const rowIndex = Array.from(el.fieldsList.querySelectorAll("[data-field-id]")).indexOf(row);
    const fieldType = row?.querySelector(`[data-field-type="${CSS.escape(id)}"]`)?.value || "free-form text";
    const payload = {
      label: row?.querySelector(`[data-field-label="${CSS.escape(id)}"]`)?.value.trim() || "",
      internalId: row?.querySelector(`[data-field-internal-id="${CSS.escape(id)}"]`)?.value.trim() || "",
      fieldType,
      sortOrder: Math.max(0, rowIndex) * 10,
      listValuesQuery: fieldUsesListQuery(fieldType) ? String(field.listValuesQuery || "") : "",
    };
    const data = await api(`/records/${recordId}/fields/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.selectedRecordFieldId = String(data.field?.id || id);
    await loadWorkflowRecords();
    setStatus("Field saved.");
  }

  async function saveSuiteQlForSelectedField() {
    const recordId = String(state.selectedRecordId || "").trim();
    const id = String(state.selectedRecordFieldId || "").trim();
    if (!recordId || !id) return;
    const field = (selectedRecord()?.fields || []).find((item) => String(item.id) === id) || {};
    const row = el.fieldsList.querySelector(`[data-field-id="${CSS.escape(id)}"]`);
    const rowIndex = Array.from(el.fieldsList.querySelectorAll("[data-field-id]")).indexOf(row);
    const fieldType = row?.querySelector(`[data-field-type="${CSS.escape(id)}"]`)?.value || field.fieldType || "list/record";
    const payload = {
      label: row?.querySelector(`[data-field-label="${CSS.escape(id)}"]`)?.value.trim() || field.label || "",
      internalId: row?.querySelector(`[data-field-internal-id="${CSS.escape(id)}"]`)?.value.trim() || field.internalId || "",
      fieldType,
      sortOrder: Math.max(0, rowIndex) * 10,
      listValuesQuery: fieldUsesListQuery(fieldType) ? String(el.suiteQlEditor.value || "").trim() : "",
    };
    const data = await api(`/records/${recordId}/fields/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.selectedRecordFieldId = String(data.field?.id || id);
    await loadWorkflowRecords();
    setStatus("SuiteQL saved.");
  }

  async function deleteInlineField(fieldId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const id = String(fieldId || "").trim();
    if (!recordId || !id) return;
    await api(`/records/${recordId}/fields/${id}`, { method: "DELETE" });
    state.selectedRecordFieldId = "";
    await loadWorkflowRecords();
    setStatus("Field deleted.");
  }

  async function addInlineSublist() {
    const recordId = String(state.selectedRecordId || "").trim();
    if (!recordId) return setStatus("Select or add a record first.");
    const data = await api(`/records/${recordId}/sublists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "New Sublist", internalId: `sublist_${Date.now()}`, sortOrder: 0 }),
    });
    state.expandedSublistId = String(data.sublist?.id || "");
    await loadWorkflowRecords();
    setStatus("Sublist added.");
  }

  async function saveInlineSublist(sublistId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const id = String(sublistId || "").trim();
    if (!recordId || !id) return;
    const card = el.sublistsList.querySelector(`[data-sublist-id="${CSS.escape(id)}"]`);
    await api(`/records/${recordId}/sublists/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: card?.querySelector(`[data-sublist-label="${CSS.escape(id)}"]`)?.value.trim() || "",
        internalId: card?.querySelector(`[data-sublist-internal-id="${CSS.escape(id)}"]`)?.value.trim() || "",
        sortOrder: Number(card?.querySelector(`[data-sublist-sort-order="${CSS.escape(id)}"]`)?.value || 0),
      }),
    });
    await loadWorkflowRecords();
    setStatus("Sublist saved.");
  }

  async function deleteInlineSublist(sublistId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const id = String(sublistId || "").trim();
    if (!recordId || !id) return;
    await api(`/records/${recordId}/sublists/${id}`, { method: "DELETE" });
    state.expandedSublistId = "";
    await loadWorkflowRecords();
    setStatus("Sublist deleted.");
  }

  async function addInlineSublistField(sublistId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const id = String(sublistId || "").trim();
    if (!recordId || !id) return;
    const sublist = (selectedRecord()?.sublists || []).find((item) => String(item.id) === id);
    const nextSortOrder = ((sublist?.fields || []).length + 1) * 10;
    await api(`/records/${recordId}/sublists/${id}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "New Field", internalId: `field_${Date.now()}`, fieldType: "free-form text", sortOrder: nextSortOrder }),
    });
    state.expandedSublistId = id;
    await loadWorkflowRecords();
    setStatus("Sublist field added.");
  }

  async function saveInlineSublistField(fieldId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const field = el.sublistsList.querySelector(`[data-sublist-field-id="${CSS.escape(String(fieldId))}"]`);
    const sublistId = field?.dataset.sublistParentId;
    if (!recordId || !sublistId || !fieldId) return;
    await api(`/records/${recordId}/sublists/${sublistId}/fields/${fieldId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: field.querySelector(`[data-sublist-field-label="${CSS.escape(String(fieldId))}"]`)?.value.trim() || "",
        internalId: field.querySelector(`[data-sublist-field-internal-id="${CSS.escape(String(fieldId))}"]`)?.value.trim() || "",
        fieldType: field.querySelector(`[data-sublist-field-type="${CSS.escape(String(fieldId))}"]`)?.value || "free-form text",
        sortOrder: Math.max(0, Array.from(field.parentElement.querySelectorAll("[data-sublist-field-id]")).indexOf(field)) * 10,
      }),
    });
    await loadWorkflowRecords();
    setStatus("Sublist field saved.");
  }

  async function deleteInlineSublistField(fieldId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const field = el.sublistsList.querySelector(`[data-sublist-field-id="${CSS.escape(String(fieldId))}"]`);
    const sublistId = field?.dataset.sublistParentId;
    if (!recordId || !sublistId || !fieldId) return;
    await api(`/records/${recordId}/sublists/${sublistId}/fields/${fieldId}`, { method: "DELETE" });
    await loadWorkflowRecords();
    setStatus("Sublist field deleted.");
  }

  function moveDraggedRow(event, rowSelector) {
    const targetRow = event.target.closest(rowSelector);
    const draggingRow = document.querySelector(".field-row-dragging");
    if (!targetRow || !draggingRow || targetRow === draggingRow || targetRow.parentElement !== draggingRow.parentElement) return;
    const targetBox = targetRow.getBoundingClientRect();
    const insertAfter = event.clientY > targetBox.top + targetBox.height / 2;
    targetRow.parentElement.insertBefore(draggingRow, insertAfter ? targetRow.nextSibling : targetRow);
  }

  async function persistMainFieldOrder() {
    const recordId = String(state.selectedRecordId || "").trim();
    if (!recordId) return;
    const record = selectedRecord();
    const rows = Array.from(el.fieldsList.querySelectorAll("[data-field-id]"));
    await Promise.all(rows.map((row, index) => {
      const id = row.dataset.fieldId;
      const existing = (record?.fields || []).find((field) => String(field.id) === String(id)) || {};
      const fieldType = row.querySelector(`[data-field-type="${CSS.escape(id)}"]`)?.value || existing.fieldType || "free-form text";
      return api(`/records/${recordId}/fields/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: row.querySelector(`[data-field-label="${CSS.escape(id)}"]`)?.value.trim() || existing.label || "",
          internalId: row.querySelector(`[data-field-internal-id="${CSS.escape(id)}"]`)?.value.trim() || existing.internalId || "",
          fieldType,
          sortOrder: index * 10,
          listValuesQuery: fieldUsesListQuery(fieldType) ? String(existing.listValuesQuery || "") : "",
        }),
      });
    }));
    await loadWorkflowRecords();
    setStatus("Field order saved.");
  }

  async function persistSublistFieldOrder(sublistId) {
    const recordId = String(state.selectedRecordId || "").trim();
    const id = String(sublistId || "").trim();
    if (!recordId || !id) return;
    const sublist = (selectedRecord()?.sublists || []).find((item) => String(item.id) === id) || {};
    const rows = Array.from(el.sublistsList.querySelectorAll(`[data-sublist-parent-id="${CSS.escape(id)}"]`));
    await Promise.all(rows.map((row, index) => {
      const fieldId = row.dataset.sublistFieldId;
      const existing = (sublist.fields || []).find((field) => String(field.id) === String(fieldId)) || {};
      const fieldType = row.querySelector(`[data-sublist-field-type="${CSS.escape(fieldId)}"]`)?.value || existing.fieldType || "free-form text";
      return api(`/records/${recordId}/sublists/${id}/fields/${fieldId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: row.querySelector(`[data-sublist-field-label="${CSS.escape(fieldId)}"]`)?.value.trim() || existing.label || "",
          internalId: row.querySelector(`[data-sublist-field-internal-id="${CSS.escape(fieldId)}"]`)?.value.trim() || existing.internalId || "",
          fieldType,
          sortOrder: index * 10,
          listValuesQuery: fieldUsesListQuery(fieldType) ? String(existing.listValuesQuery || "") : "",
        }),
      });
    }));
    await loadWorkflowRecords();
    setStatus("Sublist field order saved.");
  }

  async function loadCaseStatuses() {
    try {
      const response = await fetch("/api/netsuite/salesorder/case-statuses", {
        headers: authHeaders(),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
      state.statuses = Array.isArray(data.statuses) ? data.statuses : [];
      renderStartStatusOptions();
      renderProperties();
    } catch (err) {
      setStatus(err.message || "Failed to load case statuses.");
    }
  }

  el.select.addEventListener("change", () => {
    const workflow = state.workflows.find((item) => String(item.id) === el.select.value);
    loadWorkflowIntoEditor(workflow || null);
  });

  el.existingList?.addEventListener("click", (event) => {
    const id = event.target.dataset.editWorkflow;
    if (!id) return;
    const workflow = state.workflows.find((item) => String(item.id) === String(id));
    if (workflow) {
      loadWorkflowIntoEditor(workflow);
      showWorkflowView("builder");
      setStatus(`Loaded ${workflow.name || "workflow"}.`);
    }
  });

  el.refresh?.addEventListener("click", () => {
    setStatus("Refreshing workflows...");
    loadWorkflows(state.currentId).then(() => setStatus("Workflows refreshed.")).catch((err) => {
      setStatus(err.message || "Failed to refresh workflows.");
    });
  });

  el.refreshRecords?.addEventListener("click", () => {
    setStatus("Refreshing record management...");
    loadWorkflowRecords().then(() => setStatus("Records refreshed.")).catch((err) => {
      setStatus(err.message || "Failed to refresh records.");
    });
  });

  el.recordForm?.addEventListener("submit", (event) => {
    saveWorkflowRecord(event).catch((err) => setStatus(err.message || "Failed to save record."));
  });

  el.newRecord?.addEventListener("click", clearRecordForm);
  el.addRecordInline?.addEventListener("click", () => {
    addInlineRecord().catch((err) => setStatus(err.message || "Failed to add record."));
  });

  el.deleteRecord?.addEventListener("click", () => {
    deleteWorkflowRecord().catch((err) => setStatus(err.message || "Failed to delete record."));
  });

  el.recordsList?.addEventListener("click", (event) => {
    const toggleId = event.target.closest("[data-toggle-record]")?.dataset.toggleRecord;
    if (toggleId) {
      state.expandedRecordId = String(state.expandedRecordId) === String(toggleId) ? "" : String(toggleId);
      renderRecordManagement();
      return;
    }
    const saveId = event.target.closest("[data-save-record-inline]")?.dataset.saveRecordInline;
    if (saveId) {
      saveInlineRecord(saveId).catch((err) => setStatus(err.message || "Failed to save record."));
      return;
    }
    const deleteId = event.target.closest("[data-delete-record-inline]")?.dataset.deleteRecordInline;
    if (deleteId) {
      deleteInlineRecord(deleteId).catch((err) => setStatus(err.message || "Failed to delete record."));
      return;
    }
    if (event.target.closest("input, select, textarea")) return;
    const row = event.target.closest("[data-record-select]");
    if (!row) return;
    state.selectedRecordId = row.dataset.recordSelect || "";
    state.selectedRecordFieldId = "";
    renderRecordManagement();
  });

  el.fieldForm?.addEventListener("submit", (event) => {
    saveWorkflowRecordField(event).catch((err) => setStatus(err.message || "Failed to save field."));
  });

  el.newField?.addEventListener("click", () => {
    addInlineField().catch((err) => setStatus(err.message || "Failed to add field."));
  });
  el.addSublist?.addEventListener("click", () => {
    addInlineSublist().catch((err) => setStatus(err.message || "Failed to add sublist."));
  });

  el.deleteField?.addEventListener("click", () => {
    deleteWorkflowRecordField().catch((err) => setStatus(err.message || "Failed to delete field."));
  });

  el.fieldsList?.addEventListener("click", (event) => {
    const suiteQlFieldId = event.target.closest("[data-edit-field-suiteql]")?.dataset.editFieldSuiteql;
    if (suiteQlFieldId) {
      event.preventDefault();
      event.stopPropagation();
      state.selectedRecordFieldId = suiteQlFieldId;
      const field = selectedRecordField();
      const row = event.target.closest("[data-field-id]");
      const rowFieldType = row?.querySelector(`[data-field-type="${CSS.escape(suiteQlFieldId)}"]`)?.value || field?.fieldType || "list/record";
      if (!fieldUsesListQuery(rowFieldType)) {
        setStatus("SuiteQL is only available for list/record or multiple select fields.");
        return;
      }
      el.fieldId.value = field?.id || "";
      el.fieldType.value = rowFieldType;
      el.fieldListQuery.value = field?.listValuesQuery || "";
      el.suiteQlEditor.value = el.fieldListQuery.value || "";
      openSuiteQlDialogDirect();
      return;
    }
    const saveId = event.target.closest("[data-save-field-inline]")?.dataset.saveFieldInline;
    if (saveId) {
      saveInlineField(saveId).catch((err) => setStatus(err.message || "Failed to save field."));
      return;
    }
    const deleteId = event.target.closest("[data-delete-field-inline]")?.dataset.deleteFieldInline;
    if (deleteId) {
      deleteInlineField(deleteId).catch((err) => setStatus(err.message || "Failed to delete field."));
      return;
    }
    if (event.target.closest("input, select, textarea")) return;
    const row = event.target.closest("[data-field-id]");
    if (!row) return;
    state.selectedRecordFieldId = row.dataset.fieldId || "";
    renderRecordManagement();
  });

  el.fieldsList?.addEventListener("change", (event) => {
    const fieldId = event.target.dataset.fieldType;
    if (!fieldId) return;
    const row = event.target.closest("[data-field-id]");
    const suiteQlCell = row?.querySelector(".record-suiteql-cell");
    if (suiteQlCell) {
      suiteQlCell.innerHTML = fieldUsesListQuery(event.target.value)
        ? `<button type="button" class="btn-secondary record-suiteql-edit" data-edit-field-suiteql="${escapeHtml(fieldId)}">Add SuiteQL</button> <span class="record-suiteql-state">Not set</span>`
        : '<span class="record-suiteql-state">Not applicable</span>';
    }
  });

  el.fieldsList?.addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-field-drag]");
    if (!handle) return;
    const row = handle.closest("[data-field-id]");
    row?.classList.add("field-row-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", handle.dataset.fieldDrag || "");
  });

  el.fieldsList?.addEventListener("dragover", (event) => {
    if (!document.querySelector(".field-row-dragging")) return;
    event.preventDefault();
    moveDraggedRow(event, "[data-field-id]");
  });

  el.fieldsList?.addEventListener("drop", (event) => {
    if (!document.querySelector(".field-row-dragging")) return;
    event.preventDefault();
    persistMainFieldOrder().catch((err) => setStatus(err.message || "Failed to save field order."));
  });

  el.fieldsList?.addEventListener("dragend", () => {
    document.querySelector(".field-row-dragging")?.classList.remove("field-row-dragging");
  });

  el.sublistsList?.addEventListener("click", (event) => {
    const toggleId = event.target.closest("[data-toggle-sublist]")?.dataset.toggleSublist;
    if (toggleId) {
      state.expandedSublistId = String(state.expandedSublistId) === String(toggleId) ? "" : String(toggleId);
      renderRecordManagement();
      return;
    }
    const addFieldId = event.target.closest("[data-add-sublist-field]")?.dataset.addSublistField;
    if (addFieldId) {
      addInlineSublistField(addFieldId).catch((err) => setStatus(err.message || "Failed to add sublist field."));
      return;
    }
    const saveSublistId = event.target.closest("[data-save-sublist]")?.dataset.saveSublist;
    if (saveSublistId) {
      saveInlineSublist(saveSublistId).catch((err) => setStatus(err.message || "Failed to save sublist."));
      return;
    }
    const deleteSublistId = event.target.closest("[data-delete-sublist]")?.dataset.deleteSublist;
    if (deleteSublistId) {
      deleteInlineSublist(deleteSublistId).catch((err) => setStatus(err.message || "Failed to delete sublist."));
      return;
    }
    const saveFieldId = event.target.closest("[data-save-sublist-field]")?.dataset.saveSublistField;
    if (saveFieldId) {
      saveInlineSublistField(saveFieldId).catch((err) => setStatus(err.message || "Failed to save sublist field."));
      return;
    }
    const deleteFieldId = event.target.closest("[data-delete-sublist-field]")?.dataset.deleteSublistField;
    if (deleteFieldId) {
      deleteInlineSublistField(deleteFieldId).catch((err) => setStatus(err.message || "Failed to delete sublist field."));
    }
  });

  el.sublistsList?.addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-sublist-field-drag]");
    if (!handle) return;
    const row = handle.closest("[data-sublist-field-id]");
    row?.classList.add("field-row-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", handle.dataset.sublistFieldDrag || "");
  });

  el.sublistsList?.addEventListener("dragover", (event) => {
    if (!document.querySelector(".field-row-dragging")) return;
    event.preventDefault();
    moveDraggedRow(event, "[data-sublist-field-id]");
  });

  el.sublistsList?.addEventListener("drop", (event) => {
    const draggingRow = document.querySelector(".field-row-dragging");
    const sublistId = draggingRow?.dataset.sublistParentId;
    if (!draggingRow || !sublistId) return;
    event.preventDefault();
    persistSublistFieldOrder(sublistId).catch((err) => setStatus(err.message || "Failed to save sublist field order."));
  });

  el.sublistsList?.addEventListener("dragend", () => {
    document.querySelector(".field-row-dragging")?.classList.remove("field-row-dragging");
  });

  el.fieldType?.addEventListener("change", () => {
    if (!fieldUsesListQuery(el.fieldType.value)) el.fieldListQuery.value = "";
    updateFieldSuiteQlControls();
  });

  function openSuiteQlDialog() {
    if (!fieldUsesListQuery(el.fieldType.value)) {
      setStatus("SuiteQL is only available for list/record or multiple select fields.");
      return;
    }
    el.suiteQlEditor.value = el.fieldListQuery.value || "";
    openSuiteQlDialogDirect();
  }

  function openSuiteQlDialogDirect() {
    if (typeof el.suiteQlDialog.showModal === "function") {
      el.suiteQlDialog.showModal();
    } else {
      el.suiteQlDialog.setAttribute("open", "open");
    }
  }

  function closeSuiteQlDialog() {
    if (typeof el.suiteQlDialog.close === "function") {
      el.suiteQlDialog.close();
    } else {
      el.suiteQlDialog.removeAttribute("open");
    }
  }

  el.fieldSuiteQlBtn?.addEventListener("click", openSuiteQlDialog);
  el.suiteQlClose?.addEventListener("click", closeSuiteQlDialog);
  el.suiteQlCancel?.addEventListener("click", closeSuiteQlDialog);
  el.suiteQlSave?.addEventListener("click", () => {
    saveSuiteQlForSelectedField()
      .then(() => closeSuiteQlDialog())
      .catch((err) => setStatus(err.message || "Failed to save SuiteQL."));
  });

  el.suiteQlStudioRun?.addEventListener("click", async () => {
    const query = String(el.suiteQlStudioQuery?.value || "").trim();
    if (!query) {
      el.suiteQlStudioMeta.textContent = "Enter a SuiteQL query first.";
      return;
    }
    el.suiteQlStudioRun.disabled = true;
    el.suiteQlStudioMeta.textContent = "Running...";
    el.suiteQlStudioOutput.textContent = "";
    renderSuiteQlStudioTable([]);
    try {
      const data = await api("/suiteql/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const count = data.count ?? rows.length;
      const elapsed = Number.isFinite(Number(data.elapsedMs)) ? ` in ${Number(data.elapsedMs)}ms` : "";
      const capped = data.capped ? " (capped)" : "";
      el.suiteQlStudioMeta.textContent = `${count} row${count === 1 ? "" : "s"}${elapsed}${capped}`;
      renderSuiteQlStudioTable(rows);
      el.suiteQlStudioOutput.textContent = JSON.stringify(data.raw ?? rows, null, 2);
    } catch (err) {
      el.suiteQlStudioMeta.textContent = "SuiteQL failed.";
      el.suiteQlStudioOutput.textContent = JSON.stringify({
        success: false,
        message: err.message || "SuiteQL failed",
      }, null, 2);
    } finally {
      el.suiteQlStudioRun.disabled = false;
    }
  });

  function openSuiteQlStudio() {
    const popup = window.open(
      "/cs-workflows/suiteql-studio",
      "SuiteQLStudio",
      "popup=yes,width=1320,height=860,resizable=yes,scrollbars=yes"
    );
    popup?.focus();
  }

  function closeSuiteQlStudio() {
    if (!el.suiteQlStudioDialog) return;
    if (typeof el.suiteQlStudioDialog.close === "function") {
      el.suiteQlStudioDialog.close();
    } else {
      el.suiteQlStudioDialog.removeAttribute("open");
    }
  }

  el.suiteQlStudioOpen?.addEventListener("click", () => {
    openSuiteQlStudio();
    setNavOpen(false);
  });
  el.suiteQlStudioClose?.addEventListener("click", closeSuiteQlStudio);

  el.navTab?.addEventListener("click", () => setNavOpen(true));
  el.navClose?.addEventListener("click", () => setNavOpen(false));
  el.navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const view = link.dataset.workflowView || "workflows";
      if (link.dataset.newWorkflow === "true") {
        startNewWorkflow();
      } else {
        showWorkflowView(view);
        if (view === "records") {
          loadWorkflowRecords().catch((err) => setStatus(err.message || "Failed to load records."));
        }
      }
      setNavOpen(false);
    });
  });

  el.builderTabs.forEach((tab) => {
    tab.addEventListener("click", () => setBuilderTab(tab.dataset.builderTab || "workflow"));
  });

  function applyWorkflowDebug(payload = {}) {
    if (!payload || payload.type !== "cs-workflow-debug") return;
    if (String(payload.workflowId || "") !== String(state.currentId || "")) return;
    if (payload.ended) {
      state.debug = null;
      render();
      return;
    }
    state.debug = {
      workflowId: payload.workflowId,
      nodeId: payload.nodeId,
      nodeIds: Array.isArray(payload.nodeIds) ? payload.nodeIds : [],
      edgeIds: Array.isArray(payload.edgeIds) ? payload.edgeIds : [],
      actionNodeIds: Array.isArray(payload.actionNodeIds) ? payload.actionNodeIds : [],
      user: payload.user || {},
      updatedAt: Date.now(),
    };
    window.clearTimeout(state.debugTimer);
    render();
  }

  try {
    const channel = new BroadcastChannel("cs-workflow-debug");
    channel.addEventListener("message", (event) => applyWorkflowDebug(event.data || {}));
  } catch {}

  window.addEventListener("storage", (event) => {
    if (event.key !== "csWorkflowDebug" || !event.newValue) return;
    try {
      applyWorkflowDebug(JSON.parse(event.newValue));
    } catch {}
  });

  renderWorkflowSettings();
  setBuilderTab("workflow");
  Promise.all([loadWorkflows(), loadCaseStatuses(), loadWorkflowRecords()]).then(() => {
    showWorkflowView("workflows");
    setZoom(1);
    render();
    try {
      const savedDebug = JSON.parse(localStorage.getItem("csWorkflowDebug") || "null");
      if (savedDebug) applyWorkflowDebug(savedDebug);
    } catch {}
  }).catch((err) => setStatus(err.message || "Failed to load workflows."));
});
