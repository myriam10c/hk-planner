import { test } from "node:test";
import assert from "node:assert/strict";
import { shareReport } from "../../v3/conv/share.js";

const files = [{ name: "a.jpg" }];
const navWith = over => ({ clipboard: { writeText: async t => { navWith.copied = t; } }, ...over });

test("partage texte + fichiers quand c'est possible, texte copié aussi", async () => {
  let got;
  const nav = navWith({ canShare: d => !!d.files, share: async d => { got = d; } });
  const r = await shareReport({ text: "hello", files, nav });
  assert.deepEqual(r, { ok: true, mode: "files", count: 1 });
  assert.deepEqual(got, { text: "hello", files });
  assert.equal(navWith.copied, "hello");
});

test("annulation par la cleaner : pas envoyé", async () => {
  const nav = navWith({ canShare: () => true, share: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; } });
  assert.deepEqual(await shareReport({ text: "t", files, nav }), { ok: false, mode: "files", aborted: true });
});

test("navigateur sans partage de fichiers : texte seul", async () => {
  let got;
  const nav = navWith({ canShare: () => false, share: async d => { got = d; } });
  assert.deepEqual(await shareReport({ text: "t", files, nav }), { ok: true, mode: "text" });
  assert.deepEqual(got, { text: "t" });
});

test("aucun partage : none, sans exception", async () => {
  assert.deepEqual(await shareReport({ text: "t", files, nav: navWith({}) }), { ok: false, mode: "none" });
});

test("erreur de partage autre qu'une annulation", async () => {
  const nav = navWith({ canShare: () => true, share: async () => { throw new Error("boom"); } });
  assert.deepEqual(await shareReport({ text: "t", files, nav }), { ok: false, mode: "files", error: "boom" });
});

test("fichiers filtrés un par un : un vocal refusé ne fait pas tomber les photos", async () => {
  let got;
  const list = [{ name: "a.jpg", type: "image/jpeg" }, { name: "v.webm", type: "audio/webm" }, { name: "b.jpg", type: "image/jpeg" }];
  const nav = navWith({ canShare: d => d.files.every(f => f.type === "image/jpeg"), share: async d => { got = d; } });
  const r = await shareReport({ text: "t", files: list, nav });
  assert.deepEqual(r, { ok: true, mode: "files", count: 2 });
  assert.deepEqual(got.files.map(f => f.name), ["a.jpg", "b.jpg"]);
});

test("textOnly : texte seul même si les fichiers passent (après un échec)", async () => {
  let got;
  const nav = navWith({ canShare: () => true, share: async d => { got = d; } });
  assert.deepEqual(await shareReport({ text: "t", files, textOnly: true, nav }), { ok: true, mode: "text" });
  assert.deepEqual(got, { text: "t" });
});

test("canShare qui lance une exception : texte seul, sans planter", async () => {
  let got;
  const nav = navWith({ canShare: () => { throw new TypeError("bad"); }, share: async d => { got = d; } });
  assert.deepEqual(await shareReport({ text: "t", files, nav }), { ok: true, mode: "text" });
  assert.deepEqual(got, { text: "t" });
});

test("photos seules (texte vide) : aucune légende, rien de copié ; sans fichier partageable, rien ne part", async () => {
  let got;
  navWith.copied = undefined;
  const nav = navWith({ canShare: d => !!d.files, share: async d => { got = d; } });
  assert.deepEqual(await shareReport({ text: "", files, nav }), { ok: true, mode: "files", count: 1 });
  assert.deepEqual(got, { files });
  assert.equal(navWith.copied, undefined);
  const nav2 = navWith({ canShare: () => false, share: async () => { throw new Error("ne doit pas partir"); } });
  assert.deepEqual(await shareReport({ text: "", files, nav: nav2 }), { ok: false, mode: "nofiles" });
});
