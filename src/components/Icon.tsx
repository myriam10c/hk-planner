import React from 'react';

export const Icon: React.FC<{ name: string; size?: number; stroke?: number; style?: React.CSSProperties }> = ({ name, size = 16, stroke = 1.75, style }) => {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style };
  const map: Record<string, React.ReactNode> = {
    home:    <path d="M3 11l9-7 9 7M5 10v10h14V10"/>,
    list:    <g><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></g>,
    cal:     <g><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></g>,
    bldg:    <g><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/></g>,
    msg:     <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>,
    wrench:  <path d="M14 7l3-3 3 3-3 3-1.5-1.5L7 17l-3 3-1-1 3-3 8.5-8.5L14 7z"/>,
    users:   <g><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M15 3.13a4 4 0 010 7.75"/></g>,
    chart:   <g><path d="M3 3v18h18"/><path d="M7 14l3-4 4 4 5-7"/></g>,
    cog:     <g><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></g>,
    search:  <g><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></g>,
    plus:    <path d="M12 5v14M5 12h14"/>,
    check:   <path d="M5 12l5 5L20 7"/>,
    x:       <path d="M6 6l12 12M6 18L18 6"/>,
    chevR:   <path d="M9 6l6 6-6 6"/>,
    chevL:   <path d="M15 6l-6 6 6 6"/>,
    chevD:   <path d="M6 9l6 6 6-6"/>,
    chevU:   <path d="M6 15l6-6 6 6"/>,
    arrR:    <path d="M5 12h14M13 5l7 7-7 7"/>,
    bell:    <g><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></g>,
    flag:    <g><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></g>,
    pin:     <g><path d="M12 21s7-7 7-12a7 7 0 00-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></g>,
    cam:     <g><path d="M3 7h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/></g>,
    clock:   <g><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>,
    bed:     <g><path d="M3 18v-7a3 3 0 013-3h12a3 3 0 013 3v7M3 18h18M3 14h18"/><circle cx="8" cy="11" r="1.5"/></g>,
    drop:    <path d="M12 3s-7 8-7 13a7 7 0 0014 0c0-5-7-13-7-13z"/>,
    bolt:    <path d="M13 2L3 14h7l-1 8 10-12h-7z"/>,
    route:   <g><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V8a4 4 0 014-4h4M18 8v8a4 4 0 01-4 4h-4"/></g>,
    dollar:  <g><path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H7"/></g>,
    key:     <g><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9 2 2-2 2 2 2-2 2-2-2"/></g>,
    snow:    <g><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/></g>,
    box:     <g><path d="M21 8L12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></g>,
    wifi:    <g><path d="M2 9a16 16 0 0120 0M5 12a12 12 0 0114 0M8 15a8 8 0 018 0"/><circle cx="12" cy="19" r="1"/></g>,
    user:    <g><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></g>,
    phone:   <path d="M22 16v3a2 2 0 01-2.18 2 19 19 0 01-8.27-3 19 19 0 01-6-6 19 19 0 01-3-8.27A2 2 0 014.55 2H7a1 1 0 011 .75l1 4-2.5 2.5a16 16 0 006.25 6.25L15 13l4 1a1 1 0 01.75 1z"/>,
    map:     <g><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></g>,
    eye:     <g><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></g>,
    sparkle: <g><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 17l.7 2 2 .8-2 .7-.7 2-.7-2-2-.7 2-.8z"/></g>,
    refresh: <g><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5"/></g>,
    moon:    <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>,
    arrUp:   <path d="M12 19V5M5 12l7-7 7 7"/>,
    arrDn:   <path d="M12 5v14M5 12l7 7 7-7"/>,
    play:    <path d="M6 4l14 8-14 8z"/>,
    paper:   <g><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h6"/></g>,
    link:    <g><path d="M10 14a5 5 0 007.5 0l3-3a5 5 0 00-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 00-7.5 0l-3 3a5 5 0 007 7L12 18.5"/></g>,
    stop:    <g><circle cx="12" cy="12" r="9"/><path d="M9 9h6v6H9z"/></g>,
    dot:     <circle cx="12" cy="12" r="3"/>,
    edit:    <path d="M12 20h9M16.5 3.5a2 2 0 113 3L7 19l-4 1 1-4z"/>,
  };
  return <svg {...props}>{map[name] || null}</svg>;
};

export const Status: React.FC<{ s: string }> = ({ s }) => {
  const map: Record<string, { c: string; t: string }> = {
    pending:     { c: 'pill ghost',    t: 'Pending' },
    'in-progress': { c: 'pill warn',  t: 'In progress' },
    done:        { c: 'pill good',    t: 'Done' },
    blocked:     { c: 'pill bad',     t: 'Blocked' },
    open:        { c: 'pill ghost',   t: 'Open' },
    closed:      { c: 'pill good',    t: 'Closed' },
    waiting:     { c: 'pill warn',    t: 'Waiting parts' },
    'in-progress-ticket': { c: 'pill warn', t: 'Working' },
  };
  const { c, t } = map[s] || map.pending;
  return <span className={c}><span className="dot"></span>{t}</span>;
};

export const Prio: React.FC<{ p: string; compact?: boolean }> = ({ p, compact }) => {
  const map: Record<string, { c: string; t: string; glyph: string }> = {
    urgent: { c: 'pill bad',  t: 'Urgent', glyph: '!!!' },
    high:   { c: 'pill warn', t: 'High',   glyph: '!!' },
    med:    { c: 'pill',      t: 'Medium', glyph: '!' },
    low:    { c: 'pill ghost',t: 'Low',    glyph: '·' },
  };
  const { c, t, glyph } = map[p] || map.med;
  return (
    <span className={c} style={compact ? { padding: '1px 6px', fontSize: 10 } : undefined}>
      <span className="mono" style={{ fontSize: 9, opacity: .8 }}>{glyph}</span>{t}
    </span>
  );
};

const aviColor = (name: string) => {
  const n = (name || '').charCodeAt(0) % 5;
  return ['c1','c2','c3','c4','c5'][n];
};

export const Avi: React.FC<{ name?: string; size?: string; extra?: string }> = ({ name = '', size = '', extra }) => {
  const ini = name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  return <span className={`avi ${size} ${aviColor(name)} ${extra || ''}`}>{ini}</span>;
};
