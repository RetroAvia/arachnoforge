import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import { useArachnoForge, useFocusTimerContext } from '../context/ArachnoForgeContext.jsx';
import { ROUTES, goTo } from '../hooks/useArachnoForgeRouter.js';
import { INTENT, requestIntent } from '../utils/uiIntents.js';

/**
 * V41 — Palette comandi (Ctrl K / ⌘ K) e scorciatoie globali.
 *
 * Su PC è il modo più rapido di muoversi: una casella, si scrive, Invio.
 * Porta a ogni sezione, a ogni materia e a ogni argomento del Web-Matrix,
 * e comanda il Tactical Timer senza dover tornare allo Stark-Web Terminal.
 *
 * Scorciatoie sempre attive (fuori dai campi di testo):
 *   Ctrl/⌘ K   apre e chiude la palette
 *   Alt 1…9    salta alle sezioni, nell'ordine della barra laterale
 *   ?          elenco delle scorciatoie
 * Quelle del timer (Spazio, Esc, D) restano dello Stark-Web Terminal.
 */

const OPEN_EVENT = 'af:command-palette';

const NAV = [
  { route: ROUTES.MISSION_CONTROL, label: 'Stark-Web Terminal', hint: 'Home, timer e piano del giorno', icon: 'terminal', key: '1', kw: 'home timer oggi piano quota adesso' },
  { route: ROUTES.QUADRANT_HUB, label: 'The Web-Matrix', hint: 'Materie, nodi e Skill Tree', icon: 'web', key: '2', kw: 'materie esami nodi argomenti skill tree' },
  { route: ROUTES.CAMPUS, label: 'Empire State University', hint: 'Semestre, orario e lezioni', icon: 'calendar', key: '3', kw: 'lezioni orario semestre campus sintesi' },
  { route: ROUTES.BOSS_FIGHT, label: 'Sinister Six Simulator', hint: 'Simulazione d’esame a tempo', icon: 'crosshair', key: '4', kw: 'boss fight simulazione esame villain' },
  { route: ROUTES.STAR_LOG, label: 'Daily Bugle Archives', hint: 'Storico, heatmap e statistiche', icon: 'newspaper', key: '5', kw: 'storico statistiche heatmap sessioni star log' },
  { route: ROUTES.ARMORY, label: 'Suit Lab & Trophies', hint: 'Premi, trofei e Skill Tree', icon: 'flask', key: '6', kw: 'premi shop trofei inventario skill token armory' },
  { route: ROUTES.MULTIVERSE_SIMULATOR, label: 'Multiverse Simulator', hint: 'Media, laurea e scenari', icon: 'multiverse', key: '7', kw: 'media voto laurea gpa what if' },
  { route: ROUTES.SUIT_TELEMETRY, label: 'Suit Telemetry', hint: 'Readiness e dati biometrici', icon: 'heart', key: '8', kw: 'salute sonno battito readiness telemetria' },
  { route: ROUTES.CORE_CONFIG, label: 'Karen OS Settings', hint: 'Impostazioni, backup e dati', icon: 'chip', key: '9', kw: 'impostazioni settings backup esporta importa timer suoni tema' }
];

export function openCommandPalette(section = null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { section } }));
}

function isMac() {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
}

