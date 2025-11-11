// public/js/engagement.js
console.log("✅ engagement.js loaded");

document.addEventListener("DOMContentLoaded", () => {
  // === Get stored auth/session info ===
  const auth = storageGet();
  const token = auth?.token || null;
  const username = auth?.username?.toLowerCase() || null;

  if (!token) {
    console.warn("⚠️ No session token found. User might not be logged in.");
  } else {
    console.log("🔐 Logged in as:", username);
  }

  // === Main Tabs ===
  const tabs = document.querySelectorAll(".tab");
  const sections = document.querySelectorAll(".engagement-section");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      sections.forEach((s) => s.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.target).classList.add("active");
    });
  });

  // === Subtabs for Announcements ===
  const subtabs = document.querySelectorAll(".subtab");
  subtabs.forEach((sub) => {
    sub.addEventListener("click", () => {
      const group = sub.closest(".left-panel");
      group
        .querySelectorAll(".subtab")
        .forEach((s) => s.classList.remove("active"));
      group
        .querySelectorAll(".subtab-content")
        .forEach((c) => c.classList.remove("active"));
      sub.classList.add("active");
      document.getElementById(sub.dataset.target).classList.add("active");

      const analyticsTitle = document.querySelector(".analytics-panel h2");
      if (analyticsTitle) {
        const textMap = {
          "my-announcements": "My Announcements Analytics",
          "public-announcements": "Public Announcements Analytics",
          "shared-announcements": "Shared With Me Analytics",
        };
        analyticsTitle.textContent =
          textMap[sub.dataset.target] || "Analytics";
      }
    });
  });

  // === Fetch Announcements from API ===
  async function fetchAnnouncements() {
    if (!token) return;
    try {
      const res = await fetch("/api/engagement/announcements", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      renderAnnouncements(data.announcements);
    } catch (err) {
      console.error("❌ Failed to load announcements:", err);
    }
  }

  // === Render Announcements into Subtabs ===
  function renderAnnouncements(list) {
    const mineList = document.getElementById("myAnnouncementList");
    const publicList = document.getElementById("publicAnnouncementList");
    const sharedList = document.getElementById("sharedAnnouncementList");

    mineList.innerHTML = "";
    publicList.innerHTML = "";
    sharedList.innerHTML = "";

    const auth = storageGet();
    const username = auth?.username?.toLowerCase() || "";
    const userId = Number(auth?.userId || auth?.id || auth?.user?.id || 0);

    console.log("📦 Announcements received:", list);
    console.log("👤 Current username:", username);
    console.log("🧩 Current userId:", userId);

    list.forEach((a) => {
      const li = document.createElement("li");
      const date = a.start_date
        ? new Date(a.start_date).toLocaleDateString()
        : "No start date";

      const sharedWith = Array.isArray(a.shared_with_users)
        ? a.shared_with_users.map(Number)
        : [];
      const sharedEmails = Array.isArray(a.shared_with_emails)
        ? a.shared_with_emails.map((e) => e.toLowerCase())
        : [];

      const createdByEmail = a.created_by_email?.toLowerCase() || null;
      const analytics = a.analytics_visibility || "private";

      // Determine placement & permissions
      const isMine = createdByEmail === username;
      const isShared =
        sharedWith.includes(userId) || sharedEmails.includes(username);
      const isPublic = analytics === "public" && !isMine;

      // Decide icon + mode
      let icon = "";
      let mode = "view";
      if (isMine) {
        icon = "✏️";
        mode = "edit";
      } else if (isPublic || isShared) {
        icon = "👁️";
        mode = "view";
      }

      li.classList.add("announcement-item");
      li.innerHTML = `
        <div class="announcement-header">
          <strong>${a.title}</strong>
          ${icon
          ? `<span class="icon action-icon" data-id="${a.id}" data-mode="${mode}" title="${mode === "edit" ? "Edit" : "View"
          }">${icon}</span>`
          : ""
        }
        </div>
        <span class="muted">${date}</span><br>
        ${a.message}
      `;

      // Append to the correct list
      if (isMine) mineList.appendChild(li);
      else if (isPublic) publicList.appendChild(li);
      else if (isShared) sharedList.appendChild(li);

      // === Load analytics on body click ===
      li.addEventListener("click", (e) => {
        if (e.target.classList.contains("action-icon")) return;
        console.log(`📊 Loading analytics for announcement ${a.id}`);
        loadAnalytics(a.id, a.title);
      });
    });

    // Empty states
    if (!mineList.children.length)
      mineList.innerHTML = `<li class="empty">No announcements created by you yet.</li>`;
    if (!publicList.children.length)
      publicList.innerHTML = `<li class="empty">No public announcements available.</li>`;
    if (!sharedList.children.length)
      sharedList.innerHTML = `<li class="empty">No shared announcements yet.</li>`;

    // === Icon click handlers ===
    document.querySelectorAll(".action-icon").forEach((icon) => {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        const mode = e.target.dataset.mode;

        console.log(`🧭 Opening announcement ${id} in ${mode} mode`);

        const popup = window.open(
          `/EngagementPopups/announcementPopup.html?id=${id}&mode=${mode}&token=${encodeURIComponent(token)}`,
          "AnnouncementPopup",
          "width=650,height=720,resizable=yes,scrollbars=yes"
        );

        if (!popup) {
          alert("⚠️ Please allow popups to view or edit announcements.");
        } else {
          popup.focus();
        }
      });
    });
  }

// === Load Analytics ===
async function loadAnalytics(id, title) {
  const analyticsPanel = document.querySelector(".analytics-panel");
  const analyticsTitle = analyticsPanel.querySelector("h2");

  try {
    const res = await fetch(`/api/engagement/analytics/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!data.ok) throw new Error(data.error);

    // ✅ Update header to include announcement title
    if (analyticsTitle) {
      analyticsTitle.textContent = `Engagement Analytics — ${title}`;
    }

    renderAnalyticsPanel(data, title);
  } catch (err) {
    console.error("❌ Failed to load analytics:", err);
    if (analyticsTitle) {
      analyticsTitle.textContent = "Engagement Analytics — Error Loading";
    }

    // Optional: clear previous analytics
    const panelBody = analyticsPanel.querySelector(".analytics-body");
    if (panelBody) panelBody.innerHTML = `<p class="muted">⚠️ Unable to load analytics data.</p>`;
  }
}

