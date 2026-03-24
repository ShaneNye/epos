// public/js/quoteView.js

console.log("✅ quoteView.js loaded");

// Lightweight global crash sniffers
window.addEventListener("error", (e) =>
  console.error("💥 Uncaught error:", e.error || e.message)
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("💥 Unhandled Promise rejection:", e.reason)
);

/* =========================================================
   Toast
========================================================= */
(function () {
  const toast = document.getElementById("orderToast");
  if (!toast) return;

  window.showToast = function (message, type = "success") {
    toast.textContent = message;
    toast.className = `order-toast ${type}`;
    toast.classList.remove("hidden");
    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 300);
    }, 3000);
  };
})();

/* =========================================================
   Helpers
========================================================= */
function getIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

function money(n) {
  const v = Number(n || 0);
  return `£${v.toFixed(2)}`;
}

function safeText(el, text) {
  if (el) el.textContent = text ?? "";
}

function parseMoneyInput(val) {
  return parseFloat(String(val || "0").replace(/[£,]/g, "")) || 0;
}

/* =========================================================
   Convert / Save spinner overlay
========================================================= */
function showConvertSpinner(show, message = "Working...") {
  const overlay = document.getElementById("quoteConvertSpinner");
  if (!overlay) return;
  const p = overlay.querySelector("p");
  if (p) p.textContent = message;
  overlay.classList.toggle("hidden", !show);
}

/* =========================================================
   Populate Sales Exec + Store
========================================================= */
async function populateSalesExecAndStore(headers) {
  let currentUser = null;

  try {
    const meRes = await fetch("/api/me", { headers });
    const meData = await meRes.json();
    if (meData.ok && meData.user) currentUser = meData.user;
  } catch (err) {
    console.warn("⚠️ Failed to load current user:", err);
  }

  try {
    const res = await fetch("/api/users", { headers });
    const data = await res.json();
    if (data.ok) {
      const execSelect = document.getElementById("salesExec");
      if (execSelect) {
        execSelect.innerHTML = '<option value="">Select Sales Executive</option>';

        const salesExecs = (data.users || []).filter(
          (u) => Array.isArray(u.roles) && u.roles.some((r) => r.name === "Sales Executive")
        );

        salesExecs.forEach((u) => {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = `${u.firstName} ${u.lastName}`;
          execSelect.appendChild(opt);
        });

        if (currentUser && salesExecs.some((u) => u.id === currentUser.id)) {
          execSelect.value = currentUser.id;
        }
      }
    }
  } catch (err) {
    console.error("❌ Failed to load sales executives:", err);
  }

  try {
    const res = await fetch("/api/meta/locations", { headers });
    const data = await res.json();

    if (data.ok) {
      const storeSelect = document.getElementById("store");
      if (storeSelect) {
        storeSelect.innerHTML = '<option value="">Select Store</option>';

        const filteredLocations = (data.locations || []).filter(
          (loc) => !/warehouse/i.test(loc.name)
        );

        filteredLocations.forEach((loc) => {
          const opt = document.createElement("option");
          opt.value = String(loc.id);
          opt.textContent = loc.name;
          storeSelect.appendChild(opt);
        });

        if (currentUser && currentUser.primaryStore) {
          const match = filteredLocations.find(
            (l) =>
              String(l.id) === String(currentUser.primaryStore) ||
              l.name === currentUser.primaryStore
          );
          if (match) storeSelect.value = String(match.id);
        }
      }
    }
  } catch (err) {
    console.error("❌ Failed to load stores:", err);
  }
}

/* =========================================================
   Summary from editable table
========================================================= */
function updateQuoteSummaryFromTable() {
  const rows = document.querySelectorAll("#orderItemsBody tr.order-line");
  let grossTotal = 0;
  let discountTotal = 0;

  rows.forEach((row) => {
    const hasItem =
      row.dataset.hasItem === "1" ||
      row.querySelector(".item-internal-id")?.value?.trim();

    if (!hasItem) return;

    const amountInput = row.querySelector(".item-amount");
    const saleInput = row.querySelector(".item-saleprice");

    const amount = parseMoneyInput(amountInput?.value);
    const sale = parseMoneyInput(saleInput?.value);

    grossTotal += sale;
    discountTotal += Math.max(0, amount - sale);

    if (sale < 0) discountTotal += Math.abs(sale);
  });

  const netTotal = grossTotal / 1.2;
  const taxTotal = grossTotal - netTotal;

  safeText(document.getElementById("subTotal"), money(netTotal));
  safeText(document.getElementById("discountTotal"), money(discountTotal));
  safeText(document.getElementById("taxTotal"), money(taxTotal));
  safeText(document.getElementById("grandTotal"), money(grossTotal));
}

