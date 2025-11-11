console.log("✅ surveyPopup.js loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("surveyForm");
  const addQuestionBtn = document.getElementById("addQuestionBtn");
  const questionList = document.getElementById("questionList");
  const cancelBtn = document.getElementById("cancelBtn");

  // === Create Delete Button ===
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.id = "deleteBtn";
  deleteBtn.textContent = "Delete";
  deleteBtn.classList.add("danger");
  deleteBtn.style.display = "none"; // hidden unless edit mode
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

  // === Load roles and users ===
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

  // === Handle edit/view mode ===
  if (recordId && (mode === "edit" || mode === "view")) {
    try {
      const res = await fetch(`/api/engagement/survey/${recordId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to fetch survey");

      const s = data.survey;
      console.log("📄 Loaded survey:", s);

      // Fill form fields
      form.title.value = s.title || "";
      form.summary.value = s.summary || "";
      form.startDate.value = s.start_date ? s.start_date.split("T")[0] : "";
      form.deadlineDate.value = s.deadline_date ? s.deadline_date.split("T")[0] : "";
      form.visibility.value = s.analytics_visibility || "private";

      // Audience roles
      if (Array.isArray(s.audience_roles)) {
        Array.from(form.audience.options).forEach((opt) => {
          if (s.audience_roles.includes(parseInt(opt.value))) opt.selected = true;
        });
      }

      // Shared users
      if (Array.isArray(s.shared_with_users)) {
        Array.from(form.sharedWith.options).forEach((opt) => {
          if (s.shared_with_users.includes(parseInt(opt.value))) opt.selected = true;
        });
      }

      // Disable question editing (locked after creation)
      addQuestionBtn.style.display = "none";
      questionList.innerHTML =
        '<div class="muted">📝 Questions cannot be modified once a survey is active.</div>';

      // Show delete button if edit mode
      if (mode === "edit" && deleteBtn) deleteBtn.style.display = "inline-block";

      // Handle view mode (read-only)
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

  // === Add Question Block (for create only) ===
  if (mode === "create") {
    addQuestionBtn.addEventListener("click", () => {
      const wrapper = document.createElement("div");
      wrapper.className = "question-item";
      wrapper.innerHTML = `
        <button type="button" class="remove-question">✖</button>
        <label>Question</label>
        <input type="text" name="question_text" placeholder="Enter question text" required>

        <label>Response Type</label>
        <select name="response_type">
          <option value="text">Text</option>
          <option value="dropdown">Dropdown</option>
          <option value="number">Number</option>
        </select>

        <div class="response-config" style="margin-top:0.5rem;"></div>
      `;
      questionList.appendChild(wrapper);

      // Remove button
      wrapper.querySelector(".remove-question").addEventListener("click", () => {
        wrapper.remove();
      });

      // Response type handler
      const typeSelect = wrapper.querySelector("select[name='response_type']");
      const configDiv = wrapper.querySelector(".response-config");

      typeSelect.addEventListener("change", () => {
        const type = typeSelect.value;
        configDiv.innerHTML = "";
        if (type === "dropdown") {
          configDiv.innerHTML = `
            <label>Response Options (comma separated)</label>
            <input type="text" name="response_options" placeholder="e.g. Yes,No,Maybe">
          `;
        } else if (type === "number") {
          configDiv.innerHTML = `
            <label>Number Range</label>
            <div class="form-row">
              <input type="number" name="numeric_min" placeholder="Min" style="width:45%;">
              <input type="number" name="numeric_max" placeholder="Max" style="width:45%;">
            </div>
          `;
        }
      });
    });
  }

  // === Form Submission (Create or Update) ===
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
      audience: Array.from(form.audience.selectedOptions).map((o) => parseInt(o.value)),
      visibility: form.visibility.value,
      sharedWith: Array.from(form.sharedWith.selectedOptions).map((o) => parseInt(o.value)),
    };

    // Include questions only when creating
    if (mode === "create") {
      const questions = Array.from(
        questionList.querySelectorAll(".question-item")
      ).map((item) => {
        const qText = item.querySelector("input[name='question_text']").value.trim();
        const qType = item.querySelector("select[name='response_type']").value;
        const optsInput = item.querySelector("input[name='response_options']");
        const numMin = item.querySelector("input[name='numeric_min']");
        const numMax = item.querySelector("input[name='numeric_max']");
        return {
          question_text: qText,
          response_type: qType,
          response_options: optsInput
            ? optsInput.value.split(",").map((o) => o.trim()).filter(Boolean)
            : null,
          numeric_min: numMin ? parseFloat(numMin.value) || null : null,
          numeric_max: numMax ? parseFloat(numMax.value) || null : null,
          required: true,
        };
      });
      payload.questions = questions;
    }

    console.log("🧾 Submitting survey:", payload);

    const url =
      mode === "edit"
        ? `/api/engagement/survey/${recordId}`
        : "/api/engagement/survey";
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
      alert("❌ Failed to save survey — check console for details.");
    }
  });

  // === Delete Survey (edit mode only) ===
  if (deleteBtn && mode === "edit" && recordId) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("🗑️ Are you sure you want to delete this survey?")) return;

      try {
        const res = await fetch(`/api/engagement/survey/${recordId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Failed to delete survey");

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

  // === Cancel button ===
  cancelBtn.addEventListener("click", () => window.close());
});
