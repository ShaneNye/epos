const express = require("express");
const fetch = require("node-fetch");
const pool = require("../db");
const { getSession } = require("../sessions");

const router = express.Router();

const BASE_URL =
  process.env.RENDER_EXTERNAL_URL ||
  process.env.APP_BASE_URL ||
  "http://localhost:3000";

function openAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    model:
      process.env.OPENAI_VSA_MODEL ||
      process.env.OPENAI_SUITEPIM_MODEL ||
      "gpt-4.1-mini",
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractOpenAIText(payload) {
  if (!payload) return "";
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractOpenAIUsage(payload) {
  return {
    inputTokens: Number(payload?.usage?.input_tokens || 0),
    outputTokens: Number(payload?.usage?.output_tokens || 0),
    totalTokens: Number(payload?.usage?.total_tokens || 0),
  };
}

function normalizeAccessList(rawAccess) {
  if (Array.isArray(rawAccess)) return rawAccess.map(String);
  if (typeof rawAccess === "string") {
    const parsed = parseJson(rawAccess);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  }
  return [];
}

function authTokenFromReq(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
}

async function getActiveRoleAccess(roleName) {
  if (!roleName) return [];
  const result = await pool.query(
    "SELECT access FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
    [roleName]
  );
  return normalizeAccessList(result.rows[0]?.access).map((value) =>
    String(value || "").trim().toLowerCase()
  );
}

async function getAuthorizedContext(req) {
  const token = authTokenFromReq(req);
  if (!token) {
    const err = new Error("Missing token");
    err.status = 401;
    throw err;
  }

  const session = await getSession(token);
  if (!session) {
    const err = new Error("Invalid session");
    err.status = 401;
    throw err;
  }

  const activeRoleName =
    typeof session.activeRole === "string"
      ? session.activeRole
      : session.activeRole?.name || "";
  const access = await getActiveRoleAccess(activeRoleName);

  if (!access.includes("ai-access")) {
    const err = new Error("AI access is disabled for your current role.");
    err.status = 403;
    throw err;
  }

  return { token, session, activeRoleName, access };
}

async function fetchInternalJson(routePath, token) {
  const response = await fetch(`${BASE_URL}${routePath}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    throw new Error(
      payload?.error || payload?.message || `Internal request failed: ${response.status}`
    );
  }

  return payload;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function todayGb() {
  return new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London" });
}

function safeNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value) {
  return String(value || "").trim().toLowerCase();
}

function idText(value) {
  return value == null ? "" : String(value).trim();
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractStockQuery(message) {
  const cleaned = String(message || "")
    .replace(/\?/g, " ")
    .replace(/\b(can you|could you|would you|please|tell me|let me know|check|see if|find out if)\b/gi, " ")
    .replace(/\b(is|are|do|we|have|any|there|for|the|a|an|item|product)\b/gi, " ")
    .replace(/\b(in stock|stock|inventory|available|availability)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || String(message || "").trim();
}

function detectIntent(message) {
  const msg = String(message || "").toLowerCase();

  if (
    (msg.includes("stock") || msg.includes("inventory") || msg.includes("available")) &&
    !msg.includes("order")
  ) {
    return { type: "stock_lookup", stockQuery: extractStockQuery(message) };
  }

  if (
    msg.includes("order") &&
    msg.includes("today") &&
    (msg.includes("my") || msg.includes("i have"))
  ) {
    return { type: "today_orders_status" };
  }

  if (msg.includes("order")) {
    return { type: "recent_orders" };
  }

  if (msg.includes("deposit")) {
    return { type: "deposit_summary" };
  }

  if (
    msg.includes("my role") ||
    msg.includes("current role") ||
    msg.includes("my store") ||
    msg.includes("my location") ||
    msg.includes("my email") ||
    msg.includes("who am i")
  ) {
    return { type: "user_context" };
  }

  return { type: "general" };
}

async function planAssistantQuery(message, userContext, pageContext = {}) {
  const openai = openAIConfig();
  if (!openai.apiKey) {
    return detectIntent(message);
  }

  const instructions = [
    "You plan how the EPOS Virtual Sales Assistant should answer a user question.",
    "Choose the single best action from the supported actions.",
    "Supported actions are:",
    "- stock_lookup: use when the user is asking about stock, availability, or inventory for a product.",
    "- today_orders_status: use when the user is asking about orders they created today or today's statuses for their own orders.",
    "- recent_orders: use when the user is asking about recent order statuses more generally.",
    "- deposit_summary: use when the user is asking about customer deposits.",
    "- user_context: use when the user is asking about their role, email, user identity, or primary store.",
    "- general: use when none of the tools fit and the assistant should answer from current context only.",
    "If you choose stock_lookup, extract a concise stock_query.",
    "Return one JSON object only with keys: type, stockQuery, needsUserContext, reason.",
  ].join(" ");

  const input = [
    "User message:",
    message,
    "",
    "Current user context:",
    JSON.stringify(
      {
        email: userContext.email,
        fullName: userContext.fullName,
        primaryStore: userContext.primaryStore,
        activeRole: userContext.activeRole,
      },
      null,
      2
    ),
    "",
    "Page context:",
    JSON.stringify(pageContext, null, 2),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openai.model,
      instructions,
      input,
      max_output_tokens: 140,
    }),
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    return detectIntent(message);
  }

  const planned = parseJson(extractOpenAIText(payload));
  if (!planned || typeof planned !== "object" || !planned.type) {
    return detectIntent(message);
  }

  return {
    type: String(planned.type || "general"),
    stockQuery: String(planned.stockQuery || "").trim(),
    needsUserContext: planned.needsUserContext !== false,
    reason: String(planned.reason || "").trim(),
  };
}

async function getCurrentUserContext(token, session) {
  const me = await fetchInternalJson("/api/me", token);
  return {
    id: me?.user?.id || session?.user_id || session?.id || null,
    email: me?.user?.email || session?.email || "",
    fullName:
      [me?.user?.firstName, me?.user?.lastName].filter(Boolean).join(" ").trim() ||
      session?.name ||
      "",
    primaryStore: me?.user?.primaryStore || null,
    roles: Array.isArray(me?.user?.roles) ? me.user.roles : session?.roles || [],
    activeRole: me?.activeRole || session?.activeRole?.name || "",
    netsuiteId: session?.netsuiteid || null,
  };
}

async function getTodayOrdersStatusForUser(token, userContext) {
  const [widgetSales, orderManagement] = await Promise.all([
    fetchInternalJson("/api/netsuite/widget-sales", token),
    fetchInternalJson("/api/netsuite/order-management", token),
  ]);

  const today = todayGb();
  const email = String(userContext.email || "").trim().toLowerCase();
  const salesRows = (widgetSales.results || widgetSales.data || []).filter((row) => {
    return (
      String(row.Date || "").trim() === today &&
      String(row.Email || "").trim().toLowerCase() === email
    );
  });

  const grouped = new Map();
  salesRows.forEach((row) => {
    const doc = String(row["Document Number"] || "").trim();
    if (!doc) return;
    const existing =
      grouped.get(doc) || {
        documentNumber: doc,
        internalId: row.InternalId || "",
        store: row.Store || "",
        bedSpecialist: row["Bed Specialist"] || "",
        total: 0,
        lines: 0,
      };
    existing.total += safeNumber(row.Amount);
    existing.lines += 1;
    grouped.set(doc, existing);
  });

  const orderMap = new Map(
    (orderManagement.results || orderManagement.data || []).map((row) => [
      String(row["Document Number"] || "").trim(),
      row,
    ])
  );

  const orders = Array.from(grouped.values())
    .map((row) => {
      const statusRow = orderMap.get(row.documentNumber) || {};
      return {
        ...row,
        readyForDelivery: statusRow["Ready For Delivery"] || "Unknown",
        orderType: statusRow["Order Type"] || "",
        customerName: statusRow.Name || "",
        supplierPos: statusRow["Supplier Po's"] || "",
        schedule: stripHtml(statusRow.Schedule || ""),
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    date: today,
    orderCount: orders.length,
    orders: orders.slice(0, 12),
  };
}

async function getRecentOrders(token) {
  const payload = await fetchInternalJson("/api/netsuite/order-management", token);
  const orders = (payload.results || payload.data || []).slice(0, 6).map((row) => ({
    documentNumber: row["Document Number"] || "",
    customerName: row.Name || "",
    date: row.Date || "",
    readyForDelivery: row["Ready For Delivery"] || "Unknown",
    store: row.Store || "",
    schedule: stripHtml(row.Schedule || ""),
  }));
  return { orders };
}

async function getDepositSummary(token) {
  const payload = await fetchInternalJson("/api/netsuite/customer-deposits", token);
  const rows = payload.results || payload.data || [];
  return {
    count: rows.length,
    sample: rows.slice(0, 5),
  };
}

async function getStockSnapshot(token, stockQuery) {
  const [balanceRes, numbersRes] = await Promise.all([
    fetchInternalJson("/api/netsuite/inventorybalance", token),
    fetchInternalJson("/api/netsuite/invoice-numbers", token),
  ]);

  const balance = balanceRes.results || balanceRes.data || [];
  const numbers = numbersRes.results || numbersRes.data || [];

  const numberAgg = {};
  for (const row of numbers) {
    const itemId = idText(row["Item Id"] || row["Item ID"] || row.itemid);
    const inv = cleanText(row.Number);
    const loc = cleanText(row.Location);
    if (!itemId || !inv || !loc) continue;
    const key = `${itemId}||${inv}||${loc}`;
    if (!numberAgg[key]) {
      numberAgg[key] = {
        available: 0,
        onHand: 0,
        itemId,
        itemName: row.Item || "",
      };
    }
    numberAgg[key].available += safeNumber(row.Available);
    numberAgg[key].onHand += safeNumber(row["On Hand"]);
  }

  const collapsed = {};
  for (const row of balance) {
    const itemId = idText(row["Item ID"] || row["Item Id"] || row.itemid || row.Item);
    const inv = cleanText(row["Inventory Number"]);
    const loc = cleanText(row.Location);
    const key = `${itemId}||${inv}||${loc}`;
    if (!collapsed[key]) collapsed[key] = row;
  }

  const merged = Object.values(collapsed)
    .map((row) => {
      const itemId = idText(row["Item ID"] || row["Item Id"] || row.itemid || row.Item);
      const inv = cleanText(row["Inventory Number"]);
      const loc = cleanText(row.Location);
      const key = `${itemId}||${inv}||${loc}`;
      const agg = numberAgg[key] || {
        available: 0,
        onHand: 0,
        itemId,
        itemName: "",
      };
      return {
        itemId: agg.itemId || itemId,
        itemName: agg.itemName || row.Name || row.Item || "",
        location: row.Location || "",
        bin: row["Bin Number"] || "",
        status: row.Status || "",
        inventoryNumber: row["Inventory Number"] || "",
        available: safeNumber(agg.available),
      };
    })
    .filter((row) => row.available > 0);

  const queryTokens = tokenize(stockQuery);
  const grouped = new Map();

  merged.forEach((row) => {
    const key = row.itemName;
    if (!key) return;
    const existing =
      grouped.get(key) || {
        itemName: row.itemName,
        totalAvailable: 0,
        locations: new Map(),
      };
    existing.totalAvailable += row.available;

    const locationKey = row.location || "Unknown location";
    const location =
      existing.locations.get(locationKey) || {
        name: locationKey,
        available: 0,
        statuses: new Set(),
      };
    location.available += row.available;
    if (row.status) location.statuses.add(row.status);
    existing.locations.set(locationKey, location);
    grouped.set(key, existing);
  });

  const scored = Array.from(grouped.values())
    .map((item) => {
      const haystack = item.itemName.toLowerCase();
      const containsAll = queryTokens.every((token) => haystack.includes(token));
      const startsWith = haystack.startsWith(String(stockQuery || "").toLowerCase());
      const exact = haystack === String(stockQuery || "").toLowerCase();
      const matchedTokenCount = queryTokens.filter((token) => haystack.includes(token)).length;
      const score =
        (exact ? 100 : 0) +
        (startsWith ? 30 : 0) +
        (containsAll ? 20 : 0) +
        matchedTokenCount;

      return {
        itemName: item.itemName,
        totalAvailable: item.totalAvailable,
        locations: Array.from(item.locations.values())
          .map((location) => ({
            name: location.name,
            available: location.available,
            statuses: Array.from(location.statuses.values()).sort(),
          }))
          .sort((a, b) => b.available - a.available)
          .slice(0, 6),
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.totalAvailable - a.totalAvailable)
    .slice(0, 5);

  return {
    query: stockQuery,
    matchCount: scored.length,
    matches: scored,
  };
}

async function generateAiReply({ message, pageName, pathname, intent, userContext, toolResult }) {
  const openai = openAIConfig();
  if (!openai.apiKey) {
    return buildDeterministicReply(intent, userContext, toolResult);
  }

  const instructions = [
    "You are the EPOS Virtual Sales Assistant for Sussex Beds.",
    "Reply in warm, practical UK English.",
    "Use only the provided JSON context.",
    "Be concise and useful.",
    "If data is unavailable, say so plainly instead of guessing.",
    "Do not mention internal APIs, endpoints, tokens, or implementation details.",
    "Do not use markdown tables.",
  ].join(" ");

  const input = [
    "User message:",
    message,
    "",
    "Page context:",
    JSON.stringify({ pageName, pathname }, null, 2),
    "",
    "Current user context:",
    JSON.stringify(userContext, null, 2),
    "",
    "Resolved intent and tool result:",
    JSON.stringify({ intent, toolResult }, null, 2),
    "",
    "Answer the user directly.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openai.model,
      instructions,
      input,
      max_output_tokens: 320,
    }),
  });

  const payload = parseJson(await response.text());
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI request failed: ${response.status}`);
  }

  return {
    text: extractOpenAIText(payload),
    model: openai.model,
    usage: extractOpenAIUsage(payload),
  };
}

