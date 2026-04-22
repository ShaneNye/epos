// public/js/salesOrderView.js

// Lightweight global crash sniffers
window.addEventListener("error", (e) =>
  console.error("💥 Uncaught error:", e.error || e.message)
);
window.addEventListener("unhandledrejection", (e) =>
  console.error("💥 Unhandled Promise rejection:", e.reason)
);

/* =====================================================
   Shared item cache loader
===================================================== */
async function loadItemCache() {
  try {
    if (window.nsItemFeedCache?.getItems) {
      const items = await window.nsItemFeedCache.getItems();
      window.items = items;
      console.log("✅ Items loaded from shared cache:", items.length);
      return items;
    }

    console.warn("⚠️ nsItemFeedCache missing - falling back to direct fetch");
    const res = await fetch("/api/netsuite/items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = data.results || [];
    window.items = items;

    console.log("✅ Items loaded from API fallback:", items.length);
    return items;
  } catch (err) {
    console.error("❌ Failed to load items cache:", err.message || err);
    window.items = [];
    return [];
  }
}

/* ==========================================================
   TOAST NOTIFICATION
========================================================== */
(function () {
  const toast = document.getElementById("orderToast");
  if (!toast) return;

  window.showToast = function (message, type = "success") {
    toast.textContent = message;
    toast.className = `order-toast ${type}`;
    toast.classList.remove("hidden");

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.classList.add("hidden"), 300);
    }, 3000);
  };
})();

