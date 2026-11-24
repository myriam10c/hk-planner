import { assert, assertEquals } from "jsr:@std/assert@1";
import * as webpush from "jsr:@negrel/webpush@0.5.0";
import {
  ASSIGN_PUSH_DELAY_MS,
  assignmentPushPayload,
  getApplicationServerKey,
  installShutdownWake,
  isDuplicatePush,
  isQuietHoursDubai,
  pushPruneReason,
  sendAssignmentPushesAfterUndoWindow,
  sendPush,
  stillAssignedTargets,
  taskPushPayload,
  waitUnlessShutdown,
  wakeAssignWaitsOnShutdown,
} from "./push.ts";

const b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Instant de reference en pleine journee Dubai (10:00), passe a sendPush par tous
// les tests qui ne testent pas les heures de silence. Sans ca, la suite echouerait
// si on la lance apres 22h Dubai : la garde du ruling Q3 sauterait les envois.
const DAY = Date.parse("2026-09-10T06:00:00Z");
const NIGHT = Date.parse("2026-09-10T19:00:00Z"); // 23:00 Dubai

async function setVapidEnv() {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const exported = await webpush.exportVapidKeys(kp);
  Deno.env.set("VAPID_PUBLIC_KEY", JSON.stringify(exported.publicKey));
  Deno.env.set("VAPID_PRIVATE_KEY", JSON.stringify(exported.privateKey));
  Deno.env.set("VAPID_SUBJECT", "mailto:admin@medini-homes.com");
}

function clearVapidEnv() {
  Deno.env.delete("VAPID_PUBLIC_KEY");
  Deno.env.delete("VAPID_PRIVATE_KEY");
  Deno.env.delete("VAPID_SUBJECT");
}

async function fakeSubscriptionKeys() {
  const ua = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"],
  );
  return {
    p256dh: b64u(await crypto.subtle.exportKey("raw", ua.publicKey)),
    auth: b64u(crypto.getRandomValues(new Uint8Array(16)).buffer),
  };
}

// Faux client supabase-js : ne gere que le sous-ensemble utilise par sendPush.
// `state.dedupe` = la ligne push_dedupe deja presente (null = aucune).
// `state.cleaner` = la ligne cleaners rendue par la verification is_active.
// `state.failUpdates` = fait lever chaque ecriture de bookkeeping.
// `state.events` = journal ordonne (dedupe-insert, dedupe-claim, send) pour verifier
// que la cle de dedupe est posee AVANT le premier envoi.
function fakeSb(rows: any[]) {
  const state = {
    rows,
    updates: [] as any[],
    inserts: [] as any[],
    dedupeUpdates: [] as any[],
    events: [] as string[],
    dedupe: null as any,
    cleaner: { is_active: true } as any,
    failUpdates: false,
  };
  const api: any = {
    state,
    from(table: string) {
      if (table === "cleaners") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.cleaner, error: null }) }),
          }),
        };
      }
      if (table === "push_dedupe") {
        return {
          insert: async (row: any) => {
            state.events.push("dedupe-insert");
            if (state.dedupe) {
              return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            }
            state.dedupe = { ...row };
            state.inserts.push(row);
            return { error: null };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                state.events.push("dedupe-read");
                return { data: state.dedupe, error: null };
              },
            }),
          }),
          update: (patch: any) => ({
            eq: () => ({
              lt: (_col: string, cutoff: string) => ({
                select: async () => {
                  state.events.push("dedupe-claim");
                  const prev = state.dedupe?.sent_at ?? null;
                  const claimed = !!prev && prev < cutoff;
                  if (claimed) {
                    state.dedupe = { ...state.dedupe, ...patch };
                    state.dedupeUpdates.push(patch);
                  }
                  return { data: claimed ? [{ dedupe_key: "claimed" }] : [], error: null };
                },
              }),
            }),
          }),
        };
      }
      // push_subscriptions
      return {
        select: () => ({
          eq: () => ({
            is: async () => ({ data: state.rows, error: null }),
          }),
        }),
        update: (patch: any) => ({
          eq: async (_col: string, val: any) => {
            if (state.failUpdates) throw new Error("bookkeeping write failed");
            state.updates.push({ id: val, patch });
            return { error: null };
          },
        }),
      };
    },
  };
  return api;
}

