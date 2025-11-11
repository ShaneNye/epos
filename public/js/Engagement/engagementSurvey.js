console.log("✅ engagementSurvey.js loaded");

document.addEventListener("DOMContentLoaded", () => {
  const auth = storageGet();
  const token = auth?.token || null;

  if (!token) {
    console.warn("⚠️ No session token found. Surveys may not load.");
    return;
  }

  /* =====================================================
     === SUBTABS FOR SURVEYS =============================
     ===================================================== */
  const surveySubtabs = document.querySelectorAll("#surveys .subtab");
  surveySubtabs.forEach((sub) => {
    sub.addEventListener("click", () => {
      const group = sub.closest(".left-panel");
      group.querySelectorAll(".subtab").forEach((s) => s.classList.remove("active"));
      group.querySelectorAll(".subtab-content").forEach((c) => c.classList.remove("active"));
      sub.classList.add("active");
      document.getElementById(sub.dataset.target).classList.add("active");

      const analyticsTitle = document.querySelector("#surveys .analytics-panel h2");
      if (analyticsTitle) {
        const map = {
          "my-surveys": "My Survey Analytics",
          "public-surveys": "Public Survey Analytics",
          "shared-surveys": "Shared With Me Survey Analytics",
        };
        analyticsTitle.textContent = map[sub.dataset.target] || "Survey Analytics";
      }
    });
  });

  /* =====================================================
     === FETCH SURVEYS ==================================
     ===================================================== */
  async function fetchSurveys() {
    try {
      const res = await fetch("/api/engagement/surveys", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      console.log(`📦 Surveys fetched (${data.surveys.length})`);
      renderSurveys(data.surveys || []);
    } catch (err) {
      console.error("❌ Failed to fetch surveys:", err);
    }
  }

  /* =====================================================
     === RENDER SURVEYS =================================
     ===================================================== */
  function renderSurveys(list) {
    const mineList = document.getElementById("mySurveyList");
    const publicList = document.getElementById("publicSurveyList");
    const sharedList = document.getElementById("sharedSurveyList");
    if (!mineList || !publicList || !sharedList) return;

    mineList.innerHTML = "";
    publicList.innerHTML = "";
    sharedList.innerHTML = "";

    const currentUserEmail = (auth?.username || "").toLowerCase();
    const userId = Number(auth?.userId || auth?.id || auth?.user?.id || 0);

    list.forEach((s) => {
      const li = document.createElement("li");
      li.classList.add("announcement-item");

      const date = s.start_date ? new Date(s.start_date).toLocaleDateString() : "No start date";
      const sharedWith = Array.isArray(s.shared_with_users)
        ? s.shared_with_users.map(Number)
        : [];

      const createdByEmail = (s.created_by_email || "").toLowerCase();
      const createdById = Number(s.created_by_id || 0);
      const visibility = s.analytics_visibility || "private";

      // Determine ownership
      const isMine = createdById === userId || createdByEmail === currentUserEmail;
      const isShared = sharedWith.includes(userId);
      const isPublic = visibility === "public" && !isMine;

      li.innerHTML = `
        <div class="announcement-header">
          <strong>${s.title}</strong>
          ${
            isMine
              ? `<span class="icon action-icon" data-id="${s.id}" data-mode="edit" title="Edit">✏️</span>`
              : `<span class="icon action-icon" data-id="${s.id}" data-mode="view" title="View">👁️</span>`
          }
        </div>
        <span class="muted">${date}</span><br>
        ${s.summary || ""}
      `;

      if (isMine) mineList.appendChild(li);
      else if (isPublic) publicList.appendChild(li);
      else if (isShared) sharedList.appendChild(li);
    });

    // === Empty states ===
    if (!mineList.children.length)
      mineList.innerHTML = `<li class="empty">No surveys created by you yet.</li>`;
    if (!publicList.children.length)
      publicList.innerHTML = `<li class="empty">No public surveys available.</li>`;
    if (!sharedList.children.length)
      sharedList.innerHTML = `<li class="empty">No shared surveys yet.</li>`;

    // === Icon click handlers (edit / view) ===
    document.querySelectorAll(".action-icon").forEach((icon) => {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        const mode = e.target.dataset.mode;
        console.log(`🧭 Opening survey ${id} in ${mode} mode`);

        const popup = window.open(
          `/EngagementPopups/surveyPopup.html?id=${id}&mode=${mode}&token=${encodeURIComponent(token)}`,
          "SurveyPopup",
          "width=650,height=720,resizable=yes,scrollbars=yes"
        );

        if (!popup) {
          alert("⚠️ Please allow popups to view or edit surveys.");
        } else {
          popup.focus();
        }
      });
    });
  }

  /* =====================================================
     === NEW SURVEY BUTTON ===============================
     ===================================================== */
  const newSurveyBtn = document.getElementById("newSurveyBtn");
  if (newSurveyBtn) {
    newSurveyBtn.addEventListener("click", (e) => {
      e.preventDefault();

      if (!token) {
        alert("⚠️ No session found. Please log in again.");
        return;
      }

      const popupUrl = `/EngagementPopups/surveyPopup.html?token=${encodeURIComponent(token)}`;
      const popup = window.open(
        popupUrl,
        "CreateSurvey",
        "width=650,height=720,resizable=yes,scrollbars=yes"
      );

      if (!popup) {
        alert("⚠️ Please allow pop-ups for this site to create surveys.");
        return;
      }

      popup.focus();
    });
  }

  /* =====================================================
     === POSTMESSAGE LISTENER ============================
     ===================================================== */
  window.addEventListener("message", (event) => {
    if (event.data?.action === "refresh-surveys") {
      console.log("🔄 Refreshing surveys after popup save...");
      fetchSurveys();
    }
  });

  // === Initial load ===
  fetchSurveys();
});
