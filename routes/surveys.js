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
   === UPDATE SURVEY (questions remain locked) ==========
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
      sharedWith = []
      // ❌ questions removed – questions are NOT updated in edit mode
    } = req.body;

    // Update ONLY the survey meta — NOT the questions
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
      id
    ];

    const updateRes = await pool.query(updateSql, updateVals);

    if (!updateRes.rowCount)
      return res.status(404).json({ ok: false, error: "Survey not found" });

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

/* =============================================================
   === GET A SINGLE SURVEY (correct creator + multi-role check) ===
   ============================================================= */
router.get("/survey/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log("\n--------------------------");
    console.log("📥 GET /survey/:id", id);

    // --- Auth ---
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      console.log("❌ No token");
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const session = await getSession(token);
    const userEmail = session?.email?.toLowerCase().trim();
    console.log("👤 Session email:", userEmail);

    if (!userEmail) {
      console.log("❌ Invalid session, no email");
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    // --- Lookup user ID ---
    const userRes = await pool.query(
      "SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [userEmail]
    );
    if (!userRes.rows.length) {
      console.log("❌ User not found in DB");
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const userId = userRes.rows[0].id;
    console.log("🆔 User ID:", userId);

    // --- Get ALL roles for user ---
    const rolesRes = await pool.query(
      "SELECT role_id FROM user_roles WHERE user_id = $1",
      [userId]
    );
    const userRoleIds = rolesRes.rows.map(r => r.role_id);
    console.log("🎭 User roles:", userRoleIds);

    // --- Load survey ---
    const surveyRes = await pool.query(
      "SELECT * FROM engagement_surveys WHERE id = $1",
      [id]
    );
    if (!surveyRes.rows.length) {
      console.log("❌ Survey not found");
      return res.status(404).json({ ok: false, error: "Survey not found" });
    }

    const survey = surveyRes.rows[0];

    console.log("📄 Survey audience:", survey.audience_roles);
    console.log("📄 Survey shared_with_users:", survey.shared_with_users);
    console.log("📄 Survey created_by:", survey.created_by, "(current user:", userId, ")");

    // === FINAL ACCESS CHECK ================================
    // Creator always has access
    const allowed =
      survey.created_by === userId ||
      survey.analytics_visibility === "public" ||
      survey.shared_with_users.includes(userId) ||
      survey.audience_roles.some(roleId => userRoleIds.includes(roleId));

    console.log("🔍 ACCESS ALLOWED?", allowed);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: "You do not have permission to access this survey.",
      });
    }

    // --- Fetch questions ---
    const qRes = await pool.query(
      "SELECT * FROM engagement_survey_questions WHERE survey_id = $1 ORDER BY sort_order",
      [id]
    );

    console.log(`📝 Questions loaded: ${qRes.rows.length}`);

    return res.json({
      ok: true,
      survey,
      questions: qRes.rows
    });

  } catch (err) {
    console.error("❌ Server error in GET /survey/:id", err);
    return res.status(500).json({ ok: false, error: "Server error" });
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
   === GET ACTIVE SURVEYS FOR CURRENT USER ==============
   ===================================================== */
router.get("/active-surveys", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token)
      return res.status(401).json({ ok: false, error: "Unauthorized" });

    const session = await getSession(token);
    const userEmail = session?.email?.trim().toLowerCase();
    if (!userEmail)
      return res.status(401).json({ ok: false, error: "Invalid session" });

    // 1️⃣ Lookup user ID
    const userRes = await pool.query(
      "SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1",
      [userEmail]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ ok: false, error: "User not found" });

    const userId = userRes.rows[0].id;

    // 2️⃣ Get ALL roles for this user from user_roles
    const roleRes = await pool.query(
      "SELECT role_id FROM user_roles WHERE user_id = $1",
      [userId]
    );
    const userRoleIds = roleRes.rows.map(r => r.role_id);
    console.log("🎭 Active-survey user role IDs:", userRoleIds);

    // 3️⃣ Fetch surveys where user is in audience OR shared OR public
    const sql = `
      SELECT s.*, u.email AS created_by_email
      FROM engagement_surveys s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.is_active = TRUE
        AND s.start_date <= NOW()
        AND (s.deadline_date IS NULL OR s.deadline_date >= NOW())
        AND (
             s.analytics_visibility = 'public'
          OR (array_length(s.audience_roles,1) > 0 AND s.audience_roles && $2::int[])
          OR $1 = ANY(s.shared_with_users)
        )
        AND s.id NOT IN (
          SELECT survey_id
          FROM engagement_survey_responses
          WHERE user_id = $1
        )
      ORDER BY s.start_date DESC;
    `;

    const surveys = (await pool.query(sql, [userId, userRoleIds])).rows;

    console.log(
      `📋 Active surveys for ${userEmail} (user ${userId}): ${surveys.length} found`
    );

    return res.json({ ok: true, surveys });
  } catch (err) {
    console.error("❌ Error fetching active surveys:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch active surveys" });
  }
});


