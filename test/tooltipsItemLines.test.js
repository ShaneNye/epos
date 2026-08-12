const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("tooltip runtime ignores clicks on interactive controls inside labels", () => {
  const source = read("public/js/tooltips.js");
  assert.match(source, /event\.target\.closest\?\.\("input, select, textarea, option, button, a"\)/);
});

test("legacy item control tooltip keys fall back to their table column header", () => {
  const source = read("public/js/tooltips.js");
  assert.match(source, /const cell = field\.closest\("td"\)/);
  assert.match(source, /const columnHeader = headerRow\?\.cells\?\.\[cellIndex\]/);
  assert.match(source, /if \(columnHeader\) return columnHeader/);
});

test("tooltip styling is isolated to label text and item-line bubbles open above", () => {
  const runtime = read("public/js/tooltips.js");
  const styles = read("public/css/tooltips.css");
  assert.match(runtime, /function tooltipTriggerFor\(label\)/);
  assert.match(runtime, /trigger\.className = "epos-tooltip-label-text"/);
  assert.match(runtime, /label\.classList\.add\("epos-tooltip-above"\)/);
  assert.match(styles, /\.epos-tooltip-above \.epos-tooltip-message \{ top: auto; bottom: calc\(100% \+ 10px\); \}/);
  assert.match(runtime, /document\.body\.appendChild\(tip\)/);
  assert.match(styles, /\.epos-tooltip-message\.epos-tooltip-portal \{ position: fixed/);
});

test("item-line table headers expose stable tooltip fields", () => {
  ["public/newSalesOrder.html", "public/quoteNew.html", "public/quoteView.html", "public/salesOrderView.html"]
    .forEach((file) => {
      const source = read(file);
      assert.match(source, /data-tooltip-field="item-line-item"/);
      assert.match(source, /data-tooltip-field="item-line-quantity"/);
      assert.match(source, /data-tooltip-field="item-line-sale-price"/);
    });
});

test("tooltip catalogue discovers explicitly declared dynamic field labels", () => {
  const source = read("routes/tooltips.js");
  assert.match(source, /data-tooltip-field/);
  assert.match(source, /fields\.set\(key, \{ key, label \}\)/);
});
