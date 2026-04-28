// Ticket detail (3) · Calendar (3) · Team / Reports / Settings (3 misc)

// ─── Ticket detail V1 — full record ─────────────────────────────────
const TicketV1 = () => {
  const t = TICKETS[0]; const m = msgById(t.source); const p = propById(t.prop);
  return (
    <Frame title={'Ticket ' + t.id} sub={t.title}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="tix" />
        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
            <div className="row">
              <span className="pill ghost mono">{t.id}</span>
              <h1>{t.title}</h1>
              <Prio p={t.prio} />
              <Status s={t.status} />
              <span style={{ flex: 1 }}></span>
              <span className="btn">↗ Send WA update</span>
              <span className="btn solid">Close ticket</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
              {[
                ['Property', p.short],
                ['Type', 'Plumbing'],
                ['Tech', 'Rashid F.'],
                ['Due', 'Today 17:00'],
                ['Cost', '€— pending'],
              ].map(([l, v]) => (
                <div key={l} className="box" style={{ padding: 8 }}>
                  <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em' }}>{l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1, overflow: 'hidden' }}>
              {/* Source message */}
              <div className="box" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="section-h" style={{ fontSize: 11 }}><span>Source · WhatsApp</span><span className="pill wa">↳ {m.id}</span></div>
                <div style={{ padding: 10 }}>
                  <div className="row"><span className="avi sm">{m.avatar}</span><b style={{ fontSize: 11 }}>{m.who}</b><span style={{ flex: 1 }}></span><span className="mono muted" style={{ fontSize: 10 }}>{m.time}</span></div>
                  <div className="box-wa" style={{ marginTop: 6, padding: 8, fontSize: 11 }}>"{m.text}"</div>
                  <div className="thumb" style={{ marginTop: 6, height: 70 }}>📷 IMG_4421.jpg</div>
                  <div className="btn" style={{ marginTop: 8 }}>Open thread →</div>
                </div>
              </div>
              {/* Activity */}
              <div className="box" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="section-h" style={{ fontSize: 11 }}>Activity log</div>
                <div style={{ padding: 10, fontSize: 11 }}>
                  {[
                    ['08:42', 'WhatsApp message received', 'Sophie L.'],
                    ['08:43', 'Auto-parsed → ticket #241 created', 'AI'],
                    ['09:01', 'Auto-reply sent to guest', 'You'],
                    ['09:14', 'Assigned to Rashid F.', 'You'],
                    ['10:22', 'Tech accepted · ETA 16:30', 'Rashid F.'],
                    ['—', 'On site · awaiting', '—'],
                  ].map(([t2, a, who], i) => (
                    <div key={i} className="row" style={{ padding: '4px 0', borderBottom: '1px dashed var(--line-3)' }}>
                      <span className="mono muted" style={{ fontSize: 10, width: 44 }}>{t2}</span>
                      <span style={{ flex: 1 }}>{a}</span>
                      <span className="muted" style={{ fontSize: 10 }}>{who}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* Right rail */}
          <div style={{ width: 240, borderLeft: '1px solid var(--line)', background: 'var(--paper-2)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3>Linked checkout</h3>
            <div className="box" style={{ padding: 8, fontSize: 10 }}>
              <b>Marais 2BR</b><br/>
              <span className="muted">Out 11:00 · In 15:00</span>
              <hr/>
              <span className="pill warn">Blocks turnover ⚠</span>
            </div>
            <h3>Photos · 3</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div className="thumb" style={{ height: 50 }}>before</div>
              <div className="thumb" style={{ height: 50 }}>during</div>
              <div className="thumb" style={{ height: 50 }}>after</div>
              <div className="box-dash center" style={{ height: 50, fontSize: 10, color: 'var(--ink-3)' }}>+ add</div>
            </div>
            <h3>Cost</h3>
            <div className="box" style={{ padding: 8, fontSize: 10 }}>
              <div className="row"><span>Labour</span><span style={{ flex: 1 }}></span><span className="mono">€60</span></div>
              <div className="row"><span>Parts</span><span style={{ flex: 1 }}></span><span className="mono">€—</span></div>
              <div className="row"><span>Invoice</span><span style={{ flex: 1 }}></span><span className="pill ghost">+ upload</span></div>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
};

// ─── Ticket V2 — Kanban-style board ─────────────────────────────────
const TicketV2 = () => {
  const cols = [
    { k: 'open', l: 'Open' },
    { k: 'in-progress', l: 'In progress' },
    { k: 'waiting', l: 'Waiting parts' },
    { k: 'closed', l: 'Closed' },
  ];
  return (
    <Frame title="Tickets" sub="Board view · 23 active">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="tix" />
        <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="row">
            <h2>All tickets</h2>
            <span style={{ flex: 1 }}></span>
            <span className="pill">Type ▾</span>
            <span className="pill">Tech ▾</span>
            <span className="pill">Property ▾</span>
            <span className="btn solid">+ New ticket</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, flex: 1, overflow: 'hidden' }}>
            {cols.map(c => {
              const items = TICKETS.filter(t => t.status === c.k);
              return (
                <div key={c.k} className="kan-col">
                  <div className="kan-col-h"><span>{c.l} · {items.length}</span><span className="muted">···</span></div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
                    {items.map(t => {
                      const p = propById(t.prop);
                      return (
                        <div key={t.id} className="kan-card">
                          <div className="row"><span className="pill ghost mono" style={{ fontSize: 9 }}>{t.id}</span><Prio p={t.prio} /></div>
                          <div style={{ fontWeight: 700, marginTop: 6 }}>{t.title}</div>
                          <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{p.short} · {t.type}</div>
                          <div className="row" style={{ marginTop: 6 }}>
                            <span className="avi sm">{(staffById(t.tech) || {}).initials || '?'}</span>
                            <span style={{ flex: 1 }}></span>
                            <span className="mono muted" style={{ fontSize: 9 }}>{t.due}</span>
                          </div>
                        </div>
                      );
                    })}
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

// ─── Ticket V3 — Mobile (technician view) ───────────────────────────
const TicketV3 = () => {
  const t = TICKETS[0]; const p = propById(t.prop);
  return (
    <Mobile title={t.id} tab={1}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-3)' }}>
        <div className="row gap-6"><Prio p={t.prio} /><Status s={t.status} /></div>
        <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>{t.title}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{p.name}</div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="box-warn" style={{ padding: 10 }}>
          <b style={{ fontSize: 11 }}>⚠ Blocks turnover at 15:00</b>
          <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>Cleaner can't finish until fixed</div>
        </div>
        <div className="box" style={{ padding: 10 }}>
          <h4>From the guest</h4>
          <div className="box-wa" style={{ marginTop: 6, padding: 8, fontSize: 11 }}>"Shower is leaking onto bathroom floor when used"</div>
          <div className="thumb" style={{ marginTop: 6, height: 100 }}>📷 photo</div>
        </div>
        <div className="row" style={{ gap: 6, fontSize: 11 }}>
          <span className="btn">📞 Call</span>
          <span className="btn">↗ Map</span>
          <span className="btn">+ Photo</span>
          <span className="btn">€ Cost</span>
        </div>
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
        <div className="btn full">Need parts</div>
        <div className="btn full xl solid">✓ Mark fixed</div>
      </div>
    </Mobile>
  );
};

// ─── Calendar V1 — Week grid ────────────────────────────────────────
const CalV1 = () => {
  const days = ['Mon 27', 'Tue 28', 'Wed 29', 'Thu 30', 'Fri 1', 'Sat 2', 'Sun 3'];
  const evts = [
    { d: 0, p: 'Latin Studio', kind: 'co', t: '11→16' },
    { d: 1, p: 'Marais 2BR', kind: 'co', t: '11→15', tight: false, status: 'now' },
    { d: 1, p: 'Belleville', kind: 'co', t: '10→16', status: 'now' },
    { d: 1, p: 'Montmartre', kind: 'co', t: '11→14', tight: true },
    { d: 1, p: 'Bastille', kind: 'block', t: 'no keys' },
    { d: 2, p: 'Canal Studio', kind: 'co', t: '12→17' },
    { d: 2, p: 'Pigalle', kind: 'co', t: '09→15' },
    { d: 3, p: 'Marais 2BR · deep', kind: 'deep', t: '10→17' },
    { d: 4, p: 'Belleville', kind: 'co', t: '11→16' },
    { d: 5, p: 'Bastille', kind: 'co', t: '10→18' },
    { d: 5, p: 'Latin', kind: 'co', t: '11→15' },
    { d: 6, p: 'Montmartre', kind: 'co', t: '10→14' },
  ];
  return (
    <Frame title="Calendar" sub="Week · Apr 27 – May 3">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="cal" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="row" style={{ padding: 10, borderBottom: '1px solid var(--line-3)' }}>
            <span className="btn">‹</span><h2>Week of Apr 27</h2><span className="btn">›</span>
            <span style={{ flex: 1 }}></span>
            <span className="pill">Day</span>
            <span className="pill solid">Week</span>
            <span className="pill">Month</span>
            <span className="pill">Property ▾</span>
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', overflow: 'hidden' }}>
            {days.map((d, di) => (
              <div key={d} style={{ borderRight: di < 6 ? '1px solid var(--line-3)' : 'none', display: 'flex', flexDirection: 'column' }}>
                <div className="section-h" style={{ padding: '6px 8px', fontSize: 11, background: di === 1 ? 'var(--hi)' : 'var(--paper-2)' }}>
                  <span>{d}</span>
                  <span className="muted mono" style={{ fontSize: 10 }}>{evts.filter(e => e.d === di).length}</span>
                </div>
                <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
                  {evts.filter(e => e.d === di).map((e, i) => (
                    <div key={i} className={
                      e.kind === 'block' ? 'box-bad' :
                      e.kind === 'deep' ? 'box-info' :
                      e.tight ? 'box-warn' : 'box'
                    } style={{ padding: 6, fontSize: 10 }}>
                      <div style={{ fontWeight: 700 }}>{e.p}</div>
                      <div className="mono" style={{ fontSize: 9 }}>{e.t}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

// ─── Calendar V2 — Property × day matrix ────────────────────────────
const CalV2 = () => {
  const days = ['M 27','T 28','W 29','T 30','F 1','S 2','S 3'];
  const cell = (i, j) => {
    const k = (i * 7 + j) % 5;
    if (k === 0) return { l: 'CO', c: 'box' };
    if (k === 1) return { l: 'IN', c: 'box-soft' };
    if (k === 2) return { l: '⚑', c: 'box-warn' };
    if (k === 3) return { l: '', c: '' };
    return { l: 'C', c: 'box-good' };
  };
  return (
    <Frame title="Calendar" sub="Property × day matrix">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="cal" />
        <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          <div className="row"><h2>Apr 27 – May 3</h2><span style={{ flex: 1 }}></span><span className="pill">List</span><span className="pill solid">Matrix</span></div>
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '160px repeat(7,1fr)', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
            <div className="section-h" style={{ padding: '6px 8px', fontSize: 10, borderBottom: '1px solid var(--line)' }}>Property</div>
            {days.map(d => <div key={d} className="section-h center" style={{ padding: '6px 4px', fontSize: 10, borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line-3)' }}>{d}</div>)}
            {PROPS.map((p, i) => (
              <React.Fragment key={p.id}>
                <div style={{ padding: 6, fontSize: 11, borderBottom: '1px solid var(--line-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="dot"></span><b>{p.short}</b>
                </div>
                {days.map((_, j) => {
                  const { l, c } = cell(i, j);
                  return (
                    <div key={j} style={{ padding: 4, borderBottom: '1px solid var(--line-3)', borderLeft: '1px solid var(--line-3)', minHeight: 36 }}>
                      {l && <div className={c} style={{ padding: '3px 4px', fontSize: 9, fontWeight: 700, textAlign: 'center' }}>{l}</div>}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10, fontSize: 10, gap: 12 }}>
            <span className="row gap-4"><span className="box" style={{ width: 16, height: 12 }}></span>Checkout</span>
            <span className="row gap-4"><span className="box-soft" style={{ width: 16, height: 12 }}></span>Check-in</span>
            <span className="row gap-4"><span className="box-good" style={{ width: 16, height: 12 }}></span>Cleaned</span>
            <span className="row gap-4"><span className="box-warn" style={{ width: 16, height: 12 }}></span>Ticket open</span>
          </div>
        </div>
      </div>
    </Frame>
  );
};

// ─── Calendar V3 — Cleaner timeline (Gantt) ─────────────────────────
const CalV3 = () => {
  const hours = ['8','9','10','11','12','13','14','15','16','17','18'];
  const blocks = [
    { s: 1, e: 0, c: 'S1', label: 'Marais', kind: 'co' },
    { s: 0, e: 0, c: 'S2', label: 'Belleville', kind: 'co' },
    { s: 1, e: 0, c: 'S3', label: 'Montmartre · TIGHT', kind: 'tight' },
    { s: 2, e: 0, c: 'S1', label: 'Canal', kind: 'co' },
    { s: 0, e: 0, c: 'S4', label: 'Bastille · BLOCKED', kind: 'block' },
  ];
  // hand-picked positions
  const placement = [
    { row: 0, l: 11, w: 4, label: 'Marais', kind: 'co' },
    { row: 1, l: 10, w: 5, label: 'Belleville', kind: 'co' },
    { row: 1, l: 16, w: 2, label: 'Latin', kind: 'co' },
    { row: 2, l: 11, w: 3, label: 'Montmartre TIGHT', kind: 'tight' },
    { row: 3, l: 10, w: 6, label: 'Bastille — BLOCKED', kind: 'block' },
    { row: 0, l: 16, w: 2, label: 'Canal', kind: 'co' },
  ];
  const cols = STAFF.slice(0, 4);
  return (
    <Frame title="Calendar" sub="Today · cleaner timeline">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="cal" />
        <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="row"><h2>Tue 28 Apr · Cleaner timeline</h2><span style={{ flex: 1 }}></span><span className="pill solid">Today</span></div>
          <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 4, display: 'grid', gridTemplateColumns: '120px 1fr', overflow: 'hidden' }}>
            {/* hours header */}
            <div className="section-h" style={{ padding: '4px 8px', fontSize: 10 }}>Cleaner</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${hours.length}, 1fr)`, borderLeft: '1px solid var(--line)' }}>
              {hours.map(h => <div key={h} className="section-h" style={{ padding: '4px 0', fontSize: 9, textAlign: 'center', borderRight: '1px solid var(--line-3)' }}>{h}</div>)}
            </div>
            {cols.map((c, ri) => (
              <React.Fragment key={c.id}>
                <div style={{ padding: '10px 8px', fontSize: 11, borderTop: '1px solid var(--line-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="avi sm">{c.initials}</span><span>{c.name}</span>
                </div>
                <div style={{ position: 'relative', borderTop: '1px solid var(--line-3)', borderLeft: '1px solid var(--line)', height: 40, background: 'repeating-linear-gradient(90deg, transparent 0, transparent calc((100%/11) - 1px), var(--line-3) calc((100%/11) - 1px), var(--line-3) calc(100%/11))' }}>
                  {placement.filter(b => b.row === ri).map((b, i) => (
                    <div key={i} className={b.kind === 'block' ? 'box-bad' : b.kind === 'tight' ? 'box-warn' : 'box-fill'} style={{
                      position: 'absolute',
                      left: `${((b.l - 8) / 11) * 100}%`,
                      width: `${(b.w / 11) * 100}%`,
                      top: 4, bottom: 4,
                      padding: '0 6px',
                      display: 'flex', alignItems: 'center',
                      fontSize: 10, fontWeight: 600,
                    }}>
                      {b.label}
                    </div>
                  ))}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  );
};

// ─── Team / Staff ───────────────────────────────────────────────────
const TeamV1 = () => (
  <Frame title="Staff" sub="5 active · Tue 28 Apr">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="staff" />
      <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div className="row"><h2>Team</h2><span style={{ flex: 1 }}></span><span className="btn solid">+ Add member</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {STAFF.map(s => (
            <div key={s.id} className="box" style={{ padding: 12 }}>
              <div className="row"><span className="avi lg">{s.initials}</span>
                <div style={{ flex: 1 }}>
                  <b>{s.name}</b>
                  <div className="muted" style={{ fontSize: 10 }}>{s.role}</div>
                </div>
                <span className="dot g" title="online"></span>
              </div>
              <hr/>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, fontSize: 10 }}>
                <div><div className="muted" style={{ fontSize: 9 }}>Today</div><b>2 stops</b></div>
                <div><div className="muted" style={{ fontSize: 9 }}>This week</div><b>14 stops</b></div>
                <div><div className="muted" style={{ fontSize: 9 }}>Avg time</div><b>1h 42m</b></div>
              </div>
              <hr/>
              <div className="row" style={{ fontSize: 10 }}>
                <span className="muted">WhatsApp</span><span style={{ flex: 1 }}></span><span className="pill wa">linked</span>
              </div>
              <div className="row" style={{ fontSize: 10, marginTop: 4 }}>
                <span className="muted">Zones</span><span style={{ flex: 1 }}></span>
                <span className="pill ghost">Paris 03</span>
                <span className="pill ghost">Paris 11</span>
              </div>
            </div>
          ))}
          <div className="box-dash center" style={{ minHeight: 160, color: 'var(--ink-3)' }}>+ Add member</div>
        </div>
      </div>
    </div>
  </Frame>
);

// ─── Reports ────────────────────────────────────────────────────────
const Reports = () => (
  <Frame title="Reports" sub="Apr 1 – Apr 28">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="reports" />
      <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div className="row"><h2>Operations report</h2><span className="muted">· April 2026</span><span style={{ flex: 1 }}></span><span className="pill">Date range ▾</span><span className="btn">⇣ Export CSV</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {[
            ['Turnovers', '142', '+12%'],
            ['On-time rate', '94%', '+2pp'],
            ['Avg clean time', '1h 38m', '−6m'],
            ['Tickets opened', '38', '+4'],
          ].map(([l, v, d]) => (
            <div key={l} className="box" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{l}</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{v}</div>
              <div className="muted" style={{ fontSize: 10 }}>vs prev · {d}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, flex: 1, minHeight: 0 }}>
          <div className="box" style={{ padding: 12, display: 'flex', flexDirection: 'column' }}>
            <h3>Turnovers per day</h3>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 4, marginTop: 10 }}>
              {[3,4,2,5,6,7,4,3,5,5,6,4,3,4,7,8,5,4,3,5,6,5,4,3,6,7,5,7].map((h, i) => (
                <div key={i} style={{ flex: 1, height: `${h * 11}%`, background: i === 27 ? 'var(--ink)' : 'var(--paper-3)', border: '1px solid var(--line-2)' }}></div>
              ))}
            </div>
            <div className="row mono muted" style={{ fontSize: 9, marginTop: 4 }}><span>Apr 1</span><span style={{ flex: 1 }}></span><span>Apr 28</span></div>
          </div>
          <div className="box" style={{ padding: 12 }}>
            <h3>Tickets by type</h3>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[['Plumbing', 12, 'bad'],['Appliance', 9, 'warn'],['Electrical', 7, 'info'],['Lock/door', 4, 'hi'],['General', 6, '']].map(([l, n, c], i) => (
                <div key={i}>
                  <div className="row" style={{ fontSize: 10 }}><span>{l}</span><span style={{ flex: 1 }}></span><b>{n}</b></div>
                  <div style={{ height: 6, background: 'var(--paper-3)', border: '1px solid var(--line-2)', borderRadius: 3, marginTop: 2 }}>
                    <div className={'box-' + (c || 'fill')} style={{ height: '100%', width: `${(n / 12) * 100}%`, borderRadius: 0, border: 'none' }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </Frame>
);

// ─── Settings ───────────────────────────────────────────────────────
const Settings = () => (
  <Frame title="Settings" sub="Integrations">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="set" />
      <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, overflow: 'hidden' }}>
        <h2>Integrations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          {/* Hostaway */}
          <div className="box" style={{ padding: 14 }}>
            <div className="row"><div className="thumb" style={{ width: 40, height: 40 }}>HA</div>
              <div style={{ flex: 1 }}><b>Hostaway</b><div className="muted" style={{ fontSize: 10 }}>PMS · bookings, properties, calendars</div></div>
              <span className="pill good">● Connected</span>
            </div>
            <hr/>
            <div className="row" style={{ fontSize: 11 }}><span className="muted">Account</span><span style={{ flex: 1 }}></span><span>ops@hkplanner.fr</span></div>
            <div className="row" style={{ fontSize: 11, marginTop: 4 }}><span className="muted">Last sync</span><span style={{ flex: 1 }}></span><span className="mono">2 min ago</span></div>
            <div className="row" style={{ fontSize: 11, marginTop: 4 }}><span className="muted">Properties</span><span style={{ flex: 1 }}></span><b>47 imported</b></div>
            <div className="row" style={{ marginTop: 10, gap: 6 }}><span className="btn">Sync now</span><span className="btn">Field mapping</span><span className="btn">Disconnect</span></div>
          </div>
          {/* Green API */}
          <div className="box" style={{ padding: 14 }}>
            <div className="row"><div className="thumb" style={{ width: 40, height: 40 }}>WA</div>
              <div style={{ flex: 1 }}><b>WhatsApp · Green API</b><div className="muted" style={{ fontSize: 10 }}>Inbound messaging · ticket parsing</div></div>
              <span className="pill wa">● Connected</span>
            </div>
            <hr/>
            <div className="row" style={{ fontSize: 11 }}><span className="muted">Instance ID</span><span style={{ flex: 1 }}></span><span className="mono">7103•••421</span></div>
            <div className="row" style={{ fontSize: 11, marginTop: 4 }}><span className="muted">Number</span><span style={{ flex: 1 }}></span><span className="mono">+33 6 ••• ••• 12</span></div>
            <div className="row" style={{ fontSize: 11, marginTop: 4 }}><span className="muted">Watching</span><span style={{ flex: 1 }}></span><b>3 chats / 2 groups</b></div>
            <hr/>
            <h4>Watched conversations</h4>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {['#ops-paris (group)', 'Guest replies (auto)', 'Cleaners group'].map(c => (
                <div key={c} className="row" style={{ fontSize: 10 }}>
                  <span className="checkbox on"></span>
                  <span style={{ flex: 1 }}>{c}</span>
                  <span className="pill" style={{ fontSize: 9 }}>edit</span>
                </div>
              ))}
              <div className="row" style={{ fontSize: 10, color: 'var(--ink-3)' }}><span className="pill ghost">+ Add chat to watch</span></div>
            </div>
          </div>
          {/* AI parsing rules */}
          <div className="box" style={{ padding: 14, gridColumn: 'span 2' }}>
            <h3>AI parsing rules</h3>
            <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>How incoming messages become tickets</div>
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {[
                ['Match property by', 'Sender phone → guest record · Cleaner mention · Address'],
                ['Issue type vocab', 'leak/eau, cassé, ne marche pas, électricité, chauffage…'],
                ['Auto-priority', 'Urgent: locked out, no water/heat · High: leaks · Med: appliance · Low: supplies'],
                ['Auto-assign tech', 'Plumbing → Rashid · Electrical → Rashid · Other → leave open'],
                ['Auto-reply guests', 'On (template editable)'],
                ['Confidence threshold', '0.78 — below = sent to triage queue'],
              ].map(([l, v]) => (
                <div key={l} className="box-fill" style={{ padding: 8 }}>
                  <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>{l}</div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </Frame>
);

Object.assign(window, { TicketV1, TicketV2, TicketV3, CalV1, CalV2, CalV3, TeamV1, Reports, Settings });
