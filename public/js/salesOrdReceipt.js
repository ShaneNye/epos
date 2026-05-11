// public/js/salesOrdReceipt.js

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🧾 Sales Order Receipt init");

  if (await window.EposPendingReceipt?.tryRender?.("sale")) return;

  /* ============================
     1️⃣ Extract Sales Order ID
     ============================ */
  const parts = window.location.pathname.split("/").filter(Boolean);
  const salesOrderId = parts[parts.length - 1];

  if (!salesOrderId) {
    console.error("❌ No Sales Order ID in URL");
    document.body.classList.remove("receipt-loading");
    return;
  }

  console.log("📌 Sales Order ID:", salesOrderId);

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

  const hasRealValue = (v) =>
    v !== null &&
    v !== undefined &&
    String(v).trim() !== "";

  const sameId = (a, b) =>
    hasRealValue(a) &&
    hasRealValue(b) &&
    String(a).trim() === String(b).trim();

  const findReceiptStore = (locations, so) => {
    const primaryStoreId = so.custbody_sb_primarystore?.id;
    const invoiceLocationId = so.location?.id;
    const subsidiaryId = so.subsidiary?.id;
    const storeName = String(
      so.custbody_sb_primarystore?.refName ||
      so.custbody_sb_primarystore?.name ||
      so.location?.refName ||
      so.location?.name ||
      ""
    ).trim().toLowerCase();

    return (
      locations.find((loc) => sameId(loc.netsuite_internal_id, primaryStoreId)) ||
      locations.find((loc) => sameId(loc.invoice_location_id, invoiceLocationId)) ||
      locations.find((loc) => sameId(loc.netsuite_internal_id, subsidiaryId)) ||
      locations.find((loc) => sameId(loc.id, primaryStoreId)) ||
      locations.find((loc) => sameId(loc.id, invoiceLocationId)) ||
      locations.find(
        (loc) => storeName && String(loc.name || "").trim().toLowerCase() === storeName
      ) ||
      null
    );
  };

  const formatMoney = (value) => {
    if (window.EposFinancials?.formatMoney) {
      return window.EposFinancials.formatMoney(value);
    }
    const n = Number(value || 0) || 0;
    return `£${n.toFixed(2)}`;
  };

  const isNegativeValueLine = (name = "") => {
    if (window.EposFinancials?.isNegativeValueLine) {
      return window.EposFinancials.isNegativeValueLine(name);
    }
    const text = String(name || "").toLowerCase();
    return (
      text.includes("discount") ||
      text.includes("blue light") ||
      text.includes("promo") ||
      text.includes("promotion") ||
      text.includes("voucher") ||
      text.includes("trade in") ||
      text.includes("recommendation card (as a minus)") ||
      text.includes("trade-in")
    );
  };

  /* ============================
     🖨 Auto Print Helper
     ============================ */
  let hasTriggeredPrint = false;

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

  const triggerPrint = async () => {
    if (hasTriggeredPrint) return;
    hasTriggeredPrint = true;

    await revealReceipt();

    setTimeout(() => {
      window.print();
    }, 100);
  };

  /* ============================
     3️⃣ Fetch Sales Order
     ============================ */
  try {
    const salesOrderPromise = fetch(
      `/api/netsuite/salesorder/${encodeURIComponent(salesOrderId)}?refresh=1&_=${Date.now()}`,
      { headers, cache: "no-store" }
    );
    const locationsPromise = fetch("/api/meta/locations", { headers })
      .catch(() => fetch("/api/meta/locations"));

    const res = await salesOrderPromise;

    console.log("🌐 Fetch response status:", res.status);

    const data = await res.json();
    console.log("📦 Sales Order payload:", data);

    if (!res.ok || data.ok === false) {
      console.error("❌ Sales order fetch failed:", data.error || res.status);
      await revealReceipt();
      return;
    }

    const so = data.salesOrder;
    if (!so) {
      console.error("❌ salesOrder missing from response");
      await revealReceipt();
      return;
    }

    /* ============================
       4️⃣ Resolve STORE from SO
       ============================ */
    const storeDebug = {
      primaryStoreId: so.custbody_sb_primarystore?.id || null,
      invoiceLocationId: so.location?.id || null,
      subsidiaryId: so.subsidiary?.id || null,
    };

    console.log("🏬 Store fields resolved from SO:", storeDebug);

    try {
      const locRes = await locationsPromise;
      const locJson = await locRes.json();

      if (locRes.ok && locJson.ok && Array.isArray(locJson.locations)) {
        const locations = locJson.locations;

        const match = findReceiptStore(locations, so);

        if (!match) {
          console.warn("⚠️ No matching location found for store fields:", storeDebug);
        } else {
          console.log("✅ Matched store record:", match);

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

    document.getElementById("customerName").innerHTML = escapeHtml(customerName);
    document.getElementById("custadd1").innerHTML = escapeHtml(customerAddressLine1);
    document.getElementById("custadd2").innerHTML = escapeHtml(customerAddressLine2);
    document.getElementById("custadd3").innerHTML = escapeHtml(customerAddressLine3);
    document.getElementById("custzip").innerHTML = escapeHtml(customerPostcode);
    document.getElementById("custEmail").innerHTML = escapeHtml(customerEmail);
    document.getElementById("custTel").innerHTML = escapeHtml(customerTel);

    document.getElementById("salesOrd").innerHTML = escapeHtml(salesOrdNo);
    document.getElementById("salesDate").innerHTML = escapeHtml(salesDate);

    const formPaymentMethod = document.getElementById("pymtMthd");
    if (formPaymentMethod) {
      formPaymentMethod.style.verticalAlign = "middle";
      formPaymentMethod.innerHTML = escapeHtml(paymentMethod);
    }

    document.getElementById("salesRep").innerHTML = escapeHtml(salesRep);

    /* ============================
       6️⃣ PRODUCT TABLE
       ============================ */
    const items = so.item?.items || [];
    const tableBody = document.getElementById("productTableBody");
    const productTable = document.getElementById("productTable");

    if (!tableBody) {
      console.error("❌ productTableBody not found");
      await revealReceipt();
      return;
    }

    tableBody.innerHTML = "";

    const hasAnyOptions = items.some((line) =>
      String(line.custcol_sb_itemoptionsdisplay || "").trim()
    );

    if (productTable) {
      const rows = productTable.querySelectorAll("tr");
      rows.forEach((row) => {
        const cells = row.children;
        if (cells[1]) {
          cells[1].style.display = hasAnyOptions ? "" : "none";
        }
      });
    }

    items.forEach((line) => {
      const itemName = line.item?.refName || "";
      const optionsRaw = String(line.custcol_sb_itemoptionsdisplay || "").trim();
      const options = escapeHtml(optionsRaw).replace(/\n/g, "<br>");

      const qty = Math.abs(Number(line.quantity || 1)) || 1;

      let retailGrossLineTotal = hasRealValue(line.amount) ? Number(line.amount) : 0;
      let saleGrossLineTotal = hasRealValue(line.saleprice)
        ? Number(line.saleprice)
        : retailGrossLineTotal;

      if (!Number.isFinite(retailGrossLineTotal)) retailGrossLineTotal = 0;
      if (!Number.isFinite(saleGrossLineTotal)) saleGrossLineTotal = 0;

      if (!hasRealValue(line.amount) && saleGrossLineTotal !== 0) {
        retailGrossLineTotal = saleGrossLineTotal;
      }

      const negativeLine = isNegativeValueLine(itemName);

      if (negativeLine) {
        if (retailGrossLineTotal > 0) retailGrossLineTotal = -retailGrossLineTotal;
        if (saleGrossLineTotal > 0) saleGrossLineTotal = -saleGrossLineTotal;
      } else {
        if (retailGrossLineTotal < 0) retailGrossLineTotal = Math.abs(retailGrossLineTotal);
        if (saleGrossLineTotal < 0) saleGrossLineTotal = Math.abs(saleGrossLineTotal);
      }

      const retailGrossPerUnit = qty ? retailGrossLineTotal / qty : 0;

      const discountPct =
        retailGrossLineTotal > 0
          ? Math.max(
              0,
              ((retailGrossLineTotal - saleGrossLineTotal) / retailGrossLineTotal) * 100
            )
          : 0;

      const tr = document.createElement("tr");

      if (hasAnyOptions) {
        tr.innerHTML = `
          <td>${escapeHtml(itemName)}</td>
          <td>${options || "-"}</td>
          <td>${qty}</td>
          <td>${formatMoney(retailGrossPerUnit)}</td>
          <td>${discountPct.toFixed(1)}%</td>
          <td>${formatMoney(saleGrossLineTotal)}</td>
        `;
      } else {
        tr.innerHTML = `
          <td>${escapeHtml(itemName)}</td>
          <td>${qty}</td>
          <td>${formatMoney(retailGrossPerUnit)}</td>
          <td>${discountPct.toFixed(1)}%</td>
          <td>${formatMoney(saleGrossLineTotal)}</td>
        `;
      }

      tableBody.appendChild(tr);
    });

    /* ============================
       7️⃣ DEPOSIT TABLE
       ============================ */
    const deposits = data.deposits || [];
    const depositTableBody = document.getElementById("depositTableBody");

    if (!depositTableBody) {
      console.error("❌ depositTableBody not found");
      await revealReceipt();
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
          <td>${escapeHtml(method)}</td>
          <td>${formatMoney(amount)}</td>
        `;
        depositTableBody.appendChild(tr);
      });
    }

    /* ==========================================
       8️⃣ ORDER SUMMARY TABLE
       =========================================== */
    const vatAmounts = so.item?.items || [];

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
      const itemName = String(line.item?.refName || "");
      const negativeLine = isNegativeValueLine(itemName);

      let retailGrossLineTotal = hasRealValue(line.amount) ? Number(line.amount) : 0;
      let saleGrossLineTotal = hasRealValue(line.saleprice)
        ? Number(line.saleprice || 0)
        : retailGrossLineTotal;

      if (!Number.isFinite(retailGrossLineTotal)) retailGrossLineTotal = 0;
      if (!Number.isFinite(saleGrossLineTotal)) saleGrossLineTotal = 0;

      if (!hasRealValue(line.amount) && saleGrossLineTotal !== 0) {
        retailGrossLineTotal = saleGrossLineTotal;
      }

      if (negativeLine) {
        if (retailGrossLineTotal > 0) retailGrossLineTotal = -retailGrossLineTotal;
        if (saleGrossLineTotal > 0) saleGrossLineTotal = -saleGrossLineTotal;
      } else {
        if (retailGrossLineTotal < 0) retailGrossLineTotal = Math.abs(retailGrossLineTotal);
        if (saleGrossLineTotal < 0) saleGrossLineTotal = Math.abs(saleGrossLineTotal);
      }

      const taxValue = saleGrossLineTotal / 6;

      vatTotal += taxValue;
      salesTotal += saleGrossLineTotal;
      totalRetail += retailGrossLineTotal;
    });

    totalOrdDiscount = totalRetail - salesTotal;
    remainingBalance = salesTotal - depositTotal;

    document.getElementById("vatTotal").innerHTML = formatMoney(vatTotal);
    document.getElementById("salesTotal").innerHTML = formatMoney(salesTotal);
    document.getElementById("balance").innerHTML = formatMoney(remainingBalance);

    /* ===========================================
       9️⃣ DISCOUNT SUMMARY
       ============================================= */
    document.getElementById("originalPrice").innerHTML = formatMoney(totalRetail);
    document.getElementById("discAmount").innerHTML = formatMoney(totalOrdDiscount);

    let totalDiscountPct = 0;
    if (totalRetail > 0) {
      totalDiscountPct = ((totalRetail - salesTotal) / totalRetail) * 100;
    }

    document.getElementById("totalDiscPerc").innerHTML = `${totalDiscountPct.toFixed(2)}%`;

    /* ===========================================
       🔟 Auto open print dialog
       ============================================= */
    triggerPrint();

  } catch (err) {
    console.error("💥 Fetch error:", err);
    await revealReceipt();
  }
});
