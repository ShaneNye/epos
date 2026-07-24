const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const browserSource = fs.readFileSync(
  path.resolve(__dirname, "..", "public", "js", "suitepimWebManagement.js"),
  "utf8"
);

test("feature descriptions can be generated and edited on every item line", () => {
  const permissionFunction = browserSource.slice(
    browserSource.indexOf("function canManageFeatureDescription"),
    browserSource.indexOf("function isCalculatedPriceField")
  );
  const bulkFunction = browserSource.slice(
    browserSource.indexOf("async function generateDescriptionsBulk"),
    browserSource.indexOf("async function ensureOptions")
  );

  assert.match(permissionFunction, /return !!row/);
  assert.doesNotMatch(permissionFunction, /Is Parent/);
  assert.doesNotMatch(bulkFunction, /non-parent|parent row/);
});
