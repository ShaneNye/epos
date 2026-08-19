document.addEventListener("DOMContentLoaded", () => {
  const filter = document.getElementById("supplierFilter");
  const tbody = document.querySelector("#supplierReportTable tbody");
  const count = document.getElementById("supplierReportCount");
  const refresh = document.getElementById("supplierRefreshBtn");
  let suppliers = [];
  let loaded = false;
  let expandedSupplierId = "";
  const itemsBySupplier = new Map();

  function addCell(row, text) {
    const cell = row.insertCell();
    cell.textContent = text || "-";
    return cell;
  }

  function contactLink(value, scheme) {
    if (!value) return null;
    const link = document.createElement("a");
    link.href = `${scheme}:${value}`;
    link.textContent = value;
    link.title = value;
    return link;
  }

  function addContactCell(row, entries) {
    const cell = row.insertCell();
    cell.className = "supplier-contact-cell";
    const stack = document.createElement("div");
    stack.className = "supplier-contact-stack";
    entries.filter((entry) => entry.value).forEach((entry) => {
      const line = document.createElement("div");
      line.className = "supplier-contact-line";
      const link = contactLink(entry.value, entry.scheme);
      if (link) line.appendChild(link);
      stack.appendChild(line);
    });
    if (!stack.children.length) stack.textContent = "-";
    cell.appendChild(stack);
  }

  function addRepresentativeCell(row, supplier) {
    const cell = row.insertCell();
    cell.className = "supplier-contact-cell";
    const stack = document.createElement("div");
    stack.className = "supplier-contact-stack";
    const name = document.createElement("strong");
    name.className = "supplier-rep-name";
    name.textContent = supplier.supplierRep || "Representative not provided";
    stack.appendChild(name);
    [
      { value: supplier.repNumber, scheme: "tel" },
      { value: supplier.repEmail, scheme: "mailto" },
    ].filter((entry) => entry.value).forEach((entry) => {
      const line = document.createElement("div");
      line.className = "supplier-contact-line";
      line.appendChild(contactLink(entry.value, entry.scheme));
      stack.appendChild(line);
    });
    cell.appendChild(stack);
  }

  function render() {
    if (!tbody) return;
    const term = String(filter?.value || "").trim().toLowerCase();
    const rows = term
      ? suppliers.filter((supplier) => Object.values(supplier).join(" ").toLowerCase().includes(term))
      : suppliers;

    tbody.innerHTML = "";
    if (!rows.length) {
      const row = tbody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 5;
      cell.className = "supplier-report-empty";
      cell.textContent = loaded ? "No suppliers match your search." : "Loading suppliers…";
    } else {
      rows.forEach((supplier) => {
        const row = tbody.insertRow();
        row.className = "supplier-report-row";
        row.dataset.supplierId = supplier.id;
        const supplierCell = row.insertCell();
        const supplierButton = document.createElement("button");
        supplierButton.type = "button";
        supplierButton.className = "supplier-expand-button";
        supplierButton.dataset.supplierId = supplier.id;
        supplierButton.setAttribute("aria-expanded", String(expandedSupplierId === supplier.id));
        supplierButton.textContent = `${expandedSupplierId === supplier.id ? "▾" : "▸"} ${supplier.companyName || "-"}`;
        supplierCell.appendChild(supplierButton);
        addCell(row, supplier.leadTime);
        addContactCell(row, [
          { value: supplier.supplierMainline, scheme: "tel" },
          { value: supplier.supplierEmail, scheme: "mailto" },
        ]);
        addRepresentativeCell(row, supplier);
        addCell(row, supplier.id);

        if (expandedSupplierId === supplier.id) renderItemRow(supplier, row);
      });
    }
    if (count) count.textContent = `${rows.length} of ${suppliers.length} suppliers`;
  }

  function renderItemRow(supplier, supplierRow) {
    const detailRow = tbody.insertRow(supplierRow.rowIndex);
    detailRow.className = "supplier-items-row";
    const cell = detailRow.insertCell();
    cell.colSpan = 5;
    const cached = itemsBySupplier.get(supplier.id);

    if (!cached || cached.loading) {
      cell.textContent = "Loading preferred-supplier items…";
      cell.className = "supplier-report-empty";
      if (!cached) loadSupplierItems(supplier.id);
      return;
    }
    if (cached.error) {
      cell.className = "supplier-report-empty supplier-report-error";
      cell.textContent = cached.error;
      return;
    }
    if (!cached.items.length) {
      cell.className = "supplier-report-empty";
      cell.textContent = "No items have this supplier set as their preferred supplier.";
      return;
    }

    const heading = document.createElement("strong");
    heading.className = "supplier-items-count";
    heading.textContent = `${cached.items.length} preferred-supplier item${cached.items.length === 1 ? "" : "s"}`;
    cell.appendChild(heading);
    const itemFilter = document.createElement("input");
    itemFilter.type = "search";
    itemFilter.className = "supplier-item-filter";
    itemFilter.dataset.supplierId = supplier.id;
    itemFilter.placeholder = "Search item code, name or internal ID…";
    itemFilter.setAttribute("aria-label", `Search items supplied by ${supplier.companyName}`);
    cell.appendChild(itemFilter);
    const table = document.createElement("table");
    table.className = "supplier-items-table";
    table.innerHTML = "<thead><tr><th>Item Code</th><th>Display Name</th><th>Internal ID</th></tr></thead>";
    const itemBody = table.createTBody();
    cached.items.forEach((item) => {
      const row = itemBody.insertRow();
      row.dataset.itemSearch = `${item.itemCode} ${item.displayName} ${item.id}`.toLowerCase();
      addCell(row, item.itemCode);
      addCell(row, item.displayName);
      addCell(row, item.id);
    });
    cell.appendChild(table);
  }

  async function loadSupplierItems(supplierId) {
    itemsBySupplier.set(supplierId, { loading: true, items: [] });
    try {
      const token = storageGet?.()?.token;
      const response = await fetch(`/api/reports/suppliers/${encodeURIComponent(supplierId)}/items`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load supplier items");
      itemsBySupplier.set(supplierId, { items: Array.isArray(data.items) ? data.items : [] });
    } catch (err) {
      itemsBySupplier.set(supplierId, { items: [], error: err.message || "Unable to load supplier items." });
    }
    if (expandedSupplierId === supplierId) render();
  }

  async function load(force = false) {
    if (loaded && !force) return;
    loaded = false;
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="supplier-report-empty"><span class="supplier-loading-dot" aria-hidden="true"></span> Loading suppliers…</td></tr>';
    if (refresh) refresh.disabled = true;
    try {
      const token = storageGet?.()?.token;
      const response = await fetch("/api/reports/suppliers", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load suppliers");
      suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
      loaded = true;
      render();
    } catch (err) {
      suppliers = [];
      loaded = true;
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="supplier-report-empty supplier-report-error"></td></tr>`;
      const errorCell = tbody?.querySelector("td");
      if (errorCell) errorCell.textContent = err.message || "Unable to load suppliers.";
      if (count) count.textContent = "Supplier report unavailable";
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  filter?.addEventListener("input", render);
  tbody?.addEventListener("click", (event) => {
    if (event.target.closest("a, input")) return;
    const button = event.target.closest(".supplier-expand-button") || event.target.closest(".supplier-report-row")?.querySelector(".supplier-expand-button");
    if (!button) return;
    expandedSupplierId = expandedSupplierId === button.dataset.supplierId ? "" : button.dataset.supplierId;
    render();
  });
  tbody?.addEventListener("input", (event) => {
    const itemFilter = event.target.closest(".supplier-item-filter");
    if (!itemFilter) return;
    const detailRow = itemFilter.closest(".supplier-items-row");
    const term = itemFilter.value.trim().toLowerCase();
    const itemRows = [...(detailRow?.querySelectorAll(".supplier-items-table tbody tr") || [])];
    let visible = 0;
    itemRows.forEach((row) => {
      const matches = !term || String(row.dataset.itemSearch || "").includes(term);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const countLabel = detailRow?.querySelector(".supplier-items-count");
    if (countLabel) {
      countLabel.textContent = term
        ? `${visible} of ${itemRows.length} preferred-supplier items`
        : `${itemRows.length} preferred-supplier item${itemRows.length === 1 ? "" : "s"}`;
    }
  });
  refresh?.addEventListener("click", () => load(true));
  window.addEventListener("reports:tabchange", (event) => {
    if (event.detail?.id === "supplierReport") load();
  });
});
