// routes/surveys.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getSession } = require("../sessions");

/* =====================================================
   === CREATE NEW SURVEY ===============================
   ===================================================== */
router.post("/survey", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email;
    if (!userEmail) return res.status(401).json({ ok: false, error: "Invalid session" });

    // Lookup internal user ID
    const userRes = await pool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [userEmail]);
    if (!userRes.rows.length)
      return res.status(404).json({ ok: false, error: "User not found" });
    const userId = userRes.rows[0].id;

    const {
      title,
      summary,
      startDate,
      immediate = false,
      deadlineDate = null,
      audience = [],
      visibility = "private",
      sharedWith = [],
      questions = [] // array of { question_text, response_type, response_options, numeric_min, numeric_max, required }
    } = req.body;

    if (!title) return res.status(400).json({ ok: false, error: "Title is required" });
    if (!startDate && !immediate)
      return res.status(400).json({ ok: false, error: "Start date or immediate required" });

    // Create the survey
    const insertSurvey = `
      INSERT INTO engagement_surveys
        (title, summary, start_date, immediate, deadline_date, audience_roles,
         analytics_visibility, shared_with_users, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id;
    `;
    const surveyValues = [
      title,
      summary || null,
      immediate ? new Date().toISOString() : startDate,
      immediate,
      deadlineDate || null,
      audience,
      visibility,
      sharedWith,
      userId,
    ];
    const surveyRes = await pool.query(insertSurvey, surveyValues);
    const surveyId = surveyRes.rows[0].id;

    // Insert questions if provided
    if (Array.isArray(questions) && questions.length) {
      const qSql = `
        INSERT INTO engagement_survey_questions
          (survey_id, question_text, response_type, response_options,
           numeric_min, numeric_max, required, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `;
      for (const [i, q] of questions.entries()) {
        await pool.query(qSql, [
          surveyId,
          q.question_text,
          q.response_type,
          q.response_options || null,
          q.numeric_min || null,
          q.numeric_max || null,
          q.required || false,
          i,
        ]);
      }
    }

    console.log(`✅ Survey created by ${userEmail}: ID ${surveyId}`);
    res.json({ ok: true, id: surveyId });
  } catch (err) {
    console.error("❌ Error creating survey:", err);
    res.status(500).json({ ok: false, error: "Failed to create survey" });
  }
});
/* =====================================================
   === GET SURVEYS (Mine / Public / Shared) ============
   ===================================================== */
router.get("/surveys", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email;
    if (!userEmail)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    // 🔍 Lookup internal user ID from email
    const userRes = await pool.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [userEmail]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ ok: false, error: "User not found" });

    const userId = userRes.rows[0].id;
    console.log(`🎯 User lookup success: ${userEmail} → ID ${userId}`);

    // 🧩 Map role names to IDs
    let roleIds = [];
    try {
      const rolesRes = await pool.query("SELECT id, name FROM roles");
      const map = Object.fromEntries(
        rolesRes.rows.map((r) => [r.name.trim().toLowerCase(), r.id])
      );
      const userRoles = Array.isArray(session?.roles) ? session.roles : [];
      roleIds = userRoles
        .map((r) =>
          typeof r === "object"
            ? map[r.name?.trim().toLowerCase()]
            : map[String(r).trim().toLowerCase()]
        )
        .filter(Boolean);
    } catch (err) {
      console.warn("⚠️ Could not map user roles to IDs:", err.message);
    }

    // 🧾 Build SQL & params
    let sql;
    let params;

    if (roleIds.length > 0) {
      sql = `
        SELECT 
          s.*,
          u.id AS created_by_id,
          u.email AS created_by_email
        FROM engagement_surveys s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.is_active = TRUE
          AND (
            s.created_by = $1
            OR s.analytics_visibility = 'public'
            OR $1 = ANY(s.shared_with_users)
            OR (
              array_length(s.audience_roles, 1) > 0
              AND s.audience_roles && $2::int[]
            )
          )
        ORDER BY s.created_at DESC;
      `;
      params = [userId, `{${roleIds.join(",")}}`];
    } else {
      sql = `
        SELECT 
          s.*,
          u.id AS created_by_id,
          u.email AS created_by_email
        FROM engagement_surveys s
        LEFT JOIN users u ON s.created_by = u.id
        WHERE s.is_active = TRUE
          AND (
            s.created_by = $1
            OR s.analytics_visibility = 'public'
            OR $1 = ANY(s.shared_with_users)
          )
        ORDER BY s.created_at DESC;
      `;
      params = [userId];
    }

    const result = await pool.query(sql, params);
    console.log(
      `📦 Surveys fetched for ${userEmail} (ID ${userId}): ${result.rows.length} found`
    );

    res.json({ ok: true, surveys: result.rows });
  } catch (err) {
    console.error("❌ Error fetching surveys:", err);
    res
      .status(500)
      .json({ ok: false, error: "Failed to fetch surveys" });
  }
});

