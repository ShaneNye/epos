// public/js/salesOrdReceipt.js

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🧾 Sales Order Receipt init");

  /* ============================
     1️⃣ Extract Sales Order ID
     ============================ */
  const parts = window.location.pathname.split("/").filter(Boolean);
  const salesOrderId = parts[parts.length - 1];

  if (!salesOrderId) {
    console.error("❌ No Sales Order ID in URL");
    return;
  }

  console.log("📌 Sales Order ID:", salesOrderId);

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

  /* ============================
     3️⃣ Fetch Sales Order
     ============================ */
  try {
    const res = await fetch(
      `/api/netsuite/salesorder/${encodeURIComponent(salesOrderId)}`,
      { headers }
    );

    console.log("🌐 Fetch response status:", res.status);

    const data = await res.json();
    console.log("📦 Sales Order payload:", data);

    if (!res.ok || data.ok === false) {
      console.error("❌ Sales order fetch failed:", data.error || res.status);
      return;
    }

    const so = data.salesOrder;
    if (!so) {
      console.error("❌ salesOrder missing from response");
      return;
    }

    /* ============================
       4️⃣ Resolve STORE from SO
       ============================ */
    const storeNsId =
      so.custbody_sb_primarystore?.id ||
      so.subsidiary?.id ||
      so.location?.id ||
      null;

    console.log("🏬 Store NS ID resolved from SO:", storeNsId);

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
       5️⃣ Customer / Order details
       ============================ */
    const customerName = so.entity?.refName || "";

    const addressLines = (so.shippingAddress_text || "").split("\n");
    const customerAddressLine1 = addressLines[1] || "";
    const customerAddressLine2 = addressLines[2] || "";
    const customerAddressLine3 = addressLines[3] || "";
    const customerPostcode = addressLines[4] || "";

    const customerEmail = so.email || "";
    const customerTel = so.custbody4 || "";
    const salesOrdNo = so.tranId || "";

    const rawDate = so.tranDate || "";
    let salesDate = "";
    if (rawDate) {
      const [year, month, day] = rawDate.split("-");
      salesDate = `${day}/${month}/${year}`;
    }

    const paymentMethod = so.custbody_sb_paymentinfo?.refName || "";
    const salesRep = so.custbody_sb_bedspecialist?.refName || "";

    // CUSTOMER DETAILS
    document.getElementById("customerName").innerHTML = customerName;
    document.getElementById("custadd1").innerHTML = customerAddressLine1;
    document.getElementById("custadd2").innerHTML = customerAddressLine2;
    document.getElementById("custadd3").innerHTML = customerAddressLine3;
    document.getElementById("custzip").innerHTML = customerPostcode;
    document.getElementById("custEmail").innerHTML = customerEmail;
    document.getElementById("custTel").innerHTML = customerTel;

    // ORDER DETAILS
    document.getElementById("salesOrd").innerHTML = salesOrdNo;
    document.getElementById("salesDate").innerHTML = salesDate;

    const formPaymentMethod = document.getElementById("pymtMthd");
    formPaymentMethod.style.verticalAlign = "middle";
    formPaymentMethod.innerHTML = paymentMethod;

    document.getElementById("salesRep").innerHTML = salesRep;

    /* ============================
       6️⃣ PRODUCT TABLE
       ============================ */
    const items = so.item?.items || [];
    const tableBody = document.getElementById("productTableBody");

    if (!tableBody) {
      console.error("❌ productTableBody not found");
      return;
    }

    tableBody.innerHTML = "";

    items.forEach((line) => {
      const itemName = line.item?.refName || "";
      const optionsRaw = line.custcol_sb_itemoptionsdisplay || "";
      const options = optionsRaw.replace(/\n/g, "<br>");

      const qty = Number(line.quantity || 0);

      // Amount = original price (gross)
      const price = Number(line.amount || 0);

      // Sale price = actual charged total
      const total = Number(line.saleprice || 0);

      // Discount %
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
       7️⃣ DEPOSIT TABLE
       ============================ */
    const deposits = data.deposits || [];
    const depositTableBody = document.getElementById("depositTableBody");

    if (!depositTableBody) {
      console.error("❌ depositTableBody not found");
      return;
    }

    depositTableBody.innerHTML = "";

    if (deposits.length === 0) {
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
      8️⃣ ORDER SUMMARY TABLE
      =========================================== */
    const vatAmounts = so.item?.items || [];

    // ✅ Sum deposits from API response (more reliable than custbody)
    const depositTotal = (deposits || []).reduce(
      (sum, d) => sum + (Number(d.amount || 0) || 0),
      0
    );

    let vatTotal = 0;
    let salesTotal = 0;
    let remainingBalance = 0;
    let totalRetail = 0;
    let totalOrdDiscount = 0;

    vatAmounts.forEach((line) => {
      const vat = Number(line.vat || 0);
      const amount = Number(line.saleprice || 0);
      const retail = Number(line.amount || 0);

      vatTotal += vat;
      salesTotal += amount;
      totalRetail += retail;
    });

    totalOrdDiscount = totalRetail - salesTotal;
    remainingBalance = salesTotal - depositTotal;

    document.getElementById("vatTotal").innerHTML = `£${vatTotal.toFixed(2)}`;
    document.getElementById("salesTotal").innerHTML = `£${salesTotal.toFixed(2)}`;
    document.getElementById("balance").innerHTML = `£${remainingBalance.toFixed(2)}`;

    /* ===========================================
      9️⃣ DISCOUNT SUMMARY
      ============================================= */
    document.getElementById("originalPrice").innerHTML = `£${totalRetail.toFixed(2)}`;
    document.getElementById("discAmount").innerHTML = `£${totalOrdDiscount.toFixed(2)}`;

    let totalDiscountPct = 0;
    if (totalRetail > 0) totalDiscountPct = ((totalRetail - salesTotal) / totalRetail) * 100;

    document.getElementById("totalDiscPerc").innerHTML = `${totalDiscountPct.toFixed(2)}%`;
  } catch (err) {
    console.error("💥 Fetch error:", err);
  }
});