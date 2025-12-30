// public/js/adminManagementRules.js
console.log("⚙️ adminManagementRules.js loaded");

document.addEventListener("DOMContentLoaded", () => {
  // Updated table selector for the new subtab
  // Make sure your admin.html table id is: userDataRoleTable
  const tableBody = document.querySelector("#userDataRoleTable tbody");
  if (!tableBody) return; // safety guard

  /* ============================================================
     FETCH HELPERS
  ============================================================ */
  async function fetchJSON(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return data;
  }

  /* ============================================================
     FETCH & RENDER ROLES + CURRENT RULES
  ============================================================ */
  async function loadRoles() {
    try {
      const data = await fetchJSON("/api/meta/roles");
      if (!data.ok) throw new Error("Failed to load roles");

      await renderRoleRows(data.roles);
    } catch (err) {
      console.error("❌ Unable to load roles:", err);
      tableBody.innerHTML =
        `<tr><td colspan="3" style="text-align:center;color:red;">
            Failed to load roles
         </td></tr>`;
    }
  }

  async function renderRoleRows(roles) {
    if (!roles || roles.length === 0) {
      tableBody.innerHTML =
        `<tr><td colspan="3" style="text-align:center;">No roles found</td></tr>`;
      return;
    }

    // Build skeleton rows first (so UI appears quickly)
    tableBody.innerHTML = roles.map(r => `
      <tr data-role="${escapeHtml(r.name)}">
        <td>${escapeHtml(r.name)}</td>
        <td class="editable-fields" style="max-width:520px;">
          <span style="opacity:.6;">Loading…</span>
        </td>
        <td class="actions">
          <button class="action-btn action-edit" data-rolename="${escapeAttr(r.name)}">
            Edit
          </button>
        </td>
      </tr>
    `).join("");

    // Fill allowed fields per-role
    for (const r of roles) {
      const roleName = r.name;
      const row = tableBody.querySelector(`tr[data-role="${cssEscape(roleName)}"]`);
      if (!row) continue;

      const cell = row.querySelector(".editable-fields");
      if (!cell) continue;

      try {
        const rules = await fetchJSON(`/api/meta/management-rules/${encodeURIComponent(roleName)}`);
        const fields = (rules && rules.ok && Array.isArray(rules.fields)) ? rules.fields : [];

        cell.innerHTML = fields.length
          ? escapeHtml(fields.join(", "))
          : `<span style="opacity:.6;">None</span>`;
      } catch (e) {
        console.error("❌ Failed to load rules for role:", roleName, e);
        cell.innerHTML = `<span style="color:red;">Failed</span>`;
      }
    }

    // Attach click handlers
    tableBody.querySelectorAll(".action-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const roleName = btn.dataset.rolename;
        openPopup(roleName);
      });
    });
  }

  /* ============================================================
     OPEN POPUP (role name)
  ============================================================ */
  function openPopup(roleName) {
    // keep your original popup page
    const url = `./ManagementRulesPopup.html?roleName=${encodeURIComponent(roleName)}`;

    const popup = window.open(
      url,
      "ManagementRulesPopup",
      "width=720,height=700,resizable=yes,scrollbars=yes"
    );

    if (!popup) {
      alert("⚠️ Please enable pop-ups to edit management rules.");
    }
  }

  /* ============================================================
     LISTEN FOR REFRESH FROM POPUP
  ============================================================ */
  window.addEventListener("message", event => {
    if (event.data?.action === "refresh-mgmt-rules") {
      console.log("🔄 Refreshing management rules...");
      loadRoles();
    }
  });

  /* ============================================================
     SMALL SAFETY HELPERS
  ============================================================ */
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(str) {
    // safe enough for data- attributes
    return escapeHtml(str).replaceAll("`", "&#096;");
  }

  function cssEscape(str) {
    // minimal escape for querySelector attribute match
    return String(str ?? "").replaceAll('"', '\\"');
  }

  /* ============================================================
     INITIAL LOAD
  ============================================================ */
  loadRoles();
});
