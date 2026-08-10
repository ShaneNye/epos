const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "SuiteScripts", "eposApproveSalesOrder.js"),
  "utf8"
);

test("Sales Order RESTlet does not map EPOS aliases as NetSuite field IDs", () => {
  [
    "fulfilmentMethod",
    "inventoryDetail",
    "saleGrossLine",
    "amountGrossLine",
    "grossSaleprice",
    "takenFromStore",
    "trialOption",
  ].forEach((field) => assert.match(source, new RegExp(`${field}: true`)));
});

test("Sales Order RESTlet reports line-processing failures", () => {
  assert.match(source, /const lineFailures = \[\];/);
  assert.match(source, /lineFailures\.push\(\{/);
  assert.match(
    source,
    /if \(lineFailures\.length\) \{[\s\S]*?ok: false,[\s\S]*?failures: lineFailures/
  );
});

test("Sales Order saves retain EPOS Inv Meta when a lot number is also set", () => {
  assert.match(
    source,
    /if \(canSetLot\) \{[\s\S]*?"custcol_sb_lotnumber", invId[\s\S]*?"custcol_sb_epos_inventory_meta",[\s\S]*?inventoryDetail/
  );
  assert.doesNotMatch(
    source,
    /if \(canSetLot\) \{[\s\S]*?clearCurrentField\(soRec, "custcol_sb_epos_inventory_meta"\)/
  );
});
