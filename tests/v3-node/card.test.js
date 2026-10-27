import { test } from "node:test";
import assert from "node:assert/strict";
import { cardLines } from "../../v3/conv/card.js";

test("carte du rapport : mise en forme WhatsApp retirée, rubriques repérées", () => {
  const l = cardLines("✅ *READY · 2514 Emaar Grand*\n1 BHK\n\n*Access card:* 📷 1\n_Bed_\n🟠 Stain (HK-461)");
  assert.deepEqual(l.map(x => x.text), ["✅ READY · 2514 Emaar Grand", "1 BHK", "", "Access card: 📷 1", "Bed", "🟠 Stain (HK-461)"]);
  assert.deepEqual(l.map(x => x.label), [null, null, null, "Access card:", null, null]);
});
