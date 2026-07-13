import React, { useRef, useState } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { useAuthContext } from '../context/AuthContext.jsx';
import { Icon } from '../components/Icons.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import CombatLog from '../components/CombatLog.jsx';
import { SCHEMA_VERSION, SUITS } from '../data/defaultSchema.js';
import { validateAdminPassphrase } from '../utils/adminOverride.js';
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
  const { state, actions, storageMode } = useArachnoForge();
  const { user, isGuest } = useAuthContext();
  const [focusTime, setFocusTime] = useState(state.settings.focusTime);
  const [shortBreakTime, setShortBreakTime] = useState(state.settings.shortBreakTime);
  const [longBreakTime, setLongBreakTime] = useState(state.settings.longBreakTime);
  const [username, setUsername] = useState(state.profile.username);
  const [importMessage, setImportMessage] = useState(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const fileInputRef = useRef(null);

  // V28.1 — Pillar 2 (Admin Override): campo passphrase locale al form,
  // MAI persistito nello stato applicativo — validato al click, non ad
  // ogni keystroke (nessun feedback prematuro "password sbagliata" mentre
  // l'utente sta ancora digitando).
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState(null);
  const isSandboxActive = storageMode === 'sandbox';

  const handleActivateSandbox = () => {
    if (!validateAdminPassphrase(adminPassword)) {
      setAdminError('Karen: passphrase di override non riconosciuta. Accesso Admin negato.');
      return;
    }
    setAdminError(null);
    setAdminPassword('');
    actions.activateSandbox();
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
            return (
              <button
                key={suit.id}
                type="button"
                onClick={() => actions.updateSettings({ suit: suit.id })}
                className={`text-left p-4 rounded-2xl border transition-all duration-300 backdrop-blur-md ${
                  active
                    ? 'border-secondary/60 bg-secondary/10 shadow-secondary-glow'
                    : 'border-white/10 bg-white/[0.02] hover:border-secondary/30'
                }`}
              >
                <div className="flex gap-1.5 mb-3">
                  {suit.swatch.map((color, i) => (
                    <span key={i} className="w-6 h-6 rounded-full border border-white/20 shadow-[0_0_8px_rgba(255,255,255,0.15)]" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <p className="text-base font-semibold text-slate-100">{suit.nome}</p>
                <p className="text-base text-slate-500 mt-0.5">{suit.descrizione}</p>
                {active && <p className="text-[11px] text-secondary mt-2 font-mono">ATTIVA</p>}
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
        <p className="relative text-base text-slate-500 leading-relaxed">
          L'import valida i campi chiave dello schema prima di sovrascrivere il profilo — una volta importato, il nuovo stato viene salvato automaticamente
          {storageMode === 'cloud' ? ' sul Cloud' : storageMode === 'sandbox' ? ' nella Sandbox locale (mai sul Cloud reale)' : ' in locale su questo browser'}.
          In caso di file corrotto, il profilo attuale resta invariato.
        </p>
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
