import React from 'react';
import { useStore } from '../store/store';
import { Icon, Avi } from '../components/Icon';
import { Topbar } from '../components/Shell';

const LIVE_NOW = '14:32';

const CLEANERS_LIVE = [
  { id: 'S1', name: 'Amina K.',  state: 'on-site',  job: { tid: 'T1', prop: 'P1', label: 'Marais 2BR · Apt 3A',          started: '13:42', eta: '15:00', progress: 72 }, lastPing: '14:31', battery: 78,  gps: 'rue de Bretagne · ±8m',       next: { prop: 'P5', label: 'Marais 3BR · Apt 5B', at: '15:00', sameBuilding: true }, flag: null },
  { id: 'S2', name: 'Jorge M.',  state: 'en-route', job: { tid: 'T2', prop: 'P2', label: 'Belleville Studio',              started: null,    eta: '14:50', progress: 0  }, lastPing: '14:30', battery: 54,  gps: 'metro Belleville · 6 min away', next: null, flag: null },
  { id: 'S3', name: 'Lin W.',    state: 'late',     job: { tid: 'T3', prop: 'P3', label: 'Montmartre 1BR',                 started: null,    eta: '13:30 → expected 14:50', progress: 0 }, lastPing: '14:24', battery: 12, gps: 'metro Pigalle · 22 min away', next: null, flag: 'No-show on URGENT back-to-back · guest checks in 13:00' },
  { id: 'S4', name: 'Diane B.',  state: 'on-break', job: { tid: 'T6', prop: 'P6', label: 'Latin Studio · deep clean',      started: '11:15', eta: '17:00', progress: 48 }, lastPing: '14:32', battery: 91,  gps: 'rue Mouffetard',               next: null, flag: null },
  { id: 'S5', name: 'Rashid F.', state: 'idle',     job: null, lastPing: '11:45', battery: 100, gps: 'last seen Garage', next: { prop: 'P3', label: 'Montmartre · plumbing ticket', at: '15:30', sameBuilding: false }, flag: null },
];

const ACTIVITY = [
  { id: 'a1',  time: '14:32', kind: 'ai',       icon: 'sparkle', who: 'Auto-reply',       text: 'Sent EN response to Tom R. · "Hot water back at 14:00"',                   meta: 'Confidence 92%',   tone: 'info',  actions: null },
  { id: 'a2',  time: '14:31', kind: 'ping',     icon: 'pin',     who: 'Amina K.',         text: 'Living room photo · Marais Apt 3A',                                        meta: null,               tone: 'good',  actions: null },
  { id: 'a3',  time: '14:28', kind: 'check',    icon: 'check',   who: 'Amina K.',         text: 'Checklist · 18/25 items done',                                             meta: null,               tone: 'good',  actions: null },
  { id: 'a4',  time: '14:24', kind: 'late',     icon: 'bell',    who: 'Lin W.',           text: 'Detected 54min late at Montmartre — last ping at metro Pigalle',           meta: null,               tone: 'bad',   actions: ['Call', 'Reassign'] },
  { id: 'a5',  time: '14:21', kind: 'ticket',   icon: 'wrench',  who: 'Jorge M.',         text: 'Reported wobbly chair → ticket #244 created',                              meta: null,               tone: 'warn',  actions: null },
  { id: 'a6',  time: '14:18', kind: 'guest',    icon: 'msg',     who: 'Tom R. · guest',   text: '"No hot water + wifi down" · parsed urgent (78%)',                          meta: null,               tone: 'bad',   actions: null },
  { id: 'a7',  time: '14:15', kind: 'sync',     icon: 'refresh', who: 'Hostaway',         text: 'Pulled 3 new bookings · Apr 30, May 2, May 4',                             meta: null,               tone: 'ghost', actions: null },
  { id: 'a8',  time: '14:08', kind: 'arrived',  icon: 'pin',     who: 'Jorge M.',         text: 'Left previous job · en route Belleville',                                  meta: null,               tone: 'info',  actions: null },
  { id: 'a9',  time: '14:02', kind: 'photo',    icon: 'cam',     who: 'Diane B.',         text: 'On-break · lunch logged (15min)',                                           meta: null,               tone: 'ghost', actions: null },
  { id: 'a10', time: '13:58', kind: 'check',    icon: 'check',   who: 'Diane B.',         text: 'Bedroom 2 done · photos uploaded',                                          meta: null,               tone: 'good',  actions: null },
  { id: 'a11', time: '13:51', kind: 'lock',     icon: 'check',   who: 'Amina K.',         text: 'Lockbox opened at Marais Apt 3A · code 4421',                              meta: null,               tone: 'good',  actions: null },
  { id: 'a12', time: '13:42', kind: 'start',    icon: 'pin',     who: 'Amina K.',         text: 'Started job · Marais 2BR Apt 3A',                                          meta: null,               tone: 'info',  actions: null },
  { id: 'a13', time: '13:30', kind: 'guest-ok', icon: 'msg',     who: 'Sophie L. · guest', text: 'Replied "ok thank you" → thread closed',                                  meta: null,               tone: 'good',  actions: null },
  { id: 'a14', time: '13:18', kind: 'ai',       icon: 'sparkle', who: 'Auto-reply',       text: 'Held reply to Marc D. — confidence 0.62 below threshold',                  meta: null,               tone: 'warn',  actions: null },
  { id: 'a15', time: '13:05', kind: 'restock',  icon: 'box',     who: 'Diane B.',         text: 'Logged supplies use: 3× toilet roll, 1× hand soap',                        meta: null,               tone: 'ghost', actions: null },
];

