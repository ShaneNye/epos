console.log("✅ surveyResponsePopup.js (paginated) loaded");

document.addEventListener("DOMContentLoaded", async () => {
  const body = document.getElementById("surveyResponseBody");
  const submitBtn = document.getElementById("submitSurveyBtn");
  const nextBtn = document.getElementById("nextBtn");
  const backBtn = document.getElementById("backBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const actions = document.getElementById("surveyActions");

  // === Params ===
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");
  const surveyId = urlParams.get("id");
  if (!token || !surveyId) {
    body.innerHTML = "<p class='error'>⚠️ Invalid survey link.</p>";
    return;
  }

  let questions = [];
  let survey = {};
  let currentIndex = 0;
  const answers = {};

  /* =====================================================
     === LOAD SURVEY QUESTIONS ============================
     ===================================================== */
  try {
    const res = await fetch(`/api/engagement/surveys/survey/${surveyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    survey = data.survey;
    questions = data.questions || [];

    if (!survey || !questions.length) {
      body.innerHTML = "<p class='error'>❌ No questions available for this survey.</p>";
      return;
    }

    actions.style.display = "flex";
    renderQuestion();
  } catch (err) {
    console.error("❌ Failed to load survey:", err);
    body.innerHTML = "<p class='error'>❌ Failed to load survey data.</p>";
  }

  /* =====================================================
     === RENDER CURRENT QUESTION ==========================
     ===================================================== */
  function renderQuestion() {
    const q = questions[currentIndex];
    if (!q) return;

    body.innerHTML = `
      <div class="survey-form single-question">
        <h3>${survey.title}</h3>
        <p class="muted">${survey.summary || ""}</p>

        <div class="question-block">
          <label><strong>Q${currentIndex + 1}:</strong> ${q.question_text}</label>
          <div class="question-input">
            ${renderInput(q)}
          </div>
        </div>

        <div class="question-progress">Question ${currentIndex + 1} of ${questions.length}</div>
      </div>
    `;

    const saved = answers[q.id];
    if (saved !== undefined) {
      const input = body.querySelector(`[name="q_${q.id}"]`);
      if (input) input.value = saved;
    }

    // Update button states
    backBtn.style.display = currentIndex > 0 ? "inline-block" : "none";
    nextBtn.style.display =
      currentIndex < questions.length - 1 ? "inline-block" : "none";
    submitBtn.style.display =
      currentIndex === questions.length - 1 ? "inline-block" : "none";
  }

  function renderInput(q) {
    if (q.response_type === "text") {
      return `<textarea name="q_${q.id}" rows="4" placeholder="Type your answer..." required></textarea>`;
    } else if (q.response_type === "dropdown" && Array.isArray(q.response_options)) {
      return `<select name="q_${q.id}" required>
        <option value="">Select...</option>
        ${q.response_options
          .map((opt) => `<option value="${opt}">${opt}</option>`)
          .join("")}
      </select>`;
    } else if (q.response_type === "number") {
      const min = q.numeric_min || 0;
      const max = q.numeric_max || 10;
      return `
        <input type="number" name="q_${q.id}" min="${min}" max="${max}" placeholder="${min} - ${max}" required>
        <small class="muted">(Range: ${min} – ${max})</small>
      `;
    }
    return "";
  }

  /* =====================================================
     === SAVE CURRENT ANSWER (with validation) ============
     ===================================================== */
  function saveCurrentAnswer() {
    const q = questions[currentIndex];
    if (!q) return false;
    const input = body.querySelector(`[name="q_${q.id}"]`);
    if (!input) return false;

    const val = input.value.trim();

    // 🧠 Validation for number inputs
    if (q.response_type === "number") {
      const num = parseFloat(val);
      const min = q.numeric_min ?? 0;
      const max = q.numeric_max ?? 10;

      if (isNaN(num)) {
        alert("❌ Please enter a number before proceeding.");
        input.focus();
        return false;
      }
      if (num < min || num > max) {
        alert(`⚠️ Please enter a value between ${min} and ${max}.`);
        input.focus();
        return false;
      }
    }

    // Basic required field check
    if (val === "") {
      alert("❌ Please answer this question before continuing.");
      input.focus();
      return false;
    }

    answers[q.id] = val;
    return true;
  }

  /* =====================================================
     === NAVIGATION =======================================
     ===================================================== */
  nextBtn.addEventListener("click", () => {
    if (!saveCurrentAnswer()) return;
    if (currentIndex < questions.length - 1) {
      currentIndex++;
      renderQuestion();
    }
  });

  backBtn.addEventListener("click", () => {
    if (!saveCurrentAnswer()) return;
    if (currentIndex > 0) {
      currentIndex--;
      renderQuestion();
    }
  });

  /* =====================================================
     === SUBMIT SURVEY ===================================
     ===================================================== */
  submitBtn.addEventListener("click", async () => {
    if (!saveCurrentAnswer()) return;

    const payload = {
      answers: Object.entries(answers).map(([id, val]) => ({
        question_id: parseInt(id),
        answer_text: isNaN(val) ? val : null,
        answer_number: !isNaN(val) && val !== "" ? parseFloat(val) : null,
      })),
    };

    try {
      const res = await fetch(`/api/engagement/surveys/survey/${surveyId}/response`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      alert("✅ Thank you! Your responses have been submitted.");
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ action: "refresh-surveys" }, "*");
      }
      window.close();
    } catch (err) {
      console.error("❌ Failed to submit survey:", err);
      alert("❌ Failed to submit survey. Please try again.");
    }
  });

  /* =====================================================
     === CANCEL ===========================================
     ===================================================== */
  cancelBtn.addEventListener("click", () => window.close());
});
// re push //