window.updateQuoteSummary = updateQuoteSummaryFromTable;

/* =========================================================
   Editable quote line helpers
========================================================= */
function buildOptionsSummaryHtml(optionsText = "") {
  const clean = String(optionsText || "").trim();
  if (!clean) return "";
  if (clean.includes("<br")) return clean;

  return clean
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("<br>");
}

function guessOptionsJsonFromDisplay(optionsText = "") {
  const out = {};
  const raw = String(optionsText || "").trim();
  if (!raw) return out;

  raw.split(/\r?\n|<br\s*\/?>/i).forEach((part) => {
    const clean = String(part).replace(/<[^>]+>/g, "").trim();
    if (!clean.includes(":")) return;

    const [field, ...rest] = clean.split(":");
    const value = rest.join(":").trim();
    if (!field.trim() || !value) return;

    const vals = value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    out[field.trim()] = vals.length > 1 ? vals : value;
  });

  return out;
}

function buildOptionSchemaForItem(itemId) {
  const itemData = (window.items || []).find((it) => {
    const internalId =
      it["Internal ID"] ??
      it["InternalId"] ??
      it["InternalID"] ??
      it["internalid"] ??
      it["internal id"] ??
      it["Id"] ??
      it["id"] ??
      "";
    return String(internalId) === String(itemId);
  });

  if (!itemData) return {};

  const opts = {};
  Object.entries(itemData).forEach(([key, val]) => {
    if (!String(key).toLowerCase().startsWith("option :")) return;

    const fieldName = String(key).replace(/^option\s*:\s*/i, "").trim();
    const values = String(val || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (fieldName && values.length) {
      opts[fieldName] = values;
    }
  });

  return opts;
}

function collectEditableQuoteLines() {
  return [...document.querySelectorAll("#orderItemsBody tr.order-line")]
    .map((row) => {
      const itemId = row.querySelector(".item-internal-id")?.value?.trim() || "";
      const itemName = row.querySelector(".item-search")?.value?.trim() || "";
      const quantity = parseFloat(row.querySelector(".item-qty")?.value || "0") || 0;
      const amount = parseMoneyInput(row.querySelector(".item-amount")?.value);
      const saleprice = parseMoneyInput(row.querySelector(".item-saleprice")?.value);
      const discount = parseFloat(row.querySelector(".item-discount")?.value || "0") || 0;
      const optionsText =
        row.querySelector(".options-summary")?.innerHTML?.trim().replace(/<br\s*\/?>/gi, "\n") || "";
      const optionsJson = row.querySelector(".item-options-json")?.value || "{}";
      const trialOption = row.querySelector(".sixty-night-select")?.value || "N/A";

      return {
        lineId: row.dataset.lineid || "",
        item: itemId,
        itemName,
        quantity,
        amount,
        saleprice,
        discount,
        options: optionsText,
        optionsJson,
        trialOption,
        isNewLine: !row.dataset.lineid,
      };
    })
    .filter((r) => r.item && r.quantity > 0);
}

window.collectEditableQuoteLines = collectEditableQuoteLines;

function wireEditableQuoteRow(tr, line, idx) {
  const itemId = String(line.item?.id || "");
  const itemName = line.item?.refName || line.itemName || "—";
  const quantity = Number(line.quantity || 1);

  const grossRrp = Number(line.amount || 0);
  const sale = Number(line.saleprice || 0);
  const vat = Number(line.vat || 0);

  const retailGrossPerUnit =
    quantity > 0 && grossRrp > 0 ? grossRrp / quantity : 0;

  const discountPct =
    grossRrp > 0 ? Math.max(0, ((grossRrp - sale) / grossRrp) * 100) : 0;

  const optsText = line.custcol_sb_itemoptionsdisplay || line.optionsDisplay || "";
  const optsHtml = buildOptionsSummaryHtml(optsText);
  const existingSelections = guessOptionsJsonFromDisplay(optsText);
  const optionSchema = buildOptionSchemaForItem(itemId);

  if (itemId && Object.keys(optionSchema).length) {
    window.optionsCache[itemId] = optionSchema;
  }

  const itemData = (window.items || []).find((it) => {
    const internalId =
      it["Internal ID"] ??
      it["InternalId"] ??
      it["InternalID"] ??
      it["internalid"] ??
      it["internal id"] ??
      it["Id"] ??
      it["id"] ??
      "";
    return String(internalId) === String(itemId);
  });

  const className = String(itemData?.["Class"] || "").toLowerCase();

  const hasExistingOptions =
    !!optsHtml ||
    (existingSelections && Object.keys(existingSelections).length > 0);

  const canEditOptions =
    Object.keys(optionSchema).length > 0 || hasExistingOptions;

  tr.className = "order-line";
  tr.dataset.line = idx;
  tr.dataset.lineid = line.lineId || "";
  tr.dataset.itemId = itemId;
  tr.dataset.hasItem = itemId ? "1" : "0";
  tr.dataset.itemClass = className;

  tr.innerHTML = `
    <td>
      <div class="autocomplete">
        <input
          type="text"
          id="itemSearch-${idx}"
          class="item-search"
          value="${String(itemName).replace(/"/g, "&quot;")}"
          placeholder="Product name"
          autocomplete="off"
          aria-autocomplete="list"
        />
        <input type="hidden" class="item-internal-id" value="${itemId}" />
        <input type="hidden" class="item-baseprice" value="${retailGrossPerUnit.toFixed(2)}" />
      </div>
    </td>

    <td class="options-cell">
      ${
        canEditOptions
          ? `
        <button type="button" class="open-options btn-secondary small-btn">⚙️ Options</button>
        <input
          type="hidden"
          class="item-options-json"
          value='${JSON.stringify(existingSelections).replace(/'/g, "&apos;")}'
        />
        <div class="options-summary">${optsHtml}</div>
      `
          : `
        <input
          type="hidden"
          class="item-options-json"
          value='${JSON.stringify(existingSelections).replace(/'/g, "&apos;")}'
        />
        <div class="options-summary">${optsHtml}</div>
      `
      }
    </td>

    <td>
      <input type="number" class="item-qty" value="${quantity}" min="1" step="1" />
    </td>

    <td>
      <input
        type="number"
        class="item-amount"
        value="${Number(grossRrp || 0).toFixed(2)}"
        step="0.01"
        readonly
      />
    </td>

    <td>
      <input
        type="number"
        class="item-discount"
        value="${Number(discountPct || 0).toFixed(1)}"
        min="0"
        max="100"
        step="0.1"
      />
    </td>

    <td>
      <input
        type="number"
        class="item-vat"
        value="${Number(vat || 0).toFixed(2)}"
        step="0.01"
        readonly
      />
    </td>

    <td>
      <input
        type="number"
        class="item-saleprice"
        value="${Number(sale || 0).toFixed(2)}"
        step="0.01"
      />
    </td>

    <td class="sixty-night-cell" style="display:none;"></td>

    <td>
      <button type="button" class="delete-row btn-secondary small-btn">🗑</button>
    </td>
  `;

  const amountField = tr.querySelector(".item-amount");
  if (amountField) {
    amountField.dataset.unitRetail = retailGrossPerUnit.toFixed(2);
  }

  if (typeof window.setupAutocompleteForRow === "function") {
    window.setupAutocompleteForRow(tr);
  }

  if (typeof window.setupPriceSync === "function") {
    window.setupPriceSync(tr);
  }

  if (typeof window.ensure60NightTrialCell === "function") {
    window.ensure60NightTrialCell(tr);
  }

  if (typeof window.update60NightTrialColumnVisibility === "function") {
    window.update60NightTrialColumnVisibility();
  }

  const recalcVat = () => {
    const saleVal = parseMoneyInput(tr.querySelector(".item-saleprice")?.value);
    const vatField = tr.querySelector(".item-vat");
    if (vatField) vatField.value = (saleVal - saleVal / 1.2).toFixed(2);
  };

  tr.querySelector(".item-qty")?.addEventListener("input", () => {
    recalcVat();
    updateQuoteSummaryFromTable();
  });

  tr.querySelector(".item-discount")?.addEventListener("input", () => {
    recalcVat();
    updateQuoteSummaryFromTable();
  });

  tr.querySelector(".item-saleprice")?.addEventListener("input", () => {
    recalcVat();
    updateQuoteSummaryFromTable();
  });
}

