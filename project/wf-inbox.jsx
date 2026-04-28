// WhatsApp inbox — 5 variations of WA → ticket conversion UX
// V1 split feed + AI suggestions · V2 unified inline parser
// V3 conversation thread + ticket card · V4 smart inbox triage queue
// V5 mobile inbox

// ─── V1 — Desktop split: feed left, AI-suggested tickets right ──────
const InboxV1 = () => (
  <Frame title="WhatsApp Inbox" sub="Green API · 6 new">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="inbox" />
      <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
        {/* Raw feed */}
        <div style={{ flex: 1, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="section-h">
            <span>Raw WhatsApp feed · #ops-paris</span>
            <span className="pill wa">● Green API connected</span>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {WA_MESSAGES.map(m => (
              <div key={m.id} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                <span className="avi">{m.avatar}</span>
                <div className="box-wa" style={{ padding: 8, flex: 1, minWidth: 0 }}>
                  <div className="row">
                    <b style={{ fontSize: 11 }}>{m.who}</b>
                    <span style={{ flex: 1 }}></span>
                    <span className="mono muted" style={{ fontSize: 10 }}>{m.time}</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>{m.text}</div>
                  {m.photo && <div className="thumb" style={{ marginTop: 6, height: 60, width: 100 }}>📷 image</div>}
                  <div className="row" style={{ marginTop: 6, gap: 4 }}>
                    <span className="pill" style={{ fontSize: 9 }}>↓ AI parsed</span>
                    <span className="pill hi" style={{ fontSize: 9 }}>{m.parsed}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* AI-suggested tickets */}
        <div style={{ width: 360, display: 'flex', flexDirection: 'column' }}>
          <div className="section-h">
            <span>AI-suggested tickets · 6</span>
            <span className="pill solid">Auto-create ⚡</span>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {TICKETS.slice(0, 5).map(t => {
              const m = msgById(t.source); const p = propById(t.prop);
              return (
                <div key={t.id} className="box" style={{ padding: 8 }}>
                  <div className="row">
                    <span className="pill ghost mono" style={{ fontSize: 9 }}>{t.id}</span>
                    <Prio p={t.prio} />
                    <span style={{ flex: 1 }}></span>
                    <span className="pill" style={{ fontSize: 9 }}>↳ {m && m.id}</span>
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 4, fontSize: 12 }}>{t.title}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{p.short} · {t.type}</div>
                  <div className="row" style={{ marginTop: 8, gap: 4 }}>
                    <span className="btn" style={{ fontSize: 10, padding: '3px 8px' }}>Edit</span>
                    <span className="btn" style={{ fontSize: 10, padding: '3px 8px' }}>Reject</span>
                    <span style={{ flex: 1 }}></span>
                    <span className="btn solid" style={{ fontSize: 10, padding: '3px 8px' }}>✓ Confirm</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    <Note style={{ position: 'absolute', right: 12, bottom: 12, maxWidth: 220 }}>
      Side-by-side audit. Manager sees source message + AI's read of it before confirming a ticket.
    </Note>
  </Frame>
);

// ─── V2 — Desktop unified inline parser ─────────────────────────────
const InboxV2 = () => (
  <Frame title="WhatsApp Inbox" sub="Inline parsing">
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar active="inbox" />
      <div style={{ flex: 1, padding: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row">
          <h2>6 new messages parsed</h2>
          <span className="muted">· Tue 28 Apr</span>
          <span style={{ flex: 1 }}></span>
          <span className="pill wa">● Green API · #ops-paris</span>
          <span className="pill">All</span>
          <span className="pill solid">Pending review · 6</span>
          <span className="pill">Confirmed · 2</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {WA_MESSAGES.slice(0, 4).map(m => {
            const t = TICKETS.find(x => x.source === m.id) || {};
            const p = propById(m.prop);
            return (
              <div key={m.id} className="box" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Original message strip */}
                <div className="box-wa" style={{ padding: 8, borderRadius: 0, borderBottom: '1px solid var(--line)', borderTop: 0, borderLeft: 0, borderRight: 0 }}>
                  <div className="row">
                    <span className="avi sm">{m.avatar}</span>
                    <b style={{ fontSize: 11 }}>{m.who}</b>
                    <span className="muted mono" style={{ fontSize: 10 }}>· {m.time}</span>
                    <span style={{ flex: 1 }}></span>
                    {m.photo && <span className="pill" style={{ fontSize: 9 }}>📷 1 image</span>}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>"{m.text}"</div>
                </div>
                {/* Parsed ticket form */}
                <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(5,1fr) auto', gap: 8, alignItems: 'center' }}>
                  <div>
                    <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Property</div>
                    <div className="in" style={{ marginTop: 2 }}>{p.short} ▾</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Type</div>
                    <div className="in" style={{ marginTop: 2 }}>{t.type || '—'} ▾</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Priority</div>
                    <div style={{ marginTop: 2 }}><Prio p={m.prio} /></div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Tech</div>
                    <div className="in" style={{ marginTop: 2 }}>{t.tech || '—'} ▾</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 9, textTransform: 'uppercase' }}>Due</div>
                    <div className="in" style={{ marginTop: 2 }}>{t.due || 'Today'} ▾</div>
                  </div>
                  <div className="row gap-4">
                    <span className="btn">✕</span>
                    <span className="btn solid">Create ticket</span>
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

// ─── V3 — Desktop conversation thread + ticket card on right ────────
const InboxV3 = () => {
  const m = WA_MESSAGES[0];
  return (
    <Frame title="WhatsApp Inbox" sub="Thread view">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="inbox" />
        {/* Convo list */}
        <div style={{ width: 220, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
          <div className="section-h" style={{ fontSize: 11 }}>Conversations</div>
          {WA_MESSAGES.map((w, i) => (
            <div key={w.id} style={{
              padding: '8px 10px', borderBottom: '1px solid var(--line-3)',
              background: i === 0 ? 'var(--paper-2)' : 'var(--paper)',
              borderLeft: i === 0 ? '3px solid var(--ink)' : '3px solid transparent',
              fontSize: 11,
            }}>
              <div className="row">
                <span className="avi sm">{w.avatar}</span>
                <b style={{ fontSize: 10 }}>{w.who.split('·')[0].trim()}</b>
                <span style={{ flex: 1 }}></span>
                <span className="mono muted" style={{ fontSize: 9 }}>{w.time}</span>
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.text}</div>
              <div className="row" style={{ marginTop: 4 }}>
                <Prio p={w.prio} />
                {w.photo && <span className="pill" style={{ fontSize: 9 }}>📷</span>}
              </div>
            </div>
          ))}
        </div>
        {/* Thread */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'repeating-linear-gradient(135deg, var(--paper) 0 18px, var(--paper-2) 18px 19px)' }}>
          <div className="section-h" style={{ background: 'var(--paper)' }}>
            <span>Sophie L. · Marais 2BR (P1)</span>
            <span className="row gap-6"><span className="pill wa">● Live</span><span className="muted">+33 6 12 34 56 78</span></span>
          </div>
          <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
            <div className="muted center" style={{ fontSize: 10, padding: 4 }}>Tue 28 Apr</div>
            <div style={{ alignSelf: 'flex-start', maxWidth: '70%' }}>
              <div className="box-wa" style={{ padding: 8, fontSize: 11 }}>
                Hi! The shower is leaking onto the bathroom floor when used.
                <div className="thumb" style={{ marginTop: 6, height: 60 }}>📷 IMG_4421.jpg</div>
                <div className="muted mono" style={{ fontSize: 9, marginTop: 4 }}>08:42</div>
              </div>
            </div>
            <div style={{ alignSelf: 'flex-end', maxWidth: '70%' }}>
              <div className="box" style={{ padding: 8, fontSize: 11, background: 'var(--paper-2)' }}>
                Thanks Sophie — sending a tech today before 17:00. Confirming back.
                <div className="muted mono" style={{ fontSize: 9, marginTop: 4 }}>09:01 · You</div>
              </div>
            </div>
            <div className="row center" style={{ fontSize: 10 }}>
              <span className="pill hi">⚡ Auto-reply suggestion ready</span>
            </div>
          </div>
          {/* Composer */}
          <div className="row" style={{ padding: 8, borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
            <div className="in full" style={{ flex: 1 }}>Type a message…</div>
            <span className="btn">📷</span>
            <span className="btn solid">Send</span>
          </div>
        </div>
        {/* Ticket panel */}
        <div style={{ width: 280, borderLeft: '1px solid var(--line)', background: 'var(--paper-2)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3>Linked ticket</h3>
          <div className="box" style={{ padding: 10 }}>
            <div className="row">
              <span className="pill ghost mono" style={{ fontSize: 10 }}>#241</span>
              <Prio p="high" />
              <span style={{ flex: 1 }}></span>
              <Status s="in-progress" />
            </div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>Shower leaking onto floor</div>
            <hr/>
            <div className="row" style={{ fontSize: 10 }}><span className="muted">Property</span><span style={{ flex: 1 }}></span><b>Marais 2BR</b></div>
            <div className="row" style={{ fontSize: 10, marginTop: 3 }}><span className="muted">Type</span><span style={{ flex: 1 }}></span>Plumbing</div>
            <div className="row" style={{ fontSize: 10, marginTop: 3 }}><span className="muted">Tech</span><span style={{ flex: 1 }}></span>Rashid F.</div>
            <div className="row" style={{ fontSize: 10, marginTop: 3 }}><span className="muted">Due</span><span style={{ flex: 1 }}></span>Today 17:00</div>
            <div className="thumb" style={{ marginTop: 8, height: 60 }}>attached photo</div>
          </div>
          <div className="btn full">View full ticket →</div>
          <h3>Property snapshot</h3>
          <div className="box-fill" style={{ padding: 8, fontSize: 10 }}>
            <div>Next checkout · Apr 28 11:00</div>
            <div className="muted">Cleaner: Amina K.</div>
            <div className="muted">2 prior tickets last 30d</div>
          </div>
        </div>
      </div>
    </Frame>
  );
};

// ─── V4 — Triage queue (Tinder-style swipe / one card at a time) ────
const InboxV4 = () => {
  const m = WA_MESSAGES[2]; // urgent example
  return (
    <Frame title="WhatsApp Triage" sub="One at a time · 6 to review">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar active="inbox" />
        <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: 'var(--paper-2)', overflow: 'hidden' }}>
          <div className="row" style={{ width: '100%', maxWidth: 560, justifyContent: 'space-between' }}>
            <span className="muted">3 of 6</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ width: 24, height: 4, background: i < 2 ? 'var(--ink)' : i === 2 ? 'var(--hi)' : 'var(--paper-3)', border: '1px solid var(--line-2)', borderRadius: 2 }}></div>
              ))}
            </div>
          </div>
          {/* Stack illusion */}
          <div style={{ position: 'relative', width: '100%', maxWidth: 560 }}>
            <div className="box" style={{ position: 'absolute', inset: 0, transform: 'translate(8px,8px) rotate(1.5deg)', opacity: 0.5 }}></div>
            <div className="box" style={{ position: 'absolute', inset: 0, transform: 'translate(4px,4px) rotate(-1deg)', opacity: 0.7 }}></div>
            <div className="box" style={{ position: 'relative', padding: 16 }}>
              <div className="row">
                <span className="avi">{m.avatar}</span>
                <div>
                  <div style={{ fontWeight: 700 }}>{m.who.split('·')[0].trim()}</div>
                  <div className="muted" style={{ fontSize: 10 }}>Bastille 3BR · {m.time}</div>
                </div>
                <span style={{ flex: 1 }}></span>
                <Prio p={m.prio} />
              </div>
              <div className="box-wa" style={{ marginTop: 10, padding: 10, fontSize: 12 }}>"{m.text}"</div>
              <hr/>
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>AI parsed →</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 6 }}>
                <div className="box-fill" style={{ padding: 6 }}><div className="muted" style={{ fontSize: 9 }}>Property</div><b style={{ fontSize: 11 }}>Bastille 3BR</b></div>
                <div className="box-fill" style={{ padding: 6 }}><div className="muted" style={{ fontSize: 9 }}>Type</div><b style={{ fontSize: 11 }}>Plumbing + Wifi</b></div>
                <div className="box-fill" style={{ padding: 6 }}><div className="muted" style={{ fontSize: 9 }}>Priority</div><b style={{ fontSize: 11 }}>Urgent</b></div>
                <div className="box-fill" style={{ padding: 6 }}><div className="muted" style={{ fontSize: 9 }}>Splits into</div><b style={{ fontSize: 11 }}>2 tickets</b></div>
              </div>
              <div className="row" style={{ marginTop: 14, gap: 8 }}>
                <div className="btn full">⏵ Skip</div>
                <div className="btn full">✕ Reject</div>
                <div className="btn full">✎ Edit</div>
                <div className="btn full solid">✓ Create 2</div>
              </div>
            </div>
          </div>
          <Note style={{ maxWidth: 560 }}>
            Triage queue · keyboard shortcuts (← skip, → confirm, E edit). Manager clears the inbox in minutes.
          </Note>
        </div>
      </div>
    </Frame>
  );
};

// ─── V5 — Mobile inbox ──────────────────────────────────────────────
const InboxV5 = () => (
  <Mobile title="Inbox" tab={1}>
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line-3)' }}>
      <div className="row gap-6">
        <span className="pill solid">All · 6</span>
        <span className="pill bad">Urgent · 2</span>
        <span className="pill warn">Today · 4</span>
      </div>
    </div>
    <div style={{ flex: 1, overflow: 'hidden' }}>
      {WA_MESSAGES.slice(0, 5).map(m => {
        const p = propById(m.prop);
        return (
          <div key={m.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-3)', display: 'flex', gap: 8 }}>
            <span className="avi" style={{ flexShrink: 0 }}>{m.avatar}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row">
                <b style={{ fontSize: 11 }}>{m.who.split('·')[0].trim()}</b>
                <span style={{ flex: 1 }}></span>
                <span className="mono muted" style={{ fontSize: 10 }}>{m.time}</span>
              </div>
              <div style={{ fontSize: 11, marginTop: 2, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{m.text}</div>
              <div className="row" style={{ marginTop: 6, gap: 4 }}>
                <span className="pill" style={{ fontSize: 9 }}>{p.short}</span>
                <Prio p={m.prio} />
                {m.photo && <span className="pill" style={{ fontSize: 9 }}>📷</span>}
                <span style={{ flex: 1 }}></span>
                <span className="pill solid" style={{ fontSize: 9 }}>+ Ticket</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  </Mobile>
);

Object.assign(window, { InboxV1, InboxV2, InboxV3, InboxV4, InboxV5 });
