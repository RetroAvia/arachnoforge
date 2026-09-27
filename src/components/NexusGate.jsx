import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icons.jsx';
import ParticleWeb from './ParticleWeb.jsx';
import PasswordField from './PasswordField.jsx';
import { useAuthContext } from '../context/AuthContext.jsx';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { APP_VERSION } from '../utils/appVersion.js';
import {
  LOGIN_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
  describeRedirectError,
  isPlausibleEmail,
  translateAuthError
} from '../utils/authFlow.js';

const MODES = { LOGIN: 'login', SIGNUP: 'signup', RESET: 'reset' };

const SUBMIT_LABEL = {
  [MODES.LOGIN]: { idle: 'Accedi', busy: 'Accesso in corso…', icon: 'arrowRight' },
  [MODES.SIGNUP]: { idle: 'Crea account', busy: 'Creazione dell’account…', icon: 'bolt' },
  [MODES.RESET]: { idle: 'Invia link di recupero', busy: 'Invio in corso…', icon: 'mail' }
};

function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Campo testo con etichetta e icona a sinistra. */
function TextField({ id, label, icon, type = 'text', value, onChange, onType, placeholder, autoComplete, autoFocus, inputRef, hint }) {
  return (
    <div>
      <label htmlFor={id} className="ds-label">
        {label}
      </label>
      <div className="relative">
        <Icon name={icon} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <input
          id={id}
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (onType) onType();
          }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-describedby={hint ? `${id}-help` : undefined}
          className="ds-input pl-9"
        />
      </div>
      {hint && (
        <p id={`${id}-help`} className="text-xs text-slate-500 mt-1.5">
          {hint}
        </p>
      )}
    </div>
  );
}

