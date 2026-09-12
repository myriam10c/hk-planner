// Feuille « Report a problem ». Quatre gestes : categorie, photo, envoi, retour.
// Le ticket nait avec le logement et le menage attaches, et part au technicien de
// permanence. Aucune sortie vers WhatsApp (specification, section 3).
import { closeSheet, esc, openSheet, toast } from '/v3/ui.js';
import { newIdem, sendOrQueue } from '/v3/offline.js';
import { prendrePhoto } from '/v3/photo.js';

export const CATEGORIES = [
  { key: 'ac', label: 'AC' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'appliance', label: 'Appliance' },
  { key: 'pest', label: 'Pest' },
  { key: 'other', label: 'Other' },
];

const LIBELLE_PHOTO = 'Take a photo';
const LIBELLE_PHOTO_PRISE = 'Photo taken';

export function openReportSheet(state, stop) {
  if (!stop) return;
  state.reportStop = stop;
  state.report = { category: null, photo: null, sending: false };
  let h = '<h2>Report a problem</h2>' +
    '<p class="m">' + esc(stop.listingName) + '. The apartment and the cleaning are attached on their own.</p>' +
    '<div class="catgrid">';
  CATEGORIES.forEach(function (c) {
    h += '<button type="button" aria-pressed="false" data-act="report-cat" data-cat="' + c.key + '">' +
      esc(c.label) + '</button>';
  });
  h += '</div>';
  h += '<button type="button" class="shotbox" data-act="report-shot">' + LIBELLE_PHOTO + '</button>';
  h += '<button type="button" class="btn-primary" data-act="report-send" disabled>' +
    'Send to the technician on duty</button>';
  h += '<button type="button" class="btn-ghost" data-act="close-sheet">Cancel</button>';
  openSheet(h);
}

// L'envoi n'est ouvert qu'avec une categorie ET une photo, et jamais pendant un
// envoi deja parti : le bouton porte lui-meme la garde anti double appui, en
// plus de celle de l'action.
function majEnvoi(state) {
  const bouton = document.querySelector('[data-act="report-send"]');
  if (!bouton || !state.report) return;
  const pret = !!(state.report.category && state.report.photo) && !state.report.sending;
  if (pret) bouton.removeAttribute('disabled');
  else bouton.setAttribute('disabled', '');
}

function majBoutonPhoto(state) {
  const el = document.querySelector('[data-act="report-shot"]');
  if (!el || !state.report) return;
  if (state.report.photo) {
    el.classList.add('has');
    el.textContent = LIBELLE_PHOTO_PRISE;
  } else {
    el.classList.remove('has');
    el.textContent = LIBELLE_PHOTO;
  }
}

// Actions montees dans l'ecran Job : la feuille vit au-dessus de lui.
export const reportActions = {
  'report-cat'(state, el) {
    if (!state.report) return;
    state.report.category = el.getAttribute('data-cat');
    document.querySelectorAll('[data-act="report-cat"]').forEach(function (b) {
      b.setAttribute('aria-pressed', b === el ? 'true' : 'false');
    });
    majEnvoi(state);
  },
  // Pas de verrou anti double appui ici, volontairement, et comme l'appareil
  // photo de l'ecran Job : un verrou pose avant l'ouverture de l'entree de
  // fichier ne se leverait jamais si la cleaner annule la prise (Chrome
  // n'emet alors aucun `change`), et le bouton resterait mort pour de bon. Deux
  // appuis rapides ne coutent qu'une promesse pendante, jamais un doublon.
  async 'report-shot'(state) {
    const stop = state.reportStop;
    if (!stop || !state.report) return;
    const fichier = await prendrePhoto();
    if (!fichier) return;
    const idem = newIdem();
    // Un refus dur du proxy ne garde rien et leve : la photo n'est pas prise, le
    // bouton garde son libelle d'origine et reste appuyable (meme regle que le
    // retour arriere du Start, revue tache 10). app.js montre le message.
    const r = await sendOrQueue('v3.uploadPhoto',
      { jobId: stop.jobId, idem: idem }, fichier, fichier.name || 'photo.jpg');
    if (!state.report) return;   // feuille fermee pendant l'envoi
    state.report.photo = { photoIdem: idem, photoId: r.data ? r.data.photoId : null };
    if (r.queued) toast('Photo saved on your phone', 'ok');
    majBoutonPhoto(state);
    majEnvoi(state);
  },
  async 'report-send'(state) {
    const stop = state.reportStop;
    if (!stop || !state.report) return;
    if (state.report.sending) return;
    if (!state.report.category || !state.report.photo) return;
    state.report.sending = true;
    majEnvoi(state);
    const corps = {
      jobId: stop.jobId,
      listingId: stop.listingId,
      category: state.report.category,
      idem: newIdem(),
    };
    // Hors ligne, la photo n'a pas encore d'identifiant serveur : le signalement
    // la designe par la cle de son televersement. Le rejeu passe la photo
    // d'abord, le signalement ensuite, et le proxy fait le lien.
    if (state.report.photo.photoId) corps.photoId = state.report.photo.photoId;
    else corps.photoIdem = state.report.photo.photoIdem;
    let r;
    try {
      r = await sendOrQueue('v3.reportProblem', corps);
    } catch (err) {
      // Rien n'a ete garde : la feuille reste ouverte, avec sa categorie et sa
      // photo, et le bouton redevient utilisable. Fermer ici perdrait le
      // signalement sans aucun moyen de le refaire.
      state.report.sending = false;
      majEnvoi(state);
      throw err;   // app.js montre le message
    }
    state.report.sending = false;
    state.report = null;
    state.reportStop = null;
    closeSheet();
    toast(r.queued ? 'Saved on your phone' : 'Sent. The technician on duty is notified.', 'ok');
  },
};