Deno.test("taskPushPayload construit titre, corps, url et tag", () => {
  const p = taskPushPayload(
    { id: 42, title: "Fix AC in 1509", priority: "urgent", listing_id: "123" },
    { name: "Hillal" },
  );
  assertEquals(p.title, "Urgent task: Fix AC in 1509");
  assertEquals(p.body, "From Hillal");
  assertEquals(p.url, "https://stunning-kleicha-f61101.netlify.app/?task=42");
  assertEquals(p.tag, "team-task-42");
});

Deno.test("taskPushPayload sans priorite urgente ni auteur", () => {
  const p = taskPushPayload({ id: 7, title: "Restock towels" }, null);
  assertEquals(p.title, "New task: Restock towels");
  assertEquals(p.body, "Open HK Planner to see the details");
  assertEquals(p.tag, "team-task-7");
});

Deno.test("assignmentPushPayload construit la notification d'affectation menage", () => {
  const p = assignmentPushPayload("2026-09-12_Smith", "CHC");
  assertEquals(p.title, "New cleaning assigned");
  assertEquals(p.body, "2026-09-12 · CHC. Open HK Planner to see the property.");
  assertEquals(p.url, "https://stunning-kleicha-f61101.netlify.app/");
  assertEquals(p.tag, "cleaning-2026-09-12_Smith");
});

Deno.test("assignmentPushPayload gere une cle extra_ sans date exploitable", () => {
  const p = assignmentPushPayload("extra_2026-09-12_deep", "DEEP_CLEAN");
  assertEquals(p.title, "New cleaning assigned");
  assertEquals(p.body, "2026-09-12 · DEEP_CLEAN. Open HK Planner to see the property.");
  assertEquals(p.tag, "cleaning-extra_2026-09-12_deep");
});

Deno.test("isQuietHoursDubai couvre 22h00 a 08h30 Dubai", () => {
  // Dubai = UTC+4 fixe, aucun changement d'heure.
  const at = (utc: string) => Date.parse(utc);
  assertEquals(isQuietHoursDubai(at("2026-09-10T18:00:00Z")), true);  // 22:00 Dubai
  assertEquals(isQuietHoursDubai(at("2026-09-10T20:30:00Z")), true);  // 00:30 Dubai
  assertEquals(isQuietHoursDubai(at("2026-09-10T04:29:00Z")), true);  // 08:29 Dubai
  assertEquals(isQuietHoursDubai(at("2026-09-10T04:30:00Z")), false); // 08:30 Dubai
  assertEquals(isQuietHoursDubai(at("2026-09-10T06:00:00Z")), false); // 10:00 Dubai
  assertEquals(isQuietHoursDubai(at("2026-09-10T17:59:00Z")), false); // 21:59 Dubai
});

Deno.test("isDuplicatePush respecte la fenetre", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  assertEquals(isDuplicatePush(null, now), false);
  assertEquals(isDuplicatePush("2026-09-10T11:59:30Z", now), true);
  assertEquals(isDuplicatePush("2026-09-10T11:58:00Z", now), false);
  assertEquals(isDuplicatePush("2026-09-10T11:58:00Z", now, 300_000), true);
});

Deno.test("pushPruneReason ne purge que 404 et 410", () => {
  assertEquals(pushPruneReason(404), "gone");
  assertEquals(pushPruneReason(410), "gone");
  assertEquals(pushPruneReason(429), null);
  assertEquals(pushPruneReason(500), null);
  assertEquals(pushPruneReason(201), null);
});

Deno.test("getApplicationServerKey rend null sans secrets VAPID", async () => {
  clearVapidEnv();
  assertEquals(await getApplicationServerKey(), null);
});

