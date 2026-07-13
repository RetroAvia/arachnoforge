import React, { useState, useCallback, useRef } from 'react';
import { Icon } from './Icons.jsx';
import ParticleWeb from './ParticleWeb.jsx';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useAudioEngine } from '../hooks/useAudioEngine.js';

const MODES = { LOGIN: 'login', SIGNUP: 'signup' };

/**
 * Traduce i messaggi d'errore grezzi di Supabase Auth in alert
 * "olografici" in stile Karen — mai un errore di sistema crudo mostrato
 * all'utente. Match per sottostringa (case-insensitive): Supabase non
 * garantisce codici stabili su tutte le versioni, ma i testi in inglese
 * restano sufficientemente prevedibili per un mapping euristico.
 */
function translateAuthError(rawMessage) {
  const msg = (rawMessage || '').toLowerCase();
  if (msg.includes('invalid login credentials')) return 'Karen: credenziali errate. Accesso al Nexus negato.';
  if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already'))
    return 'Karen: questa identità biometrica è già registrata sul Web-Matrix. Prova ad accedere invece.';
  if (msg.includes('password') && (msg.includes('6 characters') || msg.includes('at least')))
    return 'Karen: password troppo debole — servono almeno 6 caratteri per superare i firewall Stark.';
  if (msg.includes('unable to validate email') || msg.includes('invalid email') || msg.includes('invalid format'))
    return 'Karen: formato email non riconosciuto dai server Stark.';
  if (msg.includes('email not confirmed')) return 'Karen: email non ancora confermata. Controlla la posta in arrivo prima di accedere.';
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Karen: troppi tentativi ravvicinati. Attendi qualche secondo prima di riprovare.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Karen: connessione ai satelliti Stark interrotta. Controlla la rete.';
  return rawMessage ? `Karen: accesso al Nexus fallito — ${rawMessage}` : 'Karen: accesso al Nexus fallito. Riprova.';
}

/** Input del terminale — icona prefisso, glow neon on-focus (blu per identità, rosso per credenziali). */
function NexusInput({ icon, type, value, onChange, placeholder, onTic, autoComplete, glow = 'secondary' }) {
  const glowClass =
    glow === 'primary'
      ? 'focus:border-primary focus:shadow-primary-glow'
      : 'focus:border-secondary focus:shadow-secondary-glow';
  return (
    <div className="relative">
      <Icon name={icon} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
      <input
        type={type}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (onTic) onTic();
        }}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`w-full bg-surface/80 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none transition-all duration-300 ${glowClass}`}
      />
    </div>
  );
}

