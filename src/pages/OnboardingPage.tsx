import React from 'react';
import { useStore } from '../store/store';
import { PROPS, STAFF } from '../store/data';
import { Icon } from '../components/Icon';

const STEPS = [
  { key: 'welcome',  label: 'Welcome',          icon: 'home' },
  { key: 'connect',  label: 'Connect Hostaway',  icon: 'bldg' },
  { key: 'props',    label: 'Map properties',    icon: 'check' },
  { key: 'whatsapp', label: 'WhatsApp number',   icon: 'msg' },
  { key: 'team',     label: 'Invite team',       icon: 'user' },
  { key: 'rules',    label: 'AI rules',          icon: 'sparkle' },
  { key: 'done',     label: 'Ready',             icon: 'check' },
];

const SwitchRow: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
  <div onClick={() => onChange(!on)} style={{ width:44,height:24,borderRadius:99,background:on?'var(--brand)':'var(--surface-3)',position:'relative',cursor:'pointer',transition:'background .15s',flexShrink:0 }}>
    <div style={{ position:'absolute',top:2,left:on?22:2,width:20,height:20,borderRadius:99,background:'#fff',boxShadow:'0 1px 2px rgba(0,0,0,.2)',transition:'left .15s' }}></div>
  </div>
);

export const OnboardingPage: React.FC = () => {
  const { goto, showToast } = useStore();
  const [step, setStep] = React.useState(0);
  const [hostawayKey, setHostawayKey] = React.useState('');
  const [discovered, setDiscovered] = React.useState(false);
  const [waPhone, setWaPhone] = React.useState('+33 6 ');
  const [verified, setVerified] = React.useState(false);
  const [propMap, setPropMap] = React.useState<Record<string, { include: boolean; template: string; cleaner: string }>>(() => {
    const m: Record<string, { include: boolean; template: string; cleaner: string }> = {};
    PROPS.forEach(p => { m[p.id] = { include: true, template: p.id === 'P5' ? 'Family' : 'Standard', cleaner: '' }; });
    return m;
  });
  const [invites, setInvites] = React.useState([
    { name: 'Amina K.', phone: '+33 6 12 11 22 33', role: 'Cleaner' },
    { name: 'Jorge M.', phone: '+33 6 33 44 55 66', role: 'Cleaner' },
    { name: '',         phone: '',                   role: 'Cleaner' },
  ]);
  const [rules, setRules] = React.useState({ autoCreate: false, autoReply: true, threshold: 0.78, quietStart: '22:00', quietEnd: '08:00' });

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep(s => Math.max(s - 1, 0));
  const finish = () => { showToast('Setup complete · welcome to HK Planner'); goto('today'); };

  return (
    <div style={{ position:'fixed',inset:0,background:'linear-gradient(140deg,var(--bg) 0%,var(--surface-2) 60%,var(--brand-soft) 100%)',display:'flex',flexDirection:'column',zIndex:200 }}>
      {/* Progress */}
      <div style={{ padding:'20px 32px',borderBottom:'1px solid var(--line)',background:'var(--bg)' }}>
        <div className="row" style={{ marginBottom:14 }}>
          <div className="row gap-8">
            <div className="brand-mark" style={{ width:28,height:28,fontSize:13 }}>H</div>
            <b style={{ fontSize:15 }}>HK Planner · setup</b>
          </div>
          <span style={{ flex:1 }}></span>
          <button className="btn ghost sm" onClick={() => goto('today')}>Skip for now <Icon name="x" size={12} /></button>
        </div>
        <div className="row" style={{ gap:0 }}>
          {STEPS.map((s,i) => {
            const done = i < step, cur = i === step;
            return (
              <React.Fragment key={s.key}>
                <div className="col" style={{ alignItems:'center',gap:6,flex:'0 0 auto',minWidth:80 }}>
                  <div style={{ width:28,height:28,borderRadius:999,display:'flex',alignItems:'center',justifyContent:'center',background:done?'var(--good)':cur?'var(--ink)':'var(--bg)',color:done||cur?'#fff':'var(--ink-3)',border:'2px solid '+(done?'var(--good)':cur?'var(--ink)':'var(--line)') }}>
                    {done ? <Icon name="check" size={13} /> : <Icon name={s.icon} size={12} />}
                  </div>
                  <div style={{ fontSize:11,fontWeight:cur?700:500,color:cur?'var(--ink)':'var(--ink-2)' }}>{s.label}</div>
                </div>
                {i < STEPS.length - 1 && <div style={{ flex:1,height:2,background:i<step?'var(--good)':'var(--line)',marginTop:14 }}></div>}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1,overflow:'auto',padding:'32px 24px',display:'flex',justifyContent:'center' }}>
        <div style={{ width:'100%',maxWidth:720 }}>

          {step === 0 && (
            <div className="col gap-12" style={{ textAlign:'center',paddingTop:40 }}>
              <div style={{ fontSize:56 }}>👋</div>
              <h1 style={{ fontSize:40,letterSpacing:'-0.02em' }}>Let's get you set up</h1>
              <p style={{ fontSize:16,color:'var(--ink-2)',maxWidth:520,margin:'0 auto',lineHeight:1.5 }}>
                We'll connect your channels, sync your properties, invite your team, and tune AI to match your style. Takes about 5 minutes.
              </p>
              <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginTop:24,textAlign:'left' }}>
                {[['bldg','Hostaway sync','Auto-pulls properties + bookings'],['msg','WhatsApp inbox','AI parses messages → tickets'],['sparkle','Smart rules','Tune what auto-runs vs review']].map(([ico,t,d]) => (
                  <div key={t} className="card" style={{ padding:16 }}>
                    <Icon name={ico} size={18} style={{ color:'var(--brand)' }} />
                    <b style={{ display:'block',marginTop:8,fontSize:13 }}>{t}</b>
                    <div className="muted" style={{ fontSize:11,marginTop:2 }}>{d}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="col gap-12">
              <h1 style={{ fontSize:32 }}>Connect Hostaway</h1>
              <p style={{ fontSize:14,color:'var(--ink-2)' }}>Paste your API key — we'll auto-import properties, bookings and turnover times. Read-only by default.</p>
              <div className="card" style={{ padding:18 }}>
                <div className="muted" style={{ fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6 }}>API Key</div>
                <input className="input" value={hostawayKey} onChange={e => setHostawayKey(e.target.value)} placeholder="ha_live_····················" style={{ width:'100%',fontFamily:'var(--mono)',fontSize:13 }} />
                <div className="muted" style={{ fontSize:11,marginTop:8 }}>Find it in Hostaway: <b>Settings → API → Create new key</b> · Scope: read properties, read reservations.</div>
                <button className="btn primary" style={{ marginTop:14 }} disabled={!hostawayKey||discovered}
                        onClick={() => { setDiscovered(true); showToast('Connected · 7 properties discovered'); }}>
                  {discovered ? <><Icon name="check" size={12} />Connected · 7 properties found</> : <>Connect & discover properties</>}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="col gap-12">
              <h1 style={{ fontSize:32 }}>{discovered ? '7 properties discovered' : 'Map your properties'}</h1>
              <p style={{ fontSize:14,color:'var(--ink-2)' }}>Choose which to manage in HK Planner, pick a checklist template and (optional) a default cleaner.</p>
              <div className="card">
                <table className="tbl">
                  <thead><tr><th style={{ width:36 }}></th><th>Property</th><th style={{ width:160 }}>Checklist</th><th style={{ width:180 }}>Default cleaner</th></tr></thead>
                  <tbody>
                    {PROPS.map(p => (
                      <tr key={p.id}>
                        <td><span className={'check'+(propMap[p.id].include?' on':'')} onClick={() => setPropMap({...propMap,[p.id]:{...propMap[p.id],include:!propMap[p.id].include}})}></span></td>
                        <td><b style={{ fontSize:12.5 }}>{p.full}</b><div className="muted" style={{ fontSize:11 }}>{p.zone}</div></td>
                        <td><select className="input select" value={propMap[p.id].template} onChange={e => setPropMap({...propMap,[p.id]:{...propMap[p.id],template:e.target.value}})}><option>Standard</option><option>Family</option><option>Studio</option></select></td>
                        <td><select className="input select" value={propMap[p.id].cleaner} onChange={e => setPropMap({...propMap,[p.id]:{...propMap[p.id],cleaner:e.target.value}})}>
                          <option value="">— assign per turnover —</option>
                          {STAFF.filter(s=>s.role.includes('Cleaner')||s.role.includes('Lead')).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                        </select></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="col gap-12">
              <h1 style={{ fontSize:32 }}>Connect your WhatsApp number</h1>
              <p style={{ fontSize:14,color:'var(--ink-2)' }}>Guests + cleaners will message this number. We use Green API — no app switch needed.</p>
              <div className="card" style={{ padding:18 }}>
                <div className="muted" style={{ fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6 }}>WhatsApp Business number</div>
                <input className="input" value={waPhone} onChange={e => setWaPhone(e.target.value)} style={{ width:'100%',fontFamily:'var(--mono)',fontSize:14 }} />
                <button className="btn primary" style={{ marginTop:12 }} disabled={waPhone.length<8||verified}
                        onClick={() => setTimeout(() => { setVerified(true); showToast('Number verified · webhook live'); }, 600)}>
                  {verified ? <><Icon name="check" size={12} />Verified · webhook live</> : 'Send verification code'}
                </button>
                {verified && (
                  <div style={{ marginTop:14,padding:12,background:'var(--good-soft)',borderRadius:8 }}>
                    <div className="row gap-8">
                      <Icon name="check" size={14} style={{ color:'var(--good)' }} />
                      <div className="grow" style={{ fontSize:12 }}><b>Receiving messages</b><div className="muted">Last test message received 12s ago · "ok thanks"</div></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="col gap-12">
              <h1 style={{ fontSize:32 }}>Invite your team</h1>
              <p style={{ fontSize:14,color:'var(--ink-2)' }}>Cleaners get a mobile link via WhatsApp — no login needed. They see only their own assignments.</p>
              <div className="card">
                <table className="tbl">
                  <thead><tr><th>Name</th><th style={{ width:200 }}>Phone</th><th style={{ width:140 }}>Role</th><th style={{ width:32 }}></th></tr></thead>
                  <tbody>
                    {invites.map((inv,i) => (
                      <tr key={i}>
                        <td><input className="input" value={inv.name} onChange={e=>{const n=[...invites];n[i]={...n[i],name:e.target.value};setInvites(n);}} placeholder="Name" /></td>
                        <td><input className="input" value={inv.phone} onChange={e=>{const n=[...invites];n[i]={...n[i],phone:e.target.value};setInvites(n);}} placeholder="+33 6 ··" style={{ fontFamily:'var(--mono)' }} /></td>
                        <td><select className="input select" value={inv.role} onChange={e=>{const n=[...invites];n[i]={...n[i],role:e.target.value};setInvites(n);}}><option>Cleaner</option><option>Cleaner / Lead</option><option>Maintenance</option></select></td>
                        <td><button className="btn ghost sm" onClick={()=>setInvites(invites.filter((_,j)=>j!==i))}><Icon name="x" size={12} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding:10,borderTop:'1px solid var(--line)' }}>
                  <button className="btn sm" onClick={()=>setInvites([...invites,{name:'',phone:'',role:'Cleaner'}])}><Icon name="plus" size={11} />Add another</button>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="col gap-12">
              <h1 style={{ fontSize:32 }}>Tune the AI</h1>
              <p style={{ fontSize:14,color:'var(--ink-2)' }}>You can change all of this later. Pick how aggressive the assistant should be on your behalf.</p>
              <div className="card" style={{ padding:18 }}>
                <div className="row gap-12" style={{ marginBottom:14 }}>
                  <div className="grow"><b style={{ fontSize:13 }}>Auto-reply on incoming WhatsApp</b><div className="muted" style={{ fontSize:11,marginTop:2 }}>AI sends an acknowledgement when confidence ≥ threshold</div></div>
                  <SwitchRow on={rules.autoReply} onChange={v=>setRules({...rules,autoReply:v})} />
                </div>
                <div className="row gap-12" style={{ marginBottom:14 }}>
                  <div className="grow"><b style={{ fontSize:13 }}>Auto-create tickets</b><div className="muted" style={{ fontSize:11,marginTop:2 }}>Skip review queue when confidence ≥ threshold</div></div>
                  <SwitchRow on={rules.autoCreate} onChange={v=>setRules({...rules,autoCreate:v})} />
                </div>
                <hr className="sep" />
                <div style={{ marginTop:8 }}>
                  <div className="row" style={{ marginBottom:6 }}>
                    <b style={{ fontSize:13 }}>Confidence threshold</b><span style={{ flex:1 }}></span>
                    <span className="mono tnum" style={{ fontSize:13,fontWeight:700,color:'var(--brand)' }}>{Math.round(rules.threshold*100)}%</span>
                  </div>
                  <input type="range" min="0.5" max="0.99" step="0.01" value={rules.threshold} onChange={e=>setRules({...rules,threshold:parseFloat(e.target.value)})} style={{ width:'100%' }} />
                  <div className="muted" style={{ fontSize:11,marginTop:4 }}>Higher = safer (more goes to review). Lower = faster (more auto-handled).</div>
                </div>
                <hr className="sep" />
                <div className="row gap-12" style={{ marginTop:8 }}>
                  <div className="grow"><b style={{ fontSize:13 }}>Quiet hours</b><div className="muted" style={{ fontSize:11,marginTop:2 }}>Hold non-urgent notifications during these hours</div></div>
                  <input className="input" type="time" value={rules.quietStart} onChange={e=>setRules({...rules,quietStart:e.target.value})} style={{ width:90 }} />
                  <span className="muted">to</span>
                  <input className="input" type="time" value={rules.quietEnd} onChange={e=>setRules({...rules,quietEnd:e.target.value})} style={{ width:90 }} />
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="col gap-12" style={{ textAlign:'center',paddingTop:30 }}>
              <div style={{ fontSize:64 }}>🎉</div>
              <h1 style={{ fontSize:40,letterSpacing:'-0.02em' }}>You're all set</h1>
              <p style={{ fontSize:15,color:'var(--ink-2)',maxWidth:480,margin:'0 auto' }}>
                Hostaway syncing now. We'll watch the WhatsApp inbox starting today and flag anything that needs you.
              </p>
              <div className="card" style={{ padding:18,textAlign:'left',maxWidth:480,margin:'12px auto 0' }}>
                <b style={{ fontSize:13 }}>What we did</b>
                <div className="col gap-8" style={{ marginTop:10,fontSize:12.5 }}>
                  {[
                    ['Connected Hostaway','7 properties imported'],
                    ['Verified WhatsApp',waPhone+' · live'],
                    ['Invited cleaners',invites.filter(i=>i.name).length+' people'],
                    ['Set AI rules',rules.autoReply?`auto-reply on, ${Math.round(rules.threshold*100)}% threshold`:'review-only mode'],
                  ].map(([t,d],i) => (
                    <div key={i} className="row gap-8">
                      <Icon name="check" size={14} style={{ color:'var(--good)' }} />
                      <div className="grow"><b>{t}</b><span className="muted" style={{ marginLeft:6 }}>· {d}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="row gap-8" style={{ padding:'14px 32px',borderTop:'1px solid var(--line)',background:'var(--bg)' }}>
        {step > 0 ? <button className="btn" onClick={prev}><Icon name="chevL" size={12} />Back</button> : <span></span>}
        <span style={{ flex:1 }}></span>
        <span className="muted" style={{ fontSize:11 }}>Step {step+1} of {STEPS.length}</span>
        {step < STEPS.length - 1
          ? <button className="btn primary" onClick={next} disabled={(step===1&&!discovered)||(step===3&&!verified)}>Continue <Icon name="chevR" size={12} /></button>
          : <button className="btn primary" onClick={finish}><Icon name="check" size={12} />Open dashboard</button>}
      </div>
    </div>
  );
};
