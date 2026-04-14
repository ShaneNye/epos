// public/js/quoteNew.js
console.log("✅ quoteNew.js loaded and running");

window.addEventListener("error", (e) =>
  console.error("💥 Uncaught error:", e.error || e.message)
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("💥 Unhandled Promise rejection:", e.reason)
);

if (window.location.pathname.includes("/quote/view/")) {
  console.log("🔕 quoteNew.js fully disabled — Quote View mode");
} else {
  document.addEventListener("DOMContentLoaded", async () => {
    let saved = storageGet?.();
    if (!saved || !saved.token) return (window.location.href = "/index.html");

    const headers = { Authorization: `Bearer ${saved.token}` };
    let currentUser = null;

    const form = document.querySelector(".form-scroll");
    const spinner = document.getElementById("orderSpinner");
    const toast = document.getElementById("orderToast");
    const spinnerText = document.getElementById("orderSpinnerTitle");

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

    window.showToast = window.showToast || showToast;

    try {
      const meRes = await fetch("/api/me", { headers });
      const meData = await meRes.json();

      if (meData.ok && meData.user) {
        currentUser = meData.user;
        console.log("🧑 Current user loaded:", currentUser);
      }
    } catch (err) {
      console.error("Failed to fetch current user:", err);
    }

    try {
      const res = await fetch("/api/users", { headers });
      const data = await res.json();

      if (data.ok) {
        const execSelect = document.getElementById("salesExec");
        if (execSelect) {
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
          }
        }
      }
    } catch (err) {
      console.error("Failed to load sales executives:", err);
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
      console.error("Failed to load stores:", err);
    }

    const stored = localStorage.getItem("selectedCustomer");
    if (stored) {
      try {
        const c = JSON.parse(stored);
        console.log("🧾 Prefilling quote customer from lookup:", c);

        document.querySelector('input[name="firstName"]').value = c["First Name"] || "";
        document.querySelector('input[name="lastName"]').value = c["Last Name"] || "";
        document.querySelector('input[name="email"]').value = c["Email"] || "";
        document.querySelector('input[name="contactNumber"]').value = c["Phone"] || "";
        document.querySelector('input[name="postcode"]').value = c["Postal Code"] || "";
        document.querySelector('input[name="address1"]').value = c["Address 1"] || "";
        document.querySelector('input[name="address2"]').value = c["Address 2"] || "";
        document.querySelector('input[name="address3"]').value = c["Address 3"] || "";

        window.currentCustomerId = c["Internal ID"];
      } catch (err) {
        console.error("❌ Failed to parse stored customer:", err);
      } finally {
        localStorage.removeItem("selectedCustomer");
      }
    }

    window.updateQuoteSummary = function () {
      let grossTotal = 0;
      let discountTotal = 0;

      document.querySelectorAll("#orderItemsBody .order-line").forEach((tr) => {
        const itemId = (tr.querySelector(".item-internal-id")?.value || "").trim();
        if (!itemId) return;

        const qty = parseFloat(tr.querySelector(".item-qty")?.value || 0);
        const baseNetRaw = tr.querySelector(".item-baseprice")?.value;
        const saleGrossRaw = tr.querySelector(".item-saleprice")?.value;
        const discountRaw = tr.querySelector(".item-discount")?.value;

        const baseNet = parseFloat(baseNetRaw);
        const salePriceGrossLine = parseFloat(saleGrossRaw);
        const discountPct = parseFloat(discountRaw || 0) || 0;

        if (!qty || qty <= 0) return;

        const hasBase = Number.isFinite(baseNet);
        const hasSale = Number.isFinite(salePriceGrossLine);

        const defaultGrossLine = hasBase
          ? baseNet * 1.2 * qty
          : hasSale
            ? salePriceGrossLine
            : 0;

        let actualGrossLine;

        if (discountPct > 0 && defaultGrossLine !== 0) {
          actualGrossLine = defaultGrossLine * (1 - discountPct / 100);
        } else if (hasSale) {
          actualGrossLine = salePriceGrossLine;
        } else {
          actualGrossLine = defaultGrossLine;
        }

        actualGrossLine = Number(actualGrossLine.toFixed(2));
        const defaultGrossRounded = Number(defaultGrossLine.toFixed(2));

        grossTotal += actualGrossLine;

        const discountValue = Math.max(0, defaultGrossRounded - actualGrossLine);
        discountTotal += discountValue;
      });

      grossTotal = Number(grossTotal.toFixed(2));
      discountTotal = Number(discountTotal.toFixed(2));

      const netTotal = Number((grossTotal / 1.2).toFixed(2));
      const taxTotal = Number((grossTotal - netTotal).toFixed(2));

      document.getElementById("subTotal").textContent = `£${netTotal.toFixed(2)}`;
      document.getElementById("discountTotal").textContent = `£${discountTotal.toFixed(2)}`;
      document.getElementById("taxTotal").textContent = `£${taxTotal.toFixed(2)}`;
      document.getElementById("grandTotal").textContent = `£${grossTotal.toFixed(2)}`;

      window.__quoteGrossTotal = grossTotal;
    };

    document.getElementById("orderItemsBody")?.addEventListener("input", (e) => {
      if (
        e.target.classList.contains("item-qty") ||
        e.target.classList.contains("item-discount") ||
        e.target.classList.contains("item-saleprice")
      ) {
        window.updateQuoteSummary();
      }
    });

    const orderBody = document.getElementById("orderItemsBody");
    if (orderBody) {
      const bodyObserver = new MutationObserver(() => window.updateQuoteSummary());
      bodyObserver.observe(orderBody, { childList: true, subtree: false });
    }

    window.updateQuoteSummary();
  });

  function validateQuoteBeforeSave() {
    const rows = [...document.querySelectorAll("#orderItemsBody .order-line")];

    const itemRows = rows.filter((r) =>
      (r.querySelector(".item-internal-id")?.value || "").trim()
    );

    if (itemRows.length === 0) {
      alert("⚠️ Please add at least one item to the quote before saving.");
      return false;
    }

    rows.forEach((r) => r.classList.remove("row-error"));
    rows.forEach((r) => {
      r.querySelectorAll(".field-error").forEach((el) =>
        el.classList.remove("field-error")
      );
    });

    let ok = true;
    const errors = [];

    itemRows.forEach((row, idx) => {
      const lineNo = row.getAttribute("data-line") ?? String(idx + 1);

      const qtyEl = row.querySelector(".item-qty");
      const qty = parseFloat(qtyEl?.value || 0);

      if (!qty || qty <= 0) {
        ok = false;
        errors.push(`• Line ${lineNo}: Quantity must be greater than 0.`);
        row.classList.add("row-error");
        if (qtyEl) qtyEl.classList.add("field-error");
      }

      const baseRaw = row.querySelector(".item-baseprice")?.value;
      const saleRaw = row.querySelector(".item-saleprice")?.value;
      const baseNet = parseFloat(baseRaw);
      const saleGross = parseFloat(saleRaw);

      if (!Number.isFinite(baseNet) && !Number.isFinite(saleGross)) {
        console.warn(`⚠️ Line ${lineNo} has no valid base price or sale price`);
      }
    });

    if (!ok) alert("Please fix the following before saving:\n\n" + errors.join("\n"));
    return ok;
  }

  document.addEventListener("click", async (e) => {
    const btn = e.target;
    if (!(btn instanceof HTMLElement)) return;

    if (btn.classList.contains("btn-primary") && btn.textContent.trim() === "Save Quote") {
      e.preventDefault();

      if (!validateQuoteBeforeSave()) return;

      const savedAuth = storageGet?.();
      const token = savedAuth?.token;
      if (!token) return (window.location.href = "/index.html");

      const customer = {
        id: window.currentCustomerId || null,
        title: document.querySelector('select[name="title"]')?.value || "",
        firstName: document.querySelector('input[name="firstName"]')?.value || "",
        lastName: document.querySelector('input[name="lastName"]')?.value || "",
        postcode: document.querySelector('input[name="postcode"]')?.value || "",
        address1: document.querySelector('input[name="address1"]')?.value || "",
        address2: document.querySelector('input[name="address2"]')?.value || "",
        contactNumber: document.querySelector('input[name="contactNumber"]')?.value || "",
        altContactNumber: document.querySelector('input[name="altContactNumber"]')?.value || "",
        email: document.querySelector('input[name="email"]')?.value || "",
      };

      const order = {
        salesExec: document.getElementById("salesExec")?.value || "",
        store: document.getElementById("store")?.value || "",
        leadSource: document.querySelector('select[name="leadSource"]')?.value || "",
        paymentInfo: document.getElementById("paymentInfo")?.value || "",
        warehouse: document.getElementById("warehouse")?.value || "",
      };

      const items = [...document.querySelectorAll("#orderItemsBody .order-line")]
        .map((tr) => {
          const item = (tr.querySelector(".item-internal-id")?.value || "").trim();
          if (!item) return null;

          const quantity = parseFloat(tr.querySelector(".item-qty")?.value || 0);
          const amount = parseFloat(tr.querySelector(".item-saleprice")?.value || 0);

          const optsEl = tr.querySelector(".options-summary");
          const options = optsEl ? (optsEl.innerText || "").trim() : "";

          const trialSel = tr.querySelector(".sixty-night-select");
          const trialOption = (trialSel?.value || "").trim();

          return {
            item,
            quantity,
            amount: Number.isFinite(amount) ? amount : 0,
            options,
            trialOption,
          };
        })
        .filter(Boolean);

      await submitQuote({ customer, order, items });
    }
  });

  async function submitQuote(quotePayload) {
    const form = document.querySelector(".form-scroll");
    const spinner = document.getElementById("orderSpinner");
    const toast = document.getElementById("orderToast");
    const spinnerText = document.getElementById("orderSpinnerTitle");

    const lockForm = (title = "Creating quote…") => {
      if (form) form.classList.add("locked");
      if (spinner) spinner.classList.remove("hidden");
      if (toast) toast.classList.add("hidden");
      if (spinnerText) spinnerText.textContent = title;
    };

    const unlockForm = () => {
      if (form) form.classList.remove("locked");
      if (spinner) spinner.classList.add("hidden");
    };

    const showToast = window.showToast || function (message, type = "success") {
      if (!toast) return;
      toast.textContent = message;
      toast.className = `order-toast ${type}`;
      toast.classList.remove("hidden");
      setTimeout(() => toast.classList.add("show"), 10);
      setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.classList.add("hidden"), 300);
      }, 3000);
    };

    try {
      lockForm("Creating quote…");
      console.log("📦 Sending quote payload:", quotePayload);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const savedAuth = storageGet?.();
      const token = savedAuth?.token;

      const res = await fetch("/api/netsuite/quote/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(quotePayload),
      });

      const data = await res.json();
      console.log("🪵 [Quote API Response]", data);

      if (!res.ok || !data.ok) {
        const msg = data?.error || `Quote creation failed (HTTP ${res.status})`;
        console.error("❌ Quote failed:", msg);
        showToast(`❌ ${msg}`, "error");
        return;
      }

      const quoteId = data.quoteId || data.estimateId || data.id || null;
      const tranId = data.tranId || data.response?.tranId || null;

      if (quoteId) localStorage.setItem("currentQuoteId", quoteId);
      if (tranId) localStorage.setItem("currentQuoteTranId", tranId);

      showToast(
        `✅ Quote ${tranId || quoteId} created successfully! Redirecting...`,
        "success"
      );

      if (savedAuth && savedAuth.token) {
        localStorage.setItem("eposAuth", JSON.stringify(savedAuth));
      }

      setTimeout(() => {
        if (tranId) {
          window.location.href = `/quote/view/${tranId}`;
        } else if (quoteId) {
          window.location.href = `/quote/view/${quoteId}`;
        } else {
          window.location.href = "/home";
        }
      }, 1500);
    } catch (err) {
      console.error("❌ Error submitting quote:", err);
      (window.showToast || alert)("❌ Something went wrong while creating the quote.", "error");
    } finally {
      unlockForm();
    }
  }
}