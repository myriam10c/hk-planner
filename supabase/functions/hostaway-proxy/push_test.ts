import { assertEquals } from "jsr:@std/assert@1";
import * as webpush from "jsr:@negrel/webpush@0.5.0";
import {
  assignmentPushPayload,
  getApplicationServerKey,
  isDuplicatePush,
  isQuietHoursDubai,
  pushPruneReason,
  sendPush,
  taskPushPayload,
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
function fakeSb(rows: any[]) {
  const state = { rows, updates: [] as any[], upserts: [] as any[], dedupe: null as any };
  const api: any = {
    state,
    from(table: string) {
      if (table === "push_dedupe") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.dedupe, error: null }) }),
          }),
          upsert: async (row: any) => { state.upserts.push(row); return { error: null }; },
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
  sb.state.dedupe = { sent_at: new Date().toISOString() };
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
