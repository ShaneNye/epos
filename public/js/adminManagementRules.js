// public/js/adminManagementRules.js
console.log("⚙️ adminManagementRules.js loaded");

document.addEventListener("DOMContentLoaded", () => {
    const tableBody = document.querySelector("#mgmtRulesTable tbody");
    if (!tableBody) return; // safety guard

    /* ============================================================
       FETCH & RENDER ROLES
    ============================================================ */
    async function loadRoles() {
        try {
            const res = await fetch("/api/meta/roles");
            const data = await res.json();
            if (!data.ok) throw new Error("Failed to load roles");

            renderRoleRows(data.roles);
        } catch (err) {
            console.error("❌ Unable to load roles:", err);
            tableBody.innerHTML =
                `<tr><td colspan="2" style="text-align:center;color:red;">
                    Failed to load roles
                 </td></tr>`;
        }
    }

    function renderRoleRows(roles) {
        if (!roles || roles.length === 0) {
            tableBody.innerHTML =
                `<tr><td colspan="2" style="text-align:center;">No roles found</td></tr>`;
            return;
        }

        tableBody.innerHTML = roles.map(r => `
            <tr>
                <td>${r.name}</td>
                <td class="actions">
                    <button class="action-btn action-edit" data-rolename="${r.name}">
                        Edit
                    </button>
                </td>
            </tr>
        `).join("");

        // Attach click handlers safely
        tableBody.querySelectorAll(".action-edit").forEach(btn => {
            btn.addEventListener("click", () => {
                const roleName = btn.dataset.rolename;
                openPopup(roleName);
            });
        });
    }

    /* ============================================================
       OPEN POPUP (using role *name*, not ID)
    ============================================================ */
    function openPopup(roleName) {
        const url = `./ManagementRulesPopup.html?roleName=${encodeURIComponent(roleName)}`;

        const popup = window.open(
            url,
            "ManagementRulesPopup",
            "width=500,height=650,resizable=yes,scrollbars=yes"
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
       INITIAL LOAD
    ============================================================ */
    loadRoles();
});
