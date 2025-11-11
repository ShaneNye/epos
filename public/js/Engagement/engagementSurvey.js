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
      const res = await fetch("/api/engagement/surveys/surveys", {
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
      li.classList.add("survey-item");

      const date = s.start_date
        ? new Date(s.start_date).toLocaleDateString()
        : "No start date";
      const sharedWith = Array.isArray(s.shared_with_users)
        ? s.shared_with_users.map(Number)
        : [];

      const createdByEmail = (s.created_by_email || "").toLowerCase();
      const createdById = Number(s.created_by_id || 0);
      const visibility = s.analytics_visibility || "private";

      const isMine = createdById === userId || createdByEmail === currentUserEmail;
      const isShared = sharedWith.includes(userId);
      const isPublic = visibility === "public" && !isMine;

      li.innerHTML = `
        <div class="survey-header">
          <strong>${s.title}</strong>
          ${
            isMine
              ? `<span class="icon survey-edit" data-id="${s.id}" title="Edit">✏️</span>`
              : `<span class="icon survey-view" data-id="${s.id}" title="View">👁️</span>`
          }
        </div>
        <span class="muted">${date}</span><br>
        ${s.summary || ""}
      `;

      // === Click main body to view analytics ===
      li.addEventListener("click", (e) => {
        if (!e.target.classList.contains("icon")) {
          loadSurveyAnalytics(s.id, s.title);
        }
      });

      if (isMine) mineList.appendChild(li);
      else if (isPublic) publicList.appendChild(li);
      else if (isShared) sharedList.appendChild(li);
    });

    if (!mineList.children.length)
      mineList.innerHTML = `<li class="empty">No surveys created by you yet.</li>`;
    if (!publicList.children.length)
      publicList.innerHTML = `<li class="empty">No public surveys available.</li>`;
    if (!sharedList.children.length)
      sharedList.innerHTML = `<li class="empty">No shared surveys yet.</li>`;

    document.querySelectorAll(".survey-edit").forEach((icon) => {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        console.log(`🧭 Opening survey ${id} in edit mode`);
        const popup = window.open(
          `/EngagementPopups/surveyPopup.html?id=${id}&mode=edit&token=${encodeURIComponent(token)}`,
          "EditSurvey",
          "width=1000,height=850,resizable=yes,scrollbars=yes"
        );
        if (!popup) alert("⚠️ Please allow popups to edit surveys."); else popup.focus();
      });
    });

    document.querySelectorAll(".survey-view").forEach((icon) => {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = e.target.dataset.id;
        console.log(`🧭 Viewing survey ${id}`);
        const popup = window.open(
          `/EngagementPopups/surveyResponsePopup.html?id=${id}&token=${encodeURIComponent(token)}`,
          "ViewSurvey",
          "width=950,height=850,resizable=yes,scrollbars=yes"
        );
        if (!popup) alert("⚠️ Please allow popups to view surveys."); else popup.focus();
      });
    });
  }

  /* =====================================================
     === LOAD SURVEY ANALYTICS ===========================
     ===================================================== */
  async function loadSurveyAnalytics(id, title) {
    const panel = document.querySelector("#surveys .analytics-panel");
    const h2 = panel.querySelector("h2");
    h2.textContent = `Survey Analytics — ${title}`;
    panel.innerHTML = `<h2>Survey Analytics — ${title}</h2><div class="loading">Loading...</div>`;

    try {
      const res = await fetch(`/api/engagement/surveys/analytics/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      renderSurveyAnalytics(panel, data);
    } catch (err) {
      console.error("❌ Failed to load survey analytics:", err);
      panel.innerHTML = `<p class='error'>❌ Failed to load analytics data.</p>`;
    }
  }

  /* =====================================================
     === RENDER ANALYTICS PANEL ==========================
     ===================================================== */
  function renderSurveyAnalytics(panel, data) {
    const { summary, questions, detailed } = data;
    const percent = summary.completionRate || 0;

    panel.innerHTML = `
      <h2>Survey Analytics</h2>
      <div class="analytics-summary">
        <canvas id="surveyCompletionChart" width="160" height="160"></canvas>
        <p><strong>${percent}%</strong> completion (${summary.totalResponded}/${summary.totalTargeted})</p>
      </div>
      <div id="questionResults"></div>
      <div class="detailed-responses">
        <h3>Detailed Responses</h3>
        ${detailed.map(r => `
          <details>
            <summary>${r.first_name} ${r.last_name} — ${new Date(r.submitted_at).toLocaleString()}</summary>
            <ul>
              ${r.answers.map(a => `
                <li><strong>Q${a.question_id}:</strong> ${a.answer_text || a.answer_number || "—"}</li>
              `).join("")}
            </ul>
          </details>
        `).join("")}
      </div>
    `;

// ✅ Radial completion chart (refined & compact)
const ctx = document.getElementById("surveyCompletionChart");

// Dynamically scale canvas for smaller chart footprint
ctx.width = 140;  // was ~280px before — 50% smaller
ctx.height = 140;

new Chart(ctx, {
  type: "doughnut",
  data: {
    labels: ["Completed", "Pending"],
    datasets: [{
      data: [percent, 100 - percent],
      backgroundColor: ["#0081ab", "#e6eef3"],
      borderWidth: 0,
      hoverOffset: 3,
    }]
  },
  options: {
    responsive: false,           // ✅ allows manual sizing to take effect
    maintainAspectRatio: true,
    cutout: "70%",               // ✅ slightly thinner ring
    radius: "65%",               // ✅ scales down the chart radius
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false }
    },
    animation: { animateRotate: true, duration: 800 }
  }
});


    // === Per-question analytics ===
    const qContainer = panel.querySelector("#questionResults");
    questions.forEach((q) => {
      const block = document.createElement("details");
      block.innerHTML = `<summary><strong>${q.question_text}</strong></summary>`;

      if (q.response_type === "number") {
        const dist = Object.entries(q.responses.distribution)
          .map(([k, v]) => `<li>${k}: ${v}</li>`).join("");
        block.innerHTML += `<p><strong>Average:</strong> ${q.responses.average}</p><ul>${dist}</ul>`;
      } else if (q.response_type === "dropdown") {
        const dist = Object.entries(q.responses.options)
          .map(([k, v]) => `<li>${k}: ${v}</li>`).join("");
        block.innerHTML += `<ul>${dist}</ul>`;
      } else {
        const rows = q.responses
          .map(r => `<li><strong>${r.user}:</strong> ${r.answer_text}</li>`).join("");
        block.innerHTML += `<ul>${rows}</ul>`;
      }

      qContainer.appendChild(block);
    });
  }

  /* =====================================================
     === NEW SURVEY BUTTON ===============================
     ===================================================== */
  const newSurveyBtn = document.getElementById("newSurveyBtn");
  if (newSurveyBtn) {
    newSurveyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!token) return alert("⚠️ No session found. Please log in again.");
      const popupUrl = `/EngagementPopups/surveyPopup.html?token=${encodeURIComponent(token)}`;
      const popup = window.open(
        popupUrl,
        "CreateSurvey",
        "width=1000,height=850,resizable=yes,scrollbars=yes"
      );
      if (!popup) alert("⚠️ Please allow pop-ups to create surveys."); else popup.focus();
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
