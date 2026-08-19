const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "netsuiteSalesOrder.js"),
  "utf8"
);

test("saved sales-order gross values retain NetSuite line-rate precision", () => {
  const rate = 569.625;
  const roundedNet = 569.63;
  const gross = +(rate * 1.2).toFixed(2);
  const vat = +(gross - roundedNet).toFixed(2);

  assert.equal(gross, 683.55);
  assert.equal(vat, 113.92);
  assert.match(source, /const grossFromRate = rawRate \* qty \* \(vatFree \? 1 : 1\.2\)/);
  assert.match(source, /const vat = vatFree \? 0 : \+\(saleprice - net\)\.toFixed\(2\)/);
  assert.match(source, /const lineRate = rawRate/);
});
