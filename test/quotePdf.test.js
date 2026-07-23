const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFinanceSummaryPdf } = require("../utils/quotePdf");

const fixture = {
  quoteNumber: "Q123",
  storeName: "Portslade",
  customer: {
    firstName: "Ada",
    lastName: "Lovelace",
    address1: "1 Test Road",
    postcode: "BN1 1AA",
    email: "ada@example.com",
    contactNumber: "01273 000000",
  },
  items: [{
    parentName: "Mattress",
    itemName: "Mattress Double",
    price: 999,
    options: { Size: "Double" },
  }],
  total: 999,
  finance: {
    saleAmount: 999,
    deposit: 99.9,
    amountFinanced: 899.1,
    termMonths: 12,
    estimatedMonthlyPayment: 74.93,
    totalPayable: 999,
    apr: "0% interest",
  },
};

function assertPdf(buffer) {
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buffer.includes(Buffer.from("%%EOF")));
}

test("finance summary PDF contains a valid PDF document", () => {
  assertPdf(buildFinanceSummaryPdf(fixture));
});
