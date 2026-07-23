document.addEventListener("DOMContentLoaded", async () => {
  const token = new URLSearchParams(location.search).get("journey") || "";
  const form = document.getElementById("quoteDetailsForm");
  const status = document.getElementById("quoteStatus");
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  let journey;
  let items = [];
  let finance = {};
  let summaryCustomer = null;
  const requestKeyStorage = `qrJourneyQuoteRequest:${token}`;
  let requestKey = sessionStorage.getItem(requestKeyStorage);
  if (!requestKey) {
    requestKey = globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(requestKeyStorage, requestKey);
  }

  try {
    const response = await fetch(`/api/qr-journeys/public/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load quote details");
    journey = data.journey;
    document.getElementById("quoteStore").textContent = journey.location_name;
    items = JSON.parse(sessionStorage.getItem(`qrJourneySelection:${token}`) || "[]");
    finance = JSON.parse(sessionStorage.getItem(`qrJourneyFinance:${token}`) || "{}");
    if (!items.length) throw new Error("Your product selection could not be found. Please scan the QR code again.");
  } catch (error) {
    status.textContent = error.message;
    status.dataset.tone = "error";
    form.querySelectorAll("input, button, select").forEach((control) => { control.disabled = true; });
  }

  document.getElementById("quoteFindAddress").addEventListener("click", async () => {
    const postcode = form.elements.postcode.value.trim();
    const select = document.getElementById("quoteAddressResults");
    const findButton = document.getElementById("quoteFindAddress");
    if (!postcode) return form.elements.postcode.focus();
    findButton.disabled = true;
    findButton.textContent = "Finding…";
    select.hidden = false;
    select.innerHTML = "<option>Searching...</option>";
    try {
      const response = await fetch(`/api/fetchify/postcode/${encodeURIComponent(postcode)}`);
      const data = await response.json();
      if (!response.ok || !data.addresses?.length) throw new Error(data.error || "No addresses found");
      select.innerHTML = '<option value="">Select an address</option>';
      data.addresses.forEach((address, index) => {
        const option = document.createElement("option");
        option.value = index;
        option.textContent = [address.line_1, address.line_2, address.line_3, address.county, address.postcode].filter(Boolean).join(", ");
        select.appendChild(option);
      });
      select.onchange = () => {
        const address = data.addresses[Number(select.value)];
        if (!address) return;
        form.elements.address1.value = address.line_1 || "";
        form.elements.address2.value = address.line_2 || "";
        form.elements.address3.value = address.line_3 || "";
        form.elements.county.value = address.county || "";
        form.elements.postcode.value = address.postcode || postcode;
        select.hidden = true;
        form.elements.address1.focus();
      };
    } catch (error) {
      select.innerHTML = "";
      const option = document.createElement("option");
      option.textContent = error.message;
      select.appendChild(option);
    } finally {
      findButton.disabled = false;
      findButton.textContent = "Find address";
    }
  });

  function renderSummary(customer) {
    const address = [customer.address1, customer.address2, customer.address3, customer.county, customer.postcode]
      .filter(Boolean).map(escape).join("<br>");
    document.getElementById("quoteCustomerSummary").innerHTML = `
      <strong>${escape(customer.firstName)} ${escape(customer.lastName)}</strong>
      <p>${address}</p><p>${escape(customer.contactNumber)}<br>${escape(customer.email)}</p>
      <small>Store: ${escape(journey.location_name)}</small>`;
    document.getElementById("quoteFinanceSummary").innerHTML = `<dl>
      <div><dt>Sale amount</dt><dd>${money.format(finance.saleAmount || 0)}</dd></div>
      <div><dt>Deposit</dt><dd>${money.format(finance.deposit || 0)}</dd></div>
      <div><dt>Term</dt><dd>${Number(finance.termMonths || 0)} months</dd></div>
      <div><dt>Estimated monthly</dt><dd>${money.format(finance.estimatedMonthlyPayment || 0)}</dd></div>
      <div><dt>Amount financed</dt><dd>${money.format(finance.amountFinanced || 0)}</dd></div>
      <div><dt>Total payable</dt><dd>${money.format(finance.totalPayable || 0)}</dd></div>
      <div><dt>Interest</dt><dd>${escape(finance.apr || "0% interest")}</dd></div>
    </dl>`;
    document.getElementById("quoteItemsSummary").innerHTML = items.map((item) => `
      <div class="quote-item-row"><div><strong>${escape(item.parentName)}</strong><span>${escape(item.itemName)}</span>
      <small>${Object.entries(item.options || {}).map(([name, value]) => `${escape(name)}: ${escape(value)}`).join(" · ")}</small></div>
      <b>${money.format(item.price || 0)}</b></div>`).join("");
    document.getElementById("quoteItemsTotal").textContent =
      money.format(items.reduce((sum, item) => sum + Number(item.price || 0), 0));
    document.getElementById("quoteDetailsPanel").hidden = true;
    document.getElementById("quoteSummary").hidden = false;
    const progress = document.getElementById("quoteJourneyProgress");
    progress.querySelectorAll("li").forEach((step) => step.classList.add("is-complete"));
    progress.querySelector("[aria-current]")?.removeAttribute("aria-current");
    document.getElementById("quoteSummary").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!journey) return;
    const customer = Object.fromEntries(new FormData(form).entries());
    summaryCustomer = customer;
    status.textContent = "";
    renderSummary(customer);
  });

  document.getElementById("quoteSendButton").addEventListener("click", async () => {
    if (!journey || !summaryCustomer) return;
    const sendButton = document.getElementById("quoteSendButton");
    const sendStatus = document.getElementById("quoteSendStatus");
    sendButton.disabled = true;
    sendButton.textContent = "Sending…";
    sendStatus.textContent = "Sending your quote request…";
    try {
      const response = await fetch(`/api/qr-journeys/public/${encodeURIComponent(token)}/quote-request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: summaryCustomer, items, finance, requestKey }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to send your quote");
      const reference = document.getElementById("quoteReference");
      reference.textContent = `Quote ${data.quoteNumber || data.quoteId || data.requestId}`;
      reference.hidden = false;
      sendButton.textContent = "Quote sent";
      sendStatus.textContent = "Thank you. Your quote request has been sent.";
      sendStatus.dataset.tone = "success";
    } catch (error) {
      sendStatus.textContent = error.message;
      sendStatus.dataset.tone = "error";
      sendButton.disabled = false;
      sendButton.textContent = "Send Quote";
    }
  });
});