/* =====================================================
   Main Sales Order View Loader
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("💡 SalesOrderView init");

  function normaliseStoreName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isDistributionStoreName(name) {
    const normalised = normaliseStoreName(name);
    return normalised === "distribution ltd" || normalised.includes("distribution ltd");
  }

  function syncDistributionOrderTypeVisibility() {
    const wrapper = document.getElementById("distributionOrderTypeWrapper");
    const select = document.getElementById("distributionOrderType");
    const storeSelect = document.getElementById("store");
    if (!wrapper || !select || !storeSelect) return;

    const selectedOption = storeSelect.options[storeSelect.selectedIndex];
    const selectedStoreName =
      selectedOption?.dataset?.storeName ||
      selectedOption?.textContent?.trim() ||
      "";
    const show =
      selectedOption?.dataset?.distributionStore === "true" ||
      isDistributionStoreName(selectedStoreName);

    wrapper.style.display = show ? "flex" : "none";
    select.disabled = !show;

    if (!show) select.value = "";
  }

  const storeSelect = document.getElementById("store");
  storeSelect?.addEventListener("change", syncDistributionOrderTypeVisibility);
  storeSelect?.addEventListener("input", syncDistributionOrderTypeVisibility);

  const overlay = document.getElementById("loadingOverlay");
  overlay?.classList.remove("hidden");

  // ---- Auth / token ----
  let saved = storageGet?.();
  if (!saved || !saved.token) {
    await new Promise((r) => setTimeout(r, 300));
    saved = storageGet?.();
  }
  if (!saved || !saved.token) {
    console.error("🚫 No auth token – redirecting to login");
    return (window.location.href = "/index.html");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${saved.token}`,
  };

  populateSalesExecAndStore(headers);

  /* =====================================================
     Populate Sales Executive & Store Dropdowns
  ===================================================== */
  async function populateSalesExecAndStore(headers) {
    let currentUser = null;

    try {
      const meRes = await fetch("/api/me", { headers });
      const meData = await meRes.json();
      if (meData.ok && meData.user) {
        currentUser = meData.user;
        console.log("🧑 Current user:", currentUser);
      }
    } catch (err) {
      console.warn("⚠️ Failed to load current user:", err);
    }

    try {
      const res = await fetch("/api/users", { headers });
      const data = await res.json();

      if (data.ok) {
        const execSelect = document.getElementById("salesExec");
        if (execSelect) {
          execSelect.innerHTML = '<option value="">Select Sales Executive</option>';

          const salesExecs = data.users.filter(
            (u) => Array.isArray(u.roles) && u.roles.some((r) => r.name === "Sales Executive")
          );

          salesExecs.forEach((u) => {
            const opt = document.createElement("option");
            opt.value = u.id; // app user id
            opt.textContent = `${u.firstName} ${u.lastName}`;
            execSelect.appendChild(opt);
          });

          if (currentUser && salesExecs.some((u) => u.id === currentUser.id)) {
            execSelect.value = currentUser.id;
            console.log("✔ Auto-set Sales Exec to current user");
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to load sales executives:", err);
    }

    try {
      const res = await fetch("/api/meta/locations", { headers });
      const data = await res.json();

      if (data.ok) {
        const storeSelect = document.getElementById("store");
        if (storeSelect) {
          storeSelect.innerHTML = '<option value="">Select Store</option>';

          const filteredLocations = data.locations.filter(
            (loc) => !/warehouse/i.test(loc.name)
          );

          filteredLocations.forEach((loc) => {
            const opt = document.createElement("option");
            opt.value = String(loc.id);
            opt.textContent = loc.name;
            opt.dataset.storeName = loc.name || "";
            opt.dataset.distributionStore = isDistributionStoreName(loc.name)
              ? "true"
              : "false";
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
              syncDistributionOrderTypeVisibility();
              console.log("✔ Auto-set store to:", match.name);
            }
          }
          syncDistributionOrderTypeVisibility();
        }
      }
    } catch (err) {
      console.error("❌ Failed to load stores:", err);
    }
  }

  // ---- Sales Order ID from URL ----
  const pathParts = window.location.pathname.split("/");
  const tranId = pathParts.pop() || pathParts.pop();
  if (!tranId) {
    alert("No Sales Order ID found in URL.");
    console.error("❌ Missing tranId from URL");
    return;
  }

  try {
    // ==================================================
    // 1️⃣ Load everything in parallel where possible
    // ==================================================
    const [_items, _itemOptions, soRes, locRes, userRes, fulfilRes] = await Promise.all([
      loadItemCache(),
      window.itemOptionsCache?.getAll?.().catch((err) => {
        console.warn("⚠️ Failed to preload item options:", err.message);
        return {};
      }),
      fetch(`/api/netsuite/salesorder/${tranId}?refresh=1`, { headers }),
      fetch("/api/meta/locations", { headers }),
      fetch("/api/users", { headers }),
      fetch("/api/netsuite/fulfilmentmethods").catch(() => null),
    ]);

    const soJson = await soRes.json();
    if (!soRes.ok || !soJson || soJson.ok === false) {
      throw new Error(soJson?.error || `Server returned ${soRes.status}`);
    }

    const so = soJson.salesOrder || soJson;
    if (!so) throw new Error("No salesOrder object in response");
    console.log("✅ Sales Order loaded:", so.tranId || tranId);

    const locJson = locRes.ok ? await locRes.json() : {};
    const locations = locJson.locations || locJson.data || [];

    const userJson = userRes.ok ? await userRes.json() : {};
    const users = userJson.users || userJson.data || [];
    window._salesUsers = users;

    let fulfilmentMethods = [];
    if (fulfilRes && fulfilRes.ok) {
      const fJson = await fulfilRes.json();
      fulfilmentMethods = fJson.results || [];
    }

    window._fulfilmentMap = fulfilmentMethods.map((f) => ({
      id: String(f["Internal ID"] || f.id),
      name: f["Name"] || f.name,
    }));

    // ==================================================
    // 2️⃣ Render Deposits
    // ==================================================
    if (Array.isArray(soJson.deposits) && soJson.deposits.length) {
      window._currentDeposits = soJson.deposits;
      renderDeposits(window._currentDeposits);
    } else {
      window._currentDeposits = [];
    }

    // ==================================================
    // 3️⃣ Populate header + customer + order meta
    // ==================================================
    document.getElementById("orderNumber").textContent = so.tranId || tranId;

    function formatOrderStatus(so) {
      if (typeof so?.status === "string" && so.status.trim()) {
        return so.status.trim();
      }

      if (
        so?.status &&
        typeof so.status === "object" &&
        typeof so.status.refName === "string" &&
        so.status.refName.trim()
      ) {
        return so.status.refName.trim();
      }

      const statusRef =
        (typeof so?.statusRef === "string" && so.statusRef.trim()) ||
        (typeof so?.orderStatus?.refName === "string" && so.orderStatus.refName.trim()) ||
        "";

      if (statusRef) {
        const normalized = statusRef.trim();

        const explicitMap = {
          pendingApproval: "Pending Approval",
          pendingFulfillment: "Pending Fulfillment",
          billed: "Billed",
          cancelled: "Cancelled",
          closed: "Closed",
          pendingBilling: "Pending Billing",
          partiallyFulfilled: "Partially Fulfilled",
          pendingBillingPartFulfilled: "Pending Billing / Partially Fulfilled",
        };

        if (explicitMap[normalized]) {
          return explicitMap[normalized];
        }

        return normalized
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }

      const statusId = String(so?.orderStatus?.id || "")
        .trim()
        .toUpperCase();

      const codeMap = {
        A: "Pending Approval",
        B: "Pending Fulfillment",
        C: "Partially Fulfilled",
        D: "Pending Billing",
        E: "Billed",
        F: "Closed",
        G: "Cancelled",
      };

      return codeMap[statusId] || statusId || "-";
    }

    const orderStatusEl = document.getElementById("orderStatus");
    if (orderStatusEl) {
      orderStatusEl.textContent = formatOrderStatus(so);
    }

    try {
      const fullName = (
        so.entityFull?.firstName && so.entityFull?.lastName
          ? `${so.entityFull.firstName} ${so.entityFull.lastName}`
          : so.entity?.refName || ""
      ).trim();

      document.querySelector('input[name="firstName"]').value =
        so.entityFull?.firstName || fullName.split(" ")[0] || "";

      document.querySelector('input[name="lastName"]').value =
        so.entityFull?.lastName || fullName.split(" ").slice(1).join(" ") || "";

      const addressItems = so.entityFull?.addressbook?.items || [];
      const defaultAddress =
        addressItems.find((a) => a.defaultShipping) ||
        addressItems.find((a) => a.defaultBilling) ||
        addressItems[0] ||
        null;

      const addr = defaultAddress?.addressbookAddress || {};

      if (defaultAddress && addr) {
        document.querySelector('input[name="address1"]').value = addr.addr1 || "";
        document.querySelector('input[name="address2"]').value = addr.addr2 || "";
        document.querySelector('input[name="address3"]').value = addr.city || "";
        document.querySelector('input[name="county"]').value = addr.state || "";
        document.querySelector('input[name="postcode"]').value = addr.zip || "";
        document.querySelector('input[name="country"]').value =
          addr.country?.refName || addr.country || "United Kingdom";
      } else {
        const rawAddress =
          so.shipAddress ||
          so.shippingAddress_text ||
          so.billAddress ||
          so.billingAddress_text ||
          "";

        let addressLines = rawAddress
          ? String(rawAddress).split("\n").map((l) => l.trim()).filter(Boolean)
          : [];

        if (addressLines.length && fullName) {
          const firstLine = addressLines[0].toLowerCase().replace(/\s+/g, " ").trim();
          const compareName = fullName.toLowerCase().replace(/\s+/g, " ").trim();

          if (firstLine === compareName) {
            addressLines.shift();
          }
        }

        const postcodeRegex = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
        let postcode = "";
        let countryLine = "";
        const cleanedAddress = [];

        for (const line of addressLines) {
          if (postcodeRegex.test(line)) {
            const match = line.match(postcodeRegex);
            if (match) postcode = match[0].toUpperCase();

            const townPart = line.replace(postcodeRegex, "").trim();
            if (townPart) cleanedAddress.push(townPart);
          } else if (
            /(United Kingdom|UK|England|Scotland|Wales|Northern Ireland)/i.test(line)
          ) {
            countryLine = line;
          } else {
            cleanedAddress.push(line);
          }
        }

        let address1 = cleanedAddress[0] || "";
        let address2 = cleanedAddress[1] || "";
        let address3 = cleanedAddress[2] || "";
        let county = "";

        if (address3) {
          const countyMatch = address3.match(
            /\b(East Sussex|West Sussex|Kent|Surrey|Essex|Hampshire|London|Greater London|Devon|Cornwall|Dorset|Somerset|Norfolk|Suffolk|Yorkshire|North Yorkshire|South Yorkshire|West Yorkshire|Lancashire|Cheshire)\b$/i
          );

          if (countyMatch) {
            county = countyMatch[1].trim();
            address3 = address3.slice(0, address3.length - county.length).trim();
          }
        }

        document.querySelector('input[name="address1"]').value = address1;
        document.querySelector('input[name="address2"]').value = address2;
        document.querySelector('input[name="address3"]').value = address3;
        document.querySelector('input[name="county"]').value = county;
        document.querySelector('input[name="postcode"]').value = postcode || "";
        document.querySelector('input[name="country"]').value =
          countryLine || "United Kingdom";
      }
    } catch (err) {
      console.warn("⚠️ Address population failed:", err.message);
    }

    document.querySelector('input[name="email"]').value = so.email || "";
    document.querySelector('input[name="contactNumber"]').value =
      so.custbody4 || so.phone || "";
    document.querySelector('input[name="altContactNumber"]').value =
      so.altPhone || "";
    document.querySelector('textarea[name="memo"]').value = so.memo || "";

    try {
      const entity = so.entityFull || {};
      const titleObj = entity.custentity_title || entity.title || null;
      if (titleObj?.id) {
        const titleSelect = document.querySelector('select[name="title"]');
        if (titleSelect) {
          const match = Array.from(titleSelect.options).find(
            (opt) => String(opt.value) === String(titleObj.id)
          );
          if (match) titleSelect.value = titleObj.id;
        }
      }
    } catch (err) {
      console.warn("⚠️ Title population skipped:", err.message);
    }

    try {
      const nsExecId = so.custbody_sb_bedspecialist?.id || null;
      if (nsExecId && users.length) {
        const execMatch = users.find(
          (u) =>
            String(u.netsuiteId || u.netsuiteid || "") === String(nsExecId)
        );
        if (execMatch) document.querySelector("#salesExec").value = execMatch.id;
      }

      const subsidiaryId =
        so.subsidiary?.id || so.location?.id || so.custbody_sb_primarystore?.id || null;

      if (subsidiaryId && locations.length) {
        const storeMatch = locations.find(
          (loc) =>
            String(loc.netsuite_internal_id) === String(subsidiaryId) ||
            String(loc.invoice_location_id) === String(subsidiaryId)
        );
        if (storeMatch) document.querySelector("#store").value = storeMatch.id;
      }

      const distributionTypeSelect = document.getElementById("distributionOrderType");
      if (distributionTypeSelect) {
        distributionTypeSelect.value = so.custbody_sb_is_web_order?.id || "";
      }
      syncDistributionOrderTypeVisibility();

      document.querySelector('select[name="leadSource"]').value = so.leadSource?.id || "";
      document.querySelector("#paymentInfo").value =
        so.custbody_sb_paymentinfo?.id || "";
      document.querySelector("#warehouse").value =
        so.custbody_sb_warehouse?.id || "";
    } catch (err) {
      console.warn("⚠️ Order meta population failed:", err.message);
    }

    try {
      const warehouseSelect = document.getElementById("warehouse");
      if (warehouseSelect) {
        const updateWarehouseCache = () => {
          window.selectedWarehouseId = warehouseSelect.value.trim();
          window.selectedWarehouseName =
            warehouseSelect.options[warehouseSelect.selectedIndex]?.textContent.trim() || "";
        };
        updateWarehouseCache();
        warehouseSelect.addEventListener("change", updateWarehouseCache);
      }
    } catch (err) {
      console.error("❌ Warehouse cache failed:", err.message);
    }

    // ==================================================
    // 4️⃣ Render Item Lines
    // ==================================================
    if (typeof window.renderSalesViewLines !== "function") {
      throw new Error("renderSalesViewLines() not found — did salesViewItemLine.js load?");
    }

    window.renderSalesViewLines({
      so,
      fulfilmentMethods: window._fulfilmentMap || [],
    });

    // ==================================================
    // 6️⃣ Lock / unlock form depending on order status
    // ==================================================
    const isPendingApproval = so.orderStatus?.id === "A";
    const isPendingFulfillment = so.orderStatus?.id === "B";

    if (isPendingApproval) {
      console.log("🔓 Pending approval – unlock editable sales order fields");

      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        const isStoreField = el.id === "store" || el.name === "store";

        const allowEdit =
          el.name === "title" ||
          el.name === "firstName" ||
          el.name === "lastName" ||
          el.name === "email" ||
          el.name === "contactNumber" ||
          el.name === "altContactNumber" ||
          el.name === "address1" ||
          el.name === "address2" ||
          el.name === "address3" ||
          el.name === "county" ||
          el.name === "postcode" ||
          el.name === "country" ||
          el.name === "memo" ||
          el.id === "salesExec" ||
          el.id === "distributionOrderType" ||
          el.name === "leadSource" ||
          el.id === "paymentInfo" ||
          el.id === "warehouse" ||
          el.classList.contains("item-search") ||
          el.classList.contains("item-qty") ||
          el.classList.contains("item-discount") ||
          el.classList.contains("item-saleprice") ||
          el.classList.contains("item-fulfilment") ||
          el.classList.contains("fulfilmentSelect") ||
          el.classList.contains("open-inventory") ||
          el.classList.contains("item-inv-detail") ||
          el.classList.contains("open-options") ||
          el.classList.contains("delete-row") ||
          el.id === "addItemBtn" ||
          el.id === "saveOrderBtn" ||
          el.id === "commitOrderBtn" ||
          el.id === "newMemoBtn" ||
          el.id === "printBtn" ||
          el.id === "addDepositBtn";

        if (allowEdit && !isStoreField) {
          el.disabled = false;
          el.classList.remove("locked-input");
        } else {
          el.disabled = true;
          el.classList.add("locked-input");
        }
      });
    } else if (isPendingFulfillment) {
      console.log("📝 Pending fulfillment – allow only memo field editing");

      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        if (el.name === "memo") {
          el.disabled = false;
          el.classList.remove("locked-input");
        } else if (el.id === "newMemoBtn" || el.id === "printBtn") {
          el.disabled = false;
          el.classList.remove("locked-input");
        } else {
          el.disabled = true;
          el.classList.add("locked-input");
        }
      });

      const addDepositBtn = document.getElementById("addDepositBtn");
      if (addDepositBtn) {
        addDepositBtn.disabled = true;
        addDepositBtn.classList.add("locked-input");
      }
    } else {
      console.log("🔒 Not pending approval or fulfillment – lock everything (read-only)");

      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        if (el.id === "newMemoBtn" || el.id === "printBtn") return;

        el.disabled = true;
        el.classList.add("locked-input");
      });

      const addDepositBtn = document.getElementById("addDepositBtn");
      if (addDepositBtn) {
        addDepositBtn.disabled = true;
        addDepositBtn.classList.add("locked-input");
      }
    }

    // ==================================================
    // 7️⃣ Summary + Action button + Add Deposit
    // ==================================================
    updateOrderSummaryFromTable();
    updateActionButton(so.orderStatus || so.status || {}, tranId, so);

    const addDepositBtn = document.getElementById("addDepositBtn");

    function cleanMoneyText(rawValue) {
      if (rawValue == null) return 0;
      const cleaned = String(rawValue).replace(/[^0-9.-]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    }

    if (addDepositBtn) {
      addDepositBtn.disabled = false;
      addDepositBtn.classList.remove("locked-input");

      addDepositBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const outstandingText =
          document.getElementById("outstandingBalance")?.textContent || "";
        const grandTotalText =
          document.getElementById("grandTotal")?.textContent || "";

        let amount = cleanMoneyText(outstandingText);
        if (!(amount > 0)) amount = cleanMoneyText(grandTotalText);

        const popup = window.open(
          `${window.location.origin}/deposit.html?amount=${encodeURIComponent(
            amount.toFixed(2)
          )}`,
          "AddDeposit",
          "width=420,height=520,resizable=yes,scrollbars=no"
        );

        if (!popup) {
          alert("⚠️ Please allow popups for this site to add deposits.");
        } else {
          popup.focus();
        }
      };
    }
  } catch (err) {
    console.error("❌ Load failure:", err.message || err);
    alert("Failed to load Sales Order details. " + (err.message || err));
  } finally {
    overlay?.classList.add("hidden");
  }

  syncDistributionOrderTypeVisibility();
});

