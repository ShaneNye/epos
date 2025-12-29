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
  console.log("Waiting for Netsuite Response")

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

    /* ============================
       4️⃣ Extract variables HERE
       ============================ */
    const so = data.salesOrder;
    if (!so) {
      console.error("❌ salesOrder missing from response");
      return;
    }

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



    /*=========================== 
    Setting variables to Receipt 
    ================================*/
    /* ============================
        CUSTOMER DETAILS 
      ==============================  */
    let formCustomerName = document.getElementById("customerName");
    formCustomerName.innerHTML = customerName;
    let formCustomerAdd1 = document.getElementById("custadd1");
    formCustomerAdd1.innerHTML = customerAddressLine1;
    let formCustomerAdd2 = document.getElementById("custadd2");
    formCustomerAdd2.innerHTML = customerAddressLine2;
    let formCustomerAdd3 = document.getElementById("custadd3");
    formCustomerAdd3.innerHTML = customerAddressLine3;
    let formCustomerZip = document.getElementById("custzip");
    formCustomerZip.innerHTML = customerPostcode;
    let formCustomerEmail = document.getElementById("custEmail");
    formCustomerEmail.innerHTML = customerEmail;
    let formCustomerPhone = document.getElementById("custTel");
    formCustomerPhone.innerHTML = customerTel;
    /* ========================================
      ORDER Details
      ======================================== */
    let formCustomerSalesOrdNo = document.getElementById("salesOrd");
    formCustomerSalesOrdNo.innerHTML = salesOrdNo;
    let formSalesDate = document.getElementById("salesDate");
    formSalesDate.innerHTML = salesDate;
    let formPaymentMethod = document.getElementById("pymtMthd");
    formPaymentMethod.style.verticalAlign = "middle"
    formPaymentMethod.innerHTML = paymentMethod;
    let formSalesRep = document.getElementById("salesRep");
    formSalesRep.innerHTML = salesRep;
    /* ============================
   PRODUCT TABLE
   ============================ */

const items = so.item?.items || [];
const tableBody = document.getElementById("productTableBody");

// Safety check
if (!tableBody) {
  console.error("❌ productTableBody not found");
  return;
}

// Clear any existing rows
tableBody.innerHTML = "";

items.forEach(line => {
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

  // Create row
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
   DEPOSIT TABLE
   ============================ */

const deposits = data.deposits || [];
const depositTableBody = document.getElementById("depositTableBody");

// Safety check
if (!depositTableBody) {
  console.error("❌ depositTableBody not found");
  return;
}

// Clear existing rows
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
  deposits.forEach(dep => {
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
  ORDER SUMMARY TABLE
  =========================================== */

  const vatAmounts = so.item?.items || [];
  const depositTotal = so.custbody_sb_deposittotal;
  let vatTotal = 0;
  let salesTotal = 0;
  let remainingBalance = 0;
  let totalRetail = 0;
  let totalOrdDiscount = 0;

  vatAmounts.forEach(line => {
    const vat = Number(line.vat || 0);
    const amount = Number(line.saleprice || 0);
    const retail = Number(line.amount || 9);
    vatTotal += vat;
    salesTotal += amount;
    totalRetail += retail;
  });

  totalOrdDiscount = totalRetail - salesTotal;
  remainingBalance = salesTotal - depositTotal;

  let formVatTotal = document.getElementById("vatTotal");
  formVatTotal.innerHTML = `£${vatTotal.toFixed(2)}`;
  let formSalesTotal = document.getElementById("salesTotal");
  formSalesTotal.innerHTML = `£${salesTotal.toFixed(2)}`;
  let formBalance = document.getElementById("balance");
  formBalance.innerHTML = remainingBalance.toFixed(2);
  /* ===========================================
    DISCOUNT SUMMARY 
    ============================================= */

    let formOrigPrice = document.getElementById("originalPrice");
    formOrigPrice.innerHTML = totalRetail.toFixed(2);
    let formTotalDiscount = document.getElementById("discAmount");
    formTotalDiscount.innerHTML = totalOrdDiscount.toFixed(2);
    let formTotalDiscPct = document.getElementById("totalDiscPerc");

    let totalDiscountPct = 0;
    totalDiscountPct = ((totalRetail - salesTotal) / totalRetail) * 100;

    formTotalDiscPct.innerHTML = `${totalDiscountPct.toFixed(2)}%`;












  } catch (err) {
    console.error("💥 Fetch error:", err);
  }
});
