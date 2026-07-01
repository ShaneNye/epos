const express = require("express");
const fetch = require("node-fetch");
const router = express.Router();
const pool = require("../db");
let dispatchTrackCredentialColumnsPromise = null;

function trim(value) {
  return String(value || "").trim();
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseKeyValueCredentials(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[;\n\r]+/g, "&");
  if (!normalized.includes("=")) return null;
  const params = new URLSearchParams(normalized);
  return Object.fromEntries(params.entries());
}

function firstCredentialObject(value) {
  if (Array.isArray(value)) return value[0] || {};
  if (Array.isArray(value?.credentials)) return value.credentials[0] || {};
  if (value && typeof value === "object") return value;
  return {};
}

function normalizeBaseUrl(value) {
  const raw = trim(value || "https://sussexbeds.dispatchtrack.com").replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    const path = url.pathname.replace(/\/+$/, "");

    // DispatchTrack web app URLs use paths like /a18/service-orders/...
    // The public API lives at the account origin: /api/external/v1/...
    if (/^\/a\d+\b/i.test(path) || /^\/api\/external\/v\d+/i.test(path)) {
      return url.origin;
    }

    return path && path !== "/" ? url.origin : withProtocol.replace(/\/+$/, "");
  } catch {
    return withProtocol.replace(/\/+$/, "");
  }
}

