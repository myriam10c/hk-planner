// Property detail / cleaning checklist page (manager + cleaner mobile)

const PropertyPage = () => {
  const { route, turnovers, checklist, toggleChecklistItem, capturePhoto, tickets, role, goto, showToast } = useStore();
  const tid = route.tid || 'T1';
  const t = turnovers.find(x => x.id === tid) || turnovers[0];
  const p = propById(t.prop);
  const total = checklist.reduce((n, g) => n + g.items.length, 0);
  const done = checklist.reduce((n, g) => n + g.items.filter(i => i.done).length, 0);
  const pct = (done / total) * 100;
  const propTickets = tickets.filter(x => x.prop === p.id && x.status !== 'closed');

  if (role === 'cleaner') return <CleanerProperty t={t} p={p} pct={pct} done={done} total={total} />;

  return (
    <div className="content">
      <Topbar crumbs={[
        { label: "Today's checkouts", onClick: () => goto('today') },
        { label: p.full },
      ]} />
      <div className="page">
        <div className="page-h">
          <div>
            <h1>{p.full}</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{p.addr} · {p.zone}</div>
          </div>
          <div className="right">
            <button className="btn"><Icon name="flag" size={14} />Open ticket</button>
            <button className="btn primary" onClick={() => { showToast('Marked complete'); goto('today'); }}><Icon name="check" size={14} />Mark complete</button>
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi"><div className="l">Out → In</div><div className="v mono tnum">{t.out} → {t.in}</div><div className="delta">{t.in === '—' ? 'no checkin today' : ((parseInt(t.in) - parseInt(t.out)) + 'h window')}</div></div>
          <div className="kpi"><div className="l">Guests</div><div className="v tnum">{t.guests}</div><div className="delta">{t.nights} nights</div></div>
          <div className="kpi"><div className="l">Cleaner</div><div className="v" style={{ fontSize: 16 }}>{staffById(t.cleaner)?.name || '—'}</div><div className="delta">arrived 09:48</div></div>
          <div className="kpi"><div className="l">Status</div><div style={{ marginTop: 4 }}><Status s={t.status} /></div></div>
        </div>

        <div className="split">
          {/* Checklist */}
          <div className="card">
            <div className="card-h">
              <Icon name="list" size={16} />
              <h3>Cleaning checklist</h3>
              <div className="right">
                <span className="muted mono" style={{ fontSize: 11 }}>{done} / {total}</span>
                <span className="pill brand">~38m left</span>
              </div>
            </div>
            <div style={{ padding: '0 14px' }}>
              <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 99, margin: '12px 0', overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: 'var(--brand)', borderRadius: 99, transition: 'width .2s' }}></div>
              </div>
            </div>
            <div style={{ padding: '0 14px 14px' }}>
              {checklist.map((g, gi) => (
                <div key={g.g} style={{ marginTop: gi === 0 ? 0 : 14 }}>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-3)' }}>{g.g}</h3>
                    <span style={{ flex: 1 }}></span>
                    <span className="muted mono" style={{ fontSize: 10 }}>{g.items.filter(i => i.done).length}/{g.items.length}</span>
                  </div>
                  <div className="col gap-4">
                    {g.items.map((it, ii) => (
                      <div key={ii} className="row gap-8" style={{ padding: '8px 10px', borderRadius: 8, background: it.done ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}
                           onClick={() => toggleChecklistItem(gi, ii)}>
                        <span className={'check' + (it.done ? ' on' : '')}></span>
                        <span className="grow" style={{ fontSize: 13, textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--ink-3)' : 'var(--ink)' }}>{it.t}</span>
                        {it.photo && !it.captured && (
                          <button className="btn sm" onClick={(e) => { e.stopPropagation(); capturePhoto(gi, ii); }}>
                            <Icon name="cam" size={11} />Capture
                          </button>
                        )}
                        {it.photo && it.captured && (
                          <span className="pill good" style={{ fontSize: 10 }}><Icon name="check" size={10} />photo</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right rail */}
          <div className="col gap-12">
            <div className="card">
              <div className="card-h"><Icon name="paper" size={14} /><h3>Booking</h3></div>
              <div style={{ padding: 12, fontSize: 12 }}>
                <div className="row"><span className="muted">Source</span><span style={{ flex: 1 }}></span><b>Hostaway · Airbnb</b></div>
                <div className="row" style={{ marginTop: 6 }}><span className="muted">Guest</span><span style={{ flex: 1 }}></span><b>Sophie L.</b></div>
                <div className="row" style={{ marginTop: 6 }}><span className="muted">Stay</span><span style={{ flex: 1 }}></span><b>Apr 23 → 28</b></div>
                <div className="row" style={{ marginTop: 6 }}><span className="muted">Next in</span><span style={{ flex: 1 }}></span><b className="mono">{t.in}</b></div>
              </div>
            </div>

            {propTickets.length > 0 && (
              <div className="card">
                <div className="card-h"><Icon name="wrench" size={14} /><h3>Open tickets · {propTickets.length}</h3></div>
                <div style={{ padding: 12 }}>
                  {propTickets.map(tk => (
                    <div key={tk.id} className="card" style={{ padding: 10, background: 'var(--warn-soft)', borderColor: 'transparent', cursor: 'pointer' }}
                         onClick={() => goto('ticket', { id: tk.id })}>
                      <div className="row"><b style={{ fontSize: 12 }}>#{tk.id} {tk.title}</b><span style={{ flex: 1 }}></span><Prio p={tk.prio} compact /></div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>Tech: {staffById(tk.tech)?.name || '—'} · Due {tk.due}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-h"><Icon name="box" size={14} /><h3>Linen & supplies</h3></div>
              <div style={{ padding: 12, fontSize: 12 }} className="col gap-6">
                {['4× Bed sheets (Queen)', '8× Bath towels', '4× Hand towels', '2× Bath mats', 'Coffee, tea, sugar pods'].map(s => (
                  <div key={s} className="row gap-8"><span className="check" style={{ width: 14, height: 14 }}></span>{s}</div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-h"><Icon name="key" size={14} /><h3>Property notes</h3></div>
              <div style={{ padding: 12, fontSize: 12, lineHeight: 1.6 }}>
                Door code <b className="mono">{p.code}</b> · WiFi <b className="mono">{p.wifi}</b><br/>
                {p.notes || <span className="muted">No notes yet.</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CleanerProperty = ({ t, p, pct, done, total }) => {
  const { checklist, toggleChecklistItem, capturePhoto, goto, showToast } = useStore();
  const [damageOpen, setDamageOpen] = React.useState(false);
  return (
    <div className="content" style={{ display: 'flex', justifyContent: 'center', background: 'var(--surface-3)' }}>
      <div className="mob-shell">
        <div className="mob-screen">
          <div className="mob-notch"></div>
          <div className="mob-status"><span className="mono">9:41</span><span className="row gap-4"><Icon name="wifi" size={11} /><span className="mono">100</span></span></div>
          <div className="mob-content">
            <div style={{ padding: '8px 18px 0' }}>
              <button className="btn ghost sm" onClick={() => goto('today')}><Icon name="chevL" size={14} />Back</button>
            </div>
            <div className="mob-h">
              <div>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>{p.zone}</div>
                <h2 style={{ fontSize: 19 }}>{p.full}</h2>
              </div>
            </div>
            <div style={{ padding: '0 18px 14px' }}>
              <div className="row" style={{ fontSize: 11 }}>
                <span className="mono"><b>{done}</b> / {total}</span>
                <span style={{ flex: 1 }}></span>
                <span className="muted">~38m left</span>
              </div>
              <div style={{ marginTop: 6, height: 8, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: 'var(--brand)', transition: 'width .2s' }}></div>
              </div>
            </div>
            {checklist.map((g, gi) => (
              <div key={g.g}>
                <div style={{ padding: '10px 18px 6px', background: 'var(--surface-2)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-3)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{g.g}</span>
                  <span className="mono">{g.items.filter(i => i.done).length}/{g.items.length}</span>
                </div>
                {g.items.map((it, ii) => (
                  <div key={ii} className="row gap-12" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                       onClick={() => toggleChecklistItem(gi, ii)}>
                    <span className={'check lg' + (it.done ? ' on' : '')}></span>
                    <span className="grow" style={{ fontSize: 13.5, textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--ink-3)' : 'var(--ink)' }}>{it.t}</span>
                    {it.photo && !it.captured && (
                      <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); capturePhoto(gi, ii); }}>
                        <Icon name="cam" size={12} />
                      </button>
                    )}
                    {it.photo && it.captured && (
                      <Icon name="check" size={16} style={{ color: 'var(--good)' }} />
                    )}
                  </div>
                ))}
              </div>
            ))}
            <div style={{ padding: '14px 18px 4px' }}>
              <div onClick={() => setDamageOpen(true)} className="card" style={{ padding: 14, background: 'var(--warn-soft)', borderColor: 'var(--warn)', borderStyle: 'dashed', cursor: 'pointer' }}>
                <div className="row gap-10">
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--warn)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="bolt" size={16} />
                  </div>
                  <div className="grow">
                    <b style={{ fontSize: 13 }}>Report damage or missing item</b>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Snap a photo — manager reviews + bills guest deposit if needed.</div>
                  </div>
                  <Icon name="chevR" size={14} style={{ color: 'var(--ink-3)' }} />
                </div>
              </div>
            </div>
            <div style={{ padding: 18 }}>
              <button className="btn full xl primary" onClick={() => { showToast('Submitted to manager'); goto('today'); }}>
                <Icon name="check" size={16} />Finish & submit
              </button>
            </div>
          </div>
          <div className="mob-tabs">
            {[
              ['home', 'Today', true],
              ['msg', 'Tickets'],
              ['cal', 'Schedule'],
              ['user', 'Me'],
            ].map(([i, l, on]) => (
              <div key={l} className={'mob-tab' + (on ? ' active' : '')}>
                <Icon name={i} size={20} />
                <span>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {damageOpen && <DamageModal property={p} turnoverId={t.id} onClose={() => setDamageOpen(false)} />}
    </div>
  );
};

const DAMAGE_PRESETS = [
  { id: 'glass', label: 'Glassware / mug broken', cost: 8, type: 'general' },
  { id: 'sheet', label: 'Bed linen stained', cost: 35, type: 'general' },
  { id: 'towel', label: 'Towel stained / missing', cost: 18, type: 'general' },
  { id: 'wall', label: 'Wall scuff or hole', cost: 80, type: 'general' },
  { id: 'remote', label: 'TV/AC remote missing', cost: 25, type: 'general' },
  { id: 'appliance', label: 'Appliance damage', cost: 120, type: 'appliance' },
  { id: 'furniture', label: 'Furniture damage', cost: 150, type: 'general' },
  { id: 'other', label: 'Other', cost: 0, type: 'general' },
];

const DamageModal = ({ property, turnoverId, onClose }) => {
  const { showToast } = useStore();
  const [step, setStep] = React.useState(1); // 1=type, 2=details, 3=review
  const [preset, setPreset] = React.useState(null);
  const [cost, setCost] = React.useState(0);
  const [note, setNote] = React.useState('');
  const [photo, setPhoto] = React.useState(false);
  const [bill, setBill] = React.useState('guest');

  const submit = () => {
    showToast(`Damage reported · ticket created · €${cost} draft charge`);
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,14,.55)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} className="card pop"
           style={{ width: 380, maxWidth: '94vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: '16px 16px 0 0', marginBottom: 0 }}>
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <Icon name="bolt" size={14} style={{ color: 'var(--warn)' }} />
          <b style={{ marginLeft: 8, fontSize: 14 }}>
            {step === 1 && 'What happened?'}
            {step === 2 && 'Add details'}
            {step === 3 && 'Review & submit'}
          </b>
          <span style={{ flex: 1 }}></span>
          <span className="muted mono" style={{ fontSize: 10 }}>{step}/3</span>
          <button className="btn ghost sm" onClick={onClose} style={{ marginLeft: 6 }}><Icon name="x" size={14} /></button>
        </div>

        {/* Step 1 — pick a type */}
        {step === 1 && (
          <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>{property.full}</div>
            <div className="col gap-6">
              {DAMAGE_PRESETS.map(d => (
                <div key={d.id} className="row gap-10" style={{ padding: 12, borderRadius: 8, border: '1px solid ' + (preset?.id === d.id ? 'var(--ink)' : 'var(--line)'), background: preset?.id === d.id ? 'var(--brand-soft)' : 'transparent', cursor: 'pointer' }}
                     onClick={() => { setPreset(d); setCost(d.cost); }}>
                  <span className="grow" style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</span>
                  {d.cost > 0 && <span className="mono tnum muted" style={{ fontSize: 11 }}>~€{d.cost}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — photo + cost + note */}
        {step === 2 && (
          <div style={{ padding: 16, overflow: 'auto', flex: 1 }} className="col gap-12">
            <div>
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Photo evidence (required)</div>
              <div onClick={() => setPhoto(true)} className="placeholder"
                   style={{ height: 140, cursor: 'pointer', background: photo ? 'var(--good-soft)' : undefined, borderColor: photo ? 'var(--good)' : undefined }}>
                {photo ? (<><Icon name="check" size={20} style={{ color: 'var(--good)' }} /><span style={{ color: 'var(--good)', marginLeft: 6, fontWeight: 600 }}>damage_evidence.jpg</span></>) : (<><Icon name="cam" size={20} /><span style={{ marginLeft: 6 }}>Tap to take photo</span></>)}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Replacement cost</div>
              <div className="row gap-6" style={{ alignItems: 'center' }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>€</span>
                <input className="input" type="number" value={cost} onChange={e => setCost(parseInt(e.target.value) || 0)} style={{ flex: 1, fontSize: 16, fontFamily: 'var(--mono)' }} />
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>Manager will adjust if needed before charging guest.</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Notes</div>
              <textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Where was it, what guest, etc." style={{ width: '100%', resize: 'vertical' }} />
            </div>
          </div>
        )}

        {/* Step 3 — review */}
        {step === 3 && (
          <div style={{ padding: 16, overflow: 'auto', flex: 1 }} className="col gap-10">
            <div className="card" style={{ padding: 12, background: 'var(--surface-2)' }}>
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Damage report</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>{preset?.label}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{property.full}</div>
              {note && <div style={{ fontSize: 12, marginTop: 8, padding: 8, background: 'var(--bg)', borderRadius: 6 }}>{note}</div>}
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>This will create</div>
              <div className="row gap-8" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                <Icon name="wrench" size={14} style={{ color: 'var(--brand)' }} />
                <span className="grow" style={{ fontSize: 12 }}>Maintenance ticket — replace / fix</span>
                <span className="pill ghost" style={{ fontSize: 10 }}>auto</span>
              </div>
              <div className="row gap-8" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                <Icon name="dollar" size={14} style={{ color: 'var(--good)' }} />
                <span className="grow" style={{ fontSize: 12 }}>Draft deposit charge — €{cost}</span>
                <span className="pill warn" style={{ fontSize: 10 }}>review</span>
              </div>
              <div className="row gap-8" style={{ padding: '6px 0' }}>
                <Icon name="msg" size={14} style={{ color: 'var(--ink-3)' }} />
                <span className="grow" style={{ fontSize: 12 }}>Notify manager via WhatsApp</span>
                <span className="pill ghost" style={{ fontSize: 10 }}>auto</span>
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Bill to</div>
              <div className="row gap-6">
                {[['guest', 'Guest deposit'], ['owner', 'Owner'], ['none', 'No charge']].map(([k, l]) => (
                  <button key={k} className={'btn full sm' + (bill === k ? ' primary' : '')} onClick={() => setBill(k)}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="row gap-8" style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
          {step > 1
            ? <button className="btn full" onClick={() => setStep(step - 1)}><Icon name="chevL" size={12} />Back</button>
            : <button className="btn full" onClick={onClose}>Cancel</button>}
          {step < 3
            ? <button className="btn full primary" disabled={(step === 1 && !preset) || (step === 2 && !photo)} onClick={() => setStep(step + 1)}>Next <Icon name="chevR" size={12} /></button>
            : <button className="btn full primary" onClick={submit}><Icon name="check" size={12} />Submit report</button>}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { PropertyPage });
