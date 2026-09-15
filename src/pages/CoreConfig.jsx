import React, { useRef, useState, useEffect } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { useAuthContext } from '../context/AuthContext.jsx';
import { Icon } from '../components/Icons.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import CombatLog from '../components/CombatLog.jsx';
import { SCHEMA_VERSION, SUITS } from '../data/defaultSchema.js';
import { validateAdminPassphrase } from '../utils/adminOverride.js';
import { notificationPermission, requestNotificationPermission, notify, NOTIFY_PERMISSION } from '../utils/systemNotify.js';
import { CARD, CARD_ALERT, H1, H2, BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST, INPUT } from '../utils/designSystem.js';

const SUIT_OPTIONS = [
  {
    id: SUITS.CLASSIC,
    nome: 'Classic Suit',
    descrizione: 'Rosso Cremisi & Blu Elettrico',
    swatch: ['#E23636', '#1D83F0']
  },
  {
    id: SUITS.SYMBIOTE,
    nome: 'Symbiote Suit',
    descrizione: 'Nero & Argento, bagliore violaceo',
    swatch: ['#cbd5e1', '#8b5cf6']
  },
  {
    id: SUITS.Y2099,
    nome: '2099 Suit',
    descrizione: 'Ciano & Viola futuristico',
    swatch: ['#d946ef', '#22d3ee']
  }
];

/** Toggle Stark-Tech — pillola in vetro tecnologico con perno luminoso, mai un checkbox nativo. */
function TechSwitch({ checked, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`shrink-0 w-14 h-8 rounded-full border transition-all duration-300 relative ${
        checked ? 'bg-secondary/25 border-secondary/60 shadow-secondary-glow' : 'bg-surface/80 border-white/10'
      }`}
    >
      <span
        className={`absolute top-1 w-6 h-6 rounded-full bg-gradient-to-br transition-all duration-300 ${
          checked ? 'left-7 from-secondary to-secondary-dark' : 'left-1 from-slate-500 to-slate-600'
        }`}
      />
    </button>
  );
}

