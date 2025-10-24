// testGmail.js
require("dotenv").config();
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

// === 1️⃣  Configure OAuth2 client ===
const OAuth2 = google.auth.OAuth2;
const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

async function testGmail() {
  try {
    console.log("🔐 Getting access token from Google...");
    const accessToken = await oauth2Client.getAccessToken();

    if (!accessToken || !accessToken.token) {
      throw new Error("❌ No access token returned — check your refresh token");
    }

    console.log("✅ Access token acquired — building transporter...");

    // === 2️⃣  Create Nodemailer transporter ===
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

    // === 3️⃣  Send a test email ===
    const mailOptions = {
      from: `"EPOS Test" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER, // send to yourself
      subject: "✅ EPOS Gmail OAuth2 Test",
      text: "This is a test email from your EPOS OAuth2 setup.",
    };

    console.log("📨 Sending test email...");
    const result = await transporter.sendMail(mailOptions);
    console.log("✅ Test email sent successfully!");
    console.log("📬 Message ID:", result.messageId);
  } catch (err) {
    console.error("❌ Gmail test failed:", err.message);
    console.error(err);
  }
}

testGmail();