function ensureQuoteAddButton() {
  let btn = document.getElementById("addItemBtn");

  if (!btn) {
    const wrapper =
      document.getElementById("quoteItemsToolbar") ||
      document.getElementById("orderItemsToolbar") ||
      document.getElementById("orderActionWrapper");

    if (!wrapper) return;

    btn = document.createElement("button");
    btn.id = "addItemBtn";
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = "+ Add Item";

    wrapper.prepend(btn);
  }

  if (btn.dataset.bound !== "1") {
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      if (typeof window.addNewRow === "function") {
        window.addNewRow();
      } else {
        console.warn("⚠️ addNewRow is not available on window");
      }
    });
  }
}

function bindQuoteItemTableEvents() {
  const tbody = document.getElementById("orderItemsBody");
  if (!tbody || tbody.dataset.bound === "1") return;

  tbody.dataset.bound = "1";

  tbody.addEventListener("click", (e) => {
    const optionsBtn = e.target.closest(".open-options");
    if (optionsBtn) {
      const row = optionsBtn.closest(".order-line");
      console.log("⚙️ Options clicked", { rowLine: row?.dataset?.line });
      if (row && typeof window.openOptionsWindow === "function") {
        window.openOptionsWindow(row);
      } else {
        console.warn("⚠️ openOptionsWindow not available or row missing");
      }
      return;
    }

    const deleteBtn = e.target.closest(".delete-row");
    if (deleteBtn) {
      const row = deleteBtn.closest(".order-line");
      console.log("🗑 Delete clicked", { rowLine: row?.dataset?.line });

      if (row) {
        row.remove();

        if (typeof window.update60NightTrialColumnVisibility === "function") {
          window.update60NightTrialColumnVisibility();
        }

        updateQuoteSummaryFromTable();

        if (typeof window.ensureNextEmptyRowAndFocus === "function") {
          window.ensureNextEmptyRowAndFocus();
        }
      }
    }
  });
}

