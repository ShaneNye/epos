const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "netsuiteSalesOrder.js"),
  "utf8"
);

test("Sales View derives sale price from NetSuite's discounted line amount", () => {
  const retailRate = 1499.17;
  const quantity = 2;
  const discountedNetAmount = 2398.68;
  const gross = +(discountedNetAmount * 1.2).toFixed(2);
  const retailGross = +(retailRate * quantity * 1.2).toFixed(2);
  const vat = +(gross - discountedNetAmount).toFixed(2);

  assert.equal(gross, 2878.42);
  assert.equal(retailGross, 3598.01);
  assert.equal(vat, 479.74);
  assert.match(source, /const saleprice = \+\(net \* \(vatFree \? 1 : 1\.2\)\)\.toFixed\(2\)/);
  assert.doesNotMatch(source, /const grossFromRate = rawRate \* qty/);
  assert.match(source, /const vat = vatFree \? 0 : \+\(saleprice - net\)\.toFixed\(2\)/);
  assert.match(source, /const lineRate = rawRate/);
});

test("Sales View exposes retail totals separately from the transaction sale amount", () => {
  const routeSource = fs.readFileSync(path.join(__dirname, "..", "routes", "netsuiteSalesOrder.js"), "utf8");
  const viewSource = fs.readFileSync(path.join(__dirname, "..", "public", "js", "salesViewItemLine.js"), "utf8");

  assert.match(routeSource, /retailGrossLine:\s*retailAmount/);
  assert.match(routeSource, /amountGrossLine:\s*saleprice/);
  assert.match(viewSource, /line\.retailGrossLine\s*\?\?/);
  assert.match(viewSource, /line\.retailAmount\s*\?\?/);
});
