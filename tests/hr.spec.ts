import { test, expect } from '@playwright/test';

// Tests unitaires des helpers RH purs exposés en globales par hr.js.
// Ils tournent dans le contexte navigateur, donc c'est bien la vraie
// implémentation qui est exercée.
//
// Boucle locale rapide :
//   python3 -m http.server 8888
//   HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/hr.spec.ts --project=desktop

// `postponed` est declaree par app.js avec `let` : c'est une globale lexicale, donc
// absente de window. On la reference directement dans le contexte de la page.
declare const postponed: Record<string, any>;
// Idem pour l'etat RH et la session, declares avec `let` dans hr.js / app.js.
declare let hrError: string | null;
declare let hrData: any;
declare let cleanerToken: string | null;
declare let currentTab: string;

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof (window as any).leaveDays === 'function'
      && typeof (window as any).gratuityEstimate === 'function',
    null,
    { timeout: 10_000 },
  );
});

test('leaveDays compte les jours calendaires, bornes incluses', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      sameDay: w.leaveDays('2026-08-10', '2026-08-10'),
      elevenDays: w.leaveDays('2026-08-10', '2026-08-20'),
      acrossMonth: w.leaveDays('2026-08-28', '2026-09-02'),
      acrossYear: w.leaveDays('2026-12-30', '2027-01-02'),
      reversed: w.leaveDays('2026-08-20', '2026-08-10'),
      garbage: w.leaveDays('nope', '2026-08-10'),
    };
  });
  expect(r.sameDay).toBe(1);
  expect(r.elevenDays).toBe(11);
  expect(r.acrossMonth).toBe(6);
  expect(r.acrossYear).toBe(4);
  expect(r.reversed).toBe(0);
  expect(r.garbage).toBe(0);
});

test('completeMonths ne compte que les mois révolus', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      exactlyOne: w.completeMonths('2026-01-15', '2026-02-15'),
      oneDayShort: w.completeMonths('2026-01-15', '2026-02-14'),
      twelve: w.completeMonths('2025-03-01', '2026-03-01'),
      past: w.completeMonths('2026-05-01', '2026-04-01'),
      endOfMonth: w.completeMonths('2026-01-31', '2026-03-01'),
    };
  });
  expect(r.exactlyOne).toBe(1);
  expect(r.oneDayShort).toBe(0);
  expect(r.twelve).toBe(12);
  expect(r.past).toBe(0);
  expect(r.endOfMonth).toBe(1);
});

test('accruedAnnualDays applique les paliers du droit émirien', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      // 3 mois de service : rien d'acquis
      threeMonths: w.accruedAnnualDays('2026-05-01', '2026-08-01', 0, '2026-05-01'),
      // 6 mois : 6 x 2 = 12
      sixMonths: w.accruedAnnualDays('2026-02-01', '2026-08-01', 0, '2026-02-01'),
      // 11 mois : 11 x 2 = 22
      elevenMonths: w.accruedAnnualDays('2025-09-01', '2026-08-01', 0, '2025-09-01'),
      // 12 mois : 12 x 2.5 = 30
      twelveMonths: w.accruedAnnualDays('2025-08-01', '2026-08-01', 0, '2025-08-01'),
      // 24 mois : 24 x 2.5 = 60
      twoYears: w.accruedAnnualDays('2024-08-01', '2026-08-01', 0, '2024-08-01'),
      // reprise manuelle : 5 jours au 2026-02-01, puis 6 mois de plus
      withOpening: w.accruedAnnualDays('2024-01-01', '2026-08-01', 5, '2026-02-01'),
    };
  });
  expect(r.threeMonths).toBe(0);
  expect(r.sixMonths).toBe(12);
  expect(r.elevenMonths).toBe(22);
  expect(r.twelveMonths).toBe(30);
  expect(r.twoYears).toBe(60);
  // 5 repris + 6 mois a 2.5 (ancienneté deja > 12 mois) = 5 + 15
  expect(r.withOpening).toBe(20);
});

test('sickTiers ventile 15 pleins / 30 demi / 45 non payés', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return [w.sickTiers(0), w.sickTiers(10), w.sickTiers(15), w.sickTiers(30), w.sickTiers(60), w.sickTiers(95)];
  });
  expect(r[0]).toMatchObject({ full: 0, half: 0, unpaid: 0, used: 0, remaining: 90 });
  expect(r[1]).toMatchObject({ full: 10, half: 0, unpaid: 0, remaining: 80 });
  expect(r[2]).toMatchObject({ full: 15, half: 0, unpaid: 0, remaining: 75 });
  expect(r[3]).toMatchObject({ full: 15, half: 15, unpaid: 0, remaining: 60 });
  expect(r[4]).toMatchObject({ full: 15, half: 30, unpaid: 15, remaining: 30 });
  expect(r[5]).toMatchObject({ full: 15, half: 30, unpaid: 45, remaining: 0 });
});

