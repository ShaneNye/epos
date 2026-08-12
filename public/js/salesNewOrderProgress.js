(function initSalesNewOrderProgress() {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const value = (selector) => String(document.querySelector(selector)?.value || "").trim();

  function itemLinesComplete() {
    const rows = [...document.querySelectorAll("#orderItemsBody tr.order-line")].filter((row) =>
      String(row.querySelector(".item-internal-id")?.value || "").trim()
    );
    if (!rows.length) return false;

    return rows.every((row) => {
      const itemClass = String(row.dataset.itemClass || "").toLowerCase();
      if (itemClass.includes("service")) return true;
      const fulfilment = row.querySelector(".item-fulfilment");
      if (!String(fulfilment?.value || "").trim()) return false;
      const method = String(fulfilment?.selectedOptions?.[0]?.textContent || "").trim().toLowerCase();
      const requiresInventory = ["warehouse", "in store", "fulfil from store"].includes(method);
      if (!requiresInventory) return true;
      return !!(
        String(row.querySelector(".item-inv-detail")?.value || "").trim() ||
        String(row.dataset.invdetail || "").trim() ||
        String(row.dataset.inventoryMeta || "").trim() ||
        String(row.dataset.lotnumber || "").trim() ||
        row.dataset.backorder === "1"
      );
    });
  }

  function orderDetailsComplete() {
    const required = ["#salesExec", "#store", 'select[name="leadSource"]', "#paymentInfo", "#warehouse"];
    const distributionWrapper = document.getElementById("distributionOrderTypeWrapper");
    if (distributionWrapper && getComputedStyle(distributionWrapper).display !== "none") {
      required.push("#distributionOrderType");
    }
    return required.every((selector) => {
      const field = document.querySelector(selector);
      const selectedText = String(field?.selectedOptions?.[0]?.textContent || "").trim().toLowerCase();
      return !!value(selector) && !selectedText.startsWith("loading") && !selectedText.startsWith("select ");
    });
  }

  function update() {
    const noAddressRequired = document.getElementById("noAddressRequired")?.checked === true;
    const email = value('input[name="email"]');
    const firstName = value('input[name="firstName"]');
    const lastName = value('input[name="lastName"]');
    const address1 = value('input[name="address1"]');
    const postcode = value('input[name="postcode"]');
    const contact = value('input[name="contactNumber"]');
    const state = {
      firstName: { complete: !!firstName, label: firstName ? `First Name is ${firstName}` : "First name entered", signature: firstName },
      lastName: { complete: !!lastName, label: lastName ? `Last Name is ${lastName}` : "Last name entered", signature: lastName },
      address: {
        complete: noAddressRequired || (!!address1 && !!postcode),
        label: noAddressRequired ? "No address required" : address1 && postcode ? `Address is ${address1}, ${postcode}` : "Address completed",
        signature: `${noAddressRequired}|${address1}|${postcode}`,
      },
      contact: { complete: !!contact, label: contact ? `Contact Number is ${contact}` : "Contact number entered", signature: contact },
      email: {
        complete: emailPattern.test(email),
        warning: !!email && !emailPattern.test(email),
        issue: "Enter a valid email address, including @ and a domain.",
        label: emailPattern.test(email) ? `Email Address is ${email}` : "Valid email address entered",
        signature: email,
      },
      orderDetails: { complete: orderDetailsComplete(), label: orderDetailsComplete() ? "Order details are complete" : "Order details completed", signature: ["#salesExec", "#store", 'select[name="leadSource"]', "#paymentInfo", "#warehouse", "#distributionOrderType"].map(value).join("|") },
      itemLines: { complete: itemLinesComplete(), label: itemLinesComplete() ? "Item fulfilment and inventory are complete" : "Item fulfilment and inventory completed", signature: [...document.querySelectorAll("#orderItemsBody tr.order-line")].map((row) => `${row.querySelector(".item-internal-id")?.value || ""}:${row.querySelector(".item-fulfilment")?.value || ""}:${row.querySelector(".item-inv-detail")?.value || row.dataset.inventoryMeta || row.dataset.invdetail || ""}`).join("|") },
    };

    const entries = Object.entries(state);
    const complete = entries.filter(([, status]) => status.complete).length;
    entries.forEach(([key, status]) => {
      const row = document.querySelector(`#orderProgressList [data-progress="${key}"]`);
      row?.classList.toggle("is-complete", status.complete);
      row?.classList.toggle("is-warning", status.warning === true);
      const copy = row?.querySelector(".order-progress-copy > span");
      if (copy) copy.textContent = status.label;
      const issue = row?.querySelector("small");
      if (issue) issue.textContent = status.warning ? status.issue : "";
      row?.setAttribute("aria-label", `${row.querySelector(".order-progress-copy > span")?.textContent.trim()}: ${status.complete ? "complete" : status.warning ? status.issue : "not complete"}`);
    });

    const panel = document.querySelector(".order-progress");
    panel?.classList.toggle("is-complete", complete === entries.length);
    const count = document.getElementById("orderProgressCount");
    const summary = document.getElementById("orderProgressSummary");
    const bar = document.getElementById("orderProgressBar");
    if (count) count.textContent = `${complete}/${entries.length}`;
    if (summary) summary.textContent = complete === entries.length
      ? "Ready to process"
      : `${entries.length - complete} milestone${entries.length - complete === 1 ? "" : "s"} remaining`;
    if (bar) bar.style.width = `${(complete / entries.length) * 100}%`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    update();
    const root = document.querySelector("main.content") || document.body;
    root.addEventListener("input", update);
    root.addEventListener("change", update);
    root.addEventListener("click", () => requestAnimationFrame(update));
    new MutationObserver(() => requestAnimationFrame(update)).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-item-class", "data-invdetail", "data-inventory-meta", "data-lotnumber", "data-backorder"],
    });
    window.addEventListener("sales-inventory-updated", update);
  });
})();
