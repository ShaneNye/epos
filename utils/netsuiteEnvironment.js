function normalizeEnvironmentName(value) {
  const env = String(value || "").trim().toUpperCase();
  if (env === "PROD") return "PRODUCTION";
  if (env === "SB" || env === "SANBOX" || env === "SANDBOX") return "SANDBOX";
  return env || "SANDBOX";
}

function getProductionAccountDash() {
  return String(process.env.NS_ACCOUNT_DASH || process.env.NS_ACCOUNT || "7972741")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/-sb\d*$/i, "");
}

function getNetSuiteAccountDash() {
  const env = normalizeEnvironmentName(process.env.ENVIRONMENT);
  const productionAccount = getProductionAccountDash();
  return env === "PRODUCTION" ? productionAccount : `${productionAccount}-sb1`;
}

function getNetSuiteAppBaseUrl() {
  return `https://${getNetSuiteAccountDash()}.app.netsuite.com`;
}

function getNetSuiteHomeUrl() {
  return `${getNetSuiteAppBaseUrl()}/app/center/card.nl?sc=-29&whence=`;
}

module.exports = {
  getNetSuiteAccountDash,
  getNetSuiteAppBaseUrl,
  getNetSuiteHomeUrl,
  normalizeEnvironmentName,
};
