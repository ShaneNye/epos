const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Support Tracker is assignable in the role editor and represented in the menu", () => {
  const root = path.join(__dirname, "..");
  const roles = fs.readFileSync(path.join(root, "public", "js", "adminRoles.js"), "utf8");
  const menu = fs.readFileSync(path.join(root, "public", "menu.html"), "utf8");
  assert.match(roles, /value:\s*["']support-tracker["']/);
  assert.match(menu, /href=["']\/support-tracker["']/);
});

test("Support logging and management are separate responsive pages", () => {
  const root = path.join(__dirname, "..");
  const logger = fs.readFileSync(path.join(root, "public", "support-tracker.html"), "utf8");
  const manage = fs.readFileSync(path.join(root, "public", "support-tracker-manage.html"), "utf8");
  assert.match(logger, /id="supportForm"/);
  assert.doesNotMatch(logger, /id="analyticsPanel"|id="configurationPanel"/);
  assert.match(manage, /id="analyticsPanel"/);
  assert.match(manage, /id="configurationPanel"/);
  assert.doesNotMatch(manage, /id="supportForm"/);
});

test("Support Tracker management inherits the Support Tracker role permission", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const menu = fs.readFileSync(path.join(root, "public", "js", "menu.js"), "utf8");
  const rule = /slug\.startsWith\(["']support-tracker\/["']\)\) return ["']support-tracker["']/;
  assert.match(server, rule);
  assert.match(menu, rule);
});

test("Support configuration uses dependent system and category selectors", () => {
  const root = path.join(__dirname, "..");
  const script = fs.readFileSync(path.join(root, "public", "js", "support-tracker-manage.js"), "utf8");
  assert.match(script, /data-add=\"categories\"[^`]*select name=\"parentId\"/);
  assert.match(script, /data-add=\"issues\"[^`]*select name=\"systemId\"/);
  assert.match(script, /items\('categories'\)\.filter\(x=>String\(x\.parent_id\)===system\.value\)/);
  assert.doesNotMatch(script, /prompt\('System ID'\)|prompt\('Category ID'\)/);
});

test("Support configuration offers guarded deletion instead of disable toggles", () => {
  const root = path.join(__dirname, "..");
  const client = fs.readFileSync(path.join(root, "public", "js", "support-tracker-manage.js"), "utf8");
  const route = fs.readFileSync(path.join(root, "routes", "supportTracker.js"), "utf8");
  assert.match(client, /data-delete=/);
  assert.doesNotMatch(client, /data-toggle=|>Disable<|>Enable</);
  assert.match(route, /router\.delete\("\/config\/:type\/:id"/);
  assert.match(route, /support_requests/);
  assert.match(route, /status\(409\)/);
});

test("Support logger can search and add issues while resolution and cause use dropdowns", () => {
  const root = path.join(__dirname, "..");
  const page = fs.readFileSync(path.join(root, "public", "support-tracker.html"), "utf8");
  const client = fs.readFileSync(path.join(root, "public", "js", "support-tracker-log.js"), "utf8");
  const route = fs.readFileSync(path.join(root, "routes", "supportTracker.js"), "utf8");
  assert.doesNotMatch(page, /<select id="(?:user|location|issue)Id"/);
  assert.match(page, /<select id="systemId"/);
  assert.match(page, /<select id="categoryId"/);
  assert.match(page, /data-field="issueId"/);
  assert.match(page, /<select id="resolutionId" required>/);
  assert.match(page, /<select id="causeId" required>/);
  assert.match(client, /term\.length<3/);
  assert.match(client, /Add .* as a new issue/);
  assert.match(client, /systemId:\$\('systemId'\)\.value,categoryId:\$\('categoryId'\)\.value/);
  assert.match(client, /fillSelect\('resolutionId',items\('resolutions'\)/);
  assert.match(client, /fillSelect\('causeId',items\('causes'\)/);
  assert.match(route, /router\.post\("\/issues\/quick-add"/);
});

test("Support logger starts with blank user and location", () => {
  const root = path.join(__dirname, "..");
  const client = fs.readFileSync(path.join(root, "public", "js", "support-tracker-log.js"), "utf8");
  assert.doesNotMatch(client, /data\.currentUserId/);
  assert.match(client, /controls\.user=makeSearch\('userId','userSearch',data\.users,userLocation\)/);
});

test("Support logger discards timer sessions older than 24 hours", () => {
  const root = path.join(__dirname, "..");
  const client = fs.readFileSync(path.join(root, "public", "js", "support-tracker-log.js"), "utf8");
  assert.match(client, /Date\.now\(\)-started\.getTime\(\)<=86400000/);
  assert.match(client, /localStorage\.removeItem\('supportActiveTimer'\)/);
});
