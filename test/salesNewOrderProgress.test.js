const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("Sales New includes a static summary stack and live order progress panel", () => {
  const html = read("public/newSalesOrder.html");
  const css = read("public/css/sales.css");
  assert.match(html, /class="order-side-panels"/);
  assert.match(html, /id="orderProgressList"/);
  assert.match(html, /salesNewOrderProgress\.js/);
  assert.match(css, /\.order-summary \{[\s\S]*?position: static;/);
});

test("order progress validates contact, details, fulfilment and required inventory", () => {
  const source = read("public/js/salesNewOrderProgress.js");
  assert.match(source, /emailPattern\.test/);
  assert.match(source, /function orderDetailsComplete/);
  assert.match(source, /function itemLinesComplete/);
  assert.match(source, /\["warehouse", "in store", "fulfil from store"\]\.includes\(method\)/);
  assert.match(source, /row\.dataset\.inventoryMeta/);
  assert.match(source, /warning: !!email && !emailPattern\.test\(email\)/);
  assert.match(source, /Enter a valid email address, including @ and a domain/);
  assert.match(source, /First Name is \$\{firstName\}/);
  assert.doesNotMatch(source, /salesNewProgressConfirmed|order-progress-attention/);
});

test("order progress updates are scoped and coalesced", () => {
  const source = read("public/js/salesNewOrderProgress.js");
  assert.match(source, /if \(!updateFrame\) updateFrame = requestAnimationFrame\(update\)/);
  assert.match(source, /MutationObserver\(scheduleUpdate\)\.observe\(elements\.itemsBody/);
  assert.match(source, /event\.target\.matches\(relevantInputSelector\)/);
  assert.doesNotMatch(source, /root\.addEventListener\("click"/);
});