export default function NexusGate() {
  const { signIn, signUp, enterGuest } = useAuthContext();
  const audio = useAudioEngine({ enabled: true });

  const [mode, setMode] = useState(MODES.LOGIN);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // messaggio neutro/informativo (es. "conferma la tua email")
  const formKeyRef = useRef(0);

  const switchMode = useCallback(
    (nextMode) => {
      if (nextMode === mode || submitting) return;
      audio.playWebClick();
      setMode(nextMode);
      setError(null);
      setNotice(null);
      formKeyRef.current += 1;
    },
    [mode, submitting, audio]
  );

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      setNotice(null);

      const cleanEmail = email.trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        setError('Karen: inserisci un indirizzo email valido per procedere.');
        audio.playAccessDenied();
        return;
      }
      if (password.length < 6) {
        setError('Karen: la password deve contenere almeno 6 caratteri.');
        audio.playAccessDenied();
        return;
      }
      if (mode === MODES.SIGNUP && password !== confirmPassword) {
        setError('Karen: le password non coincidono. Ricontrolla i campi.');
        audio.playAccessDenied();
        return;
      }

      setSubmitting(true);
      try {
        if (mode === MODES.LOGIN) {
          const { error: authError } = await signIn(cleanEmail, password);
          if (authError) {
            setError(translateAuthError(authError.message));
            audio.playAccessDenied();
            setSubmitting(false);
            return;
          }
          // Successo: App.jsx reagirà al cambio di sessione da solo (via
          // AuthContext -> onAuthStateChange) smontando il Nexus Gate e
          // montando la Shell con la sua transizione epica in fade-in.
          audio.playAccessGranted();
        } else {
          const { data, error: authError } = await signUp(cleanEmail, password, username.trim());
          if (authError) {
            setError(translateAuthError(authError.message));
            audio.playAccessDenied();
            setSubmitting(false);
            return;
          }
          if (data && data.session) {
            // Progetto Supabase senza conferma email obbligatoria: sessione
            // già attiva, stesso trattamento del login riuscito.
            audio.playAccessGranted();
          } else {
            // Conferma email richiesta dal progetto: nessuna sessione
            // ancora attiva. Nessun errore — Karen informa e riporta a
            // "Accesso Riconosciuto" cosi' l'utente puo' rientrare dopo
            // aver confermato, senza restare bloccato sul form Recluta.
            audio.playAccessGranted();
            setNotice('Karen: identità registrata sul Web-Matrix. Controlla la tua email per confermare l\'account, poi accedi da qui.');
            setMode(MODES.LOGIN);
            formKeyRef.current += 1;
            setPassword('');
            setConfirmPassword('');
          }
          setSubmitting(false);
        }
      } catch (err) {
        setError(translateAuthError(err && err.message));
        audio.playAccessDenied();
        setSubmitting(false);
      }
    },
    [submitting, email, password, confirmPassword, username, mode, signIn, signUp, audio]
  );

  // V28.1 — Pillar 2: login Guest immediato, nessuna credenziale, nessuna
  // chiamata Supabase — App.jsx smonta il Nexus Gate non appena
  // `isGuest` diventa true, esattamente come dopo un login riuscito.
  const handleGuest = useCallback(() => {
    if (submitting) return;
    audio.playAccessGranted();
    enterGuest();
  }, [submitting, audio, enterGuest]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-af-bg">
      {/* Sfondo — rete neurale a particelle, toni Rosso/Blu del Classic Suit. */}
      <div className="absolute inset-0 opacity-70">
        <ParticleWeb />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_15%,rgb(var(--af-surface-rgb))_92%)] pointer-events-none" />
      <div className="af-grain" />

      {/* Card — glassmorphism estremo, cornici angolari da "Terminale di Ingaggio". */}
      <div className="relative w-full max-w-md mx-4">
        <div className="relative bg-surface/60 backdrop-blur-2xl border border-secondary/25 rounded-3xl shadow-[0_20px_70px_rgba(0,0,0,0.6)] p-7 sm:p-8 overflow-hidden af-nexus-card-in">
          <div className="absolute -top-20 -left-16 w-52 h-52 rounded-full bg-primary/15 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -right-16 w-52 h-52 rounded-full bg-secondary/15 blur-3xl pointer-events-none" />
          <div className="absolute inset-x-0 top-0 h-1/3 opacity-[0.05] pointer-events-none animate-scanline bg-gradient-to-b from-transparent via-white to-transparent" />

          <span className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-secondary/50 rounded-tl-lg pointer-events-none" />
          <span className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-secondary/50 rounded-tr-lg pointer-events-none" />
          <span className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-secondary/50 rounded-bl-lg pointer-events-none" />
          <span className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-secondary/50 rounded-br-lg pointer-events-none" />

          {/* Header */}
          <div className="relative flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white shadow-primary-glow-lg border-t border-white/20 mb-3">
              <Icon name="target" className="w-8 h-8" />
            </div>
            <p className="text-2xl font-extrabold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              NEXUS GATE
            </p>
            <p className="text-[11px] font-mono tracking-[0.2em] text-slate-500 mt-1">KAREN OS // WEB-MATRIX ACCESS TERMINAL</p>
          </div>

          {/* Tab switcher — highlight scorrevole */}
          <div className="relative grid grid-cols-2 bg-surface/70 border border-white/10 rounded-xl p-1 mb-6">
            <div
              className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-lg bg-gradient-to-r from-primary to-primary-dark shadow-primary-glow transition-transform duration-300 ease-out"
              style={{ transform: mode === MODES.SIGNUP ? 'translateX(calc(100% + 8px))' : 'translateX(0)' }}
            />
            <button
              type="button"
              onMouseEnter={() => audio.playHoverBlip()}
              onClick={() => switchMode(MODES.LOGIN)}
              className={`relative z-10 py-2.5 text-[11px] font-bold tracking-widest uppercase transition-colors duration-300 ${
                mode === MODES.LOGIN ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Accesso Riconosciuto
            </button>
            <button
              type="button"
              onMouseEnter={() => audio.playHoverBlip()}
              onClick={() => switchMode(MODES.SIGNUP)}
              className={`relative z-10 py-2.5 text-[11px] font-bold tracking-widest uppercase transition-colors duration-300 ${
                mode === MODES.SIGNUP ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Nuova Recluta
            </button>
          </div>

          {/* Alert olografico — errore */}
          {error && (
            <div className="relative mb-4 af-holo-alert-in">
              <div className="flex items-start gap-2.5 bg-primary/10 border border-primary/40 rounded-xl px-3.5 py-3 shadow-primary-glow">
                <Icon name="alertTriangle" className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-primary leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {/* Alert olografico — notice informativo (conferma email, etc.) */}
          {notice && !error && (
            <div className="relative mb-4 af-holo-alert-in">
              <div className="flex items-start gap-2.5 bg-secondary/10 border border-secondary/40 rounded-xl px-3.5 py-3 shadow-secondary-glow">
                <Icon name="mail" className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
                <p className="text-xs text-secondary leading-relaxed">{notice}</p>
              </div>
            </div>
          )}

          {/* Form — crossfade fra Login/Signup via remount su key */}
          <form key={formKeyRef.current} onSubmit={handleSubmit} className="relative space-y-3.5 af-nexus-form-in">
            {mode === MODES.SIGNUP && (
              <NexusInput
                icon="user"
                type="text"
                value={username}
                onChange={setUsername}
                onTic={audio.playTypingTic}
                placeholder="Nome Cadetto (opzionale)"
                autoComplete="nickname"
                glow="secondary"
              />
            )}
            <NexusInput
              icon="mail"
              type="email"
              value={email}
              onChange={setEmail}
              onTic={audio.playTypingTic}
              placeholder="Indirizzo email"
              autoComplete="email"
              glow="secondary"
            />
            <NexusInput
              icon="lock"
              type="password"
              value={password}
              onChange={setPassword}
              onTic={audio.playTypingTic}
              placeholder="Password"
              autoComplete={mode === MODES.LOGIN ? 'current-password' : 'new-password'}
              glow="primary"
            />
            {mode === MODES.SIGNUP && (
              <NexusInput
                icon="lock"
                type="password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                onTic={audio.playTypingTic}
                placeholder="Conferma Password"
                autoComplete="new-password"
                glow="primary"
              />
            )}

            <button
              type="submit"
              disabled={submitting}
              onMouseEnter={() => !submitting && audio.playHoverBlip()}
              className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-primary-dark text-white font-bold tracking-widest uppercase text-sm px-6 py-3.5 rounded-xl shadow-primary-glow hover:shadow-primary-glow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 border-t border-white/20 disabled:opacity-60 disabled:pointer-events-none mt-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connessione ai satelliti Stark in corso...
                </>
              ) : (
                <>
                  <Icon name={mode === MODES.LOGIN ? 'shield' : 'bolt'} className="w-5 h-5" />
                  {mode === MODES.LOGIN ? 'Autentica Accesso' : 'Registra Nuova Recluta'}
                </>
              )}
            </button>
          </form>

          {/* V28.1 — Pillar 2: accesso Guest — divider + pulsante secondario,
              deliberatamente meno prominente del CTA primario (l'account
              reale resta il percorso consigliato, il Guest è una via rapida
              di prova). */}
          <div className="relative flex items-center gap-3 mt-5">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] font-mono tracking-widest text-slate-600">OPPURE</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <button
            type="button"
            onClick={handleGuest}
            disabled={submitting}
            onMouseEnter={() => !submitting && audio.playHoverBlip()}
            className="relative w-full mt-4 inline-flex items-center justify-center gap-2 bg-white/[0.03] backdrop-blur-md border border-white/10 text-slate-300 font-semibold tracking-wide text-sm px-5 py-3 rounded-xl hover:bg-white/[0.07] hover:border-secondary/40 hover:text-white transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Icon name="user" className="w-5 h-5" />
            Continua come Ospite
          </button>
          <p className="relative text-center text-[10px] text-slate-600 mt-2 leading-relaxed">
            Dati salvati solo su questo browser — nessun account, nessuna sincronizzazione Cloud.
          </p>

          <p className="relative text-center text-[10px] font-mono tracking-widest text-slate-600 mt-6">
            CONNESSIONE CRITTOGRAFATA // SUPABASE AUTH // ARACHNOFORGE V28.1
          </p>
        </div>
      </div>
    </div>
  );
}
