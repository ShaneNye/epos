// adminMain.js
document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".tab");
  const contents = document.querySelectorAll(".tab-content");

  function activateTab(tabEl) {
    // Deactivate all
    tabs.forEach(t => t.classList.remove("active"));
    contents.forEach(c => c.classList.add("hidden"));

    // Activate selected
    tabEl.classList.add("active");
    const targetId = tabEl.dataset.target;
    const target = document.getElementById(targetId);
    if (target) target.classList.remove("hidden");

    // Notify listeners (e.g., adminUsers.js)
    window.dispatchEvent(new CustomEvent("tab:show", { detail: { id: targetId } }));

    // Direct call as a fallback if available
    if (targetId === "users" && typeof window.fetchUsers === "function") {
      window.fetchUsers();
    }

    // Optional: remember active tab
    try { localStorage.setItem("admin.activeTab", targetId); } catch {}
  }

  // Wire clicks
  tabs.forEach(tab => tab.addEventListener("click", () => activateTab(tab)));

  // Initial selection: last active or first
  let startId = null;
  try { startId = localStorage.getItem("admin.activeTab"); } catch {}

  const startTab = startId
    ? Array.from(tabs).find(t => t.dataset.target === startId)
    : tabs[0];

  if (startTab) activateTab(startTab);
});
