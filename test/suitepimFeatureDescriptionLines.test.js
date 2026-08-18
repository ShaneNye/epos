const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const browserSource = fs.readFileSync(
  path.resolve(__dirname, "..", "public", "js", "suitepimWebManagement.js"),
  "utf8"
);

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

test("lower product accordions collapse to full width without media CSS", () => {
  const matches = browserSource.match(/grid-template-columns:repeat\(auto-fit, minmax\(min\(280px, 100%\), 1fr\)\)/g) || [];
  assert.ok(matches.length >= 2, "feature list and lower accordion grid should both auto-fit");
});
