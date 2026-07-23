function normalizedEnvironment(value) {
  const environment = String(value || "").trim().toUpperCase();
  return environment === "PROD" ? "PRODUCTION" : environment || "SANDBOX";
}

async function resolveQrNetSuiteContext(pool, locationId, environment = process.env.ENVIRONMENT) {
  const production = normalizedEnvironment(environment) === "PRODUCTION";
  const result = await pool.query(
    production
      ? `SELECT
           l.netsuite_internal_id,
           l.invoice_location_id,
           l.store_manager,
           u.id AS user_id,
           u.firstname,
           u.lastname,
           u.netsuiteid,
           u.prod_netsuite_token_id AS token_id,
           u.prod_netsuite_token_secret AS token_secret
         FROM locations l
         LEFT JOIN users u ON u.id = l.store_manager
         WHERE l.id = $1
         LIMIT 1`
      : `SELECT
           l.netsuite_internal_id,
           l.invoice_location_id,
           l.store_manager,
           u.id AS user_id,
           u.firstname,
           u.lastname,
           u.netsuiteid,
           u.sb_netsuite_token_id AS token_id,
           u.sb_netsuite_token_secret AS token_secret
         FROM locations l
         LEFT JOIN users u
           ON LOWER(TRIM(u.firstname)) = 'shane'
          AND LOWER(TRIM(u.lastname)) = 'nye'
         WHERE l.id = $1
         ORDER BY u.id
         LIMIT 1`,
    [locationId]
  );
  const context = result.rows[0];
  if (!context) throw new Error("The QR journey store could not be found");
  if (!context.netsuite_internal_id || !context.invoice_location_id) {
    throw new Error("This store is not fully configured for NetSuite quote creation");
  }
  if (!context.user_id) {
    throw new Error(
      production
        ? "This store does not have a store manager configured"
        : "The Shane Nye EPOS user could not be found for sandbox NetSuite access"
    );
  }
  if (!context.token_id || !context.token_secret) {
    const userName = [context.firstname, context.lastname].filter(Boolean).join(" ") || `user ${context.user_id}`;
    throw new Error(`${userName} does not have ${production ? "production" : "sandbox"} NetSuite TBA credentials configured`);
  }
  if (!context.netsuiteid) {
    const userName = [context.firstname, context.lastname].filter(Boolean).join(" ") || `user ${context.user_id}`;
    throw new Error(`${userName} does not have a NetSuite employee ID configured`);
  }
  return {
    userId: context.user_id,
    netSuiteEmployeeId: context.netsuiteid,
    userName: [context.firstname, context.lastname].filter(Boolean).join(" "),
    storeNsId: context.netsuite_internal_id,
    invoiceLocationId: context.invoice_location_id,
    environment: production ? "PRODUCTION" : "SANDBOX",
  };
}

module.exports = { normalizedEnvironment, resolveQrNetSuiteContext };