export default function CoreConfig() {
  const { state, actions, storageMode, pushToast, derived } = useArachnoForge();

  // V36.0 — stato del permesso notifiche, letto dal browser (unica fonte
  // di verità: `settings.systemNotifications` può restare `true` da una
  // sessione precedente mentre il permesso è stato nel frattempo revocato,
  // e in quel caso l'interruttore deve mostrarsi spento, non mentire).
  const [notifyPermission, setNotifyPermission] = useState(notificationPermission);

  const handleToggleNotifications = async () => {
    const enabled = state.settings.systemNotifications === true && notifyPermission === NOTIFY_PERMISSION.GRANTED;
    if (enabled) {
      actions.updateSettings({ systemNotifications: false });
      return;
    }
    let permission = notificationPermission();
    if (permission === NOTIFY_PERMISSION.DEFAULT) {
      permission = await requestNotificationPermission();
    }
    setNotifyPermission(permission);
    if (permission === NOTIFY_PERMISSION.GRANTED) {
      actions.updateSettings({ systemNotifications: true });
      notify('K.A.R.E.N. online', { body: 'Riceverai una notifica a fine blocco Focus e a fine pausa.', tag: 'af-test' });
    } else if (permission === NOTIFY_PERMISSION.DENIED) {
      actions.updateSettings({ systemNotifications: false });
      pushToast('Notifiche negate dal browser: riattivale dalle impostazioni del sito.', 'danger');
    } else {
      pushToast('Questo browser non supporta le notifiche di sistema.', 'info');
    }
  };
  const { user, isGuest } = useAuthContext();
  const [focusTime, setFocusTime] = useState(state.settings.focusTime);
  const [shortBreakTime, setShortBreakTime] = useState(state.settings.shortBreakTime);
  const [longBreakTime, setLongBreakTime] = useState(state.settings.longBreakTime);
  const [username, setUsername] = useState(state.profile.username);
  const [importMessage, setImportMessage] = useState(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const fileInputRef = useRef(null);

  // V33.0 — "Aesthetic Level-Up": shake tattile (stesso af-screen-shake
  // della Boss Fight) sulla card di una Spider-Suit ancora bloccata al
  // click, invece del solo toast informativo — un "no" fisico, non solo
  // testuale. Un solo id alla volta: click ripetuti sulla stessa card
  // ri-innescano lo shake pulendo prima il timeout precedente.
  const [shakingSuitId, setShakingSuitId] = useState(null);
  const shakeTimeoutRef = useRef(null);
  const triggerSuitShake = (suitId) => {
    if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
    setShakingSuitId(suitId);
    shakeTimeoutRef.current = setTimeout(() => setShakingSuitId(null), 400);
  };
  useEffect(() => () => {
    if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
  }, []);

  // V28.1 — Pillar 2 (Admin Override): campo passphrase locale al form,
  // MAI persistito nello stato applicativo — validato al click, non ad
  // ogni keystroke (nessun feedback prematuro "password sbagliata" mentre
  // l'utente sta ancora digitando).
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState(null);
  const isSandboxActive = storageMode === 'sandbox';

  // V28.2 — FIX 1 (Hardcoded Admin Override): confronto blindato, pulito
  // ed esplicito, eseguito qui SOLO come primo controllo di UX (messaggio
  // d'errore immediato) — la vera fonte di verità resta comunque
  // `validateAdminPassphrase` in utils/adminOverride.js (mai duplicare la
  // logica di confronto). CRITICO: il passaggio precedente chiamava
  // `actions.activateSandbox()` SENZA la password — il Context la
  // rivalidava internamente su `undefined` e falliva SEMPRE, anche a
  // passphrase corretta. Ora il valore trimmato viene propagato fino in
  // fondo alla catena, cosi' l'override scatta senza se e senza ma.
  const handleActivateSandbox = () => {
    const cleaned = adminPassword.trim();
    if (validateAdminPassphrase(cleaned)) {
      setAdminError(null);
      setAdminPassword('');
      actions.activateSandbox(cleaned);
    } else {
      setAdminError('Karen: passphrase di override non riconosciuta. Accesso Admin negato.');
    }
  };

  // V28.1 — Pillar 1 (UI Reorganization): il Combat Log lascia la Home e
  // trova posto qui, in una sezione dedicata e collassata di default —
  // "pulita" significa anche non forzare log tecnici sott'occhio finché
  // non li si cerca esplicitamente.
  const [logsOpen, setLogsOpen] = useState(false);

  const commitSettings = () => {
    actions.updateSettings({
      focusTime: Math.max(1, Number(focusTime) || 1),
      shortBreakTime: Math.max(1, Number(shortBreakTime) || 1),
      longBreakTime: Math.max(1, Number(longBreakTime) || 1)
    });
  };

  const commitUsername = () => {
    if (username.trim()) actions.updateProfile({ username: username.trim() });
  };

  const exportProfile = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `arachnoforge-profile-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // V36.0 — traccia la data dell'ultimo backup reale. L'intero percorso
    // di studi vive in un'unica riga `user_data.app_state`: un export
    // dimenticato per mesi è l'unico modo in cui questi dati possono
    // davvero sparire, e finora nulla lo ricordava mai.
    actions.updateSettings({ lastExportDateKey: stamp });
  };

  // Giorni dall'ultimo export — `null` se non ne è mai stato fatto uno.
  const daysSinceExport = (() => {
    const last = state.settings.lastExportDateKey;
    if (typeof last !== 'string') return null;
    const diff = Math.floor((Date.now() - new Date(`${last}T00:00:00Z`).getTime()) / 86400000);
    return Number.isFinite(diff) ? Math.max(0, diff) : null;
  })();
  const backupStale = daysSinceExport == null || daysSinceExport >= 14;

  /**
   * V32.0 — Export ICS: le date d'esame già presenti sulle Materie del
   * Web-Matrix (`materia.examDate`, formato YYYY-MM-DD) diventano un file
   * .ics standard RFC 5545, importabile in Google Calendar/Apple
   * Calendar/Outlook. Eventi "giornata intera" (VALUE=DATE, nessun
   * DTEND — per specifica RFC 5545 un evento DATE senza DTEND dura
   * esattamente un giorno). Nessuna dipendenza esterna: stringa
   * costruita a mano, stesso pattern già in uso per l'Export Profilo JSON
   * qui sopra (Blob + link temporaneo, mai un round-trip di rete).
   */
  const escapeIcsText = (text) => String(text).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');

  const exportExamDatesIcs = () => {
    const materieConData = state.materie.filter((m) => m && typeof m.examDate === 'string' && m.examDate.length === 10);
    if (materieConData.length === 0) {
      pushToast?.('Karen: nessuna data d\'esame impostata sulle Materie del Web-Matrix.', 'info');
      return;
    }
    const stampUtc = `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    const events = materieConData.map((m) => {
      const dt = m.examDate.replace(/-/g, '');
      return [
        'BEGIN:VEVENT',
        `UID:${m.id}@arachnoforge`,
        `DTSTAMP:${stampUtc}`,
        `DTSTART;VALUE=DATE:${dt}`,
        `SUMMARY:${escapeIcsText(`Esame: ${m.nome}`)}`,
        `DESCRIPTION:${escapeIcsText(`${m.cfu} CFU${m.examPassed ? ' — già superato' : ''}`)}`,
        'END:VEVENT'
      ].join('\r\n');
    });
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ArachnoForge//Web-Matrix Exam Dates//IT', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `arachnoforge-esami-${stamp}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const result = actions.importProfile(parsed);
        setImportMessage(
          result.valid
            ? { type: 'success', text: 'Profilo importato e caricato con successo.' }
            : { type: 'error', text: result.reason }
        );
      } catch (err) {
        setImportMessage({ type: 'error', text: 'File non leggibile: JSON malformato.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className={H1}>Karen OS Settings</h1>
        <p className="text-base text-slate-400 mt-1.5">Karen: pannello di controllo del sistema. Timer, Aspetto e Data Ledger — schema v{SCHEMA_VERSION}.</p>
      </div>

      <section className={`${CARD} space-y-4`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="target" className="w-5 h-5 text-secondary" />
          PROFILO
        </h2>
        <div className="relative">
          <label className="text-base text-slate-400 block mb-1.5">Nome Cadetto</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={commitUsername}
            className={INPUT}
          />
        </div>
      </section>

      {/* V26.0 — Pillar 2 (Authentication Logic): sessione Nexus + Logout.
          V28.1: consapevole anche della Modalità Ospite (dati locali, mai
          sul Cloud) e della Sandbox Admin attiva. */}
      <section className={`${CARD} space-y-4`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name={isGuest ? 'user' : 'cloud'} className="w-5 h-5 text-secondary" />
          SESSIONE NEXUS
        </h2>
        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-base text-slate-400">{isGuest ? 'Modalità Ospite (dati locali)' : 'Identità autenticata'}</p>
            <p className="text-base font-mono text-slate-200 mt-0.5">{isGuest ? 'ospite@arachnoforge.local' : (user?.email || '—')}</p>
            {isSandboxActive && (
              <span className="inline-flex items-center gap-1.5 mt-2 rounded-full border border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-300 px-2.5 py-0.5 text-[11px] font-mono">
                <Icon name="chip" className="w-3.5 h-3.5" />
                SANDBOX ADMIN ATTIVA
              </span>
            )}
          </div>
          <button type="button" onClick={() => setLogoutConfirmOpen(true)} className={BTN_SECONDARY}>
            <Icon name="logout" className="w-5 h-5" />
            {isGuest ? 'Esci dalla Modalità Ospite' : 'Disconnetti dal Nexus'}
          </button>
        </div>
        <p className="relative text-xs text-slate-500 leading-relaxed">
          {isGuest
            ? 'I tuoi dati restano esclusivamente su questo browser — nessuna sincronizzazione Cloud. Esci e crea un account dal Nexus Gate per portarli con te su altri dispositivi.'
            : isSandboxActive
            ? 'Sandbox Admin attiva: le modifiche restano isolate in locale e NON toccano il tuo profilo Cloud reale — vedi la sezione Override di Sistema qui sotto per disattivarla.'
            : 'Il tuo profilo resta salvato sul Cloud (Supabase) — puoi accedere di nuovo da qualsiasi dispositivo con le stesse credenziali.'}
        </p>
      </section>

      {/* V28.1 — Pillar 2: Override di Sistema / Modalità Admin (Sandbox).
          Invisibile in Modalità Ospite (che è già interamente locale — una
          sandbox dentro una sandbox non avrebbe senso). Passphrase validata
          SOLO al click (mai ad ogni keystroke), un solo punto di verifica
          in `utils/adminOverride.js` — nessuna logica di confronto duplicata. */}
      {!isGuest && (
        <section className={isSandboxActive ? `${CARD_ALERT} space-y-4` : `${CARD} space-y-4`}>
          <h2 className={`${H2} flex items-center gap-2`}>
            <Icon name="chip" className="w-5 h-5 text-primary" />
            OVERRIDE DI SISTEMA — MODALITÀ ADMIN (SANDBOX)
          </h2>
          <p className="relative text-sm text-slate-400 leading-relaxed">
            Attiva un profilo di test completamente isolato (storage locale dedicato, mai il Cloud): sperimenta liberamente
            senza alcun rischio per il tuo profilo reale. Disattivabile in qualsiasi momento.
          </p>

          {!isSandboxActive ? (
            <div className="relative space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => {
                    setAdminPassword(e.target.value);
                    if (adminError) setAdminError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleActivateSandbox()}
                  placeholder="Passphrase Override Admin"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  className={`${INPUT} flex-1`}
                />
                <button type="button" onClick={handleActivateSandbox} disabled={!adminPassword} className={BTN_PRIMARY}>
                  <Icon name="lock" className="w-5 h-5" />
                  Attiva Sandbox
                </button>
              </div>
              {adminError && (
                <p className="relative text-xs text-primary flex items-center gap-1.5">
                  <Icon name="alertTriangle" className="w-4 h-4 shrink-0" />
                  {adminError}
                </p>
              )}
            </div>
          ) : (
            <div className="relative flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-fuchsia-300 flex items-center gap-2">
                <Icon name="chip" className="w-4 h-4" />
                Protocollo Admin Attivato — Sandbox in uso.
              </p>
              <button type="button" onClick={actions.deactivateSandbox} className={BTN_GHOST}>
                <Icon name="logout" className="w-5 h-5" />
                Torna al Profilo Standard
              </button>
            </div>
          )}
        </section>
      )}

      <section className={`${CARD} space-y-4`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="shield" className="w-5 h-5 text-primary" />
          SPIDER-SUIT
        </h2>
        <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SUIT_OPTIONS.map((suit) => {
            const active = state.settings.suit === suit.id;
            // V32.0 — Sblocco Tute: la Classic è sempre disponibile; Symbiote si
            // sblocca attivando almeno una volta Maximum Carnage Mode; 2099 al
            // raggiungimento del Livello 50. Grandfathering: se la tuta risulta
            // già attiva nelle impostazioni correnti, non viene mai bloccata
            // retroattivamente (evita di "rubare" una tuta già in uso a un
            // profilo esistente in caso di dati storici incompleti).
            let locked = false;
            let lockReason = '';
            if (suit.id === SUITS.SYMBIOTE) {
              locked = !active && state.profile.symbioteSuitUnlocked !== true;
              lockReason = 'Sblocca la Symbiote Suit attivando almeno una volta il Maximum Carnage Mode (5 azioni critiche di fila).';
            } else if (suit.id === SUITS.Y2099) {
              locked = !active && (state.profile.level || 1) < 50;
              lockReason = 'Sblocca la 2099 Suit raggiungendo il Livello 50 — Difensore del Multiverso.';
            }
            return (
              <button
                key={suit.id}
                type="button"
                onClick={() => {
                  if (locked) {
                    pushToast?.(lockReason, 'info');
                    triggerSuitShake(suit.id);
                    return;
                  }
                  actions.updateSettings({ suit: suit.id });
                }}
                className={`text-left p-4 rounded-2xl border transition-all duration-300 backdrop-blur-md ${
                  shakingSuitId === suit.id ? 'af-locked-shake' : ''
                } ${
                  active
                    ? 'border-secondary/60 bg-secondary/10 shadow-secondary-glow'
                    : locked
                    ? 'border-white/5 bg-white/[0.01] opacity-60 hover:border-white/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-secondary/30'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-1.5">
                    {suit.swatch.map((color, i) => (
                      <span key={i} className="w-6 h-6 rounded-full border border-white/20 shadow-[0_0_8px_rgba(255,255,255,0.15)]" style={{ backgroundColor: color, filter: locked ? 'grayscale(0.6)' : 'none' }} />
                    ))}
                  </div>
                  {locked && <Icon name="lock" className="w-4 h-4 text-slate-500" />}
                </div>
                <p className="text-base font-semibold text-slate-100">{suit.nome}</p>
                <p className="text-base text-slate-500 mt-0.5">{suit.descrizione}</p>
                {active && <p className="text-[11px] text-secondary mt-2 font-mono">ATTIVA</p>}
                {locked && <p className="text-[11px] text-slate-500 mt-2 font-mono">BLOCCATA</p>}
              </button>
            );
          })}
        </div>
      </section>

      <section className={`${CARD} space-y-3`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="eye" className="w-5 h-5 text-secondary" />
          SENSORY ZERO — MODALITÀ A BASSO STIMOLO
        </h2>
        <div className="relative flex items-center justify-between gap-4">
          <p className="text-base text-slate-400 leading-relaxed">
            Disattiva screen-shake, flash e animazioni intense (Sinister Six Simulator, Fatigue UI) per una concentrazione pulita, priva di sovraccarichi sensoriali.
          </p>
          <TechSwitch
            checked={state.settings.calmMode}
            onChange={() => actions.updateSettings({ calmMode: !state.settings.calmMode })}
            ariaLabel="Sensory Zero"
          />
        </div>
      </section>

      <section className={`${CARD} space-y-3`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="speaker" className="w-5 h-5 text-secondary" />
          EFFETTI SONORI
        </h2>
        <div className="relative flex items-center justify-between gap-4">
          <p className="text-base text-slate-400 leading-relaxed">
            Karen: Sensory Web Audio Engine attivo. Web-Click, Hover Blip, Focus Reminder (ogni 30 min di Focus),
            Penalty Buzzer, Level Up Chime, Success Chime e Goblin Alert — tutto sintetizzato al volo via Web Audio API,
            nessun file esterno. Disattivato automaticamente quando Sensory Zero è attivo.
          </p>
          <TechSwitch
            checked={state.settings.soundEffects !== false}
            onChange={() => actions.updateSettings({ soundEffects: state.settings.soundEffects === false })}
            ariaLabel="Effetti sonori"
          />
        </div>
      </section>

      {/* V36.0 — Il blocco che mancava del tutto: l'app non aveva alcun
          modo di raggiungerti fuori dalla scheda aperta. Con lo schermo
          bloccato la fine di un blocco Focus non ti arrivava in nessun
          modo — tornavi a guardare e la pausa era finita venti minuti
          prima. Il permesso viene chiesto SOLO da questo click esplicito:
          una richiesta automatica al primo caricamento viene rifiutata dai
          browser (e ricordata male da Safari). */}
      <section className={`${CARD} space-y-3`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="satellite" className="w-5 h-5 text-secondary" />
          NOTIFICHE E SCHERMO
        </h2>

        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="text-base text-slate-400 leading-relaxed">
              Notifica di sistema a fine blocco Focus e a fine pausa, anche a schermo bloccato o con l'app in secondo piano.
            </p>
            {notifyPermission === 'denied' && (
              <p className="text-xs text-primary mt-1.5">
                Permesso negato a livello di browser: va riattivato dalle impostazioni del sito, Karen non può farlo da qui.
              </p>
            )}
            {notifyPermission === 'unsupported' && (
              <p className="text-xs text-slate-500 mt-1.5">Questo browser non espone le notifiche di sistema.</p>
            )}
          </div>
          <TechSwitch
            checked={state.settings.systemNotifications === true && notifyPermission === 'granted'}
            onChange={handleToggleNotifications}
            ariaLabel="Notifiche di sistema"
          />
        </div>

        <div className="relative flex items-center justify-between gap-4 pt-3 border-t border-white/10">
          <p className="text-base text-slate-400 leading-relaxed">
            Tieni lo schermo acceso durante un blocco di Focus (mai durante le pause: lì spegnere è il punto).
            Senza, Sensory Zero si spegneva da solo dopo trenta secondi.
          </p>
          <TechSwitch
            checked={state.settings.keepScreenAwake !== false}
            onChange={() => actions.updateSettings({ keepScreenAwake: state.settings.keepScreenAwake === false })}
            ariaLabel="Mantieni schermo acceso"
          />
        </div>
      </section>

      {/* V36.0 — Interfaccia: due leve che cambiano davvero la fatica
          quotidiana d'uso, non l'estetica. */}
      <section className={`${CARD} space-y-3`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="grid" className="w-5 h-5 text-secondary" />
          INTERFACCIA
        </h2>

        <div className="relative flex items-center justify-between gap-4">
          <p className="text-base text-slate-400 leading-relaxed">
            <span className="text-slate-200 font-semibold">Una cosa alla volta.</span> Lo Stark-Web Terminal si apre sulla
            sola decisione del momento (argomento, minuti, Avvia); briefing, Quota Odierna e Daily Patrol restano a un
            click. Il numero di pannelli che chiedono attenzione insieme è esso stesso una fonte di stress.
          </p>
          <TechSwitch
            checked={state.settings.focusFirstHome !== false}
            onChange={() => actions.updateSettings({ focusFirstHome: state.settings.focusFirstHome === false })}
            ariaLabel="Una cosa alla volta"
          />
        </div>

        <div className="relative flex items-center justify-between gap-4 pt-3 border-t border-white/10">
          <p className="text-base text-slate-400 leading-relaxed">
            <span className="text-slate-200 font-semibold">Effetti pesanti.</span> Sfocature profonde, grana, particelle e
            interferenza. Spegnili su telefoni meno recenti: sono il primo punto in cui si perdono fluidità e batteria
            durante un pomodoro. Nessuna informazione va persa — cambia solo l'atmosfera.
          </p>
          <TechSwitch
            checked={state.settings.heavyEffects !== false}
            onChange={() => actions.updateSettings({ heavyEffects: state.settings.heavyEffects === false })}
            ariaLabel="Effetti pesanti"
          />
        </div>
      </section>

      {/* V36.0 — "Karen impara da te": i due numeri che l'app misura su di
          te e che ora governano ogni proiezione. Mostrati apertamente,
          compresa la loro affidabilità: un valore ancora non calibrato
          viene dichiarato tale invece di essere spacciato per misurato. */}
      <section className={`${CARD} space-y-3`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="gauge" className="w-5 h-5 text-secondary" />
          CALIBRAZIONE — COSA KAREN HA IMPARATO SU DI TE
        </h2>
        <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3.5">
            <p className="text-[11px] font-mono tracking-widest text-slate-500">CAPACITÀ GIORNALIERA</p>
            <p className="text-2xl font-mono font-bold text-white mt-1">{derived.calibration.hoursPerDay}h</p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {derived.calibration.capacityConfident
                ? `Media reale sulle tue ultime ${derived.calibration.observedDays} giornate, giorni di riposo inclusi. Sostituisce il vecchio 4.5h/giorno teorico in ogni proiezione.`
                : 'Valore di default: servono almeno 7 giorni di sessioni registrate perché diventi il tuo.'}
            </p>
          </div>
          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3.5">
            <p className="text-[11px] font-mono tracking-widest text-slate-500">PRECISIONE DELLE TUE STIME</p>
            <p className="text-2xl font-mono font-bold text-white mt-1">×{derived.calibration.biasFactor}</p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {derived.calibration.biasConfident
                ? derived.calibration.biasFactor > 1.05
                  ? `Su ${derived.calibration.biasSampleSize} nodi chiusi, ogni ora dichiarata te ne è costate ${derived.calibration.biasFactor}. Le "Ore previste" future vengono corrette di conseguenza.`
                  : derived.calibration.biasFactor < 0.95
                  ? `Su ${derived.calibration.biasSampleSize} nodi chiusi sei più veloce delle tue stime: le proiezioni vengono accorciate.`
                  : `Su ${derived.calibration.biasSampleSize} nodi chiusi le tue stime sono accurate. Nessuna correzione applicata.`
                : `Servono almeno 5 nodi completati con tempo di Focus tracciato (ne hai ${derived.calibration.biasSampleSize}).`}
            </p>
          </div>
        </div>
      </section>

      <section className={`${CARD} space-y-4`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="gear" className="w-5 h-5 text-secondary" />
          SETTINGS TIMER
        </h2>
        <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-base text-slate-400 block mb-1.5">Focus (min)</label>
            <input
              type="number"
              min={1}
              value={focusTime}
              onChange={(e) => setFocusTime(e.target.value)}
              onBlur={commitSettings}
              className={INPUT}
            />
          </div>
          <div>
            <label className="text-base text-slate-400 block mb-1.5">Pausa Breve (min)</label>
            <input
              type="number"
              min={1}
              value={shortBreakTime}
              onChange={(e) => setShortBreakTime(e.target.value)}
              onBlur={commitSettings}
              className={INPUT}
            />
          </div>
          <div>
            <label className="text-base text-slate-400 block mb-1.5">Pausa Lunga (min)</label>
            <input
              type="number"
              min={1}
              value={longBreakTime}
              onChange={(e) => setLongBreakTime(e.target.value)}
              onBlur={commitSettings}
              className={INPUT}
            />
          </div>
        </div>

        {/* V35.0 — Focus Timer Adattivo: quando attivo, K.A.R.E.N. può
            sovrascrivere Focus/Pausa Breve qui sopra (mai la Pausa Lunga,
            volutamente esclusa dall'automazione) in base alla banda di
            readiness biometrica del giorno — mai un override silenzioso e
            non disattivabile, l'utente resta sempre padrone del proprio
            timer. */}
        <div className="relative flex items-center justify-between gap-4 pt-4 border-t border-white/5">
          <div>
            <p className="text-base text-slate-200 font-semibold flex items-center gap-2">
              <Icon name="chip" className="w-4 h-4 text-secondary" />
              Focus Timer Adattivo K.A.R.E.N.
            </p>
            <p className="text-sm text-slate-500 leading-relaxed mt-1">
              Karen ricalibra Focus e Pausa Breve in base alla tua readiness biometrica del giorno (es. 25/5 in banda CRITICO, 50/10 in banda OTTIMALE). I valori sopra restano il default quando disattivo o senza telemetria disponibile.
            </p>
          </div>
          <TechSwitch
            checked={state.settings.karenAdaptiveTimer !== false}
            onChange={() => actions.updateSettings({ karenAdaptiveTimer: state.settings.karenAdaptiveTimer === false })}
            ariaLabel="Focus Timer Adattivo K.A.R.E.N."
          />
        </div>
      </section>

      <section className={`${CARD} space-y-4`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="archive" className="w-5 h-5 text-secondary" />
          DATA LEDGER
        </h2>
        <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button type="button" onClick={exportProfile} className={BTN_SECONDARY}>
            <Icon name="download" className="w-6 h-6" />
            Esporta Profilo
          </button>
          <button type="button" onClick={handleImportClick} className={BTN_GHOST}>
            <Icon name="upload" className="w-6 h-6" />
            Importa Profilo
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFileChange} />
        </div>
        {importMessage && (
          <p className={`relative text-base ${importMessage.type === 'success' ? 'text-emerald-400' : 'text-primary'}`}>
            {importMessage.text}
          </p>
        )}
        {/* V36.0 — promemoria di backup: nessun download automatico (sarebbe
            invadente e comunque bloccato dai browser), solo lo stato reale
            detto chiaramente. */}
        <div
          className={`relative flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 ${
            backupStale ? 'border-accent/40 bg-accent/10' : 'border-emerald-400/30 bg-emerald-900/20'
          }`}
        >
          <Icon
            name={backupStale ? 'alertTriangle' : 'check'}
            className={`w-4 h-4 shrink-0 mt-0.5 ${backupStale ? 'text-accent' : 'text-emerald-400'}`}
          />
          <p className={`text-sm leading-relaxed ${backupStale ? 'text-accent' : 'text-emerald-300'}`}>
            {daysSinceExport == null
              ? "Nessun backup locale mai esportato. Tutto il tuo percorso di studi vive in un'unica riga sul Cloud: scaricane una copia ogni tanto."
              : backupStale
              ? `Ultimo backup ${daysSinceExport} giorni fa. Karen consiglia una copia locale fresca.`
              : `Ultimo backup ${daysSinceExport === 0 ? 'oggi' : `${daysSinceExport} giorni fa`}.`}
          </p>
        </div>

        <p className="relative text-base text-slate-500 leading-relaxed">
          L'import valida i campi chiave dello schema prima di sovrascrivere il profilo — una volta importato, il nuovo stato viene salvato automaticamente
          {storageMode === 'cloud' ? ' sul Cloud' : storageMode === 'sandbox' ? ' nella Sandbox locale (mai sul Cloud reale)' : ' in locale su questo browser'}.
          In caso di file corrotto, il profilo attuale resta invariato.
        </p>

        <div className="relative pt-3 border-t border-white/5">
          <button type="button" onClick={exportExamDatesIcs} className={`w-full ${BTN_GHOST}`}>
            <Icon name="calendar" className="w-6 h-6" />
            Esporta Date Esami (.ics)
          </button>
          <p className="relative text-sm text-slate-500 leading-relaxed mt-2">
            Scarica un file .ics con tutte le date d'esame impostate sulle Materie del Web-Matrix — importabile in Google Calendar, Apple Calendar o Outlook.
          </p>
        </div>
      </section>

      {/* V28.1 — Pillar 1 (UI Reorganization): il Combat Log lascia la Home
          (Mission Control) e trova qui una sezione dedicata, pulita e
          collassata di default — i log tecnici restano a disposizione ma
          non affollano più la schermata principale. */}
      <section className={`${CARD} space-y-0`}>
        <button
          type="button"
          onClick={() => setLogsOpen((v) => !v)}
          className="relative w-full flex items-center justify-between gap-3"
        >
          <h2 className={`${H2} flex items-center gap-2`}>
            <Icon name="terminal" className="w-5 h-5 text-secondary" />
            LOG DI SISTEMA
          </h2>
          <span className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-mono text-slate-500">{state.combatLog.length}/50</span>
            <Icon name="chevronDown" className={`w-4 h-4 text-slate-500 transition-transform duration-300 ${logsOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {logsOpen && (
          <div className="relative mt-4 h-72 af-holo-alert-in">
            <CombatLog entries={state.combatLog} />
          </div>
        )}
      </section>

      <section className={`${CARD_ALERT} space-y-3`}>
        <h2 className="relative text-base tracking-widest text-primary flex items-center gap-2 font-bold">
          <Icon name="alertTriangle" className="w-5 h-5" />
          ZONA PERICOLOSA
        </h2>
        <p className="relative text-base text-slate-400">Riporta l'intero profilo ai valori di default: Livello 1, 0 XP, Stamina 100. Azione irreversibile.</p>
        <button type="button" onClick={() => setResetConfirmOpen(true)} className={`relative ${BTN_PRIMARY}`}>
          Reset Totale
        </button>
      </section>

      <ConfirmDialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={actions.resetProfile}
        title="Reset Totale"
        message="Questa azione cancella definitivamente XP, materie, skill tree, log e ricompense. Non può essere annullata. Procedere?"
        confirmLabel="Cancella Tutto"
      />

      <ConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          actions.signOut();
        }}
        title={isGuest ? 'Esci dalla Modalità Ospite' : 'Disconnetti dal Nexus'}
        message={
          isGuest
            ? 'I dati locali di questa sessione Ospite restano su questo browser, ma non saranno più accessibili da qui una volta uscito. Confermi?'
            : 'Il profilo è già salvato sul Cloud: potrai accedere di nuovo in qualsiasi momento con le stesse credenziali. Confermi il logout?'
        }
        confirmLabel={isGuest ? 'Esci' : 'Disconnetti'}
        danger={false}
      />
    </div>
  );
}
