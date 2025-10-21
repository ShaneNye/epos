// utils/netSuiteTBA.js
const crypto = require("crypto");
const OAuth = require("oauth-1.0a");
const fetch = global.fetch; // built-in on Node 18+

function createOAuthHeader({
  consumerKey,
  consumerSecret,
  tokenId,
  tokenSecret,
  realm,
  method,
  url,
}) {
  const oauth = new OAuth({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA256",
    hash_function(base_string, key) {
      return crypto.createHmac("sha256", key).update(base_string).digest("base64");
    },
  });

  const request_data = { url, method };
  const auth = oauth.authorize(request_data, {
    key: tokenId,
    secret: tokenSecret,
  });

  const header = oauth.toHeader(auth);
  header.Authorization += `, realm="${realm}"`;
  return header;
}

async function callNetSuiteTBA({
  method = "GET",
  restletUrl,
  consumerKey,
  consumerSecret,
  tokenId,
  tokenSecret,
  realm,
  body,
  query,
}) {
  let url = restletUrl;
  if (query && Object.keys(query).length) {
    const q = new URLSearchParams(query).toString();
    url += (url.includes("?") ? "&" : "?") + q;
  }

  const headers = createOAuthHeader({
    consumerKey,
    consumerSecret,
    tokenId,
    tokenSecret,
    realm,
    method,
    url,
  });
  headers["Content-Type"] = "application/json";

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) throw new Error(`NetSuite error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

module.exports = { callNetSuiteTBA };