/* =====================================================
   Memo Panel
===================================================== */
document.addEventListener("DOMContentLoaded", () => {
  const auth = storageGet?.();
  const token = auth?.token || null;

  const memoPanel = document.getElementById("memoPanel");
  const memoHeader = document.querySelector(".memo-header");
  const memoTableBody = document.querySelector("#memoTable tbody");
  const noMemosMsg = document.getElementById("noMemosMsg");

  if (!memoPanel || !memoHeader || !memoTableBody) return;

  const parts = window.location.pathname.split("/");
  const orderId = parts.pop() || parts.pop();

  memoHeader.addEventListener("click", () => {
    memoPanel.classList.toggle("expanded");
  });

  document.getElementById("newMemoBtn")?.addEventListener("click", () => {
    if (!token) return alert("Missing session token");
    const url = `/memo.html?orderId=${orderId}&token=${token}`;
    const w = window.open(
      url,
      "MemoPopup",
      "width=550,height=600,resizable=yes,scrollbars=yes"
    );
    if (!w) alert("Please allow popups.");
  });

  async function loadMemos() {
    try {
      const res = await fetch(`/api/sales/memo/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      memoTableBody.innerHTML = "";
      updateMemoHeader(data.memos?.length || 0);

      if (!data.ok || !data.memos?.length) {
        noMemosMsg.style.display = "block";
        return;
      }

      noMemosMsg.style.display = "none";

      const frag = document.createDocumentFragment();
      data.memos.forEach((m) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${m["Date"] || ""}</td>
          <td>${m["Author"] || ""}</td>
          <td>${m["Title"] || ""}</td>
          <td>${m["Type"] || ""}</td>
          <td>${m["Memo"] || ""}</td>
        `;
        frag.appendChild(tr);
      });

      memoTableBody.appendChild(frag);
    } catch (err) {
      console.error("❌ Failed to load memos:", err.message || err);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.data?.action === "refresh-memos") {
      loadMemos();
    }
  });

  loadMemos();
});

