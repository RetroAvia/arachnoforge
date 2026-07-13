import React, { useRef, useState } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { useAuthContext } from '../context/AuthContext.jsx';
import { Icon } from '../components/Icons.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { SCHEMA_VERSION, SUITS } from '../data/defaultSchema.js';
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
  const { state, actions } = useArachnoForge();
  const { user } = useAuthContext();
  const [focusTime, setFocusTime] = useState(state.settings.focusTime);
  const [shortBreakTime, setShortBreakTime] = useState(state.settings.shortBreakTime);
  const [longBreakTime, setLongBreakTime] = useState(state.settings.longBreakTime);
  const [username, setUsername] = useState(state.profile.username);
  const [importMessage, setImportMessage] = useState(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const fileInputRef = useRef(null);

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

      {/* V26.0 — Pillar 2 (Authentication Logic): sessione Nexus + Logout. */}
      <section className={`${CARD} space-y-4`}>
        <h2 className={`${H2} flex items-center gap-2`}>
          <Icon name="cloud" className="w-5 h-5 text-secondary" />
          SESSIONE NEXUS
        </h2>
        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-base text-slate-400">Identità autenticata</p>
            <p className="text-base font-mono text-slate-200 mt-0.5">{user?.email || '—'}</p>
          </div>
          <button type="button" onClick={() => setLogoutConfirmOpen(true)} className={BTN_SECONDARY}>
            <Icon name="logout" className="w-5 h-5" />
            Disconnetti dal Nexus
          </button>
        </div>
        <p className="relative text-xs text-slate-500 leading-relaxed">
          Il tuo profilo resta salvato sul Cloud (Supabase) — puoi accedere di nuovo da qualsiasi dispositivo con le stesse credenziali.
        </p>
      </section>

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
          L'import valida i campi chiave dello schema prima di sovrascrivere il profilo — una volta importato, il nuovo stato viene sincronizzato automaticamente sul Cloud. In caso di file corrotto, il profilo attuale resta invariato.
        </p>
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
        title="Disconnetti dal Nexus"
        message="Il profilo è già salvato sul Cloud: potrai accedere di nuovo in qualsiasi momento con le stesse credenziali. Confermi il logout?"
        confirmLabel="Disconnetti"
        danger={false}
      />
    </div>
  );
}
