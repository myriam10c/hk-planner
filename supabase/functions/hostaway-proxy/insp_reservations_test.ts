import { assertEquals } from "jsr:@std/assert@1";
import { normalizeReservations } from "./insp_reservations.ts";

Deno.test("normalise, dedoublonne, ignore l'incomplet", () => {
  const raw = [
    { id: 1, listingMapId: 55, arrivalDate: "2026-10-01", departureDate: "2026-10-06", status: "confirmed", checkInTime: 15, checkOutTime: 0 },
    { id: 1, listingMapId: 55, arrivalDate: "2026-10-01", departureDate: "2026-10-06", status: "confirmed" },
    { id: 2, arrivalDate: "2026-10-01", departureDate: "2026-10-06", status: "confirmed" },
  ];
  assertEquals(normalizeReservations(raw), [
    { listingId: "55", arrival: "2026-10-01", departure: "2026-10-06", status: "confirmed", checkInTime: 15, checkOutTime: null },
  ]);
});
