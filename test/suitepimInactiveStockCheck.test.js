const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "suitepimWebManagement.js"),
  "utf8"
);

test("single-item inactive check loads inventory independently of visible columns", () => {
  const check = source.match(/async function confirmInactiveWithStock\(row\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(check, /await ensureInventoryBalances\(\)/);
  assert.match(check, /hasAvailableStock\(row\)/);
  assert.doesNotMatch(check, /visibleColumns/);
});

test("bulk inactive updates confirm when any targeted item has stock", () => {
  assert.match(source, /async function confirmBulkInactiveWithStock\(rows\)/);
  assert.match(source, /rows\.filter\(\(row\) => !boolValue\(row\.Inactive\) && hasAvailableStock\(row\)\)/);
  assert.match(source, /field\.name === "Inactive" && boolValue\(draft\.value\)/);
  assert.match(source, /await confirmBulkInactiveWithStock\(targetRows\)/);
});

test("inactive changes stop when the inventory check fails", () => {
  assert.match(source, /Could not check stock on hand:/);
  assert.match(source, /if \(state\.inventoryError\)[\s\S]*?return false/);
});
