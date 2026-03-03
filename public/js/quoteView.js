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
   Toast (same pattern as SalesNew / SalesOrderView)
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

/* =========================================================
   Convert spinner overlay
========================================================= */
function showConvertSpinner(show, message = "Converting quote to sales order...") {
  const overlay = document.getElementById("quoteConvertSpinner");
  if (!overlay) return;
  const p = overlay.querySelector("p");
  if (p) p.textContent = message;
  overlay.classList.toggle("hidden", !show);
}

/* =========================================================
   Populate Sales Exec + Store (copied from SalesOrderView pattern)
========================================================= */
async function populateSalesExecAndStore(headers) {
  let currentUser = null;

  // Current user
  try {
    const meRes = await fetch("/api/me", { headers });
    const meData = await meRes.json();
    if (meData.ok && meData.user) currentUser = meData.user;
  } catch (err) {
    console.warn("⚠️ Failed to load current user:", err);
  }

  // Sales execs
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

  // Stores
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
   Summary from table (Quote)
   - Uses Sale Price column as gross total
   - Discount = Amount (rrp gross) - Sale Price (gross)
========================================================= */
function updateQuoteSummaryFromTable() {
  const rows = document.querySelectorAll("#orderItemsBody tr.order-line");
  let grossTotal = 0;
  let discountTotal = 0;

  rows.forEach((row) => {
    const amountEl = row.querySelector(".amount"); // "£123.45"
    const saleEl = row.querySelector(".saleprice");

    if (!saleEl) return;

    const sale = parseFloat(String(saleEl.textContent || "").replace(/[£,]/g, "")) || 0;
    const amount = amountEl
      ? parseFloat(String(amountEl.textContent || "").replace(/[£,]/g, "")) || 0
      : sale;

    grossTotal += sale;

    // keep discount positive
    discountTotal += Math.max(0, amount - sale);

    // if negative sale (returns), preserve old behaviour
    if (sale < 0) discountTotal += Math.abs(sale);
  });

  const netTotal = grossTotal / 1.2;
  const taxTotal = grossTotal - netTotal;

  safeText(document.getElementById("subTotal"), money(netTotal));
  safeText(document.getElementById("discountTotal"), money(discountTotal));
  safeText(document.getElementById("taxTotal"), money(taxTotal));
  safeText(document.getElementById("grandTotal"), money(grossTotal));
}

/* =========================================================
   Convert to Sale action button
   - shown always (or you can conditionally show by status)
   - calls backend endpoint to transform estimate → sales order
   - redirects to /sales/view/{tranId or id}
========================================================= */
function updateActionButtonForQuote(quoteObj) {
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;

  wrapper.innerHTML = "";

  // If you want to hide conversion for already-converted quotes, add condition here.
  // Example (best-effort): if (quoteObj?.status?.refName?.toLowerCase().includes("closed")) return;

  wrapper.innerHTML = `<button id="convertToSaleBtn" class="btn-primary">Convert to Sale</button>`;

  const btn = document.getElementById("convertToSaleBtn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    let savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const quoteIdOrTran = getIdFromPath();
    if (!quoteIdOrTran) return alert("No Quote ID found in URL.");

    // prevent double click
    btn.disabled = true;
    btn.classList.add("locked-input");

    try {
      showConvertSpinner(true, "Converting quote to sales order...");
      showToast?.("⏳ Converting quote...", "success");

      // ✅ IMPORTANT:
      // This endpoint needs to exist server-side.
      // Recommended: /api/netsuite/quote/{id}/convert
      // Return: { ok:true, salesOrderId, tranId }
      const res = await fetch(`/api/netsuite/quote/${encodeURIComponent(quoteIdOrTran)}/convert`, {
        method: "POST",
        headers,
        body: JSON.stringify({}), // keep payload empty for now
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
        // fallback: if server only returns a link
        if (data.redirectUrl) return (window.location.href = data.redirectUrl);
        window.location.href = "/sales";
      }, 800);
    } catch (err) {
      console.error("❌ Convert error:", err.message || err);
      showToast?.(`❌ ${err.message || err}`, "error");
      btn.disabled = false;
      btn.classList.remove("locked-input");
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

  // ---- Auth / token ----
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

  // dropdowns (even though disabled, they need options for correct selected display)
  populateSalesExecAndStore(headers);

  // ---- Quote ID from URL ----
  const tranId = getIdFromPath();
  if (!tranId) {
    alert("No Quote ID found in URL.");
    overlay?.classList.add("hidden");
    return;
  }

  try {
    // 1) Load quote
    const qRes = await fetch(`/api/netsuite/quote/${encodeURIComponent(tranId)}`, { headers });
    const qJson = await qRes.json();

    if (!qRes.ok || !qJson || qJson.ok === false) {
      throw new Error(qJson?.error || `Server returned ${qRes.status}`);
    }

    // Your backend can return {quote:{...}} or {estimate:{...}} or direct object
    const quote = qJson.quote || qJson.estimate || qJson.estimateObj || qJson;
    if (!quote) throw new Error("No quote/estimate object in response");

    console.log("✅ Quote loaded:", quote.tranId || tranId);

    // 2) Header
    safeText(document.getElementById("ordernumber"), quote.tranId || tranId);
    safeText(document.getElementById("orderNumber"), quote.tranId || tranId);

    // 3) Customer / address (best-effort like SalesOrderView)
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
          // ignore country line (optional)
        } else {
          cleanedAddress.push(line);
        }
      }

      const fullName = quote.entity?.refName || quote.customer?.refName || "";
      const nameParts = fullName.split(" ").filter(Boolean);

      const firstName = nameParts[1] || quote.firstName || "";
      const lastName = nameParts[2] || quote.lastName || "";

      document.querySelector('input[name="firstName"]').value = firstName;
      document.querySelector('input[name="lastName"]').value = lastName;

      document.querySelector('input[name="address1"]').value = cleanedAddress[0] || "";
      document.querySelector('input[name="address2"]').value = cleanedAddress[1] || "";
      document.querySelector('input[name="address3"]').value = cleanedAddress[2] || "";
      document.querySelector('input[name="postcode"]').value = postcode || "";
    } catch (err) {
      console.warn("⚠️ Address population failed:", err.message || err);
    }

    // 4) Contact info
    document.querySelector('input[name="email"]').value = quote.email || "";
    document.querySelector('input[name="contactNumber"]').value = quote.custbody4 || quote.phone || "";
    document.querySelector('input[name="altContactNumber"]').value = quote.altPhone || "";

    // 5) Order meta
    try {
      // lead source
      document.querySelector('select[name="leadSource"]').value = quote.leadSource?.id || "";

      // paymentInfo OPTIONAL on quote - still display if present
      const paymentInfo = quote.custbody_sb_paymentinfo?.id || "";
      const paymentSelect = document.getElementById("paymentInfo");
      if (paymentSelect) paymentSelect.value = paymentInfo;

      // warehouse
      const wh = quote.custbody_sb_warehouse?.id || "";
      const whSelect = document.getElementById("warehouse");
      if (whSelect) whSelect.value = wh;
    } catch (err) {
      console.warn("⚠️ Quote meta population failed:", err.message || err);
    }

    // 6) Render item lines
    const tbody = document.getElementById("orderItemsBody");
    tbody.innerHTML = "";

    const lines = quote.item?.items || quote.items || quote.lines || [];
    if (Array.isArray(lines) && lines.length) {
      const frag = document.createDocumentFragment();

      lines.forEach((line, idx) => {
        const tr = document.createElement("tr");
        tr.classList.add("order-line");
        tr.dataset.line = idx;

        const quantity = Number(line.quantity || 0);

        // Many NS estimate payloads store net amount; saleprice may be custom.
        // We'll follow your SalesOrderView convention:
        const retailNet = Number(line.amount || 0); // per-unit net or line net depends on your backend
        const grossRrp = retailNet * quantity || 0;

        let sale = Number(line.saleprice || line.gross || line.rate_gross || 0);
        if (!sale && line.rate && quantity) {
          // fallback: if rate is net per unit
          sale = Number(line.rate || 0) * quantity * 1.2;
        }

        // best-effort VAT
        const vat = line.vat ?? (sale ? sale - sale / 1.2 : grossRrp * 0.2);

        const discountPct = (() => {
          const r = grossRrp || 0;
          const s = sale || 0;
          if (r <= 0) return 0;
          return Math.max(0, ((r - s) / r) * 100);
        })();

        // Options display field
        const opts = line.custcol_sb_itemoptionsdisplay || line.optionsDisplay || "";

        // 60NT (if your backend puts it on the line, add it; otherwise blank)
        const trial =
          line.custcol_sb_60nighttrial ||
          line.sixtyNightTrial ||
          line.trialOption ||
          "N/A";

        tr.innerHTML = `
          <td>${line.item?.refName || line.itemName || "—"}</td>
          <td>${opts || ""}</td>
          <td class="qty">${quantity}</td>
          <td class="amount">${money(grossRrp)}</td>
          <td class="discount">${discountPct.toFixed(1)}%</td>
          <td class="vat">${money(Number(vat || 0))}</td>
          <td class="saleprice">${money(sale || 0)}</td>
          <td class="sixty-night-cell" style="display:none;">${trial}</td>
          <td><span style="opacity:.4;">—</span></td>
        `;

        frag.appendChild(tr);
      });

      tbody.appendChild(frag);

      // Show 60NT header if any line looks like a mattress OR has trial != N/A
      const header60 = document.getElementById("60ntheader");
      if (header60) {
        const anyTrial = [...tbody.querySelectorAll("td.sixty-night-cell")].some(
          (td) => String(td.textContent || "").trim().toUpperCase() !== "N/A"
        );
        header60.style.display = anyTrial ? "table-cell" : "none";
        tbody.querySelectorAll("td.sixty-night-cell").forEach((td) => {
          td.style.display = anyTrial ? "table-cell" : "none";
        });
      }
    } else {
      const empty = document.createElement("tr");
      empty.innerHTML = `<td colspan="10" style="text-align:center; color:#888;">No item lines found.</td>`;
      tbody.appendChild(empty);
    }

    // 7) Summary + Convert button
    updateQuoteSummaryFromTable();
    updateActionButtonForQuote(quote);

    // 8) Back + Print
    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    document.getElementById("printBtn")?.addEventListener("click", () => {
      const id = getIdFromPath();
      if (!id) return alert("No quote ID found in URL");
      // Update if your receipt route differs for quotes:
      window.open(`/quote/reciept/${id}`, "_blank");
    });
  } catch (err) {
    console.error("❌ Quote load failure:", err.message || err);
    alert("Failed to load Quote details. " + (err.message || err));
  } finally {
    overlay?.classList.add("hidden");
  }
});