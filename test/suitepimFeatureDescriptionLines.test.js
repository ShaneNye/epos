const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const browserSource = fs.readFileSync(
  path.resolve(__dirname, "..", "public", "js", "suitepimWebManagement.js"),
  "utf8"
);
const reasonsSource = fs.readFileSync(
  path.resolve(__dirname, "..", "public", "js", "suitepimReasonsToBuy.js"),
  "utf8"
);
const managementHtml = fs.readFileSync(
  path.resolve(__dirname, "..", "public", "suitepim-web-management.html"),
  "utf8"
);
const reasonsHtml = fs.readFileSync(
  path.resolve(__dirname, "..", "public", "suitepim-reasons-to-buy.html"),
  "utf8"
);

test("detailed descriptions use variation-aware WooCommerce dimension shortcodes", () => {
  [browserSource, reasonsSource].forEach((source) => {
    assert.match(source, /\[sxb_product_attribute name="height"\]/);
    assert.match(source, /\[sxb_product_attribute name="width"\]/);
    assert.match(source, /\[sxb_product_attribute name="length"\]/);
  });
  const generator = browserSource.slice(
    browserSource.indexOf("function webDescriptionHtml"),
    browserSource.indexOf("function buildItemPreviewHtml")
  );
  assert.doesNotMatch(generator, /valueText\(row\.(Width|Height|Depth|Length)\)/);
});

test("60 Night Comfort Trial uses selected reason 2709 for mattress class 15 only", () => {
  [browserSource, reasonsSource].forEach((source) => {
    assert.match(source, /classInternalId === "15" && valueText\(row\.Class\)\.trim\(\)\.toLowerCase\(\) === "mattress"/);
    assert.match(source, /isMattressClass && comfortTrialReason/);
    assert.match(source, /"2709"/);
    assert.match(source, /"60 Night Comfort Trial"/);
  });
  assert.match(browserSource, /renderReasonList\(\[comfortTrialReason\]/);
  assert.match(reasonsSource, /renderReasonListHtml\(\[comfortTrialReason\]/);
  assert.match(browserSource, /detailReasonItems\.find\(\(item\) => item\.id === "2709"\)/);
  assert.match(reasonsSource, /reasons\.find\(\(item\) => item\.id === "2709"\)/);
  assert.doesNotMatch(browserSource, /Enjoy 60 nights to try your new mattress/);
  assert.doesNotMatch(reasonsSource, /Enjoy 60 nights to try your new mattress/);
});

test("description generator pages use the current cache-busted assets", () => {
  assert.match(managementHtml, /suitepimWebManagement\.js\?v=description-template-3/);
  assert.match(reasonsHtml, /suitepimReasonsToBuy\.js\?v=description-template-3/);
});

test("Video panel is generated only for an embeddable video", () => {
  [browserSource, reasonsSource].forEach((source) => {
    assert.match(source, /const videoPanel = videoEmbedUrl/);
    assert.match(source, /\$\{videoPanel\}/);
    assert.match(source, /<details\\b\[\^>\]\*>/);
  });
  assert.doesNotMatch(browserSource, /renderAccordionCard\("Video", videoEmbedUrl \?/);
  assert.doesNotMatch(reasonsSource, /renderAccordionHtml\("Video", videoHtml\)/);
});

test("feature descriptions can be generated and edited on every item line", () => {
  const permissionFunction = browserSource.slice(
    browserSource.indexOf("function canManageFeatureDescription"),
    browserSource.indexOf("function isCalculatedPriceField")
  );
  const bulkFunction = browserSource.slice(
    browserSource.indexOf("async function generateDescriptionsBulk"),
    browserSource.indexOf("async function ensureOptions")
  );

  assert.match(permissionFunction, /return !!row/);
  assert.doesNotMatch(permissionFunction, /Is Parent/);
  assert.doesNotMatch(bulkFunction, /non-parent|parent row/);
});

test("existing description previews can be regenerated without populating blank previews", () => {
  const bulkUpdateSource = browserSource.slice(
    browserSource.indexOf("async function applyBulkUpdate"),
    browserSource.indexOf("function togglePanel")
  );
  const pushSource = browserSource.slice(
    browserSource.indexOf("async function pushSelected"),
    browserSource.indexOf("function openScheduleModal")
  );
  assert.match(browserSource, /Regenerate Existing Description Previews/);
  assert.match(browserSource, /fieldType === "RegeneratePreview"/);
  assert.match(bulkUpdateSource, /if \(!String\(row\["Description Preview"\] \|\| ""\)\.trim\(\)\) return;/);
  assert.match(bulkUpdateSource, /"Description Preview": webDescriptionHtml\(state\.rows\[idx\]\)\.trim\(\)/);
  assert.doesNotMatch(pushSource, /field\.fieldType|targetRows/);
});

test("large pushes are split into size-limited sequential batches", () => {
  const batchSource = browserSource.slice(
    browserSource.indexOf("function pushBatches"),
    browserSource.indexOf("function defaultScheduleTitle")
  );
  assert.match(batchSource, /maxRows = 25, maxBytes = 750000/);
  assert.match(batchSource, /new Blob\(\[JSON\.stringify/);
  assert.match(batchSource, /for \(let index = 0; index < batches\.length; index \+= 1\)/);
  assert.match(batchSource, /await waitForPushJob/);
  assert.doesNotMatch(batchSource, /pollJob\(data\.jobId\)/);
});

test("feature benefit HTML collapses without an embedded media style tag", () => {
  const reasonListSource = browserSource.slice(
    browserSource.indexOf("function renderReasonList"),
    browserSource.indexOf("function renderAccordionCard")
  );
  assert.match(reasonListSource, /repeat\(auto-fit, minmax\(min\(280px, 100%\), 1fr\)\)/);
  assert.doesNotMatch(reasonListSource, /@media/);
});

test("lower product accordions use a full-width single-column layout", () => {
  [browserSource, reasonsSource].forEach((source) => {
    assert.match(source, /grid-template-columns:minmax\(0, 1fr\); gap:18px; margin-top:14px; align-items:start; width:100%/);
  });
});
