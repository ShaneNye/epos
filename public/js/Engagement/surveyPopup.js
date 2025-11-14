console.log("✅ surveyPopup.js loaded (final locked-question version)");

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("surveyForm");
  const addQuestionBtn = document.getElementById("addQuestionBtn");
  const questionList = document.getElementById("questionList");
  const cancelBtn = document.getElementById("cancelBtn");

  // Delete button (edit mode only)
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.id = "deleteBtn";
  deleteBtn.textContent = "Delete";
  deleteBtn.classList.add("danger");
  deleteBtn.style.display = "none";
  form.querySelector(".form-actions").insertBefore(deleteBtn, cancelBtn);

  // === Extract query params ===
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  const recordId = urlParams.get("id");
  const mode = urlParams.get("mode") || "create";

  console.log(`🧭 Mode: ${mode}, Record ID: ${recordId || "new"}`);

  if (!token && mode !== "view" && mode !== "edit") {
    alert("⚠️ Missing token. Please reopen from Engagement page.");
    window.close();
    return;
  }

  // Load roles + users (used in create & edit)
  try {
    const [rolesRes, usersRes] = await Promise.all([
      fetch("/api/meta/roles").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
    ]);

    if (rolesRes.ok) {
      const audienceSel = document.getElementById("audience");
      rolesRes.roles.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name;
        audienceSel.appendChild(opt);
      });
    }

    if (usersRes.ok) {
      const sharedSel = document.getElementById("sharedWith");
      usersRes.users.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.firstName} ${u.lastName}`;
        sharedSel.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("❌ Failed to load roles/users:", err);
  }

  /* =====================================================
       EDIT MODE — Load existing survey (lock questions)
     ===================================================== */
  if (recordId && (mode === "edit" || mode === "view")) {
    try {
      const res = await fetch(`/api/engagement/surveys/survey/${recordId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const s = data.survey;
      const q = data.questions || [];

      console.log("📄 Loaded survey:", s);
      console.log("📝 Loaded questions:", q);

      // Fill form fields
      form.title.value = s.title;
      form.summary.value = s.summary || "";
      form.startDate.value = s.start_date ? s.start_date.split("T")[0] : "";
      form.deadlineDate.value = s.deadline_date
        ? s.deadline_date.split("T")[0]
        : "";
      form.visibility.value = s.analytics_visibility;

      // Audience roles
      if (Array.isArray(s.audience_roles)) {
        Array.from(form.audience.options).forEach((opt) => {
          if (s.audience_roles.includes(parseInt(opt.value))) {
            opt.selected = true;
          }
        });
      }

      // Shared with users
      if (Array.isArray(s.shared_with_users)) {
        Array.from(form.sharedWith.options).forEach((opt) => {
          if (s.shared_with_users.includes(parseInt(opt.value))) {
            opt.selected = true;
          }
        });
      }

      // === LOCK QUESTIONS — READ ONLY ===
      addQuestionBtn.style.display = "none";
      questionList.innerHTML = "";

      if (!q.length) {
        questionList.innerHTML =
          "<div class='muted'>❗ This survey contains no questions.</div>";
      } else {
        q.forEach((ques, i) => {
          const block = document.createElement("div");
          block.className = "question-item locked";
          block.innerHTML = `
            <label><strong>Question ${i + 1}</strong></label>
            <input type="text" value="${ques.question_text}" disabled>

            <label>Response Type</label>
            <input type="text" value="${ques.response_type}" disabled>

            ${
              ques.response_type === "dropdown"
                ? `<label>Options</label>
                   <input type="text" value="${(ques.response_options || []).join(
                     ", "
                   )}" disabled>`
                : ""
            }

            ${
              ques.response_type === "number"
                ? `<label>Range</label>
                   <input type="text" value="${ques.numeric_min} → ${ques.numeric_max}" disabled>`
                : ""
            }
          `;
          questionList.appendChild(block);
        });
      }

      // Enable delete button only in edit mode
      if (mode === "edit") deleteBtn.style.display = "inline-block";

      // Full form lock if view only
      if (mode === "view") {
        form.querySelectorAll("input, textarea, select, button").forEach((el) => {
          el.disabled = true;
        });
        cancelBtn.textContent = "Close";
        deleteBtn.style.display = "none";
      }
    } catch (err) {
      console.error("❌ Failed to load survey:", err);
      alert("❌ Failed to load survey data.");
    }
  }

  /* =====================================================
       CREATE MODE — Full Question Builder
     ===================================================== */
  if (mode === "create") {
    addQuestionBtn.addEventListener("click", () => {
      const wrapper = document.createElement("div");
      wrapper.className = "question-item";

      wrapper.innerHTML = `
        <button type="button" class="remove-question">✖</button>

        <label>Question</label>
        <input type="text" name="question_text" required placeholder="Enter question text">

        <label>Response Type</label>
        <select name="response_type">
          <option value="text">Text</option>
          <option value="dropdown">Dropdown</option>
          <option value="number">Number</option>
        </select>

        <div class="response-config" style="margin-top:.5rem;"></div>
      `;

      questionList.appendChild(wrapper);

      // Remove handler
      wrapper.querySelector(".remove-question").addEventListener("click", () => {
        wrapper.remove();
      });

      // Dynamic config
      const typeSelect = wrapper.querySelector("select[name='response_type']");
      const config = wrapper.querySelector(".response-config");

      typeSelect.addEventListener("change", () => {
        const type = typeSelect.value;
        config.innerHTML = "";

        if (type === "dropdown") {
          config.innerHTML = `
            <label>Options (comma separated)</label>
            <input type="text" name="response_options" placeholder="Yes,No,Maybe">
          `;
        }

        if (type === "number") {
          config.innerHTML = `
            <label>Number Range</label>
            <div class="form-row">
              <input type="number" name="numeric_min" placeholder="Min" style="width:45%">
              <input type="number" name="numeric_max" placeholder="Max" style="width:45%">
            </div>
          `;
        }
      });
    });
  }

  /* =====================================================
       SUBMIT (CREATE or EDIT)
     ===================================================== */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = form.title.value.trim();
    const summary = form.summary.value.trim();
    const startDate = form.startDate.value;
    const immediate = form.immediate?.checked || false;
    const deadlineDate = form.deadlineDate.value || null;

    if (!title) return alert("❌ Title is required.");
    if (!startDate && !immediate)
      return alert("❌ Start date or 'Immediate' required.");

    const payload = {
      title,
      summary,
      startDate,
      immediate,
      deadlineDate,
      audience: Array.from(form.audience.selectedOptions).map((o) =>
        parseInt(o.value)
      ),
      visibility: form.visibility.value,
      sharedWith: Array.from(form.sharedWith.selectedOptions).map((o) =>
        parseInt(o.value)
      ),
    };

    // CREATE MODE → include questions
    if (mode === "create") {
      const questions = Array.from(
        questionList.querySelectorAll(".question-item")
      ).map((item) => {
        const qText = item.querySelector("input[name='question_text']").value.trim();
        const qType = item.querySelector("select[name='response_type']").value;

        const opts = item.querySelector("input[name='response_options']");
        const numMin = item.querySelector("input[name='numeric_min']");
        const numMax = item.querySelector("input[name='numeric_max']");

        return {
          question_text: qText,
          response_type: qType,
          response_options: opts
            ? opts.value.split(",").map((o) => o.trim()).filter(Boolean)
            : null,
          numeric_min: numMin ? parseFloat(numMin.value) || null : null,
          numeric_max: numMax ? parseFloat(numMax.value) || null : null,
          required: true,
        };
      });

      payload.questions = questions;
    }

    console.log("🧾 Final payload:", payload);

    const url =
      mode === "edit"
        ? `/api/engagement/surveys/survey/${recordId}`
        : `/api/engagement/surveys/survey`;

    const method = mode === "edit" ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      alert(
        mode === "edit"
          ? "✅ Survey updated successfully!"
          : "✅ Survey created successfully!"
      );

      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ action: "refresh-surveys" }, "*");
      }

      window.close();
    } catch (err) {
      console.error("❌ Failed to save survey:", err);
      alert("❌ Failed to save survey — check console.");
    }
  });

  /* =====================================================
       DELETE SURVEY
     ===================================================== */
  if (deleteBtn && mode === "edit" && recordId) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("🗑️ Are you sure you want to delete this survey?")) return;

      try {
        const res = await fetch(`/api/engagement/surveys/survey/${recordId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await res.json();
        if (!data.ok) throw new Error(data.error);

        alert("🗑️ Survey deleted successfully!");

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ action: "refresh-surveys" }, "*");
        }

        window.close();
      } catch (err) {
        console.error("❌ Delete failed:", err);
        alert("❌ Failed to delete survey.");
      }
    });
  }

  // Cancel → close window
  cancelBtn.addEventListener("click", () => window.close());
});
