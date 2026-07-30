const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const restletSource = fs.readFileSync(
  path.join(__dirname, "..", "SuiteScripts", "eposApproveSalesOrder.js"),
  "utf8"
);

test("credit memo application transforms the customer into a customer payment", () => {
  const functionSource = restletSource.match(
    /function createCreditApplicationPayment\(context\) \{[\s\S]*?\n  \}/
  )?.[0];

  assert.ok(functionSource, "createCreditApplicationPayment should exist");
  assert.match(functionSource, /fromType:\s*record\.Type\.CUSTOMER,/);
  assert.match(functionSource, /fromId:\s*customerId,/);
  assert.doesNotMatch(functionSource, /fromType:\s*record\.Type\.INVOICE,/);
  assert.doesNotMatch(
    functionSource,
    /setValue\(\{\s*fieldId:\s*["']payment["'],\s*value:\s*0\s*\}\)/
  );
});
