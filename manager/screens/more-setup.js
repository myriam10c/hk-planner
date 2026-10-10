// More > Maintenance setup : prestataires, equipements, preventif, couts du mois.
// Lecture : mgr.setup (?month=YYYY-MM), une seule pour les quatre onglets ; changer
// d'onglet ne relit rien (le hash suit via replaceState). Ecritures : les actions
// existantes saveVendor, deleteVendor, saveEquipment, savePreventiveMaintenance,
// completePreventive, addMaintenanceCost (le proxy exige une session manager).
// Le serveur reste juge des champs obligatoires : son message s'affiche tel quel.
// Montants : ceux du serveur ; le total du mois est une somme d'affichage seulement.
import { get, post } from '/manager/api.js';
import { closeSheet, dubaiToday, esc, I, openSheet, sheetBusy, sheetError, sheetIsOpen, toast } from '/manager/ui/dom.js';

const TABS = [['vendors', 'Vendors'], ['equipment', 'Equipment'], ['preventive', 'Preventive'], ['costs', 'Costs']];
const TAB_IDS = TABS.map((t) => t[0]);
// Listes reprises de l'ancienne app (renderMtVendors, renderMtEquipment, renderMtPreventive).
const SPECIALTIES = [['plumbing', 'Plumbing'], ['electrical', 'Electrical'], ['ac', 'AC'], ['appliance', 'Appliance'],
  ['handyman', 'Handyman'], ['pest_control', 'Pest control'], ['painting', 'Painting']];
const EQ_CATS = [['ac', 'AC'], ['water_heater', 'Water heater'], ['washer', 'Washer'], ['dryer', 'Dryer'], ['dishwasher', 'Dishwasher'],
  ['fridge', 'Fridge'], ['oven', 'Oven'], ['tv', 'TV'], ['other', 'Other']];
const CONDITIONS = [['excellent', 'Excellent'], ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['needs_replacement', 'Needs replacement']];
const PM_CATS = [['plumbing', 'Plumbing'], ['electrical', 'Electrical'], ['ac', 'AC'], ['appliance', 'Appliance'], ['general', 'General']];
const COST_CATS = [...SPECIALTIES, ['general', 'General'], ['preventive', 'Preventive'], ['other', 'Other']];

const labelOf = (list, v) => { const x = list.find((p) => p[0] === v); return x ? x[1] : String(v || ''); };
const aed = (v) => 'AED ' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const str = (v) => (v === null || v === undefined ? '' : String(v));
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
}
const dayOf = (iso) => (iso ? dubaiToday(Date.parse(iso)) : '');

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Maintenance setup</h1></div></header>';
}
const head = (title, sub) => '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2>'
  + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'
  + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
const field = (id, label, control) => '<div class="su-fl"><label for="' + id + '">' + esc(label) + '</label>' + control + '</div>';
const input = (id, type, value, extra) => '<input id="' + id + '" type="' + type + '" autocomplete="off" value="' + esc(str(value)) + '"' + (extra || '') + '>';
const area = (id, value) => '<textarea id="' + id + '" rows="3">' + esc(str(value)) + '</textarea>';
function select(id, opts, value, empty) {
  return '<select id="' + id + '">' + (empty !== undefined ? '<option value="">' + esc(empty) + '</option>' : '')
    + opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(value ?? '') === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('')
    + '</select>';
}
const foot = (buttons) => '<div class="sheet-f">' + buttons + '</div>';
const saveBtn = '<button class="btn primary" type="button" data-save>Save</button>';

