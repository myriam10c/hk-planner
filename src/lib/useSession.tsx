import React from 'react';
import { supabase, hasSupabase } from './supabase';
import { loadSession, type AuthSession } from './auth';

export interface SessionState {
  loading: boolean;
  session: AuthSession | null;
  refresh: () => Promise<void>;
}

export const SessionCtx = React.createContext<SessionState>({
  loading: true, session: null, refresh: async () => {},
});

export const useSession = () => React.useContext(SessionCtx);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = React.useState(true);
  const [session, setSession] = React.useState<AuthSession | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const s = await loadSession();
    setSession(s);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    if (!hasSupabase) { setLoading(false); return; }
    refresh();
    const { data: sub } = supabase!.auth.onAuthStateChange((_evt) => { refresh(); });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  return (
    <SessionCtx.Provider value={{ loading, session, refresh }}>
      {children}
    </SessionCtx.Provider>
  );
};
