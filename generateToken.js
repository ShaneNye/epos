require("dotenv").config();
const { google } = require("googleapis");
const readline = require("readline");

// Load credentials from environment variables
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI = "https://developers.google.com/oauthplayground"
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("❌ Missing CLIENT_ID or CLIENT_SECRET in .env file");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = ["https://mail.google.com/"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
});

console.log("👉 Authorize this app by visiting this URL:");
console.log(authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\nEnter the code from that page here: ", async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n✅ Your tokens:\n");
    console.log(tokens);
    console.log("\n📋 Copy the 'refresh_token' value into your .env file as GOOGLE_REFRESH_TOKEN");
  } catch (err) {
    console.error("❌ Error retrieving access token:", err);
  }
  rl.close();
});
