// public/js/widgets/adminWidgets.js
console.log("Admin dashboard tabs loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("widgetList");
  if (!container) return;

  const dashboardTabs = [
    {
      key: "sales",
      name: "Sales",
      desc: "Contains the current sales dashboard widgets, including sales totals, store performance, specialists, actions, KPI, forecast, and rota."
    },
    {
      key: "inventoryOperations",
      name: "Inventory (operations)",
      desc: "Contains operational inventory widgets, starting with bin transfer activity."
    }
  ];

  async function loadTabConfig() {
    const res = await fetch("/api/dashboard-tabs");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load dashboard tab roles");
    return data.tabs || [];
  }

  async function fetchAllRoles() {
    const res = await fetch("/api/roles");
    if (!res.ok) throw new Error("Failed to load roles");
    const roles = await res.json();
    return roles.sort((a, b) => a.name.localeCompare(b.name));
  }

  let config = [];
  try {
    config = await loadTabConfig();
    console.log("Loaded dashboard tab role config:", config);
  } catch (err) {
    console.error("Failed to load dashboard tab roles:", err);
  }

  container.innerHTML = dashboardTabs.map((tab) => {
    const entry = config.find((item) => item.tab === tab.key);
    const roles = entry?.roles?.length
      ? entry.roles.map((role) => `<span class="role-badge">${role}</span>`).join(" ")
      : "<em>Visible to all roles</em>";

    return `
      <div class="widget-admin-card">
        <div>
          <h3>${tab.name}</h3>
          <p>${tab.desc}</p>
          <small><strong>Visible to:</strong> ${roles}</small>
        </div>
        <button class="btn-secondary edit-widget" data-key="${tab.key}">
          Edit Roles
        </button>
      </div>
    `;
  }).join("");

  const modal = document.getElementById("widgetRoleModal");
  const roleSelect = document.getElementById("widgetRoleSelect");
  const cancelBtn = document.getElementById("cancelWidgetRoleModal");
  const form = document.getElementById("widgetRoleForm");

  container.addEventListener("click", async (event) => {
    if (!event.target.classList.contains("edit-widget")) return;

    const key = event.target.dataset.key;
    const tab = dashboardTabs.find((item) => item.key === key);
    document.getElementById("widgetKey").value = key;
    document.getElementById("widgetRoleModalTitle").textContent = `Edit Access for "${tab?.name || key}"`;

    try {
      const [allRoles, latestConfig] = await Promise.all([
        fetchAllRoles(),
        loadTabConfig()
      ]);

      const currentTab = latestConfig.find((item) => item.tab === key);
      const assigned = new Set(currentTab?.roles || []);
      console.log(`Dashboard tab "${key}" assigned roles:`, Array.from(assigned));

      roleSelect.innerHTML = allRoles
        .map((role) => {
          const selected = assigned.has(role.name) ? "selected" : "";
          return `<option value="${role.name}" ${selected}>${role.name}</option>`;
        })
        .join("");

      modal.classList.remove("hidden");
    } catch (err) {
      console.error("Failed to load roles/config:", err);
      alert("Error loading roles");
    }
  });

  cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tabKey = document.getElementById("widgetKey").value;
    const selected = Array.from(roleSelect.selectedOptions).map((option) => option.value);

    try {
      const res = await fetch("/api/dashboard-tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabKey, roles: selected })
      });

      if (!res.ok) throw new Error("Failed to save roles");

      alert(`Roles updated for "${tabKey}"`);
      modal.classList.add("hidden");
      location.reload();
    } catch (err) {
      console.error("Failed to save dashboard tab roles:", err);
      alert("Error saving roles");
    }
  });
});
