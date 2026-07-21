const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadCheckpointActionHelper(workflowRun) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "raiseCase.html"),
    "utf8"
  );
  const match = source.match(/function workflowCheckpointActions\(\) \{[\s\S]*?\n    \}/);
  assert.ok(match, "workflowCheckpointActions helper should be present");
  const context = { workflowRun };
  vm.createContext(context);
  vm.runInContext(`${match[0]}; result = workflowCheckpointActions();`, context);
  return context.result;
}

test("workflow checkpoint retains actions from every break segment", () => {
  const firstSegment = [{ nodeId: "action-1", executionState: "success" }];
  const secondSegment = [{ nodeId: "action-2", executionState: "skipped" }];
  const result = loadCheckpointActionHelper({
    auditActions: firstSegment,
    actions: secondSegment,
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(result)),
    [...firstSegment, ...secondSegment]
  );
});

test("resuming a workflow archives the completed segment before clearing live actions", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "raiseCase.html"),
    "utf8"
  );
  const resumeFunction = source.match(/async function continueWorkflowFromBreak\(\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(
    resumeFunction,
    /workflowRun\.auditActions = workflowCheckpointActions\(\);[\s\S]*?workflowRun\.actions = \[\];/
  );
});