export async function renderSetup(ctx, id) {
  const main = ctx.main;
  const st = { data: null, tab: TAB_IDS.includes(id) ? id : 'vendors', month: '', current: '', seq: 0, sheet: null, busy: false };

  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
    return false;
  }
  const d = () => st.data;
  const aptOpts = () => d().listings.map((l) => [l.id, l.apt ? l.apt + ' · ' + l.bld : l.bld]);
  const vendorOpts = () => d().vendors.map((v) => [String(v.id), v.name]);
  const find = (list, key) => list.find((x) => String(x.id) === String(key));

  // ---- onglets ----
  function tabsHtml() {
    return '<div class="su-tabs" role="tablist">' + TABS.map(([k, l]) => '<button class="su-tab" type="button" role="tab" data-tab="' + k + '"'
      + ' aria-selected="' + (st.tab === k) + '">' + l + '</button>').join('') + '</div>';
  }
  const bar = (label, attr) => '<div class="su-bar"><button class="btn primary" type="button" ' + attr + '>' + label + '</button></div>';
  const empty = (msg) => '<p class="empty pad">' + msg + '</p>';

  function vendorsHtml() {
    const rows = d().vendors.map((v) => '<button class="su-row" type="button" data-vendor="' + esc(v.id) + '">'
      + '<span class="su-txt"><span class="su-name">' + esc(v.name) + ' <span class="pill idle">' + esc(labelOf(SPECIALTIES, v.specialty)) + '</span></span>'
      + '<span class="su-sub">' + esc([v.phone, v.email, v.hourly_rate !== null && v.hourly_rate !== undefined ? aed(v.hourly_rate) + ' / hour' : ''].filter(Boolean).join(' · ') || 'No contact') + '</span></span>'
      + '<span class="su-chev">' + I.next + '</span></button>').join('');
    return bar('Add vendor', 'data-add-vendor')
      + '<section class="card"><div class="sec-head"><h2>Vendors</h2><span class="meta">' + d().vendors.length + '</span></div>'
      + (rows ? '<div class="su-list">' + rows + '</div>' : empty('No vendors yet.')) + '</section>';
  }

  function equipmentHtml() {
    const today = dubaiToday(Date.now());
    const groups = [];
    for (const e of d().equipment) {
      const g = groups.find((x) => x.label === e.listingLabel);
      if (g) g.items.push(e); else groups.push({ label: e.listingLabel, items: [e] });
    }
    const row = (e) => {
      const due = e.next_service && e.next_service < today;
      const sub = [labelOf(EQ_CATS, e.category), e.brand, e.next_service ? 'Next service ' + e.next_service : 'No service date'].filter(Boolean).join(' · ');
      return '<button class="su-row" type="button" data-equipment="' + esc(e.id) + '"><span class="su-txt">'
        + '<span class="su-name">' + esc(e.name) + ' <span class="pill ' + (e.condition === 'poor' || e.condition === 'needs_replacement' ? 'bad' : e.condition === 'fair' ? 'warn' : 'ok') + '">'
        + esc(labelOf(CONDITIONS, e.condition || 'good')) + '</span>' + (due ? ' <span class="pill bad">Service due</span>' : '') + '</span>'
        + '<span class="su-sub">' + esc(sub) + '</span></span><span class="su-chev">' + I.next + '</span></button>';
    };
    const body = groups.map((g) => '<section class="card"><div class="sec-head"><h2>' + esc(g.label) + '</h2><span class="meta">' + g.items.length + '</span></div>'
      + '<div class="su-list">' + g.items.map(row).join('') + '</div></section>').join('');
    return bar('Add equipment', 'data-add-equipment') + (body || '<section class="card">' + empty('No equipment yet.') + '</section>');
  }

  function preventiveHtml() {
    const today = dubaiToday(Date.now());
    const rows = d().schedules.map((s) => {
      const due = dayOf(s.next_due_at);
      const late = due && due < today;
      const sub = [s.listingLabel || 'All apartments', 'Every ' + s.frequency_days + ' days', s.vendorName,
        s.estimated_cost !== null && s.estimated_cost !== undefined ? 'Estimate ' + aed(s.estimated_cost) : ''].filter(Boolean).join(' · ');
      return '<article class="su-item" data-schedule="' + esc(s.id) + '">'
        + '<button class="su-row" type="button" data-edit-schedule="' + esc(s.id) + '"><span class="su-txt">'
        + '<span class="su-name">' + esc(s.task_name) + ' ' + (late ? '<span class="pill bad">Overdue</span>' : '<span class="pill idle">Due ' + esc(due || 'not set') + '</span>') + '</span>'
        + '<span class="su-sub">' + esc(sub) + '</span>'
        + (late ? '<span class="su-sub">Was due ' + esc(due) + '</span>' : '')
        + (s.last_done_at ? '<span class="su-sub">Last done ' + esc(dayOf(s.last_done_at)) + '</span>' : '')
        + '</span><span class="su-chev">' + I.next + '</span></button>'
        + '<div class="su-acts"><button class="btn" type="button" data-done="' + esc(s.id) + '">Mark done</button></div></article>';
    }).join('');
    return bar('Add task', 'data-add-schedule')
      + '<section class="card"><div class="sec-head"><h2>Preventive maintenance</h2><span class="meta">' + d().schedules.length + '</span></div>'
      + (rows ? '<div class="su-list">' + rows + '</div>' : empty('No preventive tasks yet.')) + '</section>';
  }

  function costsHtml() {
    const canNext = st.current && d().month < st.current;
    const total = d().costs.reduce((s, c) => s + Number(c.amount || 0), 0);
    const rows = d().costs.map((c) => '<div class="su-cost" data-cost="' + esc(c.id) + '"><span class="su-txt">'
      + '<span class="su-name">' + esc(c.description || labelOf(COST_CATS, c.category) || 'Cost') + '</span>'
      + '<span class="su-sub">' + esc([c.date, c.listingLabel, c.category ? labelOf(COST_CATS, c.category) : '', c.vendorName].filter(Boolean).join(' · ')) + '</span></span>'
      + '<b class="su-amt">' + esc(aed(c.amount)) + '</b></div>').join('');
    return '<div class="su-bar"><div class="su-nav"><button class="iconbtn" type="button" data-prev aria-label="Previous month">' + I.prev + '</button>'
      + '<span class="su-month" aria-live="polite">' + esc(monthLabel(d().month)) + '</span>'
      + '<button class="iconbtn" type="button" data-next aria-label="Next month"' + (canNext ? '' : ' disabled') + '>' + I.next + '</button></div>'
      + '<button class="btn primary" type="button" data-add-cost>Add cost</button></div>'
      + '<section class="card"><div class="sec-head"><h2>Costs</h2><span class="meta">Total <b data-cost-total>' + esc(aed(total)) + '</b></span></div>'
      + (rows ? '<div class="su-list">' + rows + '</div>' : empty('No costs this month.')) + '</section>';
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    const body = st.tab === 'equipment' ? equipmentHtml() : st.tab === 'preventive' ? preventiveHtml() : st.tab === 'costs' ? costsHtml() : vendorsHtml();
    main.innerHTML = header() + '<div class="su">' + tabsHtml() + '<div class="su-panel" role="tabpanel">' + body + '</div></div>';
  }
  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
  }

  async function load(month, quiet, afterWrite) {
    const my = ++st.seq;
    if (!quiet) main.innerHTML = header() + '<div class="ph"><p role="status">Loading maintenance setup...</p></div>';
    try {
      const r = await get('mgr.setup', month ? { month } : undefined);
      if (!ctx.isCurrent() || my !== st.seq) return;
      st.data = r;
      st.month = r.month;
      // Sans mois demande, le serveur rend le mois courant de Dubai : borne du bouton Next.
      if (!month) st.current = r.month;
      paint();
    } catch (e) {
      if (!ctx.isCurrent() || my !== st.seq || handleAccess(e)) return;
      if (afterWrite) toast('Saved, but the list could not be refreshed.');
      paintError(e.message || 'Could not load maintenance setup.');
    }
  }

  // ---- panneaux ----
  function vendorSheet(v) {
    return head(v ? v.name : 'Add vendor', v ? labelOf(SPECIALTIES, v.specialty) : '') + '<div class="sheet-b">'
      + field('suName', 'Name', input('suName', 'text', v && v.name, ' maxlength="100"'))
      + field('suSpec', 'Specialty', select('suSpec', SPECIALTIES, v && v.specialty, 'Choose a specialty'))
      + field('suPhone', 'Phone', input('suPhone', 'tel', v && v.phone, ' inputmode="tel"'))
      + field('suEmail', 'Email', input('suEmail', 'email', v && v.email, ' inputmode="email" autocapitalize="off"'))
      + field('suRate', 'Hourly rate (AED)', input('suRate', 'number', v && v.hourly_rate, ' inputmode="decimal" min="0" step="any"'))
      + field('suNotes', 'Notes', area('suNotes', v && v.notes))
      + '</div>' + foot(saveBtn + (v ? '<button class="btn danger" type="button" data-delete>Delete</button>' : ''));
  }
  function confirmSheet(v) {
    return head('Delete ' + v.name + '?', '') + '<div class="sheet-b"><p class="su-confirm" role="status">Delete ' + esc(v.name)
      + '? They will no longer be offered for new work.</p></div>'
      + foot('<button class="btn danger" type="button" data-confirm>Confirm</button><button class="btn" type="button" data-cancel>Cancel</button>');
  }
  function equipmentSheet(e) {
    return head(e ? e.name : 'Add equipment', e ? e.listingLabel : '') + '<div class="sheet-b">'
      + field('suApt', 'Apartment', select('suApt', aptOpts(), e && e.listing_id, 'Choose an apartment'))
      + field('suName', 'Name', input('suName', 'text', e && e.name, ' maxlength="100"'))
      + field('suCat', 'Category', select('suCat', EQ_CATS, e ? e.category : 'other'))
      + field('suBrand', 'Brand', input('suBrand', 'text', e && e.brand))
      + field('suModel', 'Model', input('suModel', 'text', e && e.model))
      + field('suSerial', 'Serial number', input('suSerial', 'text', e && e.serial_number))
      + field('suInstall', 'Install date', input('suInstall', 'date', e && e.install_date))
      + field('suWarranty', 'Warranty until', input('suWarranty', 'date', e && e.warranty_until))
      + field('suInterval', 'Service interval (days)', input('suInterval', 'number', e ? e.service_interval_days : 180, ' inputmode="numeric" min="1" step="1"'))
      + field('suCond', 'Condition', select('suCond', CONDITIONS, e ? e.condition || 'good' : 'good'))
      + field('suNotes', 'Notes', area('suNotes', e && e.notes))
      + '</div>' + foot(saveBtn);
  }
  function scheduleSheet(s) {
    return head(s ? s.task_name : 'Add task', s ? s.listingLabel || 'All apartments' : '') + '<div class="sheet-b">'
      + field('suTask', 'Task', input('suTask', 'text', s && s.task_name, ' maxlength="200"'))
      + field('suApt', 'Apartment', select('suApt', aptOpts(), s && s.listing_id, 'All apartments'))
      + field('suCat', 'Category', select('suCat', PM_CATS, s && s.category, 'No category'))
      + field('suFreq', 'Every (days)', input('suFreq', 'number', s ? s.frequency_days : 90, ' inputmode="numeric" min="1" step="1"'))
      + field('suVendor', 'Vendor', select('suVendor', vendorOpts(), s && s.assigned_vendor_id, 'No vendor'))
      + field('suEst', 'Estimated cost (AED)', input('suEst', 'number', s && s.estimated_cost, ' inputmode="decimal" min="0" step="any"'))
      + field('suDesc', 'Description', area('suDesc', s && s.description))
      + '</div>' + foot(saveBtn);
  }
  function doneSheet(s) {
    return head('Mark done', s.task_name) + '<div class="sheet-b">'
      + field('suActual', 'Actual cost (AED)', input('suActual', 'number', '', ' inputmode="decimal" min="0" step="any"'))
      + field('suNotes', 'Notes', area('suNotes', ''))
      + '<p class="su-sub">A cost is recorded when an amount is entered.</p>'
      + '</div>' + foot('<button class="btn primary" type="button" data-mark>Mark done</button>');
  }
  function costSheet() {
    const today = dubaiToday(Date.now());
    const def = d().month === today.slice(0, 7) ? today : d().month + '-01';
    return head('Add cost', monthLabel(d().month)) + '<div class="sheet-b">'
      + field('suApt', 'Apartment', select('suApt', aptOpts(), '', 'No apartment'))
      + field('suCat', 'Category', select('suCat', COST_CATS, '', 'No category'))
      + field('suDesc', 'Description', input('suDesc', 'text', '', ' maxlength="200"'))
      + field('suAmount', 'Amount (AED)', input('suAmount', 'number', '', ' inputmode="decimal" min="0" step="any"'))
      + field('suVendor', 'Vendor', select('suVendor', vendorOpts(), '', 'No vendor'))
      + field('suDate', 'Date', input('suDate', 'date', def))
      + '</div>' + foot(saveBtn);
  }

  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
  const num = (id) => { const v = val(id); return v === '' ? null : Number(v); };
  const idOrNull = (id) => { const v = val(id); return v === '' ? null : Number(v); };

  function open(kind, item, html) { st.sheet = { kind, id: item ? item.id : null }; openSheet(html); }

  // Une ecriture dans le panneau : bloquee pendant l'envoi, erreur du serveur telle quelle.
  async function run(action, body, okMsg) {
    if (st.busy) return;
    st.busy = true;
    sheetBusy(true);
    try {
      await post(action, body);
    } catch (e) {
      st.busy = false;
      sheetBusy(false);
      if (handleAccess(e)) return;
      sheetError((e && e.message) || 'Something went wrong. Try again.');
      // Mark done peut echouer apres l'echeance ecrite (cout ou equipement) : on relit la liste.
      if (action === 'completePreventive' && e && e.kind === 'server') load(st.month === st.current ? '' : st.month, true);
      return;
    }
    st.busy = false;
    sheetBusy(false);
    if (st.sheet) { st.sheet = null; closeSheet(); }
    toast(okMsg);
    load(st.month === st.current ? '' : st.month, true, true);
  }

  function onSave() {
    const s = st.sheet;
    if (s.kind === 'vendor') {
      const body = { name: val('suName'), phone: val('suPhone'), email: val('suEmail'), specialty: val('suSpec'), hourly_rate: num('suRate'), notes: val('suNotes') };
      run('saveVendor', s.id ? { id: s.id, ...body } : body, 'Saved');
    } else if (s.kind === 'equipment') {
      const body = {
        listing_id: val('suApt'), name: val('suName'), category: val('suCat'), brand: val('suBrand'), model: val('suModel'),
        serial_number: val('suSerial'), install_date: val('suInstall') || null, warranty_until: val('suWarranty') || null,
        service_interval_days: num('suInterval'), condition: val('suCond'), notes: val('suNotes'),
      };
      run('saveEquipment', s.id ? { id: s.id, ...body } : body, 'Saved');
    } else if (s.kind === 'schedule') {
      const cur = s.id ? find(d().schedules, s.id) : null;
      const body = {
        task_name: val('suTask'), listing_id: val('suApt') || null, category: val('suCat') || null, frequency_days: num('suFreq'),
        assigned_vendor_id: idOrNull('suVendor'), estimated_cost: num('suEst'), description: val('suDesc'),
      };
      // L'equipement lie n'est pas edite ici : on renvoie celui en base.
      if (cur) body.equipment_id = cur.equipment_id ?? null;
      run('savePreventiveMaintenance', s.id ? { id: s.id, ...body } : body, 'Saved');
    } else if (s.kind === 'cost') {
      run('addMaintenanceCost', {
        listing_id: val('suApt') || null, category: val('suCat') || null, description: val('suDesc'), amount: num('suAmount'),
        vendor_id: idOrNull('suVendor'), date: val('suDate') || null,
      }, 'Cost added');
    }
  }

  function setTab(k) {
    if (!TAB_IDS.includes(k) || k === st.tab) return;
    st.tab = k;
    try { history.replaceState(null, '', '#/more/setup/' + k); } catch (e) { /* hash inchange */ }
    paint();
  }

  const onClick = (ev) => {
    if (!ctx.isCurrent()) return;
    const t = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!t) return;
    if (t.closest('#sheet')) {
      if (!st.sheet || t.disabled) return;
      const s = st.sheet;
      if (t.hasAttribute('data-save')) onSave();
      else if (t.hasAttribute('data-delete')) { const v = find(d().vendors, s.id); if (v) openSheet(confirmSheet(v)); }
      else if (t.hasAttribute('data-cancel')) { const v = find(d().vendors, s.id); if (v) openSheet(vendorSheet(v)); }
      else if (t.hasAttribute('data-confirm')) { const v = find(d().vendors, s.id); if (v) run('deleteVendor', { id: v.id }, v.name + ' deleted'); }
      else if (t.hasAttribute('data-mark')) run('completePreventive', { id: s.id, actual_cost: num('suActual'), notes: val('suNotes') }, 'Marked done');
      return;
    }
    if (!main.contains(t)) return;
    if (t.hasAttribute('data-retry')) { load(st.month === st.current ? '' : st.month); return; }
    if (!st.data) return;
    if (t.hasAttribute('data-tab')) { setTab(t.getAttribute('data-tab')); return; }
    if (t.hasAttribute('data-prev') || t.hasAttribute('data-next')) {
      if (t.disabled) return;
      const m = shiftMonth(st.data.month, t.hasAttribute('data-prev') ? -1 : 1);
      load(m === st.current ? '' : m);
      return;
    }
    if (t.hasAttribute('data-add-vendor')) open('vendor', null, vendorSheet(null));
    else if (t.hasAttribute('data-vendor')) { const v = find(d().vendors, t.getAttribute('data-vendor')); if (v) open('vendor', v, vendorSheet(v)); }
    else if (t.hasAttribute('data-add-equipment')) open('equipment', null, equipmentSheet(null));
    else if (t.hasAttribute('data-equipment')) { const e = find(d().equipment, t.getAttribute('data-equipment')); if (e) open('equipment', e, equipmentSheet(e)); }
    else if (t.hasAttribute('data-add-schedule')) open('schedule', null, scheduleSheet(null));
    else if (t.hasAttribute('data-edit-schedule')) { const s = find(d().schedules, t.getAttribute('data-edit-schedule')); if (s) open('schedule', s, scheduleSheet(s)); }
    else if (t.hasAttribute('data-done')) { const s = find(d().schedules, t.getAttribute('data-done')); if (s) open('done', s, doneSheet(s)); }
    else if (t.hasAttribute('data-add-cost')) open('cost', null, costSheet());
  };
  document.addEventListener('click', onClick);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    st.seq++;
    if (st.sheet && sheetIsOpen()) closeSheet();
    st.sheet = null;
  });

  await load('');
}