/* =========================================================
   Quote action buttons
========================================================= */
function updateActionButtonForQuote() {
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;

  wrapper.innerHTML = `
    <button id="saveQuoteBtn" class="btn-secondary">Save Quote</button>
    <button id="convertToSaleBtn" class="btn-primary">Convert to Sale</button>
  `;

  const saveBtn = document.getElementById("saveQuoteBtn");
  const convertBtn = document.getElementById("convertToSaleBtn");

  saveBtn?.addEventListener("click", async () => {
    let savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const quoteIdOrTran = getIdFromPath();
    if (!quoteIdOrTran) return alert("No Quote ID found in URL.");

    saveBtn.disabled = true;
    if (convertBtn) convertBtn.disabled = true;
    saveBtn.classList.add("locked-input");
    convertBtn?.classList.add("locked-input");

    try {
      showConvertSpinner(true, "Saving quote...");
      showToast?.("⏳ Saving quote...", "success");

      const payload = {
        customer: {
          title: document.querySelector('select[name="title"]')?.value || "",
          firstName: document.querySelector('input[name="firstName"]')?.value?.trim() || "",
          lastName: document.querySelector('input[name="lastName"]')?.value?.trim() || "",
          email: document.querySelector('input[name="email"]')?.value?.trim() || "",
          contactNumber:
            document.querySelector('input[name="contactNumber"]')?.value?.trim() || "",
          altContactNumber:
            document.querySelector('input[name="altContactNumber"]')?.value?.trim() || "",
          address1: document.querySelector('input[name="address1"]')?.value?.trim() || "",
          address2: document.querySelector('input[name="address2"]')?.value?.trim() || "",
          address3: document.querySelector('input[name="address3"]')?.value?.trim() || "",
          postcode: document.querySelector('input[name="postcode"]')?.value?.trim() || "",
        },
        order: {
          salesExec: document.getElementById("salesExec")?.value || "",
          store: document.getElementById("store")?.value || "",
          leadSource: document.querySelector('select[name="leadSource"]')?.value || "",
          paymentInfo: document.getElementById("paymentInfo")?.value || "",
          warehouse: document.getElementById("warehouse")?.value || "",
        },
        items:
          typeof window.collectEditableQuoteLines === "function"
            ? window.collectEditableQuoteLines()
            : [],
      };

      const res = await fetch(`/api/netsuite/quote/${encodeURIComponent(quoteIdOrTran)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      }

      showToast?.("✅ Quote saved successfully!", "success");
    } catch (err) {
      console.error("❌ Save quote error:", err.message || err);
      showToast?.(`❌ ${err.message || err}`, "error");
    } finally {
      showConvertSpinner(false);
      saveBtn.disabled = false;
      if (convertBtn) convertBtn.disabled = false;
      saveBtn.classList.remove("locked-input");
      convertBtn?.classList.remove("locked-input");
    }
  });

  convertBtn?.addEventListener("click", async () => {
    let savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const quoteIdOrTran = getIdFromPath();
    if (!quoteIdOrTran) return alert("No Quote ID found in URL.");

    convertBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    convertBtn.classList.add("locked-input");
    saveBtn?.classList.add("locked-input");

    try {
      showConvertSpinner(true, "Converting quote to sales order...");
      showToast?.("⏳ Converting quote...", "success");

      const res = await fetch(`/api/netsuite/quote/${encodeURIComponent(quoteIdOrTran)}/convert`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `Convert failed (HTTP ${res.status})`);
      }

      const soTranId = data.tranId || data.salesOrderTranId || null;
      const soId = data.salesOrderId || data.id || null;

      showToast?.("✅ Converted to Sales Order! Redirecting...", "success");

      setTimeout(() => {
        if (soTranId) return (window.location.href = `/sales/view/${soTranId}`);
        if (soId) return (window.location.href = `/sales/view/${soId}`);
        if (data.redirectUrl) return (window.location.href = data.redirectUrl);
        window.location.href = "/sales";
      }, 800);
    } catch (err) {
      console.error("❌ Convert error:", err.message || err);
      showToast?.(`❌ ${err.message || err}`, "error");
      convertBtn.disabled = false;
      if (saveBtn) saveBtn.disabled = false;
      convertBtn.classList.remove("locked-input");
      saveBtn?.classList.remove("locked-input");
    } finally {
      showConvertSpinner(false);
    }
  });
}

/* =========================================================
   Main Quote View Loader
========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("💡 QuoteView init");

  const overlay = document.getElementById("loadingOverlay");
  overlay?.classList.remove("hidden");

  let saved = storageGet?.();
  if (!saved || !saved.token) {
    await new Promise((r) => setTimeout(r, 300));
    saved = storageGet?.();
  }

  if (!saved || !saved.token) {
    console.error("🚫 No auth token – redirecting to login");
    return (window.location.href = "/index.html");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${saved.token}`,
  };

  populateSalesExecAndStore(headers);

  const tranId = getIdFromPath();
  if (!tranId) {
    alert("No Quote ID found in URL.");
    overlay?.classList.add("hidden");
    return;
  }

  try {
    if (typeof window.loadItems === "function") {
      await window.loadItems();
    }

    if (
      typeof window.createGlobalSuggestions === "function" &&
      !document.getElementById("global-suggestions")
    ) {
      window.createGlobalSuggestions();
    }

    if (typeof window.populateSizeFilter === "function") await window.populateSizeFilter();
    if (typeof window.populateBaseOptionFilter === "function") await window.populateBaseOptionFilter();

    const qRes = await fetch(`/api/netsuite/quote/${encodeURIComponent(tranId)}`, { headers });
    const qJson = await qRes.json();

    if (!qRes.ok || !qJson || qJson.ok === false) {
      throw new Error(qJson?.error || `Server returned ${qRes.status}`);
    }

    const quote = qJson.quote || qJson.estimate || qJson.estimateObj || qJson;
    if (!quote) throw new Error("No quote/estimate object in response");

    console.log("✅ Quote loaded:", quote.tranId || tranId);

    safeText(document.getElementById("ordernumber"), quote.tranId || tranId);
    safeText(document.getElementById("orderNumber"), quote.tranId || tranId);

    try {
      const addressText = quote.billingAddress_text || quote.billaddress || "";
      const addressLines = addressText
        ? String(addressText).split("\n").map((l) => l.trim()).filter(Boolean)
        : [];

      const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
      let postcode = "";
      const cleanedAddress = [];

      for (const line of addressLines) {
        if (postcodeRegex.test(line)) {
          const match = line.match(postcodeRegex);
          if (match) postcode = match[0].toUpperCase();
          const townPart = line.replace(postcode, "").trim();
          if (townPart) cleanedAddress.push(townPart);
        } else if (/(United Kingdom|UK|England|Scotland|Wales|Northern Ireland)/i.test(line)) {
          // ignore country
        } else {
          cleanedAddress.push(line);
        }
      }

      const fullName = quote.entity?.refName || quote.customer?.refName || "";
      const nameParts = fullName.split(" ").filter(Boolean);

      const firstName = nameParts[1] || quote.firstName || "";
      const lastName = nameParts[2] || quote.lastName || "";

      const firstNameEl = document.querySelector('input[name="firstName"]');
      const lastNameEl = document.querySelector('input[name="lastName"]');
      const address1El = document.querySelector('input[name="address1"]');
      const address2El = document.querySelector('input[name="address2"]');
      const address3El = document.querySelector('input[name="address3"]');
      const postcodeEl = document.querySelector('input[name="postcode"]');

      if (firstNameEl) firstNameEl.value = firstName;
      if (lastNameEl) lastNameEl.value = lastName;
      if (address1El) address1El.value = cleanedAddress[0] || "";
      if (address2El) address2El.value = cleanedAddress[1] || "";
      if (address3El) address3El.value = cleanedAddress[2] || "";
      if (postcodeEl) postcodeEl.value = postcode || "";
    } catch (err) {
      console.warn("⚠️ Address population failed:", err.message || err);
    }

    const emailEl = document.querySelector('input[name="email"]');
    const contactEl = document.querySelector('input[name="contactNumber"]');
    const altContactEl = document.querySelector('input[name="altContactNumber"]');

    if (emailEl) emailEl.value = quote.email || "";
    if (contactEl) contactEl.value = quote.custbody4 || quote.phone || "";
    if (altContactEl) altContactEl.value = quote.altPhone || "";

    try {
      const leadSourceEl = document.querySelector('select[name="leadSource"]');
      const paymentSelect = document.getElementById("paymentInfo");
      const whSelect = document.getElementById("warehouse");

      if (leadSourceEl) leadSourceEl.value = quote.leadSource?.id || "";

      const paymentInfo = quote.custbody_sb_paymentinfo?.id || "";
      if (paymentSelect) paymentSelect.value = paymentInfo;

      const wh = quote.custbody_sb_warehouse?.id || "";
      if (whSelect) whSelect.value = wh;
    } catch (err) {
      console.warn("⚠️ Quote meta population failed:", err.message || err);
    }

    const storeEl = document.getElementById("store");
if (storeEl) {
  storeEl.disabled = true;
  storeEl.classList.add("locked-input");
}

    const tbody = document.getElementById("orderItemsBody");
    tbody.innerHTML = "";

    const lines = quote.item?.items || quote.items || quote.lines || [];

    if (Array.isArray(lines) && lines.length) {
      const frag = document.createDocumentFragment();

      lines.forEach((line, idx) => {
        const tr = document.createElement("tr");
        wireEditableQuoteRow(tr, line, idx);
        frag.appendChild(tr);
      });

      tbody.appendChild(frag);
    } else if (typeof window.addNewRow === "function") {
      window.addNewRow();
    } else {
      const empty = document.createElement("tr");
      empty.innerHTML = `<td colspan="10" style="text-align:center; color:#888;">No item lines found.</td>`;
      tbody.appendChild(empty);
    }

    bindQuoteItemTableEvents();
    ensureQuoteAddButton();

    if (typeof window.update60NightTrialColumnVisibility === "function") {
      window.update60NightTrialColumnVisibility();
    }

    if (typeof window.ensureNextEmptyRowAndFocus === "function") {
      const hasEmpty = [...document.querySelectorAll("#orderItemsBody .order-line")].some(
        (r) => (r.dataset.hasItem || "0") !== "1"
      );
      if (!hasEmpty && typeof window.addNewRow === "function") window.addNewRow();
    }

    updateQuoteSummaryFromTable();
    updateActionButtonForQuote();
    ensureQuoteAddButton();

    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    document.getElementById("printBtn")?.addEventListener("click", () => {
      const id = getIdFromPath();
      if (!id) return alert("No quote ID found in URL");
      window.open(`/quote/reciept/${id}`, "_blank");
    });
  } catch (err) {
    console.error("❌ Quote load failure:", err.message || err);
    alert("Failed to load Quote details. " + (err.message || err));
  } finally {
    overlay?.classList.add("hidden");
  }
});