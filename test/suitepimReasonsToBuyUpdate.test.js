const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("item management maintains Reasons To Buy reverse links using active items only", () => {
  const browserSource = fs.readFileSync(
    path.join(root, "public", "js", "suitepimWebManagement.js"),
    "utf8"
  );
  const routeSource = fs.readFileSync(path.join(root, "routes", "suitepim.js"), "utf8");

  assert.match(browserSource, /__previousReasonsToBuyInternalIds/);
  assert.match(routeSource, /syncReasonsToBuyItemLinks|patchReasonsToBuyItems/);
  assert.match(routeSource, /fetchItemOptions\(cfg, userId\)/);
  assert.match(routeSource, /existingIds\.filter\(\(id\) => activeItemIds\.has\(String\(id\)\)\)/);
  assert.match(routeSource, /removedInvalidItemIds/);
});

test("item management persists and reloads Reasons To Buy placement and order", () => {
  const browserSource = fs.readFileSync(
    path.join(root, "public", "js", "suitepimWebManagement.js"),
    "utf8"
  );
  const routeSource = fs.readFileSync(path.join(root, "routes", "suitepim.js"), "utf8");

  assert.match(browserSource, /payload\.__reasonsToBuyConfig = clean\[key\]/);
  assert.match(browserSource, /row = latestRow\(row\) \|\| row/);
  assert.match(browserSource, /captureReasonModalInputs\(\)/);
  assert.match(browserSource, /option\?\.raw\?\.Priority/);
  assert.match(browserSource, /manualOrder/);
  assert.match(routeSource, /CREATE TABLE IF NOT EXISTS suitepim_item_reasons_display/);
  assert.match(routeSource, /saveReasonsDisplayConfig\(/);
  assert.match(routeSource, /loadReasonsDisplayConfigs\(env\)/);
  assert.match(routeSource, /__reasonsToBuyConfig: savedConfig/);
});

test("Reasons To Buy exposes the NetSuite Priority integer field", () => {
  const browserSource = fs.readFileSync(
    path.join(root, "public", "js", "suitepimReasonsToBuy.js"),
    "utf8"
  );
  const routeSource = fs.readFileSync(path.join(root, "routes", "suitepim.js"), "utf8");

  assert.match(routeSource, /name: "Priority".*fieldType: "Integer"/);
  assert.match(routeSource, /custrecord_sb_rtb_display_prioity/);
  assert.match(routeSource, /Number\.parseInt/);
  assert.match(browserSource, /Priority: ""/);
});

test("Reasons To Buy description defaults flow into Item Management with manual overrides", () => {
  const reasonsSource = fs.readFileSync(
    path.join(root, "public", "js", "suitepimReasonsToBuy.js"),
    "utf8"
  );
  const itemManagementSource = fs.readFileSync(
    path.join(root, "public", "js", "suitepimWebManagement.js"),
    "utf8"
  );
  const routeSource = fs.readFileSync(path.join(root, "routes", "suitepim.js"), "utf8");

  assert.match(routeSource, /custrecord_sb_default_desc_default/);
  assert.match(routeSource, /custrecord_sb_details_desc_default/);
  assert.match(reasonsSource, /"Short Description Default": false/);
  assert.match(reasonsSource, /"Detailed Description Default": false/);
  assert.match(itemManagementSource, /defaultFeature/);
  assert.match(itemManagementSource, /defaultShort/);
  assert.match(itemManagementSource, /manualFeature/);
  assert.match(itemManagementSource, /manualShort/);
});