function Alert({ tone, icon, children }) {
  const tones = {
    danger: 'border-primary/35 bg-primary/[0.07] text-primary',
    info: 'border-secondary/35 bg-secondary/[0.07] text-secondary',
    neutral: 'border-line-strong bg-white/[0.03] text-slate-300'
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed af-holo-alert-in ${tones[tone]}`}
    >
      <Icon name={icon} className="w-4 h-4 shrink-0 mt-0.5" />
      <p>{children}</p>
    </div>
  );
}

/**
 * Nexus Gate — la porta d'ingresso: accesso, nuovo account, recupero
 * della password e Modalità Ospite. Nessuna logica di sessione qui: tutto
 * passa da AuthContext, e App.jsx smonta questa schermata da solo appena
 * una sessione (o l'Ospite) diventa attiva.
 */
export default function NexusGate() {
  const { signIn, signUp, enterGuest, requestPasswordReset, redirectError, consumeRedirectError } = useAuthContext();
  const audio = useAudioEngine({ enabled: true });
  const online = useOnlineStatus();

  const [mode, setMode] = useState(MODES.LOGIN);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Un link email scaduto arriva qui già come errore da spiegare.
  const [error, setError] = useState(() => describeRedirectError(redirectError));
  const [notice, setNotice] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const emailRef = useRef(null);

  // Letto e mostrato: da qui in poi l'errore del link vive solo in questa schermata.
  useEffect(() => {
    if (redirectError) consumeRedirectError();
  }, [redirectError, consumeRedirectError]);

  const switchMode = useCallback(
    (nextMode) => {
      if (nextMode === mode || submitting) return;
      audio.playWebClick();
      setMode(nextMode);
      setError(null);
      setNotice(null);
      setPassword('');
      setConfirmPassword('');
      setFormKey((k) => k + 1);
    },
    [mode, submitting, audio]
  );

  const fail = useCallback(
    (message) => {
      setError(message);
      audio.playAccessDenied();
      setSubmitting(false);
    },
    [audio]
  );

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);
      setNotice(null);

      const cleanEmail = email.trim();
      if (!isPlausibleEmail(cleanEmail)) {
        fail('Inserisci un indirizzo email valido.');
        emailRef.current?.focus();
        return;
      }

      // ---- Recupero della password -----------------------------------
      if (mode === MODES.RESET) {
        setSubmitting(true);
        try {
          const { error: authError } = await requestPasswordReset(cleanEmail);
          if (authError) {
            fail(translateAuthError(authError.message));
            return;
          }
          audio.playAccessGranted();
          setNotice(
            `Se esiste un account per ${cleanEmail}, ti è arrivata un’email con il link per scegliere una nuova password (controlla anche lo spam).`
          );
          setMode(MODES.LOGIN);
          setFormKey((k) => k + 1);
          setSubmitting(false);
        } catch (err) {
          fail(translateAuthError(err && err.message));
        }
        return;
      }

      // V37.0 — La soglia è 10 caratteri SOLO per una password nuova: al
      // login resta 6, per non chiudere fuori un account creato prima con
      // una password più corta. Il minimo va alzato anche lato server
      // (Supabase → Auth → Password requirements): questa è la prima linea.
      const minLength = mode === MODES.SIGNUP ? NEW_PASSWORD_MIN_LENGTH : LOGIN_PASSWORD_MIN_LENGTH;
      if (password.length < minLength) {
        fail(`La password deve avere almeno ${minLength} caratteri.`);
        return;
      }
      if (mode === MODES.SIGNUP && password !== confirmPassword) {
        fail('Le due password non coincidono.');
        return;
      }

      setSubmitting(true);
      try {
        if (mode === MODES.LOGIN) {
          const { error: authError } = await signIn(cleanEmail, password);
          if (authError) {
            fail(translateAuthError(authError.message, { minLength }));
            return;
          }
          // Successo: App.jsx reagisce al cambio di sessione (AuthContext →
          // onAuthStateChange) e smonta il Nexus Gate da solo.
          audio.playAccessGranted();
          return;
        }

        const { data, error: authError } = await signUp(cleanEmail, password, username.trim());
        if (authError) {
          fail(translateAuthError(authError.message, { minLength }));
          return;
        }
        audio.playAccessGranted();
        if (!(data && data.session)) {
          // Conferma email richiesta dal progetto: nessuna sessione ancora.
          // Si torna su "Accedi", pronti a rientrare dopo la conferma.
          setNotice(`Account creato. Apri il link che ti è arrivato a ${cleanEmail} per confermarlo, poi accedi da qui.`);
          setMode(MODES.LOGIN);
          setFormKey((k) => k + 1);
          setPassword('');
          setConfirmPassword('');
        }
        setSubmitting(false);
      } catch (err) {
        fail(translateAuthError(err && err.message, { minLength }));
      }
    },
    [submitting, email, password, confirmPassword, username, mode, signIn, signUp, requestPasswordReset, audio, fail]
  );

  // V28.1 — Modalità Ospite: nessuna credenziale, nessuna chiamata di rete.
  const handleGuest = useCallback(() => {
    if (submitting) return;
    audio.playAccessGranted();
    enterGuest();
  }, [submitting, audio, enterGuest]);

  const label = SUBMIT_LABEL[mode];
  const isReset = mode === MODES.RESET;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto af-scroll bg-app">
      {/* Sfondo: la rete di particelle del Classic Suit, sotto una vignettatura. */}
      <div className="pointer-events-none fixed inset-0 opacity-50">
        <ParticleWeb />
      </div>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgb(var(--af-bg-rgb)/0.35)_0%,rgb(var(--af-bg-rgb)/0.92)_70%)]" />

      <main className="relative min-h-full flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px] af-nexus-card-in">
          {/* Marchio */}
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-12 h-12 rounded-xl bg-[rgb(var(--af-attack-solid-rgb))] flex items-center justify-center text-white shadow-primary-glow mb-4">
              <Icon name="web" className="w-6 h-6" strokeWidth={1.9} />
            </div>
            <h1 className="text-[22px] font-bold tracking-tight text-white leading-tight">ArachnoForge</h1>
            <p className="text-sm text-slate-400 mt-1">K.A.R.E.N. OS · il centro di comando del tuo studio</p>
          </div>

          <div className="ds-card !border-line-strong !shadow-pop">
            {isReset ? (
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => switchMode(MODES.LOGIN)}
                  className="inline-flex items-center gap-1 text-[13px] text-slate-400 hover:text-white transition-colors -ml-0.5 mb-3"
                >
                  <Icon name="chevronLeft" className="w-4 h-4" />
                  Torna all’accesso
                </button>
                <h2 className="ds-h2">Recupera l’accesso</h2>
                <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                  Inserisci l’email dell’account: ti mando un link per scegliere una nuova password. I tuoi dati restano dove sono.
                </p>
              </div>
            ) : (
              <div role="tablist" aria-label="Tipo di accesso" className="ds-segmented !grid grid-cols-2 w-full mb-6">
                {[
                  { id: MODES.LOGIN, label: 'Accedi' },
                  { id: MODES.SIGNUP, label: 'Crea account' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === tab.id}
                    onMouseEnter={() => audio.playHoverBlip()}
                    onClick={() => switchMode(tab.id)}
                    className="justify-center !min-h-[2.25rem]"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-3 empty:hidden mb-5">
              {!online && (
                <Alert tone="neutral" icon="wifiOff">
                  Sei offline. Per entrare serve la connessione: se su questo dispositivo avevi già fatto l’accesso, rientri da solo appena torna la
                  rete.
                </Alert>
              )}
              {error && (
                <Alert tone="danger" icon="alertTriangle">
                  {error}
                </Alert>
              )}
              {notice && !error && (
                <Alert tone="info" icon="mail">
                  {notice}
                </Alert>
              )}
            </div>

            {/* Il remount su `key` dà la dissolvenza fra un modulo e l'altro. */}
            <form key={formKey} onSubmit={handleSubmit} noValidate className="space-y-4 af-nexus-form-in">
              {mode === MODES.SIGNUP && (
                <TextField
                  id="nexus-name"
                  label="Nome (facoltativo)"
                  icon="user"
                  value={username}
                  onChange={setUsername}
                  onType={audio.playTypingTic}
                  placeholder="Come vuoi che ti chiami Karen"
                  autoComplete="nickname"
                />
              )}
              <TextField
                id="nexus-email"
                label="Email"
                icon="mail"
                type="email"
                value={email}
                onChange={setEmail}
                onType={audio.playTypingTic}
                placeholder="nome@esempio.it"
                autoComplete="email"
                autoFocus
                inputRef={emailRef}
              />
              {!isReset && (
                <div>
                  <PasswordField
                    id="nexus-password"
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    onType={audio.playTypingTic}
                    autoComplete={mode === MODES.LOGIN ? 'current-password' : 'new-password'}
                    hint={mode === MODES.SIGNUP ? `Almeno ${NEW_PASSWORD_MIN_LENGTH} caratteri.` : undefined}
                  />
                  {mode === MODES.LOGIN && (
                    <div className="flex justify-end mt-1.5">
                      <button
                        type="button"
                        onClick={() => switchMode(MODES.RESET)}
                        className="text-[13px] text-slate-400 hover:text-white transition-colors"
                      >
                        Password dimenticata?
                      </button>
                    </div>
                  )}
                </div>
              )}
              {mode === MODES.SIGNUP && (
                <PasswordField
                  id="nexus-password-confirm"
                  label="Ripeti la password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  onType={audio.playTypingTic}
                  autoComplete="new-password"
                />
              )}

              <button
                type="submit"
                disabled={submitting}
                onMouseEnter={() => !submitting && audio.playHoverBlip()}
                className="ds-btn ds-btn-primary ds-btn-lg w-full"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                    {label.busy}
                  </>
                ) : (
                  <>
                    {label.idle}
                    <Icon name={label.icon} className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {!isReset && (
              <>
                <div className="flex items-center gap-3 my-5" aria-hidden="true">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-xs text-slate-500">oppure</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <button
                  type="button"
                  onClick={handleGuest}
                  disabled={submitting}
                  onMouseEnter={() => !submitting && audio.playHoverBlip()}
                  className="ds-btn ds-btn-ghost w-full"
                >
                  <Icon name="user" className="w-4 h-4" />
                  Continua come ospite
                </button>
                <p className="text-center text-xs text-slate-500 mt-2.5 leading-relaxed">
                  I dati restano solo in questo browser, senza sincronizzazione Cloud.
                </p>
              </>
            )}
          </div>

          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-600 mt-6">
            <Icon name="lock" className="w-3 h-3" />
            Connessione cifrata · Supabase Auth{APP_VERSION ? ` · v${APP_VERSION}` : ''}
          </p>
        </div>
      </main>
    </div>
  );
}