async function dispatchTrackCredentialColumns() {
  if (dispatchTrackCredentialColumnsPromise) return dispatchTrackCredentialColumnsPromise;

  dispatchTrackCredentialColumnsPromise = pool
    .query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'locations'
        AND column_name IN ('dispatchtrack_api_credentials', 'dispatchtrack_api_key')
      `
    )
    .then((result) => {
      const columns = new Set(result.rows.map((row) => row.column_name));
      console.log("DispatchTrack credential columns detected:", [...columns]);
      return columns;
    })
    .catch((err) => {
      dispatchTrackCredentialColumnsPromise = null;
      throw err;
    });

  return dispatchTrackCredentialColumnsPromise;
}

async function dispatchTrackCredentialSelectFields() {
  const columns = await dispatchTrackCredentialColumns();
  const fields = ["id", "name"];
  if (columns.has("dispatchtrack_api_credentials")) fields.push("dispatchtrack_api_credentials");
  if (columns.has("dispatchtrack_api_key")) fields.push("dispatchtrack_api_key");
  return fields;
}

function extractDispatchIdentifierFromSchedule(value) {
  const raw = String(value || "");
  const match = raw.match(/service-orders\/([^"'<>\s/?#]+)/i);
  if (match?.[1]) return match[1];
  const fallback = raw.match(/\bSO[A-Z]*\d+\b/i);
  return fallback?.[0] || "";
}

async function loadOrderManagementRows() {
  const baseUrl = process.env.ORDER_MANAGEMENT_URL;
  const token = process.env.ORDER_MANAGEMENT;
  if (!baseUrl || !token) return [];

  const url = new URL(String(baseUrl).trim().replace(/^["']|["']$/g, ""));
  url.searchParams.set("token", token);
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`ORDER_MANAGEMENT_URL returned ${response.status}`);
  }
  return rowsFromPayload(await response.json());
}

async function resolveDispatchIdentifier({ salesOrderId, salesOrderTranId, suppliedIdentifier }) {
  const supplied = trim(suppliedIdentifier);
  if (supplied) return { identifier: supplied, source: "request" };

  const orderId = trim(salesOrderId);
  const tranId = trim(salesOrderTranId);
  if (!orderId && !tranId) return { identifier: "", source: "missing-sales-order" };

  const rows = await loadOrderManagementRows();
  const match = rows.find((row) => {
    return (
      (orderId && String(row.ID || row.Id || row.id || "").trim() === orderId) ||
      (tranId && String(row["Document Number"] || row.documentNumber || "").trim() === tranId)
    );
  });

  const identifier = extractDispatchIdentifierFromSchedule(
    match?.Schedule ||
      match?.schedule ||
      match?.["Dispatch Track URL"] ||
      match?.dispatchTrackUrl ||
      match?.["Dispatch Track Document Number"] ||
      match?.dispatchTrackDocumentNumber
  );
  return {
    identifier,
    source: identifier ? "order-management" : "order-management-no-match",
    matchedRow: match
      ? {
          id: match.ID || match.Id || match.id || "",
          documentNumber: match["Document Number"] || match.documentNumber || "",
          hasSchedule: !!(match.Schedule || match.schedule),
        }
      : null,
  };
}

function parseDispatchTrackCredentials(location = {}) {
  const raw =
    location.dispatchtrack_api_credentials ||
    location.dispatchtrack_api_key ||
    "";
  let parsed = null;

  if (raw && typeof raw === "object") {
    parsed = raw;
  } else {
    parsed = safeJsonParse(raw) || parseKeyValueCredentials(raw);
  }

  const credential = firstCredentialObject(parsed);
  const token = trim(
    credential.apiKey ||
      credential.api_key ||
      credential.authToken ||
      credential.auth_token ||
      credential.token ||
      credential.xAuthToken ||
      credential["X-AUTH-TOKEN"] ||
      credential.dispatchtrack_api_key ||
      (!parsed && raw)
  );
  const code = trim(
    credential.code ||
      credential.accountCode ||
      credential.account_code ||
      credential.dispatchtrack_code ||
      process.env.DISPATCHTRACK_CODE ||
      "sussexbeds"
  );
  const baseUrl = normalizeBaseUrl(
    credential.baseUrl ||
      credential.base_url ||
      credential.accountUrl ||
      credential.account_url ||
      credential.url ||
      credential.host ||
      credential.domain
  );
  const legacyImportUrl = trim(
    credential.importUrl ||
      credential.import_url ||
      credential.dtUrl ||
      credential.dt_url ||
      process.env.DISPATCHTRACK_IMPORT_URL ||
      `${baseUrl}/orders/api/add_order`
  );

  return { token, code, baseUrl, legacyImportUrl };
}

async function getWarehouseDispatchTrackCredentials(warehouseId) {
  const id = trim(warehouseId);
  if (!id) return null;
  const fields = await dispatchTrackCredentialSelectFields();

  const result = await pool.query(
    `
    SELECT ${fields.join(", ")}
    FROM public.locations
    WHERE id::text = $1
       OR netsuite_internal_id::text = $1
       OR distribution_location_id::text = $1
       OR invoice_location_id::text = $1
    ORDER BY
      CASE
        WHEN id::text = $1 THEN 0
        WHEN netsuite_internal_id::text = $1 THEN 1
        WHEN distribution_location_id::text = $1 THEN 2
        WHEN invoice_location_id::text = $1 THEN 3
        ELSE 4
      END
    LIMIT 1
    `,
    [id]
  );
  const location = result.rows[0];
  if (!location) return null;

  const credentials = parseDispatchTrackCredentials(location);
  return {
    locationId: location.id,
    locationName: location.name,
    credentialColumns: fields.filter((field) => field.startsWith("dispatchtrack_")),
    ...credentials,
  };
}

async function dispatchTrackRequest({ baseUrl, token, method, path, body = null }) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      "X-AUTH-TOKEN": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  const contentType = response.headers.get("content-type") || "";
  const returnedHtml =
    typeof data === "string" &&
    /text\/html|<!doctype html|<html[\s>]/i.test(`${contentType}\n${data.slice(0, 200)}`);

  if (!response.ok) {
    const err = new Error(`DispatchTrack ${method} ${path} failed with ${response.status}`);
    err.status = response.status;
    err.response = data;
    err.url = url;
    err.contentType = contentType;
    throw err;
  }

  if (returnedHtml) {
    const err = new Error(
      `DispatchTrack ${method} ${path} returned the web app HTML instead of API JSON`
    );
    err.status = response.status;
    err.response = data;
    err.url = url;
    err.contentType = contentType;
    throw err;
  }

  return { status: response.status, data, url, contentType };
}

async function dispatchTrackLegacyImportRequest({ url, code, apiKey, serviceOrder }) {
  const orderJson = JSON.stringify(serviceOrder);
  const payload = {
    json_data: {
      service_orders: {
        service_order: [orderJson],
      },
    },
    import_type: "netsuite_import",
    version: "2.0",
    code,
    api_key: apiKey,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    const err = new Error(`DispatchTrack legacy import POST failed with ${response.status}`);
    err.status = response.status;
    err.url = url;
    err.contentType = contentType;
    err.response = data;
    err.request = {
      ...payload,
      api_key: apiKey ? "***" : "",
    };
    throw err;
  }

  return {
    status: response.status,
    url,
    contentType,
    data,
    request: {
      ...payload,
      api_key: apiKey ? "***" : "",
    },
  };
}

function dispatchTrackResponseBody(data) {
  return data?.response || data;
}

function dispatchTrackDispatchFromResponse(data) {
  const body = dispatchTrackResponseBody(data);
  if (!body) return null;
  if (Array.isArray(body)) return body[0] || null;
  if (body.dispatch) return body.dispatch;
  if (body.dispatch_guide) return body.dispatch_guide;
  if (body.guide) return body.guide;
  if (body.service_order) return body.service_order;
  if (Array.isArray(body.dispatches)) return body.dispatches[0] || null;
  if (Array.isArray(body.dispatch_guides)) return body.dispatch_guides[0] || null;
  if (Array.isArray(body.guides)) return body.guides[0] || null;
  return body;
}

function compactDispatchDebug(dispatch = {}) {
  return {
    id: dispatch.id,
    dispatch_id: dispatch.dispatch_id,
    identifier: dispatch.identifier,
    dispatch_identifier: dispatch.dispatch_identifier,
    code: dispatch.code,
    beecode: dispatch.beecode,
    contact_name: dispatch.contact_name,
    keys: dispatch && typeof dispatch === "object" ? Object.keys(dispatch).slice(0, 30) : [],
  };
}

function contactNameWithUpdatedFirstName(currentName, firstName) {
  const first = trim(firstName);
  const current = trim(currentName);
  if (!current) return first;
  const parts = current.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return first;
  return [first, ...parts.slice(1)].join(" ");
}

function uniqueDispatchIdentifiers(...values) {
  const seen = new Set();
  return values
    .flat()
    .map((value) => trim(value))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

async function updateDispatchTrackDispatchCustomerFirstName({
  baseUrl,
  token,
  code,
  legacyImportUrl,
  dispatchIdentifier,
  firstName,
}) {
  const encodedIdentifier = encodeURIComponent(trim(dispatchIdentifier));
  const showPath = `/api/external/v1/dispatches/${encodedIdentifier}`;

  let current = null;
  try {
    current = await dispatchTrackRequest({
      baseUrl,
      token,
      method: "GET",
      path: showPath,
    });
  } catch (err) {
    const htmlApiResponse =
      /returned the web app HTML/i.test(err.message || "") ||
      (typeof err.response === "string" && /<!doctype html|<html[\s>]/i.test(err.response));

    if (!htmlApiResponse) throw err;

    console.warn("DispatchTrack public API returned HTML; falling back to legacy NetSuite import API:", {
      publicUrl: err.url,
      legacyImportUrl,
      dispatchIdentifier,
      hasCode: !!code,
      hasApiKey: !!token,
    });

    const legacyServiceOrder = {
      number: trim(dispatchIdentifier),
      customer: {
        first_name: trim(firstName),
      },
    };

    const legacy = await dispatchTrackLegacyImportRequest({
      url: legacyImportUrl,
      code,
      apiKey: token,
      serviceOrder: legacyServiceOrder,
    });

    return {
      ok: true,
      method: "POST",
      mode: "legacy-netSuite-import",
      path: legacyImportUrl,
      request: legacy.request,
      currentDispatch: null,
      response: legacy.data,
      attemptedUpdates: [],
    };
  }
  const dispatch = dispatchTrackDispatchFromResponse(current.data) || {};
  console.log("DispatchTrack show dispatch response:", JSON.stringify({
    path: showPath,
    url: current.url,
    status: current.status,
    contentType: current.contentType,
    dispatch: compactDispatchDebug(dispatch),
    raw: current.data,
  }, null, 2));

  if (!dispatch || typeof dispatch !== "object" || !Object.keys(dispatch).length) {
    const err = new Error("DispatchTrack show dispatch returned no dispatch object");
    err.currentResponse = current.data;
    throw err;
  }

  const contactName = contactNameWithUpdatedFirstName(dispatch.contact_name, firstName);

  const updatePayload = {
    contact_name: contactName,
  };

  if (dispatch.contact_id !== undefined && dispatch.contact_id !== null && dispatch.contact_id !== "") {
    updatePayload.contact_id = dispatch.contact_id;
  }
  if (dispatch.contact_identifier !== undefined && dispatch.contact_identifier !== null && dispatch.contact_identifier !== "") {
    updatePayload.contact_identifier = dispatch.contact_identifier;
  }
  if (dispatch.contact_email) updatePayload.contact_email = dispatch.contact_email;
  if (dispatch.contact_phone) updatePayload.contact_phone = dispatch.contact_phone;
  if (dispatch.contact_address) updatePayload.contact_address = dispatch.contact_address;

  const updateIdentifiers = uniqueDispatchIdentifiers(
    dispatchIdentifier,
    dispatch.identifier,
    dispatch.dispatch_identifier,
    dispatch.dispatch_id,
    dispatch.id,
    dispatch.code,
    dispatch.beecode
  );
  console.log("DispatchTrack update identifier candidates:", updateIdentifiers);

  const failures = [];
  let updated = null;
  let updatePath = "";
  for (const identifier of updateIdentifiers) {
    updatePath = `/api/external/v1/dispatches/${encodeURIComponent(identifier)}`;
    try {
      updated = await dispatchTrackRequest({
        baseUrl,
        token,
        method: "PUT",
        path: updatePath,
        body: updatePayload,
      });
      break;
    } catch (err) {
      failures.push({
        identifier,
        path: updatePath,
        url: err.url,
        status: err.status,
        contentType: err.contentType,
        response: err.response,
      });
      if (![404, 405].includes(Number(err.status))) break;
    }
  }

  if (!updated) {
    const err = new Error("DispatchTrack dispatch customer update failed");
    err.failures = failures;
    err.currentDispatch = dispatch;
    err.request = updatePayload;
    throw err;
  }

  return {
    ok: true,
    method: "PUT",
    path: updatePath,
    request: updatePayload,
    currentDispatch: dispatch,
    response: updated.data,
    attemptedUpdates: failures,
  };
}

router.get("/api/dispatchtrack/debug", async (req, res) => {
  try {
    const locationId = Number(req.query.locationId || 6);
    const date = String(req.query.date || "2026-03-10");
    const fields = await dispatchTrackCredentialSelectFields();

    const db = await pool.query(
      `
      SELECT ${fields.join(", ")}
      FROM public.locations
      WHERE id = $1
      LIMIT 1
      `,
      [locationId]
    );

    const loc = db.rows[0];
    if (!loc) {
      return res.status(404).json({ success: false, error: "Location not found" });
    }

    const credentials = parseDispatchTrackCredentials(loc);
    if (!credentials.token) {
      return res.status(400).json({
        success: false,
        error: "No DispatchTrack credentials found for location",
        credentialColumns: fields.filter((field) => field.startsWith("dispatchtrack_")),
      });
    }

    const url = `${credentials.baseUrl}/api/external/v1/routes?date=${encodeURIComponent(date)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-AUTH-TOKEN": credentials.token,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();

    return res.json({
      success: true,
      account: loc.name,
      testedUrl: url,
      normalizedBaseUrl: credentials.baseUrl,
      credentialColumns: fields.filter((field) => field.startsWith("dispatchtrack_")),
      status: response.status,
      headers: {
        contentType: response.headers.get("content-type"),
      },
      body: text,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// DispatchTrack's UI labels these as service orders/customers, but the public
// API exposes them as dispatches and contacts.
router.patch("/api/dispatchtrack/service-order/customer", async (req, res) => {
  try {
    const { warehouseId, serviceOrderNumber, firstName, salesOrderId, salesOrderTranId } = req.body || {};
    console.log("DispatchTrack customer update request:", {
      warehouseId: trim(warehouseId),
      suppliedServiceOrderNumber: trim(serviceOrderNumber),
      salesOrderId: trim(salesOrderId),
      salesOrderTranId: trim(salesOrderTranId),
      hasFirstName: !!trim(firstName),
    });

    if (!trim(firstName)) {
      console.warn("DispatchTrack customer update skipped: missing firstName");
      return res.status(400).json({ ok: false, error: "Missing firstName" });
    }

    const resolvedDispatch = await resolveDispatchIdentifier({
      salesOrderId,
      salesOrderTranId,
      suppliedIdentifier: serviceOrderNumber,
    });
    console.log("DispatchTrack dispatch identifier resolution:", resolvedDispatch);

    if (!trim(resolvedDispatch.identifier)) {
      console.warn("DispatchTrack customer update skipped: missing dispatch identifier", resolvedDispatch);
      return res.status(202).json({
        ok: true,
        skipped: true,
        reason: "missing-dispatchtrack-service-order-number",
        resolution: resolvedDispatch,
      });
    }

    const credentials = await getWarehouseDispatchTrackCredentials(warehouseId);
    if (!credentials?.token) {
      console.warn("DispatchTrack customer update skipped: missing warehouse credentials", {
        warehouseId: trim(warehouseId),
        foundLocation: !!credentials,
        locationId: credentials?.locationId,
        locationName: credentials?.locationName,
      });
      return res.status(202).json({
        ok: true,
        skipped: true,
        reason: "missing-warehouse-dispatchtrack-credentials",
        warehouseId: trim(warehouseId),
      });
    }
    console.log("DispatchTrack credentials resolved:", {
      warehouseLocationId: credentials.locationId,
      warehouseLocationName: credentials.locationName,
      baseUrl: credentials.baseUrl,
      legacyImportUrl: credentials.legacyImportUrl,
      code: credentials.code,
      hasToken: !!credentials.token,
    });

    const result = await updateDispatchTrackDispatchCustomerFirstName({
      baseUrl: credentials.baseUrl,
      token: credentials.token,
      code: credentials.code,
      legacyImportUrl: credentials.legacyImportUrl,
      dispatchIdentifier: resolvedDispatch.identifier,
      firstName,
    });

    console.log("DispatchTrack customer update succeeded:", {
      dispatchIdentifier: resolvedDispatch.identifier,
      method: result.method,
      mode: result.mode || "public-api",
      path: result.path,
      contactName: result.request?.contact_name,
    });

    res.json({
      ok: true,
      dispatchIdentifier: resolvedDispatch.identifier,
      resolution: resolvedDispatch,
      warehouseLocation: {
        id: credentials.locationId,
        name: credentials.locationName,
      },
      dispatchTrack: result,
    });
  } catch (err) {
    console.error("DispatchTrack customer update failed:", {
      message: err.message,
      url: err.url || null,
      contentType: err.contentType || null,
      failures: err.failures || [],
      request: err.request || null,
      response: err.response || null,
      currentResponse: err.currentResponse || null,
      currentDispatch: err.currentDispatch
        ? {
            id: err.currentDispatch.id,
            dispatch_id: err.currentDispatch.dispatch_id,
            identifier: err.currentDispatch.identifier,
            code: err.currentDispatch.code,
            beecode: err.currentDispatch.beecode,
            contact_name: err.currentDispatch.contact_name,
          }
        : null,
    });
    res.status(502).json({
      ok: false,
      error: err.message || "DispatchTrack customer update failed",
      url: err.url || null,
      contentType: err.contentType || null,
      failures: err.failures || [],
      request: err.request || null,
      response: err.response || null,
      currentDispatch: err.currentDispatch
        ? {
            id: err.currentDispatch.id,
            dispatch_id: err.currentDispatch.dispatch_id,
            identifier: err.currentDispatch.identifier,
            code: err.currentDispatch.code,
            beecode: err.currentDispatch.beecode,
            contact_name: err.currentDispatch.contact_name,
          }
        : null,
    });
  }
});

module.exports = router;
