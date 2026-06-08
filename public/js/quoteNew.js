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
  function normalizeNameFieldValue(value) {
    const cleaned = String(value || "").trim();
    if (!cleaned) return "";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }

  function normalizeCustomerNameField(field) {
    if (!field) return;
    field.value = normalizeNameFieldValue(field.value);
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  document.addEventListener("DOMContentLoaded", async () => {
    let saved = storageGet?.();
    if (!saved || !saved.token) {
      const next = `${window.location.pathname}${window.location.search || ""}`;
      sessionStorage.setItem("eposLoginNext", next);
      return (window.location.href = `/index.html?next=${encodeURIComponent(next)}`);
    }

    const headers = { Authorization: `Bearer ${saved.token}` };
    let currentUser = null;
    window.EposTransactionCustomFields?.load("quote", {
      headers,
      emptyMessage: "No custom fields are visible for this quote.",
    });

    const form = document.querySelector(".form-scroll");
    const spinner = document.getElementById("orderSpinner");
    const toast = document.getElementById("orderToast");
    const spinnerText = document.getElementById("orderSpinnerTitle");

    ["firstName", "lastName"].forEach((name) => {
      const field = document.querySelector(`input[name="${name}"]`);
      field?.addEventListener("blur", () => normalizeCustomerNameField(field));
    });

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
      let netTotal = 0;
      let taxTotal = 0;

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
        const vatFree = !!tr.querySelector(".vat-free-checkbox")?.checked;

        if (!qty || qty <= 0) return;

        const hasBase = Number.isFinite(baseNet);
        const hasSale = Number.isFinite(salePriceGrossLine);

        const defaultGrossLine = hasBase
          ? baseNet * 1.2 * qty
          : hasSale
            ? salePriceGrossLine
            : 0;

        let actualGrossLine;

        if (hasSale) {
          actualGrossLine = salePriceGrossLine;
        } else if (discountPct > 0 && defaultGrossLine !== 0) {
          actualGrossLine = defaultGrossLine * (1 - discountPct / 100);
        } else {
          actualGrossLine = defaultGrossLine;
        }

        actualGrossLine = Number(actualGrossLine.toFixed(2));
        const defaultGrossRounded = Number(defaultGrossLine.toFixed(2));

        grossTotal += actualGrossLine;
        if (vatFree) {
          netTotal += actualGrossLine;
        } else {
          const lineNet = Number((actualGrossLine / 1.2).toFixed(2));
          netTotal += lineNet;
          taxTotal += Number((actualGrossLine - lineNet).toFixed(2));
        }

        const discountValue = Math.max(0, defaultGrossRounded - actualGrossLine);
        discountTotal += discountValue;
      });

      grossTotal = Number(grossTotal.toFixed(2));
      discountTotal = Number(discountTotal.toFixed(2));
      netTotal = Number(netTotal.toFixed(2));
      taxTotal = Number(taxTotal.toFixed(2));

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

    document.getElementById("orderItemsBody")?.addEventListener("change", (e) => {
      if (e.target.classList.contains("vat-free-checkbox")) {
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
    const firstNameField = document.querySelector('input[name="firstName"]');
    const lastNameField = document.querySelector('input[name="lastName"]');
    const emailField = document.querySelector('input[name="email"]');
    normalizeCustomerNameField(firstNameField);
    normalizeCustomerNameField(lastNameField);

    if (!isValidEmail(emailField?.value || "")) {
      alert("Please enter a valid email address.");
      emailField?.focus();
      return false;
    }

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
      const trialSelect = row.querySelector(".sixty-night-select");
      const trialVisible =
        trialSelect &&
        trialSelect.offsetParent !== null &&
        trialSelect.closest(".sixty-night-cell")?.style.display !== "none";

      if (trialVisible && !(trialSelect.value || "").trim()) {
        ok = false;
        errors.push(`â€¢ Line ${lineNo}: 60 Night Trial is required.`);
        row.classList.add("row-error");
        trialSelect.classList.add("field-error");
      }

      if (!Number.isFinite(baseNet) && !Number.isFinite(saleGross)) {
        console.warn(`⚠️ Line ${lineNo} has no valid base price or sale price`);
      }
    });

    if (!ok) alert("Please fix the following before saving:\n\n" + errors.join("\n"));
    return ok;
  }

  function selectedText(selector) {
    const el = typeof selector === "string" ? document.querySelector(selector) : selector;
    return el?.options?.[el.selectedIndex]?.textContent?.trim() || "";
  }

  function moneyValue(value) {
    return parseFloat(String(value || "0").replace(/[\u00a3,]/g, "")) || 0;
  }

  function buildPendingReceiptPayload(quotePayload) {
    const receiptItems = [...document.querySelectorAll("#orderItemsBody .order-line")]
      .map((tr) => {
        const itemId = tr.querySelector(".item-internal-id")?.value?.trim();
        if (!itemId) return null;

        const quantity = parseFloat(tr.querySelector(".item-qty")?.value || 0) || 0;
        const saleGrossLine = moneyValue(tr.querySelector(".item-saleprice")?.value);
        const retailGrossLine =
          moneyValue(tr.querySelector(".item-amount")?.value) ||
          ((parseFloat(tr.querySelector(".item-baseprice")?.value || 0) || 0) * 1.2 * quantity);

        return {
          name: tr.querySelector(".item-search")?.value?.trim() || "Item",
          options: tr.querySelector(".options-summary")?.innerText?.trim() || "",
          quantity,
          retailGrossLine,
          saleGrossLine,
        };
      })
      .filter(Boolean);

    return {
      type: "quote",
      customer: quotePayload.customer,
      order: {
        ...quotePayload.order,
        salesExecName: selectedText(document.getElementById("salesExec")),
        storeName: selectedText(document.getElementById("store")),
        paymentInfoName: selectedText(document.getElementById("paymentInfo")),
      },
      items: receiptItems,
      deposits: [],
    };
  }

  function showPendingReceiptButton(type, payload) {
    const pendingId = `pending-${Date.now()}`;
    sessionStorage.setItem(`eposPendingReceipt:${pendingId}`, JSON.stringify(payload));

    let button = document.getElementById("pendingReceiptPrintBtn");
    if (!button) {
      button = document.createElement("button");
      button.id = "pendingReceiptPrintBtn";
      button.type = "button";
    }

    button.className = "btn-secondary";
    button.removeAttribute("style");

    const actions = document.querySelector(".actions");
    const saveButton = [...(actions?.querySelectorAll("button") || [])].find(
      (entry) => entry.textContent.trim() === "Save Quote"
    );
    if (actions && button.parentElement !== actions) {
      actions.insertBefore(button, saveButton || null);
    }

    button.hidden = false;
    button.textContent = "Print Receipt";
    button.onclick = () => {
      const url = type === "quote" ? `/quote/receipt/${pendingId}` : `/sales/reciept/${pendingId}`;
      const win = window.open(url, "_blank");
      if (!win) alert("Please allow popups for this site to print the receipt.");
      else win.focus();
    };
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
        title: document.querySelector('select[name="title"]')?.value || null,
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
          const trialOption = (trialSel?.value || "").trim() || null;
          const vatFree = !!tr.querySelector(".vat-free-checkbox")?.checked;

          return {
            item,
            quantity,
            amount: Number.isFinite(amount) ? amount : 0,
            options,
            trialOption,
            taxCode: vatFree ? "10" : "",
          };
        })
        .filter(Boolean);

      const customFields = window.EposTransactionCustomFields?.collect?.() || [];
      const quotePayload = { customer, order, items, customFields };
      showPendingReceiptButton("quote", buildPendingReceiptPayload(quotePayload));
      await submitQuote(quotePayload);
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
      window.SalesOrderExperienceFeedback?.show?.("quote");
      if (toast) toast.classList.add("hidden");
      if (spinnerText) spinnerText.textContent = title;
    };

    const unlockForm = () => {
      if (form) form.classList.remove("locked");
      if (spinner) spinner.classList.add("hidden");
      window.SalesOrderExperienceFeedback?.hide?.();
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
      await window.SalesOrderExperienceFeedback?.flush?.({ documentType: "quote" });

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
      }, 250);
    } catch (err) {
      console.error("❌ Error submitting quote:", err);
      (window.showToast || alert)("❌ Something went wrong while creating the quote.", "error");
    } finally {
      unlockForm();
    }
  }
}
