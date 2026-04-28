// Shared wireframe primitives — frames, mobile shell, annotations.

const Frame = ({ title, sub, children, tabs, activeTab, footer, scroll }) => (
  <div className="wf">
    <div className="wf-bar">
      <div className="crumbs">
        <span>HK Planner</span>
        <span>›</span>
        <b>{title}</b>
        {sub && <span style={{ color: 'var(--ink-3)' }}>· {sub}</span>}
      </div>
      <div className="right">
        <span className="dot g"></span>
        <span>Hostaway · Synced</span>
        <span className="avi sm">M</span>
      </div>
    </div>
    {tabs && (
      <div className="wf-tabs">
        {tabs.map((t, i) => (
          <div key={i} className={i === activeTab ? 'on' : ''}>{t}</div>
        ))}
      </div>
    )}
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: scroll ? 'auto' : 'hidden' }}>
      {children}
    </div>
    {footer}
  </div>
);

// Mobile shell — narrow phone-like viewport
const Mobile = ({ title, children, tab = 0, footer = true }) => (
  <div className="wf" style={{ display: 'flex', flexDirection: 'column' }}>
    <div className="mob-statusbar">
      <span>9:41</span>
      <span className="mono" style={{ letterSpacing: 1 }}>·····</span>
      <span>100%</span>
    </div>
    <div style={{
      padding: '10px 14px 8px',
      borderBottom: '1px solid var(--line)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
    }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span className="avi sm">⚙</span>
        <span className="avi sm">M</span>
      </div>
    </div>
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
    {footer && (
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        borderTop: '1px solid var(--line)',
        background: 'var(--paper-2)',
        padding: '6px 0 10px',
        fontSize: 9, fontWeight: 600, textAlign: 'center'
      }}>
        {['Today', 'Tickets', 'Calendar', 'Me'].map((l, i) => (
          <div key={l} style={{ color: i === tab ? 'var(--ink)' : 'var(--ink-3)' }}>
            <div style={{ fontSize: 14 }}>{['◉','✦','▦','◐'][i]}</div>
            <div>{l}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Sidebar nav for desktop frames
const Sidebar = ({ active = 'today' }) => {
  const items = [
    { g: 'Operations' },
    { id: 'today', label: 'Today\'s checkouts', icon: '◉', count: 14 },
    { id: 'cal', label: 'Calendar', icon: '▦' },
    { id: 'props', label: 'Properties', icon: '◇', count: 47 },
    { g: 'Maintenance' },
    { id: 'inbox', label: 'WhatsApp inbox', icon: '✦', count: 6, hi: true },
    { id: 'tix', label: 'Tickets', icon: '◐', count: 23 },
    { g: 'Team' },
    { id: 'staff', label: 'Staff', icon: '◑' },
    { id: 'reports', label: 'Reports', icon: '▤' },
    { g: 'System' },
    { id: 'set', label: 'Settings', icon: '⚙' },
  ];
  return (
    <div className="side" style={{ width: 180, flexShrink: 0 }}>
      <div style={{ padding: '4px 10px 10px', fontWeight: 800, fontSize: 13, letterSpacing: '-0.01em' }}>
        ▢ HK&nbsp;Planner
      </div>
      {items.map((it, i) =>
        it.g ? <div key={i} className="grp">{it.g}</div> :
        <div key={it.id} className={'item' + (it.id === active ? ' on' : '')}>
          <span style={{ width: 12, fontSize: 10 }}>{it.icon}</span>
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.count != null && (
            <span className={'pill ' + (it.hi ? 'hi' : 'ghost')} style={{ fontSize: 9, padding: '0 5px' }}>
              {it.count}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// Annotation callout — yellow note pinned to artboard
const Note = ({ children, style, compact }) => (
  <div className={'note' + (compact ? ' compact' : '')} style={style}>
    {children}
  </div>
);

// Status pill helper
const Status = ({ s }) => {
  const map = {
    pending:  { c: 'pill', t: '○ Pending' },
    'in-progress': { c: 'pill warn', t: '◐ In progress' },
    done:     { c: 'pill good', t: '● Done' },
    blocked:  { c: 'pill bad', t: '! Blocked' },
    overdue:  { c: 'pill bad', t: '! Overdue' },
    early:    { c: 'pill info', t: '↑ Early' },
    open:     { c: 'pill', t: '○ Open' },
    closed:   { c: 'pill good', t: '✓ Closed' },
    waiting:  { c: 'pill warn', t: '⏳ Waiting parts' },
  };
  const { c, t } = map[s] || map.pending;
  return <span className={c}>{t}</span>;
};

// Priority pill
const Prio = ({ p }) => {
  const map = {
    urgent: { c: 'pill bad', t: '!!! Urgent' },
    high:   { c: 'pill warn', t: '!! High' },
    med:    { c: 'pill', t: '!  Med' },
    low:    { c: 'pill ghost', t: '·  Low' },
  };
  const { c, t } = map[p] || map.med;
  return <span className={c}>{t}</span>;
};

Object.assign(window, { Frame, Mobile, Sidebar, Note, Status, Prio });
