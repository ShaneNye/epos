const crypto = require("crypto");
const express = require("express");
const { google } = require("googleapis");
const fetch = require("node-fetch");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.spaces.create",
  "https://www.googleapis.com/auth/chat.messages.create",
  "https://www.googleapis.com/auth/userinfo.email",
];

let initPromise;

function ensureGoogleTokenTable() {
  if (!initPromise) {
    initPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS user_google_tokens (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        google_email TEXT,
        access_token TEXT,
        refresh_token TEXT,
        expiry_date TIMESTAMPTZ,
        scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  return initPromise;
}

function oauthRedirectUri(req) {
  const configured = String(
    process.env.GOOGLE_CALL_OAUTH_REDIRECT_URI ||
      process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      ""
  ).trim();
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}/api/google/callback`;
}

function oauthClient(req) {
  const clientId = process.env.GOOGLE_CALL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CALL_CLIENT_ID/GOOGLE_CALL_CLIENT_SECRET");
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    oauthRedirectUri(req)
  );
}

function secretKey() {
  const secret =
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||
    process.env.GOOGLE_CALL_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.SESSION_SECRET ||
    "epos-google-token-development-key";
  return crypto.createHash("sha256").update(String(secret)).digest();
}

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretKey(),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secretKey())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function verifyState(state) {
  const [body, signature] = String(state || "").split(".");
  if (!body || !signature) throw new Error("Invalid OAuth state");

  const expected = crypto
    .createHmac("sha256", secretKey())
    .update(body)
    .digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) {
    throw new Error("Invalid OAuth state signature");
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid OAuth state signature");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.userId || !payload.iat) throw new Error("Invalid OAuth state payload");

  const ageMs = Date.now() - Number(payload.iat);
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) {
    throw new Error("OAuth state has expired");
  }

  return payload;
}

function authTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  return req.query.token ? String(req.query.token) : null;
}

async function sessionFromRequest(req) {
  const token = authTokenFromRequest(req);
  if (!token) return null;
  return getSession(token);
}

async function connectedStatus(userId) {
  await ensureGoogleTokenTable();
  const result = await pool.query(
    `SELECT google_email, expiry_date, scopes, created_at, updated_at
       FROM user_google_tokens
      WHERE user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) return { connected: false };

  return {
    connected: true,
    googleEmail: row.google_email || null,
    expiryDate: row.expiry_date || null,
    scopes: row.scopes || [],
    connectedAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function saveGoogleTokens(userId, tokens, existingRefreshToken = null) {
  await ensureGoogleTokenTable();
  await pool.query(
    `INSERT INTO user_google_tokens
      (user_id, google_email, access_token, refresh_token, expiry_date, scopes, updated_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       google_email = COALESCE(EXCLUDED.google_email, user_google_tokens.google_email),
       access_token = COALESCE(EXCLUDED.access_token, user_google_tokens.access_token),
       refresh_token = COALESCE(EXCLUDED.refresh_token, user_google_tokens.refresh_token),
       expiry_date = COALESCE(EXCLUDED.expiry_date, user_google_tokens.expiry_date),
       scopes = CASE WHEN cardinality(EXCLUDED.scopes) > 0 THEN EXCLUDED.scopes ELSE user_google_tokens.scopes END,
       updated_at = NOW()`,
    [
      userId,
      tokens.google_email || null,
      encrypt(tokens.access_token),
      encrypt(tokens.refresh_token || existingRefreshToken),
      tokens.expiry_date || Date.now(),
      tokens.scopes || GOOGLE_SCOPES,
    ]
  );
}

async function googleClientForUser(req, userId) {
  await ensureGoogleTokenTable();
  const result = await pool.query(
    `SELECT google_email, access_token, refresh_token, expiry_date, scopes
       FROM user_google_tokens
      WHERE user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    const err = new Error("Google is not connected for this user.");
    err.status = 401;
    err.code = "GOOGLE_NOT_CONNECTED";
    throw err;
  }

  if (!hasAllRequiredScopes(row.scopes)) {
    const err = new Error("Google needs reconnecting to grant the latest call permissions.");
    err.status = 401;
    err.code = "GOOGLE_RECONNECT_REQUIRED";
    throw err;
  }

  const refreshToken = decrypt(row.refresh_token);
  const accessToken = decrypt(row.access_token);
  const client = oauthClient(req);
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: row.expiry_date ? new Date(row.expiry_date).getTime() : null,
  });

  client.on("tokens", async (tokens) => {
    try {
      await saveGoogleTokens(userId, {
        ...tokens,
        google_email: row.google_email,
        scopes: row.scopes || GOOGLE_SCOPES,
      }, refreshToken);
    } catch (err) {
      console.warn("Failed to persist refreshed Google token:", err.message);
    }
  });

  const access = await client.getAccessToken();
  if (!access?.token) {
    const err = new Error("Could not refresh Google access token.");
    err.status = 401;
    err.code = "GOOGLE_RECONNECT_REQUIRED";
    throw err;
  }

  return {
    client,
    accessToken: access.token,
    googleEmail: row.google_email,
  };
}

async function googleJson(url, { method = "GET", accessToken, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(payload?.error?.message || `Google API returned ${response.status}`);
    err.status = response.status;
    err.googlePayload = payload;
    throw err;
  }

  return payload || {};
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hasAllRequiredScopes(scopes = []) {
  const granted = new Set(Array.isArray(scopes) ? scopes : []);
  return GOOGLE_SCOPES.every((scope) => granted.has(scope));
}

async function setupDirectMessage(accessToken, targetEmail) {
  return googleJson("https://chat.googleapis.com/v1/spaces:setup", {
    method: "POST",
    accessToken,
    body: {
      requestId: crypto.randomUUID(),
      space: {
        spaceType: "DIRECT_MESSAGE",
      },
      memberships: [
        {
          member: {
            name: `users/${targetEmail}`,
            type: "HUMAN",
          },
        },
      ],
    },
  });
}

async function setupPersonalStockSpace(accessToken, userId, displayName) {
  return googleJson("https://chat.googleapis.com/v1/spaces:setup", {
    method: "POST",
    accessToken,
    body: {
      requestId: `epos-product-hub-stock-${userId}`,
      space: {
        spaceType: "SPACE",
        displayName: String(displayName || "EPOS Product Hub Stock").slice(0, 128),
      },
    },
  });
}

function googleMeetUrl(space) {
  return (
    space?.meetingUri ||
    space?.meeting_uri ||
    space?.config?.entryPointAccess?.meetingUri ||
    ""
  );
}

router.get("/status", async (req, res) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const status = await connectedStatus(session.id);
    return res.json({ ok: true, ...status });
  } catch (err) {
    console.error("Google status failed:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to load Google connection status" });
  }
});

router.get("/auth", async (req, res) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const client = oauthClient(req);
    const state = signState({
      userId: session.id,
      returnTo: String(req.query.returnTo || "/rota").slice(0, 200),
      nonce: crypto.randomUUID(),
      iat: Date.now(),
    });

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES,
      state,
    });

    if (String(req.query.format || "").toLowerCase() === "json") {
      return res.json({ ok: true, url });
    }

    return res.redirect(url);
  } catch (err) {
    console.error("Google auth start failed:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to start Google authorisation" });
  }
});

router.get("/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    if (!code) throw new Error("Missing OAuth code");

    const state = verifyState(req.query.state);
    const client = oauthClient(req);
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = await oauth2.userinfo.get();
    const googleEmail = profile.data?.email || null;

    await saveGoogleTokens(state.userId, {
      ...tokens,
      google_email: googleEmail,
      scopes: GOOGLE_SCOPES,
    });

    return res.type("html").send(`<!doctype html>
<html>
  <head><title>Google connected</title></head>
  <body>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: "google-auth-complete", ok: true }, window.location.origin);
      }
      window.close();
    </script>
    Google connected. You can close this window.
  </body>
</html>`);
  } catch (err) {
    console.error("Google OAuth callback failed:", err.message);
    return res.status(400).type("html").send(`<!doctype html>
<html>
  <head><title>Google connection failed</title></head>
  <body>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: "google-auth-complete", ok: false }, window.location.origin);
      }
    </script>
    Google connection failed. Please close this window and try again.
  </body>
