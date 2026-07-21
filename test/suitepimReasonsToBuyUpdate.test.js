const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("item management maintains Reasons To Buy reverse links using active items only", () => {
  const browserSource = fs.readFileSync(
    path.join(root, "public", "js", "suitepimWebManagement.js"),
    "utf8"
  );
  const routeSource = fs.readFileSync(path.join(root, "routes", "suitepim.js"), "utf8");

  assert.match(browserSource, /__previousReasonsToBuyInternalIds/);
  assert.match(routeSource, /syncReasonsToBuyItemLinks|patchReasonsToBuyItems/);
  assert.match(routeSource, /fetchItemOptions\(cfg, userId\)/);
  assert.match(routeSource, /existingIds\.filter\(\(id\) => activeItemIds\.has\(String\(id\)\)\)/);
  assert.match(routeSource, /removedInvalidItemIds/);
});
