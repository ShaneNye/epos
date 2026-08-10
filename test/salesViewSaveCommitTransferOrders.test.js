const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "netsuiteSalesOrder.js"),
  "utf8"
);

test("Save & Commit builds Transfer Orders from persisted NetSuite lines", () => {
  assert.match(source, /async function loadPersistedTransferOrderLines\(/);
  assert.match(
    source,
    /const persistedLines = await loadPersistedTransferOrderLines\(id, userId\);[\s\S]*?transferOrderLines = persistedLines;/
  );
  assert.match(
    source,
    /createLinkedTransferOrdersForSalesOrder\(\{[\s\S]*?items: transferOrderLines,/
  );
});

