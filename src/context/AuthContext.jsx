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

/**
 * V28.1 — Pillar 2: identità sintetica per la Modalità Ospite — mai una
 * vera sessione Supabase. L'id fisso `guest-local` è deliberato (non un
 * uuid generato ad ogni sessione): un solo "slot" Ospite per browser,
 * cosi' che i dati Guest restino ritrovabili fra un ingresso e l'altro
 * nello stesso dispositivo (stessa chiave LocalStorage, vedi
 * utils/adminOverride.js), senza però mai toccare il Cloud.
 */
const GUEST_USER = {
  id: 'guest-local',
  email: null,
  user_metadata: { username: 'Ospite' },
  isGuest: true
};

/**
 * V37.0 — La Modalità Ospite viveva SOLO in memoria React: bastava un
 * refresh (o la chiusura della PWA) per ritrovarsi al Nexus Gate, con i
 * dati Ospite ancora al loro posto in LocalStorage ma irraggiungibili.
 * Il flag viene ora persistito insieme ad essi, con lo stesso contratto
 * "best effort" di utils/adminOverride.js: se LocalStorage non è
 * disponibile si torna semplicemente al comportamento precedente.
 */
const GUEST_FLAG_KEY = 'arachnoforge_v37_guest_active';

function readGuestFlag() {
  try {
    return window.localStorage.getItem(GUEST_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function writeGuestFlag(active) {
  try {
    if (active) window.localStorage.setItem(GUEST_FLAG_KEY, '1');
    else window.localStorage.removeItem(GUEST_FLAG_KEY);
  } catch {
    /* best effort — mai un punto di fallimento per l'accesso */
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  // V28.1 — Pillar 2: Modalità Ospite — puramente locale, indipendente dal
  // ciclo di vita della sessione Supabase. Se una sessione reale diventa
  // attiva, ha sempre priorità (vedi `value` più sotto): non possono mai
  // coesistere Guest + login reale nello stesso momento.
  // V37.0 — inizializzatore lazy: il flag viene riletto una sola volta al
  // mount, così rientrare nell'app da Ospite non passa più dal Nexus Gate.
  const [guestActive, setGuestActive] = useState(readGuestFlag);

  useEffect(() => {
    let mounted = true;

    // V37.0 — una sessione reale ha sempre la precedenza e spegne il flag
    // Ospite persistito: senza questo, il logout da un account vero
    // ricadrebbe dentro la Modalità Ospite invece che sul Nexus Gate.
    const applySession = (next) => {
      if (!mounted) return;
      if (next) {
        writeGuestFlag(false);
        setGuestActive(false);
      }
      setSession(next);
    };

    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
    });

    // Sincronizza in tempo reale login/logout/refresh token da QUALSIASI
    // punto dell'app (incluso un logout scatenato da un'altra tab del
    // browser — Supabase propaga l'evento via BroadcastChannel/storage).
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      applySession(newSession);
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

  // V28.1 — Pillar 2: signOut gestisce ENTRAMBI i percorsi con un solo
  // punto d'ingresso (Sidebar/CoreConfig non devono mai sapere se stanno
  // chiudendo una sessione Guest o reale) — Guest si limita a spegnere il
  // flag locale, nessuna chiamata di rete necessaria/possibile.
  const signOut = useCallback(async () => {
    if (guestActive) {
      writeGuestFlag(false);
      setGuestActive(false);
      return;
    }
    await supabase.auth.signOut();
  }, [guestActive]);

  const enterGuest = useCallback(() => {
    writeGuestFlag(true);
    setGuestActive(true);
  }, []);

  const value = useMemo(() => {
    const isGuest = !session && guestActive;
    return {
      session,
      user: session ? session.user : isGuest ? GUEST_USER : null,
      loading: session === undefined,
      isGuest,
      signUp,
      signIn,
      signOut,
      enterGuest
    };
  }, [session, guestActive, signUp, signIn, signOut, enterGuest]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext deve essere usato dentro <AuthProvider>.');
  return ctx;
}

export default AuthContext;
