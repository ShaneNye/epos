const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(path.join(root, "routes", "suitepim.js"), "utf8");
const browserSource = fs.readFileSync(path.join(root, "public", "js", "suitepimImagerySync.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "public", "suitepim-imagery-sync.html"), "utf8");

test("Imagery Sync is fixed to Woo-linked item image fields", () => {
  assert.match(routeSource, /const IMAGERY_SYNC_FIELDS = \[/);
  assert.match(routeSource, /\.filter\(\(row\) => String\(row\?\.\["Woo ID"\]/);
  [
    "Internal ID",
    "Woo ID",
    "Name",
    "Catalogue Image One",
    "Catalogue Image Two",
    "Catalogue Image Three",
    "Catalogue Image Four",
    "Catalogue Image Five",
  ].forEach((field) => assert.match(routeSource, new RegExp(`"${field}"`)));
  assert.match(htmlSource, /<h1>Imagery Sync<\/h1>/);
});

test("Imagery Sync maps ordered catalogue images to the Woo product images array", () => {
  assert.match(routeSource, /function imagerySyncWooUpdate/);
  assert.match(routeSource, /images: urls\.map\(\(src\) => \(\{ src: mapImageUrl\(src\) \}\)\)/);
  assert.match(routeSource, /callWooProductBatch\(\{ cfg, updates:/);
  assert.match(routeSource, /WOO_STORE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET/);
  assert.match(browserSource, /"\/imagery-sync\/push"/);
});

test("Imagery Sync proxies NetSuite media and verifies Woo imported every image", () => {
  assert.match(routeSource, /function imagerySyncWooSourceUrl/);
  assert.match(routeSource, /if \(!publicOrigin\) return sourceUrl/);
  assert.match(routeSource, /hostname === "localhost"/);
  assert.match(routeSource, /\/api\/suitepim\/image-proxy\/netsuite-\$\{sourceId/);
  assert.match(routeSource, /"Content-Disposition"/);
  assert.match(routeSource, /actualImageCount >= expectedImageCount/);
  assert.match(routeSource, /embeddedError\?\.message/);
  assert.match(routeSource, /res\.status\(failures\.length \? 502 : 200\)/);
});