test('rangesOverlap detecte les chevauchements bornes incluses', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      identical: w.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-10', '2026-08-12'),
      touching: w.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-12', '2026-08-15'),
      inside: w.rangesOverlap('2026-08-10', '2026-08-20', '2026-08-14', '2026-08-15'),
      before: w.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-13', '2026-08-15'),
      after: w.rangesOverlap('2026-08-20', '2026-08-22', '2026-08-13', '2026-08-15'),
    };
  });
  expect(r.identical).toBe(true);
  expect(r.touching).toBe(true);
  expect(r.inside).toBe(true);
  expect(r.before).toBe(false);
  expect(r.after).toBe(false);
});

test('gratuityEstimate suit 21 jours par an puis 30 au dela de 5 ans', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      underOneYear: w.gratuityEstimate('2026-02-01', '2026-08-01', 3000, 0),
      // 2 ans pile, basic 3000 -> daily 100 -> 2 x 21 x 100 = 4200
      twoYears: w.gratuityEstimate('2024-08-01', '2026-08-01', 3000, 0),
      // ~7 ans : 5 x 21 x 100 + ~2 x 30 x 100 = 10500 + ~6000
      sevenYears: w.gratuityEstimate('2019-08-02', '2026-08-01', 3000, 0),
      noBasic: w.gratuityEstimate('2020-01-01', '2026-08-01', null, 0),
    };
  });
  expect(r.underOneYear.amount).toBe(0);
  expect(r.twoYears.amount).toBeCloseTo(4200, 0);
  // L'ancienneté est calculée en jours / 365, donc les années bissextiles
  // décalent le résultat de quelques dizaines de dirhams. On borne au lieu
  // de figer une valeur exacte qui dépendrait de la date de test.
  expect(r.sevenYears.amount).toBeGreaterThan(16400);
  expect(r.sevenYears.amount).toBeLessThan(16700);
  expect(r.noBasic.amount).toBe(0);
});

test('gratuityEstimate plafonne a 24 mois de basic', async ({ page }) => {
  const amount = await page.evaluate(
    () => (window as any).gratuityEstimate('1980-01-01', '2026-08-01', 3000, 0).amount,
  );
  expect(amount).toBe(72000);
});

test('gratuityEstimate deduit les jours de conge non payes', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      withUnpaid: w.gratuityEstimate('2024-08-01', '2026-08-01', 3000, 30).amount,
      without: w.gratuityEstimate('2024-08-01', '2026-08-01', 3000, 0).amount,
    };
  });
  expect(r.withUnpaid).toBeLessThan(r.without);
});

test('daysUntil renvoie le nombre de jours restants', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      future: w.daysUntil('2026-08-31', '2026-08-01'),
      today: w.daysUntil('2026-08-01', '2026-08-01'),
      past: w.daysUntil('2026-07-25', '2026-08-01'),
      empty: w.daysUntil('', '2026-08-01'),
    };
  });
  expect(r.future).toBe(30);
  expect(r.today).toBe(0);
  expect(r.past).toBe(-7);
  expect(r.empty).toBeNull();
});

test('HR_LEAVE_TYPES est la liste figée des types de conge', async ({ page }) => {
  const types = await page.evaluate(() => (window as any).HR_LEAVE_TYPES);
  expect(types.map((x: any) => x.key)).toEqual([
    'annual', 'sick', 'unpaid', 'maternity', 'parental', 'bereavement', 'hajj', 'other',
  ]);
  types.forEach((x: any) => expect(typeof x.label).toBe('string'));
});

// ===========================================================================
// Date effective d'un ménage. Une prestation reportée garde sa clé figée sur la
// date d'origine : sans résolution du report, un ménage déplacé DANS un congé
// approuvé échappe au blocage, et un ménage déplacé HORS du congé est bloqué a tort.
// ===========================================================================

test('hrDayOfKey rend la date effective, report compris', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const plainKey = '2026-08-10_Jane Doe';
    const movedKey = '2026-08-11_John Roe';
    const extraKey = 'extra_2026-08-12_ab12cd34';
    postponed[movedKey] = { original_date: '2026-08-11', new_date: '2026-08-14' };
    postponed[extraKey] = { original_date: '2026-08-12', new_date: '2026-08-13' };
    const out = {
      plain: w.hrDayOfKey(plainKey),
      moved: w.hrDayOfKey(movedKey),
      extra: w.hrDayOfKey(extraKey),
      garbage: w.hrDayOfKey('no-date-in-this-key'),
      empty: w.hrDayOfKey(''),
    };
    delete postponed[movedKey];
    delete postponed[extraKey];
    return out;
  });
  expect(r.plain).toBe('2026-08-10');   // pas de report : date de la clé
  expect(r.moved).toBe('2026-08-14');   // report : new_date, pas la clé
  expect(r.extra).toBe('2026-08-13');   // idem pour un ménage extra
  expect(r.garbage).toBeNull();
  expect(r.empty).toBeNull();
});

