const publicExactPaths = new Set([
  "/",
  "/index.html",
  "/forgot",
  "/reset",
  "/api/login",
  "/api/forgot-password",
  "/api/reset-password",
  "/health",
]);

const publicPrefixes = [
  "/api/login/",
  "/api/forgot-password/",
  "/api/reset-password/",
  "/assistant",
];

const alwaysAllowedPrefixes = [
  "/sales/view",
  "/sales/reciept",
  "/quote/view",
  "/quote/reciept",
  "/api/dispatchtrack/open-jobs",
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
