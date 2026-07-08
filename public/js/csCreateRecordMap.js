document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "csCreateRecordMapDraft";
  const DRAG_TYPE = "application/x-cs-map-field";
  document.body.classList.toggle("cs-map-dark", localStorage.getItem("csWorkflowTheme") === "dark");
  const TARGETS = {
    salesOrder: { label: "Sales Order", keys: ["salesorder", "sales_order"] },
    customerDeposit: { label: "Customer Deposit", keys: ["customerdeposit", "customer_deposit"] },
    customerRefund: { label: "Customer Refund", keys: ["customerrefund", "customer_refund"] },
    returnAuthorization: { label: "Return Authorisation", keys: ["returnauthorization", "return_authorization", "returnauthorisation", "return_authorisation"] },
    supplierPurchaseOrder: { label: "Supplier Purchase Order", keys: ["purchaseorder", "purchase_order", "purchord"] },
  };

  const el = {
    context: document.getElementById("mapperContext"),
    source: document.getElementById("sourceRecordSelect"),
    sourceRecordWrap: document.getElementById("sourceRecordWrap"),
    recordSourceTab: document.getElementById("recordSourceTab"),
    workflowInputSourceTab: document.getElementById("workflowInputSourceTab"),
    lineFieldSourceTab: document.getElementById("lineFieldSourceTab"),
    target: document.getElementById("targetRecordSelect"),
    sourceContext: document.getElementById("sourceContext"),
    targetContext: document.getElementById("targetContext"),
    sourceFieldList: document.getElementById("sourceFieldList"),
    targetFieldList: document.getElementById("targetFieldList"),
    mappingTableWrap: document.getElementById("mappingTableWrap"),
    mappingRows: document.getElementById("mappingRows"),
    add: document.getElementById("addMappingBtn"),
    save: document.getElementById("saveMappingBtn"),
    dialog: document.getElementById("mappingEditorDialog"),
    editorTarget: document.getElementById("editorTargetField"),
    editorMode: document.getElementById("editorMode"),
    editorSource: document.getElementById("editorSourceField"),
    editorValueMode: document.getElementById("editorValueMode"),
    editorValueCast: document.getElementById("editorValueCast"),
    editorStatic: document.getElementById("editorStaticValue"),
    editorCalculationWrap: document.getElementById("editorCalculationWrap"),
    editorCalculation: document.getElementById("editorCalculationExpression"),
    calculationLineNumbers: document.getElementById("calculationLineNumbers"),
    calculationSuggestions: document.getElementById("calculationSuggestionList"),
    calculationHelp: document.getElementById("calculationHelpBtn"),
    calculationDocs: document.getElementById("calculationDocs"),
    editorSourceWrap: document.getElementById("editorSourceWrap"),
    editorValueModeWrap: document.getElementById("editorValueModeWrap"),
    editorStaticWrap: document.getElementById("editorStaticWrap"),
    closeEditor: document.getElementById("closeEditorBtn"),
    cancelEditor: document.getElementById("cancelEditorBtn"),
    saveEditor: document.getElementById("saveEditorBtn"),
  };

  let state = {
    nodeId: "",
    workflowId: "",
    records: [],
    nodes: [],
    edges: [],
    createRecord: {
      targetRecord: "salesOrder",
      sourceRecord: "storeSalesOrder",
      sourcePanel: "record",
      mappings: [],
    },
    mapMode: "createRecord",
  };
  let editorIndex = -1;
  let expandedSourceFieldId = "";
  let calculationSuggestionState = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

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

  function sourceRecord(source = "storeSalesOrder") {
    if (source === "case") return workflowRecordByKeys(["supportcase", "case"]);
    return workflowRecordByKeys(["salesorder", "sales_order"]);
  }

  function targetRecord(target = "salesOrder") {
    return workflowRecordByKeys(TARGETS[target]?.keys || []);
  }

  function sourceFields() {
    return sourceRecord(state.createRecord.sourceRecord)?.fields || [];
  }

  function sourceLineFieldEntries() {
    const record = sourceRecord(state.createRecord.sourceRecord);
    const sublist = itemSublistForRecord(record);
    return (sublist?.fields || []).map((field) => ({
      id: `${sublist.internalId}.${field.internalId}`,
      label: field.label,
      internalId: field.internalId,
      sourceType: "record",
      field,
      sourceField: field.internalId,
      sourceChildField: "",
      sourceChildRecord: "",
      sourceSublist: sublist.internalId,
      sourceSublistLabel: sublist.label,
    }));
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

  function inputNodeLabel(node = {}) {
    return node.question || node.label || "Input";
  }

  function availableWorkflowInputs() {
    const inputs = state.nodes.filter((node) => node?.type === "input" && String(node.id) !== String(state.nodeId));
    if (!state.nodeId) return inputs;
    return inputs.filter((node) => nodeCanReach(node.id, state.nodeId));
  }

  function inputFieldsForNode(node = {}) {
    const config = node.inputConfig && typeof node.inputConfig === "object" ? node.inputConfig : {};
    if (Array.isArray(config.fields) && config.fields.length) {
      return config.fields.map((field, index) => ({
        id: field.id || `field_${index}`,
        label: field.label || `${inputNodeLabel(node)} ${index + 1}`,
        type: field.type || "string",
      }));
    }
    return [{
      id: "answer",
      label: inputNodeLabel(node),
      type: config.type || "string",
    }];
  }

  function targetFields() {
    return targetRecord(state.createRecord.targetRecord)?.fields || [];
  }

  function itemSublistForRecord(record) {
    return (record?.sublists || []).find((sublist) =>
      normaliseRecordLookup(sublist.internalId) === "item" ||
      normaliseRecordLookup(sublist.label) === "item" ||
      normaliseRecordLookup(sublist.label) === "items"
    ) || (record?.sublists || [])[0] || null;
  }

  function targetFieldEntries() {
    const record = targetRecord(state.createRecord.targetRecord);
    if (state.mapMode === "itemLineAction") {
      const sublist = itemSublistForRecord(record);
      return (sublist?.fields || []).map((field) => ({
        id: field.internalId,
        label: field.label,
        internalId: field.internalId,
        targetField: field.internalId,
        targetSublist: sublist.internalId,
        targetSublistLabel: sublist.label,
        targetFieldType: field.fieldType || "",
        field,
      }));
    }
    const bodyFields = (record?.fields || []).map((field) => ({
      id: field.internalId,
      label: field.label,
      internalId: field.internalId,
      targetField: field.internalId,
      targetSublist: "",
      targetFieldType: field.fieldType || "",
      field,
    }));
    const sublistFields = (record?.sublists || []).flatMap((sublist) =>
      (sublist.fields || []).map((field) => ({
        id: `${sublist.internalId}.${field.internalId}`,
        label: `${sublist.label} > ${field.label}`,
        internalId: `${sublist.internalId}.${field.internalId}`,
        targetField: field.internalId,
        targetSublist: sublist.internalId,
        targetSublistLabel: sublist.label,
        targetFieldType: field.fieldType || "",
        field,
      }))
    );
    return [...bodyFields, ...sublistFields];
  }

  function findField(fields = [], internalId = "") {
    return fields.find((field) => String(field.internalId) === String(internalId)) || null;
  }

  function recordKey(value = "") {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function fieldUsesListRecord(field = {}) {
    const clean = String(field.fieldType || "").trim().toLowerCase();
    return clean === "list/record" || clean === "multiple select";
  }

  function relatedRecordForField(field = {}) {
    if (!fieldUsesListRecord(field)) return null;
    const candidates = [
      field.listRecord,
      field.listRecordId,
      field.recordType,
      field.sourceRecord,
      field.internalId,
      field.label,
    ].filter(Boolean).map(recordKey);
    return state.records.find((record) =>
      candidates.includes(recordKey(record.internalId)) ||
      candidates.includes(recordKey(record.label))
    ) || null;
  }

  function fieldLabel(fields = [], internalId = "", fallback = "Unmapped field") {
    const field = findField(fields, internalId);
    if (!field && !internalId) return fallback;
    return field?.label || internalId || fallback;
  }

  function fieldOptions(fields = [], selectedValue = "") {
    if (!fields.length) return '<option value="">No fields mapped</option>';
    return fields.map((field) => `
      <option value="${escapeHtml(field.internalId)}" ${String(field.internalId) === String(selectedValue) ? "selected" : ""}>${escapeHtml(field.label)}</option>
    `).join("");
  }

  function targetOptionValue(mapping = {}) {
    if (state.mapMode === "itemLineAction") return mapping.targetField || "";
    return mapping.targetSublist ? `${mapping.targetSublist}.${mapping.targetField}` : mapping.targetField || "";
  }

  function targetFieldOptions(selectedValue = "") {
    const entries = targetFieldEntries();
    if (!entries.length) return '<option value="">No fields mapped</option>';
    return entries.map((entry) => `
      <option value="${escapeHtml(entry.id)}" ${String(entry.id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(entry.label)}</option>
    `).join("");
  }

  function findTargetEntry(value = "") {
    return targetFieldEntries().find((entry) => String(entry.id) === String(value)) || null;
  }

  function applyTargetEntryToMapping(mapping, entry) {
    mapping.targetField = entry?.targetField || "";
    mapping.targetSublist = entry?.targetSublist || "";
    mapping.targetSublistLabel = entry?.targetSublistLabel || "";
    mapping.targetFieldType = entry?.targetFieldType || "";
  }

  function sourceFieldEntries() {
    const recordEntries = sourceFields().flatMap((field) => {
      const parent = {
        id: field.internalId,
        label: field.label,
        internalId: field.internalId,
        sourceType: "record",
        field,
        sourceField: field.internalId,
        sourceChildField: "",
        sourceChildRecord: "",
      };
      const related = relatedRecordForField(field);
      const childEntries = related?.fields?.map((child) => ({
        id: `${field.internalId}.${child.internalId}`,
        label: `${field.label} > ${child.label}`,
        internalId: `${field.internalId}.${child.internalId}`,
        field: child,
        parentField: field,
        sourceType: "record",
        sourceField: field.internalId,
        sourceChildField: child.internalId,
        sourceChildRecord: related.internalId,
      })) || [];
      return [parent, ...childEntries];
    });
    const workflowInputEntries = availableWorkflowInputs().flatMap((node) =>
      inputFieldsForNode(node).map((field) => ({
        id: `input:${node.id}:${field.id}`,
        label: `Workflow Input > ${inputNodeLabel(node)} > ${field.label}`,
        internalId: `${node.id}:${field.id}`,
        sourceType: "workflowInput",
        inputNodeId: String(node.id),
        inputFieldId: String(field.id),
        inputType: field.type || "string",
        field: {
          internalId: String(field.id),
          label: field.label,
          fieldType: field.type || "string",
        },
      }))
    );
    return [...recordEntries, ...workflowInputEntries];
  }

  function sourceFieldOptionEntries() {
    return sourceFieldEntries();
  }

  function sourceOptionValue(mapping = {}) {
    if (mapping.sourceType === "workflowInput") return mapping.sourceInputId ? `input:${mapping.sourceInputId}:${mapping.sourceInputFieldId || "answer"}` : "";
    if (mapping.sourceSublist && mapping.sourceField) return `${mapping.sourceSublist}.${mapping.sourceField}`;
    return mapping.sourceChildField
      ? `${mapping.sourceField}.${mapping.sourceChildField}`
      : mapping.sourceField || "";
  }

  function applySourceEntryToMapping(mapping, entry) {
    mapping.sourceType = entry?.sourceType === "workflowInput" ? "workflowInput" : "record";
    mapping.sourceInputId = entry?.inputNodeId || "";
    mapping.sourceInputFieldId = entry?.inputFieldId || "";
    mapping.sourceInputType = entry?.inputType || "";
    mapping.sourceField = entry?.sourceField || "";
    mapping.sourceChildField = entry?.sourceChildField || "";
    mapping.sourceChildRecord = entry?.sourceChildRecord || "";
    mapping.sourceSublist = entry?.sourceSublist || "";
    mapping.sourceSublistLabel = entry?.sourceSublistLabel || "";
    mapping.sourceFieldPath = entry?.sourceChildField ? [entry.sourceField, entry.sourceChildField] : [];
  }

  function sourceFieldOptions(selectedValue = "") {
    const entries = state.mapMode === "itemLineAction"
      ? [...sourceFieldOptionEntries(), ...sourceLineFieldEntries()]
      : sourceFieldOptionEntries();
    if (!entries.length) return '<option value="">No fields mapped</option>';
    return entries.map((entry) => `
      <option value="${escapeHtml(entry.id)}" ${String(entry.id) === String(selectedValue) ? "selected" : ""}>${escapeHtml(entry.label)}</option>
    `).join("");
  }

  function findSourceEntry(value = "") {
    const entries = state.mapMode === "itemLineAction"
      ? [...sourceFieldOptionEntries(), ...sourceLineFieldEntries()]
      : sourceFieldOptionEntries();
    return entries.find((entry) => String(entry.id) === String(value)) || null;
  }

  function normaliseMapping(mapping = {}) {
    const sourceFieldPath = Array.isArray(mapping.sourceFieldPath) ? mapping.sourceFieldPath : [];
    return {
      sourceType: mapping.sourceType === "workflowInput" ? "workflowInput" : "record",
      sourceInputId: mapping.sourceInputId || "",
      sourceInputFieldId: mapping.sourceInputFieldId || "",
      sourceInputType: mapping.sourceInputType || "",
      sourceField: mapping.sourceField || "",
      sourceChildField: mapping.sourceChildField || sourceFieldPath[1] || "",
      sourceChildRecord: mapping.sourceChildRecord || "",
      sourceSublist: mapping.sourceSublist || "",
      sourceSublistLabel: mapping.sourceSublistLabel || "",
      sourceFieldPath,
      targetField: mapping.targetField || "",
      targetSublist: mapping.targetSublist || "",
      targetSublistLabel: mapping.targetSublistLabel || "",
      targetFieldType: mapping.targetFieldType || "",
      mode: ["static", "calculation"].includes(mapping.mode) ? mapping.mode : "source",
      valueMode: mapping.valueMode === "name" ? "name" : "id",
      valueCast: ["text", "decimal", "checkbox", "reference"].includes(mapping.valueCast) ? mapping.valueCast : "",
      staticValue: mapping.staticValue || "",
      calculationExpression: mapping.calculationExpression || "",
    };
  }

  function normaliseConfig(config = {}) {
    return {
      targetRecord: config.targetRecord || "salesOrder",
      sourceRecord: config.sourceRecord || "storeSalesOrder",
      sourcePanel: ["workflowInputs", "lineFields"].includes(config.sourcePanel) ? config.sourcePanel : "record",
      mappings: Array.isArray(config.mappings) ? config.mappings.map(normaliseMapping) : [],
    };
  }

  function defaultMapping(seed = {}) {
    return normaliseMapping({
      sourceType: seed.sourceType || "record",
      sourceInputId: seed.sourceInputId || "",
      sourceInputFieldId: seed.sourceInputFieldId || "",
      sourceInputType: seed.sourceInputType || "",
      sourceField: seed.sourceField || "",
      sourceChildField: seed.sourceChildField || "",
      sourceChildRecord: seed.sourceChildRecord || "",
      sourceSublist: seed.sourceSublist || "",
      sourceSublistLabel: seed.sourceSublistLabel || "",
      sourceFieldPath: Array.isArray(seed.sourceFieldPath) ? seed.sourceFieldPath : [],
      targetField: seed.targetField || "",
      targetSublist: seed.targetSublist || "",
      targetSublistLabel: seed.targetSublistLabel || "",
      targetFieldType: seed.targetFieldType || "",
      mode: seed.mode || "source",
      valueMode: seed.valueMode || "id",
      valueCast: seed.valueCast || "",
      staticValue: seed.staticValue || "",
      calculationExpression: seed.calculationExpression || "",
    });
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (raw && typeof raw === "object") {
        const mapMode = raw.mapMode === "itemLineAction" ? "itemLineAction" : "createRecord";
        const itemLineAction = raw.itemLineAction && typeof raw.itemLineAction === "object" ? raw.itemLineAction : {};
        const itemLineTarget = itemLineAction.target || itemLineAction.source || "storeSalesOrder";
        state = {
          ...state,
          ...raw,
          mapMode,
          records: Array.isArray(raw.records) ? raw.records : [],
          createRecord: normaliseConfig(mapMode === "itemLineAction"
            ? {
              targetRecord: itemLineTarget === "supplierPurchaseOrder" ? "supplierPurchaseOrder" : "salesOrder",
              sourceRecord: itemLineAction.sourceRecord || "storeSalesOrder",
              sourcePanel: itemLineAction.sourcePanel || "record",
              mappings: itemLineAction.mappings,
            }
            : raw.createRecord),
        };
      }
    } catch {}
    if (!state.createRecord.mappings.length) state.createRecord.mappings.push(defaultMapping());
  }

  function renderFieldList(container, fields, side) {
    container.innerHTML = fields.length
      ? fields.map((field) => {
        const related = side === "source" ? relatedRecordForField(field) : null;
        const expanded = expandedSourceFieldId === field.internalId;
        return `
          <div class="field-row">
            <button type="button" class="field-pill" draggable="true" data-field-side="${side}" data-field-id="${escapeHtml(field.internalId)}">
              <strong>${escapeHtml(field.label)}</strong>
              <small>${escapeHtml(field.internalId)}</small>
            </button>
            ${related ? `<button type="button" class="field-drill-button" data-drill-field="${escapeHtml(field.internalId)}" title="Show ${escapeHtml(related.label)} fields">...</button>` : ""}
          </div>
          ${related && expanded ? `
            <div class="child-field-list">
              <div class="child-field-heading">${escapeHtml(related.label)} fields</div>
              ${(related.fields || []).map((child) => `
                <button type="button" class="child-field-pill" draggable="true" data-field-side="source" data-field-id="${escapeHtml(field.internalId)}" data-child-record="${escapeHtml(related.internalId)}" data-child-field="${escapeHtml(child.internalId)}">
                  <span>${escapeHtml(child.label)}</span>
                  <small>${escapeHtml(child.internalId)}</small>
                </button>
              `).join("")}
            </div>
          ` : ""}
        `;
      }).join("")
      : '<div class="empty-state">No fields mapped for this record yet.</div>';
  }

  function renderWorkflowInputList(container) {
    const inputs = availableWorkflowInputs();
    container.innerHTML = inputs.length
      ? inputs.map((node) => `
        <div class="child-field-heading">${escapeHtml(inputNodeLabel(node))}</div>
        ${inputFieldsForNode(node).map((field) => `
          <div class="field-row">
            <button type="button" class="field-pill" draggable="true" data-field-side="source" data-source-type="workflowInput" data-input-node-id="${escapeHtml(node.id)}" data-input-field-id="${escapeHtml(field.id)}">
              <strong>${escapeHtml(field.label)}</strong>
              <small>${escapeHtml(field.type || "string")}</small>
            </button>
          </div>
        `).join("")}
      `).join("")
      : '<div class="empty-state">No workflow inputs are available before this action.</div>';
  }

  function renderSourceLineFieldList(container) {
    const fields = sourceLineFieldEntries();
    container.innerHTML = fields.length
      ? fields.map((entry) => `
        <div class="field-row">
          <button
            type="button"
            class="field-pill"
            draggable="true"
            data-field-side="source"
            data-field-id="${escapeHtml(entry.sourceField)}"
            data-source-sublist="${escapeHtml(entry.sourceSublist)}"
            data-source-sublist-label="${escapeHtml(entry.sourceSublistLabel)}">
            <strong>${escapeHtml(entry.label)}</strong>
            <small>${escapeHtml(entry.sourceSublist)}.${escapeHtml(entry.sourceField)}</small>
          </button>
        </div>
      `).join("")
      : '<div class="empty-state">No item line fields mapped for this source record yet.</div>';
  }

  function renderTargetFieldList(container) {
    const record = targetRecord(state.createRecord.targetRecord);
    if (state.mapMode === "itemLineAction") {
      const fields = targetFieldEntries();
      container.innerHTML = fields.length
        ? fields.map((entry) => `
          <div class="field-row">
            <button type="button" class="field-pill" draggable="true" data-field-side="target" data-field-id="${escapeHtml(entry.targetField)}" data-target-sublist="${escapeHtml(entry.targetSublist)}" data-target-sublist-label="${escapeHtml(entry.targetSublistLabel)}">
              <strong>${escapeHtml(entry.label)}</strong>
              <small>${escapeHtml(entry.targetSublist)}.${escapeHtml(entry.targetField)}</small>
            </button>
          </div>
        `).join("")
        : '<div class="empty-state">No item sublist fields mapped for this target record yet.</div>';
      return;
    }
    const bodyFields = record?.fields || [];
    const sublists = record?.sublists || [];
    const bodyHtml = bodyFields.map((field) => `
      <div class="field-row">
        <button type="button" class="field-pill" draggable="true" data-field-side="target" data-field-id="${escapeHtml(field.internalId)}">
          <strong>${escapeHtml(field.label)}</strong>
          <small>${escapeHtml(field.internalId)}</small>
        </button>
      </div>
    `).join("");
    const sublistHtml = sublists.map((sublist) => `
      <div class="child-field-heading">${escapeHtml(sublist.label)} sublist</div>
      ${(sublist.fields || []).map((field) => `
        <div class="field-row">
          <button type="button" class="field-pill" draggable="true" data-field-side="target" data-field-id="${escapeHtml(field.internalId)}" data-target-sublist="${escapeHtml(sublist.internalId)}" data-target-sublist-label="${escapeHtml(sublist.label)}">
            <strong>${escapeHtml(field.label)}</strong>
            <small>${escapeHtml(sublist.internalId)}.${escapeHtml(field.internalId)}</small>
          </button>
        </div>
      `).join("")}
    `).join("");
    container.innerHTML = bodyHtml || sublistHtml
      ? `${bodyHtml}${sublistHtml}`
      : '<div class="empty-state">No fields mapped for this record yet.</div>';
  }

  function mappingSourceText(mapping) {
    const castText = mapping.valueCast
      ? `; send as ${mapping.valueCast === "reference" ? "NetSuite reference ID" : mapping.valueCast}`
      : "";
    if (mapping.mode === "static") {
      return {
        title: mapping.staticValue ? `Static: ${mapping.staticValue}` : "Static value",
        meta: `Explicit value${castText}`,
      };
    }
    if (mapping.mode === "calculation") {
      return {
        title: mapping.calculationExpression ? `Calculation: ${mapping.calculationExpression}` : "Calculation",
        meta: `Calculated value${castText}`,
      };
    }
    if (mapping.sourceType === "workflowInput") {
      const input = state.nodes.find((node) => String(node.id) === String(mapping.sourceInputId));
      const field = inputFieldsForNode(input).find((item) => String(item.id) === String(mapping.sourceInputFieldId || "answer"));
      return {
        title: input ? `Workflow Input > ${inputNodeLabel(input)} > ${field?.label || "Response"}` : "Workflow input",
        meta: field ? `${field.type || "string"} result${castText}` : `Input not found${castText}`,
      };
    }
    if (mapping.sourceSublist) {
      const lineEntry = sourceLineFieldEntries().find((entry) =>
        String(entry.sourceSublist) === String(mapping.sourceSublist) &&
        String(entry.sourceField) === String(mapping.sourceField)
      );
      return {
        title: lineEntry?.label || mapping.sourceField || "Source line field",
        meta: `${mapping.sourceSublistLabel || mapping.sourceSublist} line field${castText}`,
      };
    }
    const childLabel = mapping.sourceChildField
      ? fieldLabel(relatedRecordForField(findField(sourceFields(), mapping.sourceField) || {})?.fields || [], mapping.sourceChildField, mapping.sourceChildField)
      : "";
    return {
      title: childLabel
        ? `${fieldLabel(sourceFields(), mapping.sourceField, mapping.sourceField)} > ${childLabel}`
        : fieldLabel(sourceFields(), mapping.sourceField, "Drop source field"),
      meta: mapping.sourceField ? `Use ${mapping.valueMode === "name" ? "name/display value" : "internal ID"}${castText}` : `Source not selected${castText}`,
    };
  }

  function renderMappings() {
    const mappings = state.createRecord.mappings;
    el.mappingRows.innerHTML = mappings.length
      ? mappings.map((mapping, index) => {
        const source = mappingSourceText(mapping);
        const target = state.mapMode === "itemLineAction"
          ? fieldLabel(targetFieldEntries().map((entry) => entry.field), mapping.targetField, "Drop target line field")
          : mapping.targetSublist
          ? `${mapping.targetSublistLabel || mapping.targetSublist} > ${fieldLabel((targetRecord(state.createRecord.targetRecord)?.sublists || []).find((item) => item.internalId === mapping.targetSublist)?.fields || [], mapping.targetField, mapping.targetField)}`
          : fieldLabel(targetFields(), mapping.targetField, "Drop target field");
        return `
          <tr class="mapping-row" data-mapping-index="${index}">
            <td class="icon-cell">
              <button type="button" class="row-action" data-edit="${index}" title="Edit mapping">&#9998;</button>
            </td>
            <td class="mapping-cell">
              <strong>${escapeHtml(source.title)}</strong>
              <span>${escapeHtml(source.meta)}</span>
            </td>
            <td class="mapping-arrow">-&gt;</td>
            <td class="mapping-cell">
              <strong>${escapeHtml(target)}</strong>
              <span>${mapping.targetField ? "Target field" : "Target not selected"}</span>
            </td>
            <td class="icon-cell">
              <button type="button" class="row-action remove-button" data-remove="${index}" title="Remove mapping">x</button>
            </td>
          </tr>
        `;
      }).join("")
      : '<tr><td colspan="5" class="empty-table-row">Drag a source or target field here to start mapping.</td></tr>';
  }

  function render() {
    const createConfig = state.createRecord;
    el.source.value = createConfig.sourceRecord || "storeSalesOrder";
    el.target.value = createConfig.targetRecord || "salesOrder";
    let sourcePanel = ["workflowInputs", "lineFields"].includes(createConfig.sourcePanel) ? createConfig.sourcePanel : "record";
    if (sourcePanel === "lineFields" && state.mapMode !== "itemLineAction") {
      sourcePanel = "record";
      createConfig.sourcePanel = "record";
    }
    el.recordSourceTab?.classList.toggle("is-active", sourcePanel === "record");
    el.workflowInputSourceTab?.classList.toggle("is-active", sourcePanel === "workflowInputs");
    el.lineFieldSourceTab?.classList.toggle("is-active", sourcePanel === "lineFields");
    if (el.lineFieldSourceTab) el.lineFieldSourceTab.hidden = state.mapMode !== "itemLineAction";
    if (el.sourceRecordWrap) el.sourceRecordWrap.hidden = !["record", "lineFields"].includes(sourcePanel);

    const source = sourceRecord(createConfig.sourceRecord);
    const target = targetRecord(createConfig.targetRecord);
    const targetLabel = TARGETS[createConfig.targetRecord]?.label || "Target record";
    document.title = state.mapMode === "itemLineAction" ? "Item Line Mapping" : "Create Record Mapping";
    document.querySelector(".mapper-header h1").textContent = state.mapMode === "itemLineAction" ? "Item Line Mapping" : "Create Record Mapping";
    document.querySelector(".mapping-panel h2").textContent = state.mapMode === "itemLineAction" ? "Line Field Mapping" : "Field Mapping";
    document.querySelector(".mapping-panel p").textContent = state.mapMode === "itemLineAction"
      ? "Drag source values onto line fields. Edit a row to set static values or choose ID/name mapping."
      : "Drag fields onto the mapping table. Edit a row to set static values or choose ID/name mapping.";
    document.querySelector(".field-panel:last-child h2").textContent = state.mapMode === "itemLineAction" ? "Target Line Fields" : "Creating Record Fields";
    document.querySelector(".mapping-table th:nth-child(4)").textContent = state.mapMode === "itemLineAction" ? "Target Line Field" : "Creating Record Field";
    el.target.disabled = state.mapMode === "itemLineAction";
    el.context.textContent = state.mapMode === "itemLineAction"
      ? `Mapping ${source?.label || "source"} values to ${targetLabel} item line fields.`
      : `Mapping ${source?.label || "source"} fields to ${targetLabel}.`;
    el.sourceContext.textContent = sourcePanel === "workflowInputs"
      ? "Inputs captured earlier in this workflow path."
      : sourcePanel === "lineFields"
        ? source
          ? `${source.label} item line fields from Record Management.`
          : "Source record is not mapped in Record Management yet."
      : source
        ? `${source.label} fields from Record Management.`
        : "Source record is not mapped in Record Management yet.";
    el.targetContext.textContent = target
      ? state.mapMode === "itemLineAction"
        ? `${targetLabel} item sublist fields from Record Management.`
        : `${targetLabel} fields from Record Management.`
      : `${targetLabel} is not mapped in Record Management yet.`;

    if (sourcePanel === "workflowInputs") renderWorkflowInputList(el.sourceFieldList);
    else if (sourcePanel === "lineFields") renderSourceLineFieldList(el.sourceFieldList);
    else renderFieldList(el.sourceFieldList, sourceFields(), "source");
    renderTargetFieldList(el.targetFieldList);
    renderMappings();
  }

  function dragPayload(event) {
    try {
      return JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || "{}");
    } catch {
      return {};
    }
  }

  function setDragPayload(event) {
    const button = event.target.closest("[data-field-side]");
    if (!button) return;
    const sourceType = button.dataset.sourceType || "record";
    if (sourceType !== "workflowInput" && !button.dataset.fieldId) return;
    if (sourceType === "workflowInput" && !button.dataset.inputNodeId) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({
      side: button.dataset.fieldSide,
      sourceType,
      fieldId: button.dataset.fieldId,
      childRecord: button.dataset.childRecord || "",
      childField: button.dataset.childField || "",
      sourceSublist: button.dataset.sourceSublist || "",
      sourceSublistLabel: button.dataset.sourceSublistLabel || "",
      inputNodeId: button.dataset.inputNodeId || "",
      inputFieldId: button.dataset.inputFieldId || "",
      targetSublist: button.dataset.targetSublist || "",
      targetSublistLabel: button.dataset.targetSublistLabel || "",
    }));
  }

  function applyDropToMapping(index, payload) {
    if (!payload || !["source", "target"].includes(payload.side)) return;
    if (payload.side === "target" && !payload.fieldId) return;
    if (payload.side === "source" && payload.sourceType !== "workflowInput" && !payload.fieldId) return;
    if (payload.side === "source" && payload.sourceType === "workflowInput" && !payload.inputNodeId) return;
    if (!state.createRecord.mappings[index]) state.createRecord.mappings[index] = defaultMapping();
    const mapping = state.createRecord.mappings[index];
    if (payload.side === "source") {
      mapping.mode = "source";
      if (payload.sourceType === "workflowInput") {
        const input = state.nodes.find((node) => String(node.id) === String(payload.inputNodeId));
        const inputField = inputFieldsForNode(input).find((field) => String(field.id) === String(payload.inputFieldId || "answer"));
        applySourceEntryToMapping(mapping, {
          sourceType: "workflowInput",
          inputNodeId: payload.inputNodeId || "",
          inputFieldId: payload.inputFieldId || "answer",
          inputType: inputField?.type || input?.inputConfig?.type || "",
        });
      } else {
        applySourceEntryToMapping(mapping, {
          sourceType: "record",
          sourceField: payload.fieldId,
          sourceChildField: payload.childField || "",
          sourceChildRecord: payload.childRecord || "",
          sourceSublist: payload.sourceSublist || "",
          sourceSublistLabel: payload.sourceSublistLabel || "",
        });
      }
    } else {
      applyTargetEntryToMapping(mapping, {
        targetField: payload.fieldId,
        targetSublist: payload.targetSublist || "",
        targetSublistLabel: payload.targetSublistLabel || "",
      });
    }
    render();
  }

  function handleMappingDrop(event) {
    const types = Array.from(event.dataTransfer.types || []);
    if (!types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    const row = event.target.closest("[data-mapping-index]");
    const index = row ? Number(row.dataset.mappingIndex) : state.createRecord.mappings.length;
    applyDropToMapping(index, dragPayload(event));
  }

  function renderEditor() {
    const mapping = state.createRecord.mappings[editorIndex];
    if (!mapping) return;
    el.editorTarget.innerHTML = targetFieldOptions(targetOptionValue(mapping));
    el.editorSource.innerHTML = sourceFieldOptions(sourceOptionValue(mapping));
    el.editorMode.value = mapping.mode || "source";
    el.editorValueMode.value = mapping.valueMode || "id";
    el.editorValueCast.value = mapping.valueCast || "";
    el.editorStatic.value = mapping.staticValue || "";
    if (el.editorCalculation) el.editorCalculation.value = mapping.calculationExpression || "";
    updateCalculationLineNumbers();
    renderEditorVisibility();
  }

  function renderEditorVisibility() {
    const isStatic = el.editorMode.value === "static";
    const isCalculation = el.editorMode.value === "calculation";
    el.editorSourceWrap.hidden = isStatic;
    el.editorValueModeWrap.hidden = isStatic || isCalculation;
    el.editorStaticWrap.hidden = !isStatic;
    if (el.editorCalculationWrap) el.editorCalculationWrap.hidden = !isCalculation;
    if (!isCalculation && el.calculationDocs) el.calculationDocs.hidden = true;
    const targetEntry = findTargetEntry(el.editorTarget.value);
    const targetType = String(targetEntry?.targetFieldType || "").trim().toLowerCase();
    const effectiveType = el.editorValueCast.value || targetType;
    el.editorStatic.placeholder = effectiveType === "checkbox"
      ? "checked or unchecked"
      : effectiveType === "decimal"
        ? "e.g. 12.50"
      : "Enter the value to set";
  }

  function updateCalculationLineNumbers() {
    if (!el.editorCalculation || !el.calculationLineNumbers) return;
    const lineCount = Math.max(1, String(el.editorCalculation.value || "").split("\n").length);
    el.calculationLineNumbers.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  }

  function lineFieldEntriesForCalculation() {
    return targetFieldEntries().map((entry) => ({
      value: `{line.${entry.internalId || entry.targetField}}`,
      label: entry.label || entry.internalId || entry.targetField,
      meta: "Target line field",
      sourceEntry: null,
    }));
  }

  function sourceFieldEntriesForCalculation() {
    return sourceFieldEntries()
      .filter((entry) => entry.sourceType !== "workflowInput" && !entry.sourceChildField)
      .map((entry) => ({
        value: `{source.${entry.sourceField}}`,
        label: entry.label || entry.internalId || entry.sourceField,
        meta: "Source record field",
        sourceEntry: entry,
      }));
  }

  function workflowInputEntriesForCalculation() {
    return sourceFieldEntries()
      .filter((entry) => entry.sourceType === "workflowInput")
      .map((entry) => ({
        value: "{wf.input}",
        label: entry.label || "Workflow input",
        meta: "Workflow input",
        sourceEntry: entry,
      }));
  }

  function calculationTokenAtCursor() {
    if (!el.editorCalculation) return null;
    const value = el.editorCalculation.value || "";
    const cursor = el.editorCalculation.selectionStart ?? value.length;
    const openIndex = value.lastIndexOf("{", cursor - 1);
    if (openIndex >= 0) {
      const closeIndex = value.indexOf("}", openIndex);
      if (closeIndex < 0 || closeIndex >= cursor) {
        const query = value.slice(openIndex + 1, cursor);
        return { value, cursor, openIndex, closeIndex, query };
      }
    }
    const prefix = value.slice(0, cursor);
    const match = prefix.match(/([a-zA-Z0-9_.]{3,})$/);
    if (!match) return null;
    const openWordIndex = cursor - match[1].length;
    return { value, cursor, openIndex: openWordIndex, closeIndex: cursor - 1, query: match[1] };
  }

  function calculationSuggestions(query = "") {
    const clean = query.toLowerCase().replace(/[{}]/g, "").trim();
    if (clean.length < 3) return [];
    const candidates = [
      ...lineFieldEntriesForCalculation(),
      ...sourceFieldEntriesForCalculation(),
      ...workflowInputEntriesForCalculation(),
    ];
    return candidates
      .filter((item) => {
        const haystack = `${item.value} ${item.label} ${item.meta}`.toLowerCase();
        return haystack.includes(clean);
      })
      .slice(0, 12);
  }

  function hideCalculationSuggestions() {
    calculationSuggestionState = null;
    if (el.calculationSuggestions) {
      el.calculationSuggestions.hidden = true;
      el.calculationSuggestions.innerHTML = "";
    }
  }

  function renderCalculationSuggestions() {
    const token = calculationTokenAtCursor();
    if (!token || token.query.length < 3 || el.editorMode.value !== "calculation") {
      hideCalculationSuggestions();
      return;
    }
    const suggestions = calculationSuggestions(token.query);
    if (!suggestions.length) {
      hideCalculationSuggestions();
      return;
    }
    calculationSuggestionState = { token, suggestions };
    el.calculationSuggestions.innerHTML = suggestions.map((item, index) => `
      <button type="button" data-calculation-suggestion="${index}">
        <strong>${escapeHtml(item.value)}</strong>
        <span>${escapeHtml(item.label)} · ${escapeHtml(item.meta)}</span>
      </button>
    `).join("");
    el.calculationSuggestions.hidden = false;
  }

  function applyCalculationSuggestion(index) {
    if (!calculationSuggestionState || !el.editorCalculation) return;
    const item = calculationSuggestionState.suggestions[index];
    if (!item) return;
    const { token } = calculationSuggestionState;
    const closeIndex = token.closeIndex >= 0 ? token.closeIndex + 1 : token.cursor;
    let replaceStart = token.openIndex;
    const beforeToken = token.value.slice(0, token.openIndex);
    const typedBeforeToken = beforeToken.match(/([a-zA-Z0-9_.]{3,})\s*$/);
    if (typedBeforeToken) {
      const typedText = typedBeforeToken[1].toLowerCase();
      const suggestionText = `${item.value} ${item.label} ${item.meta}`.toLowerCase();
      if (suggestionText.includes(typedText)) {
        replaceStart = token.openIndex - typedBeforeToken[0].length;
      }
    }
    const nextValue = `${token.value.slice(0, replaceStart)}${item.value}${token.value.slice(closeIndex)}`;
    el.editorCalculation.value = nextValue;
    const nextCursor = replaceStart + item.value.length;
    el.editorCalculation.focus();
    el.editorCalculation.setSelectionRange(nextCursor, nextCursor);
    const mapping = state.createRecord.mappings[editorIndex];
    if (mapping && item.sourceEntry?.sourceType === "workflowInput") {
      applySourceEntryToMapping(mapping, item.sourceEntry);
      el.editorSource.innerHTML = sourceFieldOptions(sourceOptionValue(mapping));
    }
    hideCalculationSuggestions();
  }

  function openEditor(index) {
    editorIndex = index;
    if (!state.createRecord.mappings[editorIndex]) return;
    renderEditor();
    if (typeof el.dialog.showModal === "function") el.dialog.showModal();
    else el.dialog.setAttribute("open", "open");
  }

  function closeEditor() {
    editorIndex = -1;
    if (typeof el.dialog.close === "function") el.dialog.close();
    else el.dialog.removeAttribute("open");
  }

  function saveEditor() {
    const mapping = state.createRecord.mappings[editorIndex];
    if (!mapping) return;
    applyTargetEntryToMapping(mapping, findTargetEntry(el.editorTarget.value) || { targetField: el.editorTarget.value || "" });
    mapping.mode = ["static", "calculation"].includes(el.editorMode.value) ? el.editorMode.value : "source";
    if (mapping.mode === "source" || mapping.mode === "calculation") {
      applySourceEntryToMapping(mapping, findSourceEntry(el.editorSource.value) || { sourceField: el.editorSource.value || "" });
    }
    mapping.valueMode = el.editorValueMode.value === "name" ? "name" : "id";
    mapping.valueCast = ["text", "decimal", "checkbox", "reference"].includes(el.editorValueCast.value) ? el.editorValueCast.value : "";
    mapping.staticValue = el.editorStatic.value || "";
    mapping.calculationExpression = el.editorCalculation?.value || "";
    closeEditor();
    render();
  }

  el.source.addEventListener("change", () => {
    state.createRecord.sourceRecord = el.source.value || "storeSalesOrder";
    state.createRecord.mappings = state.createRecord.mappings.map((mapping) => ({
      ...mapping,
      sourceField: "",
      sourceSublist: "",
      sourceSublistLabel: "",
    }));
    render();
  });

  el.recordSourceTab?.addEventListener("click", () => {
    state.createRecord.sourcePanel = "record";
    render();
  });

  el.workflowInputSourceTab?.addEventListener("click", () => {
    state.createRecord.sourcePanel = "workflowInputs";
    render();
  });

  el.lineFieldSourceTab?.addEventListener("click", () => {
    state.createRecord.sourcePanel = "lineFields";
    render();
  });

  el.target.addEventListener("change", () => {
    state.createRecord.targetRecord = el.target.value || "salesOrder";
    state.createRecord.mappings = state.createRecord.mappings.map((mapping) => ({
      ...mapping,
      targetField: "",
    }));
    render();
  });

  el.add?.addEventListener("click", () => {
    state.createRecord.mappings.push(defaultMapping());
    render();
  });

  el.sourceFieldList.addEventListener("dragstart", setDragPayload);
  el.targetFieldList.addEventListener("dragstart", setDragPayload);
  el.sourceFieldList.addEventListener("click", (event) => {
    const fieldId = event.target.closest("[data-drill-field]")?.dataset.drillField;
    if (!fieldId) return;
    expandedSourceFieldId = expandedSourceFieldId === fieldId ? "" : fieldId;
    render();
  });

  function handleMappingDragOver(event) {
    if (!Array.from(event.dataTransfer.types || []).includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    el.mappingTableWrap.classList.add("is-dragging-over");
    el.mappingRows.classList.add("is-dragging-over");
    event.target.closest("[data-mapping-index]")?.classList.add("is-dragging-over");
  }

  function handleMappingDragLeave(event) {
    event.target.closest("[data-mapping-index]")?.classList.remove("is-dragging-over");
    if (!el.mappingTableWrap.contains(event.relatedTarget)) {
      el.mappingTableWrap.classList.remove("is-dragging-over");
      el.mappingRows.classList.remove("is-dragging-over");
    }
  }

  function handleMappingDropEvent(event) {
    el.mappingTableWrap.classList.remove("is-dragging-over");
    el.mappingRows.classList.remove("is-dragging-over");
    el.mappingRows.querySelectorAll(".is-dragging-over").forEach((row) => row.classList.remove("is-dragging-over"));
    handleMappingDrop(event);
  }

  el.mappingTableWrap.addEventListener("dragover", handleMappingDragOver);
  el.mappingTableWrap.addEventListener("dragleave", handleMappingDragLeave);
  el.mappingTableWrap.addEventListener("drop", handleMappingDropEvent);

  el.mappingRows.addEventListener("click", (event) => {
    const editIndex = Number(event.target.closest("[data-edit]")?.dataset.edit);
    const removeIndex = Number(event.target.closest("[data-remove]")?.dataset.remove);
    if (Number.isFinite(editIndex)) openEditor(editIndex);
    if (Number.isFinite(removeIndex)) {
      state.createRecord.mappings.splice(removeIndex, 1);
      render();
    }
  });

  el.editorMode.addEventListener("change", renderEditorVisibility);
  el.editorTarget.addEventListener("change", renderEditorVisibility);
  el.editorValueCast.addEventListener("change", renderEditorVisibility);
  el.editorCalculation?.addEventListener("input", () => {
    updateCalculationLineNumbers();
    renderCalculationSuggestions();
  });
  el.editorCalculation?.addEventListener("scroll", () => {
    if (el.calculationLineNumbers) el.calculationLineNumbers.scrollTop = el.editorCalculation.scrollTop;
  });
  el.editorCalculation?.addEventListener("keyup", renderCalculationSuggestions);
  el.editorCalculation?.addEventListener("click", renderCalculationSuggestions);
  el.calculationHelp?.addEventListener("click", () => {
    if (el.calculationDocs) el.calculationDocs.hidden = !el.calculationDocs.hidden;
  });
  el.calculationSuggestions?.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const button = event.target.closest("[data-calculation-suggestion]");
    if (!button) return;
    applyCalculationSuggestion(Number(button.dataset.calculationSuggestion));
  });
  document.addEventListener("mousedown", (event) => {
    if (event.target === el.editorCalculation || el.calculationSuggestions?.contains(event.target)) return;
    hideCalculationSuggestions();
  });
  el.closeEditor.addEventListener("click", closeEditor);
  el.cancelEditor.addEventListener("click", closeEditor);
  el.saveEditor.addEventListener("click", saveEditor);

  el.save.addEventListener("click", () => {
    if (state.mapMode === "itemLineAction") {
      const itemLineAction = {
        ...(state.itemLineAction || {}),
        target: state.itemLineAction?.target || state.itemLineAction?.source || "storeSalesOrder",
        source: state.itemLineAction?.target || state.itemLineAction?.source || "storeSalesOrder",
        sourceRecord: state.createRecord.sourceRecord || "storeSalesOrder",
        sourcePanel: state.createRecord.sourcePanel || "record",
        mappings: normaliseConfig(state.createRecord).mappings,
      };
      const payload = {
        type: "cs-item-line-map-saved",
        nodeId: state.nodeId,
        workflowId: state.workflowId,
        itemLineAction,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, itemLineAction }));
      if (window.opener) window.opener.postMessage(payload, window.location.origin);
      window.close();
      return;
    }
    const payload = {
      type: "cs-create-record-map-saved",
      nodeId: state.nodeId,
      workflowId: state.workflowId,
      createRecord: normaliseConfig(state.createRecord),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, createRecord: payload.createRecord }));
    if (window.opener) window.opener.postMessage(payload, window.location.origin);
    window.close();
  });

  loadState();
  render();
});
