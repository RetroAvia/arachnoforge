import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useArachnoForge } from '../context/ArachnoForgeContext.jsx';
import { useAuthContext } from '../context/AuthContext.jsx';
import { Icon } from '../components/Icons.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import PasswordDialog from '../components/PasswordDialog.jsx';
import CombatLog from '../components/CombatLog.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { SCHEMA_VERSION, SUITS } from '../data/defaultSchema.js';
import { validateAdminPassphrase, isAdminPassphraseConfigured } from '../utils/adminOverride.js';
import { validateImportedProfile } from '../utils/storage.js';
import { oldestDetailedMonth } from '../utils/starLogMaintenance.js';
import { formatMonthYearHuman, formatHoursMinutes } from '../utils/dateUtils.js';
import { notificationPermission, requestNotificationPermission, notify, NOTIFY_PERMISSION } from '../utils/systemNotify.js';
import { backupsSupported, SNAPSHOT_REASON_LABEL, SNAPSHOTS_CHANGED_EVENT, AUTO_KEEP, SAFETY_KEEP } from '../utils/localBackups.js';
import { formatInt, formatDecimal, minutiLabel } from '../utils/format.js';
import { INTENT, useIntent } from '../utils/uiIntents.js';
import { CARD_NOPAD, BTN_SECONDARY, BTN_GHOST, BTN_DANGER, INPUT, LABEL, BADGE } from '../utils/designSystem.js';

// =====================================================================
// Karen OS Settings — V41: una pagina di impostazioni vera, divisa per
// argomento con un indice a sinistra (su PC) invece di una colonna unica
// di dodici riquadri in maiuscolo. Nuova la sezione Backup: i punti di
// ripristino automatici salvati su questo dispositivo, da ripristinare o
// scaricare con un clic.
// =====================================================================

const SUIT_OPTIONS = [
  { id: SUITS.CLASSIC, nome: 'Classic Suit', descrizione: 'Rosso cremisi e blu elettrico', swatch: ['#E23636', '#1D83F0'] },
  { id: SUITS.SYMBIOTE, nome: 'Symbiote Suit', descrizione: 'Nero e argento, bagliore viola', swatch: ['#cbd5e1', '#8b5cf6'] },
  { id: SUITS.Y2099, nome: '2099 Suit', descrizione: 'Ciano e magenta futuristici', swatch: ['#d946ef', '#22d3ee'] }
];

const SECTIONS = [
  { id: 'cfg-profilo', label: 'Profilo e accesso', icon: 'user' },
  { id: 'cfg-aspetto', label: 'Aspetto', icon: 'shield' },
  { id: 'cfg-timer', label: 'Timer', icon: 'clock' },
  { id: 'cfg-piano', label: 'Piano di studio', icon: 'calendar' },
  { id: 'cfg-avvisi', label: 'Suoni e notifiche', icon: 'speaker' },
  { id: 'cfg-calibrazione', label: 'Calibrazione', icon: 'gauge' },
  { id: 'cfg-backup', label: 'Backup e dati', icon: 'archive' },
  { id: 'cfg-avanzate', label: 'Avanzate', icon: 'terminal' }
];

/**
 * V37.0 — Riassunto leggibile di un profilo importato, mostrato nella
 * conferma: sostituire l'intero percorso di studi è l'azione più
 * distruttiva dell'app, si deve vedere COSA si sta per caricare.
 */
function summarizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const materie = Array.isArray(raw.materie) ? raw.materie : [];
  const nodi = materie.reduce((sum, m) => sum + (Array.isArray(m?.sfide) ? m.sfide.length : 0), 0);
  const sessioni = Array.isArray(raw.starLog) ? raw.starLog.filter((e) => e?.type === 'FOCUS_SESSION').length : 0;
  return {
    username: raw.profile?.username || 'Cadetto',
    level: raw.profile?.level ?? '—',
    materie: materie.length,
    nodi,
    sessioni,
    versione: raw.metadata?.version || 'sconosciuta'
  };
}

/** Scarica un oggetto come file JSON. */
function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stampNow(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function formatSnapshotWhen(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '—';
  const oggi = new Date();
  const ieri = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() - 1);
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === oggi.toDateString()) return `Oggi, ${ora}`;
  if (d.toDateString() === ieri.toDateString()) return `Ieri, ${ora}`;
  return `${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}, ${ora}`;
}

/** Interruttore (role="switch") nello stile dell'app. */
function Switch({ checked, onChange, ariaLabel, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={disabled}
      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary/60 disabled:opacity-40"
    >
      <span className="ds-switch" data-on={checked ? 'true' : 'false'} />
    </button>
  );
}