const stateMeta: Record<string, { label: string; color: string; icon: string }> = {
  'on-site':  { label: 'On site',  color: 'good',  icon: 'check' },
  'en-route': { label: 'En route', color: 'info',  icon: 'route' },
  'on-break': { label: 'On break', color: 'warn',  icon: 'bell'  },
  'idle':     { label: 'Idle',     color: 'ghost', icon: 'dot'   },
  'late':     { label: 'Late',     color: 'bad',   icon: 'bell'  },
};

const LiveStat: React.FC<{ label: string; value: number; color: string; icon: string; alert?: boolean }> = ({ label, value, color, icon, alert }) => (
  <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--line)', background: alert ? 'var(--bad-soft)' : 'var(--bg)', position: 'relative' }}>
    {alert && <div style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 99, background: 'var(--bad)', animation: 'pulse 1.6s infinite' }}></div>}
    <div className="row gap-6" style={{ color: `var(--${color === 'ghost' ? 'ink-3' : color})` }}>
      <Icon name={icon} size={12} />
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
    </div>
    <div className="mono tnum" style={{ fontSize: 28, fontWeight: 700, marginTop: 4, lineHeight: 1, color: alert ? 'var(--bad)' : 'var(--ink)' }}>{value}</div>
  </div>
);

export const LiveOpsPage: React.FC = () => {
  const { goto, showToast } = useStore();
  const [feedFilter, setFeedFilter] = React.useState('all');
  const [selectedCleaner, setSelectedCleaner] = React.useState<string | null>(null);

  const counts = {
    onSite:  CLEANERS_LIVE.filter(c => c.state === 'on-site').length,
    enRoute: CLEANERS_LIVE.filter(c => c.state === 'en-route').length,
    break:   CLEANERS_LIVE.filter(c => c.state === 'on-break').length,
    idle:    CLEANERS_LIVE.filter(c => c.state === 'idle').length,
    late:    CLEANERS_LIVE.filter(c => c.state === 'late').length,
  };

  const filteredFeed = feedFilter === 'all' ? ACTIVITY :
    feedFilter === 'alerts' ? ACTIVITY.filter(a => a.tone === 'bad' || a.tone === 'warn') :
    ACTIVITY.filter(a => a.kind === feedFilter);

  return (
    <div className="content">
      <Topbar crumbs={[{ label: 'Live ops' }]} />
      <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 'none', padding: 0 }}>
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid var(--line)' }}>
          <div className="row gap-12">
            <h1 style={{ fontSize: 22 }}>Live ops</h1>
            <div className="row gap-6" style={{ padding: '4px 10px', background: 'var(--good-soft)', border: '1px solid var(--good)', borderRadius: 99, fontSize: 11, fontWeight: 700, color: 'var(--good)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--good)', animation: 'pulse 1.6s infinite', display: 'inline-block' }}></span>
              LIVE · {LIVE_NOW}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>· auto-refresh every 10s</span>
            <span style={{ flex: 1 }}></span>
            <button className="btn"><Icon name="bell" size={13} />Notify settings</button>
            <button className="btn"><Icon name="refresh" size={13} />Refresh</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 14 }}>
            <LiveStat label="On site"  value={counts.onSite}  color="good"  icon="check" />
            <LiveStat label="En route" value={counts.enRoute} color="info"  icon="route" />
            <LiveStat label="On break" value={counts.break}   color="warn"  icon="bell" />
            <LiveStat label="Idle"     value={counts.idle}    color="ghost" icon="dot" />
            <LiveStat label="Late"     value={counts.late}    color="bad"   icon="bell" alert={counts.late > 0} />
          </div>
        </div>

        <div className="liveops-grid" style={{ flex: 1, overflow: 'hidden' }}>
          {/* LEFT — Cleaners */}
          <div style={{ borderRight: '1px solid var(--line)', overflow: 'auto' }}>
            <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
              <b style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Cleaners on shift</b>
              <span style={{ flex: 1 }}></span>
              <span className="muted" style={{ fontSize: 11 }}>{CLEANERS_LIVE.length}</span>
            </div>
            {CLEANERS_LIVE.map(c => {
              const sm = stateMeta[c.state];
              const sel = selectedCleaner === c.id;
              return (
                <div key={c.id} onClick={() => setSelectedCleaner(sel ? null : c.id)}
                     style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: sel ? 'var(--brand-soft)' : c.state === 'late' ? 'var(--bad-soft)' : 'transparent' }}>
                  <div className="row gap-10">
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <Avi name={c.name} />
                      <span style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: 99, background: `var(--${sm.color === 'ghost' ? 'ink-3' : sm.color})`, border: '2px solid var(--bg)' }}></span>
                    </div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row gap-6">
                        <b style={{ fontSize: 13 }}>{c.name}</b>
                        <span className={'pill ' + (sm.color === 'ghost' ? '' : sm.color)} style={{ fontSize: 9.5 }}>{sm.label}</span>
                      </div>
                      {c.job ? (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {c.job.label}
                          <div className="mono tnum" style={{ fontSize: 10, color: c.state === 'late' ? 'var(--bad)' : 'var(--ink-3)' }}>{c.job.eta}</div>
                        </div>
                      ) : (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>No active job</div>
                      )}
                    </div>
                  </div>
                  {c.job && c.job.progress > 0 && (
                    <div style={{ marginTop: 8, height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: c.job.progress + '%', height: '100%', background: `var(--${sm.color === 'ghost' ? 'ink-3' : sm.color})`, transition: 'width .3s' }}></div>
                    </div>
                  )}
                  {c.flag && (
                    <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--bad)', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                      <Icon name="bell" size={10} /> {c.flag}
                    </div>
                  )}
                  {sel && (
                    <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-2)', borderRadius: 8, fontSize: 11.5 }}>
                      <div className="row" style={{ marginBottom: 6 }}><span className="muted">Last ping</span><span className="mono tnum">{c.lastPing}</span></div>
                      <div className="row" style={{ marginBottom: 6 }}><span className="muted">Battery</span><span className="mono tnum" style={{ color: c.battery < 20 ? 'var(--bad)' : 'var(--ink)' }}>{c.battery}%</span></div>
                      <div className="row" style={{ marginBottom: 8 }}><span className="muted">GPS</span><span style={{ fontSize: 10.5 }}>{c.gps}</span></div>
                      {c.next && (
                        <div style={{ paddingTop: 6, borderTop: '1px dashed var(--line)' }}>
                          <span className="muted" style={{ fontSize: 10 }}>NEXT</span>
                          <div style={{ fontSize: 11.5 }}>
                            <b>{c.next.label}</b> · <span className="mono tnum">{c.next.at}</span>
                            {c.next.sameBuilding && <span className="pill good" style={{ fontSize: 9, marginLeft: 4 }}>same bldg</span>}
                          </div>
                        </div>
                      )}
                      <div className="row gap-6" style={{ marginTop: 10 }}>
                        <button className="btn sm" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); showToast('WhatsApp opened with ' + c.name); }}>
                          <Icon name="msg" size={11} />Message
                        </button>
                        <button className="btn sm" onClick={(e) => { e.stopPropagation(); showToast('Calling ' + c.name); }}>
                          <Icon name="phone" size={11} />Call
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* MIDDLE — Activity feed */}
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="row gap-4" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
              <b style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Activity</b>
              <span style={{ flex: 1 }}></span>
              {[['all', 'All'], ['alerts', 'Alerts'], ['guest', 'Guests'], ['ai', 'AI'], ['ping', 'Photos & pings']].map(([k, l]) => (
                <div key={k} onClick={() => setFeedFilter(k)} style={{ padding: '3px 8px', fontSize: 10.5, fontWeight: 600, borderRadius: 5, cursor: 'pointer', background: feedFilter === k ? 'var(--ink)' : 'transparent', color: feedFilter === k ? 'var(--bg)' : 'var(--ink-2)' }}>{l}</div>
              ))}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 60, top: 0, bottom: 0, width: 2, background: 'var(--line)' }}></div>
              {filteredFeed.map(a => (
                <div key={a.id} className="row gap-12" style={{ padding: '10px 14px', position: 'relative', background: a.tone === 'bad' ? 'var(--bad-soft)' : 'transparent', borderLeft: a.tone === 'bad' ? '3px solid var(--bad)' : '3px solid transparent' }}>
                  <span className="mono tnum" style={{ width: 38, fontSize: 11, color: 'var(--ink-3)', flexShrink: 0 }}>{a.time}</span>
                  <div style={{ width: 26, height: 26, borderRadius: 99, flexShrink: 0, background: `var(--${a.tone === 'ghost' ? 'surface-3' : (a.tone || 'info') + '-soft'})`, color: `var(--${a.tone === 'ghost' ? 'ink-3' : a.tone || 'info'})`, border: '2px solid var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                    <Icon name={a.icon} size={12} />
                  </div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row gap-6">
                      <b style={{ fontSize: 12.5 }}>{a.who}</b>
                      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{a.text}</span>
                    </div>
                    {a.meta && <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{a.meta}</div>}
                    {a.actions && (
                      <div className="row gap-6" style={{ marginTop: 6 }}>
                        {a.actions.map(ac => (
                          <button key={ac} className="btn sm" onClick={() => showToast(ac + ' Lin W.')}>{ac}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — Map + alerts */}
          <div style={{ borderLeft: '1px solid var(--line)', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
              <b style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>Live map</b>
              <span style={{ flex: 1 }}></span>
              <span className="muted" style={{ fontSize: 11 }}>Paris</span>
            </div>
            <div style={{ height: 280, position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg, #f6f4ee 0%, #ece7d8 100%)', borderBottom: '1px solid var(--line)' }}>
              <svg width="100%" height="100%" viewBox="0 0 360 280" style={{ position: 'absolute', inset: 0 }}>
                <path d="M0 80 Q120 100 200 90 T 360 70" stroke="rgba(0,0,0,.07)" strokeWidth="14" fill="none"/>
                <path d="M40 280 Q60 200 80 140 T 130 0" stroke="rgba(0,0,0,.07)" strokeWidth="10" fill="none"/>
                <path d="M0 200 Q150 220 250 180 T 360 220" stroke="rgba(0,0,0,.06)" strokeWidth="9" fill="none"/>
                <path d="M220 0 Q230 80 250 140 T 290 280" stroke="rgba(0,0,0,.06)" strokeWidth="8" fill="none"/>
                <path d="M0 160 Q100 145 180 165 Q260 185 360 155" stroke="rgba(86,140,196,.5)" strokeWidth="22" fill="none"/>
              </svg>
              {[
                { top: 60,  left: 145, label: 'AK', state: 'good',  name: 'Marais 2BR' },
                { top: 175, left: 260, label: 'JM', state: 'info',  name: 'en route'   },
                { top: 38,  left: 235, label: 'LW', state: 'bad',   name: '54min late' },
                { top: 220, left: 80,  label: 'DB', state: 'warn',  name: 'on break'   },
                { top: 130, left: 65,  label: 'RF', state: 'ghost', name: 'idle'       },
              ].map((pin, i) => (
                <div key={i} style={{ position: 'absolute', top: pin.top, left: pin.left, transform: 'translate(-50%,-50%)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', background: `var(--${pin.state === 'ghost' ? 'ink-3' : pin.state})`, boxShadow: '0 4px 8px rgba(0,0,0,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ transform: 'rotate(45deg)', color: '#fff', fontSize: 10, fontWeight: 800, fontFamily: 'var(--mono)' }}>{pin.label}</span>
                  </div>
                  {pin.state === 'bad' && <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '2px solid var(--bad)', opacity: .4, animation: 'pulse 1.4s infinite' }}></div>}
                </div>
              ))}
              <div style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 9, color: 'var(--ink-3)', background: 'rgba(255,255,255,.7)', padding: '2px 6px', borderRadius: 4 }}>Demo · Mapbox in production</div>
            </div>

            <div style={{ padding: 12 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <b style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--bad)' }}>Needs attention</b>
                <span style={{ flex: 1 }}></span>
                <span className="pill bad" style={{ fontSize: 10 }}>3</span>
              </div>
              <div className="col gap-8">
                <div style={{ padding: 10, background: 'var(--bad-soft)', border: '1px solid var(--bad)', borderRadius: 8 }}>
                  <div className="row gap-6"><Icon name="bell" size={12} style={{ color: 'var(--bad)' }} /><b style={{ fontSize: 12 }}>Lin W. · 54min late</b></div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>URGENT back-to-back at Montmartre — guest checks in at 13:00.</div>
                  <div className="row gap-6" style={{ marginTop: 8 }}>
                    <button className="btn sm" style={{ flex: 1 }}>Call</button>
                    <button className="btn sm primary" style={{ flex: 1 }}>Reassign</button>
                  </div>
                </div>
                <div style={{ padding: 10, background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 8 }}>
                  <div className="row gap-6"><Icon name="bell" size={12} style={{ color: 'var(--warn)' }} /><b style={{ fontSize: 12 }}>Lin W. · battery 12%</b></div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>May lose tracking soon.</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bad-soft)', border: '1px solid var(--bad)', borderRadius: 8 }}>
                  <div className="row gap-6"><Icon name="msg" size={12} style={{ color: 'var(--bad)' }} /><b style={{ fontSize: 12 }}>Tom R. · "no hot water"</b></div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Urgent guest message · AI auto-replied, ticket #243 awaiting tech.</div>
                  <button className="btn sm" style={{ marginTop: 8, width: '100%' }} onClick={() => goto('inbox')}>Open thread</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%{transform:scale(1);opacity:1} 70%{transform:scale(1.6);opacity:0} 100%{transform:scale(1);opacity:0} }
        .liveops-grid { display:grid; grid-template-columns:260px minmax(0,1fr) 300px; }
        .liveops-grid > * { min-width:0; }
        @media(max-width:820px){ .liveops-grid{grid-template-columns:240px minmax(0,1fr)} .liveops-grid>:nth-child(3){grid-column:1/-1;border-left:none!important;border-top:1px solid var(--line)} }
        @media(max-width:560px){ .liveops-grid{grid-template-columns:1fr} .liveops-grid>:nth-child(1){border-right:none!important;border-bottom:1px solid var(--line);max-height:220px} }
      `}</style>
    </div>
  );
};
