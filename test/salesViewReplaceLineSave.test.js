const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "netsuiteSalesOrder.js"),
  "utf8"
);

test("Sales Order save persists deletions before inserting replacement lines", () => {
  assert.match(
    source,
    /const splitDeleteAndInsertSave = deletedLineIds\.length > 0 && hasNewLines;/
  );
  assert.match(
    source,
    /if \(splitDeleteAndInsertSave\) \{[\s\S]*?"Save Sales Order deletions"[\s\S]*?"Save Sales Order lines after deletions"/
  );
  assert.match(
    source,
    /\} else \{[\s\S]*?const payload = \{[\s\S]*?lines: normalizedLines,[\s\S]*?deletedLineIds,[\s\S]*?"Save Sales Order"/
  );
});