Deno.test("sendPush n'envoie rien et ne leve pas sans secrets VAPID", async () => {
  clearVapidEnv();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...(await fakeSubscriptionKeys()) }]);
  const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" }, { nowMs: DAY });
  assertEquals(r, { sent: 0, pruned: 0, skipped: "vapid_not_configured" });
});

Deno.test("sendPush chiffre en aes128gcm et compte les envois", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([
    { id: 1, endpoint: "https://push.example/a", ...keys },
    { id: 2, endpoint: "https://push.example/b", ...keys },
  ]);
  const calls: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init: any) => {
    calls.push({ url: String(input), headers: init.headers });
    return new Response(null, { status: 201 });
  };
  try {
    const r = await sendPush(sb, 6, {
      title: "T", body: "B", url: "https://x/", tag: "team-task-1",
    }, { nowMs: DAY });
    assertEquals(r.sent, 2);
    assertEquals(r.pruned, 0);
    assertEquals(calls.length, 2);
    assertEquals(calls[0].headers["Content-Encoding"], "aes128gcm");
    assertEquals(String(calls[0].headers.Authorization).startsWith("vapid t="), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush desactive les endpoints 410 et garde les autres", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([
    { id: 1, endpoint: "https://push.example/gone", ...keys },
    { id: 2, endpoint: "https://push.example/ok", ...keys },
  ]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) =>
    String(input).endsWith("/gone")
      ? new Response(null, { status: 410, statusText: "Gone" })
      : new Response(null, { status: 201 });
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" }, { nowMs: DAY });
    assertEquals(r.sent, 1);
    assertEquals(r.pruned, 1);
    const disabled = sb.state.updates.filter((u: any) => u.patch.disabled_at !== undefined);
    assertEquals(disabled.length, 1);
    assertEquals(disabled[0].id, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush saute un doublon dans la fenetre", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  sb.state.dedupe = { sent_at: new Date(DAY - 10_000).toISOString() };
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return new Response(null, { status: 201 }); };
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" },
      { dedupeKey: "team-task:1:6", nowMs: DAY });
    assertEquals(r, { sent: 0, pruned: 0, skipped: "duplicate" });
    assertEquals(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush ne leve pas si la base explose", async () => {
  await setVapidEnv(); // rend le test independant de l'ordre d'execution
  const brokenSb = {
    from() { throw new Error("db down"); },
  };
  const r = await sendPush(brokenSb, 6, { title: "T", body: "B", url: "/", tag: "t" }, { nowMs: DAY });
  assertEquals(r, { sent: 0, pruned: 0, skipped: "error" });
});

