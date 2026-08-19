(function initSalesNewOrderProgress() {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const detailSelectors = ["#salesExec", "#store", 'select[name="leadSource"]', "#paymentInfo", "#warehouse"];
  const relevantInputSelector = [
    'input[name="firstName"]', 'input[name="lastName"]', 'input[name="address1"]',
    'input[name="postcode"]', 'input[name="contactNumber"]', 'input[name="email"]',
    "#noAddressRequired", ...detailSelectors, "#distributionOrderType",
    "#orderItemsBody .item-internal-id", "#orderItemsBody .item-fulfilment", "#orderItemsBody .item-inv-detail",
  ].join(",");
  let elements;
  let updateFrame = 0;

  const fieldValue = (field) => String(field?.value || "").trim();
  const value = (selector) => fieldValue(document.querySelector(selector));

  function itemLinesComplete(rows) {
    const itemRows = rows.filter((row) => fieldValue(row.querySelector(".item-internal-id")));
    if (!itemRows.length) return false;
    return itemRows.every((row) => {
      const itemClass = String(row.dataset.itemClass || "").toLowerCase();
      if (itemClass.includes("service")) return true;
      const fulfilment = row.querySelector(".item-fulfilment");
      if (!fieldValue(fulfilment)) return false;
      const method = String(fulfilment?.selectedOptions?.[0]?.textContent || "").trim().toLowerCase();
      const requiresInventory = ["warehouse", "in store", "fulfil from store"].includes(method);
      if (!requiresInventory) return true;
      return !!(
        fieldValue(row.querySelector(".item-inv-detail")) ||
        String(row.dataset.invdetail || "").trim() ||
        String(row.dataset.inventoryMeta || "").trim() ||
        String(row.dataset.lotnumber || "").trim() ||
        row.dataset.backorder === "1"
      );
    });
  }

  function orderDetailsComplete() {
    const required = [...detailSelectors];
    if (elements.distributionWrapper && getComputedStyle(elements.distributionWrapper).display !== "none") {
      required.push("#distributionOrderType");
    }
    return required.every((selector) => {
      const field = document.querySelector(selector);
      const selectedText = String(field?.selectedOptions?.[0]?.textContent || "").trim().toLowerCase();
      return !!fieldValue(field) && !selectedText.startsWith("loading") && !selectedText.startsWith("select ");
    });
  }

  function setText(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function update() {
    updateFrame = 0;
    const noAddressRequired = elements.noAddressRequired?.checked === true;
    const email = value('input[name="email"]');
    const emailValid = emailPattern.test(email);
    const firstName = value('input[name="firstName"]');
    const lastName = value('input[name="lastName"]');
    const address1 = value('input[name="address1"]');
    const postcode = value('input[name="postcode"]');
    const contact = value('input[name="contactNumber"]');
    const detailsComplete = orderDetailsComplete();
    const linesComplete = itemLinesComplete([...elements.itemsBody.querySelectorAll("tr.order-line")]);
    const state = {
      firstName: { complete: !!firstName, label: firstName ? `First Name is ${firstName}` : "First name entered" },
      lastName: { complete: !!lastName, label: lastName ? `Last Name is ${lastName}` : "Last name entered" },
      address: { complete: noAddressRequired || (!!address1 && !!postcode), label: noAddressRequired ? "No address required" : address1 && postcode ? `Address is ${address1}, ${postcode}` : "Address completed" },
      contact: { complete: !!contact, label: contact ? `Contact Number is ${contact}` : "Contact number entered" },
      email: { complete: emailValid, warning: !!email && !emailPattern.test(email), issue: "Enter a valid email address, including @ and a domain.", label: emailValid ? `Email Address is ${email}` : "Valid email address entered" },
      orderDetails: { complete: detailsComplete, label: detailsComplete ? "Order details are complete" : "Order details completed" },
      itemLines: { complete: linesComplete, label: linesComplete ? "Item fulfilment and inventory are complete" : "Item fulfilment and inventory completed" },
    };

    const entries = Object.entries(state);
    const complete = entries.filter(([, status]) => status.complete).length;
    entries.forEach(([key, status]) => {
      const row = elements.progressRows.get(key);
      if (!row) return;
      row.classList.toggle("is-complete", status.complete);
      row.classList.toggle("is-warning", status.warning === true);
      setText(row.querySelector(".order-progress-copy > span"), status.label);
      setText(row.querySelector("small"), status.warning ? status.issue : "");
      const ariaLabel = `${status.label}: ${status.complete ? "complete" : status.warning ? status.issue : "not complete"}`;
      if (row.getAttribute("aria-label") !== ariaLabel) row.setAttribute("aria-label", ariaLabel);
    });

    elements.panel?.classList.toggle("is-complete", complete === entries.length);
    setText(elements.count, `${complete}/${entries.length}`);
    setText(elements.summary, complete === entries.length ? "Ready to process" : `${entries.length - complete} milestone${entries.length - complete === 1 ? "" : "s"} remaining`);
    const width = `${(complete / entries.length) * 100}%`;
    if (elements.bar && elements.bar.style.width !== width) elements.bar.style.width = width;
  }

  function scheduleUpdate() {
    if (!updateFrame) updateFrame = requestAnimationFrame(update);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.querySelector("main.content") || document.body;
    const progressList = document.getElementById("orderProgressList");
    elements = {
      itemsBody: document.getElementById("orderItemsBody"),
      noAddressRequired: document.getElementById("noAddressRequired"),
      distributionWrapper: document.getElementById("distributionOrderTypeWrapper"),
      panel: document.querySelector(".order-progress"),
      count: document.getElementById("orderProgressCount"),
      summary: document.getElementById("orderProgressSummary"),
      bar: document.getElementById("orderProgressBar"),
      progressRows: new Map([...progressList.querySelectorAll("[data-progress]")].map((row) => [row.dataset.progress, row])),
    };

    update();
    const onFieldEvent = (event) => {
      if (event.target instanceof Element && event.target.matches(relevantInputSelector)) scheduleUpdate();
    };
    root.addEventListener("input", onFieldEvent);
    root.addEventListener("change", onFieldEvent);
    new MutationObserver(scheduleUpdate).observe(elements.itemsBody, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-item-class", "data-invdetail", "data-inventory-meta", "data-lotnumber", "data-backorder"],
    });
    window.addEventListener("sales-inventory-updated", scheduleUpdate);
  });
})();