// === Render Analytics Panel ===
function renderAnalyticsPanel(data, title = "") {
  const panel = document.querySelector(".analytics-panel");
  if (!panel) return;

  const { total, acknowledgedCount, percentage, users } = data;

  // Keep header separate for consistent layout
  panel.innerHTML = `
    <h2>Engagement Analytics — ${title || "Summary"}</h2>
    <div class="analytics-body">
      <div class="analytics-chart-area">
        <canvas id="ackChart" width="120" height="120"></canvas>
        <div class="chart-text">
          <span>${percentage}%</span>
          <small>acknowledged</small>
        </div>
      </div>

      <div class="analytics-filter">
        <label>Show:
          <select id="ackFilter">
            <option value="all">All (${total})</option>
            <option value="ack">Acknowledged (${acknowledgedCount})</option>
            <option value="rem">Pending (${total - acknowledgedCount})</option>
          </select>
        </label>
      </div>

      <div class="analytics-table-container">
        <table class="analytics-table">
          <thead>
            <tr><th>User</th><th>Role</th><th>Status</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = panel.querySelector("tbody");

  // === Render user rows with filter ===
  const renderRows = (filter = "all") => {
    tbody.innerHTML = "";
    users
      .filter((u) => {
        if (filter === "ack") return u.acknowledged;
        if (filter === "rem") return !u.acknowledged;
        return true;
      })
      .forEach((u) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${u.name || u.email}</td>
          <td>${u.role}</td>
          <td class="${u.acknowledged ? "ack" : "rem"}">
            ${u.acknowledged ? "✅ Acknowledged" : "⏳ Pending"}
          </td>
        `;
        tbody.appendChild(row);
      });
  };

  renderRows();

  // === Filter listener ===
  document.getElementById("ackFilter").addEventListener("change", (e) => {
    renderRows(e.target.value);
  });

  // === Render chart ===
  const ctx = document.getElementById("ackChart").getContext("2d");
  new Chart(ctx, {
    type: "doughnut",
    data: {
      datasets: [
        {
          data: [acknowledgedCount, total - acknowledgedCount],
          backgroundColor: ["#0081ab", "#e6eef3"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      cutout: "70%",
      plugins: { legend: { display: false } },
    },
  });
}


  // === Open Announcement Creation Popup ===
  const newAnnouncementBtn = document.getElementById("newAnnouncementBtn");
  if (newAnnouncementBtn) {
    newAnnouncementBtn.addEventListener("click", (e) => {
      e.preventDefault();

      if (!token) {
        alert("⚠️ No session found. Please log in again.");
        return;
      }

      const popupUrl = `/EngagementPopups/announcementPopup.html?token=${encodeURIComponent(
        token
      )}`;
      const popup = window.open(
        popupUrl,
        "CreateAnnouncement",
        "width=650,height=720,resizable=yes,scrollbars=yes"
      );

      if (!popup) {
        alert("⚠️ Please allow pop-ups for this site to create announcements.");
        return;
      }

      popup.focus();
    });
  }

  // === Listen for Refresh Event from Popup ===
  window.addEventListener("message", (event) => {
    if (event.data?.action === "refresh-announcements") {
      console.log("🔄 Refreshing announcements after popup save...");
      fetchAnnouncements();
    }
  });

  // === Initial load ===
  fetchAnnouncements();
});
