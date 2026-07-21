const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routeSource = fs.readFileSync(
  path.join(__dirname, "..", "routes", "netsuiteSalesOrder.js"),
  "utf8"
);
const pageSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "raiseCase.html"),
  "utf8"
);

test("workflow transaction candidates include the custom form display value", () => {
  assert.match(routeSource, /BUILTIN\.DF\(customform\) AS customform_display/);
  assert.match(
    routeSource,
    /customForm:\s*cleanDraftValue\(rowValue\(row, "customform_display", "CUSTOMFORM_DISPLAY"\)\)/
  );
});

test("workflow selection table shows custom form only for sales orders", () => {
  assert.match(pageSource, /const isSalesOrder = \["salesorder", "sales_order"\]/);
  assert.match(pageSource, /isSalesOrder \? "<th>Custom Form<\/th>" : ""/);
  assert.match(pageSource, /isSalesOrder \? `<td>\$\{escapeHtml\(candidate\.customForm \|\| "-"\)\}<\/td>` : ""/);
});
