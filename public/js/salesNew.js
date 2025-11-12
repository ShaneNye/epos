console.log("✅ salesNew.js loaded and running");


document.addEventListener("DOMContentLoaded", async () => {
  const saved = storageGet(); // from main.js
  if (!saved || !saved.token) return (window.location.href = "/index.html");

  const headers = { Authorization: `Bearer ${saved.token}` };
  let currentUser = null;

  /* === Load Current User === */
  try {
    const meRes = await fetch("/api/me", { headers });
    const meData = await meRes.json();

    if (meData.ok && meData.user) {
      currentUser = meData.user;
      console.log("🧑 Current user loaded:", currentUser);
      console.log("📦 User primaryStore:", currentUser.primaryStore);
    } else {
      console.warn("⚠️ No user data returned from /api/me");
    }
  } catch (err) {
    console.error("Failed to fetch current user:", err);
  }

  /* === Load Sales Executives === */
  try {
    const res = await fetch("/api/users", { headers });
    const data = await res.json();

    if (data.ok) {
      const execSelect = document.getElementById("salesExec");
      execSelect.innerHTML = '<option value="">Select Sales Executive</option>';

      const salesExecs = data.users.filter(
        (u) =>
          Array.isArray(u.roles) &&
          u.roles.some((r) => r.name === "Sales Executive")
      );

      salesExecs.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = `${u.firstName} ${u.lastName}`;
        execSelect.appendChild(opt);
      });

      if (currentUser && salesExecs.some((u) => u.id === currentUser.id)) {
        execSelect.value = currentUser.id;
        console.log(
          `✅ Default Sales Executive set to: ${currentUser.firstName} ${currentUser.lastName}`
        );
      }
    }
  } catch (err) {
    console.error("Failed to load sales executives:", err);
  }

  /* === Load Stores === */
  try {
    const res = await fetch("/api/meta/locations", { headers });
    const data = await res.json();

    if (data.ok) {
      const storeSelect = document.getElementById("store");
      storeSelect.innerHTML = '<option value="">Select Store</option>';

      const filteredLocations = data.locations.filter(
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

        if (match) {
          storeSelect.value = String(match.id);
          console.log(`🏪 Default store set to: ${match.name} (ID: ${match.id})`);
        } else {
          console.warn(
            `⚠️ No store match found for primaryStore: ${currentUser.primaryStore}`
          );
        }
      }
    }
  } catch (err) {
    console.error("Failed to load stores:", err);
  }

  // ✅ Move Prefill HERE — runs after user + store are ready
  const stored = localStorage.getItem("selectedCustomer");
  if (stored) {
    try {
      const c = JSON.parse(stored);
      console.log("🧾 Prefilling customer from lookup:", c);

      document.querySelector('input[name="firstName"]').value = c["First Name"] || "";
      document.querySelector('input[name="lastName"]').value  = c["Last Name"] || "";
      document.querySelector('input[name="email"]').value     = c["Email"] || "";
      document.querySelector('input[name="contactNumber"]').value = c["Phone"] || "";
      document.querySelector('input[name="postcode"]').value  = c["Postal Code"] || "";
      document.querySelector('input[name="address1"]').value  = c["Address 1"] || "";
      document.querySelector('input[name="address2"]').value  = c["Address 2"] || "";
      document.querySelector('input[name="address3"]').value  = c["Address 3"] || "";

      window.currentCustomerId = c["Internal ID"];
    } catch (err) {
      console.error("❌ Failed to parse stored customer:", err);
    } finally {
      localStorage.removeItem("selectedCustomer");
    }
  }



  /* === ORDER SUMMARY CALCULATIONS === */
  window.updateOrderSummary = function () {
    let netTotal = 0;
    let discountTotal = 0;
    let grossTotal = 0;

    document.querySelectorAll("#orderItemsBody .order-line").forEach((tr) => {
      const qty = parseFloat(tr.querySelector(".item-qty")?.value || 0);
      const base = parseFloat(tr.querySelector(".item-baseprice")?.value || 0);
      const discountPct = parseFloat(tr.querySelector(".item-discount")?.value || 0);
      const salePriceGross = parseFloat(tr.querySelector(".item-saleprice")?.value || 0);

      if (qty > 0 && (salePriceGross > 0 || base > 0)) {
        const grossLineTotal = salePriceGross > 0
          ? salePriceGross * qty
          : base * qty * 1.2;
        const netLineTotal = grossLineTotal / 1.2;
        const retailGrossTotal = base * qty * 1.2;
        const discountValue = retailGrossTotal * (discountPct / 100);

        discountTotal += discountValue;
        netTotal += netLineTotal;
        grossTotal += grossLineTotal;
      }
    });

    const taxTotal = grossTotal - netTotal;
    const totalDeposits = deposits.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
    const outstandingBalance = grossTotal - totalDeposits;

    document.getElementById("subTotal").textContent = `£${netTotal.toFixed(2)}`;
    document.getElementById("discountTotal").textContent = `£${discountTotal.toFixed(2)}`;
    document.getElementById("taxTotal").textContent = `£${taxTotal.toFixed(2)}`;
    document.getElementById("grandTotal").textContent = `£${grossTotal.toFixed(2)}`;

    const depositsTotalCell = document.getElementById("depositsTotal");
    const balanceCell = document.getElementById("outstandingBalance");
    if (depositsTotalCell) depositsTotalCell.textContent = `£${totalDeposits.toFixed(2)}`;
    if (balanceCell) balanceCell.textContent = `£${outstandingBalance.toFixed(2)}`;
  };

  document.getElementById("orderItemsBody")?.addEventListener("input", (e) => {
    if (
      e.target.classList.contains("item-qty") ||
      e.target.classList.contains("item-discount") ||
      e.target.classList.contains("item-saleprice")
    ) {
      updateOrderSummary();
    }
  });

  const bodyObserver = new MutationObserver(updateOrderSummary);
  bodyObserver.observe(document.getElementById("orderItemsBody"), { childList: true });

  updateOrderSummary();
});

