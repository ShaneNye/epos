// public/js/quoteReceipt.js
// Based on salesOrdReceipt.js, but loads an Estimate/Quote and maps to Quote receipt HTML IDs.

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🧾 Quote Receipt init");

  if (await window.EposPendingReceipt?.tryRender?.("quote")) return;

  /* ============================
     1️⃣ Extract Quote ID
     ============================ */
  const parts = window.location.pathname.split("/").filter(Boolean);
  const quoteId = parts[parts.length - 1];

  if (!quoteId) {
    console.error("❌ No Quote ID in URL");
    document.body.classList.remove("receipt-loading");
    return;
  }

  console.log("📌 Quote ID:", quoteId);

  /* ============================
     2️⃣ Load auth token
     ============================ */
  const saved = storageGet?.();

  if (!saved || !saved.token) {
    console.error("🚫 No auth token found");
    document.body.classList.remove("receipt-loading");
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

  const escapeHtml = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatMoney =
    window.EposFinancials?.formatMoney ||
    ((value) => `£${(Number(value || 0) || 0).toFixed(2)}`);

  const fmtDateDDMMYYYY = (raw) => {
    if (!raw) return "-";
    // Supports "YYYY-MM-DD" (NetSuite) or ISO
    const s = String(raw).slice(0, 10);
    const [y, m, d] = s.split("-");
    if (!y || !m || !d) return raw;
    return `${d}/${m}/${y}`;
  };

  const waitForReceiptAssets = async () => {
    const images = [...document.images].filter((img) => !img.complete);
    if (!images.length) return;

    await Promise.race([
      Promise.all(
        images.map((img) =>
          img.decode
            ? img.decode().catch(() => {})
            : new Promise((resolve) => {
                img.addEventListener("load", resolve, { once: true });
                img.addEventListener("error", resolve, { once: true });
              })
        )
      ),
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
  };

  const revealReceipt = async () => {
    await waitForReceiptAssets();
    document.body.classList.remove("receipt-loading");
    document.body.classList.add("receipt-ready");
  };

  /* ============================
     3️⃣ Fetch Quote / Estimate
     ============================ */
  try {
    // ✅ You need this endpoint (or adjust URL to your actual quote-get route):
    // GET /api/netsuite/quote/:id   -> { ok:true, quote:{...} } or { ok:true, estimate:{...} }
    const quotePromise = fetch(
      `/api/netsuite/quote/${encodeURIComponent(quoteId)}`,
      { headers }
    );
    const locationsPromise = fetch("/api/meta/locations", { headers }).catch(() =>
      fetch("/api/meta/locations")
    );

    const res = await quotePromise;

    console.log("🌐 Fetch response status:", res.status);

    const data = await res.json();
    console.log("📦 Quote payload:", data);

    if (!res.ok || data.ok === false) {
      console.error("❌ Quote fetch failed:", data.error || res.status);
      await revealReceipt();
      return;
    }

    // Support multiple backend shapes
    const q = data.quote || data.estimate || data.estimateObj || data.salesOrder || data;
    if (!q) {
      console.error("❌ quote/estimate object missing from response");
      await revealReceipt();
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
      const locRes = await locationsPromise;
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
    setText("customerName", customerName || "-");
    setText("custadd1", customerAddressLine1 || "-");
    setText("custadd2", customerAddressLine2 || "");
    setText("custadd3", customerAddressLine3 || "");
    setText("custzip", customerPostcode || "-");
    setText("custEmail", customerEmail || "-");
    setText("custTel", customerTel || "-");

    // QUOTE DETAILS (IDs differ from sales receipt)
    setText("quoteNo", quoteNo || "-");
    setText("quoteDate", quoteDate || "-");

    const formPaymentMethod = document.getElementById("pymtMthd");
    if (formPaymentMethod) {
      formPaymentMethod.style.verticalAlign = "middle";
      formPaymentMethod.textContent = paymentMethod || "—"; // optional
    }

    setText("salesRep", salesRep || "-");

    /* ============================
       6️⃣ PRODUCT TABLE
       ============================ */
    const items = q.item?.items || q.items || q.lines || [];
    const tableBody = document.getElementById("productTableBody");

    if (!tableBody) {
      console.error("❌ productTableBody not found");
      await revealReceipt();
      return;
    }

    tableBody.innerHTML = "";

    (items || []).forEach((line) => {
      const itemName = line.item?.refName || line.itemName || "";
      const optionsRaw = line.custcol_sb_itemoptionsdisplay || line.optionsDisplay || "";
      const options = escapeHtml(optionsRaw).replace(/\n/g, "<br>");

      const qty = Number(line.quantity || 0);
      const normalised = window.EposFinancials?.normaliseLine
        ? window.EposFinancials.normaliseLine(line)
        : {
            retailGross: Number(line.amount || 0),
            saleGross: Number(line.saleprice || 0),
          };
      const price = normalised.retailGross;
      const total = normalised.saleGross;

      let discountPct = 0;
      if (price > 0 && total > 0 && total < price) {
        discountPct = ((price - total) / price) * 100;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(itemName)}</td>
        <td>${options}</td>
        <td>${qty}</td>
        <td>${formatMoney(price)}</td>
        <td>${discountPct.toFixed(1)}%</td>
        <td>${formatMoney(total)}</td>
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
      await revealReceipt();
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
        const linkHtml = escapeHtml(dep.link || "-");
        const method = dep.method || "-";
        const amount = Number(dep.amount || 0);

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${linkHtml}</td>
          <td>${escapeHtml(method)}</td>
          <td>${formatMoney(amount)}</td>
        `;
        depositTableBody.appendChild(tr);
      });
    }

    /* ==========================================
      8️⃣ QUOTE SUMMARY TABLE
      =========================================== */
    const summary = window.EposFinancials?.summariseLines
      ? window.EposFinancials.summariseLines(items || [], deposits || [])
      : { vatTotal: 0, grossTotal: 0, remainingBalance: 0, totalRetail: 0, discountTotal: 0, discountPct: 0 };

    setText("vatTotal", formatMoney(summary.vatTotal));
    setText("quoteTotal", formatMoney(summary.grossTotal));
    setText("balance", formatMoney(summary.remainingBalance));

    /* ===========================================
      9️⃣ DISCOUNT SUMMARY
      ============================================= */
    setText("originalPrice", formatMoney(summary.totalRetail));
    setText("discAmount", formatMoney(summary.discountTotal));
    setText("totalDiscPerc", `${Number(summary.discountPct || 0).toFixed(2)}%`);

    await revealReceipt();
  } catch (err) {
    console.error("💥 Fetch error:", err);
    await revealReceipt();
  }
});
