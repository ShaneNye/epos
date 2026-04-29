document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#aiAccessTable tbody");
  if (!tableBody) return;

  async function fetchRoles() {
    const response = await fetch("/api/meta/roles");
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to load roles");
    }
    return payload.roles || [];
  }

  function hasAiAccess(role) {
    return Array.isArray(role?.access) && role.access.includes("ai-access");
  }

  async function updateRole(role, enabled) {
    const nextAccess = new Set(Array.isArray(role.access) ? role.access : []);
    if (enabled) nextAccess.add("ai-access");
    else nextAccess.delete("ai-access");

    const response = await fetch(`/api/meta/roles/${role.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: role.name,
        access: Array.from(nextAccess),
      }),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to update AI access");
    }
  }

  function renderRoles(roles) {
    tableBody.innerHTML = roles
      .map((role) => {
        const enabled = hasAiAccess(role);
        return `
          <tr>
            <td>${role.name}</td>
            <td>
              <label style="display:inline-flex; align-items:center; gap:8px;">
                <input
                  type="checkbox"
                  class="ai-access-toggle"
                  data-role-id="${role.id}"
                  ${enabled ? "checked" : ""}
                />
                <span>${enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </td>
            <td>${enabled ? "AI prompt available" : "AI prompt blocked"}</td>
          </tr>
        `;
      })
      .join("");

    tableBody.querySelectorAll(".ai-access-toggle").forEach((checkbox) => {
      checkbox.addEventListener("change", async (event) => {
        const role = roles.find((item) => String(item.id) === String(event.target.dataset.roleId));
        if (!role) return;

        const enabled = event.target.checked;
        event.target.disabled = true;

        try {
          await updateRole(role, enabled);
          role.access = Array.isArray(role.access) ? role.access.filter(Boolean) : [];
          if (enabled && !role.access.includes("ai-access")) role.access.push("ai-access");
          if (!enabled) role.access = role.access.filter((value) => value !== "ai-access");
          renderRoles(roles);
        } catch (error) {
          console.error("Failed to update AI access:", error);
          alert(error.message || "Failed to update AI access.");
          event.target.checked = !enabled;
          event.target.disabled = false;
        }
      });
    });
  }

  async function init() {
    try {
      const roles = await fetchRoles();
      renderRoles(roles);
    } catch (error) {
      console.error("Failed to load AI access roles:", error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="3">Failed to load role AI access.</td>
        </tr>
      `;
    }
  }

  init();
});
