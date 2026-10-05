// Journée v3.myDay réaliste (forme de supabase/functions/hostaway-proxy/v3_myday.ts)
// et appartements de la conversation construits par toApartments : remplace les
// appartements de démo du prototype (data.js).
import { toApartments } from "../../v3/conv/day.js";

// 12:00 à Dubai.
export const NOW = new Date("2026-10-02T08:00:00Z");
export const ME = { id: 4, name: "Faiza", role: "cleaner" };

const signed = room => "https://dqjnqvbxfwtvrjwnnmns.supabase.co/storage/v1/object/sign/cleaning-photos/v3/prev/" + room.replace(/ /g, "_") + ".jpg?token=t";
export const REF = signed;

const base = {
  aptNumber: null, templateName: "Studio", checkOutTime: "11:00", guest: "Marc L.", nextGuest: null,
  checklist: [], photoRequired: [], progress: {}, label: null, othersOnJob: [], openTickets: [],
  state: "todo", startedAt: null, sameDay: false, nextArrivalDate: null, nextArrivalTime: null,
};

// Studio avec un ticket « pest » ouvert (vérification du manager) et une fuite déjà signalée.
export const STOP_OXFORD = {
  ...base, jobId: "job_00000000000000oxf122", listingId: "201", listingName: "122 - Oxford Boulevard",
  unitType: "Studio", estimatedMinutes: 100, sameDay: true, nextArrivalDate: "2026-10-02", nextArrivalTime: "15:00",
  nextGuest: "Anna W.",
  openTickets: [
    { id: 91, title: "Cockroaches · Kitchen", category: "pest", priority: "medium" },
    { id: 92, title: "Leak · Bathroom", category: "plumbing", priority: "medium" },
  ],
  rooms: ["Bed", "Bathroom", "Kitchen"],
  heroPhotoUrl: "https://hostaway-platform.s3.us-west-2.amazonaws.com/listing/oxford.jpg",
  references: { Bed: signed("ox-Bed"), Bathroom: signed("ox-Bathroom"), Kitchen: signed("ox-Kitchen") },
};

// 2 BHK avec binôme : Pionah a démarré à 10:05 (Dubai), avant moi.
export const STOP_CREEK = {
  ...base, jobId: "job_0000000000000crk1506", listingId: "202", listingName: "1506 - Emaar Creekside 18A",
  unitType: "2 BHK", templateName: "2 Bedrooms", estimatedMinutes: 150, state: "running", startedAt: "2026-10-02T06:05:00Z",
  othersOnJob: [{ id: 7, name: "Pionah", startedAt: "2026-10-02T06:05:00Z" }],
  rooms: ["Bedroom 1", "Bedroom 2", "Living room", "Kitchen", "Bathroom 1", "Bathroom 2", "Balcony"],
  heroPhotoUrl: "https://hostaway-platform.s3.us-west-2.amazonaws.com/listing/creek.jpg",
  references: {
    "Bedroom 1": signed("cr-Bedroom 1"), "Bedroom 2": signed("cr-Bedroom 2"), "Living room": signed("cr-Living room"),
    "Kitchen": signed("cr-Kitchen"), "Bathroom 1": signed("cr-Bathroom 1"),
  },
};

// Studio 1011C, sans voyageur réservé, référence absente pour la salle de bain.
export const STOP_BLOOM = {
  ...base, jobId: "job_0000000000000blm1011", listingId: "203", listingName: "1011C - Bloom Towers",
  unitType: "Studio", estimatedMinutes: 100,
  rooms: ["Bed", "Bathroom", "Kitchen"],
  heroPhotoUrl: "https://hostaway-platform.s3.us-west-2.amazonaws.com/listing/bloom.jpg",
  references: { Bed: signed("bl-Bed"), Kitchen: signed("bl-Kitchen") },
};

export const DAY = {
  status: "success", date: "2026-10-02", me: ME, linenRequired: true, totalMinutes: 350,
  stops: [STOP_OXFORD, STOP_CREEK, STOP_BLOOM],
};

export const APARTMENTS = toApartments(DAY, ME, { now: NOW });