/* === CUSTOMER DEPOSITS === */
let deposits = [];

window.onDepositSaved = function (deposit) {
  deposits.push(deposit);
  renderDeposits();
  updateOrderSummary();
};

function renderDeposits() {
  const section = document.getElementById("depositsSection");
  const tbody = document.querySelector("#depositsTable tbody");
  if (!tbody) return;
  if (deposits.length > 0) section.style.display = "block";

  tbody.innerHTML = "";
  deposits.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${d.method}</td><td>£${parseFloat(d.amount).toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });
  if (typeof updateOrderSummary === "function") updateOrderSummary();
}

document.getElementById("addDepositBtn")?.addEventListener("click", () => {
  const win = window.open("/deposit.html", "AddDeposit", "width=400,height=300,resizable=yes,scrollbars=no");
  win.focus();
});

/* === SAVE ORDER HANDLER (toast + spinner integrated) === */
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("btn-primary") && e.target.textContent.trim() === "Save Order") {
    e.preventDefault();

    const customer = {
      id: window.currentCustomerId || null,
      title: document.querySelector('select[name="title"]').value,
      firstName: document.querySelector('input[name="firstName"]').value,
      lastName: document.querySelector('input[name="lastName"]').value,
      postcode: document.querySelector('input[name="postcode"]').value,
      address1: document.querySelector('input[name="address1"]').value,
      address2: document.querySelector('input[name="address2"]').value,
      contactNumber: document.querySelector('input[name="contactNumber"]').value,
      altContactNumber: document.querySelector('input[name="altContactNumber"]').value,
      email: document.querySelector('input[name="email"]').value,
    };

    const order = {
      salesExec: document.getElementById("salesExec").value,
      store: document.getElementById("store").value,
      leadSource: document.querySelector('select[name="leadSource"]').value,
      paymentInfo: document.getElementById("paymentInfo").value,
      warehouse: document.getElementById("warehouse").value,
    };

const items = [...document.querySelectorAll("#orderItemsBody .order-line")].map((tr) => {
  const item = tr.querySelector(".item-internal-id").value;
  const quantity = parseFloat(tr.querySelector(".item-qty").value || 0);
  const amount = parseFloat(tr.querySelector(".item-saleprice").value || 0);
  const options = tr.querySelector(".options-summary")?.innerText || "";
  const fulfilmentMethod = tr.querySelector(".item-fulfilment").value;

  // ✅ Pull data attributes from modal logic
  const lotnumber = tr.dataset.lotnumber || "";
  const inventoryMeta = tr.dataset.inventoryMeta || "";

  console.log("🧩 Building line for NetSuite:", {
    item,
    quantity,
    amount,
    lotnumber,
    hasMeta: !!inventoryMeta,
  });

  return {
    item,
    quantity,
    amount,
    options,
    fulfilmentMethod,
    lotnumber,
    inventoryMeta,
  };
});



const body = { customer, order, items, deposits };
console.log("💰 Including deposits in payload:", deposits);
await submitOrder(body);

  }
});

