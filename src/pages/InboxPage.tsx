import React from 'react';
import { useStore } from '../store/store';
import { propById, staffById, STAFF } from '../store/data';
import { Icon, Status, Prio, Avi } from '../components/Icon';
import { Topbar } from '../components/Shell';

const REPLY_TEMPLATES: Record<string, (name: string) => string> = {
  plumbing:   name => `Thanks ${name} — sorry about that. Sending a plumber today before 17:00. We'll confirm an ETA shortly.`,
  electrical: name => `Thanks ${name}, noted. We'll bring a replacement on the next visit and let you know when it's done.`,
  appliance:  name => `Thanks ${name} — we'll get a replacement part ordered today. Keeping you posted on timing.`,
  lock:       name => `${name}, we're on the way! A locksmith will be there within 30 minutes. Stay near the door — we'll call when arriving.`,
  general:    name => `Thanks for the heads-up ${name} — adding it to today's restock. All sorted by tomorrow.`,
  multi:      name => `Thanks ${name} — we'll take a look at both right away. Will confirm fixes within the hour.`,
};

const replyFor = (msg: any) =>
  REPLY_TEMPLATES[msg.parsed.type]
    ? REPLY_TEMPLATES[msg.parsed.type](msg.who.split(' ')[0])
    : `Thanks ${msg.who.split(' ')[0]} — looking into it now.`;

const AIReplyCard: React.FC<{ msg: any; threshold: number; onSend: (r: string) => void; onHold?: () => void }> = ({ msg, threshold, onSend, onHold }) => {
  const conf = msg.parsed.confidence;
  const high = conf >= threshold;
  const [reply, setReply] = React.useState(replyFor(msg));
  const [editing, setEditing] = React.useState(false);
  const [countdown, setCountdown] = React.useState<number | null>(high ? 8 : null);
  const [held, setHeld] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    if (countdown === null || held || editing || sent) return;
    if (countdown === 0) { setSent(true); onSend(reply); return; }
    const t = setTimeout(() => setCountdown(c => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, held, editing, sent]);

  if (sent) {
    return (
      <div className="bubble out" style={{ alignSelf: 'flex-end' }}>
        {reply}
        <div className="meta"><Icon name="sparkle" size={10} /> auto-sent · {Math.round(conf * 100)}% confidence</div>
      </div>
    );
  }

  const confColor = conf >= 0.9 ? 'var(--good)' : conf >= 0.78 ? 'var(--brand)' : 'var(--warn)';

  return (
    <div style={{ alignSelf: 'flex-end', maxWidth: '82%', width: '82%' }}>
      <div className="card" style={{ padding: 12, background: 'var(--brand-soft)', borderColor: 'var(--brand)', borderWidth: 1 }}>
        <div className="row gap-6" style={{ marginBottom: 8 }}>
          <Icon name="sparkle" size={12} style={{ color: 'var(--brand)' }} />
          <b style={{ fontSize: 11, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '.06em' }}>AI draft reply</b>
          <span style={{ flex: 1 }}></span>
          <div className="row gap-4" style={{ alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 10, color: confColor, fontWeight: 700 }}>{Math.round(conf * 100)}%</span>
            <div style={{ width: 60, height: 4, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: (conf * 100) + '%', height: '100%', background: confColor }}></div>
            </div>
          </div>
        </div>
        {editing ? (
          <textarea className="input" value={reply} onChange={e => setReply(e.target.value)} rows={4}
                    style={{ width: '100%', resize: 'vertical', fontSize: 12.5, padding: 8 }}
                    autoFocus onBlur={() => setEditing(false)} />
        ) : (
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }} onClick={() => setEditing(true)}>
            {reply}
          </div>
        )}
        <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
          {conf >= 0.9 && '✓ High confidence — type, property and tone match training'}
          {conf >= 0.78 && conf < 0.9 && '○ Good match — review property + priority before sending'}
          {conf < 0.78 && '⚠ Below threshold — held for human review'}
        </div>
        {countdown !== null && !held && !editing && countdown > 0 && (
          <div className="row gap-6" style={{ marginTop: 8, padding: 6, background: 'var(--bg)', borderRadius: 6, fontSize: 11 }}>
            <Icon name="clock" size={11} style={{ color: 'var(--brand)' }} />
            <span className="grow">Auto-sending in {countdown}s…</span>
            <button className="btn xs" onClick={() => setHeld(true)}>Cancel</button>
          </div>
        )}
        <div className="row gap-6" style={{ marginTop: 10 }}>
          <button className="btn full sm" onClick={() => setEditing(!editing)}>
            <Icon name="wrench" size={11} />{editing ? 'Done editing' : 'Edit'}
          </button>
          <button className="btn full sm" onClick={() => { setHeld(true); onHold && onHold(); }} disabled={held}>
            <Icon name="clock" size={11} />{held ? 'Held' : 'Hold'}
          </button>
          <button className="btn full sm primary" onClick={() => { setSent(true); onSend(reply); }}>
            <Icon name="arrR" size={11} />Send now
          </button>
        </div>
      </div>
    </div>
  );
};

