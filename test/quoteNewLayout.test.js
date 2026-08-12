const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("Quote New summary uses the bounded third-column wrapper", () => {
  const html = read("public/quoteNew.html");
  const layout = html.match(/<div class="form-row three-column">[\s\S]*?<section class="form-section order-items-section">/)?.[0] || "";
  assert.match(layout, /<div class="order-side-panels quote-side-panels">\s*<!--[\s\S]*?<aside class="order-summary">/);
  assert.match(layout, /<\/aside>\s*<\/div>\s*<\/div>/);
});

test("shared sales layout gives the quote summary column a fixed proportion", () => {
  const css = read("public/css/sales.css");
  assert.match(css, /\.order-side-panels \{[\s\S]*?flex: 0 0 22%;[\s\S]*?min-width: 250px;/);
  assert.match(css, /\.quote-page \.quote-side-panels/);
});

test("shared transaction layout keeps Contact Information content-height", () => {
  const css = read("public/css/sales.css");
  assert.match(css, /\.right-main > #contactInfoSection \{\s*flex: 0 0 auto;/);
  assert.match(css, /\.right-main > #orderDetailsSection \{\s*flex: 1 1 auto;/);
});