/** "Ctrl K" oppure "⌘K" a seconda del sistema. */
export function shortcutLabel(key) {
  return isMac() ? `⌘${key}` : `Ctrl ${key}`;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

const SHORTCUTS = [
  { keys: [shortcutLabel('K')], label: 'Apri la palette comandi' },
  { keys: ['Alt', '1…9'], label: 'Vai alle sezioni della barra laterale' },
  { keys: ['?'], label: 'Mostra queste scorciatoie' },
  { keys: ['Spazio'], label: 'Timer: avvia, metti in pausa, riprendi (Stark-Web Terminal)' },
  { keys: ['Esc'], label: 'Sensory Zero on/off (Stark-Web Terminal)' },
  { keys: ['D'], label: 'Mostra/nascondi briefing, quota e missioni (Stark-Web Terminal)' },
  { keys: ['1', '2', '3'], label: 'Debriefing: Flow, Normale o Distratta, a fine sessione' }
];

function PaletteDialog({ onClose, initialSection }) {
  const { state, derived, setSensoryZero } = useArachnoForge();
  const timer = useFocusTimerContext();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(initialSection === 'shortcuts');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const restoreFocusRef = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    inputRef.current?.focus();
    const toRestore = restoreFocusRef.current;
    return () => {
      if (toRestore && typeof toRestore.focus === 'function') {
        try {
          toRestore.focus({ preventScroll: true });
        } catch {
          /* elemento non più nel DOM */
        }
      }
    };
  }, []);

  const run = useCallback(
    (fn) => {
      onClose();
      // Dopo la chiusura: il comando può aprire un'altra modale.
      setTimeout(fn, 0);
    },
    [onClose]
  );

  const commands = useMemo(() => {
    const out = [];
    NAV.forEach((n) =>
      out.push({
        id: `nav-${n.route}`,
        group: 'Vai a',
        label: n.label,
        hint: n.hint,
        icon: n.icon,
        shortcut: ['Alt', n.key],
        kw: n.kw,
        action: () => goTo(n.route)
      })
    );

    // Timer
    const s = timer.status;
    if (timer.awaitingDebrief) {
      out.push({
        id: 'timer-debrief',
        group: 'Tactical Timer',
        label: `Chiudi la sessione in sospeso (${timer.pendingFocusMinutes} min)`,
        hint: 'Apre lo Stark-Web Terminal sul Debriefing',
        icon: 'check',
        kw: 'timer debriefing salva termina sessione',
        action: () => goTo(ROUTES.MISSION_CONTROL)
      });
    } else if (s === 'IDLE') {
      out.push({
        id: 'timer-start',
        group: 'Tactical Timer',
        label: 'Avvia Focus sull’obiettivo del momento',
        hint: derived.primaryTarget ? `Primary Target: ${derived.primaryTarget.materia.nome}` : 'Focus generico',
        icon: 'play',
        kw: 'timer avvia focus pomodoro start studia',
        action: () => {
          goTo(ROUTES.MISSION_CONTROL);
          requestIntent(INTENT.TIMER_START_NOW);
        }
      });
    }
    if (s === 'FOCUS' || s === 'BREAK') {
      out.push({
        id: 'timer-pause',
        group: 'Tactical Timer',
        label: s === 'FOCUS' ? 'Metti in pausa il Focus' : 'Sospendi la pausa',
        icon: 'pause',
        kw: 'timer pausa stop ferma',
        action: () => timer.pause()
      });
    }
    if (s === 'PAUSED') {
      out.push({
        id: 'timer-resume',
        group: 'Tactical Timer',
        label: 'Riprendi il timer',
        icon: 'play',
        kw: 'timer riprendi continua resume',
        action: () => timer.resume()
      });
    }
    out.push({
      id: 'timer-sensory-zero',
      group: 'Tactical Timer',
      label: 'Sensory Zero',
      hint: 'Solo il countdown, a tutto schermo',
      icon: 'eye',
      kw: 'sensory zero concentrazione schermo intero focus',
      action: () => {
        goTo(ROUTES.MISSION_CONTROL);
        setSensoryZero(true);
      }
    });

    // Azioni
    out.push({
      id: 'act-new-materia',
      group: 'Azioni',
      label: 'Nuova materia nel Web-Matrix',
      icon: 'plus',
      kw: 'nuova materia esame aggiungi corso',
      action: () => {
        goTo(ROUTES.QUADRANT_HUB);
        requestIntent(INTENT.WEBMATRIX_NEW_MATERIA);
      }
    });
    out.push({
      id: 'act-spider-sense',
      group: 'Azioni',
      label: `Ripassi Spider-Sense${derived.upcomingReviews.length ? ` (${derived.upcomingReviews.length} in scadenza)` : ''}`,
      icon: 'radar',
      kw: 'ripassi spider sense ripetizione memoria review',
      action: () => {
        goTo(ROUTES.QUADRANT_HUB);
        requestIntent(INTENT.WEBMATRIX_SPIDER_SENSE);
      }
    });
    out.push({
      id: 'act-backup',
      group: 'Azioni',
      label: 'Backup e ripristino dei dati',
      hint: 'Esporta, importa, punti di ripristino automatici',
      icon: 'archive',
      kw: 'backup esporta importa ripristino dati json salvataggio',
      action: () => {
        goTo(ROUTES.CORE_CONFIG);
        requestIntent(INTENT.SETTINGS_BACKUP);
      }
    });
    out.push({
      id: 'act-shortcuts',
      group: 'Azioni',
      label: 'Scorciatoie da tastiera',
      icon: 'keyboard',
      kw: 'scorciatoie tastiera shortcut tasti aiuto help',
      keepOpen: true,
      action: () => setShowShortcuts(true)
    });

    // Materie e argomenti
    const materie = (Array.isArray(state.materie) ? state.materie : []).filter((m) => m && !m.examPassed);
    materie.forEach((m) => {
      out.push({
        id: `mat-${m.id}`,
        group: 'Materie',
        label: m.nome,
        hint: m.examDate ? `Esame ${m.examDate.split('-').reverse().join('/')} · ${m.cfu} CFU` : `${m.cfu} CFU · senza data`,
        icon: 'book',
        kw: `materia ${m.nome}`,
        action: () => {
          goTo(ROUTES.QUADRANT_HUB);
          requestIntent(INTENT.WEBMATRIX_OPEN, { materiaId: m.id });
        }
      });
    });
    materie.forEach((m) => {
      (Array.isArray(m.sfide) ? m.sfide : []).forEach((sf) => {
        if (!sf || !sf.nome) return;
        out.push({
          id: `nodo-${sf.id}`,
          group: 'Argomenti',
          label: sf.nome,
          hint: m.nome,
          icon: sf.status === 'COMPLETED' ? 'check' : 'target',
          kw: `${sf.nome} ${m.nome} ${sf.obiettivo || ''}`,
          onlyOnSearch: true,
          action: () => {
            goTo(ROUTES.QUADRANT_HUB);
            requestIntent(INTENT.WEBMATRIX_OPEN, { materiaId: m.id, sfidaId: sf.id });
          }
        });
      });
    });
    return out;
  }, [state.materie, timer, derived.primaryTarget, derived.upcomingReviews.length, setSensoryZero]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return commands.filter((c) => !c.onlyOnSearch);
    const terms = q.split(/\s+/).filter(Boolean);
    return commands
      .map((c) => {
        const hay = normalize(`${c.label} ${c.hint || ''} ${c.kw || ''} ${c.group}`);
        if (!terms.every((t) => hay.includes(t))) return null;
        const label = normalize(c.label);
        const score = (label.startsWith(terms[0]) ? 0 : label.includes(terms[0]) ? 1 : 2) + (c.onlyOnSearch ? 0.5 : 0);
        return { c, score };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, 60)
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // L'elemento attivo resta sempre visibile mentre si scorre con le frecce.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const execute = useCallback(
    (cmd) => {
      if (!cmd) return;
      if (cmd.keepOpen) {
        cmd.action();
        return;
      }
      run(cmd.action);
    },
    [run]
  );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (showShortcuts) setShowShortcuts(false);
      else onClose();
      return;
    }
    if (showShortcuts) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(results[activeIndex]);
    }
  };

  // Raggruppa mantenendo l'ordine dei risultati.
  const grouped = useMemo(() => {
    const groups = [];
    const byName = new Map();
    results.forEach((c, i) => {
      if (!byName.has(c.group)) {
        const g = { name: c.group, items: [] };
        byName.set(c.group, g);
        groups.push(g);
      }
      byName.get(c.group).items.push({ c, i });
    });
    return groups;
  }, [results]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh] bg-black/55 backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palette comandi"
        onKeyDown={onKeyDown}
        className="w-full max-w-[640px] rounded-2xl border border-line-strong bg-panel shadow-pop overflow-hidden af-dropdown-in"
      >
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Icon name="search" className="w-[18px] h-[18px] text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (showShortcuts) setShowShortcuts(false);
            }}
            placeholder="Cerca sezioni, materie, argomenti o comandi…"
            className="flex-1 bg-transparent py-4 text-[15px] text-white placeholder:text-slate-500 outline-none"
            aria-label="Cerca"
            role="combobox"
            aria-expanded="true"
            aria-controls="af-palette-list"
            aria-activedescendant={results[activeIndex] ? `af-cmd-${activeIndex}` : undefined}
          />
          <span className="ds-kbd">Esc</span>
        </div>

        {showShortcuts ? (
          <div className="p-4 space-y-1">
            <p className="ds-eyebrow mb-2">Scorciatoie da tastiera</p>
            {SHORTCUTS.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
                <span className="text-sm text-slate-300">{s.label}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {s.keys.map((k) => (
                    <span key={k} className="ds-kbd">
                      {k}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            <button type="button" onClick={() => setShowShortcuts(false)} className="ds-btn ds-btn-ghost ds-btn-sm mt-3">
              <Icon name="chevronLeft" className="w-4 h-4" />
              Torna ai comandi
            </button>
          </div>
        ) : (
          <div ref={listRef} id="af-palette-list" role="listbox" className="max-h-[56vh] overflow-y-auto af-scroll p-2">
            {results.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-slate-500">Nessun risultato per “{query}”.</p>
            ) : (
              grouped.map((g) => (
                <div key={g.name} className="mb-1.5 last:mb-0">
                  <p className="ds-eyebrow px-3 pt-2 pb-1">{g.name}</p>
                  {g.items.map(({ c, i }) => {
                    const active = i === activeIndex;
                    return (
                      <button
                        key={c.id}
                        id={`af-cmd-${i}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-index={i}
                        onMouseMove={() => {
                          if (!active) setActiveIndex(i);
                        }}
                        onClick={() => execute(c)}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                          active ? 'bg-white/[0.07]' : ''
                        }`}
                      >
                        <span className={`ds-icon-tile !w-8 !h-8 ${active ? 'text-white border-line-strong' : 'text-slate-400'}`}>
                          <Icon name={c.icon} className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-100 truncate">{c.label}</span>
                          {c.hint && <span className="block text-xs text-slate-500 truncate">{c.hint}</span>}
                        </span>
                        {c.shortcut && (
                          <span className="hidden sm:flex items-center gap-1 shrink-0">
                            {c.shortcut.map((k) => (
                              <span key={k} className="ds-kbd">
                                {k}
                              </span>
                            ))}
                          </span>
                        )}
                        {active && <Icon name="arrowRight" className="w-4 h-4 text-slate-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-line text-[11px] text-slate-500">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="ds-kbd">↑</span>
              <span className="ds-kbd">↓</span>
              per scegliere
            </span>
            <span className="flex items-center gap-1">
              <span className="ds-kbd">↵</span>
              per aprire
            </span>
          </span>
          <button type="button" onClick={() => setShowShortcuts((v) => !v)} className="hover:text-slate-300 transition-colors">
            Scorciatoie <span className="ds-kbd ml-1">?</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Sempre montata nella Shell: ascolta le scorciatoie globali e monta la
 * finestra solo quando serve (così non si ridisegna a ogni secondo del
 * timer mentre è chiusa).
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState(null);

  useEffect(() => {
    const onOpen = (e) => {
      setSection(e?.detail?.section || null);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSection(null);
        setOpen((v) => !v);
        return;
      }
      if (e.defaultPrevented || open) return;
      if (isTypingTarget(e.target)) return;
      // Un'altra finestra modale ha la precedenza sulle scorciatoie.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        const target = NAV[n - 1];
        if (target) {
          e.preventDefault();
          goTo(target.route);
        }
        return;
      }
      if (!mod && !e.altKey && e.key === '?') {
        e.preventDefault();
        setSection('shortcuts');
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;
  return <PaletteDialog onClose={() => setOpen(false)} initialSection={section} />;
}
