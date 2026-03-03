// public/js/quoteReceipt.js
// Based on salesOrdReceipt.js, but loads an Estimate/Quote and maps to Quote receipt HTML IDs.

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🧾 Quote Receipt init");

  /* ============================
     1️⃣ Extract Quote ID
     ============================ */
  const parts = window.location.pathname.split("/").filter(Boolean);
  const quoteId = parts[parts.length - 1];

  if (!quoteId) {
    console.error("❌ No Quote ID in URL");
    return;
  }

  console.log("📌 Quote ID:", quoteId);

  /* ============================
     2️⃣ Load auth token
     ============================ */
  const saved = storageGet?.();

  if (!saved || !saved.token) {
    console.error("🚫 No auth token found");
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${saved.token}`,
  };

  console.log("🔐 Using auth token");
  console.log("Waiting for Netsuite Response");

  // Small helper
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = value === null || value === undefined ? "" : String(value);
    el.textContent = v.trim() ? v : "-";
  };

  const fmtDateDDMMYYYY = (raw) => {
    if (!raw) return "-";
    // Supports "YYYY-MM-DD" (NetSuite) or ISO
    const s = String(raw).slice(0, 10);
    const [y, m, d] = s.split("-");
    if (!y || !m || !d) return raw;
    return `${d}/${m}/${y}`;
  };

  /* ============================
     3️⃣ Fetch Quote / Estimate
     ============================ */
  try {
    // ✅ You need this endpoint (or adjust URL to your actual quote-get route):
    // GET /api/netsuite/quote/:id   -> { ok:true, quote:{...} } or { ok:true, estimate:{...} }
    const res = await fetch(
      `/api/netsuite/quote/${encodeURIComponent(quoteId)}`,
      { headers }
    );

    console.log("🌐 Fetch response status:", res.status);

    const data = await res.json();
    console.log("📦 Quote payload:", data);

    if (!res.ok || data.ok === false) {
      console.error("❌ Quote fetch failed:", data.error || res.status);
      return;
    }

    // Support multiple backend shapes
    const q = data.quote || data.estimate || data.estimateObj || data.salesOrder || data;
    if (!q) {
      console.error("❌ quote/estimate object missing from response");
      return;
    }

    /* ============================
       4️⃣ Resolve STORE from Quote
       ============================ */
    const storeNsId =
      q.custbody_sb_primarystore?.id ||
      q.subsidiary?.id ||
      q.location?.id ||
      null;

    console.log("🏬 Store NS ID resolved from Quote:", storeNsId);

    // Fetch locations and match store
    try {
      const locRes = await fetch("/api/meta/locations", { headers }).catch(() =>
        fetch("/api/meta/locations")
      );
      const locJson = await locRes.json();

      if (locRes.ok && locJson.ok && Array.isArray(locJson.locations)) {
        const locations = locJson.locations;

        const match =
          locations.find(
            (l) => String(l.netsuite_internal_id || "") === String(storeNsId || "")
          ) ||
          locations.find(
            (l) => String(l.invoice_location_id || "") === String(storeNsId || "")
          ) ||
          null;

        if (!match) {
          console.warn("⚠️ No matching location found for storeNsId:", storeNsId);
        } else {
          console.log("✅ Matched store record:", match);

          // Populate receipt header
          setText("storeName", match.name);
          setText("storeTel", match.location_phone_number);
          setText("storeEmail", match.location_email || match.email);

          setText("storeVatNo", match.vat_number);
          setText("storeCompanyNo", match.company_number);

          setText("storeAdd1", match.address_line_1);
          setText("storeAdd2", match.address_line_2);
          setText("storePostcode", match.postcode);
        }
      } else {
        console.warn("⚠️ /api/meta/locations returned unexpected payload:", locJson);
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch/match store location:", err.message || err);
    }

    /* ============================
       5️⃣ Customer / Quote details
       ============================ */
    const customerName = q.entity?.refName || q.customer?.refName || "";

    // Prefer shipping address text; fallback to billing
    const addrText = q.shippingAddress_text || q.billingAddress_text || "";
    const addressLines = String(addrText || "").split("\n").map((l) => l.trim());

    // NOTE: Your SO receipt uses indexes [1..4]. Keep same to match what you already expect.
    const customerAddressLine1 = addressLines[1] || "";
    const customerAddressLine2 = addressLines[2] || "";
    const customerAddressLine3 = addressLines[3] || "";
    const customerPostcode = addressLines[4] || "";

    const customerEmail = q.email || "";
    const customerTel = q.custbody4 || q.phone || "";
    const quoteNo = q.tranId || quoteId;

    const quoteDate = fmtDateDDMMYYYY(q.tranDate || q.trandate || q.createdDate || "");

    const paymentMethod = q.custbody_sb_paymentinfo?.refName || ""; // optional for quote
    const salesRep = q.custbody_sb_bedspecialist?.refName || "";

    // CUSTOMER DETAILS
    document.getElementById("customerName").innerHTML = customerName || "-";
    document.getElementById("custadd1").innerHTML = customerAddressLine1 || "-";
    document.getElementById("custadd2").innerHTML = customerAddressLine2 || "";
    document.getElementById("custadd3").innerHTML = customerAddressLine3 || "";
    document.getElementById("custzip").innerHTML = customerPostcode || "-";
    document.getElementById("custEmail").innerHTML = customerEmail || "-";
    document.getElementById("custTel").innerHTML = customerTel || "-";

    // QUOTE DETAILS (IDs differ from sales receipt)
    document.getElementById("quoteNo").innerHTML = quoteNo || "-";
    document.getElementById("quoteDate").innerHTML = quoteDate || "-";

    const formPaymentMethod = document.getElementById("pymtMthd");
    if (formPaymentMethod) {
      formPaymentMethod.style.verticalAlign = "middle";
      formPaymentMethod.innerHTML = paymentMethod || "—"; // optional
    }

    document.getElementById("salesRep").innerHTML = salesRep || "-";

    /* ============================
       6️⃣ PRODUCT TABLE
       ============================ */
    const items = q.item?.items || q.items || q.lines || [];
    const tableBody = document.getElementById("productTableBody");

    if (!tableBody) {
      console.error("❌ productTableBody not found");
      return;
    }

    tableBody.innerHTML = "";

    (items || []).forEach((line) => {
      const itemName = line.item?.refName || line.itemName || "";
      const optionsRaw = line.custcol_sb_itemoptionsdisplay || line.optionsDisplay || "";
      const options = String(optionsRaw).replace(/\n/g, "<br>");

      const qty = Number(line.quantity || 0);

      // IMPORTANT:
      // Your SO receipt assumes `line.amount` and `line.saleprice` are already GROSS totals.
      // We'll keep identical behaviour for consistency.
      const price = Number(line.amount || 0);       // original gross total (or retail)
      const total = Number(line.saleprice || 0);    // actual charged gross total

      let discountPct = 0;
      if (price > 0 && total > 0 && total < price) {
        discountPct = ((price - total) / price) * 100;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${itemName}</td>
        <td>${options}</td>
        <td>${qty}</td>
        <td>£${price.toFixed(2)}</td>
        <td>${discountPct.toFixed(1)}%</td>
        <td>£${total.toFixed(2)}</td>
      `;
      tableBody.appendChild(tr);
    });

    /* ============================
       7️⃣ DEPOSIT TABLE (quotes usually none, but keep)
       ============================ */
    const deposits = data.deposits || [];
    const depositTableBody = document.getElementById("depositTableBody");

    if (!depositTableBody) {
      console.error("❌ depositTableBody not found");
      return;
    }

    depositTableBody.innerHTML = "";

    if (!Array.isArray(deposits) || deposits.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td colspan="3" style="text-align:center; color:#888;">
          No deposits recorded
        </td>
      `;
      depositTableBody.appendChild(tr);
    } else {
      deposits.forEach((dep) => {
        const linkHtml = dep.link || "-";
        const method = dep.method || "-";
        const amount = Number(dep.amount || 0);

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${linkHtml}</td>
          <td>${method}</td>
          <td>£${amount.toFixed(2)}</td>
        `;
        depositTableBody.appendChild(tr);
      });
    }

    /* ==========================================
      8️⃣ QUOTE SUMMARY TABLE
      =========================================== */
    const vatAmounts = items || [];

    // Sum deposits from API response (reliable)
    const depositTotal = (deposits || []).reduce(
      (sum, d) => sum + (Number(d.amount || 0) || 0),
      0
    );

    let vatTotal = 0;
    let quoteTotal = 0;
    let remainingBalance = 0;
    let totalRetail = 0;
    let totalOrdDiscount = 0;

    vatAmounts.forEach((line) => {
      const vat = Number(line.vat || 0);
      const amount = Number(line.saleprice || 0); // charged gross
      const retail = Number(line.amount || 0);    // original gross

      vatTotal += vat;
      quoteTotal += amount;
      totalRetail += retail;
    });

    totalOrdDiscount = totalRetail - quoteTotal;
    remainingBalance = quoteTotal - depositTotal;

    document.getElementById("vatTotal").innerHTML = `£${vatTotal.toFixed(2)}`;
    document.getElementById("quoteTotal").innerHTML = `£${quoteTotal.toFixed(2)}`;
    document.getElementById("balance").innerHTML = `£${remainingBalance.toFixed(2)}`;

    /* ===========================================
      9️⃣ DISCOUNT SUMMARY
      ============================================= */
    document.getElementById("originalPrice").innerHTML = `£${totalRetail.toFixed(2)}`;
    document.getElementById("discAmount").innerHTML = `£${totalOrdDiscount.toFixed(2)}`;

    let totalDiscountPct = 0;
    if (totalRetail > 0) {
      totalDiscountPct = ((totalRetail - quoteTotal) / totalRetail) * 100;
    }

    document.getElementById("totalDiscPerc").innerHTML = `${totalDiscountPct.toFixed(2)}%`;
  } catch (err) {
    console.error("💥 Fetch error:", err);
  }
});