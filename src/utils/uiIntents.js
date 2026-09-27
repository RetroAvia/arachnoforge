/**
 * V41 — "Intenti" di interfaccia fra parti dell'app che non si conoscono.
 *
 * La palette comandi (Ctrl K) deve poter dire "apri questa materia nel
 * Web-Matrix" o "avvia il timer" anche quando quella pagina non è ancora
 * montata. Un intento resta in attesa finché la pagina che lo sa gestire
 * non lo consuma (subito, se è già aperta; al montaggio, altrimenti).
 * Nessuno stato persistito, nessuna dipendenza da React qui dentro: la
 * parte React è il piccolo hook `useIntent` in fondo.
 */
import { useEffect, useRef } from 'react';

const EVENT = 'af:intent';
const pending = new Map();

export const INTENT = {
  /** Avvia il Focus sulla card "ADESSO" (Stark-Web Terminal). */
  TIMER_START_NOW: 'timer:start-now',
  /** Avvia il Focus su un argomento preciso. payload: { materiaId, sfidaId } */
  TIMER_FOCUS_ON: 'timer:focus-on',
  /** Apre una materia (ed eventualmente un nodo) nel Web-Matrix. payload: { materiaId, sfidaId? } */
  WEBMATRIX_OPEN: 'webmatrix:open',
  /** Apre il form "Nuova materia" nel Web-Matrix. */
  WEBMATRIX_NEW_MATERIA: 'webmatrix:new-materia',
  /** Apre il drawer Spider-Sense nel Web-Matrix. */
  WEBMATRIX_SPIDER_SENSE: 'webmatrix:spider-sense',
  /** Porta alla sezione backup di Karen OS Settings. */
  SETTINGS_BACKUP: 'settings:backup'
};

export function requestIntent(name, payload = true) {
  pending.set(name, payload);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { name } }));
  }
}

export function consumeIntent(name) {
  if (!pending.has(name)) return null;
  const payload = pending.get(name);
  pending.delete(name);
  return payload;
}

/** Esegue `handler(payload)` quando arriva l'intento `name` (anche se era già in attesa al montaggio). */
export function useIntent(name, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const run = () => {
      const payload = consumeIntent(name);
      if (payload != null) handlerRef.current(payload);
    };
    // Al montaggio: un intento arrivato mentre la pagina si stava caricando.
    const t = setTimeout(run, 0);
    const onEvent = (e) => {
      if (e?.detail?.name === name) run();
    };
    window.addEventListener(EVENT, onEvent);
    return () => {
      clearTimeout(t);
      window.removeEventListener(EVENT, onEvent);
    };
  }, [name]);
}
