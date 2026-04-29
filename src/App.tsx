import React from 'react';
import { StoreProvider, useStore } from './store/store';
import { Sidebar, Toast } from './components/Shell';
import { OwnerSidebar } from './pages/OwnerPortal';
import { TodayPage } from './pages/TodayPage';
import { PropertyPage } from './pages/PropertyPage';
import { InboxPage, TicketPage } from './pages/InboxPage';
import { LiveOpsPage } from './pages/LiveOpsPage';
import { OwnerPortal } from './pages/OwnerPortal';
import { OnboardingPage } from './pages/OnboardingPage';
import {
  TicketsListPage, CalendarPage, TeamPage,
  ReportsPage, SettingsPage, PropertiesPage,
} from './pages/OtherPages';
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

export const App: React.FC = () => (
  <StoreProvider>
    <Router />
  </StoreProvider>
);
