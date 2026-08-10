const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "salesOrderView.js"),
  "utf8"
);

test("Sales View requires Payment Info before saving or committing", () => {
  assert.match(source, /function validateSalesViewPaymentInfo\(\)/);
  assert.match(
    source,
    /freshSaveBtn\.addEventListener\("click",[\s\S]*?if \(!validateSalesViewPaymentInfo\(\)\) return;/
  );
  assert.match(
    source,
    /freshCommitBtn\.addEventListener\("click",[\s\S]*?if \(!validateSalesViewPaymentInfo\(\)\) return;/
  );
});