/* =====================================================
   === SURVEY ANALYTICS (FINAL, CLEANED, FIXED) =========
   ===================================================== */
router.get("/analytics/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Load survey
    const surveyRes = await pool.query(
      "SELECT * FROM engagement_surveys WHERE id = $1",
      [id]
    );
    if (!surveyRes.rows.length)
      return res.status(404).json({ ok: false, error: "Survey not found" });

    const survey = surveyRes.rows[0];
    const audienceRoles = survey.audience_roles || [];
    const sharedUsers = survey.shared_with_users || [];

    // 2️⃣ Get all users who belong to ANY audience role
    let audienceUserIds = [];
    if (audienceRoles.length > 0) {
      const usersByRole = await pool.query(
        `SELECT DISTINCT ur.user_id AS id
         FROM user_roles ur
         WHERE ur.role_id = ANY($1::int[])`,
        [audienceRoles]
      );
      audienceUserIds = usersByRole.rows.map(r => r.id);
    }

    // 3️⃣ Merge audience + shared users
    const targetedUserIds = Array.from(new Set([
      ...audienceUserIds,
      ...sharedUsers
    ]));

    const totalTargeted = targetedUserIds.length;

    // 4️⃣ Count responses
    const respondedRes = await pool.query(
      `SELECT DISTINCT user_id 
       FROM engagement_survey_responses 
       WHERE survey_id = $1`,
      [id]
    );
    const totalResponded = respondedRes.rows.length;

    const completionRate = totalTargeted
      ? ((totalResponded / totalTargeted) * 100).toFixed(1)
      : 0;

    // 5️⃣ Question breakdown
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
        const dist = Object.fromEntries(
          distRes.rows.map(r => [r.answer_number, parseInt(r.count)])
        );
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
            options: Object.fromEntries(
              optRes.rows.map(r => [r.answer_text, parseInt(r.count)])
            ),
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

    // 6️⃣ Detailed responses (with proper names + question text)
    const detailedRaw = await pool.query(
      `SELECT 
          r.id AS response_id,
          r.submitted_at,
          u.id AS user_id,
          COALESCE(NULLIF(u.firstname, ''), '') AS firstname,
          COALESCE(NULLIF(u.lastname, ''), '') AS lastname,
          u.email AS email,
          json_agg(
            json_build_object(
              'question_text', q.question_text,
              'response_type', q.response_type,
              'answer_text', a.answer_text,
              'answer_number', a.answer_number
            )
          ) AS answers
       FROM engagement_survey_responses r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN engagement_survey_answers a ON r.id = a.response_id
       LEFT JOIN engagement_survey_questions q ON a.question_id = q.id
       WHERE r.survey_id = $1
       GROUP BY r.id, u.id, firstname, lastname, email
       ORDER BY r.submitted_at DESC`,
      [id]
    );

    const detailed = detailedRaw.rows.map(row => {
      const name = `${row.firstname} ${row.lastname}`.trim();
      return {
        response_id: row.response_id,
        submitted_at: row.submitted_at,
        user_id: row.user_id,
        user_name: name || row.email || "Unknown User",
        answers: row.answers
      };
    });

    // FINAL RESPONSE (only once)
    return res.json({
      ok: true,
      summary: {
        totalTargeted,
        totalResponded,
        completionRate
      },
      questions,
      detailed
    });

  } catch (err) {
    console.error("❌ Error loading survey analytics:", err);
    return res.status(500).json({ ok: false, error: "Failed to load analytics" });
  }
});



module.exports = router;