/** Riga di impostazione: titolo e spiegazione a sinistra, controllo a destra. */
function SettingRow({ title, description, children, note }) {
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-100">{title}</p>
        {description && <p className="text-[13px] text-slate-400 mt-0.5 leading-relaxed">{description}</p>}
        {note}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

/** Sezione della pagina, ancorabile dall'indice. */
function Section({ id, title, subtitle, children, tone }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className={`ds-h2 ${tone || ''}`}>
          {title}
        </h2>
        {subtitle && <p className="text-[13px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Panel({ children, className = '' }) {
  return <div className={`${CARD_NOPAD} divide-y divide-white/[0.06] ${className}`}>{children}</div>;
}

const GIORNI_SETTIMANA = [
  { v: 1, l: 'Lun' },
  { v: 2, l: 'Mar' },
  { v: 3, l: 'Mer' },
  { v: 4, l: 'Gio' },
  { v: 5, l: 'Ven' },
  { v: 6, l: 'Sab' },
  { v: 7, l: 'Dom' }
];

/**
 * V42 — "PIANO DI STUDIO": le regole con cui il planner costruisce le tue
 * giornate. Tutto ha un default sensato; qui lo cambi quando la tua
 * settimana non è quella media (un lavoro, un giorno fisso libero).
 */
function PianoSettings({ settings, calibration, onChange }) {
  const riposo = Array.isArray(settings.giorniRiposo) ? settings.giorniRiposo : [];
  const manuale = Number(settings.capacitaManuale) > 0 ? Number(settings.capacitaManuale) : null;
  const [capInput, setCapInput] = useState(manuale ? String(manuale) : '');
  const [annoInput, setAnnoInput] = useState(settings.annoImmatricolazione ? String(settings.annoImmatricolazione) : '');
  useEffect(() => setCapInput(manuale ? String(manuale) : ''), [manuale]);
  useEffect(() => setAnnoInput(settings.annoImmatricolazione ? String(settings.annoImmatricolazione) : ''), [settings.annoImmatricolazione]);

  const toggleGiorno = (v) => {
    const next = riposo.includes(v) ? riposo.filter((g) => g !== v) : [...riposo, v].slice(-3);
    onChange({ giorniRiposo: next.sort((a, b) => a - b) });
  };
  const commitCap = () => {
    const n = Number(String(capInput).replace(',', '.'));
    onChange({ capacitaManuale: Number.isFinite(n) && n >= 0.5 && n <= 12 ? n : null });
  };
  const commitAnno = () => {
    const n = Number(annoInput);
    onChange({ annoImmatricolazione: Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null });
  };

  return (
    <Panel>
      <SettingRow
        title="Ore di studio al giorno"
        description={
          manuale
            ? `Decise da te: ${formatHoursMinutes(manuale)} al giorno. Il planner non usa la media misurata.`
            : `Misurate sul tuo storico: ${formatHoursMinutes(Number(calibration.measuredHoursPerDay ?? calibration.hoursPerDay) || 0)} al giorno${
                calibration.capacityConfident ? '' : ' (ancora in parte stimate)'
              }. Scrivi un numero solo se la tua settimana cambierà davvero (per esempio in sessione).`
        }
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0.5}
            max={12}
            step={0.25}
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            onBlur={commitCap}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="auto"
            aria-label="Ore di studio al giorno (vuoto = misurate)"
            className={`${INPUT} ds-input-sm ds-num !w-24`}
          />
          {manuale && (
            <button type="button" onClick={() => onChange({ capacitaManuale: null })} className="ds-btn ds-btn-quiet ds-btn-sm">
              Misurate
            </button>
          )}
        </div>
      </SettingRow>
      <div className="px-5 py-4 space-y-2.5">
        <div>
          <p className="text-sm font-medium text-slate-100">Giorni di riposo fissi</p>
          <p className="text-[13px] text-slate-400 mt-0.5 leading-relaxed">
            In questi giorni il piano non mette studio (al massimo tre). Il resto della settimana assorbe il lavoro: meglio dichiararli che saltarli.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Giorni di riposo">
          {GIORNI_SETTIMANA.map((g) => {
            const on = riposo.includes(g.v);
            return (
              <button
                key={g.v}
                type="button"
                aria-pressed={on}
                onClick={() => toggleGiorno(g.v)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  on ? 'border-secondary/60 bg-secondary/15 text-white' : 'border-line bg-surface text-slate-400 hover:text-slate-200'
                }`}
              >
                {g.l}
              </button>
            );
          })}
        </div>
      </div>
      <SettingRow
        title="Riposi concessi dalla serie"
        description="Giorni a settimana senza studio che NON spezzano la serie di studio. Un giorno conta per la serie da 25 minuti di Focus."
      >
        <div className="ds-segmented" role="radiogroup" aria-label="Riposi a settimana">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={Number(settings.streakRiposiSettimana) === n} onClick={() => onChange({ streakRiposiSettimana: n })} className="ds-num">
              {n}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow
        title="Chiudi la giornata"
        description="Da che ora Mission Control ti propone di chiudere la giornata e fissare il primo blocco di domani."
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">dalle</span>
          <input
            type="number"
            min={15}
            max={23}
            value={settings.chiusuraOra ?? 19}
            onChange={(e) => onChange({ chiusuraOra: Number(e.target.value) })}
            aria-label="Ora da cui proporre la chiusura della giornata"
            className={`${INPUT} ds-input-sm ds-num !w-20`}
          />
          <span className="text-xs text-slate-500">:00</span>
        </div>
      </SettingRow>
      <SettingRow
        title="Anno di immatricolazione"
        description="Serve alla stima del voto di laurea (regolamento del corso): il punteggio per la durata degli studi dipende dagli anni in corso."
      >
        <input
          type="number"
          min={2000}
          max={2100}
          value={annoInput}
          onChange={(e) => setAnnoInput(e.target.value)}
          onBlur={commitAnno}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="Es. 2024"
          aria-label="Anno di immatricolazione"
          className={`${INPUT} ds-input-sm ds-num !w-28`}
        />
      </SettingRow>
      <SettingRow title="Esperienza Erasmus" description="Un periodo all'estero riconosciuto vale un punto in più nel voto di laurea.">
        <Switch checked={settings.erasmus === true} onChange={() => onChange({ erasmus: settings.erasmus !== true })} ariaLabel="Esperienza Erasmus" />
      </SettingRow>
    </Panel>
  );
}

/** Punti di ripristino locali (IndexedDB), vedi utils/localBackups.js. */
function RestorePoints({ actions, pushToast }) {
  const supported = backupsSupported();
  const [snapshots, setSnapshots] = useState(null);
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      setSnapshots([]);
      return;
    }
    try {
      setSnapshots(await actions.listSnapshots());
    } catch {
      setSnapshots([]);
    }
  }, [actions, supported]);

  useEffect(() => {
    refresh();
    // Una copia salvata altrove (quella automatica del giorno, o prima di
    // un'operazione rischiosa) compare qui senza ricaricare la pagina.
    window.addEventListener(SNAPSHOTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SNAPSHOTS_CHANGED_EVENT, refresh);
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    const meta = await actions.createSnapshot();
    setBusy(false);
    if (meta) pushToast('Punto di ripristino creato su questo dispositivo.', 'success');
    else pushToast('Non sono riuscita a salvare il punto di ripristino su questo browser.', 'danger');
    refresh();
  };

  const download = async (snap) => {
    const full = await actions.readSnapshot(snap.id);
    if (!full?.state) {
      pushToast('Questa copia non è più leggibile.', 'danger');
      return;
    }
    downloadJson(full.state, `arachnoforge-ripristino-${stampNow(new Date(snap.createdAt))}.json`);
  };

  const restore = async () => {
    const snap = restoreTarget;
    setRestoreTarget(null);
    if (!snap) return;
    setBusy(true);
    const full = await actions.readSnapshot(snap.id);
    const result = full?.state ? await actions.restoreSnapshot(full.state) : { valid: false, reason: 'Copia non leggibile.' };
    setBusy(false);
    if (result.valid) pushToast(`Profilo ripristinato a: ${formatSnapshotWhen(snap.createdAt)}. Lo stato di prima è salvato fra i punti di ripristino.`, 'success');
    else pushToast(`Ripristino non riuscito: ${result.reason || 'copia non valida'}.`, 'danger');
    refresh();
  };

  const remove = async () => {
    const snap = deleteTarget;
    setDeleteTarget(null);
    if (!snap) return;
    await actions.deleteSnapshot(snap.id);
    refresh();
  };

  return (
    <Panel>
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">Punti di ripristino automatici</p>
          <p className="text-[13px] text-slate-400 mt-0.5 leading-relaxed">
            Una copia al giorno (le ultime {AUTO_KEEP}) e una prima di ogni operazione rischiosa: import, reset, conflitto
            fra dispositivi, eliminazione di una materia (le ultime {SAFETY_KEEP}). Restano su questo dispositivo.
          </p>
        </div>
        <button type="button" onClick={create} disabled={!supported || busy} className={`${BTN_GHOST} ds-btn-sm shrink-0`}>
          <Icon name="plus" className="w-3.5 h-3.5" />
          Crea ora
        </button>
      </div>

      {!supported ? (
        <p className="px-5 py-4 text-[13px] text-accent">
          Questo browser non permette di salvare copie locali (per esempio in navigazione privata). Usa l'esportazione
          manuale qui sotto.
        </p>
      ) : snapshots === null ? (
        <p className="px-5 py-4 text-[13px] text-slate-500">Carico l'elenco…</p>
      ) : snapshots.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-slate-500">Nessuna copia ancora: la prima arriva da sola al prossimo avvio della giornata.</p>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto af-scroll">
          {snapshots.map((snap) => (
            <li key={snap.id} className="flex items-center gap-3 px-5 py-3 border-t border-white/[0.06] first:border-t-0">
              <span className="ds-icon-tile !w-8 !h-8 text-slate-400 shrink-0">
                <Icon name={snap.reason === 'auto' ? 'history' : snap.reason === 'manual' ? 'archive' : 'shield'} className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-slate-100">
                  {formatSnapshotWhen(snap.createdAt)}
                  <span className="text-slate-500"> · {SNAPSHOT_REASON_LABEL[snap.reason] || 'Copia'}</span>
                  {snap.label && <span className="text-slate-500"> · {snap.label}</span>}
                </p>
                <p className="text-xs text-slate-500 ds-num">
                  Lv {snap.summary?.level ?? '—'} · {snap.summary?.materie ?? 0} materie · {snap.summary?.nodi ?? 0} argomenti ·{' '}
                  {minutiLabel(snap.summary?.minutiFocus ?? 0)} di Focus · {formatDecimal((snap.bytes || 0) / 1024, 0)} KB
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setRestoreTarget(snap)} disabled={busy} className="ds-btn ds-btn-ghost ds-btn-sm">
                  <Icon name="undo" className="w-3.5 h-3.5" />
                  Ripristina
                </button>
                <button type="button" onClick={() => download(snap)} className="ds-icon-btn !w-8 !h-8" aria-label="Scarica questa copia" title="Scarica come file">
                  <Icon name="download" className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setDeleteTarget(snap)} className="ds-icon-btn !w-8 !h-8 hover:!text-primary" aria-label="Elimina questa copia" title="Elimina">
                  <Icon name="trash" className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={restore}
        title="Ripristinare questa copia?"
        message={
          restoreTarget
            ? `Il profilo torna com'era: ${formatSnapshotWhen(restoreTarget.createdAt)} (${restoreTarget.summary?.materie ?? 0} materie, ${restoreTarget.summary?.nodi ?? 0} argomenti). Lo stato di adesso viene salvato prima come punto di ripristino, quindi puoi sempre tornare indietro.`
            : ''
        }
        confirmLabel="Ripristina"
        danger={false}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Eliminare questa copia?"
        message="Il punto di ripristino viene cancellato da questo dispositivo. Il profilo attuale non cambia."
        confirmLabel="Elimina"
      />
    </Panel>
  );
}

export default function CoreConfig() {
  const { state, actions, storageMode, pushToast, derived } = useArachnoForge();
  const { user, isGuest } = useAuthContext();

  // V36.0 — il permesso notifiche si legge dal browser (unica fonte di
  // verità): l'impostazione salvata può essere "sì" con il permesso nel
  // frattempo revocato, e l'interruttore non deve mentire.
  const [notifyPermission, setNotifyPermission] = useState(notificationPermission);

  const handleToggleNotifications = async () => {
    const enabled = state.settings.systemNotifications === true && notifyPermission === NOTIFY_PERMISSION.GRANTED;
    if (enabled) {
      actions.updateSettings({ systemNotifications: false });
      return;
    }
    let permission = notificationPermission();
    if (permission === NOTIFY_PERMISSION.DEFAULT) permission = await requestNotificationPermission();
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

  const [focusTime, setFocusTime] = useState(state.settings.focusTime);
  const [shortBreakTime, setShortBreakTime] = useState(state.settings.shortBreakTime);
  const [longBreakTime, setLongBreakTime] = useState(state.settings.longBreakTime);
  const [username, setUsername] = useState(state.profile.username);
  const [importMessage, setImportMessage] = useState(null);
  // V37.0 — l'import passa da una conferma esplicita con il riepilogo del file.
  const [pendingImport, setPendingImport] = useState(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const fileInputRef = useRef(null);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  // V33.0 — "no" fisico sulla card di una Spider-Suit ancora bloccata.
  const [shakingSuitId, setShakingSuitId] = useState(null);
  const shakeTimeoutRef = useRef(null);
  const triggerSuitShake = (suitId) => {
    if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
    setShakingSuitId(suitId);
    shakeTimeoutRef.current = setTimeout(() => setShakingSuitId(null), 400);
  };
  useEffect(
    () => () => {
      if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
    },
    []
  );

  // V28.1 — passphrase dell'override Admin: mai persistita, validata al clic.
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState(null);
  const isSandboxActive = storageMode === 'sandbox';
  const passphraseConfigured = isAdminPassphraseConfigured();

  // V28.2 — il valore ripulito arriva fino all'azione (prima veniva perso).
  const handleActivateSandbox = () => {
    const cleaned = adminPassword.trim();
    if (validateAdminPassphrase(cleaned)) {
      setAdminError(null);
      setAdminPassword('');
      actions.activateSandbox(cleaned);
    } else {
      setAdminError(
        passphraseConfigured
          ? 'Passphrase di override non riconosciuta.'
          : "Nessuna passphrase configurata: aggiungi ?sandbox=1 all'indirizzo per attivare la Sandbox."
      );
    }
  };

  const [logsOpen, setLogsOpen] = useState(false);

  // V39 — le copie locali dei campi seguono lo stato quando cambia da fuori
  // (sincronizzazione, import, reset).
  useEffect(() => setFocusTime(state.settings.focusTime), [state.settings.focusTime]);
  useEffect(() => setShortBreakTime(state.settings.shortBreakTime), [state.settings.shortBreakTime]);
  useEffect(() => setLongBreakTime(state.settings.longBreakTime), [state.settings.longBreakTime]);
  useEffect(() => setUsername(state.profile.username), [state.profile.username]);

  // Solo i campi cambiati, e fra 1 e 180 minuti.
  const clampMinutes = (v, fallback) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1) return Math.max(1, Number(fallback) || 1);
    return Math.min(180, n);
  };
  const commitSettings = () => {
    const next = {
      focusTime: clampMinutes(focusTime, state.settings.focusTime),
      shortBreakTime: clampMinutes(shortBreakTime, state.settings.shortBreakTime),
      longBreakTime: clampMinutes(longBreakTime, state.settings.longBreakTime)
    };
    const patch = {};
    Object.keys(next).forEach((k) => {
      if (next[k] !== state.settings[k]) patch[k] = next[k];
    });
    setFocusTime(next.focusTime);
    setShortBreakTime(next.shortBreakTime);
    setLongBreakTime(next.longBreakTime);
    if (Object.keys(patch).length > 0) {
      actions.updateSettings(patch);
      pushToast('Timer aggiornato.', 'success', { duration: 2000 });
    }
  };

  const commitUsername = () => {
    const clean = String(username || '').trim();
    if (!clean) {
      setUsername(state.profile.username);
      return;
    }
    if (clean !== state.profile.username) actions.updateProfile({ username: clean });
  };

  // V37.0 — `silent`: le copie automatiche (pre-import/pre-reset) non
  // aggiornano la data dell'ultimo backup VOLUTO.
  const exportProfile = ({ silent = false, prefix = 'arachnoforge-profile' } = {}) => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(state, `${prefix}-${stamp}.json`);
    if (silent) return;
    actions.updateSettings({ lastExportDateKey: stamp });
  };

  const daysSinceExport = (() => {
    const last = state.settings.lastExportDateKey;
    if (typeof last !== 'string') return null;
    const diff = Math.floor((Date.now() - new Date(`${last}T00:00:00Z`).getTime()) / 86400000);
    return Number.isFinite(diff) ? Math.max(0, diff) : null;
  })();
  const backupStale = daysSinceExport == null || daysSinceExport >= 14;

  /** V32.0 — date d'esame in un file .ics (RFC 5545), per Google/Apple/Outlook. */
  const escapeIcsText = (text) => String(text).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const exportExamDatesIcs = () => {
    const materieConData = (Array.isArray(state.materie) ? state.materie : []).filter(
      (m) => m && typeof m.examDate === 'string' && m.examDate.length === 10
    );
    if (materieConData.length === 0) {
      pushToast("Nessuna data d'esame impostata sulle materie del Web-Matrix.", 'info');
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
    a.href = url;
    a.download = `arachnoforge-esami-${new Date().toISOString().slice(0, 10)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    pushToast(`${materieConData.length === 1 ? '1 data d’esame esportata' : `${materieConData.length} date d’esame esportate`} nel file .ics.`, 'success');
  };

  const handleImportClick = () => fileInputRef.current?.click();

  // V37.0 — il file viene letto e VALIDATO, poi serve una conferma esplicita.
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const validation = validateImportedProfile(parsed);
        if (!validation.valid) {
          setImportMessage({ type: 'error', text: validation.reason });
          return;
        }
        setImportMessage(null);
        setPendingImport({ data: parsed, fileName: file.name, summary: summarizeProfile(parsed) });
      } catch {
        setImportMessage({ type: 'error', text: 'File non leggibile: JSON malformato.' });
      }
    };
    reader.onerror = () => setImportMessage({ type: 'error', text: 'Impossibile leggere il file selezionato.' });
    reader.readAsText(file);
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    // Rete di sicurezza: il profilo attuale finisce nei Download (e nei
    // punti di ripristino, vedi l'azione) PRIMA di essere sostituito.
    exportProfile({ silent: true, prefix: 'arachnoforge-backup-pre-import' });
    const result = actions.importProfile(pendingImport.data);
    setImportMessage(
      result.valid
        ? { type: 'success', text: 'Profilo importato. Il profilo precedente è nei tuoi Download e fra i punti di ripristino.' }
        : { type: 'error', text: result.reason }
    );
    setPendingImport(null);
  };

  const confirmReset = () => {
    exportProfile({ silent: true, prefix: 'arachnoforge-backup-pre-reset' });
    actions.resetProfile();
    pushToast('Reset eseguito. Il profilo precedente è nei tuoi Download e fra i punti di ripristino.', 'info');
  };

  const scrollTo = (id) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // V41 — "Backup" dalla palette comandi (Ctrl K).
  useIntent(INTENT.SETTINGS_BACKUP, () => setTimeout(() => scrollTo('cfg-backup'), 60));

  // Indice: evidenzia la sezione che si sta leggendo.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const cal = derived.calibration;
  const detailedFrom = oldestDetailedMonth(state.starLog);
  const combatLog = Array.isArray(state.combatLog) ? state.combatLog : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Impostazioni"
        icon="chip"
        title="Karen OS Settings"
        subtitle="Profilo, aspetto, timer, avvisi e dati. Le modifiche si applicano subito."
        actions={<span className={BADGE.slate}>Schema v{SCHEMA_VERSION}</span>}
      />

      {/* V41 — l'indice laterale compare da 1200 px: sotto, con la barra
          laterale dell'app già aperta, toglieva troppo spazio alle righe. */}
      <div className="grid grid-cols-1 min-[1200px]:grid-cols-[210px_minmax(0,1fr)] gap-8 items-start">
        {/* Indice delle sezioni (PC). */}
        <nav className="hidden min-[1200px]:block sticky top-4" aria-label="Sezioni delle impostazioni">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  aria-current={activeSection === s.id ? 'true' : undefined}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left transition-colors ${
                    activeSection === s.id ? 'bg-panel-2 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  <Icon name={s.icon} className="w-4 h-4 shrink-0" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-3xl space-y-10">
          {/* ------------------------------------------------ PROFILO */}
          <Section id="cfg-profilo" title="Profilo e accesso">
            <Panel>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">Nome</p>
                  <p className="text-[13px] text-slate-400 mt-0.5">Come ti chiama Karen, nella barra laterale e nei briefing.</p>
                </div>
                <input
                  id="cfg-username"
                  type="text"
                  maxLength={40}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={commitUsername}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  className={`${INPUT} sm:!w-64`}
                  aria-label="Nome"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100 flex items-center gap-2 flex-wrap">
                    {isGuest ? 'Modalità Ospite' : 'Account'}
                    {isSandboxActive && <span className={BADGE.violet}>Sandbox Admin attiva</span>}
                  </p>
                  <p className="text-[13px] text-slate-400 mt-0.5 break-all">
                    {isGuest ? 'Dati solo su questo browser, nessuna sincronizzazione.' : user?.email || '—'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {isGuest
                      ? 'Esci e crea un account dal Nexus Gate per portare i dati su altri dispositivi.'
                      : isSandboxActive
                      ? 'Le modifiche restano isolate in locale e non toccano il profilo Cloud reale.'
                      : 'Il profilo è salvato sul Cloud: accedi da qualsiasi dispositivo con le stesse credenziali.'}
                  </p>
                </div>
                <button type="button" onClick={() => setLogoutConfirmOpen(true)} className={`${BTN_GHOST} shrink-0`}>
                  <Icon name="logout" className="w-4 h-4" />
                  {isGuest ? 'Esci dalla Modalità Ospite' : 'Esci'}
                </button>
              </div>
              {/* V41 — cambio password senza passare dalla dashboard di Supabase. */}
              {!isGuest && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">Password</p>
                    <p className="text-[13px] text-slate-400 mt-0.5">
                      Vale per tutti i dispositivi. Se la dimentichi, «Password dimenticata?» nella schermata di accesso ti manda un link.
                    </p>
                  </div>
                  <button type="button" onClick={() => setPasswordOpen(true)} className={`${BTN_GHOST} shrink-0`}>
                    <Icon name="lock" className="w-4 h-4" />
                    Cambia password
                  </button>
                </div>
              )}
            </Panel>
          </Section>

          {/* ------------------------------------------------ ASPETTO */}
          <Section id="cfg-aspetto" title="Aspetto" subtitle="Il costume cambia i colori di tutta l'app; gli interruttori, quanto si muove.">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SUIT_OPTIONS.map((suit) => {
                const active = state.settings.suit === suit.id;
                // V32.0 — Classic sempre disponibile; Symbiote dopo il primo
                // Maximum Carnage; 2099 al Livello 50. Una tuta già in uso non
                // viene mai bloccata a posteriori.
                let locked = false;
                let lockReason = '';
                if (suit.id === SUITS.SYMBIOTE) {
                  locked = !active && state.profile.symbioteSuitUnlocked !== true;
                  lockReason = 'Si sblocca attivando almeno una volta il Maximum Carnage Mode (5 azioni critiche di fila).';
                } else if (suit.id === SUITS.Y2099) {
                  locked = !active && (state.profile.level || 1) < 50;
                  lockReason = 'Si sblocca al Livello 50, Difensore del Multiverso.';
                }
                return (
                  <button
                    key={suit.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (locked) {
                        pushToast(lockReason, 'info');
                        triggerSuitShake(suit.id);
                        return;
                      }
                      actions.updateSettings({ suit: suit.id });
                    }}
                    className={`text-left p-4 rounded-[var(--af-radius-card)] border transition-colors ${shakingSuitId === suit.id ? 'af-locked-shake' : ''} ${
                      active ? 'border-secondary/60 bg-secondary/[0.07]' : locked ? 'border-line bg-panel opacity-60' : 'border-line bg-panel hover:border-line-strong'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex -space-x-1.5">
                        {suit.swatch.map((color, i) => (
                          <span
                            key={i}
                            className="w-6 h-6 rounded-full border-2 border-panel"
                            style={{ backgroundColor: color, filter: locked ? 'grayscale(0.7)' : 'none' }}
                          />
                        ))}
                      </div>
                      {active ? (
                        <span className={BADGE.blue}>
                          <Icon name="check" className="w-3 h-3" />
                          In uso
                        </span>
                      ) : locked ? (
                        <Icon name="lock" className="w-4 h-4 text-slate-500" />
                      ) : null}
                    </div>
                    <p className="text-sm font-semibold text-slate-100">{suit.nome}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{locked ? lockReason : suit.descrizione}</p>
                  </button>
                );
              })}
            </div>
            <Panel>
              <SettingRow
                title="Sensory Zero · basso stimolo"
                description="Niente screen-shake, flash e animazioni intense (Sinister Six, interfaccia di fatica): solo concentrazione."
              >
                <Switch checked={!!state.settings.calmMode} onChange={() => actions.updateSettings({ calmMode: !state.settings.calmMode })} ariaLabel="Sensory Zero" />
              </SettingRow>
              <SettingRow
                title="Effetti pesanti"
                description="Sfocature, particelle e interferenza. Spegnili su computer o telefoni meno recenti: l'informazione resta identica."
              >
                <Switch
                  checked={state.settings.heavyEffects !== false}
                  onChange={() => actions.updateSettings({ heavyEffects: state.settings.heavyEffects === false })}
                  ariaLabel="Effetti pesanti"
                />
              </SettingRow>
              <SettingRow
                title="Una cosa alla volta"
                description="Lo Stark-Web Terminal si apre sulla decisione del momento: il briefing di Karen e la quota di oggi restano chiusi, a un clic da «Briefing e quota». La Daily Patrol resta sempre in vista."
              >
                <Switch
                  checked={state.settings.focusFirstHome !== false}
                  onChange={() => actions.updateSettings({ focusFirstHome: state.settings.focusFirstHome === false })}
                  ariaLabel="Una cosa alla volta"
                />
              </SettingRow>
            </Panel>
          </Section>

          {/* ------------------------------------------------ TIMER */}
          <Section id="cfg-timer" title="Timer" subtitle="Durate predefinite dei blocchi, da 1 a 180 minuti.">
            <Panel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-5 py-4">
                {[
                  { id: 'cfg-focus-time', label: 'Focus', value: focusTime, set: setFocusTime },
                  { id: 'cfg-short-break', label: 'Pausa breve', value: shortBreakTime, set: setShortBreakTime },
                  { id: 'cfg-long-break', label: 'Pausa lunga', value: longBreakTime, set: setLongBreakTime }
                ].map((f) => (
                  <div key={f.id}>
                    <label htmlFor={f.id} className={LABEL}>
                      {f.label}
                    </label>
                    <div className="relative">
                      <input
                        id={f.id}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={180}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        onBlur={commitSettings}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        className={`${INPUT} ds-num !pr-12`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">min</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* V35.0 — Focus Timer Adattivo: mai un override silenzioso. */}
              <SettingRow
                title="Focus Timer Adattivo K.A.R.E.N."
                description="Karen ricalibra Focus e Pausa breve sulla readiness biometrica del giorno (per esempio 25/5 in banda critica, 50/10 in banda ottimale). Senza telemetria valgono i valori qui sopra."
              >
                <Switch
                  checked={state.settings.karenAdaptiveTimer !== false}
                  onChange={() => actions.updateSettings({ karenAdaptiveTimer: state.settings.karenAdaptiveTimer === false })}
                  ariaLabel="Focus Timer Adattivo K.A.R.E.N."
                />
              </SettingRow>
            </Panel>
          </Section>

          {/* ------------------------------------------------ PIANO */}
          <Section id="cfg-piano" title="Piano di studio" subtitle="Le regole con cui il planner costruisce le tue giornate.">
            <PianoSettings settings={state.settings} calibration={cal} onChange={(patch) => actions.updateSettings(patch)} />
          </Section>

          {/* ------------------------------------------------ AVVISI */}
          <Section id="cfg-avvisi" title="Suoni e notifiche">
            <Panel>
              <SettingRow
                title="Effetti sonori"
                description="Fine blocco e fine pausa, clic, penalità, level up e allarmi: tutto sintetizzato al volo, nessun file esterno. Spenti anche con Sensory Zero."
              >
                <Switch
                  checked={state.settings.soundEffects !== false}
                  onChange={() => actions.updateSettings({ soundEffects: state.settings.soundEffects === false })}
                  ariaLabel="Effetti sonori"
                />
              </SettingRow>
              <SettingRow title="Rintocco ogni 30 minuti" description="Dentro una sessione lunga, ogni mezz'ora di Focus accumulato. Il suono di fine blocco resta comunque.">
                <Switch
                  checked={state.settings.focusReminder !== false}
                  onChange={() => actions.updateSettings({ focusReminder: state.settings.focusReminder === false })}
                  ariaLabel="Rintocco ogni 30 minuti"
                />
              </SettingRow>
              <SettingRow title="Drone simbionte" description="Il ronzio grave delle due ore di Maximum Carnage. Si zittisce anche dal banner in cima alla pagina.">
                <Switch
                  checked={state.settings.carnageDrone !== false}
                  onChange={() => actions.updateSettings({ carnageDrone: state.settings.carnageDrone === false })}
                  ariaLabel="Drone simbionte"
                />
              </SettingRow>
              <SettingRow
                title="Notifiche di sistema"
                description="A fine blocco Focus e a fine pausa, anche con lo schermo bloccato o l'app in secondo piano."
                note={
                  notifyPermission === 'denied' ? (
                    <p className="text-xs text-primary mt-1.5">Permesso negato dal browser: va riattivato dalle impostazioni del sito.</p>
                  ) : notifyPermission === 'unsupported' ? (
                    <p className="text-xs text-slate-500 mt-1.5">Questo browser non espone le notifiche di sistema.</p>
                  ) : null
                }
              >
                <Switch
                  checked={state.settings.systemNotifications === true && notifyPermission === 'granted'}
                  onChange={handleToggleNotifications}
                  ariaLabel="Notifiche di sistema"
                  disabled={notifyPermission === 'unsupported'}
                />
              </SettingRow>
              <SettingRow title="Schermo sempre acceso durante il Focus" description="Mai durante le pause: lì spegnere è il punto.">
                <Switch
                  checked={state.settings.keepScreenAwake !== false}
                  onChange={() => actions.updateSettings({ keepScreenAwake: state.settings.keepScreenAwake === false })}
                  ariaLabel="Mantieni schermo acceso"
                />
              </SettingRow>
            </Panel>
          </Section>

          {/* ------------------------------------------------ CALIBRAZIONE */}
          {/* V36.0 — "Karen impara da te": i numeri misurati su di te che
              governano ogni proiezione, con la loro affidabilità. */}
          <Section id="cfg-calibrazione" title="Calibrazione" subtitle="Cosa Karen ha misurato su di te. Finché un numero non è affidabile, lo dice.">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {[
                {
                  label: 'Capacità giornaliera',
                  value: formatHoursMinutes(Number(cal.hoursPerDay) || 0),
                  confident: cal.capacityConfident,
                  text: cal.manualHours
                    ? 'Decisa da te (Piano di studio): il planner usa questo numero invece della media misurata.'
                    : cal.capacityConfident
                    ? `Media reale delle ultime ${cal.observedDays} giornate concluse, riposi inclusi${cal.weekdayConfident ? ', con il tuo ritmo giorno per giorno della settimana' : ''}.`
                    : `Valore di partenza, già in parte tuo (${cal.observedDays} giornate misurate): dopo 7 giorni diventa del tutto la tua media.`
                },
                {
                  label: 'Durata di un ripasso',
                  value: `${Math.round(Number(cal.reviewMinutes) || 0)} min`,
                  confident: cal.reviewMinutesConfident,
                  text: cal.reviewMinutesConfident
                    ? 'Misurata sulle tue sessioni di Ripasso: è il tempo che il piano riserva a ogni ripasso dovuto.'
                    : 'Valore di partenza: si misura da solo con qualche sessione in modo Ripasso.'
                },
                {
                  label: 'Precisione delle tue stime',
                  value: `×${formatDecimal(cal.biasFactor, 2)}`,
                  confident: cal.biasConfident,
                  text: cal.biasConfident
                    ? cal.biasFactor > 1.05
                      ? `Su ${cal.biasSampleSize} argomenti chiusi ogni ora prevista te ne è costate ${formatDecimal(cal.biasFactor, 2)}: le previsioni vengono corrette.`
                      : cal.biasFactor < 0.95
                      ? `Su ${cal.biasSampleSize} argomenti chiusi sei più veloce delle tue stime: le proiezioni si accorciano.`
                      : `Su ${cal.biasSampleSize} argomenti chiusi le tue stime sono accurate: nessuna correzione.`
                    : `Servono almeno 5 argomenti completati con Focus tracciato (ne hai ${cal.biasSampleSize}).`
                },
                {
                  label: 'Ritmo di lettura',
                  value: cal.pagesConfident ? `${formatDecimal(cal.pagesPerHour, 1)} pag/h` : '—',
                  confident: cal.pagesConfident,
                  text: cal.pagesConfident
                    ? `Misurato su ${cal.pagesSampleSize} argomenti chiusi: dove dichiari le pagine, le ore si calcolano da qui.`
                    : `Servono almeno 4 argomenti completati con pagine e Focus tracciato (ne hai ${cal.pagesSampleSize}).`
                },
                {
                  label: 'Ritmo di sintesi',
                  value: cal.sintesiConfident ? `${formatDecimal(cal.sintesiPagesPerHour, 1)} pag/h` : '—',
                  confident: cal.sintesiConfident,
                  text: cal.sintesiConfident
                    ? `Pagine di fonte snellite in un'ora, su ${cal.sintesiSampleSize} sessioni di Sintesi.`
                    : `Servono 3 sessioni di Sintesi con le pagine indicate (ne hai ${cal.sintesiSampleSize}); intanto vale ${formatDecimal(cal.sintesiPagesPerHourRaw, 1)} pag/h.`
                },
                {
                  label: 'Resa di sintesi',
                  value: `${Math.round((cal.resaSintesi || cal.resaSintesiRaw) * 100)} su 100`,
                  confident: cal.resaConfident,
                  text: cal.resaConfident
                    ? `Da 100 pagine di fonte ne ricavi ${Math.round(cal.resaSintesi * 100)} di appunti tuoi (${cal.resaSampleSize} argomenti con sintesi chiusa).`
                    : `Quanto si restringe il materiale nelle tue mani: servono 3 argomenti con sintesi chiusa (ne hai ${cal.resaSampleSize}).`
                }
              ].map((c) => (
                <div key={c.label} className={`${CARD_NOPAD} p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-400">{c.label}</p>
                    <span className={c.confident ? BADGE.green : BADGE.slate}>{c.confident ? 'Misurato' : 'Stima'}</span>
                  </div>
                  <p className="text-xl font-bold text-white mt-1.5 ds-num">{c.value}</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{c.text}</p>
                </div>
              ))}
            </div>
            {detailedFrom && (
              <p className="text-xs text-slate-500 leading-relaxed">
                Cronologia dettagliata delle sessioni disponibile da <span className="text-slate-300">{formatMonthYearHuman(detailedFrom)}</span>. I
                totali giornalieri (heatmap, minuti, calibrazione) restano completi per sempre.
              </p>
            )}
          </Section>

          {/* ------------------------------------------------ BACKUP */}
          <Section id="cfg-backup" title="Backup e dati" subtitle="Il tuo percorso di studi è prezioso: qui lo metti al sicuro.">
            <div
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                backupStale ? 'border-accent/35 bg-accent/[0.06]' : 'border-emerald-400/30 bg-emerald-500/[0.06]'
              }`}
            >
              <Icon name={backupStale ? 'alertTriangle' : 'check'} className={`w-4 h-4 shrink-0 mt-0.5 ${backupStale ? 'text-accent' : 'text-emerald-300'}`} />
              <p className={`text-[13px] leading-relaxed ${backupStale ? 'text-accent' : 'text-emerald-200'}`}>
                {daysSinceExport == null
                  ? 'Non hai mai scaricato un file di backup. I punti di ripristino qui sotto proteggono da errori su questo dispositivo; un file esportato protegge da tutto il resto.'
                  : backupStale
                  ? `Ultimo file di backup ${daysSinceExport} giorni fa: conviene scaricarne uno fresco.`
                  : `Ultimo file di backup ${daysSinceExport === 0 ? 'oggi' : daysSinceExport === 1 ? 'ieri' : `${daysSinceExport} giorni fa`}.`}
              </p>
            </div>

            <RestorePoints actions={actions} pushToast={pushToast} />

            <Panel>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">File di backup</p>
                  <p className="text-[13px] text-slate-400 mt-0.5 leading-relaxed">
                    Scarica tutto il profilo in un file .json, o sostituiscilo con uno salvato. L'import mostra cosa contiene il file
                    prima di procedere e salva comunque una copia di quello attuale.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" onClick={() => exportProfile()} className={`${BTN_SECONDARY} ds-btn-sm`}>
                    <Icon name="download" className="w-3.5 h-3.5" />
                    Esporta
                  </button>
                  <button type="button" onClick={handleImportClick} className={`${BTN_GHOST} ds-btn-sm`}>
                    <Icon name="upload" className="w-3.5 h-3.5" />
                    Importa
                  </button>
                  <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFileChange} />
                </div>
              </div>
              {importMessage && (
                <p className={`px-5 py-3 text-[13px] ${importMessage.type === 'success' ? 'text-emerald-300' : 'text-primary'}`}>{importMessage.text}</p>
              )}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100">Date d'esame nel calendario</p>
                  <p className="text-[13px] text-slate-400 mt-0.5">
                    Un file .ics con tutti gli appelli delle materie, da importare in Google Calendar, Apple Calendar o Outlook.
                  </p>
                </div>
                <button type="button" onClick={exportExamDatesIcs} className={`${BTN_GHOST} ds-btn-sm shrink-0`}>
                  <Icon name="calendar" className="w-3.5 h-3.5" />
                  Esporta .ics
                </button>
              </div>
            </Panel>
            <p className="text-xs text-slate-500 leading-relaxed">
              Dopo un import il nuovo stato si salva da solo
              {storageMode === 'cloud' ? ' sul Cloud' : storageMode === 'sandbox' ? ' nella Sandbox locale (mai sul Cloud reale)' : ' su questo browser'}. Con
              un file danneggiato il profilo attuale resta com'è.
            </p>
          </Section>

          {/* ------------------------------------------------ AVANZATE */}
          <Section id="cfg-avanzate" title="Avanzate">
            {/* V28.1 — Sandbox Admin: invisibile in Modalità Ospite (già tutta locale). */}
            {!isGuest && (
              <Panel className={isSandboxActive ? '!border-violet-400/40' : ''}>
                <div className="px-5 py-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">Override di sistema · Sandbox Admin</p>
                    <p className="text-[13px] text-slate-400 mt-0.5 leading-relaxed">
                      Un profilo di prova completamente isolato (solo locale, mai il Cloud) per sperimentare senza rischi.
                    </p>
                  </div>
                  {!passphraseConfigured && !isSandboxActive && (
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Nessuna passphrase configurata (<span className="font-mono text-slate-300">VITE_ADMIN_PASSPHRASE</span>): la Sandbox resta
                      raggiungibile aggiungendo <span className="font-mono text-slate-300">?sandbox=1</span> all'indirizzo e premendo qui sotto.
                    </p>
                  )}
                  {!isSandboxActive ? (
                    <div className="space-y-2">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          type="password"
                          value={adminPassword}
                          onChange={(e) => {
                            setAdminPassword(e.target.value);
                            if (adminError) setAdminError(null);
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && handleActivateSandbox()}
                          placeholder={passphraseConfigured ? 'Passphrase di override' : 'Nessuna passphrase richiesta'}
                          disabled={!passphraseConfigured}
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck="false"
                          className={`${INPUT} flex-1`}
                          aria-label="Passphrase di override"
                        />
                        <button type="button" onClick={handleActivateSandbox} disabled={passphraseConfigured && !adminPassword} className={`${BTN_GHOST} shrink-0`}>
                          <Icon name="lock" className="w-4 h-4" />
                          Attiva Sandbox
                        </button>
                      </div>
                      {adminError && (
                        <p className="text-xs text-primary flex items-center gap-1.5">
                          <Icon name="alertTriangle" className="w-3.5 h-3.5 shrink-0" />
                          {adminError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <p className="text-[13px] text-violet-300 flex items-center gap-2">
                        <Icon name="chip" className="w-4 h-4" />
                        Protocollo Admin attivo: stai usando la Sandbox.
                      </p>
                      <button type="button" onClick={actions.deactivateSandbox} className={`${BTN_GHOST} ds-btn-sm`}>
                        <Icon name="logout" className="w-3.5 h-3.5" />
                        Torna al profilo reale
                      </button>
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {/* V28.1 — il Combat Log: a disposizione, chiuso di default. */}
            <Panel>
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                aria-expanded={logsOpen}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-100">Registro di sistema</span>
                  <span className="block text-[13px] text-slate-400 mt-0.5">Gli ultimi {formatInt(combatLog.length)} eventi registrati da Karen.</span>
                </span>
                <Icon name="chevronDown" className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${logsOpen ? 'rotate-180' : ''}`} />
              </button>
              {logsOpen && (
                <div className="px-5 py-4 h-80">
                  <CombatLog entries={combatLog} />
                </div>
              )}
            </Panel>

            <Panel className="!border-primary/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary">Reset totale</p>
                  <p className="text-[13px] text-slate-400 mt-0.5 leading-relaxed">
                    Riporta tutto ai valori iniziali: livello 1, nessuna materia, nessun log. Prima scarica una copia e la salva fra i
                    punti di ripristino.
                  </p>
                </div>
                <button type="button" onClick={() => setResetConfirmOpen(true)} className={`${BTN_DANGER} shrink-0`}>
                  <Icon name="trash" className="w-4 h-4" />
                  Reset totale
                </button>
              </div>
            </Panel>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={confirmReset}
        title="Cancellare tutto?"
        message="XP, materie, Skill Tree, log e ricompense tornano a zero. Prima di procedere scarico una copia del profilo nei tuoi Download e la salvo fra i punti di ripristino, così puoi tornare indietro."
        confirmLabel="Cancella tutto"
      />

      {/* V37.0 — conferma dell'import con davanti il contenuto reale del file. */}
      <ConfirmDialog
        open={!!pendingImport}
        onClose={() => setPendingImport(null)}
        onConfirm={confirmImport}
        title="Sostituire il profilo?"
        message={
          pendingImport
            ? `"${pendingImport.fileName}" contiene: ${pendingImport.summary?.username}, livello ${pendingImport.summary?.level}, ` +
              `${pendingImport.summary?.materie} materie, ${pendingImport.summary?.nodi} argomenti, ${pendingImport.summary?.sessioni} sessioni ` +
              `(schema v${pendingImport.summary?.versione}). Sostituirà l'intero profilo attuale, di cui salvo prima una copia. Procedo?`
            : ''
        }
        confirmLabel="Sostituisci profilo"
      />

      <PasswordDialog
        open={passwordOpen}
        mode="change"
        onClose={() => setPasswordOpen(false)}
        onSuccess={() => {
          setPasswordOpen(false);
          pushToast('Password aggiornata.', 'success');
        }}
      />
      <ConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          actions.signOut();
        }}
        title={isGuest ? 'Uscire dalla Modalità Ospite?' : 'Uscire dall’account?'}
        message={
          isGuest
            ? 'I dati di questa sessione Ospite restano su questo browser, ma da qui non saranno più accessibili finché non rientri come Ospite.'
            : 'Il profilo è già salvato sul Cloud: potrai rientrare quando vuoi con le stesse credenziali.'
        }
        confirmLabel="Esci"
        danger={false}
      />
    </div>
  );
}
