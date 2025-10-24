// routes/forgotPassword.js
require("dotenv").config();
const express = require("express");
const pool = require("../db");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const { google } = require("googleapis");

const router = express.Router();

/* ==========================================================
   ===============  GMAIL OAUTH2 CONFIG  =====================
   ========================================================== */

const OAuth2 = google.auth.OAuth2;
const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

async function createTransporter() {
  const accessToken = await oauth2Client.getAccessToken();

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: process.env.GMAIL_USER,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      accessToken: accessToken.token,
    },
  });
}

/* ==========================================================
   ===============  POST /api/forgot-password  ===============
   ========================================================== */

router.post("/", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ ok: false, message: "Email address required." });
  }

  try {
    // ✅ Use PostgreSQL syntax ($1, not ?)
    const result = await pool.query("SELECT id, firstname FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      // Always return a neutral message for security
      return res.json({ ok: true, message: "If this email exists, a reset link has been sent." });
    }

    const user = result.rows[0];

    // ✅ Generate secure reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry

    // ✅ Update user record with token + expiry
    await pool.query(
      "UPDATE users SET reset_token = $1, reset_expires = $2 WHERE email = $3",
      [token, expires, email]
    );

    // ✅ Build reset link (update domain if hosted)
    const resetLink = `http://localhost:3000/reset?token=${token}`;

    // ✅ Build and send email
    const mailOptions = {
      from: `"Sussex Beds Epos" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request | Sussex Beds Epos",
      html: `
      <div style="font-family:'Segoe UI', Arial, sans-serif; background:#f7fafc; padding:30px; color:#1a1f24;">
        <table align="center" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px; background:white; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.05); overflow:hidden;">
          <tr>
            <td style="background:#0081ab; padding:20px 0; text-align:center;">
              <img src="https://sussexbeds.co.uk/wp-content/uploads/2021/04/sussex-beds-logo.png" alt="Sussex Beds" style="height:60px; margin-bottom:6px;" />
              <h2 style="color:white; margin:0; font-size:20px;">Sussex Beds Epos</h2>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 40px;">
              <h3 style="color:#0081ab; margin-top:0;">Hello ${user.firstname || "there"},</h3>
              <p style="font-size:15px; line-height:1.6; color:#333;">
                We received a request to reset your password for the <strong>Sussex Beds Epos</strong> system.
                Click the button below to set a new password. This link will expire in <strong>1 hour</strong>.
              </p>

              <div style="text-align:center; margin:30px 0;">
                <a href="${resetLink}" 
                   style="background:#0081ab; color:#fff; text-decoration:none; padding:12px 26px; border-radius:6px; font-weight:600; display:inline-block;">
                  Reset My Password
                </a>
              </div>

              <p style="font-size:14px; color:#555;">
                If you didn’t request a password reset, you can safely ignore this email.
              </p>
              <p style="font-size:14px; color:#555;">Thank you,<br><strong>The Sussex Beds Epos Team</strong></p>
            </td>
          </tr>

          <tr>
            <td style="background:#f7fafc; padding:16px; text-align:center; font-size:12px; color:#999;">
              © ${new Date().getFullYear()} Sussex Beds • Epos System<br>
              Developed by Shane Nye
            </td>
          </tr>
        </table>
      </div>
      `,
    };

    const transporter = await createTransporter();
    await transporter.sendMail(mailOptions);

    console.log(`📨 Password reset email sent to ${email}`);

    res.json({ ok: true, message: "If this email exists, a reset link has been sent." });
  } catch (err) {
    console.error("❌ Forgot password error:", err);
    res.status(500).json({ ok: false, message: "Failed to send reset email." });
  }
});

module.exports = router;
