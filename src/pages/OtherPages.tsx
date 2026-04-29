import React from 'react';
import { useStore } from '../store/store';
import { propById, staffById, PROPS, STAFF } from '../store/data';
import { Icon, Status, Prio, Avi } from '../components/Icon';
import { Topbar } from '../components/Shell';

export const TicketsListPage: React.FC = () => {
  const { tickets, goto } = useStore();
  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Tickets' }]} />
      <div className="page">
        <div className="page-h">
          <h1>Maintenance tickets</h1>
          <span className="sub">{tickets.filter(t => t.status !== 'closed').length} open · {tickets.filter(t => t.status === 'closed').length} closed</span>
          <div className="right">
            <button className="btn"><Icon name="msg" size={14} />From WhatsApp</button>
            <button className="btn primary"><Icon name="plus" size={14} />New ticket</button>
          </div>
        </div>
        <div className="toolbar">
          <div className="tabs">
            <div className="on">All</div><div>Open</div><div>In progress</div><div>Waiting</div><div>Closed</div>
          </div>
          <div style={{ flex: 1 }}></div>
          <button className="btn"><Icon name="user" size={14} />Tech: All</button>
          <button className="btn"><Icon name="bldg" size={14} />Property: All</button>
        </div>
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Title</th><th>Property</th><th>Type</th><th>Priority</th>
                <th>Tech</th><th>Due</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => {
                const p = propById(t.prop); const s = staffById(t.tech);
                return (
                  <tr key={t.id} onClick={() => goto('ticket', { id: t.id })}>
                    <td className="mono muted">#{t.id}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.title}</div>
                      {t.source !== '—' && <div className="muted" style={{ fontSize: 11, marginTop: 1 }}><Icon name="msg" size={10} style={{ verticalAlign: -1 }} /> WhatsApp</div>}
                    </td>
                    <td>{p.name}</td>
                    <td className="muted" style={{ textTransform: 'capitalize' }}>{t.type}</td>
                    <td><Prio p={t.prio} /></td>
                    <td>{s ? <div className="row gap-6"><Avi name={s.name} size="sm" />{s.name}</div> : <span className="muted">—</span>}</td>
                    <td className="mono">{t.due}</td>
                    <td><Status s={t.status} /></td>
                    <td><Icon name="chevR" size={14} style={{ color: 'var(--ink-3)' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const CalendarPage: React.FC = () => {
  const days = ['Mon 27', 'Tue 28', 'Wed 29', 'Thu 30', 'Fri 1', 'Sat 2', 'Sun 3'];
  const today = 1;
  const events = [
    { d: 0, p: 'P2', s: 'S2', t: 'Belleville',   tone: 'good'  },
    { d: 0, p: 'P5', s: 'S4', t: 'Marais 3BR',   tone: 'good'  },
    { d: 1, p: 'P1', s: 'S1', t: 'Marais 2BR',   tone: 'good'  },
    { d: 1, p: 'P2', s: 'S2', t: 'Belleville',   tone: 'warn'  },
    { d: 1, p: 'P3', s: 'S3', t: 'Montmartre',   tone: 'warn'  },
    { d: 1, p: 'P4', s: 'S1', t: 'Canal Studio', tone: 'ghost' },
    { d: 1, p: 'P5', s: 'S4', t: 'Marais 3BR',   tone: 'bad'   },
    { d: 1, p: 'P6', s: 'S2', t: 'Latin (deep)', tone: 'ghost' },
    { d: 1, p: 'P7', s: null, t: 'Canal 1BR',    tone: 'bad'   },
    { d: 2, p: 'P1', s: 'S1', t: 'Marais 2BR',   tone: 'ghost' },
    { d: 2, p: 'P3', s: 'S3', t: 'Montmartre',   tone: 'ghost' },
    { d: 3, p: 'P4', s: 'S1', t: 'Canal Studio', tone: 'ghost' },
    { d: 3, p: 'P6', s: 'S2', t: 'Latin Studio', tone: 'ghost' },
    { d: 4, p: 'P2', s: 'S2', t: 'Belleville',   tone: 'ghost' },
    { d: 4, p: 'P5', s: 'S4', t: 'Marais 3BR',   tone: 'ghost' },
    { d: 5, p: 'P1', s: 'S1', t: 'Marais 2BR',   tone: 'ghost' },
    { d: 5, p: 'P7', s: 'S3', t: 'Canal 1BR',    tone: 'ghost' },
    { d: 6, p: 'P3', s: 'S3', t: 'Montmartre',   tone: 'ghost' },
  ];
  const times = ['11:00','10:00','11:00','12:00','10:00','11:00','09:30'];

  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Calendar' }]} />
      <div className="page">
        <div className="page-h">
          <h1>Week of Apr 27</h1>
          <span className="sub">18 turnovers · 3 deep cleans · 5 cleaners</span>
          <div className="right">
            <div className="tabs"><div>Day</div><div className="on">Week</div><div>Month</div></div>
            <button className="btn"><Icon name="chevL" size={14} /></button>
            <button className="btn">Today</button>
            <button className="btn"><Icon name="chevR" size={14} /></button>
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
            {days.map((d, i) => (
              <div key={d} style={{ padding: '12px 14px', borderRight: i < 6 ? '1px solid var(--line)' : 'none', background: i === today ? 'var(--brand-soft)' : 'var(--surface-2)' }}>
                <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{d.split(' ')[0]}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{d.split(' ')[1]}</div>
                <div className="muted" style={{ fontSize: 11 }}>{events.filter(e => e.d === i).length} turnovers</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: 540 }}>
            {days.map((_, i) => (
              <div key={i} style={{ borderRight: i < 6 ? '1px solid var(--line)' : 'none', padding: 8, background: i === today ? 'oklch(0.98 0.02 180)' : 'transparent', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {events.filter(e => e.d === i).map((e, k) => {
                  const s = staffById(e.s);
                  return (
                    <div key={k} className="card" style={{ padding: 8, fontSize: 11, cursor: 'pointer', borderColor: 'var(--line)' }}>
                      <div className="row gap-4">
                        <span className={'pill ' + e.tone} style={{ fontSize: 9, padding: '0 5px' }}>{times[i] || '—'}</span>
                        <span style={{ flex: 1 }}></span>
                        {s ? <Avi name={s.name} size="sm" /> : <span className="pill bad" style={{ fontSize: 9, padding: '0 4px' }}>?</span>}
                      </div>
                      <div style={{ fontWeight: 700, marginTop: 4, fontSize: 11.5 }}>{e.t}</div>
                    </div>
                  );
                })}
                {i === 5 && <div className="muted" style={{ fontSize: 11, padding: 4, textAlign: 'center' }}>+ deep clean</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const TeamPage: React.FC = () => (
  <div className="content">
    <Topbar crumbs={[{ label: 'Team' }]} />
    <div className="page">
      <div className="page-h">
        <h1>Team</h1>
        <span className="sub">{STAFF.length} staff · {STAFF.filter(s => s.online).length} online</span>
        <div className="right">
          <button className="btn primary"><Icon name="plus" size={14} />Invite</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {STAFF.map(s => (
          <div key={s.id} className="card" style={{ padding: 16 }}>
            <div className="row gap-12">
              <Avi name={s.name} size="lg" />
              <div className="grow">
                <div className="row gap-6"><b>{s.name}</b>{s.online && <span className="dot" style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--good)', display: 'inline-block' }}></span>}</div>
                <div className="muted" style={{ fontSize: 11 }}>{s.role}</div>
              </div>
              <button className="btn sm ghost"><Icon name="chevR" size={14} /></button>
            </div>
            <hr className="sep" />
            <div className="row" style={{ fontSize: 11 }}>
              <span className="muted mono">{s.phone}</span>
              <span style={{ flex: 1 }}></span>
              <span className="pill ghost">3 today</span>
            </div>
            <div style={{ marginTop: 10, height: 6, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: '67%', height: '100%', background: 'var(--brand)', borderRadius: 99 }}></div>
            </div>
            <div className="row" style={{ fontSize: 10, marginTop: 4 }}>
              <span className="muted">Today's progress</span>
              <span style={{ flex: 1 }}></span>
              <span className="mono">2/3</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const ReportsPage: React.FC = () => {
  const [period, setPeriod] = React.useState('30d');
  const cleanerRows = [
    { id: 'S1', name: 'Amina K.', jobs: 62, mins: 2.6*60, ontime: 96,  score: 4.9,  paid: 2480 },
    { id: 'S2', name: 'Jorge M.', jobs: 54, mins: 2.4*60, ontime: 92,  score: 4.8,  paid: 2160 },
    { id: 'S3', name: 'Lin W.',   jobs: 48, mins: 2.7*60, ontime: 89,  score: 4.7,  paid: 1920 },
    { id: 'S4', name: 'Diane B.', jobs: 71, mins: 2.5*60, ontime: 98,  score: 4.95, paid: 3550 },
  ];
  const propRows = [
    { pid: 'P1', revenue: 4820, cleaning: 540, maintenance: 60,  turnovers: 9,  occ: 90 },
    { pid: 'P2', revenue: 2640, cleaning: 360, maintenance: 0,   turnovers: 6,  occ: 96 },
    { pid: 'P3', revenue: 3880, cleaning: 425, maintenance: 0,   turnovers: 8,  occ: 86 },
    { pid: 'P4', revenue: 3220, cleaning: 480, maintenance: 60,  turnovers: 8,  occ: 91 },
    { pid: 'P5', revenue: 6240, cleaning: 720, maintenance: 0,   turnovers: 12, occ: 80 },
    { pid: 'P6', revenue: 2120, cleaning: 320, maintenance: 8,   turnovers: 5,  occ: 77 },
    { pid: 'P7', revenue: 3540, cleaning: 410, maintenance: 0,   turnovers: 7,  occ: 86 },
  ];
  const total = propRows.reduce((s, p) => ({ revenue: s.revenue+p.revenue, cleaning: s.cleaning+p.cleaning, maintenance: s.maintenance+p.maintenance, turnovers: s.turnovers+p.turnovers }), { revenue:0, cleaning:0, maintenance:0, turnovers:0 });
  const costPerTurnover = Math.round(total.cleaning / total.turnovers);
  const cleanerHours = cleanerRows.reduce((s, c) => s + c.jobs * c.mins / 60, 0);
  const revPerHour = Math.round(total.revenue / cleanerHours);

  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Reports' }]} />
      <div className="page">
        <div className="page-h">
          <div>
            <h1>Reports · April 2026</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{total.turnovers} turnovers · 7 properties · 4 cleaners</div>
          </div>
          <div className="right">
            <div className="row gap-4" style={{ background: 'var(--surface-2)', padding: 2, borderRadius: 8 }}>
              {[['7d','7 days'],['30d','April'],['90d','Q2'],['ytd','YTD']].map(([k,l]) => (
                <div key={k} onClick={() => setPeriod(k)} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer', background: period===k ? 'var(--bg)' : 'transparent', color: period===k ? 'var(--ink)' : 'var(--ink-2)', boxShadow: period===k ? 'var(--shadow-1)' : 'none' }}>{l}</div>
              ))}
            </div>
            <button className="btn"><Icon name="cam" size={14} />Export CSV</button>
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi"><div className="l">Cost / turnover</div><div className="v mono tnum">€{costPerTurnover}</div><div className="delta up">−€4 vs prev</div></div>
          <div className="kpi"><div className="l">On-time %</div><div className="v mono tnum">94%</div><div className="delta up">+2.1pp</div></div>
          <div className="kpi"><div className="l">Avg ticket SLA</div><div className="v mono tnum">2h 14m</div><div className="delta up">−18m</div></div>
          <div className="kpi"><div className="l">Revenue / cleaner-hr</div><div className="v mono tnum">€{revPerHour}</div><div className="delta up">+€6</div></div>
          <div className="kpi"><div className="l">AI auto-replies</div><div className="v mono tnum">218</div><div className="delta">87% accepted</div></div>
          <div className="kpi"><div className="l">Damage recovered</div><div className="v mono tnum">€420</div><div className="delta">3 charges</div></div>
        </div>

        <div className="split" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="card-h"><Icon name="chart" size={14} /><h3>Turnovers per day</h3><div className="right"><span className="muted" style={{ fontSize: 11 }}>last 30 days</span></div></div>
            <div style={{ padding: 16, height: 200, display: 'flex', alignItems: 'flex-end', gap: 3 }}>
              {[8,11,9,12,14,10,7,11,13,15,12,10,8,11,14,16,12,9,10,13,15,17,14,11,9,12,15,18,14,12].map((v, i) => (
                <div key={i} title={`Apr ${i+1}: ${v} turnovers`} style={{ flex: 1, height: `${(v/18)*100}%`, background: i>=27 ? 'var(--brand)' : 'var(--ink)', borderRadius: '3px 3px 0 0', opacity: i>=27 ? 1 : 0.85 }}></div>
              ))}
            </div>
            <div className="row" style={{ padding: '0 16px 12px', fontSize: 10, color: 'var(--ink-3)' }}>
              <span className="mono">Apr 1</span><span style={{ flex: 1 }}></span><span className="mono">Apr 30</span>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><Icon name="wrench" size={14} /><h3>Tickets by type · SLA</h3></div>
            <div style={{ padding: 14 }}>
              {[['Plumbing',24,'3h 12m','bad'],['Electrical',18,'1h 48m','warn'],['Appliance',16,'4h 22m','info'],['Lock / access',9,'38m','ghost'],['Supplies',12,'52m','good'],['Damage',4,'1h 04m','warn'],['Other',8,'2h 11m','ghost']].map(([l,n,sla,c]) => (
                <div key={String(l)} className="row gap-8" style={{ padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
                  <span style={{ width: 100, fontSize: 12 }}>{l}</span>
                  <div className="grow" style={{ height: 8, background: 'var(--surface-2)', borderRadius: 99 }}>
                    <div style={{ width: `${(Number(n)/24)*100}%`, height: '100%', borderRadius: 99, background: `var(--${c==='ghost'?'ink-3':c})` }}></div>
                  </div>
                  <span className="mono tnum" style={{ width: 24, textAlign: 'right', fontSize: 11 }}>{n}</span>
                  <span className="muted mono tnum" style={{ width: 56, textAlign: 'right', fontSize: 10 }}>{sla}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-h"><Icon name="user" size={14} /><h3>Cleaner performance</h3><div className="right"><span className="muted" style={{ fontSize: 11 }}>sorted by jobs</span></div></div>
          <table className="tbl">
            <thead><tr><th>Cleaner</th><th style={{ width:80 }}>Jobs</th><th style={{ width:110 }}>Avg time</th><th style={{ width:130 }}>On-time</th><th style={{ width:110 }}>Guest score</th><th style={{ width:100 }}>Paid</th><th style={{ width:130 }}>€ / hour</th></tr></thead>
            <tbody>
              {cleanerRows.sort((a,b)=>b.jobs-a.jobs).map(c => {
                const eph = Math.round(c.paid/(c.jobs*c.mins/60));
                return (
                  <tr key={c.id}>
                    <td><div className="row gap-8"><Avi name={c.name} size="sm" /><b>{c.name}</b></div></td>
                    <td className="mono tnum">{c.jobs}</td>
                    <td className="mono tnum">{Math.floor(c.mins/60)}h {Math.round(c.mins%60)}m</td>
                    <td><div className="row gap-6"><div style={{ flex:1,height:6,background:'var(--surface-3)',borderRadius:99,overflow:'hidden' }}><div style={{ width:c.ontime+'%',height:'100%',background:c.ontime>=95?'var(--good)':c.ontime>=90?'var(--brand)':'var(--warn)' }}></div></div><span className="mono tnum" style={{ fontSize:11,width:28 }}>{c.ontime}%</span></div></td>
                    <td><span className="mono tnum">★ {c.score}</span></td>
                    <td className="mono tnum">€{c.paid.toLocaleString()}</td>
                    <td className="mono tnum"><b>€{eph}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-h"><Icon name="bldg" size={14} /><h3>Property economics</h3><div className="right"><span className="muted" style={{ fontSize:11 }}>April · gross figures</span></div></div>
          <table className="tbl">
            <thead><tr><th>Property</th><th style={{ width:80 }}>Occ</th><th style={{ width:80 }}>Turnovers</th><th style={{ width:100 }}>Revenue</th><th style={{ width:110 }}>Cleaning</th><th style={{ width:110 }}>Maintenance</th><th style={{ width:110 }}>Cost / turnover</th><th style={{ width:90 }}>Margin</th></tr></thead>
            <tbody>
              {propRows.map(r => {
                const p = propById(r.pid);
                const cpt = Math.round(r.cleaning/r.turnovers);
                const margin = Math.round(((r.revenue-r.cleaning-r.maintenance)/r.revenue)*100);
                return (
                  <tr key={r.pid}>
                    <td><b style={{ fontSize:12.5 }}>{p.name}</b><div className="muted" style={{ fontSize:11 }}>{p.zone}</div></td>
                    <td className="mono tnum">{r.occ}%</td>
                    <td className="mono tnum">{r.turnovers}</td>
                    <td className="mono tnum">€{r.revenue.toLocaleString()}</td>
                    <td className="mono tnum muted">€{r.cleaning}</td>
                    <td className="mono tnum muted">{r.maintenance?`€${r.maintenance}`:'—'}</td>
                    <td className="mono tnum">€{cpt}</td>
                    <td><span className={'pill '+(margin>=85?'good':margin>=80?'brand':'warn')}>{margin}%</span></td>
                  </tr>
                );
              })}
              <tr style={{ borderTop:'2px solid var(--line)',background:'var(--surface-2)',fontWeight:700 }}>
                <td>Total</td><td className="mono tnum">—</td><td className="mono tnum">{total.turnovers}</td>
                <td className="mono tnum">€{total.revenue.toLocaleString()}</td>
                <td className="mono tnum">€{total.cleaning}</td>
                <td className="mono tnum">€{total.maintenance}</td>
                <td className="mono tnum">€{costPerTurnover}</td>
                <td><span className="pill good">{Math.round(((total.revenue-total.cleaning-total.maintenance)/total.revenue)*100)}%</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
  <div onClick={() => onChange(!on)} style={{ width:38,height:22,borderRadius:99,background:on?'var(--brand)':'var(--surface-3)',position:'relative',cursor:'pointer',transition:'background .15s',flexShrink:0 }}>
    <div style={{ width:18,height:18,borderRadius:99,background:'white',position:'absolute',top:2,left:on?18:2,transition:'left .15s',boxShadow:'0 1px 2px rgba(0,0,0,.2)' }}></div>
  </div>
);

export const SettingsPage: React.FC = () => {
  const { tweaks, setTweaks, showToast } = useStore();
  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Settings' }, { label: 'Integrations' }]} />
      <div className="page" style={{ maxWidth: 920 }}>
        <div className="page-h">
          <h1>Integrations</h1>
          <span className="sub">PMS sync · WhatsApp ingestion · automation</span>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <div className="row gap-8" style={{ padding: '4px 0' }}>
              <div style={{ width:32,height:32,borderRadius:8,background:'#0a3a5e',color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:12 }}>H</div>
              <div><h3 style={{ fontSize:14 }}>Hostaway</h3><div className="muted" style={{ fontSize:11 }}>Property management system · pulls bookings, codes, guest counts</div></div>
            </div>
            <div className="right"><span className="pill good"><span className="dot"></span>Connected</span></div>
          </div>
          <div style={{ padding:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,fontSize:12 }}>
            <div><div className="muted" style={{ fontSize:10,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:4 }}>Account</div><div className="mono">acct_18hk_paris</div></div>
            <div><div className="muted" style={{ fontSize:10,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:4 }}>Last sync</div><div>2 minutes ago · 47 listings · 18 future bookings</div></div>
            <div><div className="muted" style={{ fontSize:10,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:4 }}>Sync schedule</div><select className="input select"><option>Every 5 minutes</option><option>Every 15 minutes</option><option>Hourly</option></select></div>
            <div><div className="muted" style={{ fontSize:10,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:4 }}>Fallback PMS</div><select className="input select"><option>None</option><option>Guesty</option><option>Smoobu</option></select></div>
          </div>
          <div className="row gap-6" style={{ padding:'0 16px 14px' }}>
            <button className="btn"><Icon name="refresh" size={14} />Sync now</button>
            <button className="btn">View field mappings</button>
            <button className="btn">Disconnect</button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">
            <div className="row gap-8" style={{ padding: '4px 0' }}>
              <div style={{ width:32,height:32,borderRadius:8,background:'var(--wa)',color:'white',display:'flex',alignItems:'center',justifyContent:'center' }}><Icon name="msg" size={16} /></div>
              <div><h3 style={{ fontSize:14 }}>Green API · WhatsApp</h3><div className="muted" style={{ fontSize:11 }}>Listens to selected chats · AI parses to tickets</div></div>
            </div>
            <div className="right"><span className="pill good"><span className="dot"></span>Live</span></div>
          </div>
          <div style={{ padding:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,fontSize:12 }}>
            <div><div className="muted" style={{ fontSize:10,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:4 }}>Instance ID</div><div className="mono">110258 1141</div></div>
            <div><div className="muted" style={{ fontSize:10,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:4 }}>Phone</div><div className="mono">+33 6 99 12 34 56</div></div>
            <div style={{ gridColumn:'1 / -1' }}>
              <div className="muted" style={{ fontSize:10,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:6 }}>Watched conversations · 4</div>
              <div className="col gap-6">
                {['HK Cleaners (group, 8 members)','HK Maintenance (group, 3 members)','Guests · Marais 2BR','Guests · all 1:1'].map(c => (
                  <div key={c} className="row gap-8" style={{ padding:8,border:'1px solid var(--line)',borderRadius:6,fontSize:12 }}>
                    <Icon name="msg" size={14} style={{ color:'var(--wa)' }} />
                    <span className="grow">{c}</span>
                    <span className="pill good"><span className="dot"></span>listening</span>
                    <button className="btn sm ghost">⋯</button>
                  </div>
                ))}
                <button className="btn"><Icon name="plus" size={12} />Add conversation</button>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><Icon name="sparkle" size={14} /><h3>Automation defaults</h3></div>
          <div style={{ padding: 16 }}>
            <div className="col gap-12">
              <div className="row gap-12">
                <div className="grow">
                  <b style={{ fontSize:12.5 }}>Auto-create tickets above confidence</b>
                  <div className="muted" style={{ fontSize:11 }}>Below threshold, ticket is queued for manager confirmation.</div>
                </div>
                <div className="row gap-8" style={{ width:280 }}>
                  <input type="range" min="0.5" max="1" step="0.01" value={tweaks.aiConfidence}
                         onChange={e => setTweaks(t => ({ ...t, aiConfidence: parseFloat(e.target.value) }))} style={{ flex:1 }} />
                  <span className="mono tnum" style={{ width:40 }}>{Math.round(tweaks.aiConfidence*100)}%</span>
                </div>
              </div>
              <hr className="sep" />
              <div className="row gap-12">
                <div className="grow">
                  <b style={{ fontSize:12.5 }}>Auto-reply to guests on ticket creation</b>
                  <div className="muted" style={{ fontSize:11 }}>"Thanks, we've logged it. Tech on the way before {'{ETA}'}."</div>
                </div>
                <Toggle on={tweaks.autoReply} onChange={v => setTweaks(t => ({ ...t, autoReply: v }))} />
              </div>
              <hr className="sep" />
              <div className="row gap-12">
                <div className="grow">
                  <b style={{ fontSize:12.5 }}>Auto-create tickets without confirmation</b>
                  <div className="muted" style={{ fontSize:11 }}>Skip the confirm step for high-confidence parses.</div>
                </div>
                <Toggle on={tweaks.autoCreate} onChange={v => { setTweaks(t => ({ ...t, autoCreate: v })); showToast(v ? 'Auto-create on' : 'Auto-create off'); }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PropertiesPage: React.FC = () => {
  const { goto, turnovers } = useStore();
  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Properties' }]} />
      <div className="page">
        <div className="page-h">
          <h1>Properties</h1>
          <span className="sub">{PROPS.length} listings</span>
        </div>
        <div className="card">
          <table className="tbl">
            <thead><tr><th>Property</th><th>Zone</th><th>Code</th><th>Today</th><th>Open tickets</th><th></th></tr></thead>
            <tbody>
              {PROPS.map(p => {
                const t = turnovers.find(x => x.prop === p.id);
                return (
                  <tr key={p.id} onClick={() => t && goto('property', { tid: t.id })}>
                    <td><b>{p.full}</b><div className="muted" style={{ fontSize:11 }}>{p.addr}</div></td>
                    <td>{p.zone}</td>
                    <td className="mono">{p.code}</td>
                    <td>{t ? <span className="mono">{t.out} → {t.in}</span> : <span className="muted">—</span>}</td>
                    <td>{(t?.tickets ?? 0) > 0 ? <span className="pill warn">{t!.tickets} open</span> : <span className="muted">—</span>}</td>
                    <td><Icon name="chevR" size={14} style={{ color:'var(--ink-3)' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
