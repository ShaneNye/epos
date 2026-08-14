const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Sales Kiosk and Sales Tools are absent from routes, menu, and role options", () => {
  const sources = ["server.js", "public/menu.html", "public/js/adminRoles.js", "public/admin.html"]
    .map(read)
    .join("\n");
  assert.doesNotMatch(sources, /sales[ -]kiosk|sales[ -]tools|salesKiosk|salesTools/i);
});

test("promotion item selection uses the standard item endpoint", () => {
  assert.doesNotMatch(read("public/js/promotions.js"), /kiosk-items/);
  assert.doesNotMatch(read("public/js/orderPromotions.js"), /kiosk-items/);
  assert.match(read("public/js/promotions.js"), /api\/netsuite\/items/);
});
