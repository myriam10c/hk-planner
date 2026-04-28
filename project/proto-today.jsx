// Today's checkouts page (manager view, hi-fi).

const TodayPage = () => {
  const { turnovers, goto, setTurnoverStatus, role, assignCleaners, showToast } = useStore();
  const [selected, setSelected] = React.useState([]);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [groupBy, setGroupBy] = React.useState('building'); // 'none' | 'building'

  if (role === 'cleaner') return <CleanerToday />;

  const toggleSel = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const selectAllUnassigned = () => setSelected(turnovers.filter(t => !t.cleaner).map(t => t.id));

  // Urgency-augmented list, sorted urgent → tight → normal
  const enriched = turnovers.map(t => ({ ...t, urg: turnoverUrgency(t) }));
  const urgents = enriched.filter(t => t.urg.level === 'urgent');
  const tights  = enriched.filter(t => t.urg.level === 'tight');

  const counts = {
    total: turnovers.length,
    done: turnovers.filter(t => t.status === 'done').length,
    progress: turnovers.filter(t => t.status === 'in-progress').length,
    blocked: turnovers.filter(t => t.status === 'blocked').length,
    unassigned: turnovers.filter(t => !t.cleaner).length,
    urgent: urgents.length,
  };

  // Group by building
  const groupedByBuilding = BUILDINGS
    .map(b => ({ building: b, jobs: enriched.filter(t => propById(t.prop).building === b.id) }))
    .filter(g => g.jobs.length > 0)
    // multi-unit buildings first, then by earliest checkout
    .sort((a, b) => (b.jobs.length - a.jobs.length) || a.jobs[0].out.localeCompare(b.jobs[0].out));

  const flatSorted = [...enriched].sort((a, b) => {
    const order = { urgent: 0, tight: 1, normal: 2 };
    return order[a.urg.level] - order[b.urg.level] || a.out.localeCompare(b.out);
  });

  return (
    <div className="content">
      <Topbar crumbs={[{ label: "Today's checkouts" }]} />
      <div className="page">
        <div className="page-h">
          <h1>Tuesday, April 28</h1>
          <span className="sub">{counts.total} turnovers · {counts.done} done · {counts.progress} in progress</span>
          <div className="right">
            <button className="btn"><Icon name="refresh" size={14} />Sync Hostaway</button>
            <button className="btn primary" onClick={() => { selectAllUnassigned(); setAssignOpen(true); }}>
              <Icon name="plus" size={14} />Assign cleaners {counts.unassigned > 0 ? `· ${counts.unassigned}` : ''}
            </button>
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi"><div className="l">Turnovers</div><div className="v tnum">{counts.total}</div><div className="delta">5 check-ins, 2 deep cleans</div></div>
          <div className="kpi"><div className="l">Progress</div><div className="v tnum">{counts.done}/{counts.total}</div><div className="delta up">on schedule</div></div>
          <div className="kpi"><div className="l warn">Urgent · back-to-back</div><div className="v tnum bad">{counts.urgent}</div><div className="delta down">{urgents[0] ? propById(urgents[0].prop).name : '—'}</div></div>
          <div className="kpi"><div className="l">Blocked</div><div className="v tnum warn">{counts.blocked}</div><div className="delta down">{turnovers.find(t => t.status === 'blocked') ? propById(turnovers.find(t => t.status === 'blocked').prop).name : '—'}</div></div>
          <div className="kpi"><div className="l">Unassigned</div><div className="v tnum warn">{counts.unassigned}</div><div className="delta down">{enriched.find(t => !t.cleaner) ? propById(enriched.find(t => !t.cleaner).prop).name : '—'}</div></div>
        </div>

        {urgents.length > 0 && (
          <div style={{ marginTop: 12, border: '1px solid var(--bad)', borderRadius: 10, background: 'var(--bad-soft)', overflow: 'hidden' }}>
            <div className="row gap-10" style={{ padding: '10px 14px', background: 'var(--bad)', color: '#fff' }}>
              <Icon name="bell" size={14} />
              <b style={{ fontSize: 12.5, letterSpacing: '.01em' }}>
                {urgents.length} urgent · back-to-back
              </b>
              <span style={{ opacity: .85, fontSize: 11.5 }}>· &lt;3h between checkout and check-in. Cleaners must arrive immediately.</span>
              <span style={{ flex: 1 }}></span>
              <button className="btn sm" style={{ background: 'rgba(255,255,255,.15)', borderColor: 'rgba(255,255,255,.3)', color: '#fff' }}
                      onClick={() => { setSelected(urgents.map(t => t.id)); setAssignOpen(true); }}>
                <Icon name="user" size={11} />Assign now
              </button>
            </div>
            <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
              {urgents.map(t => {
                const p = propById(t.prop); const s = staffById(t.cleaner);
                return (
                  <div key={t.id}
                       onClick={() => goto('property', { tid: t.id })}
                       style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--line)', cursor: 'pointer' }}>
                    <div style={{ width: 3, alignSelf: 'stretch', background: 'var(--bad)', borderRadius: 99, minHeight: 32 }}></div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row gap-6" style={{ minWidth: 0 }}>
                        <b style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</b>
                        <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{t.out}→{t.in}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
                        {s ? s.name : <span style={{ color: 'var(--bad)', fontWeight: 600 }}>Unassigned</span>}
                      </div>
                    </div>
                    <span className="pill bad" style={{ fontSize: 9.5, flexShrink: 0 }}>{t.urg.gapMin}m</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="toolbar">
          <div className="tabs">
            <div className="on">List</div>
            <div onClick={() => goto('cal')}>Timeline</div>
            <div>Map</div>
          </div>
          <div style={{ flex: 1 }}></div>
          <div className="row gap-4" style={{ background: 'var(--surface-2)', padding: 2, borderRadius: 8 }}>
            {[['none', 'Flat'], ['building', 'By building']].map(([k, l]) => (
              <div key={k} onClick={() => setGroupBy(k)}
                   style={{ padding: '4px 10px', fontSize: 11.5, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                            background: groupBy === k ? 'var(--bg)' : 'transparent',
                            color: groupBy === k ? 'var(--ink)' : 'var(--ink-2)',
                            boxShadow: groupBy === k ? 'var(--shadow-1)' : 'none' }}>{l}</div>
            ))}
          </div>
          <button className="btn"><Icon name="dot" size={14} />Status: All</button>
          <button className="btn"><Icon name="user" size={14} />Cleaner: All</button>
          <button className="btn"><Icon name="pin" size={14} />Zone: All</button>
        </div>

        <div className="card">
          {selected.length > 0 && (
            <div className="row gap-8" style={{ padding: '10px 14px', background: 'var(--brand-soft)', borderBottom: '1px solid var(--line)' }}>
              <b style={{ fontSize: 12 }}>{selected.length} selected</b>
              <span style={{ flex: 1 }}></span>
              <button className="btn sm" onClick={() => setSelected([])}>Clear</button>
              <button className="btn sm primary" onClick={() => setAssignOpen(true)}><Icon name="user" size={11} />Assign cleaner</button>
            </div>
          )}
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 38 }}>
                  <span className={'check' + (selected.length === turnovers.length ? ' on' : '')}
                        onClick={() => setSelected(selected.length === turnovers.length ? [] : turnovers.map(t => t.id))}></span>
                </th>
                <th>Property</th>
                <th style={{ width: 110 }}>Check-out</th>
                <th style={{ width: 110 }}>Check-in</th>
                <th style={{ width: 130 }}>Window</th>
                <th>Cleaner</th>
                <th>Status</th>
                <th style={{ width: 110 }}>Flags</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {(groupBy === 'building' ? groupedByBuilding.flatMap(g => [{ __header: g.building, count: g.jobs.length }, ...g.jobs]) : flatSorted).map((row, idx) => {
                if (row.__header) {
                  const b = row.__header;
                  const allCleaners = [...new Set(row.count > 1 ? groupedByBuilding.find(g => g.building.id === b.id).jobs.map(j => j.cleaner).filter(Boolean) : [])];
                  return (
                    <tr key={'h-' + b.id} style={{ background: 'var(--surface-2)' }}>
                      <td colSpan="9" style={{ padding: '8px 14px' }}>
                        <div className="row gap-10">
                          <Icon name="bldg" size={13} style={{ color: 'var(--ink-2)' }} />
                          <b style={{ fontSize: 12 }}>{b.name}</b>
                          <span className="muted mono" style={{ fontSize: 11 }}>{b.addr}</span>
                          <span className="pill" style={{ fontSize: 10 }}>{row.count} {row.count === 1 ? 'unit' : 'units today'}</span>
                          {row.count > 1 && allCleaners.length === 1 && (
                            <span className="pill good" style={{ fontSize: 10 }}><Icon name="check" size={10} />Same cleaner</span>
                          )}
                          {row.count > 1 && allCleaners.length > 1 && (
                            <span className="pill warn" style={{ fontSize: 10 }}><Icon name="bell" size={10} />Different cleaners — consider batching</span>
                          )}
                          {row.count > 1 && allCleaners.length === 0 && (
                            <span className="pill bad" style={{ fontSize: 10 }}>No cleaner — assign one for all units</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                const t = row;
                const p = propById(t.prop); const s = staffById(t.cleaner);
                const sel = selected.includes(t.id);
                const urg = t.urg;
                return (
                  <tr key={t.id} className={sel ? 'selected' : ''} onClick={() => goto('property', { tid: t.id })}>
                    <td><span className={'check' + (sel ? ' on' : '')}
                              onClick={(e) => { e.stopPropagation(); toggleSel(t.id); }}></span></td>
                    <td>
                      <div className="row gap-6">
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        {p.unit && groupBy !== 'building' && <span className="muted" style={{ fontSize: 11 }}>· {p.unit}</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>{groupBy === 'building' ? p.unit : p.addr} · {t.guests} guests · {t.nights}n</div>
                    </td>
                    <td className="mono tnum">{t.out}</td>
                    <td className="mono tnum">{t.in}</td>
                    <td>
                      {urg.gapMin === null
                        ? <span className="muted">— deep clean</span>
                        : <span className={'pill' + (urg.level === 'urgent' ? ' bad' : urg.level === 'tight' ? ' warn' : '')}>
                            {urg.level === 'urgent' && <Icon name="bell" size={10} />}
                            {Math.floor(urg.gapMin / 60)}h {(urg.gapMin % 60).toString().padStart(2, '0')}m
                          </span>}
                    </td>
                    <td>
                      {s ? (
                        <div className="row gap-6"><Avi name={s.name} size="sm" />{s.name}</div>
                      ) : (
                        <span className="pill bad"><span className="dot"></span>Unassigned</span>
                      )}
                    </td>
                    <td><Status s={t.status} /></td>
                    <td>
                      <div className="row gap-4">
                        {urg.level === 'urgent' && <span className="pill bad" style={{ fontSize: 9.5 }}>URGENT</span>}
                        {t.tickets > 0 && <span className="pill warn"><Icon name="wrench" size={11} />{t.tickets}</span>}
                        {t.photos && <Icon name="cam" size={14} style={{ color: 'var(--ink-3)' }} />}
                      </div>
                    </td>
                    <td><Icon name="chevR" size={14} style={{ color: 'var(--ink-3)' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {assignOpen && (
        <AssignModal
          turnovers={turnovers.filter(t => selected.includes(t.id))}
          onClose={() => { setAssignOpen(false); setSelected([]); }}
          onAssign={(map) => { assignCleaners(map); setAssignOpen(false); setSelected([]); }}
        />
      )}
    </div>
  );
};

const AssignModal = ({ turnovers, onClose, onAssign }) => {
  const [pick, setPick] = React.useState(() => {
    // round-robin default suggestion
    const cleaners = STAFF.filter(s => s.role.includes('Cleaner') || s.role.includes('Lead'));
    const m = {};
    turnovers.forEach((t, i) => { m[t.id] = t.cleaner || cleaners[i % cleaners.length].id; });
    return m;
  });
  const cleaners = STAFF.filter(s => s.role.includes('Cleaner') || s.role.includes('Lead'));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,14,.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} className="card pop" style={{ width: 560, maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="card-h">
          <Icon name="user" size={14} />
          <h3>Assign cleaners · {turnovers.length} turnover{turnovers.length === 1 ? '' : 's'}</h3>
          <div className="right">
            <button className="btn ghost sm" onClick={onClose}><Icon name="x" size={14} /></button>
          </div>
        </div>
        <div style={{ padding: 0, overflow: 'auto', flex: 1 }}>
          {turnovers.map(t => {
            const p = propById(t.prop);
            return (
              <div key={t.id} className="row gap-12" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                <div className="grow">
                  <b style={{ fontSize: 12.5 }}>{p.full}</b>
                  <div className="muted" style={{ fontSize: 11 }}>{t.out} → {t.in} · {p.zone}</div>
                </div>
                <select className="input select" style={{ width: 180 }} value={pick[t.id] || ''}
                        onChange={e => setPick({ ...pick, [t.id]: e.target.value })}>
                  <option value="">— choose —</option>
                  {cleaners.map(c => <option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}
                </select>
              </div>
            );
          })}
        </div>
        <div className="row gap-8" style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
          <span className="muted" style={{ fontSize: 11 }}>Suggested by route proximity + cleaner workload</span>
          <span style={{ flex: 1 }}></span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onAssign(pick)}><Icon name="check" size={12} />Assign &amp; notify</button>
        </div>
      </div>
    </div>
  );
};

// ─── Cleaner mobile today ──────────────────────────────────────────
const CleanerToday = () => {
  const { turnovers, goto } = useStore();
  // For cleaner view, filter to S1 (Amina)
  const mine = turnovers.filter(t => t.cleaner === 'S1');
  const current = mine.find(t => t.status !== 'done') || mine[0];
  const done = mine.filter(t => t.status === 'done').length;

  return (
    <div className="content" style={{ display: 'flex', justifyContent: 'center', background: 'var(--surface-3)' }}>
      <div className="mob-shell">
        <div className="mob-screen">
          <div className="mob-notch"></div>
          <div className="mob-status"><span className="mono">9:41</span><span className="row gap-4"><Icon name="wifi" size={11} /><span className="mono">100</span></span></div>
          <div className="mob-content">
            <div className="mob-h">
              <div>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Tue 28 Apr · Hi Amina</div>
                <h2>Today's stops</h2>
              </div>
              <Avi name="Amina K." size="lg" />
            </div>
            <div style={{ padding: '0 18px 12px' }}>
              <div className="row" style={{ fontSize: 11, fontWeight: 600 }}>
                <span className="muted">{done} of {mine.length} done</span>
                <span style={{ flex: 1 }}></span>
                <span className="pill brand">on schedule</span>
              </div>
              <div style={{ marginTop: 8, height: 8, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${(done / mine.length) * 100}%`, height: '100%', background: 'var(--brand)', borderRadius: 99 }}></div>
              </div>
            </div>

            {/* Current */}
            {current && (() => {
              const p = propById(current.prop);
              return (
                <div style={{ padding: '0 18px 16px' }}>
                  <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 8 }}>NOW</div>
                  <div className="card pop" style={{ borderColor: 'var(--ink)', borderWidth: 2, padding: 16 }}>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <Status s={current.status} />
                      <span style={{ flex: 1 }}></span>
                      <span className="muted mono" style={{ fontSize: 10 }}>1 / {mine.length}</span>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{p.full}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.addr}</div>
                    <hr className="sep" />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      <div>
                        <div className="muted" style={{ fontSize: 10 }}>Out</div>
                        <div className="mono tnum" style={{ fontWeight: 700, fontSize: 14 }}>{current.out}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 10 }}>Next in</div>
                        <div className="mono tnum" style={{ fontWeight: 700, fontSize: 14 }}>{current.in}</div>
                      </div>
                      <div>
                        <div className="muted" style={{ fontSize: 10 }}>Stay</div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{current.guests}·{current.nights}n</div>
                      </div>
                    </div>
                    {current.notes && (
                      <div style={{ marginTop: 12, padding: 10, background: 'var(--warn-soft)', borderRadius: 8, fontSize: 12 }}>
                        <b>Note:</b> {current.notes}
                      </div>
                    )}
                    <div className="row gap-6" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                      {current.photos && <span className="pill"><Icon name="cam" size={11} />photos req</span>}
                      {current.tickets > 0 && <span className="pill warn"><Icon name="wrench" size={11} />{current.tickets} ticket</span>}
                      <span className="pill ghost"><Icon name="key" size={11} />code 4421</span>
                    </div>
                    <div className="row gap-8" style={{ marginTop: 14 }}>
                      <button className="btn full lg"><Icon name="map" size={14} />Directions</button>
                      <button className="btn full lg primary" onClick={() => goto('property', { tid: current.id })}>Open checklist <Icon name="arrR" size={14} /></button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Route timeline */}
            <div style={{ padding: '0 18px 24px' }}>
              <div className="row" style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>ROUTE · {mine.length} stops</div>
                <span style={{ flex: 1 }}></span>
                <span className="muted" style={{ fontSize: 11 }}>~14 km · 38 min driving</span>
              </div>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 14, top: 8, bottom: 8, width: 2, background: 'var(--line)' }}></div>
                {mine.map((t, i) => {
                  const p = propById(t.prop);
                  const isCurrent = t.id === current?.id;
                  const isDone = t.status === 'done';
                  const tight = t.in !== '—' && parseInt(t.in) - parseInt(t.out) <= 3;
                  return (
                    <React.Fragment key={t.id}>
                      <div className="row gap-12" style={{ alignItems: 'flex-start', marginBottom: 4, position: 'relative' }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: 999,
                          background: isDone ? 'var(--good)' : isCurrent ? 'var(--ink)' : 'var(--bg)',
                          border: '2px solid ' + (isDone ? 'var(--good)' : isCurrent ? 'var(--ink)' : 'var(--line)'),
                          color: isDone || isCurrent ? '#fff' : 'var(--ink-2)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0, zIndex: 1,
                        }}>{isDone ? <Icon name="check" size={13} /> : i + 1}</div>
                        <div className="card grow" style={{ padding: 12, borderColor: isCurrent ? 'var(--ink)' : 'var(--line)', borderWidth: isCurrent ? 2 : 1 }}
                             onClick={() => goto('property', { tid: t.id })}>
                          <div className="row">
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                            <span style={{ flex: 1 }}></span>
                            {isCurrent && <span className="pill brand">now</span>}
                            {tight && !isCurrent && <span className="pill warn">tight</span>}
                          </div>
                          <div className="row gap-8" style={{ marginTop: 4, fontSize: 11 }}>
                            <span className="mono muted">{t.out} → {t.in}</span>
                            <span className="muted">·</span>
                            <span className="muted">{p.zone}</span>
                          </div>
                        </div>
                      </div>
                      {i < mine.length - 1 && (
                        <div className="row gap-12" style={{ alignItems: 'center', marginBottom: 4, paddingLeft: 38 }}>
                          <Icon name="route" size={11} style={{ color: 'var(--ink-3)' }} />
                          <span className="muted" style={{ fontSize: 10 }}>{[12, 8, 6, 14][i] || 10} min · {p.zone === propById(mine[i+1].prop).zone ? 'same zone' : 'cross-zone'}</span>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
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
    </div>
  );
};

Object.assign(window, { TodayPage });
