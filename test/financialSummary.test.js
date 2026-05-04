const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadFinancials() {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "public", "js", "financialSummary.js"),
    "utf8"
  );
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(script, context);
  return context.window.EposFinancials;
}

test("summariseLines matches normal sale, discount, deposit, and VAT totals", () => {
  const financials = loadFinancials();
  const summary = financials.summariseLines(
    [
      {
        item: { refName: "Mattress" },
        quantity: 2,
        amount: 1200,
        saleprice: 1000,
        vat: 166.67,
      },
    ],
    [{ amount: 250 }]
  );

  assert.equal(summary.totalRetail, 1200);
  assert.equal(summary.grossTotal, 1000);
  assert.equal(summary.vatTotal, 166.67);
  assert.equal(summary.discountTotal, 200);
  assert.equal(summary.depositTotal, 250);
  assert.equal(summary.remainingBalance, 750);
  assert.equal(summary.discountPct, 16.67);
});

test("negative promo/trade-in lines reduce totals consistently", () => {
  const financials = loadFinancials();
  const summary = financials.summariseLines([
    {
      item: { refName: "Bed Frame" },
      amount: 600,
      saleprice: 600,
      vat: 100,
    },
    {
      item: { refName: "Trade In Voucher" },
      amount: 50,
      saleprice: 50,
      vat: 8.33,
    },
  ]);

  assert.equal(summary.totalRetail, 550);
  assert.equal(summary.grossTotal, 550);
  assert.equal(summary.vatTotal, 91.67);
  assert.equal(summary.discountTotal, 0);
});

test("formatMoney and line classification are stable", () => {
  const financials = loadFinancials();

  assert.equal(financials.formatMoney("12.5"), "£12.50");
  assert.equal(financials.isNegativeValueLine("Blue Light Promotion"), true);
  assert.equal(financials.isNegativeValueLine("Standard Mattress"), false);
});
