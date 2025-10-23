// public/js/quoteNew.js
console.log("✅ quoteNew.js loaded and running");

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

      data.locations.forEach((loc) => {
        const opt = document.createElement("option");
        opt.value = String(loc.id);
        opt.textContent = loc.name;
        storeSelect.appendChild(opt);
      });

      if (currentUser && currentUser.primaryStore) {
        const match = data.locations.find(
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

  /* === QUOTE SUMMARY CALCULATIONS === */
  window.updateQuoteSummary = function () {
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

    document.getElementById("subTotal").textContent = `£${netTotal.toFixed(2)}`;
    document.getElementById("discountTotal").textContent = `£${discountTotal.toFixed(2)}`;
    document.getElementById("taxTotal").textContent = `£${taxTotal.toFixed(2)}`;
    document.getElementById("grandTotal").textContent = `£${grossTotal.toFixed(2)}`;
  };

  document.getElementById("orderItemsBody")?.addEventListener("input", (e) => {
    if (
      e.target.classList.contains("item-qty") ||
      e.target.classList.contains("item-discount") ||
      e.target.classList.contains("item-saleprice")
    ) {
      updateQuoteSummary();
    }
  });

  const bodyObserver = new MutationObserver(updateQuoteSummary);
  bodyObserver.observe(document.getElementById("orderItemsBody"), { childList: true });

  updateQuoteSummary();
});

/* === SAVE QUOTE HANDLER === */
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("btn-primary") && e.target.textContent.trim() === "Save Quote") {
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

    // ✅ Quote line collector (safe & simplified for quotes)
    const items = [...document.querySelectorAll("#orderItemsBody .order-line")].map((tr) => {
      const idEl = tr.querySelector(".item-internal-id");
      const qtyEl = tr.querySelector(".item-qty");
      const priceEl = tr.querySelector(".item-saleprice");
      const optsEl = tr.querySelector(".options-summary");

      return {
        item: idEl ? idEl.value : "",
        quantity: qtyEl ? parseFloat(qtyEl.value || 0) : 0,
        amount: priceEl ? parseFloat(priceEl.value || 0) : 0,
        options: optsEl ? optsEl.innerText : ""
      };
    }).filter(line => line.item); // 🚫 filter out blank rows

    const body = { customer, order, items };
    await submitQuote(body);
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

/* === SUBMIT QUOTE === */
async function submitQuote(quotePayload) {
  try {
    lockForm();
    console.log("📦 Sending quote payload:", quotePayload);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // 🔐 Fetch stored auth again
    const savedAuth = storageGet();
    const token = savedAuth?.token;

    const res = await fetch("/api/netsuite/quote/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`, // ✅ include this header
      },
      body: JSON.stringify(quotePayload),
    });

    const data = await res.json();
    console.log("🪵 [Quote API Response]", data);

    if (!data.ok) {
      console.error("❌ Quote failed:", data.error);
      showToast(`❌ ${data.error || "Quote creation failed"}`, "error");
      unlockForm();
      return;
    }

    const quoteId = data.quoteId || data.estimateId || null;
    const tranId = data.tranId || data.response?.tranId || null;

    if (quoteId) localStorage.setItem("currentQuoteId", quoteId);
    if (tranId) localStorage.setItem("currentQuoteTranId", tranId);

    showToast(`✅ Quote ${tranId || quoteId} created successfully! Redirecting...`, "success");

    if (savedAuth && savedAuth.token) {
      localStorage.setItem("eposAuth", JSON.stringify(savedAuth));
      console.log("💾 Promoted session token to localStorage for redirect persistence");
    }

    setTimeout(() => {
      if (tranId) {
        console.log(`➡️ Redirecting to /quote/view/${tranId}`);
        window.location.href = `/quote/view/${tranId}`;
      } else if (quoteId) {
        console.log(`➡️ Redirecting to /quote/view/${quoteId}`);
        window.location.href = `/quote/view/${quoteId}`;
      } else {
        console.warn("⚠️ No tranId or quoteId found — redirecting to /home as fallback");
        window.location.href = "/home";
      }
    }, 1500);
  } catch (err) {
    console.error("❌ Error submitting quote:", err);
    showToast("❌ Something went wrong while creating the quote.", "error");
  } finally {
    unlockForm();
  }
}

