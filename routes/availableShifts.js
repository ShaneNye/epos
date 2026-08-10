const express = require("express");
const pool = require("../db");
const { getSession } = require("../sessions");
const sendEmail = require("../utils/sendEmail");

const router = express.Router();
const SHIFT_EMAIL_TEST_RECIPIENT = "shanen@sussexbeds.co.uk";
const SHIFT_HR_RECIPIENT = "hr@sussexbeds.co.uk";
let initPromise;

function initTables() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS available_shifts (
        id SERIAL PRIMARY KEY,
        location_id INTEGER NOT NULL REFERENCES locations(id),
        shift_date DATE NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL REFERENCES users(id),
        assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rota_updated_at TIMESTAMPTZ,
        rota_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE available_shifts
        ADD COLUMN IF NOT EXISTS rota_updated_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS rota_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS available_shift_responses (
        shift_id INTEGER NOT NULL REFERENCES available_shifts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        response TEXT NOT NULL CHECK (response IN ('available', 'unavailable')),
        responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (shift_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS available_shifts_date_idx ON available_shifts (shift_date);
      CREATE INDEX IF NOT EXISTS available_shift_responses_shift_idx ON available_shift_responses (shift_id);
    `).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function currentUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  const session = await getSession(token);
  if (!session?.id) {
    const err = new Error("Invalid session");
    err.status = 401;
    throw err;
  }
  return Number(session.id);
}

function validDate(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function requestBaseUrl(req) {
  const configured = String(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const protocol = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  return `${protocol}://${req.get("host")}`;
}

function formattedShiftDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function shiftEmailHtml(req, { heading, introduction, shift, testingMessage }) {
  const formattedDate = formattedShiftDate(shift.shift_date);
  const pageUrl = `${requestBaseUrl(req)}/available-shifts`;
  const notes = shift.notes
    ? escapeHtml(shift.notes).replace(/\r?\n/g, "<br>")
    : "No additional notes were provided.";
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#24313d;line-height:1.5">
      <div style="padding:12px 18px;background:#fff5ca;color:#6b5200;font-weight:700;border-radius:8px 8px 0 0">${escapeHtml(testingMessage)}</div>
      <div style="padding:24px;border:1px solid #dce4eb;border-top:0;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px;color:#004a63">${escapeHtml(heading)}</h2>
        <p style="margin:0 0 20px">${escapeHtml(introduction)}</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:9px 0;width:110px;color:#697684"><strong>Date</strong></td><td style="padding:9px 0">${escapeHtml(formattedDate)}</td></tr>
          <tr><td style="padding:9px 0;color:#697684"><strong>Location</strong></td><td style="padding:9px 0">${escapeHtml(shift.location_name)}</td></tr>
          <tr><td style="padding:9px 0;color:#697684;vertical-align:top"><strong>Notes</strong></td><td style="padding:9px 0">${notes}</td></tr>
        </table>
        <p style="margin:22px 0 0"><a href="${escapeHtml(pageUrl)}" style="display:inline-block;padding:11px 18px;border-radius:6px;background:#006f93;color:#fff;font-weight:700;text-decoration:none">View available shifts</a></p>
      </div>
    </div>`;
}

function shiftEmailText(req, introduction, shift) {
  return `${introduction}\nDate: ${formattedShiftDate(shift.shift_date)}\nLocation: ${shift.location_name}\nNotes: ${shift.notes || "No additional notes."}\n\n${requestBaseUrl(req)}/available-shifts`;
}

async function sendAvailabilityAlert(req, shift) {
  const introduction = `${shift.responder_name} has said they are available to cover your shift.`;
  const sent = await sendEmail(
    SHIFT_EMAIL_TEST_RECIPIENT,
    `${shift.responder_name} is available - ${shift.location_name} - ${formattedShiftDate(shift.shift_date)}`,
    shiftEmailHtml(req, {
      heading: "Someone is available for your shift",
      introduction,
      shift,
      testingMessage: `Testing mode: this creator alert was intended for ${shift.creator_email || "the shift creator"} and routed only to ${SHIFT_EMAIL_TEST_RECIPIENT}.`,
    }),
    { text: shiftEmailText(req, introduction, shift) }
  );
  console.log("Available shift creator alert", {
    shiftId: shift.id, intendedRecipient: shift.creator_email, deliveredTo: SHIFT_EMAIL_TEST_RECIPIENT, sent,
  });
  return sent;
}

async function sendAssignmentAlerts(req, shift) {
  const employeeIntroduction = `You have been assigned to cover this shift by ${shift.creator_name}.`;
  const hrIntroduction = `${shift.assigned_user_name} has been assigned to cover this shift. Please update the rota.`;
  const [employeeSent, hrSent] = await Promise.all([
    sendEmail(
      SHIFT_EMAIL_TEST_RECIPIENT,
      `You have been assigned a shift - ${shift.location_name} - ${formattedShiftDate(shift.shift_date)}`,
      shiftEmailHtml(req, {
        heading: "You have been assigned a shift",
        introduction: employeeIntroduction,
        shift,
        testingMessage: `Testing mode: this assignment alert was intended for ${shift.assigned_user_email || shift.assigned_user_name} and routed only to ${SHIFT_EMAIL_TEST_RECIPIENT}.`,
      }),
      { text: shiftEmailText(req, employeeIntroduction, shift) }
    ),
    sendEmail(
      SHIFT_EMAIL_TEST_RECIPIENT,
      `Rota update needed - ${shift.assigned_user_name} - ${shift.location_name}`,
      shiftEmailHtml(req, {
        heading: "A shift has been assigned",
        introduction: hrIntroduction,
        shift,
        testingMessage: `Testing mode: this HR alert was intended for ${SHIFT_HR_RECIPIENT} and routed only to ${SHIFT_EMAIL_TEST_RECIPIENT}.`,
      }),
      { text: shiftEmailText(req, hrIntroduction, shift) }
    ),
  ]);
  console.log("Available shift assignment alerts", {
    shiftId: shift.id,
    intendedEmployeeRecipient: shift.assigned_user_email,
    intendedHrRecipient: SHIFT_HR_RECIPIENT,
    deliveredTo: SHIFT_EMAIL_TEST_RECIPIENT,
    employeeSent,
    hrSent,
  });
  return { employeeSent, hrSent };
}

async function sendShiftCreatedAlert(req, shift) {
  const officeUsers = await pool.query(
    `SELECT email FROM users
      WHERE office IS TRUE AND NULLIF(TRIM(email), '') IS NOT NULL
      ORDER BY email`
  );
  const intendedRecipients = officeUsers.rows.map((row) => row.email);
  const formattedDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${shift.shift_date}T00:00:00Z`));
  const pageUrl = `${requestBaseUrl(req)}/available-shifts`;
  const notes = shift.notes
    ? escapeHtml(shift.notes).replace(/\r?\n/g, "<br>")
    : "No additional notes were provided.";
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#24313d;line-height:1.5">
      <div style="padding:12px 18px;background:#fff5ca;color:#6b5200;font-weight:700;border-radius:8px 8px 0 0">Testing mode: this Office-team alert was routed only to ${SHIFT_EMAIL_TEST_RECIPIENT}.</div>
      <div style="padding:24px;border:1px solid #dce4eb;border-top:0;border-radius:0 0 8px 8px">
        <h2 style="margin:0 0 8px;color:#004a63">A shift needs covering</h2>
        <p style="margin:0 0 20px">A new available shift has been added.</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:9px 0;width:110px;color:#697684"><strong>Date</strong></td><td style="padding:9px 0">${escapeHtml(formattedDate)}</td></tr>
          <tr><td style="padding:9px 0;color:#697684"><strong>Location</strong></td><td style="padding:9px 0">${escapeHtml(shift.location_name)}</td></tr>
          <tr><td style="padding:9px 0;color:#697684;vertical-align:top"><strong>Notes</strong></td><td style="padding:9px 0">${notes}</td></tr>
        </table>
        <p style="margin:22px 0 0"><a href="${escapeHtml(pageUrl)}" style="display:inline-block;padding:11px 18px;border-radius:6px;background:#006f93;color:#fff;font-weight:700;text-decoration:none">View available shifts</a></p>
      </div>
    </div>`;
  const sent = await sendEmail(
    SHIFT_EMAIL_TEST_RECIPIENT,
    `Shift needs covering – ${shift.location_name} – ${formattedDate}`,
    html,
    { text: `A shift needs covering\nDate: ${formattedDate}\nLocation: ${shift.location_name}\nNotes: ${shift.notes || "No additional notes."}\n\n${pageUrl}` }
  );
  console.log("Available shift Office alert", {
    shiftId: shift.id,
    intendedOfficeRecipients: intendedRecipients.length,
    deliveredTo: SHIFT_EMAIL_TEST_RECIPIENT,
    sent,
  });
  return sent;
}

const shiftSelect = `
  SELECT s.id, s.location_id, l.name AS location_name,
         TO_CHAR(s.shift_date, 'YYYY-MM-DD') AS shift_date, s.notes,
         s.created_by, s.assigned_user_id, s.rota_updated_at, s.rota_updated_by,
         s.created_at, s.updated_at,
         (s.created_by = $1 OR EXISTS (
           SELECT 1 FROM user_roles manager_ur
           JOIN roles manager_role ON manager_role.id = manager_ur.role_id
           WHERE manager_ur.user_id = $1 AND LOWER(TRIM(manager_role.name)) = 'admin'
         )) AS can_manage,
         COALESCE(NULLIF(TRIM(CONCAT(creator.firstname, ' ', creator.lastname)), ''), creator.email) AS created_by_name,
         COALESCE(NULLIF(TRIM(CONCAT(assigned.firstname, ' ', assigned.lastname)), ''), assigned.email) AS assigned_user_name,
         mine.response AS my_response,
         COALESCE(responses.items, '[]'::json) AS responses
    FROM available_shifts s
    JOIN locations l ON l.id = s.location_id
    JOIN users creator ON creator.id = s.created_by
    LEFT JOIN users assigned ON assigned.id = s.assigned_user_id
    LEFT JOIN available_shift_responses mine ON mine.shift_id = s.id AND mine.user_id = $1
    LEFT JOIN LATERAL (
      SELECT JSON_AGG(JSON_BUILD_OBJECT(
        'userId', r.user_id,
        'userName', COALESCE(NULLIF(TRIM(CONCAT(u.firstname, ' ', u.lastname)), ''), u.email),
        'response', r.response,
        'respondedAt', r.responded_at
      ) ORDER BY r.responded_at) AS items
      FROM available_shift_responses r
      JOIN users u ON u.id = r.user_id
      WHERE r.shift_id = s.id
    ) responses ON TRUE`;

router.get("/", async (req, res) => {
  try {
    await initTables();
    const userId = await currentUser(req);
    const result = await pool.query(`${shiftSelect} ORDER BY s.shift_date ASC, s.created_at DESC`, [userId]);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, currentUserId: userId, canUpdateRota: true, shifts: result.rows });
  } catch (err) {
    console.error("GET /api/available-shifts failed:", err);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Failed to load available shifts" });
  }
});

router.post("/", async (req, res) => {
  try {
    await initTables();
    const userId = await currentUser(req);
    const locationId = Number(req.body?.locationId);
    const shiftDate = validDate(req.body?.date);
    const notes = String(req.body?.notes || "").trim().slice(0, 2000);
    if (!Number.isInteger(locationId) || locationId <= 0 || !shiftDate) {
      return res.status(400).json({ ok: false, error: "Location and date are required" });
    }
    const result = await pool.query(
      `WITH inserted AS (
         INSERT INTO available_shifts (location_id, shift_date, notes, created_by)
         SELECT id, $2::date, $3, $4 FROM locations WHERE id = $1
         RETURNING id, location_id, TO_CHAR(shift_date, 'YYYY-MM-DD') AS shift_date, notes
       )
       SELECT inserted.*, locations.name AS location_name
         FROM inserted JOIN locations ON locations.id = inserted.location_id`,
      [locationId, shiftDate, notes, userId]
    );
    if (!result.rows.length) return res.status(400).json({ ok: false, error: "Invalid location" });
    let emailSent = false;
    try {
      emailSent = await sendShiftCreatedAlert(req, result.rows[0]);
    } catch (emailErr) {
      console.error("Available shift creation email failed:", emailErr);
    }
    res.status(201).json({ ok: true, id: result.rows[0].id, emailSent });
  } catch (err) {
    console.error("POST /api/available-shifts failed:", err);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Failed to add shift" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    await initTables();
    const userId = await currentUser(req);
    const shiftId = Number(req.params.id);
    const locationId = Number(req.body?.locationId);
    const shiftDate = validDate(req.body?.date);
    const notes = String(req.body?.notes || "").trim().slice(0, 2000);
    if (!Number.isInteger(shiftId) || !Number.isInteger(locationId) || locationId <= 0 || !shiftDate) {
      return res.status(400).json({ ok: false, error: "Location and date are required" });
    }
    const result = await pool.query(
      `UPDATE available_shifts s
          SET location_id = $2, shift_date = $3::date, notes = $4, updated_at = NOW()
        WHERE s.id = $1
          AND s.assigned_user_id IS NULL
          AND EXISTS (SELECT 1 FROM locations WHERE id = $2)
          AND (s.created_by = $5 OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = $5 AND LOWER(TRIM(r.name)) = 'admin'
          ))
      RETURNING s.id`,
      [shiftId, locationId, shiftDate, notes, userId]
    );
    if (!result.rows.length) {
      const existing = await pool.query("SELECT assigned_user_id FROM available_shifts WHERE id = $1", [shiftId]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: "Shift not found" });
      if (existing.rows[0].assigned_user_id !== null) {
        return res.status(409).json({ ok: false, error: "Assigned shifts can no longer be edited" });
      }
      return res.status(403).json({ ok: false, error: "Only the shift creator or an Admin can edit this shift" });
    }
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("PUT /api/available-shifts/:id failed:", err);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Failed to update shift" });
  }
});

router.put("/:id/response", async (req, res) => {
  try {
    await initTables();
    const userId = await currentUser(req);
    const shiftId = Number(req.params.id);
    const response = String(req.body?.response || "").toLowerCase();
    if (!Number.isInteger(shiftId) || !["available", "unavailable"].includes(response)) {
      return res.status(400).json({ ok: false, error: "Choose Available or Unavailable" });
    }
    const result = await pool.query(
      `WITH previous AS (
         SELECT response FROM available_shift_responses WHERE shift_id = $1 AND user_id = $2
       ), saved AS (
       INSERT INTO available_shift_responses (shift_id, user_id, response)
       SELECT id, $2, $3 FROM available_shifts WHERE id = $1
       ON CONFLICT (shift_id, user_id) DO UPDATE SET response = EXCLUDED.response, responded_at = NOW()
       RETURNING shift_id, response
       ), cleared AS (
         UPDATE available_shifts s
            SET assigned_user_id = NULL, rota_updated_at = NULL, rota_updated_by = NULL, updated_at = NOW()
          WHERE s.id = $1 AND s.assigned_user_id = $2 AND $3 = 'unavailable'
       )
       SELECT saved.response, previous.response AS previous_response,
              s.id, TO_CHAR(s.shift_date, 'YYYY-MM-DD') AS shift_date, s.notes,
              l.name AS location_name, creator.email AS creator_email,
              COALESCE(NULLIF(TRIM(CONCAT(responder.firstname, ' ', responder.lastname)), ''), responder.email) AS responder_name
         FROM saved
         JOIN available_shifts s ON s.id = saved.shift_id
         JOIN locations l ON l.id = s.location_id
         JOIN users creator ON creator.id = s.created_by
         JOIN users responder ON responder.id = $2
         LEFT JOIN previous ON TRUE`,
      [shiftId, userId, response]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: "Shift not found" });
    const shift = result.rows[0];
    let emailSent = false;
    if (response === "available" && shift.previous_response !== "available") {
      try {
        emailSent = await sendAvailabilityAlert(req, shift);
      } catch (emailErr) {
        console.error("Available shift creator email failed:", emailErr);
      }
    }
    res.json({ ok: true, response: shift.response, emailSent });
  } catch (err) {
    console.error("PUT /api/available-shifts/:id/response failed:", err);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Failed to save response" });
  }
});

router.put("/:id/assign", async (req, res) => {
  try {
    await initTables();
    const creatorId = await currentUser(req);
    const shiftId = Number(req.params.id);
    const assignedUserId = req.body?.userId == null || req.body.userId === "" ? null : Number(req.body.userId);
    if (!Number.isInteger(shiftId) || (assignedUserId !== null && !Number.isInteger(assignedUserId))) {
      return res.status(400).json({ ok: false, error: "Invalid assignment" });
    }
    const result = await pool.query(
      `WITH previous AS (
         SELECT assigned_user_id FROM available_shifts WHERE id = $1
       ), updated AS (
       UPDATE available_shifts s
          SET assigned_user_id = $3, rota_updated_at = NULL, rota_updated_by = NULL, updated_at = NOW()
        WHERE s.id = $1 AND s.created_by = $2
          AND ($3::integer IS NULL OR EXISTS (
            SELECT 1 FROM available_shift_responses r
             WHERE r.shift_id = s.id AND r.user_id = $3 AND r.response = 'available'
          ))
      RETURNING s.*
       )
       SELECT updated.id, updated.assigned_user_id,
              previous.assigned_user_id AS previous_assigned_user_id,
              TO_CHAR(updated.shift_date, 'YYYY-MM-DD') AS shift_date, updated.notes,
              l.name AS location_name,
              assigned.email AS assigned_user_email,
              COALESCE(NULLIF(TRIM(CONCAT(assigned.firstname, ' ', assigned.lastname)), ''), assigned.email) AS assigned_user_name,
              COALESCE(NULLIF(TRIM(CONCAT(creator.firstname, ' ', creator.lastname)), ''), creator.email) AS creator_name
         FROM updated
         JOIN previous ON TRUE
         JOIN locations l ON l.id = updated.location_id
         JOIN users creator ON creator.id = updated.created_by
         LEFT JOIN users assigned ON assigned.id = updated.assigned_user_id`,
      [shiftId, creatorId, assignedUserId]
    );
    if (!result.rows.length) {
      return res.status(403).json({ ok: false, error: "Only the shift creator can assign a user who is available" });
    }
    const shift = result.rows[0];
    let emails = { employeeSent: false, hrSent: false };
    if (shift.assigned_user_id !== null && Number(shift.assigned_user_id) !== Number(shift.previous_assigned_user_id)) {
      try {
        emails = await sendAssignmentAlerts(req, shift);
      } catch (emailErr) {
        console.error("Available shift assignment emails failed:", emailErr);
      }
    }
    res.json({ ok: true, emails });
  } catch (err) {
    console.error("PUT /api/available-shifts/:id/assign failed:", err);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Failed to assign shift" });
  }
});

router.put("/:id/rota-updated", async (req, res) => {
  try {
    await initTables();
    const userId = await currentUser(req);
    const shiftId = Number(req.params.id);
    const updated = req.body?.updated === true;
    if (!Number.isInteger(shiftId)) {
      return res.status(400).json({ ok: false, error: "Invalid shift" });
    }
    const result = await pool.query(
      `UPDATE available_shifts
          SET rota_updated_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
              rota_updated_by = CASE WHEN $2 THEN $3 ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1 AND assigned_user_id IS NOT NULL
      RETURNING rota_updated_at`,
      [shiftId, updated, userId]
    );
    if (!result.rows.length) {
      return res.status(400).json({ ok: false, error: "The shift must be covered before it can be added to the rota" });
    }
    res.json({ ok: true, rotaUpdatedAt: result.rows[0].rota_updated_at });
  } catch (err) {
    console.error("PUT /api/available-shifts/:id/rota-updated failed:", err);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Failed to update rota status" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await initTables();
    const userId = await currentUser(req);
    const shiftId = Number(req.params.id);
    if (!Number.isInteger(shiftId)) {
      return res.status(400).json({ ok: false, error: "Invalid shift" });
    }
    const result = await pool.query(
      `DELETE FROM available_shifts s
        WHERE s.id = $1
          AND (s.created_by = $2 OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = $2 AND LOWER(TRIM(r.name)) = 'admin'
          ))
      RETURNING s.id`,
      [shiftId, userId]
    );
    if (!result.rows.length) {
      return res.status(403).json({ ok: false, error: "Only the shift creator or an Admin can delete this shift" });
    }
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("DELETE /api/available-shifts/:id failed:", err);
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Failed to delete shift" });
  }
});

module.exports = router;