function buildDeterministicReply(intent, userContext, toolResult) {
  if (intent.type === "today_orders_status") {
    const orders = toolResult?.orders || [];
    if (!orders.length) {
      return {
        text: `I couldn't find any orders created by you today (${toolResult?.date || todayGb()}).`,
        model: "deterministic",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    const lines = orders
      .slice(0, 5)
      .map(
        (order) =>
          `${order.documentNumber}: ${order.readyForDelivery} (${order.store || "Unknown store"})`
      );
    return {
      text: `You have ${orders.length} order${orders.length === 1 ? "" : "s"} created today. ${lines.join(
        "; "
      )}.`,
      model: "deterministic",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  if (intent.type === "stock_lookup") {
    const matches = toolResult?.matches || [];
    if (!matches.length) {
      return {
        text: `I couldn't find any live stock for "${toolResult?.query || ""}".`,
        model: "deterministic",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    const first = matches[0];
    const topLocations = (first.locations || [])
      .slice(0, 3)
      .map((location) => `${location.name}: ${location.available}`)
      .join(", ");
    return {
      text: `${first.itemName} has ${first.totalAvailable} available across the live stock feed. Top locations: ${topLocations}.`,
      model: "deterministic",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  if (intent.type === "user_context") {
    return {
      text: `You're signed in as ${userContext.fullName || "Unknown user"} on the ${
        userContext.activeRole || "current"
      } role, with ${userContext.primaryStore || "no primary store set"} as your primary store.`,
      model: "deterministic",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  if (intent.type === "recent_orders") {
    const orders = toolResult?.orders || [];
    if (!orders.length) {
      return {
        text: "I couldn't find any recent orders right now.",
        model: "deterministic",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
    const lines = orders
      .slice(0, 4)
      .map((order) => `${order.documentNumber}: ${order.readyForDelivery}`);
    return {
      text: `Here are the latest orders I can see: ${lines.join("; ")}.`,
      model: "deterministic",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  if (intent.type === "deposit_summary") {
    return {
      text: `I found ${toolResult?.count || 0} customer deposit record${
        toolResult?.count === 1 ? "" : "s"
      } in the current feed.`,
      model: "deterministic",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  return {
    text: "I can help with live stock, your orders created today, recent order statuses, deposits, and your current user context.",
    model: "deterministic",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

router.post("/query", async (req, res) => {
  try {
    const { token, session } = await getAuthorizedContext(req);
    const { message = "", pageName = "", pathname = "" } = req.body || {};

    if (!String(message || "").trim()) {
      return res.status(400).json({ ok: false, error: "Missing message" });
    }

    const userContext = await getCurrentUserContext(token, session);
    const intent = await planAssistantQuery(message, userContext, { pageName, pathname });
    let toolResult = {};

    if (intent.type === "stock_lookup") {
      toolResult = await getStockSnapshot(token, intent.stockQuery || extractStockQuery(message) || message);
    } else if (intent.type === "today_orders_status") {
      toolResult = await getTodayOrdersStatusForUser(token, userContext);
    } else if (intent.type === "recent_orders") {
      toolResult = await getRecentOrders(token);
    } else if (intent.type === "deposit_summary") {
      toolResult = await getDepositSummary(token);
    } else if (intent.type === "user_context") {
      toolResult = userContext;
    } else {
      toolResult = {
        supportedTopics: [
          "Is [product] in stock?",
          "What are the status of the orders I have created today?",
          "Show me recent orders",
          "How many deposits do we have?",
          "What store / role am I on?",
        ],
      };
    }

    const reply = await generateAiReply({
      message,
      pageName,
      pathname,
      intent,
      userContext,
      toolResult,
    });

    return res.json({
      ok: true,
      reply: reply.text,
      model: reply.model,
      usage: reply.usage,
      intent: intent.type,
    });
  } catch (err) {
    const status = Number(err.status || 500);
    console.error("VSA query error:", err);
    return res.status(status).json({ ok: false, error: err.message || "Virtual Sales Assistant error" });
  }
});

module.exports = router;
