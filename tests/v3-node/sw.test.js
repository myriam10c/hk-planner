// Service worker v3 (revue finale G1) : le gestionnaire fetch de /v3/sw.js est
// execute dans un bac a sable avec de faux caches et un faux reseau. Le cas
// critique : apres un deploiement (nouvelle VERSION), une page dont l'ancien
// cache garde les anciens modules doit recevoir les nouveaux des le premier
// chargement, sinon le nouvel app.js importe des exports absents des anciens
// modules et l'app reste blanche.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../../v3/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://hk.example";

// Faux CacheStorage partage entre les versions, comme dans un navigateur.
function fakeCaches() {
  const store = new Map();
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      match: async (req) => m.get(urlOf(req)),
      put: async (req, res) => { m.set(urlOf(req), res); },
      add: async (chemin) => {
        const res = await sandboxFetch.current(new Request(ORIGIN + chemin));
        if (!res.ok) throw new Error("add " + chemin);
        m.set(ORIGIN + chemin, res);
      },
    };
  };
  return {
    store,
    api: {
      open,
      keys: async () => [...store.keys()],
      delete: async (name) => store.delete(name),
    },
  };
}
const urlOf = (req) => (typeof req === "string" ? new URL(req, ORIGIN).href : req.url);
const sandboxFetch = { current: null };

// Le reseau sert le contenu de la version deployee ; `offline` le coupe.
function network(version) {
  const net = { version, offline: false, calls: [] };
  net.fetch = async (req) => {
    net.calls.push(req.url);
    if (net.offline) throw new TypeError("Failed to fetch");
    return new Response(net.version + ":" + new URL(req.url).pathname, { status: 200 });
  };
  return net;
}

// Charge /v3/sw.js avec sa VERSION remplacee, rend ses gestionnaires.
function loadSw(version, caches, net) {
  const handlers = {};
  const src = SOURCE.replace(/^const VERSION = '[^']*';/m, "const VERSION = '" + version + "';");
  assert.ok(src.includes("const VERSION = '" + version + "';"), "VERSION doit etre remplacable");
  sandboxFetch.current = net.fetch;
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(src, {
    self, caches: caches.api, fetch: (r) => net.fetch(r), location: { origin: ORIGIN },
    URL, Request, Response, console: { warn: () => {}, log: () => {} }, Promise,
  });
  return handlers;
}

async function lifecycle(h, type) {
  let p = Promise.resolve();
  h[type]({ waitUntil: (x) => { p = x; } });
  await p;
}

// Rend la reponse du gestionnaire fetch, ou null s'il laisse passer la requete.
async function get(h, path, mode = "no-cors") {
  const request = { method: "GET", url: new URL(path, ORIGIN).href, mode };
  let reponse = null;
  h.fetch({ request, respondWith: (p) => { reponse = p; } });
  if (!reponse) return null;
  const res = await reponse;
  return res ? await res.clone().text() : res;
}

test("apres un changement de VERSION, l'ancien cache ne sert plus les anciens modules", async () => {
  const caches = fakeCaches();
  const net = network("old");
  const ancien = loadSw("A", caches, net);
  await lifecycle(ancien, "install");
  await lifecycle(ancien, "activate");
  assert.equal(await get(ancien, "/v3/conv/conversation.js"), "old:/v3/conv/conversation.js");

  // Deploiement : le serveur sert la nouvelle version, mais c'est encore le
  // service worker en place (VERSION A, cache plein d'anciens modules) qui
  // repond au premier chargement.
  net.version = "new";
  for (const chemin of ["/v3/app.js", "/v3/conv/conversation.js", "/v3/conv/ui.js", "/v3/conv/sync.js",
    "/v3/screens/profile.js", "/v3/conv.css", "/v3/styles/cleaner.css", "/v3/index.html",
    "/vendor/supabase-js-2.116.0.umd.js"]) {
    assert.equal(await get(ancien, chemin), "new:" + chemin, chemin + " doit venir du reseau");
  }
  assert.equal(await get(ancien, "/v3/", "navigate"), "new:/v3/");

  // Puis la nouvelle VERSION s'installe et efface l'ancien cache.
  const nouveau = loadSw("B", caches, net);
  await lifecycle(nouveau, "install");
  await lifecycle(nouveau, "activate");
  assert.deepEqual([...caches.store.keys()], ["hk-v3-B"]);
  assert.equal(await get(nouveau, "/v3/conv/conversation.js"), "new:/v3/conv/conversation.js");
});

test("hors ligne, modules et styles reviennent du cache", async () => {
  const caches = fakeCaches();
  const net = network("v1");
  const h = loadSw("A", caches, net);
  await lifecycle(h, "install");
  net.offline = true;
  assert.equal(await get(h, "/v3/conv/conversation.js"), "v1:/v3/conv/conversation.js");
  assert.equal(await get(h, "/v3/conv.css"), "v1:/v3/conv.css");
  assert.equal(await get(h, "/v3/", "navigate"), "v1:/v3/");
  assert.equal(await get(h, "/vendor/supabase-js-2.116.0.umd.js"), "v1:/vendor/supabase-js-2.116.0.umd.js");
});

test("un module servi par le reseau remplace la copie du cache", async () => {
  const caches = fakeCaches();
  const net = network("v1");
  const h = loadSw("A", caches, net);
  await lifecycle(h, "install");
  net.version = "v2";
  await get(h, "/v3/conv/ui.js");
  net.offline = true;
  assert.equal(await get(h, "/v3/conv/ui.js"), "v2:/v3/conv/ui.js");
});

test("le proxy, Hostaway et les autres origines ne passent jamais par le service worker", async () => {
  const caches = fakeCaches();
  const h = loadSw("A", caches, network("v1"));
  assert.equal(await get(h, "https://abc.supabase.co/functions/v1/hostaway-proxy?action=v3.myDay"), null);
  assert.equal(await get(h, "https://api.hostaway.com/v1/listings"), null);
  assert.equal(await get(h, "https://cdn.example/lib.js"), null);
  assert.equal(await get(h, "/app.js"), null);
});