Deno.test("sendPush saute une priorite normale pendant les heures de silence", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return new Response(null, { status: 201 }); };
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" },
      { priority: "normal", nowMs: NIGHT });
    assertEquals(r, { sent: 0, pruned: 0, skipped: "quiet_hours" });
    assertEquals(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush laisse passer une priorite urgente pendant les heures de silence", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 201 });
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" },
      { priority: "urgent", nowMs: NIGHT });
    assertEquals(r.sent, 1);
    assertEquals(r.skipped, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush envoie une priorite normale en journee", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 201 });
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" },
      { priority: "normal", nowMs: DAY });
    assertEquals(r.sent, 1);
    assertEquals(r.skipped, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush pose la cle de dedupe avant le premier envoi", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { sb.state.events.push("send"); return new Response(null, { status: 201 }); };
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" },
      { dedupeKey: "team-task:9:6", nowMs: DAY });
    assertEquals(r.sent, 1);
    assertEquals(sb.state.events, ["dedupe-insert", "send"]);
    assertEquals(sb.state.inserts.length, 1);
    assertEquals(sb.state.inserts[0].dedupe_key, "team-task:9:6");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush reprend une cle de dedupe hors fenetre", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  // Envoi precedent il y a 10 minutes : hors fenetre, la cle est reprise.
  sb.state.dedupe = { sent_at: new Date(DAY - 600_000).toISOString() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { sb.state.events.push("send"); return new Response(null, { status: 201 }); };
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" },
      { dedupeKey: "team-task:9:6", nowMs: DAY });
    assertEquals(r.sent, 1);
    assertEquals(r.skipped, null);
    assertEquals(sb.state.events, ["dedupe-insert", "dedupe-read", "dedupe-claim", "send"]);
    assertEquals(sb.state.dedupeUpdates.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush garde ses compteurs quand une ecriture de bookkeeping leve", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([
    { id: 1, endpoint: "https://push.example/ok", ...keys },
    { id: 2, endpoint: "https://push.example/gone", ...keys },
  ]);
  sb.state.failUpdates = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: any) =>
    String(input).endsWith("/gone")
      ? new Response(null, { status: 410, statusText: "Gone" })
      : new Response(null, { status: 201 });
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" }, { nowMs: DAY });
    assertEquals(r, { sent: 1, pruned: 1, skipped: null });
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush ignore un cleaner desactive", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  sb.state.cleaner = { is_active: false };
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return new Response(null, { status: 201 }); };
  try {
    const r = await sendPush(sb, 6, { title: "T", body: "B", url: "/", tag: "t" }, { nowMs: DAY });
    assertEquals(r, { sent: 0, pruned: 0, skipped: "cleaner_inactive" });
    assertEquals(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("sendPush quietHandled ignore la fenetre fixe et transporte les champs urgents", async () => {
  await setVapidEnv();
  const keys = await fakeSubscriptionKeys();
  const sb = fakeSb([{ id: 1, endpoint: "https://push.example/a", ...keys }]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 201 });
  try {
    const r = await sendPush(sb, 6, {
      title: "T", body: "B", url: "/", tag: "t", urgent: true, icon: "/icons/alert-192.png",
      ack: { url: "https://x/ack", id: 1, token: "tok", secret: "s" },
    }, { priority: "normal", nowMs: NIGHT, quietHandled: true });
    assertEquals(r.sent, 1);
    assertEquals(r.skipped, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Notification d'affectation retardee (24/11) : assignCleaner attend la fin de la
// fenetre d'Undo du manager, relit cleaning_assignments, puis ne notifie que les
// cibles encore affectees.
Deno.test("ASSIGN_PUSH_DELAY_MS vaut 8 s (toast Undo de 6 s + marge)", () => {
  assertEquals(ASSIGN_PUSH_DELAY_MS, 8000);
});

Deno.test("stillAssignedTargets garde les cibles encore affectees, dans l'ordre, sans doublon", () => {
  assertEquals(stillAssignedTargets([5, 7], [{ cleaner_id: 7 }]), [7]);
  assertEquals(stillAssignedTargets([5], []), []);
  assertEquals(stillAssignedTargets([5, 5], [{ cleaner_id: "5" }]), [5]);
  assertEquals(stillAssignedTargets([7, 5], [{ cleaner_id: 5 }, { cleaner_id: 7 }]), [7, 5]);
});

Deno.test("stillAssignedTargets rend toutes les cibles si la relecture a echoue", () => {
  assertEquals(stillAssignedTargets([5, 7], null), [5, 7]);
});

// Faux branchements de la tache de fond : `events` journalise l'ordre attente,
// relecture, envois. `readResult` est la reponse de la relecture (forme supabase-js),
// ou une fonction qui leve.
function fakeAssignDeps(readResult: any) {
  const events: string[] = [];
  return {
    events,
    deps: {
      wait: async (ms: number) => { events.push("wait:" + String(ms)); },
      read: async () => {
        events.push("read");
        if (typeof readResult === "function") return readResult();
        return readResult;
      },
      send: async (cid: number) => { events.push("send:" + String(cid)); },
    },
  };
}

function captureConsole(method: "warn" | "log"): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const real = console[method];
  console[method] = (...args: any[]) => { lines.push(args.map(String).join(" ")); };
  return { lines, restore: () => { console[method] = real; } };
}

Deno.test("affectation retardee : aucune cible, ni attente ni relecture ni envoi", async () => {
  const f = fakeAssignDeps({ data: [], error: null });
  const r = await sendAssignmentPushesAfterUndoWindow([], f.deps);
  assertEquals(r, []);
  assertEquals(f.events, []);
});

Deno.test("affectation retardee : annulee pendant le delai (relecture vide), aucun envoi", async () => {
  const f = fakeAssignDeps({ data: [], error: null });
  const log = captureConsole("log");
  try {
    const r = await sendAssignmentPushesAfterUndoWindow([5], f.deps);
    assertEquals(r, []);
    assertEquals(f.events, ["wait:8000", "read"]);
  } finally {
    log.restore();
  }
});

Deno.test("affectation retardee : toujours affectee, un envoi apres l'attente et la relecture", async () => {
  const f = fakeAssignDeps({ data: [{ cleaner_id: 5 }], error: null });
  const r = await sendAssignmentPushesAfterUndoWindow([5], f.deps);
  assertEquals(r, [5]);
  assertEquals(f.events, ["wait:8000", "read", "send:5"]);
});

Deno.test("affectation retardee : remplacement annule en partie, seule la cible restante est notifiee", async () => {
  const f = fakeAssignDeps({ data: [{ cleaner_id: "7" }, { cleaner_id: 9 }], error: null });
  const log = captureConsole("log");
  try {
    const r = await sendAssignmentPushesAfterUndoWindow([5, 7], f.deps);
    assertEquals(r, [7]);
    assertEquals(f.events, ["wait:8000", "read", "send:7"]);
  } finally {
    log.restore();
  }
});

Deno.test("affectation retardee : relecture en erreur, la notification part et l'echec est journalise", async () => {
  const f = fakeAssignDeps({ data: null, error: { message: "db down" } });
  const warn = captureConsole("warn");
  try {
    const r = await sendAssignmentPushesAfterUndoWindow([5, 7], f.deps);
    assertEquals(r, [5, 7]);
    assertEquals(f.events, ["wait:8000", "read", "send:5", "send:7"]);
    assertEquals(warn.lines.length, 1);
    assert(warn.lines[0].includes("re-read failed"), warn.lines[0]);
  } finally {
    warn.restore();
  }
});

Deno.test("affectation retardee : relecture qui leve, la notification part et l'echec est journalise", async () => {
  const f = fakeAssignDeps(() => { throw new Error("network"); });
  const warn = captureConsole("warn");
  try {
    const r = await sendAssignmentPushesAfterUndoWindow([5], f.deps);
    assertEquals(r, [5]);
    assertEquals(f.events, ["wait:8000", "read", "send:5"]);
    assertEquals(warn.lines.length, 1);
    assert(warn.lines[0].includes("re-read failed"), warn.lines[0]);
  } finally {
    warn.restore();
  }
});

Deno.test("affectation retardee : un envoi qui leve n'empeche pas les suivants", async () => {
  const f = fakeAssignDeps({ data: [{ cleaner_id: 5 }, { cleaner_id: 7 }], error: null });
  const send = f.deps.send;
  f.deps.send = async (cid: number) => {
    await send(cid);
    if (cid === 5) throw new Error("push service down");
  };
  const warn = captureConsole("warn");
  try {
    const r = await sendAssignmentPushesAfterUndoWindow([5, 7], f.deps);
    assertEquals(r, [5, 7]);
    assertEquals(f.events, ["wait:8000", "read", "send:5", "send:7"]);
    assertEquals(warn.lines.length, 1);
    assert(warn.lines[0].includes("push failed for cleaner 5"), warn.lines[0]);
  } finally {
    warn.restore();
  }
});

// index.ts n'est pas importable en test (Deno.serve au chargement) : le branchement
// de la tache de fond d'assignCleaner est verifie sur la source.
Deno.test("assignCleaner (source) : push retarde dans keepAlive, relecture par cle, envoi inchange", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const debut = src.indexOf('if (action === "assignCleaner"');
  assert(debut >= 0, "handler assignCleaner absent");
  const b = src.slice(debut, src.indexOf("if (action ===", debut + 10));
  // Hors du chemin de reponse : la reponse n'attend pas le delai.
  const appel = b.indexOf("keepAlive(sendAssignmentPushesAfterUndoWindow(pushTargets, {");
  assert(appel >= 0, "tache de fond retardee absente de keepAlive");
  const reponse = b.indexOf('return jsonResp({ status: "success" });', appel);
  assert(reponse > appel, "la reponse suit le lancement de la tache de fond");
  const bloc = b.slice(appel, reponse);
  // Relecture de cleaning_assignments pour la meme cle de reservation.
  const lecture = bloc.indexOf('sb.from("cleaning_assignments")');
  assert(lecture >= 0, "relecture absente");
  assert(bloc.indexOf('.select("cleaner_id").eq("reservation_key", reservation_key)', lecture) > lecture,
    "relecture par reservation_key");
  // Envoi inchange : meme contenu, meme cle de dedupe, aucune priorite (heures de silence).
  assert(bloc.includes("sendPush(sb, cid, assignmentPushPayload(String(reservation_key), stype), {"), "envoi absent");
  assert(bloc.includes('dedupeKey: "cleaning-assignment:" + String(reservation_key) + ":" + String(cid),'),
    "cle de dedupe changee");
  assert(!bloc.includes("priority"), "aucune priorite sur une affectation");
  // Aucun envoi direct ailleurs dans le handler.
  assertEquals(b.split("sendPush(").length - 1, 1, "un seul appel a sendPush, dans la tache retardee");
});

// Arret de l'instance pendant l'attente (revue, Mineur 2) : le runtime Supabase emet
// `beforeunload` (ev.detail.reason) ; les attentes en cours sont reveillees tout de
// suite et la tache enchaine relecture puis envoi.

// Horloge injectee : rien ne part tant que le test ne declenche pas le minuteur.
function fakeTimers() {
  const scheduled: Array<{ id: number; ms: number; fn: () => void; cleared: boolean }> = [];
  return {
    scheduled,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const t = { id: scheduled.length + 1, ms, fn, cleared: false };
        scheduled.push(t);
        return t.id;
      },
      clearTimeout: (id: unknown) => {
        const t = scheduled.find((x) => x.id === id);
        if (t) t.cleared = true;
      },
    },
    fire(i: number) {
      if (!scheduled[i].cleared) scheduled[i].fn();
    },
  };
}

// Laisse tourner les microtaches en attente (aucun minuteur reel).
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

Deno.test("attente d'Undo : sans arret, elle dure son delai", async () => {
  const ft = fakeTimers();
  let done = false;
  const p = waitUnlessShutdown(ASSIGN_PUSH_DELAY_MS, ft.timers).then(() => { done = true; });
  await flush();
  assertEquals(ft.scheduled.map((t) => t.ms), [8000]);
  assertEquals(done, false);
  ft.fire(0);
  await p;
  assertEquals(done, true);
  // Finie, elle n'est plus en cours : un arret ensuite ne reveille rien.
  const warn = captureConsole("warn");
  try {
    assertEquals(wakeAssignWaitsOnShutdown("WallClockTime"), 0);
    assertEquals(warn.lines, []);
  } finally {
    warn.restore();
  }
});

Deno.test("attente d'Undo : l'arret la reveille avant son delai, relecture et envoi aussitot", async () => {
  const ft = fakeTimers();
  const f = fakeAssignDeps({ data: [{ cleaner_id: 5 }], error: null });
  const warn = captureConsole("warn");
  try {
    const run = sendAssignmentPushesAfterUndoWindow([5], {
      read: f.deps.read,
      send: f.deps.send,
      wait: (ms) => waitUnlessShutdown(ms, ft.timers),
    });
    await flush();
    assertEquals(ft.scheduled.map((t) => t.ms), [8000]);
    assertEquals(f.events, []);
    assertEquals(wakeAssignWaitsOnShutdown("WallClockTime"), 1);
    assertEquals(await run, [5]);
    assertEquals(f.events, ["read", "send:5"]);
    assertEquals(ft.scheduled[0].cleared, true);
    assertEquals(warn.lines, ["[assignCleaner] push sent early: shutdown WallClockTime"]);
  } finally {
    warn.restore();
  }
});

Deno.test("attente d'Undo : l'arret reveille toutes les attentes en cours", async () => {
  const ft = fakeTimers();
  const sent: number[] = [];
  const run = (cid: number) =>
    sendAssignmentPushesAfterUndoWindow([cid], {
      read: async () => ({ data: [{ cleaner_id: cid }], error: null }),
      send: async (id) => { sent.push(id); },
      wait: (ms) => waitUnlessShutdown(ms, ft.timers),
    });
  const warn = captureConsole("warn");
  try {
    const runs = [run(5), run(7), run(9)];
    await flush();
    assertEquals(ft.scheduled.length, 3);
    assertEquals(sent, []);
    assertEquals(wakeAssignWaitsOnShutdown("EarlyDrop"), 3);
    assertEquals(await Promise.all(runs), [[5], [7], [9]]);
    assertEquals(sent.sort(), [5, 7, 9]);
    assertEquals(ft.scheduled.every((t) => t.cleared), true);
    assertEquals(warn.lines.length, 3);
    assert(warn.lines.every((l) => l === "[assignCleaner] push sent early: shutdown EarlyDrop"), warn.lines.join("|"));
  } finally {
    warn.restore();
  }
});

Deno.test("attente d'Undo : un arret sans attente en cours ne fait rien", () => {
  const warn = captureConsole("warn");
  try {
    assertEquals(wakeAssignWaitsOnShutdown("WallClockTime"), 0);
    assertEquals(warn.lines, []);
  } finally {
    warn.restore();
  }
});

Deno.test("installShutdownWake : un seul ecouteur beforeunload, rien sans addEventListener", async () => {
  assertEquals(installShutdownWake({}), false);
  assertEquals(installShutdownWake(null), false);
  const listeners: Array<{ type: string; fn: (ev: any) => void }> = [];
  const target = { addEventListener: (type: string, fn: (ev: any) => void) => { listeners.push({ type, fn }); } };
  assertEquals(installShutdownWake(target), true);
  assertEquals(listeners.map((l) => l.type), ["beforeunload"]);
  const warn = captureConsole("warn");
  try {
    // A vide (evenement sans detail) : rien.
    listeners[0].fn({});
    assertEquals(warn.lines, []);
    // Une attente en cours : reveillee, avec la raison donnee par le runtime.
    const ft = fakeTimers();
    const p = waitUnlessShutdown(ASSIGN_PUSH_DELAY_MS, ft.timers);
    listeners[0].fn({ detail: { reason: "WallClockTime" } });
    await p;
    assertEquals(ft.scheduled[0].cleared, true);
    assertEquals(warn.lines, ["[assignCleaner] push sent early: shutdown WallClockTime"]);
  } finally {
    warn.restore();
  }
});

Deno.test("push.ts pose l'ecouteur beforeunload au chargement : l'arret reveille une vraie attente", async () => {
  // Minuteur reel de 60 s : si le reveil ne l'annulait pas, le test resterait bloque
  // et le controle des operations de Deno signalerait un minuteur laisse en vol.
  const p = waitUnlessShutdown(60_000);
  const warn = captureConsole("warn");
  try {
    globalThis.dispatchEvent(new CustomEvent("beforeunload", { detail: { reason: "WallClockTime" } }));
    await p;
    assertEquals(warn.lines, ["[assignCleaner] push sent early: shutdown WallClockTime"]);
  } finally {
    warn.restore();
  }
});

Deno.test("affectation retardee : par defaut (prod), l'attente est celle que l'arret interrompt", async () => {
  const f = fakeAssignDeps({ data: [{ cleaner_id: 5 }], error: null });
  const warn = captureConsole("warn");
  try {
    const run = sendAssignmentPushesAfterUndoWindow([5], { read: f.deps.read, send: f.deps.send });
    await flush();
    assertEquals(f.events, []);
    assertEquals(wakeAssignWaitsOnShutdown("WallClockTime"), 1);
    assertEquals(await run, [5]);
    assertEquals(f.events, ["read", "send:5"]);
  } finally {
    warn.restore();
  }
});