/* =====================================================
   === GET SINGLE SURVEY + QUESTIONS ===================
   ===================================================== */
router.get("/survey/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const surveyRes = await pool.query(
      "SELECT * FROM engagement_surveys WHERE id = $1 LIMIT 1;",
      [id]
    );
    if (!surveyRes.rows.length)
      return res.status(404).json({ ok: false, error: "Survey not found" });

    const questionsRes = await pool.query(
      "SELECT * FROM engagement_survey_questions WHERE survey_id = $1 ORDER BY sort_order ASC;",
      [id]
    );

    res.json({ ok: true, survey: surveyRes.rows[0], questions: questionsRes.rows });
  } catch (err) {
    console.error("❌ Error fetching survey:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch survey" });
  }
});

/* =====================================================
   === UPDATE SURVEY + QUESTIONS =======================
   ===================================================== */
router.put("/survey/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      summary,
      startDate,
      immediate = false,
      deadlineDate = null,
      audience = [],
      visibility = "private",
      sharedWith = [],
      questions = [],
    } = req.body;

    // Update main survey
    const updateSql = `
      UPDATE engagement_surveys
      SET title=$1, summary=$2, start_date=$3, immediate=$4, deadline_date=$5,
          audience_roles=$6, analytics_visibility=$7, shared_with_users=$8,
          updated_at=NOW()
      WHERE id=$9 RETURNING id;
    `;
    const updateVals = [
      title,
      summary,
      immediate ? new Date().toISOString() : startDate,
      immediate,
      deadlineDate,
      audience,
      visibility,
      sharedWith,
      id,
    ];
    const updateRes = await pool.query(updateSql, updateVals);
    if (!updateRes.rowCount)
      return res.status(404).json({ ok: false, error: "Survey not found" });

    // Replace questions (simple approach)
    await pool.query("DELETE FROM engagement_survey_questions WHERE survey_id = $1;", [id]);
    const qSql = `
      INSERT INTO engagement_survey_questions
        (survey_id, question_text, response_type, response_options,
         numeric_min, numeric_max, required, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `;
    for (const [i, q] of questions.entries()) {
      await pool.query(qSql, [
        id,
        q.question_text,
        q.response_type,
        q.response_options || null,
        q.numeric_min || null,
        q.numeric_max || null,
        q.required || false,
        i,
      ]);
    }

    res.json({ ok: true, id });
  } catch (err) {
    console.error("❌ Error updating survey:", err);
    res.status(500).json({ ok: false, error: "Failed to update survey" });
  }
});

/* =====================================================
   === DELETE SURVEY ==================================
   ===================================================== */
router.delete("/survey/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM engagement_surveys WHERE id = $1 RETURNING id;", [id]);
    if (!result.rowCount)
      return res.status(404).json({ ok: false, error: "Survey not found" });
    res.json({ ok: true, id });
  } catch (err) {
    console.error("❌ Error deleting survey:", err);
    res.status(500).json({ ok: false, error: "Failed to delete survey" });
  }
});

/* =====================================================
   === GET ACTIVE SURVEYS FOR CURRENT USER ==============
   ===================================================== */
router.get("/active-surveys", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email?.trim().toLowerCase();
    const activeRoleName = session?.activeRole?.name;

    if (!userEmail)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    // === Get user and role IDs ===
    const userRes = await pool.query(
      "SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [userEmail]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ ok: false, error: "User not found" });

    const userId = userRes.rows[0].id;

    const roleRes = await pool.query(
      "SELECT id FROM roles WHERE name = $1 LIMIT 1",
      [activeRoleName]
    );
    const roleId = roleRes.rows.length ? roleRes.rows[0].id : null;

    // === Fetch active surveys ===
    const sql = `
      SELECT s.*, u.email AS created_by_email
      FROM engagement_surveys s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.is_active = TRUE
        AND (
          s.analytics_visibility = 'public'
          OR $2 = ANY(s.audience_roles)
        )
        AND s.start_date <= NOW()
        AND (s.deadline_date IS NULL OR s.deadline_date >= NOW())
        AND s.id NOT IN (
          SELECT survey_id
          FROM engagement_survey_responses
          WHERE user_id = $1
        )
      ORDER BY s.start_date DESC;
    `;
    const surveys = (await pool.query(sql, [userId, roleId])).rows;

    console.log(
      `📋 Active surveys fetched for ${userEmail} (${activeRoleName || "No Role"}): ${surveys.length} found`
    );

    res.json({ ok: true, surveys });
  } catch (err) {
    console.error("❌ Error fetching active surveys:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch active surveys" });
  }
});

/* =====================================================
   === SUBMIT SURVEY RESPONSES ==========================
   ===================================================== */
