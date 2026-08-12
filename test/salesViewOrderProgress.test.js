const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const progress = require("../public/js/salesViewOrderProgress.js");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("Sales View includes a read-only order lifecycle panel", () => {
  const html = read("public/salesOrderView.html");
  for (const key of ["deposit", "committed", "intercompany", "ready", "dispatch", "billed"]) {
    assert.match(html, new RegExp(`data-milestone="${key}"`));
  }
  const panel = html.match(/<aside class="sales-view-progress"[\s\S]*?<\/aside>/)?.[0] || "";
  assert.doesNotMatch(panel, /type="checkbox"/);
});

test("saved order milestones derive from NetSuite order data", () => {
  const states = progress.deriveMilestones({
    orderStatus: { id: "G", refName: "Billed" },
    relatedRecords: { custbody_sb_pairedsalesorder: { id: "456" } },
    item: { items: [{ itemClass: "Inventory Item", quantity: 2, quantityCommitted: 0,
      custcol_sb_fulfilmentlocation: { refName: "Warehouse" } }] },
    custbody_exported_to_dispatchtrack: true,
  }, [{ type: "Customer Deposit", amount: 20 }]);
  assert.deepEqual(states, { deposit: true, committed: true, intercompany: true, ready: true, dispatch: true, billed: true });
});

test("readiness requires every open stock line quantity to be committed", () => {
  const order = { orderStatus: { id: "B" }, item: { items: [
    { itemClass: "Inventory Item", quantity: 2, quantityCommitted: 2 },
    { itemClass: "Inventory Item", quantity: 3, quantityCommitted: 2 },
    { itemClass: "Service", quantity: 1, quantityCommitted: 0 },
  ] } };
  assert.equal(progress.isReadyForDelivery(order), false);
  order.item.items[1].quantityCommitted = 3;
  assert.equal(progress.isReadyForDelivery(order), true);
});

test("refunds do not satisfy the customer deposit milestone", () => {
  assert.equal(progress.hasCustomerDeposit([{ type: "Customer Refund", amount: 50 }]), false);
  assert.equal(progress.hasCustomerDeposit([{ type: "Customer Deposit", amount: 1 }]), true);
});

test("DispatchTrack is required only for special-order or warehouse lines", () => {
  assert.equal(progress.requiresDispatchTrack({ item: { items: [
    { custcol_sb_fulfilmentlocation: { refName: "In Store" } },
  ] } }), false);
  assert.equal(progress.requiresDispatchTrack({ item: { items: [
    { custcol_sb_fulfilmentlocation: { refName: "Special Order" } },
  ] } }), true);
});

test("Sales View response exposes quantity committed from SuiteQL", () => {
  const route = read("routes/netsuiteSalesOrder.js");
  assert.match(route, /item,\s+quantity,\s+quantitycommitted,/);
  assert.match(route, /quantityCommitted: Math\.abs/);
});
