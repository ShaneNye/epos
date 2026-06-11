const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  dir: console.dir.bind(console),
  table: console.table.bind(console),
};

const LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function configuredLevel() {
  const raw = String(process.env.LOG_LEVEL || process.env.SERVER_LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] === undefined ? LEVELS.info : LEVELS[raw];
}

function enabledAt(level) {
  return configuredLevel() >= LEVELS[level];
}

function textFromArgs(args) {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function isImportantIntegrationLog(args) {
  const text = textFromArgs(args);
  return /\b(api payload|payload summary|request body|received payload|sending to restlet|final .*payload|final patch body|custom record payload|creating customer deposit|creating customer via|netsuite .*response|restlet .*response|raw restlet response|netSuite error body|RESTlet returned error)\b/i.test(
    text
  );
}

function logInfo(...args) {
  if (enabledAt("info")) originalConsole.log(...args);
}

function logDebug(...args) {
  if (enabledAt("debug")) originalConsole.log(...args);
}

function logWarn(...args) {
  if (enabledAt("warn")) originalConsole.warn(...args);
}

function logError(...args) {
  if (enabledAt("error")) originalConsole.error(...args);
}

function apiPayload(label, payload) {
  if (String(process.env.LOG_API_PAYLOADS || "true").toLowerCase() !== "false") {
    originalConsole.log(`[api payload] ${label}`, payload);
  }
}

function netSuiteResponse(label, payload) {
  if (String(process.env.LOG_NETSUITE_RESPONSES || "true").toLowerCase() !== "false") {
    originalConsole.log(`[netsuite response] ${label}`, payload);
  }
}

function installConsoleFilter() {
  if (console.__eposLoggingFiltered) return;

  console.log = (...args) => {
    if (isImportantIntegrationLog(args)) return originalConsole.log(...args);
    if (enabledAt("debug")) return originalConsole.log(...args);
  };

  console.info = (...args) => {
    if (enabledAt("debug")) return originalConsole.info(...args);
  };

  console.debug = (...args) => {
    if (enabledAt("debug")) return originalConsole.debug(...args);
  };

  console.dir = (...args) => {
    if (isImportantIntegrationLog(args)) return originalConsole.dir(...args);
    if (enabledAt("debug")) return originalConsole.dir(...args);
  };

  console.table = (...args) => {
    if (enabledAt("debug")) return originalConsole.table(...args);
  };

  console.__eposLoggingFiltered = true;
}

module.exports = {
  apiPayload,
  debug: logDebug,
  error: logError,
  info: logInfo,
  installConsoleFilter,
  netSuiteResponse,
  warn: logWarn,
};