router.post("/survey/:id/response", async (req, res) => {
  try {
    const { id } = req.params;
    const { answers = [] } = req.body;

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email?.trim().toLowerCase();

    const userRes = await pool.query(
      "SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [userEmail]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ ok: false, error: "User not found" });

    const userId = userRes.rows[0].id;

    // Create survey response
    const insertResponse = `
      INSERT INTO engagement_survey_responses (survey_id, user_id)
      VALUES ($1, $2)
      RETURNING id;
    `;
    const responseRes = await pool.query(insertResponse, [id, userId]);
    const responseId = responseRes.rows[0].id;

    // Insert each answer
    const insertAnswer = `
      INSERT INTO engagement_survey_answers (response_id, question_id, answer_text, answer_number)
      VALUES ($1, $2, $3, $4)
    `;

    for (const a of answers) {
      await pool.query(insertAnswer, [
        responseId,
        a.question_id,
        a.answer_text || null,
        a.answer_number || null,
      ]);
    }

    console.log(`✅ Survey ${id} answered by user ${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error submitting survey response:", err);
    res.status(500).json({ ok: false, error: "Failed to submit response" });
  }
});

/* =====================================================
   === SURVEY ANALYTICS ================================
   ===================================================== */
router.get("/analytics/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Basic survey + target audience
    const surveyRes = await pool.query(
      "SELECT * FROM engagement_surveys WHERE id = $1",
      [id]
    );
    if (!surveyRes.rows.length)
      return res.status(404).json({ ok: false, error: "Survey not found" });
    const survey = surveyRes.rows[0];

    // 2️⃣ Response summary
    const totalRes = await pool.query(
      "SELECT COUNT(*) FROM engagement_survey_responses WHERE survey_id = $1",
      [id]
    );
    const totalResponded = parseInt(totalRes.rows[0].count);
    const totalTargeted =
      (survey.audience_roles?.length || 0) + (survey.shared_with_users?.length || 0) || 0;
    const completionRate = totalTargeted
      ? ((totalResponded / totalTargeted) * 100).toFixed(1)
      : 0;

// 3️⃣ Questions + answer breakdown
const qRes = await pool.query(
  "SELECT * FROM engagement_survey_questions WHERE survey_id = $1 ORDER BY sort_order",
  [id]
);
const questions = [];

for (const q of qRes.rows) {
  if (q.response_type === "number") {
    const distRes = await pool.query(
      `SELECT answer_number, COUNT(*) 
       FROM engagement_survey_answers
       WHERE question_id = $1 
       GROUP BY answer_number 
       ORDER BY answer_number`,
      [q.id]
    );
    const dist = Object.fromEntries(distRes.rows.map(r => [r.answer_number, parseInt(r.count)]));
    const avgRes = await pool.query(
      `SELECT AVG(answer_number)::numeric(10,2) AS avg 
       FROM engagement_survey_answers 
       WHERE question_id = $1`,
      [q.id]
    );
    const average = parseFloat(avgRes.rows[0].avg || 0);
    questions.push({
      ...q,
      responses: { distribution: dist, average, total: totalResponded }
    });
  } else if (q.response_type === "dropdown") {
    const optRes = await pool.query(
      `SELECT answer_text, COUNT(*) 
       FROM engagement_survey_answers
       WHERE question_id = $1 
       GROUP BY answer_text 
       ORDER BY COUNT(*) DESC`,
      [q.id]
    );
    questions.push({
      ...q,
      responses: {
        options: Object.fromEntries(optRes.rows.map(r => [r.answer_text, parseInt(r.count)])),
        total: totalResponded
      }
    });
  } else {
    const textRes = await pool.query(
      `SELECT 
          a.answer_text, 
          u.firstname || ' ' || u.lastname AS user
       FROM engagement_survey_answers a
       LEFT JOIN engagement_survey_responses r ON a.response_id = r.id
       LEFT JOIN users u ON r.user_id = u.id
       WHERE a.question_id = $1`,
      [q.id]
    );
    questions.push({ ...q, responses: textRes.rows });
  }
}

// 4️⃣ Detailed responses by user
const detailed = await pool.query(
  `SELECT 
      r.id AS response_id, 
      r.submitted_at, 
      u.id AS user_id, 
      u.firstname, 
      u.lastname,
      json_agg(
        json_build_object(
          'question_id', a.question_id,
          'answer_text', a.answer_text,
          'answer_number', a.answer_number
        )
      ) AS answers
   FROM engagement_survey_responses r
   LEFT JOIN users u ON r.user_id = u.id
   LEFT JOIN engagement_survey_answers a ON r.id = a.response_id
   WHERE r.survey_id = $1
   GROUP BY r.id, u.id, u.firstname, u.lastname
   ORDER BY r.submitted_at DESC`,
  [id]
);

// ✅ Console summary for visibility
console.log(
  `📊 Survey ${id} analytics: ${totalResponded}/${totalTargeted} responded (${completionRate}%)`
);

res.json({
  ok: true,
  summary: { totalTargeted, totalResponded, completionRate },
  questions,
  detailed: detailed.rows
});

  } catch (err) {
    console.error("❌ Error loading survey analytics:", err);
    res.status(500).json({ ok: false, error: "Failed to load analytics" });
  }
});



module.exports = router;