export const InboxPage: React.FC = () => {
  const { messages, tickets, goto, createTicketFromMsg, rejectMsg, tweaks, showToast } = useStore();
  const pending = messages.filter(m => m.status === 'pending');
  const [selId, setSelId] = React.useState(pending[0]?.id || messages[0].id);
  const sel = messages.find(m => m.id === selId) || messages[0];
  const linkedTicket = tickets.find(t => t.source === sel.id);
  const p = propById(sel.parsed.prop);

  return (
    <div className="content" style={{ overflow: 'hidden' }}>
      <Topbar crumbs={[{ label: 'WhatsApp inbox' }]} right={
        <span className="pill wa"><span className="dot"></span>Green API live</span>
      }/>
      <div className="split-3">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="card-h">
            <Icon name="msg" size={14} />
            <h3>Conversations</h3>
            <div className="right"><span className="pill bad">{pending.length} new</span></div>
          </div>
          <div className="scroll-y" style={{ flex: 1 }}>
            {messages.map(m => {
              const mp = propById(m.parsed.prop);
              return (
                <div key={m.id} onClick={() => setSelId(m.id)}
                     style={{
                       padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer',
                       background: selId === m.id ? 'var(--brand-soft)' : 'transparent',
                       borderLeft: selId === m.id ? '3px solid var(--brand)' : '3px solid transparent',
                     }}>
                  <div className="row gap-8">
                    <Avi name={m.who} size="sm" />
                    <div className="grow">
                      <div className="row"><b style={{ fontSize: 12 }}>{m.who}</b><span style={{ flex: 1 }}></span><span className="muted mono" style={{ fontSize: 10 }}>{m.time}</span></div>
                      <div className="muted elip" style={{ fontSize: 11 }}>{m.sub}</div>
                    </div>
                  </div>
                  <div className="elip" style={{ fontSize: 12, marginTop: 4, color: m.status === 'pending' ? 'var(--ink)' : 'var(--ink-3)' }}>{m.text}</div>
                  <div className="row gap-4" style={{ marginTop: 6 }}>
                    <Prio p={m.parsed.prio} compact />
                    <span className="pill ghost" style={{ fontSize: 10 }}>{mp?.name}</span>
                    {m.photo && <Icon name="cam" size={11} style={{ color: 'var(--ink-3)' }} />}
                    <span style={{ flex: 1 }}></span>
                    {m.status === 'ticketed' && <span className="pill good" style={{ fontSize: 10 }}><Icon name="check" size={10} />#{m.ticketId}</span>}
                    {m.status === 'rejected' && <span className="pill ghost" style={{ fontSize: 10 }}>dismissed</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card thread-bg" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="card-h" style={{ background: 'var(--surface)' }}>
            <Avi name={sel.who} size="sm" />
            <h3>{sel.who} · {sel.sub}</h3>
            <div className="right">
              <span className="muted mono" style={{ fontSize: 11 }}>+33 6 12 34 56 78</span>
              <button className="btn sm"><Icon name="phone" size={12} />Call</button>
            </div>
          </div>
          <div className="scroll-y" style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="muted" style={{ textAlign: 'center', fontSize: 10, fontWeight: 600 }}>Tue 28 Apr</div>
            <div className="bubble in">
              {sel.text}
              {sel.photo && <div className="placeholder" style={{ marginTop: 8, height: 110, width: 180, borderRadius: 8 }}>IMG_4421.jpg · 1.8 MB</div>}
              <div className="meta">{sel.time}</div>
            </div>
            {linkedTicket && (
              <div className="bubble out">
                Thanks {sel.who.split(' ')[0]} — we've logged it as ticket #{linkedTicket.id}. Tech on the way before {linkedTicket.due}.
                <div className="meta">{sel.time} · auto-reply</div>
              </div>
            )}
            {!linkedTicket && tweaks.autoReply && (
              <AIReplyCard msg={sel} threshold={tweaks.aiConfidence}
                onSend={() => showToast('AI reply sent · ' + sel.who)}
                onHold={() => showToast('Held for review')} />
            )}
          </div>
          <div className="row gap-6" style={{ padding: 10, borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
            <button className="btn ghost"><Icon name="cam" size={14} /></button>
            <input className="input" placeholder="Type a message…" />
            <button className="btn primary"><Icon name="arrR" size={14} /></button>
          </div>
        </div>

        <div className="col gap-12" style={{ minHeight: 0, overflow: 'auto' }}>
          {sel.status !== 'ticketed' ? (
            <div className="card pop">
              <div className="card-h" style={{ background: 'var(--brand-soft)' }}>
                <Icon name="sparkle" size={14} />
                <h3>AI suggested ticket</h3>
                <div className="right"><span className="pill brand">{Math.round(sel.parsed.confidence * 100)}% match</span></div>
              </div>
              <div style={{ padding: 14 }} className="col gap-12">
                <div>
                  <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 4 }}>Title</div>
                  <input className="input" defaultValue={sel.text.slice(0, 50)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 4 }}>Property</div>
                    <select className="input select"><option>{p?.name}</option></select>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 4 }}>Type</div>
                    <select className="input select"><option>{sel.parsed.type}</option></select>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 4 }}>Priority</div>
                    <div style={{ marginTop: 4 }}><Prio p={sel.parsed.prio} /></div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 4 }}>Assign tech</div>
                    <select className="input select" defaultValue="S5"><option value="S5">Rashid F.</option><option>Diane B.</option></select>
                  </div>
                </div>
                {sel.parsed.splits && (
                  <div style={{ padding: 8, background: 'var(--info-soft)', borderRadius: 6, fontSize: 11 }}>
                    <Icon name="sparkle" size={11} /> AI detected <b>{sel.parsed.splits} issues</b> in this message — will create {sel.parsed.splits} linked tickets.
                  </div>
                )}
                <div className="row gap-6">
                  <button className="btn full" onClick={() => rejectMsg(sel.id)}><Icon name="x" size={14} />Dismiss</button>
                  <button className="btn full primary" onClick={() => createTicketFromMsg(sel.id)}>
                    <Icon name="check" size={14} />Create ticket
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card pop">
              <div className="card-h" style={{ background: 'var(--good-soft)' }}>
                <Icon name="check" size={14} />
                <h3>Ticket created</h3>
              </div>
              <div style={{ padding: 14 }}>
                <div className="row"><span className="pill ghost mono">#{linkedTicket!.id}</span><span style={{ flex: 1 }}></span><Status s={linkedTicket!.status} /></div>
                <div style={{ fontWeight: 700, marginTop: 8 }}>{linkedTicket!.title}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Tech: {staffById(linkedTicket!.tech)?.name || 'unassigned'} · Due {linkedTicket!.due}</div>
                <button className="btn full primary" style={{ marginTop: 12 }} onClick={() => goto('ticket', { id: linkedTicket!.id })}>Open ticket <Icon name="arrR" size={14} /></button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-h"><Icon name="bldg" size={14} /><h3>Property snapshot</h3></div>
            <div style={{ padding: 12, fontSize: 12 }}>
              <div style={{ fontWeight: 700 }}>{p?.full}</div>
              <div className="muted" style={{ fontSize: 11 }}>{p?.addr}</div>
              <hr className="sep" />
              <div className="row"><span className="muted">Next checkout</span><span style={{ flex: 1 }}></span><b>Today 11:00</b></div>
              <div className="row" style={{ marginTop: 4 }}><span className="muted">Cleaner</span><span style={{ flex: 1 }}></span><b>Amina K.</b></div>
              <div className="row" style={{ marginTop: 4 }}><span className="muted">Tickets last 30d</span><span style={{ flex: 1 }}></span><b>2</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const TICKET_LIFECYCLE = [
  { key: 'open',     label: 'Reported', icon: 'msg' },
  { key: 'accepted', label: 'Accepted', icon: 'check' },
  { key: 'en-route', label: 'En route', icon: 'route' },
  { key: 'on-site',  label: 'On site',  icon: 'pin' },
  { key: 'fixed',    label: 'Fixed',    icon: 'wrench' },
  { key: 'closed',   label: 'Invoiced', icon: 'check' },
];

export const TicketPage: React.FC = () => {
  const { route, tickets, messages, assignTech, closeTicket, captureTicketPhoto, advanceTicket, setTicketCost, goto } = useStore();
  const tk = tickets.find(t => t.id === route.id) || tickets[0];
  const stage = (tk as any).stage || (tk.status === 'closed' ? 'closed' : tk.status === 'in-progress' ? 'accepted' : 'open');
  const stageIdx = TICKET_LIFECYCLE.findIndex(s => s.key === stage);
  const nextStage = TICKET_LIFECYCLE[Math.min(stageIdx + 1, TICKET_LIFECYCLE.length - 1)];
  const p = propById(tk.prop);
  const m = messages.find(x => x.id === tk.source);
  const tech = staffById(tk.tech);

  return (
    <div className="content">
      <Topbar crumbs={[
        { label: 'Tickets', onClick: () => goto('tix') },
        { label: '#' + tk.id },
      ]} />
      <div className="page">
        <div className="page-h">
          <div>
            <div className="row gap-8" style={{ marginBottom: 4 }}>
              <span className="pill ghost mono">#{tk.id}</span>
              <Prio p={tk.prio} />
              <Status s={tk.status} />
              {tk.blocksTurnover && <span className="pill bad"><Icon name="bolt" size={11} />Blocks turnover</span>}
            </div>
            <h1>{tk.title}</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{p.full} · {p.addr}</div>
          </div>
          <div className="right">
            <button className="btn"><Icon name="msg" size={14} />Send WA update</button>
            {tk.status !== 'closed' && <button className="btn primary" onClick={() => closeTicket(tk.id)}><Icon name="check" size={14} />Close ticket</button>}
          </div>
        </div>

        <div className="kpi-strip">
          <div className="kpi"><div className="l">Type</div><div className="v" style={{ fontSize: 16, textTransform: 'capitalize' }}>{tk.type}</div></div>
          <div className="kpi"><div className="l">Tech</div><div className="v" style={{ fontSize: 16 }}>{tech?.name || '— unassigned'}</div></div>
          <div className="kpi"><div className="l">Due</div><div className="v" style={{ fontSize: 16 }}>{tk.due}</div></div>
          <div className="kpi"><div className="l">Cost</div><div className="v" style={{ fontSize: 16 }}>{tk.cost}</div></div>
          <div className="kpi"><div className="l">Created</div><div className="v" style={{ fontSize: 16 }}>{tk.created}</div></div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-h"><Icon name="route" size={14} /><h3>Lifecycle</h3>
            <div className="right">
              {stage !== 'closed' && (
                <button className="btn primary sm" onClick={() => advanceTicket(tk.id)}>
                  Mark {nextStage.label.toLowerCase()} <Icon name="arrR" size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="row" style={{ padding: '18px 18px 22px', gap: 0 }}>
            {TICKET_LIFECYCLE.map((s, i) => {
              const done = i < stageIdx;
              const cur = i === stageIdx;
              return (
                <React.Fragment key={s.key}>
                  <div className="col" style={{ alignItems: 'center', gap: 6, flex: '0 0 auto', minWidth: 80 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 999,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: done ? 'var(--good)' : cur ? 'var(--brand)' : 'var(--bg-2)',
                      color: done || cur ? '#fff' : 'var(--ink-3)',
                      border: '2px solid ' + (done ? 'var(--good)' : cur ? 'var(--brand)' : 'var(--line)'),
                      boxShadow: cur ? '0 0 0 4px var(--brand-soft)' : 'none',
                    }}>
                      {done ? <Icon name="check" size={14} /> : <Icon name={s.icon} size={13} />}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: cur ? 700 : 500, color: cur ? 'var(--ink)' : 'var(--ink-2)', whiteSpace: 'nowrap' }}>{s.label}</div>
                  </div>
                  {i < TICKET_LIFECYCLE.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: i < stageIdx ? 'var(--good)' : 'var(--line)', marginTop: 15 }}></div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="split">
          <div className="col gap-12">
            {m && (
              <div className="card">
                <div className="card-h" style={{ background: 'var(--wa-soft)' }}>
                  <Icon name="msg" size={14} />
                  <h3>Source · WhatsApp</h3>
                  <div className="right"><button className="btn sm" onClick={() => goto('inbox')}>Open thread <Icon name="arrR" size={12} /></button></div>
                </div>
                <div style={{ padding: 14 }}>
                  <div className="row gap-8"><Avi name={m.who} size="sm" /><b>{m.who}</b><span className="muted">·</span><span className="muted">{m.sub}</span><span style={{ flex: 1 }}></span><span className="muted mono" style={{ fontSize: 11 }}>{m.time}</span></div>
                  <div className="bubble in" style={{ marginTop: 10, maxWidth: 'none' }}>
                    {m.text}
                    {m.photo && <div className="placeholder" style={{ marginTop: 8, height: 120, borderRadius: 8 }}>IMG_4421.jpg</div>}
                  </div>
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-h"><Icon name="clock" size={14} /><h3>Activity</h3></div>
              <div style={{ padding: 14 }}>
                {[
                  ['08:42', 'WhatsApp message received', m?.who || 'guest'],
                  ['08:43', `Auto-parsed → ticket #${tk.id} created`, 'AI'],
                  ['09:01', 'Auto-reply sent to guest', 'Manon'],
                  ['09:14', `Assigned to ${tech?.name || '—'}`, 'Manon'],
                  ['10:22', 'Tech accepted · ETA 16:30', tech?.name || '—'],
                ].map(([t, a, w], i) => (
                  <div key={i} className="row gap-12" style={{ padding: '8px 0', borderBottom: i < 4 ? '1px dashed var(--line)' : 'none' }}>
                    <span className="mono muted tnum" style={{ fontSize: 11, width: 50, flexShrink: 0 }}>{t}</span>
                    <span className="grow" style={{ fontSize: 12.5 }}>{a}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{w}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col gap-12">
            <div className="card">
              <div className="card-h"><Icon name="user" size={14} /><h3>Assignee</h3></div>
              <div style={{ padding: 14 }}>
                {tech ? (
                  <div className="row gap-8">
                    <Avi name={tech.name} size="lg" />
                    <div className="grow">
                      <b>{tech.name}</b>
                      <div className="muted" style={{ fontSize: 11 }}>{tech.role}</div>
                    </div>
                    <button className="btn sm">Change</button>
                  </div>
                ) : (
                  <div className="col gap-6">
                    {STAFF.filter(s => s.role.includes('Maintenance') || s.role.includes('Lead')).map(s => (
                      <div key={s.id} className="row gap-8" style={{ padding: 8, borderRadius: 6, cursor: 'pointer', border: '1px solid var(--line)' }}
                           onClick={() => assignTech(tk.id, s.id)}>
                        <Avi name={s.name} size="sm" />
                        <b className="grow" style={{ fontSize: 12 }}>{s.name}</b>
                        <span className="muted" style={{ fontSize: 11 }}>{s.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-h"><Icon name="cam" size={14} /><h3>Photos · before / during / after</h3></div>
              <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {['before', 'during', 'after'].map(phase => {
                  const has = (tk as any).photos?.[phase];
                  return (
                    <div key={phase} className="placeholder" style={{ height: 72, position: 'relative', cursor: 'pointer', background: has ? 'var(--good-soft)' : undefined, borderColor: has ? 'var(--good)' : undefined }}
                         onClick={() => captureTicketPhoto(tk.id, phase)}>
                      {has ? <span style={{ color: 'var(--good)', fontWeight: 700 }}>✓ {phase}</span> : <span>+ {phase}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="muted" style={{ padding: '0 12px 12px', fontSize: 11 }}>
                Tech captures each phase from mobile. After photo enables ticket close.
              </div>
            </div>
            <div className="card">
              <div className="card-h"><Icon name="dollar" size={14} /><h3>Invoice</h3>
                <div className="right">
                  <span className={'pill ' + (stage === 'closed' ? 'good' : 'ghost')}>
                    {stage === 'closed' ? 'Sent' : 'Draft'}
                  </span>
                </div>
              </div>
              <div style={{ padding: 14 }}>
                <div className="row gap-6" style={{ fontSize: 12, padding: '6px 0' }}>
                  <span className="grow muted">Labor (1.5h × €40)</span>
                  <span className="mono tnum">€60</span>
                </div>
                <div className="row gap-6" style={{ fontSize: 12, padding: '6px 0' }}>
                  <span className="grow muted">Parts</span>
                  <span className="mono tnum">€{(tk as any).parts || 0}</span>
                </div>
                <div className="row gap-6" style={{ fontSize: 12, padding: '6px 0', borderTop: '1px dashed var(--line)', marginTop: 4 }}>
                  <span className="grow"><b>Total</b></span>
                  <input className="input" type="text" value={tk.cost || '€60'} onChange={e => setTicketCost(tk.id, e.target.value)}
                         style={{ width: 80, textAlign: 'right', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: 12 }} />
                </div>
                <div className="row gap-6" style={{ marginTop: 10 }}>
                  <select className="input select" defaultValue="owner" style={{ flex: 1, fontSize: 12 }}>
                    <option value="owner">Bill: Owner</option>
                    <option value="guest">Bill: Guest</option>
                    <option value="ops">Bill: Ops (warranty)</option>
                  </select>
                </div>
                <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={stage === 'closed'}>
                  <Icon name="msg" size={12} />{stage === 'closed' ? 'Invoice sent' : 'Send via WhatsApp + email'}
                </button>
              </div>
            </div>
            <div className="card">
              <div className="card-h"><Icon name="bldg" size={14} /><h3>Linked checkout</h3></div>
              <div style={{ padding: 14, fontSize: 12 }}>
                <b>{p.full}</b><br/>
                <span className="muted">Out 11:00 · In 15:00</span>
                {tk.blocksTurnover && <div className="pill bad" style={{ marginTop: 8 }}><Icon name="bolt" size={11} />Blocks turnover</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
