import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../utils/supabaseClient.js';

/**
 * V26.0 — "The Nexus Gate" (Pillar 2: Authentication Logic).
 *
 * AuthContext vive alla RADICE dell'albero (montato in main.jsx, fuori da
 * ArachnoForgeProvider): governa esclusivamente sessione/login/logout,
 * indipendentemente dal fatto che l'utente sia autenticato o meno. Questo
 * disaccoppiamento è deliberato — NexusGate (form di accesso) e Sidebar
 * (tasto Logout, HUD di sync) leggono entrambi da qui senza mai duplicare
 * un secondo listener `onAuthStateChange` (che altrimenti scatterebbe due
 * volte per ogni evento auth, sprecando render).
 *
 * `session` ha 3 stati possibili:
 *   - undefined -> bootstrap in corso (primo controllo `getSession()`)
 *   - null      -> nessun utente autenticato (mostra NexusGate)
 *   - object    -> sessione valida (monta ArachnoForgeProvider + Shell)
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });

    // Sincronizza in tempo reale login/logout/refresh token da QUALSIASI
    // punto dell'app (incluso un logout scatenato da un'altra tab del
    // browser — Supabase propaga l'evento via BroadcastChannel/storage).
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) setSession(newSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email, password, username) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // V26.0 — Pillar 3: lo username scelto in "Nuova Recluta" viaggia nei
      // metadata dell'utente Supabase, cosi' ArachnoForgeProvider puo'
      // leggerlo al primo boot cloud e usarlo come profile.username invece
      // del default "Cadetto" — nessuna scrittura extra, nessun round-trip.
      options: { data: { username: username || null } }
    });
    return { data, error };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session ? session.user : null,
      loading: session === undefined,
      signUp,
      signIn,
      signOut
    }),
    [session, signUp, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext deve essere usato dentro <AuthProvider>.');
  return ctx;
}

export default AuthContext;