test('un ménage reporté est évalué sur le congé du jour où il a lieu', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const intoLeave = '2026-08-10_Guest A';   // clé au 10, déplacé au 12 : DANS le congé
    const outOfLeave = '2026-08-13_Guest B';  // clé au 13 (dans le congé), déplacé au 16
    postponed[intoLeave] = { original_date: '2026-08-10', new_date: '2026-08-12' };
    postponed[outOfLeave] = { original_date: '2026-08-13', new_date: '2026-08-16' };
    w.hrSetApprovedLeaves([{ cleaner_id: 7, start_date: '2026-08-12', end_date: '2026-08-14' }]);
    const out = {
      movedIntoLeave: w.hrOnLeaveOn(7, w.hrDayOfKey(intoLeave)),
      movedOutOfLeave: w.hrOnLeaveOn(7, w.hrDayOfKey(outOfLeave)),
      otherCleaner: w.hrOnLeaveOn(8, w.hrDayOfKey(intoLeave)),
      keyDateStillFrozen: w.hrDayOfKey(intoLeave) !== '2026-08-10',
    };
    delete postponed[intoLeave];
    delete postponed[outOfLeave];
    w.hrSetApprovedLeaves([]);
    return out;
  });
  expect(r.movedIntoLeave).toBe(true);    // bloqué : le ménage a lieu pendant le congé
  expect(r.movedOutOfLeave).toBe(false);  // libéré : il a lieu après le congé
  expect(r.otherCleaner).toBe(false);
  expect(r.keyDateStillFrozen).toBe(true);
});

// Sans login PIN, api() n'envoie aucun X-Cleaner-Token et hrOverview repond 401.
// Un bouton Retry ne peut alors jamais aboutir : l'ecran doit envoyer vers le code.
test("l'écran HR sans session propose de se connecter, pas un Retry sans issue", async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const prev = { tok: cleanerToken, err: hrError, data: hrData, tab: currentTab, hash: location.hash };
    const grab = (msg: string) => {
      cleanerToken = null; hrData = null; hrError = msg; currentTab = 'hr';
      w.renderHR();
      return document.getElementById('app')!.innerHTML;
    };
    const out = { auth: grab('auth required'), network: grab('Network error — check connection') };
    cleanerToken = prev.tok; hrError = prev.err; hrData = prev.data; currentTab = prev.tab;
    location.hash = prev.hash;
    return out;
  });
  // 401 : bouton de connexion, et surtout pas un Retry qui echouera a l'identique.
  expect(r.auth).toContain('hrGoToLogin');
  expect(r.auth).not.toContain('hrRefresh');
  // Toute autre panne garde le Retry, qui lui a un sens.
  expect(r.network).toContain('hrRefresh');
  expect(r.network).not.toContain('hrGoToLogin');
});

test('hrSplitHistory separe en-cours/a-venir du passe, tous statuts', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const rows = [
      { id: 1, cleaner_id: 5, status: 'approved',  start_date: '2026-07-01', end_date: '2026-07-05' },
      { id: 2, cleaner_id: 5, status: 'approved',  start_date: '2026-08-10', end_date: '2026-08-12' },
      { id: 3, cleaner_id: 5, status: 'pending',   start_date: '2026-09-01', end_date: '2026-09-03' },
      { id: 4, cleaner_id: 5, status: 'rejected',  start_date: '2026-08-20', end_date: '2026-08-22' },
      { id: 5, cleaner_id: 5, status: 'cancelled', start_date: '2026-06-01', end_date: '2026-06-02' },
      { id: 6, cleaner_id: 9, status: 'approved',  start_date: '2026-08-10', end_date: '2026-08-12' },
      { id: 7, cleaner_id: 5, status: 'approved',  start_date: '2026-08-01', end_date: '2026-08-09' },
    ];
    const s = w.hrSplitHistory(rows, 5, '2026-08-07');
    return { active: s.active.map((x: any) => x.id), past: s.past.map((x: any) => x.id) };
  });
  // Actifs : pending/approved dont end_date >= today, tri start croissant.
  expect(r.active).toEqual([7, 2, 3]);
  // Passé/terminé : le reste (approuvé passé, rejeté, annulé), tri start décroissant.
  expect(r.past).toEqual([4, 1, 5]);
});

test('hrUpcomingHolidays filtre et trie, hrHolidayNameOn retrouve un ferie', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const rows = [
      { holiday_date: '2026-12-02', name: 'Eid Al Etihad / National Day' },
      { holiday_date: '2026-08-25', name: "Prophet's Birthday (to confirm)" },
      { holiday_date: '2026-01-01', name: 'New Year 2026' },
    ];
    return {
      upcoming: w.hrUpcomingHolidays(rows, '2026-08-07', 10).map((h: any) => h.holiday_date),
      capped: w.hrUpcomingHolidays(rows, '2026-08-07', 1).map((h: any) => h.holiday_date),
      hit: w.hrHolidayNameOn(rows, '2026-12-02'),
      miss: w.hrHolidayNameOn(rows, '2026-12-04'),
      empty: w.hrUpcomingHolidays(null, '2026-08-07', 5),
    };
  });
  expect(r.upcoming).toEqual(['2026-08-25', '2026-12-02']);
  expect(r.capped).toEqual(['2026-08-25']);
  expect(r.hit).toBe('Eid Al Etihad / National Day');
  expect(r.miss).toBeNull();
  expect(r.empty).toEqual([]);
});
