const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const salesOrderRouteSource = fs.readFileSync(
  path.join(__dirname, "..", "routes", "netsuiteSalesOrder.js"),
  "utf8"
);
const salesOrderViewSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "salesOrderView.js"),
  "utf8"
);

test("Sales Order save persists deletions before inserting replacement lines", () => {
  assert.match(
    salesOrderRouteSource,
    /const splitDeleteAndInsertSave =\s*reorderLines !== true && saveDeletedLineIds\.length > 0 && hasNewLines;/
  );
  assert.match(
    salesOrderRouteSource,
    /if \(splitDeleteAndInsertSave\) \{[\s\S]*?"Save Sales Order deletions"[\s\S]*?"Save Sales Order lines after deletions"/
  );
  assert.match(
    salesOrderRouteSource,
    /\} else \{[\s\S]*?const payload = \{[\s\S]*?lines: normalizedLines,[\s\S]*?deletedLineIds,[\s\S]*?"Save Sales Order"/
  );
});

test("Sales View reorders persisted lines by deleting and reinserting them in DOM order", () => {
  assert.match(salesOrderViewSource, /reorderLines: window\._salesViewLineOrderDirty === true/);
  assert.match(salesOrderRouteSource, /if \(reorderLines === true\)/);
  assert.match(salesOrderRouteSource, /saveDeletedLineIds = \[\.\.\.new Set\(\[\.\.\.saveDeletedLineIds, \.\.\.reorderedExistingLineIds\]\)\]/);
  assert.match(salesOrderRouteSource, /normalizedLines = normalizedLines\.map\(\(line\) => \(\{[\s\S]*?lineId: "",[\s\S]*?isNew: true/);
  assert.match(
    salesOrderRouteSource,
    /const splitDeleteAndInsertSave =\s*reorderLines !== true && saveDeletedLineIds\.length > 0 && hasNewLines;/
  );
});
