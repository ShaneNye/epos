const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routeSource = fs.readFileSync(
  path.resolve(__dirname, "..", "routes", "suitepim.js"),
  "utf8"
);

test("Item FAQ reverse links preserve active linked items and discard invalid ones", () => {
  const syncFunction = routeSource.slice(
    routeSource.indexOf("async function syncItemFaqLinks"),
    routeSource.indexOf("function buildOptionLookup")
  );

  assert.match(syncFunction, /fetchItemOptions\(cfg, userId\)/);
  assert.match(syncFunction, /existingIds\.filter\(\(id\) => activeItemIds\.has\(String\(id\)\)\)/);
  assert.match(syncFunction, /currentItems\.add\(itemInternalId\)/);
  assert.match(syncFunction, /currentItems\.delete\(itemInternalId\)/);
  assert.match(syncFunction, /removedInvalidItemIds/);
});
