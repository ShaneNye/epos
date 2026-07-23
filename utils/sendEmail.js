// utils/sendEmail.js
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const OAuth2 = google.auth.OAuth2;

const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

async function sendEmail(to, subject, html, options = {}) {
  try {
    const accessToken = await oauth2Client.getAccessToken();

    const transporter = nodemailer.createTransport({
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

    await transporter.sendMail({
      from: `"${String(options.fromName || "EPOS System").replace(/["\r\n]/g, "")}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
      ...(options.text ? { text: options.text } : {}),
      ...(Array.isArray(options.attachments) && options.attachments.length ? { attachments: options.attachments } : {}),
    });

    console.log(`📨 Email sent to ${to}`);
    return true;
  } catch (err) {
    console.error("❌ Email send failed:", err.message);
    return false;
  }
}

module.exports = sendEmail;
