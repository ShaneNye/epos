(function () {
  function receiptIdFromPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function plainTextFromHtml(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";

    const template = document.createElement("template");
    template.innerHTML = text;
    const parsed = template.content.textContent?.trim() || "";
    return parsed || text;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = String(value ?? "").trim();
    el.textContent = text || "-";
  }

  function formatMoney(value) {
    if (window.EposFinancials?.formatMoney) return window.EposFinancials.formatMoney(value);
    return `\u00a3${(Number(value || 0) || 0).toFixed(2)}`;
  }

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function inventoryDetailStatusContainsClearance(value) {
    const raw = String(value || "").trim();
    if (!raw) return false;

    return raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .some((part) => {
        const tokens = part.split("|");
        const statusValue = String(tokens[3] || "").trim().toLowerCase();
        return statusValue.includes("clearance");
      });
  }

  function lineHasClearanceInventoryStatus(line) {
    return [
      line?.inventoryDetail,
      line?.inventoryMeta,
      line?.custcol_sb_epos_inventory_meta,
      line?.CUSTCOL_SB_EPOS_INVENTORY_META,
    ].some(inventoryDetailStatusContainsClearance);
  }

  function updateClearanceNotice(items) {
    const notice = document.getElementById("clearanceNotice");
    if (!notice) return;
    notice.hidden = !(Array.isArray(items) && items.some(lineHasClearanceInventoryStatus));
  }

  function todayDdMmYyyy() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  function formatDateDdMmYyyy(raw) {
    const value = String(raw || "").trim();
    if (!value) return todayDdMmYyyy();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;

    const iso = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [year, month, day] = iso.split("-");
      return `${day}/${month}/${year}`;
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    }

    return value;
  }

  function maskNumberField(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "Pending";
    el.style.display = "inline-block";
    el.style.minWidth = "92px";
    el.style.background = "#eef2f7";
    el.style.color = "#64748b";
    el.style.border = "1px solid #cbd5e1";
    el.style.borderRadius = "4px";
    el.style.padding = "2px 8px";
    el.style.fontWeight = "700";
    el.style.letterSpacing = "0.2px";
    el.style.textAlign = "center";
  }

  async function populateStore(payload) {
    const store = payload.order || {};
    setText("storeName", store.storeName || "");

    try {
      const saved = typeof storageGet === "function" ? storageGet() : null;
      const headers = saved?.token ? { Authorization: `Bearer ${saved.token}` } : {};
      const res = await fetch("/api/meta/locations", { headers });
      const data = await res.json();
      if (!res.ok || !data?.ok || !Array.isArray(data.locations)) return;

      const storeId = String(store.store || "").trim();
      const storeName = String(store.storeName || "").trim().toLowerCase();
      const valueMatches = (a, b) => String(a || "").trim() === String(b || "").trim();
      const nameMatches = (loc) =>
        storeName && String(loc.name || "").trim().toLowerCase() === storeName;

      const match =
        data.locations.find(nameMatches) ||
        data.locations.find((loc) => storeId && valueMatches(loc.id, storeId)) ||
        data.locations.find((loc) => storeId && valueMatches(loc.netsuite_internal_id, storeId)) ||
        data.locations.find((loc) => storeId && valueMatches(loc.invoice_location_id, storeId));

      if (!match) {
        console.warn("Pending receipt store lookup found no match:", {
          storeId,
          storeName: store.storeName || "",
        });
        return;
      }

      console.log("Pending receipt store matched:", {
        requestedStoreId: storeId,
        requestedStoreName: store.storeName || "",
        matchedId: match.id,
        matchedName: match.name,
        matchedNetSuiteId: match.netsuite_internal_id,
        matchedInvoiceLocationId: match.invoice_location_id,
      });

      setText("storeName", match.name);
      setText("storeTel", match.location_phone_number);
      setText("storeEmail", match.location_email || match.email);
      setText("storeVatNo", match.vat_number);
      setText("storeCompanyNo", match.company_number);
      setText("storeAdd1", match.address_line_1);
      setText("storeAdd2", match.address_line_2);
      setText("storePostcode", match.postcode);
    } catch (err) {
      console.warn("Pending receipt store lookup failed:", err.message || err);
    }
  }

  function renderProducts(items, type) {
    const tableBody = document.getElementById("productTableBody");
    const productTable = document.getElementById("productTable");
    if (!tableBody) return;

    tableBody.innerHTML = "";
    const hasAnyOptions = items.some((line) => String(line.options || "").trim());

    if (productTable) {
      productTable.querySelectorAll("tr").forEach((row) => {
        const optionCell = row.children[1];
        if (optionCell) optionCell.style.display = hasAnyOptions ? "" : "none";
      });
    }

    items.forEach((line) => {
      const qty = Math.abs(Number(line.quantity || 1)) || 1;
      const retailValue = hasValue(line.retailGrossLine)
        ? line.retailGrossLine
        : hasValue(line.saleGrossLine)
          ? line.saleGrossLine
          : 0;
      const retailGrossLine = Number(retailValue) || 0;
      const saleGrossLine = hasValue(line.saleGrossLine)
        ? Number(line.saleGrossLine) || 0
        : retailGrossLine;
      const retailGrossUnit = qty ? retailGrossLine / qty : 0;
      const discountPct = retailGrossLine > 0
        ? Math.max(0, ((retailGrossLine - saleGrossLine) / retailGrossLine) * 100)
        : 0;
      const tr = document.createElement("tr");
      const options = escapeHtml(line.options || "").replace(/\n/g, "<br>");

      tr.innerHTML = hasAnyOptions
        ? `
          <td>${escapeHtml(line.name || "")}</td>
          <td>${options || "-"}</td>
          <td>${qty}</td>
          <td>${formatMoney(retailGrossUnit)}</td>
          <td>${discountPct.toFixed(1)}%</td>
          <td>${formatMoney(saleGrossLine)}</td>
        `
        : `
          <td>${escapeHtml(line.name || "")}</td>
          <td>${qty}</td>
          <td>${formatMoney(retailGrossUnit)}</td>
          <td>${discountPct.toFixed(1)}%</td>
          <td>${formatMoney(saleGrossLine)}</td>
        `;
      tableBody.appendChild(tr);
    });
  }

  function renderDeposits(deposits) {
    const body = document.getElementById("depositTableBody");
    if (!body) return;
    body.innerHTML = "";

    if (!deposits.length) {
      body.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">No deposits recorded</td></tr>`;
      return;
    }

    deposits.forEach((dep) => {
      const depositNo = plainTextFromHtml(dep.link || dep.depositNo || dep.number || "Pending");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(depositNo)}</td>
        <td>${escapeHtml(dep.name || dep.method || "-")}</td>
        <td>${formatMoney(dep.amount || 0)}</td>
      `;
      body.appendChild(tr);
    });
  }

  function renderSummary(items, deposits, type) {
    const summary = window.EposFinancials?.summariseLines
      ? window.EposFinancials.summariseLines(
          items.map((line) => ({
            item: { refName: line.name || "" },
            amount: hasValue(line.retailGrossLine) ? line.retailGrossLine : 0,
            saleprice: hasValue(line.saleGrossLine)
              ? line.saleGrossLine
              : hasValue(line.retailGrossLine)
                ? line.retailGrossLine
                : 0,
            quantity: line.quantity || 1,
          })),
          deposits
        )
      : {
          vatTotal: items.reduce((sum, line) => sum + (Number(line.saleGrossLine || 0) || 0) / 6, 0),
          grossTotal: items.reduce((sum, line) => sum + (Number(line.saleGrossLine || 0) || 0), 0),
          totalRetail: items.reduce((sum, line) => sum + (Number(line.retailGrossLine || 0) || 0), 0),
          discountTotal: 0,
          discountPct: 0,
          remainingBalance: 0,
        };

    if (!window.EposFinancials?.summariseLines) {
      summary.discountTotal = summary.totalRetail - summary.grossTotal;
      summary.discountPct = summary.totalRetail > 0 ? (summary.discountTotal / summary.totalRetail) * 100 : 0;
      summary.remainingBalance = summary.grossTotal - deposits.reduce((sum, dep) => sum + (Number(dep.amount || 0) || 0), 0);
    }

    setText("vatTotal", formatMoney(summary.vatTotal));
    setText(type === "quote" ? "quoteTotal" : "salesTotal", formatMoney(summary.grossTotal));
    setText("balance", formatMoney(summary.remainingBalance));
    setText("originalPrice", formatMoney(summary.totalRetail));
    setText("discAmount", formatMoney(summary.discountTotal));
    setText("totalDiscPerc", `${Number(summary.discountPct || 0).toFixed(2)}%`);
  }

  async function revealAndPrint() {
    const images = [...document.images].filter((img) => !img.complete);
    await Promise.race([
      Promise.all(images.map((img) => img.decode ? img.decode().catch(() => {}) : Promise.resolve())),
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
    document.body.classList.remove("receipt-loading");
    document.body.classList.add("receipt-ready");
    setTimeout(() => window.print(), 120);
  }

  async function tryRender(type) {
    const id = receiptIdFromPath();
    if (!id.startsWith("pending-")) return false;

    const raw = sessionStorage.getItem(`eposPendingReceipt:${id}`);
    if (!raw) {
      document.body.classList.remove("receipt-loading");
      return true;
    }

    const payload = JSON.parse(raw);
    const customer = payload.customer || {};
    const order = payload.order || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    const deposits = Array.isArray(payload.deposits) ? payload.deposits : [];

    await populateStore(payload);

    setText("customerName", `${customer.firstName || ""} ${customer.lastName || ""}`.trim());
    setText("custadd1", customer.address1);
    setText("custadd2", customer.address2);
    setText("custadd3", customer.address3 || customer.county);
    setText("custzip", customer.postcode);
    setText("custEmail", customer.email);
    setText("custTel", customer.contactNumber);
    setText("pymtMthd", order.paymentInfoName || "-");
    setText("salesRep", order.salesExecName || "-");

    if (type === "quote") {
      const quoteNo = order.quoteNo || order.tranId || order.orderNumber || "";
      if (quoteNo) setText("quoteNo", quoteNo);
      else maskNumberField("quoteNo");
      setText("quoteDate", formatDateDdMmYyyy(order.quoteDate || order.tranDate || order.date));
    } else {
      const salesNo = order.salesOrd || order.salesOrderNo || order.tranId || order.orderNumber || "";
      if (salesNo) setText("salesOrd", salesNo);
      else maskNumberField("salesOrd");
      setText("salesDate", formatDateDdMmYyyy(order.salesDate || order.tranDate || order.date));
    }

    renderProducts(items, type);
    updateClearanceNotice(items);
    renderDeposits(deposits);
    renderSummary(items, deposits, type);
    await revealAndPrint();
    return true;
  }

  function create(type, payload) {
    const pendingId = `pending-${Date.now()}`;
    sessionStorage.setItem(`eposPendingReceipt:${pendingId}`, JSON.stringify(payload || {}));
    return type === "quote" ? `/quote/receipt/${pendingId}` : `/sales/reciept/${pendingId}`;
  }

  window.EposPendingReceipt = { tryRender, create };
})();
