const express = require("express");
const router = express.Router();
const { getSession } = require("../sessions");
const logger = require("../utils/logging");
const { nsPostRaw, nsRestlet } = require("../netsuiteClient");

const MEMO_RESTLET_URL = process.env.MEMO_RESTLET_URL;

if (!MEMO_RESTLET_URL) {
  console.error("MEMO_RESTLET_URL missing from environment variables");
}

function normalizeMemo(row = {}) {
  return {
    ID: row.ID || row.id || row.internalid || "",
    "Internal ID": row["Internal ID"] || row.transactionId || row.transaction || "",
    Date: row.Date || row.date || row.notedate || "",
    Author: row.Author || row.author || "",
    Title: row.Title || row.title || "",
    Type: row.Type || row.type || "",
    Memo: row.Memo || row.memo || row.note || "",
  };
}

function suiteQlUrl() {
  return `https://${process.env.NS_ACCOUNT_DASH}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

function sqlNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : "";
}

function dedupeMemos(memos = []) {
  const seen = new Set();
  const output = [];

  for (const memo of memos) {
    const key = String(memo.ID || `${memo.Date}|${memo.Author}|${memo.Title}|${memo.Memo}`);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(memo);
  }

  return output;
}

async function getSessionFromRequest(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return token ? getSession(token) : null;
}

router.post("/memo", async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);

    if (!session) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const userEmail = session?.email;
    const userId = session?.id;

    if (!userEmail) return res.status(401).json({ ok: false, error: "Invalid session" });

    const { orderId, title, type, memo } = req.body;

    logger.apiPayload("Sales memo request", req.body);

    if (!orderId || !title || !memo) {
      return res.json({ ok: false, error: "Missing required fields" });
    }

    const payload = {
      orderId,
      title,
      type,
      memo,
      authorId: session?.netsuiteid || session?.netsuiteId || null,
    };

    logger.apiPayload("Sales memo RESTlet payload", payload);

    const nsResponse = await nsRestlet(MEMO_RESTLET_URL, payload, userId, "POST");

    logger.netSuiteResponse("Sales memo RESTlet", nsResponse);

    return res.json(nsResponse);
  } catch (err) {
    console.error("Error creating memo:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/memo/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const session = await getSessionFromRequest(req).catch(() => null);
    const userId = session?.id || null;
    let suiteletMemos = [];

    const suiteletBase = process.env.USER_NOTES_URL;
    const suiteletToken = process.env.USER_NOTES;

    if (suiteletBase && suiteletToken) {
      try {
        const suiteletUrl = `${suiteletBase}&token=${suiteletToken}`;
        const resp = await fetch(suiteletUrl);
        const text = await resp.text();

        if (text.startsWith("<")) {
          console.error("Suitelet returned HTML instead of JSON.");
        } else {
          const data = JSON.parse(text);
          if (data.ok && Array.isArray(data.results)) {
            suiteletMemos = data.results
              .filter((n) => String(n["Internal ID"]) === String(orderId))
              .map(normalizeMemo);
          }
        }
      } catch (suiteletErr) {
        console.error("Error fetching memos via Suitelet:", suiteletErr);
      }
    }

    let transactionMemos = [];
    const transactionId = sqlNumber(orderId);
    if (transactionId) {
      try {
        const query = `
          SELECT
            TransactionNote.ID AS id,
            TransactionNote.Transaction AS transactionId,
            TransactionNote.NoteDate AS date,
            BUILTIN.DF(TransactionNote.Author) AS author,
            BUILTIN.DF(TransactionNote.NoteType) AS type,
            TransactionNote.Title AS title,
            TransactionNote.Note AS memo
          FROM
            TransactionNote
          WHERE
            TransactionNote.Transaction = ${transactionId}
          ORDER BY
            TransactionNote.NoteDate DESC
        `;

        const nsResponse = await nsPostRaw(suiteQlUrl(), { q: query }, userId);
        if (Array.isArray(nsResponse?.items)) {
          transactionMemos = nsResponse.items.map(normalizeMemo);
        }
      } catch (suiteQlErr) {
        console.error("Error fetching memos via TransactionNote SuiteQL:", suiteQlErr);
      }
    }

    return res.json({
      ok: true,
      memos: dedupeMemos([...suiteletMemos, ...transactionMemos]),
    });
  } catch (err) {
    console.error("Error fetching memos:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
