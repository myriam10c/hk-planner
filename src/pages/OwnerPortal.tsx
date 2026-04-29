import React from 'react';
import { useStore } from '../store/store';
import { propById } from '../store/data';
import { Icon, Status, Avi } from '../components/Icon';
import { Topbar } from '../components/Shell';

const OWNER_PROPS: Record<string, { name: string; email: string; props: string[] }> = {
  O1: { name: 'Sophie Lambert', email: 'sophie.lambert@me.com', props: ['P1', 'P5'] },
  O2: { name: 'Marc Renaud',    email: 'marc@renaud.fr',        props: ['P2', 'P4', 'P6'] },
  O3: { name: 'Yael Cohen',     email: 'yael.cohen@gmail.com',  props: ['P3', 'P7'] },
};

const OWNER_DATA: Record<string, { revenue: number; nights: number; occ: number; adr: number; cleaning: number; maintenance: number; mgmtFee: number; payout: number; prevPayout: number; ticketIds: string[] }> = {
  P1: { revenue: 4820, nights: 18, occ: 90, adr: 268, cleaning: 540, maintenance: 60,  mgmtFee: 723, payout: 3497, prevPayout: 3120, ticketIds: ['241','235'] },
  P2: { revenue: 2640, nights: 22, occ: 96, adr: 120, cleaning: 360, maintenance: 0,   mgmtFee: 396, payout: 1884, prevPayout: 1750, ticketIds: [] },
  P3: { revenue: 3880, nights: 19, occ: 86, adr: 204, cleaning: 425, maintenance: 0,   mgmtFee: 582, payout: 2873, prevPayout: 2940, ticketIds: ['234'] },
  P4: { revenue: 3220, nights: 21, occ: 91, adr: 153, cleaning: 480, maintenance: 60,  mgmtFee: 483, payout: 2197, prevPayout: 2010, ticketIds: ['237'] },
  P5: { revenue: 6240, nights: 16, occ: 80, adr: 390, cleaning: 720, maintenance: 0,   mgmtFee: 936, payout: 4584, prevPayout: 5120, ticketIds: [] },
  P6: { revenue: 2120, nights: 17, occ: 77, adr: 124, cleaning: 320, maintenance: 8,   mgmtFee: 318, payout: 1474, prevPayout: 1680, ticketIds: ['236'] },
  P7: { revenue: 3540, nights: 18, occ: 86, adr: 196, cleaning: 410, maintenance: 0,   mgmtFee: 531, payout: 2599, prevPayout: 2480, ticketIds: [] },
};

const Spark: React.FC<{ data: number[]; w?: number; h?: number; color?: string }> = ({ data, w = 120, h = 32, color = 'var(--brand)' }) => {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const lastX = w, lastY = h - ((data[data.length - 1] - min) / range) * (h - 4) - 2;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
};

export const OwnerSidebar: React.FC<{ ownerId: string }> = ({ ownerId }) => {
  const { route, goto, tweaks } = useStore();
  const owner = OWNER_PROPS[ownerId];
  const navItems = [
    { g: 'Portfolio' },
    { id: 'owner-home', label: 'Dashboard',  ico: 'home' },
    { id: 'owner-stmt', label: 'Statements', ico: 'chart' },
    { id: 'owner-msgs', label: 'Messages',   ico: 'msg' },
    { g: 'Properties' },
    ...owner.props.map(pid => ({ id: 'owner-prop', pid, label: propById(pid).name, ico: 'bldg' })),
  ];

  return (
    <div className={'sidebar' + (tweaks.sidebarCollapsed ? ' collapsed' : '')}>
      <div className="brand">
        <div className="brand-mark" style={{ background: 'var(--brand)' }}>H</div>
        <div className="brand-text">HK · Owners</div>
      </div>
      {navItems.map((it: any, i) =>
        it.g ? <div key={i} className="grp">{it.g}</div> :
        <div key={it.id + (it.pid || '')}
             className={'nav-item' + (route.page === it.id && (it.pid ? route.pid === it.pid : true) ? ' active' : '')}
             onClick={() => goto(it.id, it.pid ? { pid: it.pid } : {})}>
          <Icon name={it.ico} size={16} />
          <span className="label">{it.label}</span>
        </div>
      )}
      <div style={{ flex: 1 }}></div>
      <div className="nav-item" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
        <Avi name={owner.name} size="sm" />
        <span className="label">{owner.name}</span>
      </div>
    </div>
  );
};