/* === Spinner + Toast Controls === */
const form = document.querySelector(".form-scroll");
const spinner = document.getElementById("orderSpinner");
const toast = document.getElementById("orderToast");

function lockForm() {
  if (form) form.classList.add("locked");
  if (spinner) spinner.classList.remove("hidden");
  if (toast) toast.classList.add("hidden");
}

function unlockForm() {
  if (form) form.classList.remove("locked");
  if (spinner) spinner.classList.add("hidden");
}

function showToast(message, type = "success") {
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

// public/js/salesNew.js
async function submitOrder(orderPayload) {
  try {
    lockForm();
    console.log("📦 Sending order payload:", orderPayload);

    // Small delay for UI polish
    await new Promise((resolve) => setTimeout(resolve, 50));
// 🧩 Include session token for authenticated NetSuite calls
const saved = storageGet();
const headers = {
  "Content-Type": "application/json",
  ...(saved?.token ? { Authorization: `Bearer ${saved.token}` } : {}),
};

if (!saved?.token) {
  console.warn("⚠️ No session token found — request may fail with 401");
}

console.log("📡 Sending order request with headers:", headers);

const res = await fetch("/api/netsuite/salesorder/create", {
  method: "POST",
  headers,
  body: JSON.stringify(orderPayload),
});


    const data = await res.json();
    console.log("🪵 [API Response]", data);

    if (!data.ok) {
      console.error("❌ Order failed:", data.error);
      showToast(`❌ ${data.error || "Order creation failed"}`, "error");
      unlockForm();
      return;
    }

    // ✅ Extract identifiers
    const soId = data.salesOrderId || null;
    const tranId = data.tranId || data.response?.tranId || null;

    // ✅ Cache locally for reference
    if (soId) localStorage.setItem("currentSalesOrderId", soId);
    if (tranId) localStorage.setItem("currentSalesOrderTranId", tranId);

    // ✅ Notify and redirect
    showToast(`✅ Order ${tranId || soId} created successfully! Redirecting...`, "success");

    // ✅ Persist authentication before redirect (fix logout issue)
    const savedAuth = storageGet();
    if (savedAuth && savedAuth.token) {
      localStorage.setItem("eposAuth", JSON.stringify(savedAuth));
      console.log("💾 Promoted session token to localStorage for redirect persistence");
    } else {
      console.warn("⚠️ No auth token found to persist before redirect");
    }

    // ✅ Redirect to the new Sales Order view
    setTimeout(() => {
      if (tranId) {
        console.log(`➡️ Redirecting to /sales/view/${tranId}`);
        window.location.href = `/sales/view/${tranId}`;
      } else if (soId) {
        console.log(`➡️ Redirecting to /sales/view/${soId}`);
        window.location.href = `/sales/view/${soId}`;
      } else {
        console.warn("⚠️ No tranId or soId found — redirecting to /home as fallback");
        window.location.href = "/home";
      }
    }, 1500);
  } catch (err) {
    console.error("❌ Error submitting order:", err);
    showToast("❌ Something went wrong while creating the order.", "error");
  } finally {
    unlockForm();
  }
}