</html>`);
  }
});

router.post("/meet-call", async (req, res) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const targetEmail = cleanEmail(req.body?.email || req.body?.targetEmail);
    const targetName = String(req.body?.name || req.body?.targetName || targetEmail).trim();
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      return res.status(400).json({ ok: false, error: "A valid employee email is required." });
    }

    const { accessToken } = await googleClientForUser(req, session.id);

    const dmSpace = await setupDirectMessage(accessToken, targetEmail);

    const spaceName = dmSpace?.name;
    if (!spaceName) throw new Error("Google Chat did not return a DM space.");

    const meetSpace = await googleJson("https://meet.googleapis.com/v2/spaces", {
      method: "POST",
      accessToken,
      body: {},
    });
    const meetUrl = googleMeetUrl(meetSpace);
    if (!meetUrl) throw new Error("Google Meet did not return a meeting URL.");

    const callerName = session.name || session.email || "An EPOS user";
    await googleJson(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
      method: "POST",
      accessToken,
      body: {
        text: `${callerName} is calling you: ${meetUrl}`,
      },
    });

    return res.json({
      ok: true,
      meetUrl,
      targetEmail,
      targetName,
      chatSpace: spaceName,
    });
  } catch (err) {
    console.error("Google Meet call failed:", err.message, err.googlePayload || "");
    return res.status(err.status || 500).json({
      ok: false,
      code: err.code || "GOOGLE_CALL_FAILED",
      error: err.message || "Failed to start Google call.",
    });
  }
});

router.post("/self-message", async (req, res) => {
  try {
    const session = await sessionFromRequest(req);
    if (!session?.id) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const message = String(req.body?.message || req.body?.text || "").trim();
    if (!message) {
      return res.status(400).json({ ok: false, error: "Message text is required." });
    }

    const { accessToken, googleEmail } = await googleClientForUser(req, session.id);
    const targetEmail = cleanEmail(googleEmail || session.email);
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      return res.status(400).json({ ok: false, error: "No Google email is connected for this user." });
    }

    const space = await setupPersonalStockSpace(
      accessToken,
      session.id,
      `EPOS Product Hub Stock - ${targetEmail}`
    );
    const spaceName = space?.name;
    if (!spaceName) throw new Error("Google Chat did not return a stock notes space.");

    await googleJson(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
      method: "POST",
      accessToken,
      body: {
        text: message.slice(0, 3900),
      },
    });

    return res.json({
      ok: true,
      targetEmail,
      chatSpace: spaceName,
    });
  } catch (err) {
    console.error("Google self-message failed:", err.message, err.googlePayload || "");
    return res.status(err.status || 500).json({
      ok: false,
      code: err.code || "GOOGLE_SELF_MESSAGE_FAILED",
      error: err.message || "Failed to send Google Chat message.",
    });
  }
});

module.exports = {
  router,
  ensureGoogleTokenTable,
  GOOGLE_SCOPES,
};
