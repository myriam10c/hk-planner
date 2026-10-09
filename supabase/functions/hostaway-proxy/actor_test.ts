import { assertEquals } from "jsr:@std/assert@1";
import { NO_SESSION_ACTOR, sessionActor } from "./actor.ts";

const ME = { cleaner_id: 9, name: "Harlene", role: "manager", color: "#000" };

Deno.test("session presente : le nom de la session, la valeur du navigateur est ignoree", () => {
  assertEquals(sessionActor(ME, "Manager"), "Harlene");
  assertEquals(sessionActor(ME, "Hermes_AutoAssign"), "Harlene");
  assertEquals(sessionActor(ME, undefined), "Harlene");
});

Deno.test("sans session : seuls les jobs serveur Hermes gardent leur nom", () => {
  assertEquals(sessionActor(null, "Hermes_AutoAssign"), "Hermes_AutoAssign");
  assertEquals(sessionActor(null, "Hermes_Brain"), "Hermes_Brain");
});

Deno.test("sans session : un nom libre du navigateur n'est jamais repris", () => {
  for (const v of ["Manager", "Hillal", "Hermes AutoAssign", "Hermes_", "Hermes_x<script>", "", null, 42]) {
    assertEquals(sessionActor(null, v), NO_SESSION_ACTOR);
  }
});

Deno.test("nom de session vide : traite comme sans session", () => {
  assertEquals(sessionActor({ ...ME, name: "  " }, "Hermes_Brain"), "Hermes_Brain");
  assertEquals(sessionActor({ ...ME, name: "  " }, "Walter"), NO_SESSION_ACTOR);
});
