(function () {
  if (window.__eposBrowserLogFilterInstalled) return;

  var debugEnabled = false;
  try {
    debugEnabled =
      localStorage.getItem("eposDebugLogs") === "1" ||
      new URLSearchParams(window.location.search).get("debugLogs") === "1";
  } catch (err) {
    debugEnabled = false;
  }

  var allowPattern =
    /\b(api payload|payload summary|request body|received payload|sending quote payload|sending order payload|final .*payload|final patch body|netsuite .*response|restlet .*response|raw restlet response|api response)\b/i;

  function textFromArgs(args) {
    return Array.prototype.map
      .call(args, function (arg) {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch (err) {
          return String(arg);
        }
      })
      .join(" ");
  }

  ["log", "info", "debug"].forEach(function (method) {
    var original = console[method] && console[method].bind(console);
    if (!original) return;

    console[method] = function () {
      if (debugEnabled || allowPattern.test(textFromArgs(arguments))) {
        return original.apply(console, arguments);
      }
    };
  });

  window.__eposBrowserLogFilterInstalled = true;
})();
