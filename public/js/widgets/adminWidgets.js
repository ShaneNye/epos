// public/js/adminWidgets.js
console.log("⚙️ Admin Dashboard Widgets loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("widgetList");
  if (!container) return;

  /* ============================================================
     Widget definitions (must match your dashboard keys)
  ============================================================ */
  const widgets = [
    { key: "salesToday", name: "Sales Created Today", desc: "Displays all sales created today." },
    { key: "salesByStore", name: "Sales by Store", desc: "Shows a breakdown of sales by store." },
    { key: "topThree", name: "Top 3 Bed Specialists", desc: "Highlights top-performing sales staff." }
  ];

  /* ============================================================
     Load existing widget-role configuration
  ============================================================ */
  let config = [];
  try {
    const res = await fetch("/api/dashboard-widgets");
    const data = await res.json();
    if (data.ok) config = data.widgets;
    console.log("🧩 Loaded widget-role config:", config);
  } catch (err) {
    console.error("❌ Failed to load widget roles:", err);
  }

  /* ============================================================
     Render widget cards
  ============================================================ */
  container.innerHTML = widgets.map(w => {
    const entry = config.find(c => c.widget === w.key);
    const roles = entry?.roles?.length
      ? entry.roles.map(r => `<span class="role-badge">${r}</span>`).join(" ")
      : `<em>No roles assigned</em>`;
    return `
      <div class="widget-admin-card">
        <div>
          <h3>${w.name}</h3>
          <p>${w.desc}</p>
          <small><strong>Visible to:</strong> ${roles}</small>
        </div>
        <button class="btn-secondary edit-widget" data-key="${w.key}">
          Edit Roles
        </button>
      </div>
    `;
  }).join("");

  /* ============================================================
     Modal Logic
  ============================================================ */
  const modal = document.getElementById("widgetRoleModal");
  const roleSelect = document.getElementById("widgetRoleSelect");
  const cancelBtn = document.getElementById("cancelWidgetRoleModal");
  const form = document.getElementById("widgetRoleForm");

  // --- Fetch roles from backend ---
  async function fetchAllRoles() {
    const res = await fetch("/api/roles");
    if (!res.ok) throw new Error("Failed to load roles");
    const roles = await res.json();
    return roles.sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- Open modal and preselect roles ---
  container.addEventListener("click", async e => {
    if (!e.target.classList.contains("edit-widget")) return;

    const key = e.target.dataset.key;
    document.getElementById("widgetKey").value = key;
    document.getElementById("widgetRoleModalTitle").textContent = `Edit Access for "${key}"`;

    try {
      const [allRoles, widgetConfigRes] = await Promise.all([
        fetchAllRoles(),
        fetch("/api/dashboard-widgets")
      ]);

      const widgetConfig = await widgetConfigRes.json();
      const currentWidget = widgetConfig.widgets?.find(w => w.widget === key);
      const assigned = new Set(currentWidget?.roles || []);
      console.log(`📋 Widget "${key}" assigned roles:`, Array.from(assigned));

      // Build role list with preselected items
      roleSelect.innerHTML = allRoles
        .map(r => {
          const selected = assigned.has(r.name) ? "selected" : "";
          return `<option value="${r.name}" ${selected}>${r.name}</option>`;
        })
        .join("");

      modal.classList.remove("hidden");
    } catch (err) {
      console.error("❌ Failed to load roles/config:", err);
      alert("Error loading roles");
    }
  });

  // --- Cancel button ---
  cancelBtn.addEventListener("click", () => modal.classList.add("hidden"));

  // --- Save widget role assignments ---
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const widgetKey = document.getElementById("widgetKey").value;
    const selected = Array.from(roleSelect.selectedOptions).map(o => o.value);

    try {
      const res = await fetch("/api/dashboard-widgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetKey, roles: selected })
      });

      if (!res.ok) throw new Error("Failed to save roles");

      alert(`✅ Roles updated for "${widgetKey}"`);
      modal.classList.add("hidden");
      location.reload();
    } catch (err) {
      console.error("❌ Failed to save widget roles:", err);
      alert("Error saving roles");
    }
  });
});
