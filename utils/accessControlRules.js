const publicExactPaths = new Set([
  "/",
  "/index.html",
  "/forgot",
  "/reset",
  "/api/login",
  "/api/forgot-password",
  "/api/reset-password",
  "/api/google/callback",
  "/health",
]);

const publicPrefixes = [
  "/api/login/",
  "/api/forgot-password/",
  "/api/reset-password/",
  "/assistant",
  "/api/qr-journeys/public/",
  "/api/fetchify/postcode/",
];

const alwaysAllowedPrefixes = [
  "/sales/view",
  "/sales/reciept",
  "/quote/view",
  "/quote/reciept",
  "/api/dispatchtrack/open-jobs",
  "/api/suitepim/image-proxy",
];

function isPageShellPath(path = "") {
  return !path.startsWith("/api/");
}

function isStaticAssetPath(path = "") {
  return /\.(css|js|png|jpg|jpeg|svg|ico|gif|woff|woff2|ttf|otf)$/i.test(path);
}

function isPublicPath(path = "") {
  return (
    publicExactPaths.has(path) ||
    publicPrefixes.some((prefix) => path.startsWith(prefix)) ||
    isStaticAssetPath(path)
  );
}

function isAlwaysAllowedPath(path = "") {
  return alwaysAllowedPrefixes.some((prefix) => path.startsWith(prefix));
}

module.exports = {
  alwaysAllowedPrefixes,
  isAlwaysAllowedPath,
  isPageShellPath,
  isPublicPath,
  isStaticAssetPath,
  publicExactPaths,
  publicPrefixes,
};
