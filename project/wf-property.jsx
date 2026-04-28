// Property detail / cleaning checklist — 5 variations
// V1 desktop split: checklist + property meta · V2 desktop dense single page
// V3 mobile checklist (cleaner field) · V4 mobile photo-first
// V5 mobile single-focus step-by-step

const CL_TOTAL = CHECKLIST.reduce((n, g) => n + g.items.length, 0);
const CL_DONE  = CHECKLIST.reduce((n, g) => n + g.items.filter(i => i.done).length, 0);

// ─── V1 — Desktop split ─────────────────────────────────────────────
const PropertyV1 = () => (
  <Frame title="Marais 2BR" sub="Checklist · Tue 28 Apr">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="props" />
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        {/* Main checklist */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--line-3)' }}>
            <div className="row">
              <h1>Marais 2BR · rue de Bretagne</h1>
              <Status s="in-progress" />
              <span style={{ flex: 1 }}></span>
              <span className="btn">⚑ Open ticket</span>
              <span className="btn solid">Mark complete</span>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              38 rue de Bretagne, 75003 · Out 11:00 → In 15:00 · 4 guests · 5 nights
            </div>
            <div style={{ marginTop: 10, height: 8, background: 'var(--paper-3)', borderRadius: 4, border: '1px solid var(--line-2)', overflow: 'hidden' }}>
              <div style={{ width: `${(CL_DONE / CL_TOTAL) * 100}%`, height: '100%', background: 'var(--ink)' }}></div>
            </div>
            <div className="muted mono" style={{ fontSize: 10, marginTop: 4 }}>{CL_DONE} of {CL_TOTAL} tasks · est. 38 min remaining</div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {CHECKLIST.slice(0, 3).map(g => (
              <div key={g.g} className="box">
                <div className="section-h" style={{ padding: '6px 10px', fontSize: 11 }}>
                  <span>{g.g}</span>
                  <span className="muted mono" style={{ fontSize: 10 }}>{g.items.filter(i => i.done).length}/{g.items.length}</span>
                </div>
                {g.items.map((i, k) => (
                  <div key={k} className="row" style={{ padding: '6px 10px', borderTop: k ? '1px solid var(--line-3)' : 'none' }}>
                    <span className={'checkbox' + (i.done ? ' on' : '')}></span>
                    <span style={{ flex: 1, textDecoration: i.done ? 'line-through' : 'none', color: i.done ? 'var(--ink-3)' : 'var(--ink)' }}>{i.t}</span>
                    {i.photo && <span className="pill">📷 photo</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* Meta sidebar */}
        <div style={{ width: 260, borderLeft: '1px solid var(--line)', background: 'var(--paper-2)', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <h3>Booking</h3>
            <div className="box" style={{ padding: 8, marginTop: 6, fontSize: 11 }}>
              <div className="row"><span className="muted">Source</span><span style={{ flex: 1 }}></span><b>Hostaway · Airbnb</b></div>
              <div className="row" style={{ marginTop: 4 }}><span className="muted">Guest</span><span style={{ flex: 1 }}></span><b>Sophie L. (4)</b></div>
              <div className="row" style={{ marginTop: 4 }}><span className="muted">Stay</span><span style={{ flex: 1 }}></span><b>Apr 23 → 28</b></div>
              <div className="row" style={{ marginTop: 4 }}><span className="muted">Next in</span><span style={{ flex: 1 }}></span><b>Apr 28 · 15:00</b></div>
            </div>
          </div>
          <div>
            <h3>Linen & Supplies</h3>
            <div className="box" style={{ padding: 8, marginTop: 6, fontSize: 11 }}>
              {['4× Bed (Queen)', '8× Bath towel', '4× Hand towel', '2× Bath mat', 'Coffee, tea, sugar'].map(s => (
                <div key={s} className="row" style={{ padding: '2px 0' }}><span className="checkbox"></span>{s}</div>
              ))}
            </div>
          </div>
          <div>
            <h3>Open Tickets · 1</h3>
            <div className="box-warn" style={{ padding: 8, marginTop: 6, fontSize: 11 }}>
              <div className="row"><b>#241 Shower leaking</b><span style={{ flex: 1 }}></span><Prio p="high" /></div>
              <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>Tech: Rashid F. · Due 17:00</div>
            </div>
          </div>
          <div>
            <h3>Property notes</h3>
            <div className="box-fill" style={{ padding: 8, marginTop: 6, fontSize: 10 }}>
              Code: 4421 · Boiler is in cupboard left of fridge. Coffee machine = Nespresso. Wifi: ENJ-marais.
            </div>
          </div>
        </div>
      </div>
    </div>
  </Frame>
);

// ─── V2 — Desktop dense single page ─────────────────────────────────
const PropertyV2 = () => (
  <Frame title="Marais 2BR" sub="Single-page · packed">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="props" />
      <div style={{ flex: 1, padding: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row">
          <h1>Marais 2BR</h1>
          <span className="pill">P1</span>
          <span className="muted">38 rue de Bretagne, 75003 · Paris 03</span>
          <span style={{ flex: 1 }}></span>
          <span className="mono muted" style={{ fontSize: 10 }}>{CL_DONE}/{CL_TOTAL} · 38m remaining</span>
          <span className="btn">⚑ Ticket</span>
          <span className="btn solid">Complete</span>
        </div>
        {/* Strip cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {[
            ['Out → In', '11:00 → 15:00'],
            ['Guests', '4 · 5 nights'],
            ['Cleaner', 'Amina K.'],
            ['Tickets', '1 open'],
          ].map(([l, v]) => (
            <div key={l} className="box" style={{ padding: 8 }}>
              <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em' }}>{l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
        {/* All groups in grid */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, overflow: 'hidden' }}>
          {CHECKLIST.map(g => (
            <div key={g.g} className="box" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="section-h" style={{ padding: '5px 8px', fontSize: 10 }}>
                <span>{g.g}</span>
                <span className="muted mono" style={{ fontSize: 9 }}>{g.items.filter(i => i.done).length}/{g.items.length}</span>
              </div>
              <div style={{ padding: '4px 0' }}>
                {g.items.map((i, k) => (
                  <div key={k} className="row" style={{ padding: '3px 8px', fontSize: 10.5 }}>
                    <span className={'checkbox' + (i.done ? ' on' : '')} style={{ width: 12, height: 12 }}></span>
                    <span style={{ flex: 1, textDecoration: i.done ? 'line-through' : 'none', color: i.done ? 'var(--ink-3)' : 'var(--ink)' }}>{i.t}</span>
                    {i.photo && <span style={{ fontSize: 11 }}>📷</span>}
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

// ─── V3 — Mobile checklist ──────────────────────────────────────────
const PropertyV3 = () => (
  <Mobile title="Marais 2BR" tab={0}>
    <div style={{ padding: '6px 14px 10px', borderBottom: '1px solid var(--line-3)' }}>
      <div className="muted" style={{ fontSize: 10 }}>38 rue de Bretagne · Out 11:00 → In 15:00</div>
      <div style={{ marginTop: 8, height: 6, background: 'var(--paper-3)', borderRadius: 4, border: '1px solid var(--line-2)' }}>
        <div style={{ width: `${(CL_DONE / CL_TOTAL) * 100}%`, height: '100%', background: 'var(--ink)' }}></div>
      </div>
      <div className="row mono" style={{ fontSize: 10, marginTop: 4 }}>
        <span>{CL_DONE} / {CL_TOTAL} done</span>
        <span style={{ flex: 1 }}></span>
        <span className="muted">est. 38m</span>
      </div>
    </div>
    <div style={{ flex: 1, overflow: 'hidden' }}>
      {CHECKLIST.slice(0, 4).map(g => (
        <div key={g.g}>
          <div style={{ padding: '6px 14px', background: 'var(--paper-2)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', display: 'flex', justifyContent: 'space-between' }}>
            <span>{g.g}</span>
            <span className="muted mono">{g.items.filter(i => i.done).length}/{g.items.length}</span>
          </div>
          {g.items.map((i, k) => (
            <div key={k} className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-3)', gap: 10 }}>
              <span className={'checkbox' + (i.done ? ' on' : '')} style={{ width: 18, height: 18 }}></span>
              <span style={{ flex: 1, fontSize: 12, textDecoration: i.done ? 'line-through' : 'none', color: i.done ? 'var(--ink-3)' : 'var(--ink)' }}>{i.t}</span>
              {i.photo && <span className="pill">📷</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
    <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
      <div className="btn full xl solid">Mark all & Finish →</div>
    </div>
  </Mobile>
);

// ─── V4 — Mobile photo-first ────────────────────────────────────────
const PropertyV4 = () => (
  <Mobile title="Photos · Marais" tab={0}>
    <div style={{ padding: '6px 14px 10px', borderBottom: '1px solid var(--line-3)' }}>
      <div className="row">
        <span className="pill solid">Photos</span>
        <span className="pill">Tasks</span>
        <span className="pill">Notes</span>
      </div>
      <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>3 of 8 captured · 5 required before completion</div>
    </div>
    <div style={{ flex: 1, overflow: 'hidden', padding: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { l: 'Kitchen wide', done: true },
          { l: 'Hob & sink', done: true },
          { l: 'Living room', done: true },
          { l: 'Bedroom 1', done: false, req: true },
          { l: 'Bedroom 2', done: false, req: true },
          { l: 'Bathroom', done: false, req: true },
          { l: 'Shower glass', done: false },
          { l: 'Lockbox final', done: false, req: true },
        ].map((p, i) => (
          <div key={i} className="thumb" style={{ aspectRatio: '4/3', position: 'relative', borderColor: p.req ? 'var(--ink)' : 'var(--line-2)' }}>
            {p.done ? (
              <span style={{ position: 'absolute', inset: 0, background: 'var(--paper-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: 'var(--ink-2)' }}>✓ photo</span>
            ) : (
              <span style={{ fontSize: 10 }}>+ {p.l}</span>
            )}
            {!p.done && p.req && <span className="pill bad" style={{ position: 'absolute', top: 4, right: 4, fontSize: 8, padding: '0 4px' }}>req</span>}
            {p.done && <span className="pill good" style={{ position: 'absolute', top: 4, right: 4, fontSize: 8, padding: '0 4px' }}>✓</span>}
            <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, fontWeight: 600, background: 'var(--paper)', padding: '0 4px', borderRadius: 2 }}>{p.l}</span>
          </div>
        ))}
      </div>
    </div>
    <div style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
      <div className="btn full xl solid">📷 Capture next required</div>
    </div>
    <Note compact style={{ position: 'absolute', right: 8, top: 70, maxWidth: 110 }}>
      Photo-grid as primary affordance · checklist secondary.
    </Note>
  </Mobile>
);

// ─── V5 — Mobile step-by-step single focus ──────────────────────────
const PropertyV5 = () => (
  <Mobile title="Marais 2BR" tab={0}>
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-3)', display: 'flex', justifyContent: 'space-between' }}>
      <span className="mono" style={{ fontSize: 10 }}>STEP 7 OF 18 · BATHROOM</span>
      <span className="mono muted" style={{ fontSize: 10 }}>~25m left</span>
    </div>
    {/* Progress dots */}
    <div style={{ padding: '8px 14px', display: 'flex', gap: 3 }}>
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} style={{
          flex: 1, height: 4, borderRadius: 2,
          background: i < 6 ? 'var(--ink)' : i === 6 ? 'var(--hi)' : 'var(--paper-3)',
          border: '1px solid ' + (i <= 6 ? 'var(--ink)' : 'var(--line-2)'),
        }}></div>
      ))}
    </div>
    <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Now</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, lineHeight: 1.2 }}>Disinfect WC, sink & shower</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Use the green bottle (eco-cert). 30s contact time before wiping.</div>
      </div>
      <div className="thumb" style={{ height: 120 }}>reference photo</div>
      <div className="box-fill" style={{ padding: 10, fontSize: 11 }}>
        <b>Heads up:</b> last cleaner reported the shower drain is slow — flag a ticket if it doesn't drain.
      </div>
      <div style={{ flex: 1 }}></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="btn full lg">Skip</div>
        <div className="btn full xl solid">✓ Done · Next</div>
      </div>
      <div className="row center" style={{ gap: 12, fontSize: 10 }}>
        <span className="muted">📷 attach photo</span>
        <span className="muted">⚑ flag issue</span>
        <span className="muted">↺ undo</span>
      </div>
    </div>
    <Note compact style={{ position: 'absolute', right: 8, top: 65, maxWidth: 110 }}>
      One task at a time. Minimizes choice. Big tap targets for hands-busy work.
    </Note>
  </Mobile>
);

Object.assign(window, { PropertyV1, PropertyV2, PropertyV3, PropertyV4, PropertyV5 });
