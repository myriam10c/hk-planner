// App shell: sidebar, topbar, route dispatcher.

const NAV = [
  { g: 'Operations' },
  { id: 'today',   label: "Today's checkouts", ico: 'home' },
  { id: 'live',    label: 'Live ops',          ico: 'pin' },
  { id: 'cal',     label: 'Calendar', ico: 'cal' },
  { id: 'props',   label: 'Properties', ico: 'bldg' },
  { g: 'Maintenance' },
  { id: 'inbox',   label: 'WhatsApp inbox', ico: 'msg', urgent: true },
  { id: 'tix',     label: 'Tickets', ico: 'wrench' },
  { g: 'Insights' },
  { id: 'staff',   label: 'Team', ico: 'users' },
  { id: 'reports', label: 'Reports', ico: 'chart' },
  { g: 'System' },
  { id: 'settings',label: 'Settings', ico: 'cog' },
];

const Sidebar = () => {
  const { route, goto, messages, tickets, tweaks } = useStore();
  const newMsgs = messages.filter(m => m.status === 'pending').length;
  const openTix = tickets.filter(t => t.status !== 'closed').length;
  const counts = { inbox: newMsgs, tix: openTix, today: 7, props: PROPS.length };

  return (
    <div className={'sidebar' + (tweaks.sidebarCollapsed ? ' collapsed' : '')}>
      <div className="brand">
        <div className="brand-mark">H</div>
        <div className="brand-text">HK Planner</div>
      </div>
      {NAV.map((it, i) =>
        it.g ? <div key={i} className="grp">{it.g}</div> :
        <div key={it.id}
             className={'nav-item' + (route.page === it.id ? ' active' : '')}
             onClick={() => goto(it.id)}>
          <Icon name={it.ico} size={16} />
          <span className="label">{it.label}</span>
          {counts[it.id] != null && (
            <span className={'badge-sb' + (it.urgent && counts[it.id] > 0 ? ' urgent' : '')}>{counts[it.id]}</span>
          )}
        </div>
      )}
      <div style={{ flex: 1 }}></div>
      <div className="nav-item" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
        <Avi name="Manon Vidal" size="sm" />
        <span className="label">Manon Vidal</span>
        <Icon name="chevD" size={12} />
      </div>
    </div>
  );
};

const Topbar = ({ crumbs = [], right }) => {
  const { goto, role, setRole, tweaks, setTweaks } = useStore();
  return (
    <div className="topbar">
      <div className="crumbs">
        <span onClick={() => goto('today')} style={{ cursor: 'pointer' }}>HK Planner</span>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            <span className="sep">›</span>
            {c.onClick
              ? <span style={{ cursor: 'pointer' }} onClick={c.onClick}>{c.label}</span>
              : <b>{c.label || c}</b>}
          </React.Fragment>
        ))}
      </div>
      <div style={{ flex: 1 }}></div>
      <div className="search-box">
        <Icon name="search" size={14} />
        <span>Search property, ticket, guest…</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="tabs" style={{ marginLeft: 4 }}>
        <div className={role === 'manager' ? 'on' : ''} onClick={() => { setRole('manager'); goto('today'); }}>Manager</div>
        <div className={role === 'cleaner' ? 'on' : ''} onClick={() => { setRole('cleaner'); goto('today'); }}>Cleaner</div>
        <div className={role === 'owner' ? 'on' : ''} onClick={() => { setRole('owner'); goto('owner-home'); }}>Owner</div>
      </div>
      {right}
      <button className="btn ghost" title="Notifications"><Icon name="bell" size={16} /></button>
    </div>
  );
};

const Toast = () => {
  const { toast } = useStore();
  if (!toast) return null;
  return <div className="toast slide-up"><Icon name="check" size={14} />{toast}</div>;
};

Object.assign(window, { Sidebar, Topbar, Toast });
