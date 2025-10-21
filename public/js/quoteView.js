// public/js/quoteView.js
document.addEventListener("DOMContentLoaded", async () => {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.classList.remove("hidden");

  let headers = {};
  const saved = storageGet();
  if (saved?.token) {
    headers = { Authorization: `Bearer ${saved.token}` };
  } else {
    console.warn("⚠️ No token found — continuing in read-only mode");
  }

  // === Extract Quote ID from URL ===
  const parts = window.location.pathname.split("/");
  const tranId = parts.pop() || parts.pop();
  if (!tranId) return alert("No Quote ID found in URL.");

  try {
    // === Fetch Quote ===
    const res = await fetch(`/api/netsuite/quote/${tranId}`, { headers });
    const data = await res.json();
    if (!res.ok || !data || data.ok === false)
      throw new Error(data?.error || `Server returned ${res.status}`);

    const quote = data.quote || data.salesOrder || data.estimate || data;
    if (!quote) throw new Error("No quote object in response");

    /* ==========================
       🔎 DEBUG LOGGING (quote & entity)
    ========================== */
    try {
      // Full objects in console
      console.groupCollapsed("🔎 NetSuite Quote (full)");
      console.log(quote);
      console.groupEnd();

      console.groupCollapsed("🔎 NetSuite Entity (full)");
      console.log(quote.entity);
      console.groupEnd();

      // List custom fields on entity (cust*)
      if (quote.entity) {
        const custEntries = Object.entries(quote.entity)
          .filter(([k]) => k.toLowerCase().startsWith("cust"));
        console.groupCollapsed(`🔎 Entity custom fields (${custEntries.length})`);
        custEntries.forEach(([k, v]) => console.log(k, "=>", v));
        console.groupEnd();
      }

      // Expose on window for quick DevTools access
      window.DEBUG = window.DEBUG || {};
      window.DEBUG.quote = quote;
      window.DEBUG.entity = quote.entity;

      // Download helpers (console links)
      const makeDl = (obj, filename) => {
        try {
          const json = JSON.stringify(obj, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          console.log(`⬇️ Download ${filename}:`, url);
          return url;
        } catch (e) {
          console.warn(`Failed to build ${filename} blob`, e);
          return null;
        }
      };
      window.DEBUG.entityJsonUrl = makeDl(quote.entity || {}, "entity.json");
      window.DEBUG.quoteJsonUrl = makeDl(quote || {}, "quote.json");
      console.log("💡 Tip: copy these into the address bar to download the JSON files above.");
    } catch (e) {
      console.warn("Entity/Quote debug logging failed:", e);
    }

/* ==========================
   TITLE (from entity record)
========================== */
const titleSelect = document.getElementById("title");
const titles = ["Mr", "Mrs", "Miss", "Ms", "Dr", "Prof"];
titleSelect.innerHTML = '<option value="">Select Title</option>';

titles.forEach(t => {
  const opt = document.createElement("option");
  opt.value = t;
  opt.textContent = t;
  titleSelect.appendChild(opt);
});

// Use custentity_title.refName
let nsTitle = null;
if (quote.entity?.custentity_title) {
  if (typeof quote.entity.custentity_title === "object") {
    nsTitle = quote.entity.custentity_title.refName || null;
  } else {
    nsTitle = String(quote.entity.custentity_title);
  }
}

console.log("🎩 NetSuite Title candidate:", nsTitle);

if (nsTitle && titles.includes(nsTitle)) {
  titleSelect.value = nsTitle;
  console.log(`✅ Title set to: ${nsTitle}`);
} else {
  console.warn("⚠️ No matching title found in NetSuite data:", nsTitle);
}

    /* ==========================
       CUSTOMER + CONTACT INFO
    ========================== */
    try {
      const addressLines = quote.billingAddress_text
        ? quote.billingAddress_text.split("\n").map(l => l.trim()).filter(Boolean)
        : [];
      const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
      let postcode = "", countryLine = "", cleanedAddress = [];

      for (const line of addressLines) {
        if (postcodeRegex.test(line)) {
          const match = line.match(postcodeRegex);
          if (match) postcode = match[0].toUpperCase();
          const townPart = line.replace(postcode, "").trim();
          if (townPart) cleanedAddress.push(townPart);
        } else if (/(United Kingdom|UK|England|Scotland|Wales|Northern Ireland)/i.test(line)) {
          countryLine = line;
        } else cleanedAddress.push(line);
      }

      document.querySelector('input[name="firstName"]').value =
        quote.entity?.refName?.split(" ")[1] || "";
      document.querySelector('input[name="lastName"]').value =
        quote.entity?.refName?.split(" ")[2] || "";
      document.querySelector('input[name="address1"]').value = cleanedAddress[0] || "";
      document.querySelector('input[name="address2"]').value = cleanedAddress[1] || "";
      document.querySelector('input[name="address3"]').value = cleanedAddress[2] || "";
      document.querySelector('input[name="postcode"]').value = postcode || "";
      document.querySelector('input[name="country"]').value = countryLine || "United Kingdom";
    } catch {}

    document.querySelector('input[name="email"]').value = quote.email || "";
    document.querySelector('input[name="contactNumber"]').value = quote.custbody4 || quote.phone || "";
    document.querySelector('input[name="altContactNumber"]').value = quote.altPhone || "";

    /* ==========================
       SALES EXECUTIVE
    ========================== */
    const nsExecId = quote.custbody_sb_bedspecialist?.id || null;
    console.log("👤 Raw Sales Exec from quote:", quote.custbody_sb_bedspecialist);

    try {
      const userRes = await fetch("/api/users", { headers }); // ✅ correct endpoint
      const userData = await userRes.json();
      const users = userData.users || userData.data || [];
      console.log("👥 Available users:", users);

      const execSelect = document.getElementById("salesExec");
      execSelect.innerHTML = '<option value="">Select Sales Executive</option>';

      const salesExecs = users.filter(
        u => Array.isArray(u.roles) && u.roles.some(r => r.name === "Sales Executive")
      );

      salesExecs.forEach(u => {
        const opt = document.createElement("option");
        opt.value = String(u.id);
        opt.textContent = `${u.firstName} ${u.lastName}`;
        execSelect.appendChild(opt);
      });

      if (nsExecId) {
        const match = users.find(u => String(u.netsuiteId) === String(nsExecId));
        if (match) {
          execSelect.value = String(match.id);
          console.log(`✅ Sales Exec mapped: NS ${nsExecId} → local ${match.id} (${match.firstName} ${match.lastName})`);
        } else {
          console.warn("⚠️ No Sales Exec match for NS id:", nsExecId);
        }
      }
    } catch (err) {
      console.error("❌ Failed to load users:", err);
    }

    /* ==========================
       STORE
    ========================== */
    const nsStoreId = quote.custbody_sb_primarystore?.id || quote.subsidiary?.id || quote.location?.id || null;
    console.log("🏬 Raw store fields from quote:", {
      custbody_sb_primarystore: quote.custbody_sb_primarystore,
      subsidiary: quote.subsidiary,
      location: quote.location
    });

    if (nsStoreId) {
      try {
        const locRes = await fetch("/api/meta/locations", { headers });
        const locData = await resOrJson(locRes);
        const locations = locData.locations || locData.data || [];
        console.log("📍 Available locations:", locations);

        const storeSelect = document.getElementById("store");
        storeSelect.innerHTML = '<option value="">Select Store</option>';

        locations.forEach(loc => {
          const opt = document.createElement("option");
          opt.value = String(loc.id);
          opt.textContent = loc.name;
          storeSelect.appendChild(opt);
        });

        const match = locations.find(
          loc =>
            String(loc.netsuite_internal_id) === String(nsStoreId) ||
            String(loc.invoice_location_id) === String(nsStoreId)
        );
        if (match) {
          storeSelect.value = String(match.id);
          console.log(`✅ Store mapped: NS ${nsStoreId} → local ${match.id} (${match.name})`);
        } else {
          console.warn("⚠️ No Store match for NS id:", nsStoreId);
        }
      } catch (err) {
        console.error("❌ Failed to load locations:", err);
      }
    }

    /* ==========================
       OTHER ORDER FIELDS
    ========================== */
    document.querySelector('select[name="leadSource"]').value = quote.leadSource?.id || "";
    document.querySelector("#paymentInfo").value = quote.custbody_sb_paymentinfo?.id || "";
    document.querySelector("#warehouse").value = quote.custbody_sb_warehouse?.id || "";

    /* ==========================
       QUOTE ITEMS
    ========================== */
    document.getElementById("orderNumber").textContent = quote.tranId || tranId;
    const tbody = document.getElementById("orderItemsBody");
    tbody.innerHTML = "";

    if (Array.isArray(quote.item?.items)) {
      quote.item.items.forEach(line => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${line.item?.refName || "—"}</td>
          <td>${line.custcol_sb_itemoptionsdisplay || ""}</td>
          <td class="qty">${line.quantity || 0}</td>
          <td class="amount">£${parseFloat(line.amount * line.quantity || 0).toFixed(2)}</td>
          <td class="discount">${
            (() => {
              const retailGross = Number(line.amount * line.quantity) || 0;
              const saleGross = Number(line.saleprice) || 0;
              if (retailGross <= 0) return "0%";
              const pct = ((retailGross - saleGross) / retailGross) * 100;
              return `${Math.max(0, pct).toFixed(1)}%`;
            })()
          }</td>
          <td class="vat">£${parseFloat(line.vat ?? (line.saleprice * 0.2)).toFixed(2)}</td>
          <td class="saleprice">£${(line.saleprice ? parseFloat(line.saleprice).toFixed(2) : "0.00")}</td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      const empty = document.createElement("tr");
      empty.innerHTML = `<td colspan="7" style="text-align:center; color:#888;">No item lines found.</td>`;
      tbody.appendChild(empty);
    }

    // Lock inputs
    document.querySelectorAll("input, select, textarea, button").forEach(el => {
      el.disabled = true;
      el.classList.add("locked-input");
    });

    setTimeout(updateQuoteSummaryFromTable, 200);
    updateActionButton(quote.status || {}, tranId, quote);

  } catch (err) {
    alert("Failed to load Quote details. " + err.message);
  } finally {
    setTimeout(() => overlay?.classList.add("hidden"), 300);
  }
});

/* === Helper to parse JSON or throw with status === */
async function resOrJson(resp) {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} ${resp.statusText} — ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/* === Helper: Update Summary === */
function updateQuoteSummaryFromTable() {
  const rows = document.querySelectorAll("#orderItemsBody tr");
  if (!rows.length) return;

  let subtotal = 0, discountTotal = 0, taxTotal = 0, grandTotal = 0;
  rows.forEach(row => {
    const amountEl = row.querySelector(".amount");
    const discountEl = row.querySelector(".discount");
    const vatEl = row.querySelector(".vat");
    const saleEl = row.querySelector(".saleprice");
    if (!amountEl || !saleEl) return;

    const amount = parseFloat(amountEl.textContent.replace(/[£,]/g, "")) || 0;
    const vat = parseFloat(vatEl?.textContent.replace(/[£,]/g, "")) || 0;
    const sale = parseFloat(saleEl?.textContent.replace(/[£,]/g, "")) || 0;
    const discountPct =
      discountEl && discountEl.textContent.includes("%")
        ? parseFloat(discountEl.textContent)
        : 0;
    const discountValue = (amount * discountPct) / 100;

    subtotal += amount;
    discountTotal += discountValue;
    taxTotal += vat;
    grandTotal += sale;
  });

  document.getElementById("subTotal").textContent = `£${subtotal.toFixed(2)}`;
  document.getElementById("discountTotal").textContent = `£${discountTotal.toFixed(2)}`;
  document.getElementById("taxTotal").textContent = `£${taxTotal.toFixed(2)}`;
  document.getElementById("grandTotal").textContent = `£${grandTotal.toFixed(2)}`;
}

/* === Spinner Controls === */
function showQuoteSpinner() {
  document.getElementById("quoteConvertSpinner")?.classList.remove("hidden");
}
function hideQuoteSpinner() {
  document.getElementById("quoteConvertSpinner")?.classList.add("hidden");
}

/* === Action Button (Convert to Sale) === */
function updateActionButton(statusObj, tranId, quote) {
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;
  wrapper.innerHTML = "";

  const btnId = "convertToSaleBtn";
  wrapper.innerHTML = `<button id="${btnId}" class="btn-primary">Convert to Sale</button>`;

  document.getElementById(btnId)?.addEventListener("click", async () => {
    const savedAuth = storageGet();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    try {
      showQuoteSpinner();
      console.log(`🔁 Converting Quote ${tranId} → Sales Order...`);

      const res = await fetch(`/api/netsuite/quote/${tranId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Conversion failed");

      const soId = data.salesOrderId || data.tranId || data.id;
      showToast("✅ Quote converted to Sales Order!", "success");

      setTimeout(() => {
        hideQuoteSpinner();
        if (soId) window.location.href = `/sales/view/${soId}`;
        else window.location.reload();
      }, 1500);
    } catch (err) {
      hideQuoteSpinner();
      console.error("❌ Conversion failed:", err);
      showToast(`❌ ${err.message}`, "error");
    }
  });
}

/* === Toast Utility === */
function showToast(message, type = "success") {
  const toast = document.getElementById("orderToast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `order-toast ${type}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 3000);
}
