// public/js/engagement.js
console.log("✅ engagement.js loaded");

document.addEventListener("DOMContentLoaded", () => {
  // === Main Tabs ===
  const tabs = document.querySelectorAll(".tab");
  const sections = document.querySelectorAll(".engagement-section");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      sections.forEach(s => s.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.target).classList.add("active");
    });
  });

  // === Subtabs for Announcements ===
  const subtabs = document.querySelectorAll(".subtab");
  subtabs.forEach(sub => {
    sub.addEventListener("click", () => {
      const group = sub.closest(".left-panel");
      group.querySelectorAll(".subtab").forEach(s => s.classList.remove("active"));
      group.querySelectorAll(".subtab-content").forEach(c => c.classList.remove("active"));
      sub.classList.add("active");
      document.getElementById(sub.dataset.target).classList.add("active");

      // Optional: Reflect active tab in analytics title
      const analyticsTitle = document.querySelector(".analytics-panel h2");
      if (analyticsTitle) {
        const textMap = {
          "my-announcements": "My Announcements Analytics",
          "public-announcements": "Public Announcements Analytics",
          "shared-announcements": "Shared With Me Analytics"
        };
        analyticsTitle.textContent = textMap[sub.dataset.target] || "Analytics";
      }
    });
  });

  // === Open Announcement Creation Popup ===
  const newAnnouncementBtn = document.getElementById("newAnnouncementBtn");
  if (newAnnouncementBtn) {
    newAnnouncementBtn.addEventListener("click", e => {
      e.preventDefault();

      console.log("🆕 Opening Create Announcement popup...");

      const popup = window.open(
        "EngagementPopups/announcementPopup.html",
        "CreateAnnouncement",
        "width=650,height=720,resizable=yes,scrollbars=yes"
      );

      if (!popup) {
        alert("⚠️ Please allow pop-ups for this site to create announcements.");
        console.warn("🚫 Popup blocked by browser.");
        return;
      }

      popup.focus();
    });
  }
});
