const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const routeSource = fs.readFileSync(path.join(root, "routes", "suitepim.js"), "utf8");
const browserSource = fs.readFileSync(path.join(root, "public", "js", "suitepimImagerySync.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "public", "suitepim-imagery-sync.html"), "utf8");
const fieldsSource = fs.readFileSync(path.join(root, "routes", "suitepimFields.js"), "utf8");

test("generated descriptions target the unrestricted custom NetSuite fields", () => {
  assert.match(fieldsSource, /name: "New Short Desc", internalid: "custitem_sb_wb_short_description"/);
  assert.match(fieldsSource, /name: "Description Preview", internalid: "custitem_sb_web_desc"/);
  assert.match(routeSource, /unrestrictedDescriptionInternalId/);
});

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

test("Imagery Sync refresh narrows the server response using the existing search", () => {
  assert.match(routeSource, /const search = String\(req\.query\.search/);
  assert.match(routeSource, /row\?\.\["Woo ID"\]/);
  assert.match(browserSource, /params\.set\("search", search\)/);
  assert.match(browserSource, /matching “\$\{search\}”/);
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

test("Imagery Sync includes a parent-only Product Description Sync tab", () => {
  assert.match(htmlSource, /data-sync-tab="imagery">Imagery Sync/);
  assert.match(htmlSource, /data-sync-tab="descriptions">Product Description Sync/);
  assert.match(routeSource, /router\.get\("\/description-sync"/);
  assert.match(routeSource, /suitePimBoolean\(row\?\.\["Is Parent"\]\)/);
  ["Description Preview", "New Short Desc", "reasons to buy", "Web Faq's"].forEach((field) => {
    assert.match(routeSource, new RegExp(`"${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.match(browserSource, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
  assert.match(browserSource, /"Page Preview"/);
});

test("Product Description Sync maps SuitePim descriptions to WooCommerce by Woo ID", () => {
  assert.match(routeSource, /function descriptionSyncWooUpdate/);
  assert.match(routeSource, /id: wooId/);
  assert.match(routeSource, /short_description: String\(row\?\.\["New Short Desc"\]/);
  assert.match(routeSource, /description: String\(row\?\.\["Description Preview"\]/);
  assert.match(routeSource, /router\.post\("\/description-sync\/push"/);
  assert.match(browserSource, /"\/description-sync\/push"/);
  assert.match(routeSource, /function descriptionSyncFieldValue/);
  assert.match(routeSource, /\.map\(descriptionSyncRow\)/);
  assert.match(browserSource, /source\.value = String\(row\[column\] \?\? ""\)/);
});

test("Product Description Sync refreshes NetSuite values and successful pushes invalidate stale rows", () => {
  assert.match(browserSource, /load\(mode === "descriptions"\)/);
  assert.match(routeSource, /job\.results\.some\(\(result\) => result\.status === "Success"\)/);
  assert.match(routeSource, /webManagementCache\.delete\(webManagementCacheKey\(job\.env\)\)/);
});

test("Product Description Sync can update every loaded page in safe batches", () => {
  assert.match(htmlSource, /id="imagerySyncPushAll"[^>]*>Update all descriptions/);
  assert.match(browserSource, /function descriptionPushBatches\(rows, maxRows = 25, maxBytes = 750000\)/);
  assert.match(browserSource, /function pushAllDescriptions\(\)/);
  assert.match(browserSource, /return pushRows\(\[\.\.\.state\.rows\]\)/);
  assert.match(browserSource, /for \(let index = 0; index < batches\.length; index \+= 1\)/);
});

test("description sync skips invalid IDs and emails one combined failure report", () => {
  assert.match(routeSource, /rows\.forEach\(\(row\) => \{\s+try \{\s+const update = descriptionSyncWooUpdate/);
  assert.match(routeSource, /router\.post\("\/description-sync\/failure-email"/);
  assert.match(routeSource, /woocommerce-description-sync-failures\.csv/);
  assert.match(browserSource, /failures\.push\(\.\.\.\(data\.results \|\| \[\]\)\.filter/);
  assert.match(browserSource, /"\/description-sync\/failure-email"/);
});
