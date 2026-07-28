const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "orderPromotions.js"),
  "utf8"
);

test("basket promotions are scoped to Quote New and Sales New", () => {
  assert.match(
    source,
    /return pathname === "\/quote\/new" \|\| pathname === "\/sales\/new";/
  );
  assert.match(
    source,
    /function activeBasketPromotions\(\) \{\s*if \(!isNewDocumentPage\(\)\) return \[\];/
  );
});
