const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isAlwaysAllowedPath,
  isPageShellPath,
  isPublicPath,
  isStaticAssetPath,
} = require("../utils/accessControlRules");

test("public paths are explicit and do not make every route public", () => {
  assert.equal(isPublicPath("/"), true);
  assert.equal(isPublicPath("/index.html"), true);
  assert.equal(isPublicPath("/forgot"), true);
  assert.equal(isPublicPath("/reset"), true);
  assert.equal(isPublicPath("/admin"), false);
  assert.equal(isPublicPath("/orders"), false);
  assert.equal(isPublicPath("/api/users"), false);
  assert.equal(isPublicPath("/api/netsuite/order-management"), false);
});

test("static assets are public but direct protected HTML files are not", () => {
  assert.equal(isStaticAssetPath("/js/financialSummary.js"), true);
  assert.equal(isPublicPath("/js/financialSummary.js"), true);
  assert.equal(isStaticAssetPath("/admin.html"), false);
  assert.equal(isPublicPath("/admin.html"), false);
});

test("receipt/view pages remain openable for existing workflow", () => {
  assert.equal(isAlwaysAllowedPath("/sales/view/123"), true);
  assert.equal(isAlwaysAllowedPath("/sales/reciept/123"), true);
  assert.equal(isAlwaysAllowedPath("/quote/view/123"), true);
  assert.equal(isAlwaysAllowedPath("/quote/reciept/123"), true);
  assert.equal(isAlwaysAllowedPath("/api/netsuite/salesorder/123"), false);
});

test("app shell pages can load while APIs stay protected", () => {
  assert.equal(isPageShellPath("/home"), true);
  assert.equal(isPageShellPath("/home.html"), true);
  assert.equal(isPageShellPath("/admin"), true);
  assert.equal(isPageShellPath("/api/users"), false);
});