function updateMemoHeader(count) {
  const header = document.getElementById("memoHeaderTitle");
  if (!header) return;
  header.textContent = !count ? "Memos" : `Memos (${count})`;
}

/* =====================================================
   Deposits rendering + totals
===================================================== */
function renderDeposits(deposits) {
  const section = document.getElementById("depositsSection");
  const tbody = document.querySelector("#depositsTable tbody");
  const count = document.getElementById("depositCount");
  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");
  if (!section || !tbody) return;

  if (!Array.isArray(deposits) || deposits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">No deposits found.</td></tr>`;
    section.classList.remove("hidden");
    section.style.display = "block";
    if (depositsTotalCell) depositsTotalCell.textContent = "£0.00";
    if (balanceCell) balanceCell.textContent = "£0.00";
    return;
  }

  section.classList.remove("hidden");
  section.style.display = "block";
  if (count) count.textContent = deposits.length;
  tbody.innerHTML = "";

  let totalDeposits = 0;
  const frag = document.createDocumentFragment();

  deposits.forEach((d) => {
    const amount = parseFloat(d.amount || 0);
    totalDeposits += amount;

    const tr = document.createElement("tr");
    const tdLink = document.createElement("td");
    tdLink.innerHTML = d.link || "-";

    const tdMethod = document.createElement("td");
    tdMethod.textContent = d.method || "-";

    const tdAmount = document.createElement("td");
    tdAmount.textContent = `£${amount.toFixed(2)}`;

    tr.append(tdLink, tdMethod, tdAmount);
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  updateDepositTotals(totalDeposits);
}

function updateDepositTotals(totalDeposits) {
  const depositsTotalCell = document.getElementById("depositsTotal");
  const balanceCell = document.getElementById("outstandingBalance");

  const grandTotalText = document.getElementById("grandTotal")?.textContent || "£0.00";
  const grandTotal = parseFloat(grandTotalText.replace(/[£,]/g, "")) || 0;

  let outstanding = grandTotal - totalDeposits;
  outstanding = Math.round(outstanding * 100) / 100;
  if (Math.abs(outstanding) < 0.005) outstanding = 0;

  if (depositsTotalCell) {
    depositsTotalCell.textContent = `£${totalDeposits.toFixed(2)}`;
  }

  if (balanceCell) {
    balanceCell.textContent = `£${outstanding.toFixed(2)}`;
    balanceCell.style.color = outstanding === 0 ? "#008060" : "#d00000";
    balanceCell.style.fontWeight = "600";
  }
}

/* =====================================================
   Deposit saved from popup
===================================================== */
window.onDepositSaved = async (deposit) => {
  if (!deposit || !deposit.id || !deposit.amount) return;

  const soId = window.location.pathname.split("/").pop();
  const addBtn = document.getElementById("addDepositBtn");
  const spinner = document.getElementById("depositSpinner");

  try {
    spinner?.classList.remove("hidden");
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.classList.add("locked-input");
    }

    const savedAuth = storageGet?.();
    const token = savedAuth?.token;

    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const res = await fetch(`/api/netsuite/salesorder/${soId}/add-deposit`, {
      method: "POST",
      headers,
      body: JSON.stringify(deposit),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Deposit creation failed");

    const newDeposit = {
      link: data.link || "-",
      amount: deposit.amount,
      method: deposit.name,
      soId,
    };

    window._currentDeposits = window._currentDeposits || [];
    window._currentDeposits.push(newDeposit);
    renderDeposits(window._currentDeposits);

    showToast?.(`✅ Deposit £${Number(deposit.amount).toFixed(2)} added`, "success");
  } catch (err) {
    console.error("❌ Add deposit failed:", err.message || err);
    showToast?.(`❌ ${err.message || err}`, "error");
  } finally {
    spinner?.classList.add("hidden");
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.classList.remove("locked-input");
    }
  }
};

/* =====================================================
   Summary from table
===================================================== */
function updateOrderSummaryFromTable() {
  console.log("🧮 updateOrderSummaryFromTable()");

  const rows = document.querySelectorAll("#orderItemsBody tr.order-line");
  if (!rows.length) return;

  let grossTotal = 0;
  let discountTotal = 0;

  rows.forEach((row, idx) => {
    const itemId = (row.querySelector(".item-internal-id")?.value || "").trim();
    const qtyInp = row.querySelector(".item-qty");
    const discInp = row.querySelector(".item-discount");
    const saleInp = row.querySelector(".item-saleprice");
    const amountInp = row.querySelector(".item-amount");

    if (itemId && qtyInp && discInp && saleInp && amountInp) {
      const qty = parseFloat(qtyInp.value || 0) || 0;
      if (!qty) return;

      const amountGrossLine = parseFloat(amountInp.value || 0) || 0;
      const saleGrossLine = parseFloat(saleInp.value || 0) || 0;
      const discountPct = parseFloat(discInp.value || 0) || 0;

      let defaultGrossTotal = 0;
      let actualGrossTotal = 0;

      if (Number.isFinite(amountGrossLine) && amountGrossLine !== 0) {
        defaultGrossTotal = amountGrossLine;
      } else if (Number.isFinite(saleGrossLine) && saleGrossLine !== 0) {
        defaultGrossTotal = saleGrossLine;
      }

      if (Number.isFinite(saleGrossLine) && saleGrossLine !== 0) {
        actualGrossTotal = saleGrossLine;
      } else if (discountPct > 0 && defaultGrossTotal > 0) {
        actualGrossTotal = defaultGrossTotal * (1 - discountPct / 100);
      } else {
        actualGrossTotal = defaultGrossTotal;
      }

      defaultGrossTotal = Number(defaultGrossTotal.toFixed(2));
      actualGrossTotal = Number(actualGrossTotal.toFixed(2));

      grossTotal += actualGrossTotal;

      const lineDiscount =
        defaultGrossTotal > 0 && actualGrossTotal >= 0
          ? Math.max(0, defaultGrossTotal - actualGrossTotal)
          : 0;

      discountTotal += lineDiscount;

      console.log(`🧾 Editable row ${idx}`, {
        itemId,
        qty,
        amountGrossLine,
        saleGrossLine,
        discountPct,
        defaultGrossTotal,
        actualGrossTotal,
        lineDiscount,
      });

      return;
    }

    const amountEl = row.querySelector(".amount");
    const saleEl = row.querySelector(".saleprice");

    if (!saleEl) return;

    const sale = parseFloat((saleEl.textContent || "").replace(/[£,]/g, "")) || 0;
    const amount = amountEl
      ? parseFloat((amountEl.textContent || "").replace(/[£,]/g, "")) || 0
      : sale;

    grossTotal += sale;

    const lineDiscount =
      amount > 0 && sale >= 0 ? Math.max(0, amount - sale) : 0;

    discountTotal += lineDiscount;
  });

  grossTotal = Number(grossTotal.toFixed(2));
  discountTotal = Number(discountTotal.toFixed(2));

  const netTotal = Number((grossTotal / 1.2).toFixed(2));
  const taxTotal = Number((grossTotal - netTotal).toFixed(2));

  const subTotalEl = document.getElementById("subTotal");
  const discountEl = document.getElementById("discountTotal");
  const taxEl = document.getElementById("taxTotal");
  const grandEl = document.getElementById("grandTotal");

  if (subTotalEl) subTotalEl.textContent = `£${netTotal.toFixed(2)}`;
  if (discountEl) discountEl.textContent = `£${discountTotal.toFixed(2)}`;
  if (taxEl) taxEl.textContent = `£${taxTotal.toFixed(2)}`;
  if (grandEl) grandEl.textContent = `£${grossTotal.toFixed(2)}`;

  if (typeof updateDepositTotals === "function") {
    const totalDeposits = Array.isArray(window._currentDeposits)
      ? window._currentDeposits.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0)
      : 0;

    updateDepositTotals(totalDeposits);
  }

  console.log("📊 Summary recalculated", {
    grossTotal,
    netTotal,
    taxTotal,
    discountTotal,
  });
}

document.getElementById("orderItemsBody")?.addEventListener("input", (e) => {
  if (
    e.target.classList.contains("item-qty") ||
    e.target.classList.contains("item-discount") ||
    e.target.classList.contains("item-saleprice") ||
    e.target.classList.contains("item-amount")
  ) {
    updateOrderSummaryFromTable();
  }
});

/* =====================================================
   Print receipt
===================================================== */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#printBtn");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const parts = window.location.pathname.split("/").filter(Boolean);
  const tranId = parts[parts.length - 1];

  if (!tranId) {
    alert("⚠️ Could not determine receipt transaction ID.");
    return;
  }

  const url = `/sales/reciept/${tranId}`;
  const receiptWin = window.open(url, "_blank");

  if (!receiptWin) {
    window.location.href = url;
    return;
  }

  receiptWin.focus();
});

