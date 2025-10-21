// public/js/adminRoles.js
document.addEventListener("DOMContentLoaded", () => {
  const roleTableBody = document.querySelector("#roleTable tbody");
  const roleModal = document.getElementById("roleModal");
  const roleForm = document.getElementById("roleForm");
  const cancelRoleBtn = document.getElementById("cancelRoleModal");
  const addRoleBtn = document.getElementById("addRoleBtn");
  const accessSelect = document.getElementById("accessSelect");

  let editingRoleId = null;

  // --- Fetch & Render Roles ---
  async function fetchRoles() {
    try {
      const res = await fetch("/api/meta/roles");
      const data = await res.json();
      if (!data.ok) throw new Error("Failed to fetch roles");

      renderRoleTable(data.roles);

      // 🔄 Mark update for menu.js sync
      localStorage.setItem("eposRolesUpdated", Date.now());
      console.log("♻️ Roles refreshed from DB:", data.roles);
    } catch (err) {
      console.error("❌ Error fetching roles:", err);
      alert("Failed to load roles. Check console for details.");
    }
  }

  function renderRoleTable(roles) {
    roleTableBody.innerHTML = roles
      .map(
        (r) => `
        <tr>
          <td>${r.id}</td>
          <td>${r.name}</td>
          <td>${(r.access || []).join(", ")}</td>
          <td class="actions">
            <button class="action-btn action-edit" data-id="${r.id}">Edit</button>
            <button class="action-btn action-delete" data-id="${r.id}">Delete</button>
          </td>
        </tr>
      `
      )
      .join("");

    // Reattach listeners
    roleTableBody.querySelectorAll(".action-edit").forEach((btn) =>
      btn.addEventListener("click", () => openRoleModal(btn.dataset.id))
    );
    roleTableBody.querySelectorAll(".action-delete").forEach((btn) =>
      btn.addEventListener("click", () => deleteRole(btn.dataset.id))
    );
  }

  // --- Open Role Modal ---
  async function openRoleModal(id = null) {
    editingRoleId = id;
    document.getElementById("roleModalTitle").textContent = id ? "Edit Role" : "Add Role";
    roleForm.reset();
    if (accessSelect) Array.from(accessSelect.options).forEach(o => (o.selected = false));

    if (id) {
      try {
        const res = await fetch(`/api/meta/roles`);
        const data = await res.json();
        const role = data.roles.find((r) => r.id == id);
        if (role) {
          roleForm.name.value = role.name || "";
          const accessArray = Array.isArray(role.access) ? role.access : [];
          Array.from(accessSelect.options).forEach((opt) => {
            opt.selected = accessArray.includes(opt.value);
          });
        }
      } catch (err) {
        console.error("Failed to load role details:", err);
        alert("Failed to load role details.");
      }
    }

    showRoleModal();
  }

  function showRoleModal() {
    roleModal.classList.remove("hidden");
  }

  function closeRoleModal() {
    roleModal.classList.add("hidden");
  }

  // --- Delete Role ---
  async function deleteRole(id) {
    if (!confirm("Delete this role?")) return;
    try {
      console.log("🗑️ Deleting role:", id);
      const res = await fetch(`/api/meta/roles/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Delete failed");
      fetchRoles();
    } catch (err) {
      console.error("Delete role failed:", err);
      alert("Failed to delete role.");
    }
  }

  // --- Save Role ---
  roleForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = roleForm.name.value.trim();
    const access = Array.from(roleForm.access.selectedOptions).map((o) => o.value);

    if (!name) {
      alert("Role name is required");
      return;
    }

    const payload = { name, access };
    const method = editingRoleId ? "PUT" : "POST";
    const url = editingRoleId
      ? `/api/meta/roles/${editingRoleId}`
      : "/api/meta/roles";

    console.log("📤 Saving role to DB:", { method, url, payload });

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      console.log("📥 API response:", data);

      if (!data.ok) throw new Error(data.error || "Save failed");

      console.log("✅ Role saved successfully:", name, access);
      closeRoleModal();
      await fetchRoles();
    } catch (err) {
      console.error("❌ Save role failed:", err);
      alert("Failed to save role. Check console for details.");
    }
  });

  // --- Event Listeners ---
  cancelRoleBtn.addEventListener("click", closeRoleModal);
  addRoleBtn.addEventListener("click", () => openRoleModal());

  // --- Init ---
  fetchRoles();
});
