console.log("✅ announcementPopup.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const cancelBtn = document.getElementById("cancelBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const form = document.getElementById("announcementForm");

  // === Extract query params ===
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  const recordId = urlParams.get("id");
  const mode = urlParams.get("mode") || "create";

  // Hide delete button by default
  if (deleteBtn) deleteBtn.style.display = "none";

  if (!token && mode !== "view" && mode !== "edit") {
    alert("⚠️ Missing session token. Please reopen the popup from the Engagement page.");
    window.close();
    return;
  }

  console.log(`🧭 Mode: ${mode}, Record ID: ${recordId || "new"}`);

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

  // === Load existing record if edit/view ===
  if (recordId && (mode === "edit" || mode === "view")) {
    try {
      const res = await fetch(`/api/engagement/announcement/${recordId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        console.error("❌ Failed to fetch record, status:", res.status);
        throw new Error(`Fetch failed: ${res.status}`);
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to fetch record");

      const a = data.announcement;
      console.log("📄 Loaded announcement:", a);

      // Fill form values
      form.title.value = a.title || "";
      form.message.value = a.message || "";
      form.startDate.value = a.start_date ? a.start_date.split("T")[0] : "";
      form.endDate.value = a.end_date ? a.end_date.split("T")[0] : "";
      form.analytics.value = a.analytics_visibility || "private";

      // Populate roles and users selections
      if (Array.isArray(a.audience_roles)) {
        Array.from(form.audience.options).forEach(opt => {
          if (a.audience_roles.includes(parseInt(opt.value))) opt.selected = true;
        });
      }

      if (Array.isArray(a.shared_with_users)) {
        Array.from(form.sharedWith.options).forEach(opt => {
          if (a.shared_with_users.includes(parseInt(opt.value))) opt.selected = true;
        });
      }

      // === Mode handling ===
      if (mode === "view") {
        // Disable all form inputs
        form.querySelectorAll("input, textarea, select").forEach(el => {
          el.disabled = true;
        });
        document.getElementById("saveBtn")?.remove();
        if (deleteBtn) deleteBtn.remove();
        cancelBtn.textContent = "Close";
      }

      if (mode === "edit" && deleteBtn) {
        deleteBtn.style.display = "inline-block";
      }

    } catch (err) {
      console.error("❌ Failed to load announcement:", err);
      alert("❌ Failed to load announcement.");
    }
  }

  // === Form Submission (Create or Update) ===
  form.addEventListener("submit", async e => {
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
      immediate,
      endDate: endDate || null,
      audience: Array.from(form.audience.selectedOptions).map(o => parseInt(o.value)),
      analytics: form.analytics.value,
      sharedWith: Array.from(form.sharedWith.selectedOptions).map(o => parseInt(o.value)),
    };

    console.log("🧾 Submitting announcement:", data);

    const url =
      mode === "edit"
        ? `/api/engagement/announcement/${recordId}`
        : "/api/engagement/announcement";
    const method = mode === "edit" ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        console.error("❌ Save failed, status:", res.status);
        throw new Error(`Save failed: ${res.status}`);
      }

      const json = await res.json();

      if (!json.ok) throw new Error(json.error || "Failed to save announcement");

      alert(
        mode === "edit"
          ? "✅ Announcement updated successfully!"
          : "✅ Announcement created successfully!"
      );

      // 🔁 Notify parent to refresh
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ action: "refresh-announcements" }, "*");
      }

      window.close();
    } catch (err) {
      console.error("❌ Failed to save announcement:", err);
      alert("❌ Failed to save announcement — check console for details.");
    }
  });

  // === Delete Record ===
  if (deleteBtn && mode === "edit" && recordId) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("🗑️ Are you sure you want to delete this announcement?")) return;

      try {
        const res = await fetch(`/api/engagement/announcement/${recordId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          console.error("❌ Delete failed, status:", res.status);
          throw new Error(`Delete failed: ${res.status}`);
        }

        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Failed to delete announcement");

        alert("🗑️ Announcement deleted successfully!");

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ action: "refresh-announcements" }, "*");
        }

        window.close();
      } catch (err) {
        console.error("❌ Delete failed:", err);
        alert("❌ Failed to delete announcement.");
      }
    });
  }

  // === Cancel/Close Button ===
  cancelBtn.addEventListener("click", () => window.close());
});
