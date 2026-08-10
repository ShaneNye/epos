const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "quoteView.js"),
  "utf8"
);

test("Quote View marks conversion as save-first when the quote has unsaved changes", () => {
  assert.match(
    source,
    /button\.textContent = quoteHasUnsavedChanges\(\)[\s\S]*?"Save & Convert to Sale"[\s\S]*?: "Convert to Sale";/
  );
  assert.match(
    source,
    /const requiresSaveFirst = signature !== window\._lastQuoteSaveSignature;[\s\S]*?if \(requiresSaveFirst\) \{[\s\S]*?\/save`/
  );
});