/* =====================================================
   Commit / save buttons
===================================================== */
function showCommitInline(message = "Committing…") {
  const wrap = document.getElementById("commitInlineStatus");
  const text = document.getElementById("commitInlineText");
  if (text) text.textContent = message;
  wrap?.classList.remove("hidden");
}

function hideCommitInline() {
  document.getElementById("commitInlineStatus")?.classList.add("hidden");
}

function updateActionButton(orderStatusObj, tranId, so) {
  const wrapper = document.getElementById("orderActionWrapper");
  if (!wrapper) return;

  wrapper.innerHTML = "";

  function showCommitInlineLocal(message = "Working…") {
    const wrap = document.getElementById("commitInlineStatus");
    const text = document.getElementById("commitInlineText");
    if (text) text.textContent = message;
    wrap?.classList.remove("hidden");
  }

  function hideCommitInlineLocal() {
    document.getElementById("commitInlineStatus")?.classList.add("hidden");
  }

  const statusId = (orderStatusObj?.id || "").toUpperCase();
  const statusName = (orderStatusObj?.refName || "").toLowerCase();

  const isPendingApproval = statusId === "A" || statusName.includes("approval");
  const isPendingFulfillment = statusId === "B" || statusName.includes("fulfillment");

  if (!isPendingApproval && !isPendingFulfillment) return;

  if (isPendingFulfillment) {
    // For pending fulfillment, only show Save button (for memo updates)
    wrapper.innerHTML = `
      <button id="saveOrderBtn" class="btn-secondary">Save</button>
    `;
  } else {
    // For pending approval, show both Save and Commit buttons
    wrapper.innerHTML = `
      <button id="saveOrderBtn" class="btn-secondary">Save</button>
      <button id="commitOrderBtn" class="btn-primary">Commit</button>
    `;
  }

  function collectEditableSalesLines() {
    return [...document.querySelectorAll("#orderItemsBody tr.order-line")]
      .map((row) => {
        let itemId = row.querySelector(".item-internal-id")?.value?.trim() || "";

        if (!itemId) {
          const itemName = row.querySelector(".item-search")?.value?.trim() || "";
          if (itemName && Array.isArray(window.items)) {
            const match = window.items.find(
              (it) =>
                String(it["Name"] || "").trim().toLowerCase() ===
                itemName.toLowerCase()
            );
            itemId = String(match?.["Internal ID"] || "").trim();
          }
        }

        const quantity =
          parseFloat(
            row.querySelector(".item-qty")?.value ||
              row.querySelector(".item-qty-cache")?.value ||
              "0"
          ) || 0;

        const fulfilSel =
          row.querySelector(".item-fulfilment") ||
          row.querySelector(".fulfilmentSelect");

        let fulfilmentMethod = fulfilSel?.value?.trim() || "";

        if (!fulfilmentMethod) {
          const currentRef =
            row.querySelector(".fulfilment-cell")?.textContent?.trim() || "";
          if (currentRef && Array.isArray(window._fulfilmentMap)) {
            const match = window._fulfilmentMap.find(
              (f) => f.name?.toLowerCase() === currentRef.toLowerCase()
            );
            fulfilmentMethod = match?.id || "";
          }
        }

        const inventoryDetail = row.querySelector(".item-inv-detail")?.value || "";
        const discountPct =
          parseFloat(row.querySelector(".item-discount")?.value || "0") || 0;
        const saleGrossLine =
          parseFloat(row.querySelector(".item-saleprice")?.value || "0") || 0;
        const amountGrossLine =
          parseFloat(row.querySelector(".item-amount")?.value || "0") || 0;

        const optionsText =
          row
            .querySelector(".options-summary")
            ?.innerHTML?.trim()
            .replace(/<br\s*\/?>/gi, "\n") || "";

        return {
          lineId: row.dataset.lineid || "",
          itemId,
          quantity,
          fulfilmentMethod: fulfilmentMethod || null,
          inventoryDetail: inventoryDetail || null,
          discountPct,
          saleGrossLine,
          amountGrossLine,
          optionsSummary: optionsText || null,
          isNew: !row.dataset.lineid,
        };
      })
      .filter((r) => r.itemId && r.quantity > 0);
  }

  function buildPayloadFromUI() {
    const selectedSalesExecUserId = document.getElementById("salesExec")?.value || "";

    const selectedSalesExecUser = (window._salesUsers || []).find(
      (u) => String(u.id) === String(selectedSalesExecUserId)
    );

    const selectedSalesExecNsId =
      selectedSalesExecUser?.netsuiteId ||
      selectedSalesExecUser?.netsuiteid ||
      null;

    const headerUpdates = {
      title: document.querySelector('select[name="title"]')?.value || null,
      firstName:
        document.querySelector('input[name="firstName"]')?.value?.trim() || null,
      lastName:
        document.querySelector('input[name="lastName"]')?.value?.trim() || null,
      email: document.querySelector('input[name="email"]')?.value?.trim() || null,
      contactNumber:
        document.querySelector('input[name="contactNumber"]')?.value?.trim() || null,
      altContactNumber:
        document.querySelector('input[name="altContactNumber"]')?.value?.trim() || null,
      address1:
        document.querySelector('input[name="address1"]')?.value?.trim() || null,
      address2:
        document.querySelector('input[name="address2"]')?.value?.trim() || null,
      address3:
        document.querySelector('input[name="address3"]')?.value?.trim() || null,
      county:
        document.querySelector('input[name="county"]')?.value?.trim() || null,
      postcode:
        document.querySelector('input[name="postcode"]')?.value?.trim() || null,
      country:
        document.querySelector('input[name="country"]')?.value?.trim() || null,
      memo: document.querySelector('textarea[name="memo"]')?.value?.trim() || null,
      salesExec: selectedSalesExecNsId,
      distributionOrderType:
        document.getElementById("distributionOrderTypeWrapper")?.style.display === "none"
          ? null
          : document.getElementById("distributionOrderType")?.value || null,
      leadSource: document.querySelector('select[name="leadSource"]')?.value || null,
      paymentInfo: document.getElementById("paymentInfo")?.value || null,
      warehouse: document.getElementById("warehouse")?.value || null,
    };

    const lines = collectEditableSalesLines();
    const visibleLineIds = new Set(
      [...document.querySelectorAll("#orderItemsBody tr.order-line")]
        .map((row) => String(row.dataset.lineid || "").trim())
        .filter(Boolean)
    );

    const originalLineIds = (so?.item?.items || [])
      .map((line) => String(line.lineId || "").trim())
      .filter(Boolean);

    const deletedLineIds = originalLineIds.filter((id) => !visibleLineIds.has(id));

    console.log("🧪 Sales Exec payload mapping:", {
      selectedUiUserId: selectedSalesExecUserId,
      mappedNsId: selectedSalesExecNsId,
    });

    console.log(
      "🧪 Row payload debug:",
      [...document.querySelectorAll("#orderItemsBody tr.order-line")].map((row) => ({
        line: row.dataset.line || "",
        lineId: row.dataset.lineid || "",
        itemId: row.querySelector(".item-internal-id")?.value || "",
        itemSearch: row.querySelector(".item-search")?.value || "",
        qty: row.querySelector(".item-qty")?.value || "",
        sale: row.querySelector(".item-saleprice")?.value || "",
        amount: row.querySelector(".item-amount")?.value || "",
      }))
    );

    console.log("🧪 Final lines payload:", lines);

    return {
      headerUpdates,
      lines,
      deletedLineIds,
    };
  }

  const saveBtn = document.getElementById("saveOrderBtn");
  if (saveBtn) {
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    const freshSaveBtn = document.getElementById("saveOrderBtn");

    freshSaveBtn.addEventListener("click", async () => {
      const savedAuth = storageGet?.();
      const token = savedAuth?.token;
      if (!token) return (window.location.href = "/index.html");

      freshSaveBtn.disabled = true;
      freshSaveBtn.classList.add("locked-input");
      showCommitInlineLocal("Saving…");

      const payload = buildPayloadFromUI();

      try {
        const res = await fetch(`/api/netsuite/salesorder/${tranId}/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save order");

        showToast?.("✅ Saved (not committed)", "success");
        showCommitInlineLocal("Saved ✅");
        setTimeout(() => hideCommitInlineLocal(), 800);
      } catch (err) {
        console.error("❌ Save error:", err.message || err);
        showToast?.(`❌ ${err.message || err}`, "error");
        showCommitInlineLocal("Save failed ❌");
        setTimeout(() => hideCommitInlineLocal(), 1500);
      } finally {
        freshSaveBtn.disabled = false;
        freshSaveBtn.classList.remove("locked-input");
      }
    });
  }

window.onInventorySaved = function (itemId, detailString, lineIndex) {
  try {
    let row = null;

    // ✅ 1) prefer exact row remembered when popup was opened
    if (window.__salesInventoryTargetRowLine != null) {
      row = document.querySelector(
        `#orderItemsBody tr.order-line[data-line="${window.__salesInventoryTargetRowLine}"]`
      );
    }

    // ✅ 2) fallback to callback lineIndex
    if (!row && lineIndex != null) {
      row = document.querySelector(
        `#orderItemsBody tr.order-line[data-line="${lineIndex}"]`
      );
    }

    // ✅ 3) final fallback by item id (best effort)
    if (!row && itemId) {
      const matches = [
        ...document.querySelectorAll("#orderItemsBody tr.order-line"),
      ].filter(
        (r) =>
          String(r.querySelector(".item-internal-id")?.value || "").trim() ===
          String(itemId).trim()
      );

      row = matches[matches.length - 1] || null;
    }

    if (!row) {
      console.warn("⚠️ onInventorySaved: row not found", { itemId, lineIndex });
      return;
    }

    const invInp = row.querySelector(".item-inv-detail");
    if (invInp) invInp.value = detailString || "";

    const summary = row.querySelector(".inv-summary");
    if (summary) summary.textContent = detailString || "";

    const btn = row.querySelector(".open-inventory");
    const qty =
      parseInt(
        row.querySelector(".item-qty")?.value ||
          row.querySelector(".item-qty-cache")?.value ||
          "0",
        10
      ) || 0;

    const allocated = (detailString || "")
      .split(";")
      .map((p) => parseInt(p.trim().split("|")[0], 10) || 0)
      .reduce((a, b) => a + b, 0);

    if (btn) btn.textContent = qty > 0 && allocated === qty ? "✅" : "📦";

    const fulfilSel =
      row.querySelector(".item-fulfilment") || row.querySelector(".fulfilmentSelect");
    if (fulfilSel && window.SalesLineUI?.validateInventoryForRow) {
      window.SalesLineUI.validateInventoryForRow(row);
    }

    if (typeof updateOrderSummaryFromTable === "function") {
      updateOrderSummaryFromTable();
    }

    // ✅ clear remembered target after successful writeback
    window.__salesInventoryTargetRowLine = null;
    window.__salesInventoryTargetItemId = null;

    console.log("✅ Inventory saved into Sales View row", {
      targetRowLine: row.dataset.line,
      itemId,
      lineIndex,
    });
  } catch (err) {
    console.error("❌ onInventorySaved failed:", err.message || err);
  }
};

  const commitBtn = document.getElementById("commitOrderBtn");
  if (!commitBtn) return;

  commitBtn.replaceWith(commitBtn.cloneNode(true));
  const freshCommitBtn = document.getElementById("commitOrderBtn");

  freshCommitBtn.addEventListener("click", async () => {
    const savedAuth = storageGet?.();
    const token = savedAuth?.token;
    if (!token) return (window.location.href = "/index.html");

    freshCommitBtn.disabled = true;
    freshCommitBtn.classList.add("locked-input");
    showCommitInlineLocal("Committing…");

    const payload = buildPayloadFromUI();

    try {
      const res = await fetch(`/api/netsuite/salesorder/${tranId}/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to commit order");

      showToast?.(`✅ Order ${tranId} approved!`, "success");
      showCommitInlineLocal("Committed ✅");

      setTimeout(() => {
        wrapper.innerHTML = "";
        hideCommitInlineLocal();
      }, 1000);
    } catch (err) {
      console.error("❌ Commit error:", err.message || err);
      showToast?.(`❌ ${err.message || err}`, "error");

      showCommitInlineLocal("Commit failed ❌");
      setTimeout(() => hideCommitInlineLocal(), 2000);

      freshCommitBtn.disabled = false;
      freshCommitBtn.classList.remove("locked-input");
    }
  });
}
