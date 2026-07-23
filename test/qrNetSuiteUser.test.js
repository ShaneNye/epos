const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizedEnvironment, resolveQrNetSuiteContext } = require("../utils/qrNetSuiteUser");

test("normalizes production aliases", () => {
  assert.equal(normalizedEnvironment("PROD"), "PRODUCTION");
  assert.equal(normalizedEnvironment("SANDBOX"), "SANDBOX");
});

test("sandbox QR quotes resolve Shane Nye and sandbox credentials", async () => {
  let sql = "";
  const pool = {
    async query(query) {
      sql = query;
      return {
        rows: [{
          user_id: 12,
          firstname: "Shane",
          lastname: "Nye",
          netsuiteid: "101",
          token_id: "sandbox-id",
          token_secret: "sandbox-secret",
          netsuite_internal_id: "1",
          invoice_location_id: "2",
        }],
      };
    },
  };
  const context = await resolveQrNetSuiteContext(pool, 4, "SANDBOX");
  assert.match(sql, /LOWER\(TRIM\(u\.firstname\)\) = 'shane'/);
  assert.equal(context.userId, 12);
  assert.equal(context.netSuiteEmployeeId, "101");
  assert.equal(context.environment, "SANDBOX");
});

test("production QR quotes resolve the location store manager", async () => {
  let sql = "";
  const pool = {
    async query(query) {
      sql = query;
      return {
        rows: [{
          user_id: 22,
          firstname: "Store",
          lastname: "Manager",
          netsuiteid: "202",
          token_id: "production-id",
          token_secret: "production-secret",
          netsuite_internal_id: "5",
          invoice_location_id: "6",
        }],
      };
    },
  };
  const context = await resolveQrNetSuiteContext(pool, 7, "PRODUCTION");
  assert.match(sql, /u\.id = l\.store_manager/);
  assert.equal(context.userId, 22);
  assert.equal(context.netSuiteEmployeeId, "202");
  assert.equal(context.environment, "PRODUCTION");
});

test("missing environment-specific credentials fail before NetSuite", async () => {
  const pool = {
    async query() {
      return {
        rows: [{
          user_id: 22,
          firstname: "Store",
          lastname: "Manager",
          netsuiteid: "202",
          token_id: null,
          token_secret: null,
          netsuite_internal_id: "5",
          invoice_location_id: "6",
        }],
      };
    },
  };
  await assert.rejects(
    resolveQrNetSuiteContext(pool, 7, "PRODUCTION"),
    /does not have production NetSuite TBA credentials/
  );
});
