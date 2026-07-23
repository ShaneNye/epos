const fs = require("fs/promises");
const path = require("path");

let browserPromise = null;

async function browserInstance() {
  const puppeteer = require("puppeteer");
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  const browser = await browserPromise;
  if (!browser.connected) {
    browserPromise = null;
    return browserInstance();
  }
  return browser;
}

function money(value) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" })
    .format(Number(value) || 0);
}

async function buildHtmlQuoteReceiptPdf({
  appBaseUrl,
  quoteNumber,
  store,
  customer,
  items,
  total,
}) {
  const templatePath = path.join(__dirname, "..", "public", "quoteReciept.html");
  let html = await fs.readFile(templatePath, "utf8");
  html = html
    .replace("<head>", `<head><base href="${String(appBaseUrl).replace(/"/g, "&quot;")}/">`)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace('class="receipt-loading"', "");

  const originalTotal = items.reduce(
    (sum, item) => sum + Number(item.retailPrice || item.price || 0),
    0
  );
  const discount = Math.max(0, originalTotal - Number(total || 0));
  const discountPercent = originalTotal > 0 ? (discount / originalTotal) * 100 : 0;
  const vat = Number(total || 0) - Number(total || 0) / 1.2;
  const payload = {
    quoteNumber: String(quoteNumber || ""),
    quoteDate: new Date().toLocaleDateString("en-GB"),
    salesRep: String(store.managerName || ""),
    store: {
      name: String(store.name || ""),
      phone: String(store.phone || ""),
      email: String(store.email || ""),
      vatNumber: String(store.vatNumber || ""),
      companyNumber: String(store.companyNumber || ""),
      address1: String(store.address1 || ""),
      address2: String(store.address2 || ""),
      postcode: String(store.postcode || ""),
    },
    customer: {
      name: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
      address1: String(customer.address1 || ""),
      address2: String(customer.address2 || ""),
      address3: [customer.address3, customer.county].filter(Boolean).join(", "),
      postcode: String(customer.postcode || ""),
      email: String(customer.email || ""),
      phone: String(customer.contactNumber || ""),
    },
    items: items.map((item) => {
      const retail = Number(item.retailPrice || item.price || 0);
      const sale = Number(item.price || 0);
      return {
        name: String(item.parentName || item.itemName || ""),
        options: [
          item.itemName && item.itemName !== item.parentName ? item.itemName : "",
          Object.entries(item.options || {}).map(([name, value]) => `${name}: ${value}`).join(", "),
        ].filter(Boolean).join("\n"),
        retail: money(retail),
        discount: retail > 0 && sale < retail ? `${(((retail - sale) / retail) * 100).toFixed(1)}%` : "0.0%",
        total: money(sale),
      };
    }),
    originalTotal: money(originalTotal),
    discount: money(discount),
    discountPercent: `${discountPercent.toFixed(1)}%`,
    vat: money(vat),
    total: money(total),
  };

  const browser = await browserInstance();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluate((data) => {
      const set = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value || "-";
      };
      set("storeName", data.store.name);
      set("storeTel", data.store.phone);
      set("storeEmail", data.store.email);
      set("storeVatNo", data.store.vatNumber);
      set("storeCompanyNo", data.store.companyNumber);
      set("storeAdd1", data.store.address1);
      set("storeAdd2", data.store.address2);
      set("storePostcode", data.store.postcode);
      set("customerName", data.customer.name);
      set("custadd1", data.customer.address1);
      set("custadd2", data.customer.address2);
      set("custadd3", data.customer.address3);
      set("custzip", data.customer.postcode);
      set("custEmail", data.customer.email);
      set("custTel", data.customer.phone);
      set("quoteNo", data.quoteNumber);
      set("quoteDate", data.quoteDate);
      set("pymtMthd", "Finance illustration");
      set("salesRep", data.salesRep || "Online quote");
      set("originalPrice", data.originalTotal);
      set("discAmount", data.discount);
      set("totalDiscPerc", data.discountPercent);
      set("vatTotal", data.vat);
      set("quoteTotal", data.total);
      set("balance", data.total);
      const productBody = document.getElementById("productTableBody");
      productBody.replaceChildren(...data.items.map((item) => {
        const row = document.createElement("tr");
        [item.name, item.options, "1", item.retail, item.discount, item.total].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          cell.style.whiteSpace = "pre-line";
          row.appendChild(cell);
        });
        return row;
      }));
      const depositBody = document.getElementById("depositTableBody");
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 3;
      emptyCell.textContent = "No deposits recorded";
      emptyCell.style.textAlign = "center";
      emptyCell.style.color = "#64748b";
      emptyRow.appendChild(emptyCell);
      depositBody.replaceChildren(emptyRow);
      document.body.classList.remove("receipt-loading");
      document.body.classList.add("receipt-ready");
    }, payload);
    await page.emulateMediaType("print");
    return Buffer.from(await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    }));
  } finally {
    await page.close();
  }
}

module.exports = { buildHtmlQuoteReceiptPdf };
