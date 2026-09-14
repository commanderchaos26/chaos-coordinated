import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { consumeAuthDeepLink } from '../lib/authDeepLink';
import { supabase } from '../lib/supabase';

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    const handleUrl = async (url: string) => {
      try {
        const { type } = await consumeAuthDeepLink(url);
        if (type === 'invite' || type === 'recovery') {
          router.replace('/set-password');
        }
      } catch (error) {
        console.warn('Auth deep link failed', error);
      }
    };

    Linking.getInitialURL().then((url) => { if (url) void handleUrl(url); });
    const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      authSub.subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
