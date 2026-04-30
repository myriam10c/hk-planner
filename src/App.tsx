import React from 'react';
import { StoreProvider, useStore } from './store/store';
import { Sidebar, Toast } from './components/Shell';
import { TodayPage } from './pages/TodayPage';
import { PropertyPage } from './pages/PropertyPage';
import { InboxPage, TicketPage } from './pages/InboxPage';
import { LiveOpsPage } from './pages/LiveOpsPage';
import { OwnerPortal, OwnerSidebar } from './pages/OwnerPortal';
import { OnboardingPage } from './pages/OnboardingPage';
import { LoginPage } from './pages/LoginPage';
import {
  TicketsListPage, CalendarPage, TeamPage,
  ReportsPage, SettingsPage, PropertiesPage,
} from './pages/OtherPages';
import { SessionProvider, useSession } from './lib/useSession';
import { hasSupabase } from './lib/supabase';
import './prototype.css';

const OWNER_PAGES = new Set(['owner-home', 'owner-prop', 'owner-stmt', 'owner-msgs']);

const Router: React.FC = () => {
  const { route, role } = useStore();
  const page = route.page;

  if (page === 'onboarding') return <OnboardingPage />;

  const isOwner = role === 'owner' || OWNER_PAGES.has(page);

  return (
    <div className="app">
      {isOwner ? <OwnerSidebar ownerId="O1" /> : <Sidebar />}
      <div className="main">
        {page === 'today'      && <TodayPage />}
        {page === 'property'   && <PropertyPage />}
        {page === 'live'       && <LiveOpsPage />}
        {page === 'cal'        && <CalendarPage />}
        {page === 'props'      && <PropertiesPage />}
        {page === 'inbox'      && <InboxPage />}
        {page === 'tix'        && <TicketsListPage />}
        {page === 'ticket'     && <TicketPage />}
        {page === 'staff'      && <TeamPage />}
        {page === 'reports'    && <ReportsPage />}
        {page === 'settings'   && <SettingsPage />}
        {OWNER_PAGES.has(page) && <OwnerPortal />}
      </div>
      <Toast />
    </div>
  );
};

const Gate: React.FC = () => {
  const { loading, session, refresh } = useSession();
  const [bypassed, setBypassed] = React.useState(!hasSupabase);

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="muted">Loading…</div>
      </div>
    );
  }

  if (hasSupabase && !session && !bypassed) {
    return <LoginPage onAuthed={() => { refresh(); setBypassed(true); }} />;
  }

  return <Router />;
};

export const App: React.FC = () => (
  <SessionProvider>
    <StoreProvider>
      <Gate />
    </StoreProvider>
  </SessionProvider>
);
