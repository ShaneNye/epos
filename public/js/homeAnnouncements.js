// public/js/homeAnnouncements.js
console.log("✅ homeAnnouncements.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const auth = storageGet();
  const token = auth?.token;

  // === Announcements Container ===
  const announcementContainer = document.getElementById("announcementContainer");
  // === Surveys Container ===
  const surveyContainer = document.getElementById("surveyContainer");

  if (!token) {
    console.warn("⚠️ No token found, cannot load announcements or surveys.");
    return;
  }

  /* =====================================================
     === LOAD ACTIVE ANNOUNCEMENTS =======================
     ===================================================== */
  async function loadAnnouncements() {
    if (!announcementContainer) return;
    try {
      const res = await fetch("/api/engagement/active", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!data.ok || !Array.isArray(data.announcements)) {
        console.warn("⚠️ No active announcements available.");
        announcementContainer.style.display = "none";
        return;
      }

      renderAnnouncements(data.announcements);
    } catch (err) {
      console.error("❌ Failed to load announcements:", err);
      announcementContainer.style.display = "none";
    }
  }

  function renderAnnouncements(list) {
    if (!list.length) {
      announcementContainer.style.display = "none";
      return;
    }

    announcementContainer.innerHTML = "";
    announcementContainer.style.display = "block";

    list.forEach((a) => {
      const card = document.createElement("div");
      card.className = "announcement-card";

      const date = a.start_date ? new Date(a.start_date).toLocaleDateString() : "";
      const creatorName =
        a.created_by_name?.trim() ||
        a.created_by_email?.split("@")[0] ||
        "Unknown";

      card.innerHTML = `
        <h3>${a.title}</h3>
        <p>${a.message}</p>
        <p class="muted">
          Posted on ${date}<br>
          <span class="byline">by ${creatorName}</span>
        </p>
        <label class="ack-label">
          <input type="checkbox" class="ack-box" data-id="${a.id}">
          I have read and understood this announcement
        </label>
      `;

      announcementContainer.appendChild(card);
    });

    // === Handle acknowledgements ===
    announcementContainer.querySelectorAll(".ack-box").forEach((box) => {
      box.addEventListener("change", async (e) => {
        if (!e.target.checked) return;
        const id = e.target.dataset.id;

        try {
          const res = await fetch(`/api/engagement/acknowledge/${id}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json();

          if (json.ok) {
            e.target.closest(".announcement-card").remove();
            if (!announcementContainer.children.length)
              announcementContainer.style.display = "none";
          } else {
            console.error("❌ Failed to acknowledge:", json.error);
          }
        } catch (err) {
          console.error("❌ Error acknowledging announcement:", err);
        }
      });
    });
  }

/* =====================================================
   === LOAD ACTIVE SURVEYS =============================
   ===================================================== */
async function loadActiveSurveys() {
  if (!surveyContainer) return;

  try {
    const session = storageGet();
    const token = session?.token;
    const activeRoleName =
      (session?.activeRole &&
        typeof session.activeRole === "object" &&
        session.activeRole.name) ||
      session?.activeRole ||
      null; // handles "Admin" or { name: "Admin" }

    if (!token) {
      console.warn("⚠️ No token found, cannot load surveys.");
      surveyContainer.style.display = "none";
      return;
    }

    /* -------------------------------
       1) Resolve activeRole → roleId
       ------------------------------- */
    let activeRoleId = null;

    try {
      const rolesRes = await fetch("/api/meta/roles", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rolesData = await rolesRes.json();

      if (rolesData.ok && Array.isArray(rolesData.roles) && activeRoleName) {
        const match = rolesData.roles.find(
          (r) =>
            String(r.name || "")
              .trim()
              .toLowerCase() === String(activeRoleName).trim().toLowerCase()
        );
        if (match) {
          activeRoleId = Number(match.id);
          console.log(
            `🎭 Active role '${activeRoleName}' mapped to id ${activeRoleId}`
          );
        } else {
          console.warn(
            `⚠️ No role record found matching activeRole='${activeRoleName}'`
          );
        }
      }
    } catch (err) {
      console.error("❌ Failed to resolve active role id:", err);
    }

    /* -------------------------------
       2) Load all active surveys
       ------------------------------- */
    const res = await fetch("/api/engagement/surveys/active-surveys", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.surveys)) {
      console.warn("⚠️ No active surveys available from API.");
      surveyContainer.style.display = "none";
      surveyContainer.innerHTML = "";
      return;
    }

    let surveys = data.surveys || [];

    /* -------------------------------
       3) Filter by audience_roles
       ------------------------------- */
    if (activeRoleId) {
      surveys = surveys.filter((s) => {
        const audience = Array.isArray(s.audience_roles)
          ? s.audience_roles.map((v) => Number(v))
          : [];
        return audience.includes(activeRoleId);
      });
    } else {
      // If we *cannot* resolve a role id, safest is to hide surveys
      console.warn(
        "⚠️ activeRoleId could not be resolved — hiding surveys for safety."
      );
      surveys = [];
    }

    if (!surveys.length) {
      console.log(
        "ℹ️ No surveys visible for current active role; hiding survey widget."
      );
      surveyContainer.style.display = "none";
      surveyContainer.innerHTML = "";
      return;
    }

    /* -------------------------------
       4) Render filtered surveys
       ------------------------------- */
    surveyContainer.style.display = "block";

    surveyContainer.innerHTML = `
      <div class="announcement-panel">
        <h3>📋 Active Surveys</h3>
        <div class="announcement-list">
          ${surveys
            .map((s) => {
              const date = s.start_date
                ? new Date(s.start_date).toLocaleDateString()
                : "Ongoing";
              return `
                <div class="announcement-item">
                  <div class="announcement-header">
                    <strong>${s.title}</strong>
                    <span class="muted">${date}</span>
                  </div>
                  <p>${s.summary || "No summary provided."}</p>
                  <button class="btn-primary take-survey-btn" data-id="${s.id}">
                    Take Survey
                  </button>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    // Attach click handlers
    surveyContainer.querySelectorAll(".take-survey-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const id = e.target.dataset.id;
        const popup = window.open(
          `/EngagementPopups/surveyResponsePopup.html?id=${id}&token=${encodeURIComponent(
            token
          )}`,
          "SurveyResponse",
          "width=950,height=850,resizable=yes,scrollbars=yes"
        );

        if (!popup) {
          alert("⚠️ Please allow pop-ups to complete surveys.");
        } else {
          popup.focus();
        }
      });
    });
  } catch (err) {
    console.error("❌ Failed to load active surveys:", err);
    surveyContainer.style.display = "none";
  }
}


  /* =====================================================
     === INITIAL LOAD ===================================
     ===================================================== */
  loadAnnouncements();
  loadActiveSurveys();
});
