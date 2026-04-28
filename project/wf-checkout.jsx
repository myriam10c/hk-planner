// Daily checkout list — 5 variations
// V1 desktop dense table · V2 desktop kanban · V3 desktop map+cards
// V4 mobile cleaner card-stack · V5 mobile minimal timeline

// ─── V1 — Desktop, dense table (manager dispatch view) ──────────────
const CheckoutV1 = () => (
  <Frame title="Today's checkouts" sub="Tue 28 Apr · 7 turnovers">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="today" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Toolbar */}
        <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--line-3)', gap: 8 }}>
          <div className="search" style={{ width: 200 }}>⌕ Search property, guest, cleaner…</div>
          <span className="pill solid">Today</span>
          <span className="pill">Tomorrow</span>
          <span className="pill">Week</span>
          <div style={{ flex: 1 }}></div>
          <span className="pill">Status: All ▾</span>
          <span className="pill">Cleaner: All ▾</span>
          <span className="pill">Zone: All ▾</span>
          <span className="btn solid">+ Assign</span>
        </div>
        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 0, borderBottom: '1px solid var(--line-3)' }}>
          {[
            ['Turnovers', '7'],
            ['Done', '1 / 7'],
            ['In progress', '1'],
            ['Tightest window', '3h · Montmartre'],
            ['Unassigned', '1 ⚠'],
          ].map(([l, v], i) => (
            <div key={i} style={{ padding: 10, borderRight: i < 4 ? '1px solid var(--line-3)' : 'none' }}>
              <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em' }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
        {/* Header */}
        <div className="tr head" style={{ gridTemplateColumns: '32px 2fr 90px 90px 1.4fr 1fr 90px 70px 70px' }}>
          <div></div>
          <div>Property</div>
          <div>Out</div>
          <div>In</div>
          <div>Cleaner</div>
          <div>Status</div>
          <div>Linen</div>
          <div>Tickets</div>
          <div>Photos</div>
        </div>
        {/* Rows */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {TURNOVERS.map(t => {
            const p = propById(t.prop); const s = staffById(t.cleaner);
            const tight = t.in !== '—' && parseInt(t.in) - parseInt(t.out) <= 3;
            return (
              <div key={t.id} className="tr" style={{ gridTemplateColumns: '32px 2fr 90px 90px 1.4fr 1fr 90px 70px 70px' }}>
                <div className={'checkbox' + (t.status === 'done' ? ' on' : '')}></div>
                <div>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 10 }}>{p.zone} · {t.guests} guests · {t.nights}n</div>
                </div>
                <div className="mono">{t.out}</div>
                <div className="mono">
                  {t.in}
                  {tight && <span className="pill warn" style={{ marginLeft: 4, fontSize: 8, padding: '0 4px' }}>tight</span>}
                </div>
                <div>
                  {s ? <span className="row gap-6"><span className="avi sm">{s.initials}</span>{s.name}</span> :
                    <span className="pill bad">⚠ Unassigned</span>}
                </div>
                <div><Status s={t.status} /></div>
                <div className="mono muted" style={{ fontSize: 10 }}>{t.linen}</div>
                <div>{t.tickets > 0 ? <span className="pill warn">⚑ {t.tickets}</span> : <span className="muted">—</span>}</div>
                <div>{t.photos ? <span className="pill">📷 req</span> : '—'}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  </Frame>
);

// ─── V2 — Desktop kanban by status ──────────────────────────────────
const CheckoutV2 = () => {
  const cols = [
    { k: 'pending', label: 'Pending', tone: '' },
    { k: 'in-progress', label: 'In progress', tone: 'warn' },
    { k: 'blocked', label: 'Blocked / Issue', tone: 'bad' },
    { k: 'done', label: 'Done', tone: 'good' },
  ];
  return (
    <Frame title="Today's checkouts" sub="Board view">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="today" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--line-3)' }}>
            <h2>Tue 28 Apr</h2>
            <div className="muted">· 7 turnovers · 4 cleaners on shift</div>
            <div style={{ flex: 1 }}></div>
            <span className="pill solid">Board</span>
            <span className="pill">List</span>
            <span className="pill">Map</span>
          </div>
          <div style={{ flex: 1, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, minHeight: 0 }}>
            {cols.map(c => {
              const items = TURNOVERS.filter(t => t.status === c.k);
              return (
                <div key={c.k} className="kan-col">
                  <div className="kan-col-h">
                    <span><span className={'pill ' + c.tone} style={{ fontSize: 8, padding: '0 5px', marginRight: 6 }}>{items.length}</span>{c.label}</span>
                    <span className="muted">···</span>
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
                    {items.map(t => {
                      const p = propById(t.prop); const s = staffById(t.cleaner);
                      return (
                        <div key={t.id} className="kan-card">
                          <div style={{ fontWeight: 700 }}>{p.short}</div>
                          <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{p.zone}</div>
                          <div className="row" style={{ marginTop: 6, fontSize: 10 }}>
                            <span className="mono">↑{t.out}</span>
                            <span className="muted">→</span>
                            <span className="mono">↓{t.in}</span>
                            <span style={{ flex: 1 }}></span>
                            {t.tickets > 0 && <span className="pill warn" style={{ fontSize: 8, padding: '0 4px' }}>⚑{t.tickets}</span>}
                          </div>
                          <div className="row" style={{ marginTop: 6, gap: 4 }}>
                            {s ? <span className="avi sm">{s.initials}</span> : <span className="pill bad" style={{ fontSize: 8, padding: '0 4px' }}>?</span>}
                            <span style={{ fontSize: 9 }} className="muted">{s ? s.name.split(' ')[0] : 'unassigned'}</span>
                          </div>
                          {t.notes && <div className="box-fill" style={{ marginTop: 6, padding: 4, fontSize: 9 }}>{t.notes}</div>}
                        </div>
                      );
                    })}
                    <div className="box-dash" style={{ padding: 8, textAlign: 'center', fontSize: 10, color: 'var(--ink-3)' }}>
                      drop here
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Frame>
  );
};

// ─── V3 — Desktop, map + side cards (zone routing) ──────────────────
const CheckoutV3 = () => (
  <Frame title="Today's checkouts" sub="Map · routing view">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="today" />
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }} className="map">
          {/* Pins */}
          <div className="pin good" style={{ top: '25%', left: '40%' }}><span>1</span></div>
          <div className="pin warn" style={{ top: '40%', left: '55%' }}><span>2</span></div>
          <div className="pin" style={{ top: '15%', left: '50%' }}><span>3</span></div>
          <div className="pin" style={{ top: '50%', left: '30%' }}><span>4</span></div>
          <div className="pin bad" style={{ top: '60%', left: '60%' }}><span>5</span></div>
          <div className="pin" style={{ top: '70%', left: '35%' }}><span>6</span></div>
          <div className="pin" style={{ top: '20%', left: '30%' }}><span>7</span></div>
          {/* Route lines */}
          <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M40,25 L55,40 L60,60" stroke="#1a1a1a" strokeWidth="0.4" strokeDasharray="1,1" fill="none"/>
            <path d="M30,50 L35,70" stroke="#1a1a1a" strokeWidth="0.4" strokeDasharray="1,1" fill="none"/>
          </svg>
          <Note style={{ position: 'absolute', top: 12, left: 12, maxWidth: 220 }}>
            Pins colored by status. Routes auto-suggested by cleaner. Tap pin → opens card on right.
          </Note>
          <div className="box" style={{ position: 'absolute', bottom: 12, left: 12, padding: '6px 10px', fontSize: 10 }}>
            <div className="row gap-12">
              <span className="row gap-4"><span className="dot g"></span>Done</span>
              <span className="row gap-4"><span className="dot y"></span>In progress</span>
              <span className="row gap-4"><span className="dot"></span>Pending</span>
              <span className="row gap-4"><span className="dot r"></span>Blocked</span>
            </div>
          </div>
        </div>
        {/* Side panel */}
        <div style={{ width: 320, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
          <div className="section-h">
            <span>Routes · Tue 28</span>
            <span className="pill">Auto-route ⚡</span>
          </div>
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflow: 'hidden' }}>
            {[
              { c: 'Amina K.', stops: ['Marais', 'Canal'], time: '4h 30m', km: '6.2 km' },
              { c: 'Jorge M.', stops: ['Belleville', 'Latin'], time: '5h 10m', km: '9.8 km' },
              { c: 'Lin W.', stops: ['Montmartre'], time: '3h', km: '—' },
              { c: 'Diane B.', stops: ['Bastille (blocked)'], time: '—', km: '—' },
            ].map((r, i) => (
              <div key={i} className="box" style={{ padding: 8 }}>
                <div className="row">
                  <span className="avi sm">{r.c.split(' ').map(w => w[0]).join('')}</span>
                  <b>{r.c}</b>
                  <span style={{ flex: 1 }}></span>
                  <span className="mono muted" style={{ fontSize: 10 }}>{r.time} · {r.km}</span>
                </div>
                <div className="row" style={{ marginTop: 6, fontSize: 10 }}>
                  {r.stops.map((s, j) => (
                    <React.Fragment key={j}>
                      <span className="pill">{s}</span>
                      {j < r.stops.length - 1 && <span className="muted">→</span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
            <div className="box-dash" style={{ padding: 12, textAlign: 'center', fontSize: 11, color: 'var(--ink-3)' }}>
              ⚠ 1 unassigned · Pigalle 1BR · drag a cleaner to assign
            </div>
          </div>
        </div>
      </div>
    </div>
  </Frame>
);

// ─── V4 — Mobile cleaner card stack (today's stops) ─────────────────
const CheckoutV4 = () => (
  <Mobile title="Hi Amina" tab={0}>
    <div style={{ padding: '8px 14px 10px', borderBottom: '1px solid var(--line-3)' }}>
      <div className="row" style={{ fontSize: 11 }}>
        <span className="muted">Today · Tue 28 Apr</span>
        <span style={{ flex: 1 }}></span>
        <span className="pill">2 of 4 done</span>
      </div>
      {/* Progress bar */}
      <div style={{ marginTop: 8, height: 6, background: 'var(--paper-3)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line-2)' }}>
        <div style={{ width: '50%', height: '100%', background: 'var(--ink)' }}></div>
      </div>
    </div>
    <div style={{ flex: 1, overflow: 'hidden', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Current */}
      <div className="box" style={{ padding: 12, borderWidth: 2 }}>
        <div className="row">
          <span className="pill warn">◐ Now</span>
          <span style={{ flex: 1 }}></span>
          <span className="muted mono" style={{ fontSize: 10 }}>1 of 4</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>Marais 2BR</div>
        <div className="muted" style={{ fontSize: 11 }}>38 rue de Bretagne · 75003</div>
        <div className="row" style={{ marginTop: 10, gap: 12, fontSize: 11 }}>
          <span><span className="muted">Out</span> <b className="mono">11:00</b></span>
          <span><span className="muted">In</span> <b className="mono">15:00</b></span>
          <span><span className="muted">Guests</span> <b>4·5n</b></span>
        </div>
        <div className="box-fill" style={{ marginTop: 10, padding: 8, fontSize: 11 }}>
          <b>Notes:</b> Guest reported wobbly chair · check
        </div>
        <div className="row" style={{ marginTop: 8, gap: 6 }}>
          <span className="pill">📷 photos req</span>
          <span className="pill warn">⚑ 1 ticket</span>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <div className="btn full lg">↗ Directions</div>
          <div className="btn full lg solid">Open checklist →</div>
        </div>
      </div>
      {/* Up next */}
      <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 4 }}>Up next</div>
      {[TURNOVERS[3], TURNOVERS[2]].map(t => {
        const p = propById(t.prop);
        return (
          <div key={t.id} className="box-soft" style={{ padding: 10 }}>
            <div className="row">
              <b>{p.short}</b>
              <span style={{ flex: 1 }}></span>
              <Status s={t.status} />
            </div>
            <div className="row muted" style={{ fontSize: 10, marginTop: 4 }}>
              <span className="mono">↑{t.out} → ↓{t.in}</span>
              <span>· {p.zone}</span>
            </div>
          </div>
        );
      })}
    </div>
    <Note compact style={{ position: 'absolute', right: 8, top: 70, maxWidth: 110 }}>
      Big single-focus card · everything else collapsed. Reduces decision load mid-shift.
    </Note>
  </Mobile>
);

// ─── V5 — Mobile minimal timeline ───────────────────────────────────
const CheckoutV5 = () => (
  <Mobile title="Today" tab={0}>
    <div style={{ padding: '8px 14px', fontSize: 11 }} className="muted">
      Tue 28 Apr · 4 stops · 1 done
    </div>
    <div style={{ flex: 1, overflow: 'hidden', padding: '4px 0' }}>
      {[
        { time: '10:00', state: 'done', p: 'Belleville Studio', sub: 'Done · 11:42 · Jorge' },
        { time: '11:00', state: 'now', p: 'Marais 2BR', sub: 'In progress · 1 ticket open' },
        { time: '12:00', state: 'next', p: 'Canal Studio', sub: 'Out 12:00 · In 17:00 · 5h window' },
        { time: '14:30', state: 'next', p: 'Montmartre 1BR', sub: 'Out 11:00 · In 14:00 · TIGHT' },
      ].map((s, i, arr) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '54px 22px 1fr', padding: '0 14px' }}>
          <div className="mono" style={{ fontSize: 11, paddingTop: 12, color: s.state === 'done' ? 'var(--ink-3)' : 'var(--ink)' }}>{s.time}</div>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: 14, height: 14, borderRadius: 99, marginTop: 12,
              border: '2px solid var(--ink)',
              background: s.state === 'done' ? 'var(--ink)' : s.state === 'now' ? 'var(--hi)' : 'var(--paper)',
            }}></div>
            {i < arr.length - 1 && <div style={{ position: 'absolute', top: 28, bottom: -12, width: 1.5, background: 'var(--line-2)' }}></div>}
          </div>
          <div style={{ padding: '8px 0 14px' }}>
            <div className={'box-soft' + (s.state === 'now' ? ' box-hi' : '')} style={{ padding: 10, borderWidth: s.state === 'now' ? 2 : 1, borderStyle: 'solid', borderColor: 'var(--line)' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{s.p}</div>
              <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{s.sub}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
    <Note compact style={{ position: 'absolute', right: 8, top: 60, maxWidth: 110 }}>
      Pure schedule view. Time-axis is the spine. Tap any card → checklist.
    </Note>
  </Mobile>
);

Object.assign(window, { CheckoutV1, CheckoutV2, CheckoutV3, CheckoutV4, CheckoutV5 });
