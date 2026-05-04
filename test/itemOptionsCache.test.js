const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadCacheScript({ fetchImpl, initialStorage = {} } = {}) {
  const storage = { ...initialStorage };
  const context = {
    console,
    fetch: fetchImpl,
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
      },
      setItem(key, value) {
        storage[key] = String(value);
      },
      removeItem(key) {
        delete storage[key];
      },
    },
    window: {},
  };

  vm.createContext(context);
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "js", "itemOptionsCache.js"),
    "utf8"
  );
  vm.runInContext(source, context);
  return { cache: context.window.itemOptionsCache, storage };
}

test("item options getAll fetches the DB-backed option map when cache is empty", async () => {
  const calls = [];
  const { cache } = loadCacheScript({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            byItemId: {
              123: {
                Colour: ["Blue"],
                "Base Option": ["Hidden"],
                "Size.v1": ["Hidden"],
              },
            },
          };
        },
      };
    },
  });

  const result = await cache.getAll();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/item-options");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(JSON.stringify(result), JSON.stringify({ 123: { Colour: ["Blue"] } }));
});

test("item options getAll reuses a fresh local cache without fetching", async () => {
  const cachedAt = Date.now();
  const initialStorage = {
    "itemOptionsCache:v2": JSON.stringify({
      cachedAt,
      complete: true,
      byItemId: {
        456: {
          Finish: ["Oak"],
        },
      },
    }),
  };

  const { cache } = loadCacheScript({
    initialStorage,
    fetchImpl: async () => {
      throw new Error("fetch should not be called for a fresh cache");
    },
  });

  assert.equal(JSON.stringify(await cache.getAll()), JSON.stringify({ 456: { Finish: ["Oak"] } }));
});

test("item options getAll refreshes when local cache is only a partial per-item cache", async () => {
  const cachedAt = Date.now();
  const calls = [];
  const { cache } = loadCacheScript({
    initialStorage: {
      "itemOptionsCache:v2": JSON.stringify({
        cachedAt,
        byItemId: {
          111: {
            Colour: ["Partial"],
          },
        },
      }),
    },
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            byItemId: {
              222: {
                Finish: ["Walnut"],
              },
            },
          };
        },
      };
    },
  });

  const result = await cache.getAll();

  assert.deepEqual(calls, ["/api/item-options"]);
  assert.equal(
    JSON.stringify(result),
    JSON.stringify({
      111: { Colour: ["Partial"] },
      222: { Finish: ["Walnut"] },
    })
  );
});