const OwnerHome: React.FC<{ ownerId: string }> = ({ ownerId }) => {
  const { goto, setRole } = useStore();
  const owner = OWNER_PROPS[ownerId];
  const props = owner.props.map(pid => ({ p: propById(pid), d: OWNER_DATA[pid] }));
  const total = {
    revenue:  props.reduce((s, x) => s + x.d.revenue, 0),
    payout:   props.reduce((s, x) => s + x.d.payout, 0),
    cleaning: props.reduce((s, x) => s + x.d.cleaning, 0),
    maint:    props.reduce((s, x) => s + x.d.maintenance, 0),
    nights:   props.reduce((s, x) => s + x.d.nights, 0),
    prev:     props.reduce((s, x) => s + x.d.prevPayout, 0),
  };
  const delta = ((total.payout - total.prev) / total.prev * 100).toFixed(1);

  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Dashboard' }]} right={
        <button className="btn ghost sm" onClick={() => setRole('manager')}>← Back to manager view</button>
      } />
      <div className="page">
        <div className="page-h">
          <div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>April 2026 · Month-to-date</div>
            <h1>Hello {owner.name.split(' ')[0]}</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{owner.props.length} properties · managed by Manon Vidal</div>
          </div>
          <div className="right">
            <button className="btn"><Icon name="cam" size={14} />Download April PDF</button>
            <button className="btn primary"><Icon name="msg" size={14} />Message manager</button>
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi"><div className="l">Net payout MTD</div><div className="v mono tnum">€{total.payout.toLocaleString()}</div><div className={'pill ' + (Number(delta) >= 0 ? 'good' : 'bad')} style={{ marginTop: 6 }}>{Number(delta) >= 0 ? '+' : ''}{delta}% vs March</div></div>
          <div className="kpi"><div className="l">Revenue</div><div className="v mono tnum">€{total.revenue.toLocaleString()}</div><div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{total.nights} booked nights</div></div>
          <div className="kpi"><div className="l">Cleaning</div><div className="v mono tnum">€{total.cleaning}</div><div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{Math.round(total.cleaning / props.length)} avg / property</div></div>
          <div className="kpi"><div className="l">Maintenance</div><div className="v mono tnum">€{total.maint}</div><div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{props.reduce((s, x) => s + x.d.ticketIds.length, 0)} tickets</div></div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-h"><Icon name="bldg" size={14} /><h3>Your properties</h3><div className="right"><span className="muted" style={{ fontSize: 11 }}>Tap any property for full breakdown</span></div></div>
          <table className="tbl">
            <thead><tr><th>Property</th><th style={{ width:120 }}>Occupancy</th><th style={{ width:110 }}>ADR</th><th style={{ width:130 }}>Trend</th><th style={{ width:110 }}>Revenue</th><th style={{ width:110 }}>Costs</th><th style={{ width:110 }}>Net payout</th><th style={{ width:80 }}>Tickets</th><th style={{ width:30 }}></th></tr></thead>
            <tbody>
              {props.map(({ p, d }) => {
                const trend = [d.prevPayout*0.85,d.prevPayout*0.95,d.prevPayout,d.prevPayout*1.05,d.payout*0.9,d.payout];
                const up = d.payout >= d.prevPayout;
                return (
                  <tr key={p.id} onClick={() => goto('owner-prop', { pid: p.id })}>
                    <td><div style={{ fontWeight:600 }}>{p.full}</div><div className="muted" style={{ fontSize:11 }}>{p.zone}</div></td>
                    <td><div className="row gap-6"><div style={{ flex:1,height:6,background:'var(--surface-3)',borderRadius:99,overflow:'hidden' }}><div style={{ width:d.occ+'%',height:'100%',background:'var(--brand)' }}></div></div><span className="mono tnum" style={{ fontSize:11,width:28 }}>{d.occ}%</span></div></td>
                    <td className="mono tnum">€{d.adr}</td>
                    <td><Spark data={trend} color={up?'var(--good)':'var(--bad)'} /></td>
                    <td className="mono tnum">€{d.revenue.toLocaleString()}</td>
                    <td className="mono tnum muted">−€{(d.cleaning+d.maintenance+d.mgmtFee).toLocaleString()}</td>
                    <td className="mono tnum"><b>€{d.payout.toLocaleString()}</b></td>
                    <td>{d.ticketIds.length>0?<span className="pill warn"><Icon name="wrench" size={11}/>{d.ticketIds.length}</span>:<span className="muted" style={{ fontSize:11 }}>—</span>}</td>
                    <td><Icon name="chevR" size={14} style={{ color:'var(--ink-3)' }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="split" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="card-h"><Icon name="bell" size={14} /><h3>What we did this month</h3></div>
            <div style={{ padding: 14 }}>
              {[
                ['Apr 26','✓ Resolved leaking shower at Marais 2BR — €60 plumber','Closed'],
                ['Apr 22','✓ Re-stocked supplies at all properties','Done'],
                ['Apr 18','✓ Quarterly deep-clean at Bastille 3BR','Done'],
                ['Apr 14','⚠ Guest complaint at Canal Studio resolved within 2h','Closed'],
                ['Apr 09','✓ Replaced smoke alarm batteries (€8)','Done'],
              ].map(([d,a,s],i,arr) => (
                <div key={i} className="row gap-12" style={{ padding:'10px 0',borderBottom:i<arr.length-1?'1px dashed var(--line)':'none' }}>
                  <span className="mono muted tnum" style={{ fontSize:11,width:56,flexShrink:0 }}>{d}</span>
                  <span className="grow" style={{ fontSize:12.5 }}>{a}</span>
                  <span className="pill good" style={{ fontSize:10 }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><Icon name="chart" size={14} /><h3>Year to date</h3></div>
            <div style={{ padding: 14 }}>
              <div className="row gap-12" style={{ marginBottom: 14 }}>
                <div className="grow">
                  <div className="muted" style={{ fontSize:11 }}>Total revenue YTD</div>
                  <div style={{ fontSize:24,fontWeight:700,fontFamily:'var(--mono)' }}>€{(total.revenue*4).toLocaleString()}</div>
                </div>
                <Spark data={[2400,2900,3500,4100,4800,5200,4900,total.revenue]} w={140} h={40} color="var(--brand)" />
              </div>
              <hr className="sep" />
              <div className="col gap-8" style={{ fontSize: 12 }}>
                <div className="row"><span className="muted grow">Cleaning costs YTD</span><span className="mono tnum">€{(total.cleaning*4).toLocaleString()}</span></div>
                <div className="row"><span className="muted grow">Maintenance YTD</span><span className="mono tnum">€{(total.maint*4).toLocaleString()}</span></div>
                <div className="row"><span className="muted grow">Management fee (15%)</span><span className="mono tnum">€{Math.round(total.revenue*0.15*4).toLocaleString()}</span></div>
                <div className="row" style={{ paddingTop:8,borderTop:'1px dashed var(--line)',marginTop:4 }}>
                  <span className="grow"><b>Net payout YTD</b></span>
                  <span className="mono tnum"><b>€{(total.payout*4).toLocaleString()}</b></span>
                </div>
              </div>
              <button className="btn" style={{ width:'100%',marginTop:14 }}><Icon name="cam" size={12} />Download YTD statement</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const OwnerPropertyPage: React.FC<{ ownerId: string }> = ({ ownerId }) => {
  const { route, goto, tickets, setRole } = useStore();
  const pid = route.pid || OWNER_PROPS[ownerId].props[0];
  const p = propById(pid);
  const d = OWNER_DATA[pid];
  const propTickets = tickets.filter(t => t.prop === pid);
  const upcoming = [
    ['Apr 28','Check-out → Check-in','Lara D.','4 guests','3 nights','€312'],
    ['May 02','Check-in','Müller party','2 guests','5 nights','€520'],
    ['May 12','Check-in','Tanaka','3 guests','4 nights','€440'],
  ];

  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Dashboard', onClick: () => goto('owner-home') }, { label: p.name }]} right={
        <button className="btn ghost sm" onClick={() => setRole('manager')}>← Manager view</button>
      } />
      <div className="page">
        <div className="page-h">
          <div>
            <div className="muted" style={{ fontSize:12,fontWeight:600 }}>{p.zone}</div>
            <h1>{p.full}</h1>
            <div className="muted" style={{ fontSize:13,marginTop:2 }}>{p.addr}</div>
          </div>
          <div className="right">
            <button className="btn"><Icon name="cam" size={14} />Photos</button>
            <button className="btn primary"><Icon name="msg" size={14} />Ask Manon</button>
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi"><div className="l">Revenue MTD</div><div className="v mono tnum">€{d.revenue.toLocaleString()}</div></div>
          <div className="kpi"><div className="l">Occupancy</div><div className="v mono tnum">{d.occ}%</div></div>
          <div className="kpi"><div className="l">ADR</div><div className="v mono tnum">€{d.adr}</div></div>
          <div className="kpi"><div className="l">Net payout</div><div className="v mono tnum">€{d.payout.toLocaleString()}</div></div>
        </div>

        <div className="split">
          <div className="col gap-12">
            <div className="card">
              <div className="card-h"><Icon name="cal" size={14} /><h3>Upcoming bookings</h3><div className="right"><span className="muted" style={{ fontSize:11 }}>Synced with Hostaway</span></div></div>
              <table className="tbl">
                <thead><tr><th>Date</th><th>Type</th><th>Guest</th><th>Party</th><th>Nights</th><th style={{ textAlign:'right' }}>Revenue</th></tr></thead>
                <tbody>
                  {upcoming.map((row, i) => (
                    <tr key={i}>{row.map((c,j) => <td key={j} className={j>=3||j===0?'mono tnum':''} style={j===5?{textAlign:'right'}:{}}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-h"><Icon name="wrench" size={14} /><h3>Maintenance · this month</h3></div>
              {propTickets.length === 0 ? (
                <div style={{ padding:24,textAlign:'center' }} className="muted">
                  <Icon name="check" size={20} style={{ color:'var(--good)',marginBottom:6 }} />
                  <div style={{ fontSize:13 }}>No tickets this month — everything running smoothly.</div>
                </div>
              ) : (
                <div>
                  {propTickets.map((tk, i) => (
                    <div key={tk.id} className="row gap-12" style={{ padding:'12px 14px',borderBottom:i<propTickets.length-1?'1px solid var(--line)':'none' }}>
                      <Icon name="wrench" size={14} style={{ color:'var(--ink-3)',marginTop:2 }} />
                      <div className="grow">
                        <div className="row gap-6"><b style={{ fontSize:13 }}>{tk.title}</b><Status s={tk.status} /></div>
                        <div className="muted" style={{ fontSize:11,marginTop:2 }}>{tk.created} · {tk.type}</div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div className="mono tnum" style={{ fontSize:13,fontWeight:600 }}>{tk.cost}</div>
                        <div className="muted" style={{ fontSize:10 }}>{tk.status==='closed'?'billed':'pending'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="col gap-12">
            <div className="card">
              <div className="card-h"><Icon name="chart" size={14} /><h3>April statement</h3></div>
              <div style={{ padding:14,fontSize:12.5 }}>
                <div className="row" style={{ padding:'6px 0' }}><span className="grow">Gross revenue</span><span className="mono tnum">€{d.revenue.toLocaleString()}</span></div>
                <div className="row" style={{ padding:'6px 0' }}><span className="grow muted">Channel fees (Airbnb)</span><span className="mono tnum">−€{Math.round(d.revenue*0.03)}</span></div>
                <div className="row" style={{ padding:'6px 0' }}><span className="grow muted">Cleaning ({Math.round(d.cleaning/60)} turnovers)</span><span className="mono tnum">−€{d.cleaning}</span></div>
                <div className="row" style={{ padding:'6px 0' }}><span className="grow muted">Maintenance</span><span className="mono tnum">−€{d.maintenance}</span></div>
                <div className="row" style={{ padding:'6px 0' }}><span className="grow muted">Management fee (15%)</span><span className="mono tnum">−€{d.mgmtFee}</span></div>
                <hr className="sep" />
                <div className="row" style={{ padding:'6px 0',fontSize:14 }}><span className="grow"><b>Net payout</b></span><span className="mono tnum"><b>€{d.payout.toLocaleString()}</b></span></div>
                <div className="muted" style={{ fontSize:11,marginTop:8 }}>Wire to FR76 ···· 4421 · expected May 5</div>
                <button className="btn" style={{ width:'100%',marginTop:12 }}><Icon name="cam" size={12} />Download invoice</button>
              </div>
            </div>
            <div className="card">
              <div className="card-h"><Icon name="key" size={14} /><h3>Property info</h3></div>
              <div style={{ padding:14,fontSize:12 }}>
                <div className="row" style={{ padding:'4px 0' }}><span className="grow muted">Door code</span><span className="mono">{p.code}</span></div>
                <div className="row" style={{ padding:'4px 0' }}><span className="grow muted">Wi-Fi</span><span className="mono">{p.wifi}</span></div>
                <div className="row" style={{ padding:'4px 0' }}><span className="grow muted">Zone</span><span>{p.zone}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const OwnerStatementsPage: React.FC<{ ownerId: string }> = ({ ownerId }) => {
  const { setRole } = useStore();
  const owner = OWNER_PROPS[ownerId];
  const months = ['April 2026','March 2026','February 2026','January 2026','December 2025','November 2025'];
  const props = owner.props.map(pid => ({ p: propById(pid), d: OWNER_DATA[pid] }));

  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Statements' }]} right={<button className="btn ghost sm" onClick={() => setRole('manager')}>← Manager view</button>} />
      <div className="page">
        <div className="page-h">
          <div><h1>Statements</h1><div className="muted" style={{ fontSize:13,marginTop:2 }}>Monthly financial summaries · paid to FR76 ···· 4421</div></div>
          <div className="right"><button className="btn"><Icon name="cam" size={14} />Tax report 2025</button></div>
        </div>
        <div className="card">
          <table className="tbl">
            <thead><tr><th>Month</th><th>Revenue</th><th>Costs</th><th>Mgmt fee</th><th>Net payout</th><th>Status</th><th style={{ width:80 }}></th></tr></thead>
            <tbody>
              {months.map((m,i) => {
                const factor = [1,0.92,0.78,0.84,1.18,1.05][i];
                const rev = Math.round(props.reduce((s,x)=>s+x.d.revenue,0)*factor);
                const costs = Math.round(props.reduce((s,x)=>s+x.d.cleaning+x.d.maintenance,0)*factor);
                const fee = Math.round(rev*0.15);
                const pay = rev-costs-fee-Math.round(rev*0.03);
                return (
                  <tr key={m}>
                    <td><b>{m}</b>{i===0&&<span className="pill brand" style={{ marginLeft:6 }}>current</span>}</td>
                    <td className="mono tnum">€{rev.toLocaleString()}</td>
                    <td className="mono tnum muted">−€{costs}</td>
                    <td className="mono tnum muted">−€{fee}</td>
                    <td className="mono tnum"><b>€{pay.toLocaleString()}</b></td>
                    <td><span className={'pill '+(i===0?'warn':'good')}>{i===0?'pending May 5':'paid'}</span></td>
                    <td><button className="btn sm ghost"><Icon name="cam" size={12} />PDF</button></td>
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

const OwnerMessagesPage: React.FC<{ ownerId: string }> = ({ ownerId }) => {
  const { setRole } = useStore();
  const owner = OWNER_PROPS[ownerId];
  const thread = [
    { who: 'Manon Vidal',      mine: false, time: 'Yesterday 18:22', text: 'Hi Sophie — the shower at Marais is fixed. Plumber charged €60, will appear on April statement. All good for the May 2 check-in.' },
    { who: owner.name,         mine: true,  time: 'Yesterday 18:40', text: 'Thanks Manon! Any update on the deep clean at Bastille?' },
    { who: 'Manon Vidal',      mine: false, time: 'Yesterday 18:51', text: "Scheduled for next Wednesday — Diane will do it after the morning turnover. I'll send photos." },
    { who: 'Manon Vidal',      mine: false, time: 'Today 09:14',     text: '📎 April statement preview · €5,381 net (up 11% vs March). Final invoice will go out May 1.' },
  ];

  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Messages' }]} right={<button className="btn ghost sm" onClick={() => setRole('manager')}>← Manager view</button>} />
      <div className="page" style={{ maxWidth: 720 }}>
        <div className="page-h"><div><h1>Messages with Manon</h1><div className="muted" style={{ fontSize:13,marginTop:2 }}>Property manager · usually replies within 2 hours</div></div></div>
        <div className="card" style={{ background:'var(--wa-soft)' }}>
          <div style={{ padding:18,display:'flex',flexDirection:'column',gap:10 }}>
            {thread.map((m,i) => (
              <div key={i} className="row" style={{ alignItems:'flex-end',justifyContent:m.mine?'flex-end':'flex-start',gap:8 }}>
                {!m.mine && <Avi name={m.who} size="sm" />}
                <div className={'bubble '+(m.mine?'out':'in')} style={{ maxWidth:420 }}>
                  {m.text}
                  <div className="muted" style={{ fontSize:10,marginTop:4,textAlign:'right' }}>{m.time}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="row gap-8" style={{ padding:12,background:'var(--bg)',borderTop:'1px solid var(--line)' }}>
            <input className="input" style={{ flex:1 }} placeholder="Message Manon..." />
            <button className="btn primary"><Icon name="msg" size={12} />Send</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const OwnerPortal: React.FC = () => {
  const { route } = useStore();
  const ownerId = 'O1';
  if (route.page === 'owner-prop')  return <OwnerPropertyPage ownerId={ownerId} />;
  if (route.page === 'owner-stmt')  return <OwnerStatementsPage ownerId={ownerId} />;
  if (route.page === 'owner-msgs')  return <OwnerMessagesPage ownerId={ownerId} />;
  return <OwnerHome ownerId={ownerId} />;
};

export { OwnerSidebar as default, OWNER_PROPS };
