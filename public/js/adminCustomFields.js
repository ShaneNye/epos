document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#customFieldsTable tbody");
  const modal = document.getElementById("customFieldModal");
  const form = document.getElementById("customFieldForm");
  const addBtn = document.getElementById("addCustomFieldBtn");
  const cancelBtn = document.getElementById("cancelCustomFieldModal");
  const title = document.getElementById("customFieldModalTitle");
  const fieldType = document.getElementById("customFieldType");
  const listWrap = document.getElementById("customFieldListRecordWrap");
  const roleSelect = document.getElementById("customFieldRoleSelect");
  const userSelect = document.getElementById("customFieldUserSelect");
  const status = document.getElementById("customFieldStatus");

  if (!tableBody || !modal || !form) return;

  let customFields = [];
  let roles = [];
  let users = [];
  let editingId = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function labelRecordType(value) {
    return value === "quote" ? "Quote" : "Sales Order";
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, error: text };
      }
    }

    if (!res.ok) {
      if (res.status === 404 && url.includes("/api/custom-fields")) {
        throw new Error("Custom Fields API not found. Restart the EPOS server so the new route is loaded.");
      }
      throw new Error(data?.error || `Request failed (${res.status})`);
    }

    return data || {};
  }

  function labelFieldType(value) {
    const labels = {
      free_form_text: "Free-form Text",
      list_record: "List/Record",
      number: "Number",
      currency: "Currency",
    };
    return labels[value] || value || "";
  }

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message || "";
    status.style.color = isError ? "#b42318" : "";
  }

  function selectedValues(select) {
    return Array.from(select?.selectedOptions || []).map((option) => option.value);
  }

  function setSelected(select, values) {
    const selected = new Set((values || []).map(String));
    Array.from(select?.options || []).forEach((option) => {
      option.selected = selected.has(String(option.value));
    });
  }

  function accessSummary(field) {
    const roleNames = (field.accessRoleIds || [])
      .map((id) => roles.find((role) => String(role.id) === String(id))?.name || `Role ${id}`);
    const userNames = (field.accessUserIds || [])
      .map((id) => {
        const user = users.find((next) => String(next.id) === String(id));
        return user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email : `User ${id}`;
      });

    const parts = [...roleNames, ...userNames].filter(Boolean);
    return parts.length ? parts.join(", ") : "All users";
  }

  function syncListFieldVisibility() {
    const isListRecord = fieldType?.value === "list_record";
    listWrap?.classList.toggle("hidden", !isListRecord);
    const input = form.elements.listRecordInternalId;
    if (input) {
      input.required = isListRecord;
      if (!isListRecord) input.value = "";
    }
  }

  function renderTable() {
    if (!customFields.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:1rem; color:var(--muted);">
            No custom fields configured.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = customFields
      .map((field) => `
        <tr>
          <td>${escapeHtml(labelRecordType(field.recordType))}</td>
          <td>${escapeHtml(field.appLabel || "-")}</td>
          <td><code>${escapeHtml(field.fieldInternalId)}</code></td>
          <td>${escapeHtml(labelFieldType(field.fieldType))}</td>
          <td>${escapeHtml(field.listRecordInternalId || "-")}</td>
          <td>${escapeHtml(accessSummary(field))}</td>
          <td class="actions">
            <button type="button" class="action-btn action-edit" data-id="${field.id}">Edit</button>
            <button type="button" class="action-btn action-delete" data-id="${field.id}">Delete</button>
          </td>
        </tr>
      `)
      .join("");

    tableBody.querySelectorAll(".action-edit").forEach((button) => {
      button.addEventListener("click", () => openModal(button.dataset.id));
    });
    tableBody.querySelectorAll(".action-delete").forEach((button) => {
      button.addEventListener("click", () => deleteCustomField(button.dataset.id));
    });
  }

  async function loadOptions() {
    const [rolesData, usersData] = await Promise.all([
      fetchJson("/api/meta/roles"),
      fetchJson("/api/users"),
    ]);

    roles = rolesData.ok ? rolesData.roles || [] : [];
    users = usersData.ok ? usersData.users || [] : [];

    roleSelect.innerHTML = roles
      .map((role) => `<option value="${role.id}">${escapeHtml(role.name)}</option>`)
      .join("");
    userSelect.innerHTML = users
      .map((user) => {
        const name = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;
        return `<option value="${user.id}">${escapeHtml(name)}</option>`;
      })
      .join("");
  }

  async function loadCustomFields() {
    try {
      setStatus("Loading...");
      await loadOptions();
      const data = await fetchJson("/api/custom-fields");
      if (!data.ok) throw new Error(data.error || "Failed to load custom fields");
      customFields = data.customFields || [];
      renderTable();
      setStatus("");
    } catch (err) {
      console.error("Failed to load custom fields:", err);
      setStatus(err.message || "Failed to load custom fields", true);
    }
  }

  async function openModal(id = null) {
    editingId = id;
    form.reset();
    await loadOptions();
    title.textContent = id ? "Edit Custom Field" : "Add Custom Field";

    const field = customFields.find((next) => String(next.id) === String(id));
    if (field) {
      form.elements.id.value = field.id;
      form.elements.recordType.value = field.recordType;
      form.elements.appLabel.value = field.appLabel || "";
      form.elements.fieldInternalId.value = field.fieldInternalId;
      form.elements.fieldType.value = field.fieldType;
      form.elements.listRecordInternalId.value = field.listRecordInternalId || "";
      setSelected(roleSelect, field.accessRoleIds);
      setSelected(userSelect, field.accessUserIds);
    }

    syncListFieldVisibility();
    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  async function deleteCustomField(id) {
    if (!confirm("Delete this custom field?")) return;
    try {
      const data = await fetchJson(`/api/custom-fields/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!data.ok) throw new Error(data.error || "Delete failed");
      await loadCustomFields();
    } catch (err) {
      console.error("Failed to delete custom field:", err);
      alert(err.message || "Failed to delete custom field.");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      recordType: form.elements.recordType.value,
      appLabel: form.elements.appLabel.value.trim(),
      fieldInternalId: form.elements.fieldInternalId.value.trim(),
      fieldType: form.elements.fieldType.value,
      listRecordInternalId: form.elements.listRecordInternalId.value.trim(),
      accessRoleIds: selectedValues(roleSelect),
      accessUserIds: selectedValues(userSelect),
    };

    try {
      const url = editingId
        ? `/api/custom-fields/${encodeURIComponent(editingId)}`
        : "/api/custom-fields";
      const method = editingId ? "PUT" : "POST";
      const data = await fetchJson(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!data.ok) throw new Error(data.error || "Save failed");
      closeModal();
      await loadCustomFields();
    } catch (err) {
      console.error("Failed to save custom field:", err);
      alert(err.message || "Failed to save custom field.");
    }
  });

  fieldType?.addEventListener("change", syncListFieldVisibility);
  addBtn?.addEventListener("click", () => openModal());
  cancelBtn?.addEventListener("click", closeModal);

  window.addEventListener("tab:show", (event) => {
    if (event.detail?.id === "custom-fields") loadCustomFields();
  });

  loadCustomFields();
});
