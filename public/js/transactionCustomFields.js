(function () {
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function labelCustomFieldType(value) {
    const labels = {
      free_form_text: "Free-form Text",
      list_record: "List/Record",
      number: "Number",
      currency: "Currency",
    };
    return labels[value] || value || "";
  }

  function customFieldInputHtml(field) {
    const value = field?.value ?? "";
    const id = escapeHtml(field.id);
    const label = escapeHtml(field.appLabel || field.fieldInternalId || "Custom Field");
    const baseAttrs = `data-custom-field-id="${id}" aria-label="${label}"`;

    if (field.fieldType === "list_record") {
      const options = Array.isArray(field.options) ? field.options : [];
      const currentValue = String(value ?? "");
      const hasCurrent = options.some((option) => String(option.id) === currentValue);
      const currentLabel = field.displayValue || currentValue;
      const optionHtml = [
        `<option value="">Select</option>`,
        ...(!hasCurrent && currentValue
          ? [`<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentLabel)}</option>`]
          : []),
        ...options.map((option) => {
          const optionValue = String(option.id || "");
          const selected = optionValue === currentValue ? " selected" : "";
          return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(option.name || optionValue)}</option>`;
        }),
      ].join("");

      return `
        <select class="custom-field-control" ${baseAttrs}>
          ${optionHtml}
        </select>
        ${field.optionsError ? `<small class="related-custom-field-error">${escapeHtml(field.optionsError)}</small>` : ""}
      `;
    }

    if (field.fieldType === "number" || field.fieldType === "currency") {
      return `<input class="custom-field-control" ${baseAttrs} type="number" step="0.01" value="${escapeHtml(value)}" />`;
    }

    return `<input class="custom-field-control" ${baseAttrs} type="text" value="${escapeHtml(value)}" />`;
  }

  function renderCustomFields(customFields = [], emptyMessage = "No custom fields are visible for this record.") {
    const tbody = document.getElementById("customFieldsBody");
    if (!tbody) return;

    const fields = Array.isArray(customFields) ? customFields : [];
    window._currentCustomFields = fields;

    if (!fields.length) {
      tbody.innerHTML = `
        <tr>
          <td class="custom-fields-empty">${escapeHtml(emptyMessage)}</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = fields
      .map((field) => {
        const typeLabel = labelCustomFieldType(field.fieldType);
        const label = field.appLabel || field.fieldInternalId || "Custom Field";
        return `
          <tr>
            <th>
              ${escapeHtml(label)}
              ${typeLabel ? `<small class="related-custom-field-type">${escapeHtml(typeLabel)}</small>` : ""}
            </th>
            <td>${customFieldInputHtml(field)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function collectCustomFieldPayload({ includeEmpty = false } = {}) {
    return [...document.querySelectorAll(".custom-field-control")]
      .map((control) => ({
        id: control.dataset.customFieldId,
        value: control.value,
      }))
      .filter((field) => field.id && (includeEmpty || String(field.value ?? "").trim() !== ""));
  }

  async function loadCustomFields(recordType, { headers = {}, emptyMessage } = {}) {
    const status = document.getElementById("customFieldsStatus");
    if (status) status.textContent = "Loading custom fields...";

    try {
      const params = new URLSearchParams({
        recordType,
        includeOptions: "1",
      });
      const res = await fetch(`/api/custom-fields/visible?${params.toString()}`, {
        headers,
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load custom fields");

      renderCustomFields(data.customFields || [], emptyMessage);
      if (status) status.textContent = "";
      return data.customFields || [];
    } catch (err) {
      console.error("Failed to load transaction custom fields:", err);
      renderCustomFields([], err.message || "Custom fields could not be loaded.");
      if (status) status.textContent = err.message || "Custom fields could not be loaded.";
      return [];
    }
  }

  function bindTabs() {
    document.querySelectorAll(".sales-view-tab").forEach((button) => {
      if (button.dataset.customFieldTabsBound === "1") return;
      button.dataset.customFieldTabsBound = "1";
      button.addEventListener("click", () => {
        const tab = button.dataset.salesTab;
        const section = button.closest(".order-items-section") || document;
        section.querySelectorAll(".sales-view-tab").forEach((next) => {
          const active = next === button;
          next.classList.toggle("active", active);
          next.setAttribute("aria-selected", active ? "true" : "false");
        });
        section.querySelectorAll(".sales-tab-panel").forEach((panel) => {
          const active = panel.id === `salesTab${tab[0].toUpperCase()}${tab.slice(1)}`;
          panel.classList.toggle("active", active);
          panel.hidden = !active;
        });
      });
    });
  }

  window.EposTransactionCustomFields = {
    bindTabs,
    collect: collectCustomFieldPayload,
    collectAll: () => collectCustomFieldPayload({ includeEmpty: true }),
    load: loadCustomFields,
    render: renderCustomFields,
  };

  document.addEventListener("DOMContentLoaded", bindTabs);
})();
