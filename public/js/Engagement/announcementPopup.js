// public/js/announcementPopup.js
console.log("✅ announcementPopup.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const cancelBtn = document.getElementById("cancelBtn");
  const form = document.getElementById("announcementForm");

  // === Load dynamic lists (Roles & Users) ===
  try {
    const [rolesRes, usersRes] = await Promise.all([
      fetch("/api/meta/roles").then(r => r.json()),
      fetch("/api/users").then(r => r.json())
    ]);

    // Populate Audience (roles)
    const audienceSelect = document.getElementById("audience");
    if (rolesRes.ok && Array.isArray(rolesRes.roles)) {
      rolesRes.roles.forEach(role => {
        const opt = document.createElement("option");
        opt.value = role.id;
        opt.textContent = role.name;
        audienceSelect.appendChild(opt);
      });
    }

    // Populate Shared With (users)
    const sharedSelect = document.getElementById("sharedWith");
    if (usersRes.ok && Array.isArray(usersRes.users)) {
      usersRes.users.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.firstName} ${u.lastName}`;
        sharedSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("❌ Failed to load dynamic lists:", err);
  }

  // === Validation and Submission ===
  form.addEventListener("submit", e => {
    e.preventDefault();

    const title = form.title.value.trim();
    const message = form.message.value.trim();
    const startDate = form.startDate.value;
    const immediate = form.immediate.checked;
    const endDate = form.endDate.value;

    if (!title || !message) {
      alert("❌ Title and Announcement text are required.");
      return;
    }

    if (!startDate && !immediate) {
      alert("❌ Please select a start date or check 'Immediate'.");
      return;
    }

    const data = {
      title,
      message,
      startDate: immediate ? new Date().toISOString() : startDate,
      endDate: endDate || null,
      audience: Array.from(form.audience.selectedOptions).map(o => o.value),
      analytics: form.analytics.value,
      sharedWith: Array.from(form.sharedWith.selectedOptions).map(o => o.value),
    };

    console.log("🧾 Announcement payload:", data);
    alert("✅ Announcement created (mock submission).");
    window.close();
  });

  cancelBtn.addEventListener("click", () => window.close());
});
